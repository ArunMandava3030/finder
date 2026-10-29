import { normalizeLocalQuery } from './discovery.js';

const WIKIS = [
  { host: 'en.wikivoyage.org', name: 'Wikivoyage' },
  { host: 'en.wikipedia.org', name: 'Wikipedia' },
];
const MAX_BYTES = 1024 * 1024;
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
const SCOPE_WARNING = 'These are public Wikivoyage and Wikipedia guides, not a search of the entire web. Live Reddit and Instagram posts and visitor ratings are not included.';

function searchError(code, message) {
  return Object.assign(new Error(message), { code });
}

function aborted() {
  return new DOMException('Search cancelled.', 'AbortError');
}

function plainText(value, limit = 700) {
  if (typeof value !== 'string') return '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
  const text = value.replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
      if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? entity;
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function normalizeInput(query) {
  if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 160) {
    throw searchError('INVALID_QUERY', 'Enter a city or place between 2 and 160 characters.');
  }
  const normalized = normalizeLocalQuery(query)
    .replace(/^(?:(?:in|near|around)\s+)+/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (normalized.length < 2 || !/[\p{L}\p{N}]/u.test(normalized)) {
    throw searchError('INVALID_QUERY', 'Add a city or place to your search, such as #hiddenplacegokarna.');
  }
  return normalized;
}

function wikiUrl(host, title, fullurl) {
  try {
    const url = new URL(fullurl || `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function resultForPage(page, wiki) {
  if (!page || typeof page.title !== 'string' || page.missing || page.invalid) return null;
  if (page.pageprops && Object.hasOwn(page.pageprops, 'disambiguation')) return null;
  if (/\((?:film|song|album|novel|tv series|video game|surname|given name|band)\)$/i.test(page.title)
    || /\bmay refer to:/i.test(page.extract || '')) return null;
  const url = wikiUrl(wiki.host, page.title, page.fullurl);
  if (!url) return null;
  return {
    id: `${wiki.host}:${page.pageid ?? page.title}`,
    title: plainText(page.title, 180),
    url: url.href,
    excerpt: plainText(page.extract),
    source: 'web',
    domain: wiki.host,
    attribution: `${wiki.name} contributors`,
    license: 'CC BY-SA 4.0',
    licenseUrl: LICENSE_URL,
  };
}

function pagesFrom(data) {
  if (data?.error) throw searchError('GUIDE_UNAVAILABLE', 'The public guide service could not complete this search. Please try again.');
  if (data?.batchcomplete !== undefined && !data.query) return [];
  if (!Array.isArray(data?.query?.pages)) throw searchError('GUIDE_UNAVAILABLE', 'The public guide service returned an unexpected response.');
  return data.query.pages.filter((page) => page && !page.missing && !page.invalid)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response');
  const decoder = new TextDecoder();
  let bytes = 0;
  let content = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

async function requestWiki(wiki, params, { fetchImpl, signal, timeoutMs }) {
  if (signal?.aborted) throw aborted();
  const url = new URL(`https://${wiki.host}/w/api.php`);
  Object.entries({ ...params, format: 'json', formatversion: '2', origin: '*' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(aborted()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(searchError('GUIDE_TIMEOUT', 'The public guide service took too long. Please try again.'));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(url.href, { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw searchError('GUIDE_UNAVAILABLE', 'Public guides are unavailable right now. Please try again shortly.');
    return pagesFrom(await boundedJson(response));
  })();
  try {
    return await Promise.race([request, interrupted]);
  } catch (error) {
    controller.abort();
    if (signal?.aborted) throw aborted();
    if (['GUIDE_UNAVAILABLE', 'GUIDE_TIMEOUT'].includes(error.code)) throw error;
    throw searchError('GUIDE_UNAVAILABLE', 'Could not reach the public guide service. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function sectionResults(page) {
  if (typeof page?.extract !== 'string') return [];
  const guide = resultForPage(page, WIKIS[0]);
  if (!guide) return [];
  const headings = [...page.extract.matchAll(/^(={2,6})\s*(.+?)\s*\1\s*$/gm)];
  const results = [];
  let sightseeing = false;
  for (let index = 0; index < headings.length && results.length < 3; index += 1) {
    const heading = headings[index];
    const title = plainText(heading[2], 100);
    if (heading[1].length === 2) sightseeing = /^(see|do)$/i.test(title);
    if (!sightseeing) continue;
    const body = page.extract.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? page.extract.length).trim();
    if (body.length < 40) continue;
    // Numbered listing paragraphs contain actual places when the guide has them.
    const listings = body.split(/\n\s*\n/).filter((paragraph) => /^\d+\s+\p{L}/u.test(paragraph.trim()));
    const excerpt = listings.length ? listings.slice(0, 3).map((paragraph) => plainText(paragraph, 210)).join(' ') : plainText(body, 650);
    const url = new URL(guide.url);
    url.hash = title.replace(/ /g, '_');
    results.push({ ...guide, id: `${guide.id}:section:${title}`, title: `${guide.title} · ${title}`, url: url.href, excerpt });
  }
  return results;
}

export function createPublicGuideSearch({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10_000, cacheTtlMs = 300_000, maxCacheEntries = 50 } = {}) {
  const cache = new Map();
  return async function search(query, { signal } = {}) {
    const normalizedQuery = normalizeInput(query);
    if (signal?.aborted) throw aborted();
    const cached = cache.get(normalizedQuery);
    if (cached && cached.expires > now()) return { ...cached.value, query: query.trim(), cached: true };
    if (cached) cache.delete(normalizedQuery);
    const options = { fetchImpl, signal, timeoutMs };
    const responses = await Promise.allSettled(WIKIS.map((wiki) => requestWiki(wiki, {
      action: 'query', generator: 'search', gsrsearch: normalizedQuery, gsrnamespace: '0', gsrlimit: '5',
      prop: 'extracts|info|pageprops', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exsentences: '3', inprop: 'url',
    }, options)));
    if (signal?.aborted) throw aborted();
    if (responses.every((response) => response.status === 'rejected')) throw responses[0].reason;
    const warnings = [SCOPE_WARNING, 'Guide excerpts are by Wikimedia contributors under CC BY-SA 4.0. Original pages provide author history and current visitor information.'];
    const results = [];
    responses.forEach((response, index) => {
      if (response.status === 'rejected') warnings.push(`${WIKIS[index].name} could not be reached. Available guides from the other source are shown.`);
      else results.push(...response.value.map((page) => resultForPage(page, WIKIS[index])).filter(Boolean));
    });
    let sectionFailed = false;
    const firstGuide = responses[0].status === 'fulfilled' ? responses[0].value.find((page) => resultForPage(page, WIKIS[0])) : null;
    if (firstGuide) {
      try {
        const [fullGuide] = await requestWiki(WIKIS[0], {
          action: 'query', titles: firstGuide.title, prop: 'extracts|info', redirects: '1',
          explaintext: '1', exsectionformat: 'wiki', inprop: 'url',
        }, options);
        results.unshift(...sectionResults(fullGuide));
      } catch (error) {
        if (signal?.aborted) throw aborted();
        sectionFailed = true;
        warnings.push('Detailed sightseeing sections could not be loaded. Guide summaries are still available.');
      }
    }
    if (signal?.aborted) throw aborted();
    const seen = new Set();
    const value = {
      query: query.trim(), normalizedQuery, provider: 'wikimedia', configured: true,
      results: results.filter((result) => !seen.has(result.url) && seen.add(result.url)),
      retrievedAt: new Date(now()).toISOString(), warnings, cached: false,
    };
    if (!sectionFailed && responses.every((response) => response.status === 'fulfilled')) {
      if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
      cache.set(normalizedQuery, { value, expires: now() + cacheTtlMs });
    }
    return value;
  };
}

const defaultSearch = createPublicGuideSearch();
export function searchPublicGuides(query, { signal, fetchImpl } = {}) {
  return (fetchImpl ? createPublicGuideSearch({ fetchImpl }) : defaultSearch)(query, { signal });
}
