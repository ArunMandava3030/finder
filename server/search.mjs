import { createHash } from 'node:crypto';

const SOURCES = new Set(['all', 'reddit', 'instagram', 'web']);
const COVERAGE_WARNING = 'Results come from publicly indexed pages. Private posts, complete comment threads, and every place on the web are not available.';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class SearchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeQuery(input) {
  if (typeof input !== 'string' || input.trim().length < 2 || input.trim().length > 160) {
    throw new SearchError('INVALID_QUERY', 'Enter a search between 2 and 160 characters.');
  }
  const query = input.trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[#_\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\bhidden\s*places?/gi, 'hidden places ')
    .replace(/\bhidden\s*gems?/gi, 'hidden gems ')
    .replace(/\bsecret\s*spots?/gi, 'secret spots ')
    .replace(/\boffbeat(?=\p{L})/giu, 'offbeat ')
    .replace(/\s+/g, ' ')
    .trim();
  if (query.length < 2 || !/[\p{L}\p{N}]/u.test(query)) {
    throw new SearchError('INVALID_QUERY', 'Enter a place, city, or travel hashtag.');
  }
  return query;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function providerConfig(env) {
  const key = env.TAVILY_API_KEY?.trim();
  if (key) return { provider: 'tavily', key };
  const url = safeUrl(env.SEARXNG_URL?.trim());
  if (url) {
    url.search = '';
    url.hash = '';
    url.pathname = /\/search\/?$/.test(url.pathname)
      ? url.pathname.replace(/\/$/, '')
      : `${url.pathname.replace(/\/$/, '')}/search`;
    return { provider: 'searxng', url };
  }
  return { provider: null };
}

function plainText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
    })[entity])
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function classifyDomain(domain) {
  if (domain === 'reddit.com' || domain.endsWith('.reddit.com') || domain === 'redd.it') return 'reddit';
  if (domain === 'instagram.com' || domain.endsWith('.instagram.com')) return 'instagram';
  return 'web';
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  const url = safeUrl(result.url);
  if (!url) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  }
  const domain = url.hostname.replace(/^www\./, '');
  const canonical = url.toString();
  const title = plainText(result.title, 240);
  if (!title) return null;
  const image = safeUrl(result.img_src || result.thumbnail || result.image);
  return {
    id: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
    title,
    url: canonical,
    excerpt: plainText(result.content || result.description || result.snippet, 1200),
    source: classifyDomain(domain),
    domain,
    ...(image ? { image: image.toString() } : {}),
  };
}

async function readJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Response exceeds limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response exceeds limit');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

async function requestJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SearchError('SEARCH_TIMEOUT', 'The search provider took too long. Please try again.', 504));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SearchError('PROVIDER_UNAVAILABLE', 'The search provider is unavailable. Check its configuration or try again later.', 502);
    }
    return readJson(response);
  })();
  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    controller.abort();
    if (error instanceof SearchError) throw error;
    throw new SearchError('PROVIDER_UNAVAILABLE', 'The search provider could not complete this search. Please try again later.', 502);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSource(config, query, source, fetchImpl, timeoutMs) {
  let data;
  if (config.provider === 'tavily') {
    data = await requestJson(fetchImpl, 'https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({
        query,
        topic: 'general',
        search_depth: 'basic',
        max_results: 8,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        ...(source === 'web'
          ? { exclude_domains: ['reddit.com', 'instagram.com'] }
          : { include_domains: [source === 'reddit' ? 'reddit.com' : 'instagram.com'] }),
      }),
    }, timeoutMs);
  } else {
    const url = new URL(config.url);
    url.searchParams.set('q', source === 'web'
      ? `${query} -site:reddit.com -site:instagram.com`
      : `${query} site:${source}.com`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'general');
    url.searchParams.set('safesearch', '1');
    data = await requestJson(fetchImpl, url, { headers: { Accept: 'application/json' } }, timeoutMs);
  }
  if (!Array.isArray(data?.results)) {
    throw new SearchError('PROVIDER_UNAVAILABLE', 'The search provider returned an unexpected response.', 502);
  }
  return data.results.slice(0, 40).map(normalizeResult).filter((result) => result && result.source === source).slice(0, 8);
}

export function createSearchService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 12_000,
  cacheTtlMs = 5 * 60_000,
  maxCacheEntries = 100,
  maxConcurrentSearches = 4,
} = {}) {
  const cache = new Map();
  const pending = new Map();

  function status() {
    const { provider } = providerConfig(env);
    return { configured: provider !== null, provider };
  }

  async function search(query, { source = 'all' } = {}) {
    const normalizedQuery = normalizeQuery(query);
    if (!SOURCES.has(source)) throw new SearchError('INVALID_SOURCE', 'Choose all, reddit, instagram, or web.');
    const config = providerConfig(env);
    const base = {
      query: query.trim(), normalizedQuery, source, results: [],
      retrievedAt: new Date(now()).toISOString(),
      provider: config.provider, configured: config.provider !== null,
      warnings: [COVERAGE_WARNING],
    };
    if (!config.provider) {
      return {
        ...base,
        error: { code: 'SEARCH_NOT_CONFIGURED', message: 'Live search is not connected yet. Add TAVILY_API_KEY or SEARXNG_URL to the server environment.' },
      };
    }
    const key = `${config.provider}:${normalizedQuery.toLowerCase()}:${source}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return { ...cached.value, query: base.query, normalizedQuery, cached: true };
    if (cached) cache.delete(key);
    if (pending.has(key)) return { ...await pending.get(key), query: base.query, normalizedQuery, cached: true };
    if (pending.size >= maxConcurrentSearches) throw new SearchError('SEARCH_BUSY', 'Search is busy. Please try again in a moment.', 503);

    const task = (async () => {
      const sources = source === 'all' ? ['web', 'reddit', 'instagram'] : [source];
      const responses = await Promise.allSettled(sources.map((item) => fetchSource(config, normalizedQuery, item, fetchImpl, timeoutMs)));
      const successful = responses.filter((item) => item.status === 'fulfilled');
      if (!successful.length) throw responses[0].reason;
      const warnings = [...base.warnings];
      responses.forEach((item, index) => {
        if (item.status === 'rejected') warnings.push(`${sources[index] === 'web' ? 'Web' : sources[index] === 'reddit' ? 'Reddit' : 'Instagram'} results could not be retrieved. Other available sources are shown.`);
      });
      const buckets = successful.map((item) => item.value);
      const seen = new Set();
      const results = [];
      for (let i = 0; i < 8; i += 1) {
        for (const bucket of buckets) {
          const item = bucket[i];
          if (item && !seen.has(item.id)) {
            seen.add(item.id);
            results.push(item);
          }
        }
      }
      const value = { ...base, retrievedAt: new Date(now()).toISOString(), results, warnings, cached: false };
      // Partial provider outages should be retried instead of cached for five minutes.
      if (successful.length === responses.length) {
        if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expires: now() + cacheTtlMs });
      }
      return value;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }

  return { search, status };
}

const defaultService = createSearchService();
export const searchPlaces = (query, options) => defaultService.search(query, options);
export const searchStatus = () => defaultService.status();
