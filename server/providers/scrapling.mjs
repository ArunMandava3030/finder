import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { destinations as knownDestinations } from '../discovery/destinations.mjs';
import { rankPlaces } from '../discovery/rank.mjs';

const MAX_SOURCES = 200;
const MAX_PLACES_PER_SOURCE = 100;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const LICENSE = 'Factual metadata; see source terms';
const statuses = new Set(['ok', 'empty', 'unavailable', 'blocked']);
const categories = new Set(['Beaches', 'Nature', 'Trails', 'Culture', 'Attractions']);
const crowdDirections = { very_low: 'quieter', low: 'quieter', moderate: 'mixed', high: 'busy' };
const socialHosts = ['reddit.com', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'tripadvisor.com', 'quora.com'];
const failure = message => Object.assign(new Error(message), { code: 'INVALID_SCRAPLING_BATCH' });
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const normalizedName = value => value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const factualDescription = publisher => `Listed by ${publisher}. Open the original source for place details and current visitor information.`;
const text = (value, limit = 360) => typeof value === 'string' ? value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !host.includes('.') || isIP(host.replace(/^\[|\]$/g, ''))) return null;
    if (/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || socialHosts.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    return url;
  } catch { return null; }
}

function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= now + 5 * 60_000 ? new Date(date).toISOString() : null;
}

