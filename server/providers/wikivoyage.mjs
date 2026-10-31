import { createHash } from 'node:crypto';
import { parseWikivoyagePlaces as parseShared, withoutHiddenText, validDestination, pageUrl } from '../../shared/wikivoyage-parser.mjs';
export { isNonPlaceName } from '../../shared/wikivoyage-parser.mjs';

const API = 'https://en.wikivoyage.org/w/api.php';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PLACES = 60;

export function parseWikivoyagePlaces(text, destination, options = {}) {
  return parseShared(text, destination, { ...options, hashName: key => createHash('sha256').update(key).digest('hex').slice(0, 12) });
}

async function limitedJson(response) {
  if (!response.ok) throw new Error(`Wikivoyage returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new Error('Wikivoyage response exceeded the size limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Wikivoyage returned an empty response.');
  let bytes = 0;
  let content = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Wikivoyage response exceeded the size limit.'); }
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function fetchWikivoyagePlaces(destination, { fetchImpl = globalThis.fetch, signal, timeoutMs = 15_000 } = {}) {
  if (!validDestination(destination)) throw new TypeError('A destination with a valid bounded search region is required.');
  const fetchedAt = new Date().toISOString();
  const empty = { places: [], warnings: [], provider: 'wikivoyage', status: 'ok', fetchedAt, refreshedSourceUrls: [] };
  if (signal?.aborted) throw new DOMException('Place lookup cancelled.', 'AbortError');
  if (destination.wikivoyageAvailable === false) return { ...empty, status: 'unavailable', warnings: [`A dedicated Wikivoyage guide is not available for ${destination.city}.`] };
  const apiUrl = new URL(API);
  for (const [key, value] of Object.entries({ action: 'query', titles: destination.wikivoyageTitle, redirects: '1', prop: 'revisions|info', rvprop: 'content|timestamp|ids', rvslots: 'main', inprop: 'url', format: 'json', formatversion: '2' })) apiUrl.searchParams.set(key, value);
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interruption = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(new DOMException('Place lookup cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error('Wikivoyage timed out.')); }, Math.max(1, Math.min(Number(timeoutMs) || 15_000, 60_000)));
  });
  const requestPages = async (titles) => {
    const requestUrl = new URL(apiUrl);
    requestUrl.searchParams.set('titles', titles.join('|'));
    const data = await Promise.race([
      (async () => limitedJson(await fetchImpl(requestUrl.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'ElsewherePlaceFinder/1.0 (India place discovery)' } })))(),
      interruption,
    ]);
    if (signal?.aborted) throw new DOMException('Place lookup cancelled.', 'AbortError');
    if (data.error || !Array.isArray(data.query?.pages)) throw new Error('Wikivoyage could not return this destination.');
    return data.query.pages;
  };
  try {
    const pages = await requestPages([destination.wikivoyageTitle]);
    const page = pages.find(item => item && !item.missing && !item.invalid);
    if (!page) return { ...empty, refreshedSourceUrls: [pageUrl(destination.wikivoyageTitle).href], warnings: [`No Wikivoyage article was available for ${destination.city}.`] };
    const revision = page.revisions?.[0];
    const wikitext = revision?.slots?.main?.content ?? revision?.['*'];
    if (typeof wikitext !== 'string') throw new Error('Wikivoyage did not return readable listing content.');
    const places = parseWikivoyagePlaces(wikitext, destination, { title: page.title, url: page.fullurl, updatedAt: revision.timestamp, fetchedAt });
    const refreshedSourceUrls = [pageUrl(page.title, page.fullurl).href];
    const warnings = [];
    let status = 'ok';
    // Follow only the first two district articles actually linked by a guide
    // which explicitly delegates listings to districts. Never crawl recursively.
    const districtTitles = /\{\{\s*seeDistricts\s*[|}]/i.test(wikitext)
      ? [...new Set([...withoutHiddenText(wikitext).matchAll(/\[\[([^\]|#]+)(?:[\]|#])/g)]
        .map(match => match[1].replace(/_/g, ' ').trim())
        .filter(title => title.startsWith(`${page.title}/`) && title.length <= 180))].slice(0, 2)
      : [];
    if (districtTitles.length) {
      try {
        const districtPages = await requestPages(districtTitles);
        for (const district of districtPages) {
          if (district.missing || district.invalid) {
            if (typeof district.title === 'string') refreshedSourceUrls.push(pageUrl(district.title).href);
            warnings.push(`The ${district.title || 'linked'} district article was not available.`);
            continue;
          }
          const districtRevision = district.revisions?.[0];
          const districtText = districtRevision?.slots?.main?.content ?? districtRevision?.['*'];
          if (typeof districtText !== 'string') { status = 'partial'; warnings.push(`The ${district.title} district listings were unavailable.`); continue; }
          places.push(...parseWikivoyagePlaces(districtText, destination, { title: district.title, url: district.fullurl, updatedAt: districtRevision.timestamp, fetchedAt }));
          refreshedSourceUrls.push(pageUrl(district.title, district.fullurl).href);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        status = 'partial';
        warnings.push(`District listings for ${destination.city} could not be loaded. ${error.message}`);
      }
    }
    const uniquePlaces = new Map();
    for (const place of places) {
      const prior = uniquePlaces.get(place.id);
      if (prior) {
        if (!prior.coordinates && place.coordinates) prior.coordinates = place.coordinates;
        prior.sources.push(...place.sources.filter(source => !prior.sources.some(existing => existing.url === source.url)));
      } else if (uniquePlaces.size < MAX_PLACES) uniquePlaces.set(place.id, place);
    }
    if (!uniquePlaces.size) warnings.push(`No named sightseeing listings were found in the ${destination.city} guide within this search region.`);
    return { ...empty, places: [...uniquePlaces.values()], status, refreshedSourceUrls, warnings };
  } catch (error) {
    controller.abort();
    if (signal?.aborted || error.name === 'AbortError') throw error;
    return { ...empty, status: 'unavailable', warnings: [`Wikivoyage listings for ${destination.city} could not be loaded. ${error.message}`] };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
