import { fileURLToPath } from 'node:url';
import { fetchOsmPlaces } from '../providers/osm.mjs';
import { fetchWikivoyagePlaces } from '../providers/wikivoyage.mjs';
import { fetchRedditEvidence } from '../providers/reddit.mjs';
import { createDiscoveryStore } from './store.mjs';
import { rankPlaces } from './rank.mjs';
import { destinations, resolveDestination } from './destinations.mjs';

const defaultStorePath = fileURLToPath(new URL('../../.local/data/india-store.json', import.meta.url));
const failure = (code, message, status) => Object.assign(new Error(message), { code, status });
const cancelled = () => new DOMException('Request cancelled.', 'AbortError');
const boundedNumber = (value, fallback, maximum) => Math.max(1, Math.min(Number(value) || fallback, maximum));

// A disconnected caller only stops its wait; other callers can still use the shared refresh.
function waitFor(task, signal) {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function boundedTask(run, timeoutMs, code) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure(code, 'The data request timed out. Try again later.', 504));
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => run(controller.signal)), timeout]); }
  finally { clearTimeout(timer); }
}

function sourceProvider(source) {
  if (source.publisher === 'OpenStreetMap' || source.kind === 'map') return 'osm';
  if (source.publisher === 'Wikivoyage') return 'wikivoyage';
  return null;
}

function pageUrl(value) {
  try { const url = new URL(value); url.hash = ''; return url.href; }
  catch { return null; }
}

function previousProviderPlaces(previous, provider, refreshedUrls = new Set()) {
  return (previous?.places || []).flatMap(place => {
    const sources = (place.sources || []).filter(source => sourceProvider(source) === provider && !refreshedUrls.has(pageUrl(source.url)));
    if (!sources.length) return [];
    // A merged record's old description may belong to a different, now replaced source.
    return [{ ...place, sources, description: sources.find(source => source.excerpt)?.excerpt || '' }];
  });
}

async function limitedJson(response) {
  const maximum = 1024 * 1024;
  if (!response.ok || Number(response.headers.get('content-length') || 0) > maximum) throw new Error('Search unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Search unavailable');
  let bytes = 0;
  let content = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new Error('Search unavailable'); }
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally { reader.releaseLock(); }
}