function registrySources(registry, destinationList) {
  const input = Array.isArray(registry) ? registry : registry?.schemaVersion === 1 ? registry.sources : null;
  if (!Array.isArray(input) || input.length > MAX_SOURCES) throw failure('The Scrapling source registry is invalid.');
  const result = new Map();
  for (const entry of input) {
    const url = safeUrl(entry?.url);
    const destination = destinationList.find(item => item.id === entry?.destinationId);
    if (!entry || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(entry.id || '') || result.has(entry.id) || !url || !destination || !text(entry.publisher, 120)) throw failure('The Scrapling source registry contains an invalid source.');
    const allowedOrigins = new Set([url.origin]);
    if (entry.allowedOrigins !== undefined && (!Array.isArray(entry.allowedOrigins) || entry.allowedOrigins.length > 5)) throw failure('The Scrapling source registry contains invalid allowed origins.');
    for (const value of entry.allowedOrigins || []) {
      const allowed = safeUrl(value);
      if (!allowed || allowed.pathname !== '/' || allowed.search || allowed.hash) throw failure('The Scrapling source registry contains an invalid allowed origin.');
      allowedOrigins.add(allowed.origin);
    }
    if (entry.allowedNames !== undefined && (!Array.isArray(entry.allowedNames) || !entry.allowedNames.length || entry.allowedNames.length > MAX_PLACES_PER_SOURCE || entry.allowedNames.some(name => typeof name !== 'string' || !name.trim()))) throw failure('The Scrapling source registry contains invalid allowed names.');
    if (entry.scope === 'selected_places' && !entry.allowedNames?.length) throw failure('A narrowly scoped Scrapling source requires allowed names.');
    if (entry.allowedPaths !== undefined && (!Array.isArray(entry.allowedPaths) || !entry.allowedPaths.length || entry.allowedPaths.length > MAX_PLACES_PER_SOURCE || entry.allowedPaths.some(value => typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[?#]/.test(value)))) throw failure('The Scrapling source registry contains invalid allowed paths.');
    if (entry.placeDetails !== undefined && (!entry.placeDetails || typeof entry.placeDetails !== 'object' || Array.isArray(entry.placeDetails) || Object.keys(entry.placeDetails).length > MAX_PLACES_PER_SOURCE || Object.entries(entry.placeDetails).some(([name, details]) => !name.trim() || !details || typeof details !== 'object' || Array.isArray(details) || Object.entries(details).some(([key, value]) => !['area', 'accessNotes'].includes(key) || typeof value !== 'string' || !value.trim() || value.length > 500)))) throw failure('The Scrapling source registry contains invalid place details.');
    result.set(entry.id, { ...entry, url: url.href, publisher: text(entry.publisher, 120), destination, allowedOrigins, maxPlaces: Math.max(1, Math.min(Number(entry.maxPlaces) || 60, MAX_PLACES_PER_SOURCE)) });
  }
  return result;
}

function normalizePlace(input, source, fetchedAt) {
  const destination = source.destination;
  if (!input || typeof input !== 'object' || input.destinationId !== destination.id || input.country !== 'India' || input.city !== destination.city || input.state !== destination.state) return null;
  if (input.isReview === true || ['review', 'comment', 'discussion'].includes(input.type)) return null;
  const name = text(input.name, 180);
  if (name.length < 3 || !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 3) return null;
  if (source.allowedNames && !source.allowedNames.some(allowed => normalizedName(allowed) === normalizedName(name))) return null;
  let coordinates = null;
  if (input.coordinates !== null && input.coordinates !== undefined) {
    const { lat, lng } = input.coordinates;
    const [south, west, north, east] = destination.bbox;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < south || lat > north || lng < west || lng > east) return null;
    coordinates = { lat, lng };
  }
  const sources = [];
  for (const candidate of input.sources) {
    const url = safeUrl(candidate?.url);
    if (!url || !source.allowedOrigins.has(url.origin) || candidate.publisher !== source.publisher || candidate.kind !== 'guide' || candidate.isReview === true || (candidate.provider && candidate.provider !== 'scrapling')) return null;
    if (candidate.catalogUrl !== undefined && safeUrl(candidate.catalogUrl)?.href !== source.url) return null;
    if (source.allowedPaths && !source.allowedPaths.some(allowed => allowed.replace(/\/+$/, '') === url.pathname.replace(/\/+$/, ''))) return null;
    if (source.parser === 'detail' && url.pathname.replace(/\/+$/, '') !== new URL(source.url).pathname.replace(/\/+$/, '')) return null;
    sources.push({
      url: url.href, catalogUrl: source.url, title: name,
      kind: 'guide', publisher: source.publisher, provider: 'scrapling', sourceId: source.id,
      collectionMethod: 'scrapling', retrievedAt: fetchedAt, publishedAt: null, updatedAt: null,
      excerpt: '', license: LICENSE,
    });
  }
  const identity = `${normalizedName(name)}\n${sources[0].url}`;
  let crowdEvidence;
  if (source.parser === 'crowd_table') {
    if (!Array.isArray(input.crowdEvidence) || input.crowdEvidence.length !== 1 || sources.some(item => item.url !== source.url)) return null;
    const candidate = input.crowdEvidence[0];
    if (!candidate || !Object.hasOwn(crowdDirections, candidate.level) || candidate.direction !== crowdDirections[candidate.level] || candidate.provider !== 'scrapling' || candidate.sourceId !== source.id || candidate.publisher !== source.publisher || safeUrl(candidate.url)?.href !== source.url || candidate.sourceType !== 'official' || candidate.sourceUpdatedAt != null || candidate.conditional !== false) return null;
    const publishedPeriod = candidate.publishedPeriod ?? null;
    if (publishedPeriod !== null && (typeof publishedPeriod !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(publishedPeriod) || publishedPeriod > fetchedAt.slice(0, 7))) return null;
    crowdEvidence = [{
      url: source.url, publisher: source.publisher,
      claim: `The tourism guide classifies ${name} crowd levels as ${candidate.level.replace('_', ' ')}.`,
      direction: crowdDirections[candidate.level], level: candidate.level, sourceUpdatedAt: null, publishedPeriod,
      retrievedAt: fetchedAt, conditional: false, context: 'General guide comparison; not a live headcount.',
      sourceType: 'official', provider: 'scrapling', sourceId: source.id,
    }];
  } else if (input.crowdEvidence !== undefined && (!Array.isArray(input.crowdEvidence) || input.crowdEvidence.length)) return null;
  const details = Object.entries(source.placeDetails || {}).find(([key]) => normalizedName(key) === normalizedName(name))?.[1];
  return {
    id: `scrapling:${source.id}:${hash(identity)}`, name, city: destination.city, destinationId: destination.id,
    state: destination.state, country: 'India', category: categories.has(input.category) ? input.category : 'Attractions',
    coordinates, description: factualDescription(source.publisher), tags: [], image: null,
    ...(crowdEvidence ? { crowdEvidence } : {}),
    ...(details?.area ? { area: text(details.area, 500) } : {}),
    ...(details?.accessNotes ? { accessNotes: text(details.accessNotes, 500) } : {}),
    ...(details?.area || details?.accessNotes ? { detailsSourceId: source.id } : {}),
    sources: [...new Map(sources.map(item => [item.url, item])).values()],
  };
}

/** Validate an offline batch before it can replace any published source observations. */
export function normalizeScraplingBatch(batch, { registry, destinations = knownDestinations, now = Date.now } = {}) {
  const currentTime = now();
  const generatedAt = timestamp(batch?.generatedAt, currentTime);
  if (batch?.schemaVersion !== 1 || batch.provider !== 'scrapling' || !generatedAt || !Array.isArray(batch.sources) || batch.sources.length > MAX_SOURCES) throw failure('The Scrapling batch has an invalid schema, generation date or source list.');
  const registered = registrySources(registry, destinations);
  const visited = new Set();
  const sources = [];
  for (const input of batch.sources) {
    const entry = registered.get(input?.id);
    const url = safeUrl(input?.url);
    const fetchedAt = timestamp(input?.fetchedAt, currentTime);
    const attemptedAt = timestamp(input?.attemptedAt ?? (['ok', 'empty'].includes(input?.status) ? input.fetchedAt : null), currentTime);
    const requiresFetch = ['ok', 'empty'].includes(input?.status);
    if (!entry || entry.enabled === false || visited.has(input.id) || input.destinationId !== entry.destinationId || url?.href !== entry.url || input.publisher !== entry.publisher || !statuses.has(input.status) || !attemptedAt || (requiresFetch && !fetchedAt) || (input.fetchedAt != null && !fetchedAt) || Date.parse(attemptedAt) > Date.parse(generatedAt) + 5 * 60_000 || (fetchedAt && (Date.parse(fetchedAt) > Date.parse(generatedAt) + 5 * 60_000 || Date.parse(fetchedAt) < Date.parse(attemptedAt) - 5 * 60_000))) throw failure('The Scrapling batch contains an unregistered, duplicated or mismatched source.');
    if (!Array.isArray(input.places) || input.places.length > entry.maxPlaces || (input.warnings !== undefined && !Array.isArray(input.warnings))) throw failure('The Scrapling batch exceeds its source limits or contains invalid records.');
    visited.add(input.id);
    const warnings = (input.warnings || []).slice(0, 5).map(value => text(value, 240)).filter(Boolean);
    let status = input.status;
    let places = [];
    if (status === 'ok') {
      const normalized = input.places.map(item => normalizePlace(item, entry, fetchedAt));
      if (normalized.some(item => !item)) {
        status = 'unavailable';
        warnings.push('The extracted records did not pass source or location validation; earlier observations are retained.');
      } else {
        places = [...new Map(normalized.map(item => [item.id, item])).values()];
        if (!places.length) {
          status = 'empty';
          warnings.push('No valid place listings were extracted; earlier observations are retained until the source can be checked.');
        }
      }
    }
    sources.push({ id: entry.id, destinationId: entry.destinationId, url: entry.url, publisher: entry.publisher, status, fetchedAt: ['ok', 'empty'].includes(status) ? fetchedAt : null, attemptedAt, places, warnings });
  }
  return { schemaVersion: 1, provider: 'scrapling', generatedAt, sources };
}

export async function readScraplingBatch(filePath, options) {
  if ((await stat(filePath)).size > MAX_BATCH_BYTES) throw failure('The Scrapling batch exceeds the file size limit.');
  const content = await readFile(filePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > MAX_BATCH_BYTES) throw failure('The Scrapling batch exceeds the file size limit.');
  let batch;
  try { batch = JSON.parse(content); } catch { throw failure('The Scrapling batch is not valid JSON.'); }
  return normalizeScraplingBatch(batch, options);
}

function isOwnedSource(source, sourceId) {
  return source?.provider === 'scrapling' && source.sourceId === sourceId;
}

function dropOwnedSources(place, sourceId) {
  const sources = (place.sources || []).filter(source => !isOwnedSource(source, sourceId));
  const crowdEvidence = (place.crowdEvidence || []).filter(item => !(item.provider === 'scrapling' && item.sourceId === sourceId));
  if (sources.length === (place.sources || []).length && crowdEvidence.length === (place.crowdEvidence || []).length) return place;
  if (!sources.length) return null;
  const retained = { ...place };
  if (place.detailsSourceId === sourceId) {
    delete retained.area;
    delete retained.accessNotes;
    delete retained.detailsSourceId;
  }
  const id = place.id?.startsWith(`scrapling:${sourceId}:`) ? `retained:${hash(`${place.destinationId}\n${place.name}\n${sources.map(source => source.url).join('\n')}`)}` : place.id;
  const scraperSource = sources.find(source => source.provider === 'scrapling');
  return { ...retained, id, sources, ...(place.crowdEvidence ? { crowdEvidence } : {}), description: sources.find(source => source.kind === 'guide' && source.excerpt)?.excerpt || sources.find(source => source.excerpt)?.excerpt || (scraperSource ? factualDescription(scraperSource.publisher) : '') };
}

/** Apply a validated batch. Failures and extraction-empty pages retain old source dates. */
export function mergeScraplingBatch(previousPlaces, batch, { previousScraping = null } = {}) {
  let places = [...previousPlaces];
  const metadata = new Map((previousScraping?.sources || []).map(source => [source.id, { ...source }]));
  for (const source of batch.sources) {
    const previous = metadata.get(source.id);
    const oldPlaces = places.filter(place => (place.sources || []).some(item => isOwnedSource(item, source.id)));
    const oldDates = oldPlaces.flatMap(place => place.sources.filter(item => isOwnedSource(item, source.id)).map(item => item.retrievedAt)).filter(value => Number.isFinite(Date.parse(value)));
    const previousFetchedAt = previous?.fetchedAt || oldDates.sort().at(-1) || null;
    const lastAttempt = [previous?.attemptedAt, previousFetchedAt].filter(Boolean).sort().at(-1);
    if (lastAttempt && Date.parse(source.attemptedAt) < Date.parse(lastAttempt)) continue;
    if (source.status === 'ok') {
      places = places.map(place => dropOwnedSources(place, source.id)).filter(Boolean);
      places.push(...source.places);
    }
    metadata.set(source.id, {
      id: source.id, destinationId: source.destinationId, url: source.url, publisher: source.publisher, status: source.status,
      fetchedAt: source.status === 'ok' ? source.fetchedAt : previousFetchedAt,
      attemptedAt: source.attemptedAt, retainedCount: source.status === 'ok' ? 0 : oldPlaces.length,
      placeCount: source.status === 'ok' ? source.places.length : oldPlaces.length,
      warnings: source.warnings,
    });
  }
  places = rankPlaces(places);
  for (const source of metadata.values()) source.placeCount = places.filter(place => (place.sources || []).some(item => isOwnedSource(item, source.id))).length;
  const sources = [...metadata.values()];
  const destinationProviders = [];
  for (const destinationId of new Set(sources.map(source => source.destinationId))) {
    const sourceRecords = sources.filter(source => source.destinationId === destinationId);
    const count = places.filter(place => place.destinationId === destinationId && place.sources.some(source => source.provider === 'scrapling')).length;
    const successful = sourceRecords.filter(source => source.status === 'ok').length;
    const retainedIds = new Set(sourceRecords.filter(source => source.status !== 'ok').map(source => source.id));
    const retainedCount = places.filter(place => place.destinationId === destinationId && place.sources.some(source => source.provider === 'scrapling' && retainedIds.has(source.sourceId))).length;
    destinationProviders.push({
      destinationId, provider: 'scrapling', status: successful === sourceRecords.length ? 'ok' : successful || count ? 'partial' : 'unavailable',
      count, retainedCount,
      fetchedAt: sourceRecords.map(source => source.fetchedAt).filter(Boolean).sort().at(-1) || null,
      attemptedAt: sourceRecords.map(source => source.attemptedAt).filter(Boolean).sort().at(-1) || null,
      sourceCount: sourceRecords.length,
    });
  }
  const generatedAt = [previousScraping?.generatedAt, batch.generatedAt].filter(Boolean).sort().at(-1);
  return { places, scraping: { schemaVersion: 1, provider: 'scrapling', generatedAt, attemptedAt: generatedAt, sources }, destinationProviders };
}
