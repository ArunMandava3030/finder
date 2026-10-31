import { parseWikivoyagePlaces, withoutHiddenText } from '../../shared/wikivoyage-parser.mjs';
import { rankPlaces } from '../../server/discovery/rank.mjs';
import { destinationsForQuery, normalizeIndiaQuery, selectIndexPlaces } from './india-index.js';

const API = 'https://en.wikivoyage.org/w/api.php';
const MAX_BYTES = 2 * 1024 * 1024;
const INDIA_BOX = [6, 67, 37.5, 98];
const STATES = 'Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal Pradesh|Jharkhand|Karnataka|Kerala|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal|Andaman and Nicobar Islands|Chandigarh|Dadra and Nagar Haveli and Daman and Diu|Delhi|Jammu and Kashmir|Ladakh|Lakshadweep|Puducherry'.split('|');
const INDIA_REGIONS = ['India', 'Western India', 'Eastern India', 'Southern India', 'Northern India', 'North-Eastern India', 'North East India', 'Central India', 'Himalayan North'];
const normalize = value => String(value || '').normalize('NFKC').replace(/_/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const abortError = () => new DOMException('Place lookup cancelled.', 'AbortError');
const error = message => new Error(message);
const pageText = page => page?.revisions?.[0]?.slots?.main?.content ?? page?.revisions?.[0]?.['*'];
const usable = page => page && !page.missing && !page.invalid && !Object.hasOwn(page.pageprops || {}, 'disambiguation') && typeof page.title === 'string' && typeof pageText(page) === 'string';
const parentTitle = page => withoutHiddenText(pageText(page) || '').match(/\{\{\s*ispartof\s*\|\s*([^|}\n]+)[|}]/i)?.[1]?.replace(/_/g, ' ').trim();
const forQuery = (value, query, normalizedQuery, cached = false) => ({ ...value, query: query.trim(), normalizedQuery, cached,
  places: selectIndexPlaces(value, { query, crowdMode: 'all' }),
});

function knownScope(title) {
  const key = normalize(title);
  const state = STATES.find(item => normalize(item) === key);
  if (state) return { state };
  const aliases = { orissa: 'Odisha', uttaranchal: 'Uttarakhand', pondicherry: 'Puducherry', 'andaman and nicobar': 'Andaman and Nicobar Islands' };
  if (aliases[key]) return { state: aliases[key] };
  return INDIA_REGIONS.some(item => normalize(item) === key) ? { state: 'India' } : null;
}

function districtTitles(page) {
  const text = withoutHiddenText(pageText(page) || '');
  if (!/\{\{\s*seeDistricts\s*[|}]/i.test(text)) return [];
  return [...new Set([...text.matchAll(/\[\[([^\]|#]+)(?:[\]|#])/g)].map(match => match[1].replace(/_/g, ' ').trim())
    .filter(title => title.startsWith(`${page.title}/`) && title.length < 180))].slice(0, 2);
}

async function boundedJson(response) {
  if (!response.ok) throw error('Public travel guides are unavailable right now. Saved places are still available.');
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw error('The travel guide response was too large to load.');
  const reader = response.body?.getReader();
  if (!reader) throw error('The travel guide response was empty.');
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw error('The travel guide response was too large to load.'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** Keyless, bounded browser lookup. Never treats a whole guide as a quieter-place recommendation. */
export function createIndiaPlaceSearch({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 12_000, cacheTtlMs = 300_000, maxCacheEntries = 30 } = {}) {
  const cache = new Map();
  return async function search(query, { signal, destinations = [] } = {}) {
    if (signal?.aborted) throw abortError();
    if (typeof query !== 'string' || query.trim().length > 160) throw error('Enter a city or place using at most 160 characters.');
    const normalizedQuery = normalizeIndiaQuery(query);
    const fetchedAt = new Date(now()).toISOString();
    const empty = { query: query.trim(), normalizedQuery, places: [], destinations: [], status: 'ok', provider: 'wikivoyage', warnings: [], retrievedAt: fetchedAt, cached: false };
    if (normalizedQuery.length < 2) return empty;
    const matched = destinationsForQuery(destinations, query);
    const candidate = matched.length === 1 ? matched[0] : null;
    const known = candidate && [candidate.id, candidate.city, candidate.wikivoyageTitle, ...(candidate.aliases || [])]
      .some(alias => alias && ` ${normalize(normalizedQuery)} `.includes(` ${normalize(alias)} `)) ? candidate : null;
    if (known?.wikivoyageAvailable === false) return { ...empty, status: 'unavailable', reason: 'guide_not_available', warnings: ['A dedicated public guide is not available for this destination. Saved places from other sources remain available.'] };
    const term = known?.wikivoyageTitle || known?.city || normalizedQuery.replace(/\b(?:beaches?|attractions?|temples?|sightseeing|nature|trails?|best|visit|visiting)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < 2) return empty;
    const cacheKey = `${normalize(term)}:${known?.id || ''}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now()) return forQuery(structuredClone(cached.value), query, normalizedQuery, true);
    cache.delete(cacheKey);
    const controller = new AbortController();
    let timer;
    let onAbort;
    let requests = 0;
    const interruption = new Promise((_, reject) => {
      onAbort = () => { controller.abort(); reject(abortError()); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(error('The travel guide lookup took too long. Saved places are still available.')); }, Math.max(1, Math.min(timeoutMs, 20_000)));
    });
    const request = async parameters => {
      if (requests >= 4) throw error('The bounded guide lookup could not verify more pages.');
      requests += 1;
      const url = new URL(API);
      Object.entries({ action: 'query', prop: 'revisions|info|pageprops', rvprop: 'content|timestamp', rvslots: 'main', ppprop: 'disambiguation', inprop: 'url', redirects: '1', format: 'json', formatversion: '2', origin: '*', ...parameters }).forEach(([key, value]) => url.searchParams.set(key, value));
      const data = await Promise.race([(async () => boundedJson(await fetchImpl(url.href, { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } })))(), interruption]);
      if (signal?.aborted) throw abortError();
      if (data.error || (!Array.isArray(data.query?.pages) && data.batchcomplete === undefined)) throw error('The travel guide service returned an unexpected response.');
      return (data.query?.pages || []).filter(usable).sort((a, b) => (a.index || 0) - (b.index || 0));
    };
    try {
      let pages = await request({ titles: term });
      let page = pages[0];
      if (!page) {
        pages = await request({ generator: 'search', gsrsearch: `${term} India`, gsrnamespace: '0', gsrlimit: '3' });
        page = pages.find(candidate => normalize(candidate.title.replace(/\s*\([^)]*\)$/, '')) === normalize(term));
      }
      if (!page) return { ...empty, warnings: ['No matching public travel guide was found for this search.'] };
      let scope = known ? { state: known.state } : knownScope(page.title) || knownScope(parentTitle(page));
      let parent = parentTitle(page);
      const visited = new Set([normalize(page.title)]);
      while (!scope && parent && requests < 4 && !visited.has(normalize(parent))) {
        visited.add(normalize(parent));
        const ancestors = await request({ titles: parent });
        const ancestor = ancestors[0];
        if (!ancestor) break;
        scope = knownScope(ancestor.title) || knownScope(parentTitle(ancestor));
        parent = parentTitle(ancestor);
      }
      if (!scope) return { ...empty, warnings: ['This guide could not be confirmed as an Indian destination, so its places are not included.'] };
      const destination = known ? { ...known, wikivoyageTitle: page.title, bbox: known.bbox || INDIA_BOX } : {
        id: `live-${normalize(page.title).replace(/ /g, '-')}`, city: page.title.replace(/\s*\([^)]*\)$/, ''), state: scope.state,
        country: 'India', aliases: [term], wikivoyageTitle: page.title, bbox: INDIA_BOX,
      };
      const warnings = ['Live Wikivoyage listings are community travel information, not live crowd counts or verified visitor reviews. Places without explicit crowd evidence remain unknown.'];
      let status = 'ok';
      const listingPages = [page];
      const districts = districtTitles(page);
      if (districts.length && requests < 4) {
        try {
          const loaded = await request({ titles: districts.join('|') });
          listingPages.push(...loaded.filter(candidate => candidate.title.startsWith(`${page.title}/`)));
          if (loaded.length < districts.length) { status = 'partial'; warnings.push('Some linked district listings were unavailable.'); }
        } catch (problem) {
          if (signal?.aborted) throw problem;
          status = 'partial'; warnings.push('Linked district listings could not be loaded. Available places from the main guide are shown.');
        }
      } else if (districts.length) { status = 'partial'; warnings.push('Linked district listings were outside this bounded lookup.'); }
      const places = rankPlaces(listingPages.flatMap(item => parseWikivoyagePlaces(pageText(item), destination, {
        title: item.title, url: item.fullurl, updatedAt: item.revisions[0].timestamp, fetchedAt,
      })), { now }).slice(0, 100).map(place => ({ ...place, live: true }));
      if (!places.length) warnings.push('No named sightseeing listings were available in the verified guide.');
      const value = { ...empty, places, destinations: [{ ...destination, count: places.length, status, fetchedAt, providers: [{ provider: 'wikivoyage', status, count: places.length }] }], warnings, status };
      if (status === 'ok') {
        if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { value: structuredClone(value), expires: now() + cacheTtlMs });
      }
      return forQuery(value, query, normalizedQuery);
    } catch (problem) {
      if (signal?.aborted || problem.name === 'AbortError') throw abortError();
      return { ...empty, status: 'unavailable', warnings: ['Live travel guides could not be loaded. Saved places remain available; try this search again later.'] };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
    }
  };
}

const defaultSearch = createIndiaPlaceSearch();
export function searchIndiaPlaces(query, { signal, destinations, fetchImpl } = {}) {
  return (fetchImpl ? createIndiaPlaceSearch({ fetchImpl }) : defaultSearch)(query, { signal, destinations });
}