function cleanEvidence(items, maximum) {
  return (Array.isArray(items) ? items : []).slice(0, maximum).flatMap(item => {
    if (!item || typeof item.url !== 'string') return [];
    let url;
    try { url = new URL(item.url); } catch { return []; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
    const clean = (value, limit) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').trim().slice(0, limit) : '';
    return [{
      id: clean(item.id, 200) || url.href, title: clean(item.title, 240), text: clean(item.text || item.excerpt, 3000), url: url.href,
      type: ['discussion', 'comment', 'indexed_link', 'indexed_excerpt'].includes(item.type) ? item.type : 'indexed_excerpt',
      source: item.source === 'reddit' ? 'reddit' : 'web', isReview: false,
      publishedAt: typeof item.publishedAt === 'string' && Number.isFinite(Date.parse(item.publishedAt)) ? new Date(item.publishedAt).toISOString() : null,
      retrievedAt: typeof item.retrievedAt === 'string' && Number.isFinite(Date.parse(item.retrievedAt)) ? new Date(item.retrievedAt).toISOString() : null,
      ...(typeof item.author === 'string' ? { author: clean(item.author, 100) } : {}),
      ...(typeof item.subreddit === 'string' ? { subreddit: clean(item.subreddit, 100) } : {}),
      ...(Number.isFinite(item.score) ? { score: item.score } : {}),
    }];
  });
}

export function createDiscoveryEngine({
  store = createDiscoveryStore(defaultStorePath),
  wikiProvider = fetchWikivoyagePlaces,
  osmProvider = fetchOsmPlaces,
  redditProvider = fetchRedditEvidence,
  fetchImpl = globalThis.fetch,
  env = process.env,
  now = Date.now,
  cacheTtlMs = 24 * 60 * 60 * 1000,
  partialCacheTtlMs = 5 * 60 * 1000,
  discoveryTimeoutMs = 60_000,
  evidenceTimeoutMs = 45_000,
  maxConcurrentDiscoveries = 2,
  maxConcurrentEvidence = 2,
} = {}) {
  const pending = new Map();
  const recentAttempts = new Map();
  const evidencePending = new Map();
  const evidenceCache = new Map();

  async function discover(query, { refresh = false, signal } = {}) {
    if (signal?.aborted) throw cancelled();
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 160) throw failure('INVALID_QUERY', 'Enter an India destination between 2 and 160 characters.', 400);
    const destination = resolveDestination(query);
    if (!destination) throw failure('UNKNOWN_DESTINATION', 'Choose one of the supported India destinations.', 400);
    const previous = await store.get(destination.id);
    const recent = recentAttempts.get(destination.id);
    if (!refresh && recent && recent.expires > now()) return { ...recent.value, cached: true };
    const age = previous ? now() - Date.parse(previous.fetchedAt) : Infinity;
    const complete = previous?.providers?.every(provider => provider.status === 'ok');
    if (!refresh && age >= 0 && age < (complete ? cacheTtlMs : partialCacheTtlMs)) return { ...previous, cached: true };
    if (pending.has(destination.id)) return waitFor(pending.get(destination.id), signal);
    if (pending.size >= boundedNumber(maxConcurrentDiscoveries, 2, 4)) {
      if (previous) return { ...previous, cached: true, stale: true, warnings: [...(previous.warnings || []), 'Refresh is busy; earlier observations are shown.'] };
      throw failure('DISCOVERY_BUSY', 'Two destinations are already refreshing. Try again shortly.', 503);
    }
    const task = (async () => {
      const attemptedAt = new Date(now()).toISOString();
      const timeoutMs = boundedNumber(discoveryTimeoutMs, 60_000, 90_000);
      const responses = await Promise.allSettled([
        boundedTask(providerSignal => wikiProvider(destination, { fetchImpl, signal: providerSignal }), timeoutMs, 'DISCOVERY_TIMEOUT'),
        boundedTask(providerSignal => osmProvider(destination, { fetchImpl, signal: providerSignal, endpoint: env.OVERPASS_URL?.trim() || undefined, userAgent: env.OVERPASS_USER_AGENT?.trim() || undefined }), timeoutMs, 'DISCOVERY_TIMEOUT'),
      ]);
      const warnings = [];
      const providers = [];
      const places = [];
      let retained = false;
      let fresh = false;
      responses.forEach((response, index) => {
        const provider = index === 0 ? 'wikivoyage' : 'osm';
        const label = provider === 'osm' ? 'OpenStreetMap' : 'Wikivoyage';
        const result = response.status === 'fulfilled' ? response.value : null;
        const usable = result && Array.isArray(result.places) && result.status !== 'unavailable';
        const status = usable ? (result.status === 'partial' ? 'partial' : 'ok') : 'unavailable';
        const freshPlaces = usable ? result.places : [];
        const refreshedUrls = new Set((result?.refreshedSourceUrls || freshPlaces.flatMap(place => (place.sources || []).map(source => source.url))).map(pageUrl).filter(Boolean));
        const retainedPlaces = status === 'ok' ? [] : previousProviderPlaces(previous, provider, status === 'partial' ? refreshedUrls : new Set());
        places.push(...retainedPlaces, ...freshPlaces);
        retained ||= retainedPlaces.length > 0;
        fresh ||= status !== 'unavailable';
        if (Array.isArray(result?.warnings)) warnings.push(...result.warnings);
        if (status !== 'ok') warnings.push(`${label} ${status === 'partial' ? 'was only partly refreshed' : 'could not be refreshed'}.${retainedPlaces.length ? ' Earlier source records retain their original dates.' : ' Its data may be incomplete.'}`);
        const previousStatus = previous?.providers?.find(item => item.provider === provider);
        providers.push({
          provider, status, count: freshPlaces.length, retainedCount: retainedPlaces.length,
          fetchedAt: usable ? result.fetchedAt || attemptedAt : previousStatus?.fetchedAt || null,
          attemptedAt,
          ...(response.status === 'rejected' && /^OSM_(?:UNAVAILABLE|TIMEOUT|RATE_LIMITED)$|^DISCOVERY_TIMEOUT$/.test(response.reason?.code || '') ? { errorCode: response.reason.code } : {}),
        });
      });
      if (!fresh && !previous?.places?.length) throw failure('DISCOVERY_UNAVAILABLE', 'Place data providers are unavailable. Try again later.', 502);
      const value = {
        destination, fetchedAt: fresh ? attemptedAt : previous.fetchedAt, attemptedAt,
        places: rankPlaces(places), providers, warnings: [...new Set(warnings)], cached: !fresh, stale: retained,
      };
      // Persist fresh records together with retained sources; never relabel their observation dates.
      if (fresh) await store.put(destination.id, value);
      recentAttempts.set(destination.id, { value, expires: now() + (providers.every(provider => provider.status === 'ok') ? cacheTtlMs : partialCacheTtlMs) });
      return value;
    })();
    pending.set(destination.id, task);
    task.then(() => pending.delete(destination.id), () => pending.delete(destination.id));
    return waitFor(task, signal);
  }

  async function evidence(query, { signal } = {}) {
    if (signal?.aborted) throw cancelled();
    if (typeof query !== 'string' || query.trim().length < 3 || query.length > 160) throw failure('INVALID_QUERY', 'Enter a place and city between 3 and 160 characters.', 400);
    const key = query.trim().toLowerCase();
    for (const [cacheKey, entry] of evidenceCache) if (entry.expires <= now()) evidenceCache.delete(cacheKey);
    const cached = evidenceCache.get(key);
    if (cached) return { ...cached.value, cached: true };
    if (evidencePending.has(key)) return waitFor(evidencePending.get(key), signal);
    if (evidencePending.size >= boundedNumber(maxConcurrentEvidence, 2, 4)) throw failure('EVIDENCE_BUSY', 'Discussion searches are busy. Try again shortly.', 503);
    const task = boundedTask(async providerSignal => {
      const fetchDdgs = async () => {
        if (!env.DDGS_URL) return { items: [], warnings: ['DDGS search service is not connected.'], status: 'not_configured' };
        try {
          const url = new URL('search', `${env.DDGS_URL.replace(/\/+$/, '')}/`);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid search service');
          const result = await limitedJson(await fetchImpl(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
            signal: AbortSignal.any([providerSignal, AbortSignal.timeout(15_000)]),
            body: JSON.stringify({ query: query.trim(), max_results: 8, source: 'all', freshness: 'month' }),
          }));
          if (!Array.isArray(result.items) || result.status === 'unavailable') throw new Error('Search unavailable');
          return { items: cleanEvidence(result.items, 8), warnings: Array.isArray(result.warnings) ? result.warnings : [], status: result.status === 'partial' ? 'partial' : 'ok' };
        } catch {
          return { items: [], warnings: ['Indexed web discussions could not be retrieved.'], status: 'unavailable' };
        }
      };
      const responses = await Promise.allSettled([
        fetchDdgs(),
        Promise.resolve().then(() => redditProvider(query.trim(), { env, fetchImpl, signal: providerSignal })),
      ]);
      if (providerSignal.aborted) throw failure('EVIDENCE_TIMEOUT', 'Discussion search timed out. Try again later.', 504);
      const items = [];
      const warnings = [];
      const providers = [];
      responses.forEach((response, index) => {
        const provider = index === 0 ? 'ddgs' : 'reddit';
        const result = response.status === 'fulfilled' ? response.value : null;
        const status = result && ['ok', 'partial', 'not_configured', 'unavailable'].includes(result.status) ? result.status : 'unavailable';
        items.push(...cleanEvidence(result?.items, index === 0 ? 8 : 18));
        warnings.push(...(Array.isArray(result?.warnings) ? result.warnings : [`${provider === 'reddit' ? 'Reddit' : 'Indexed web'} discussions could not be retrieved.`]));
        providers.push({ provider, status });
      });
      const value = {
        query: query.trim(), items: [...new Map(items.map(item => [item.url, item])).values()], providers, warnings,
        retrievedAt: new Date(now()).toISOString(), cached: false, reviewCount: 0,
        explanation: 'Discussion posts, comments and indexed excerpts are source evidence, not verified traveller reviews. No rating is inferred.',
      };
      // Only complete successful reads are cached, in memory for at most ten minutes.
      if (providers.some(provider => provider.status === 'ok') && providers.every(provider => ['ok', 'not_configured'].includes(provider.status))) {
        if (evidenceCache.size >= 50) evidenceCache.delete(evidenceCache.keys().next().value);
        const entry = { value, expires: now() + 10 * 60 * 1000 };
        evidenceCache.set(key, entry);
        const purge = setTimeout(() => { if (evidenceCache.get(key) === entry) evidenceCache.delete(key); }, 10 * 60 * 1000);
        purge.unref?.();
      }
      return value;
    }, boundedNumber(evidenceTimeoutMs, 45_000, 60_000), 'EVIDENCE_TIMEOUT');
    evidencePending.set(key, task);
    task.then(() => evidencePending.delete(key), () => evidencePending.delete(key));
    return waitFor(task, signal);
  }
  return { discover, evidence, destinations, store };
}
