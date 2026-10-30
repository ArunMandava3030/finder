import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLIC_INDEX_URL = 'https://arunmandava3030.github.io/finder/data/india-index.json';
export const MAX_INDEX_BYTES = 12 * 1024 * 1024;
const DEFAULT_TARGET = fileURLToPath(new URL('../public/data/india-index.json', import.meta.url));
const redditHosts = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'm.reddit.com']);
const requireValid = (condition) => { if (!condition) throw new Error('Invalid published index.'); };
const shortText = (value, max = 1000) => typeof value === 'string' && value.length > 0 && value.length <= max;
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300_000;
const optionalDate = (value) => value == null || validDate(value);
const optionalPublicationDate = (value) => {
  if (optionalDate(value)) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && parsed.getTime() <= Date.now();
};
const validUrl = (value) => {
  if (!shortText(value, 4000)) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
};

export function validateIndex(index) {
  requireValid(index && index.schemaVersion === 1 && validDate(index.generatedAt));
  requireValid(Array.isArray(index.destinations) && index.destinations.length > 0 && index.destinations.length <= 200);
  requireValid(Array.isArray(index.places) && index.places.length > 0 && index.places.length <= 10_000);
  requireValid(Array.isArray(index.discussions) && index.discussions.length <= 2000);
  const destinationIds = new Set();
  for (const destination of index.destinations) {
    requireValid(destination && shortText(destination.id, 100) && !destinationIds.has(destination.id));
    requireValid(shortText(destination.city, 200) && shortText(destination.state, 200));
    requireValid(optionalDate(destination.fetchedAt) && optionalDate(destination.attemptedAt));
    if (destination.discussionStatus) requireValid(optionalDate(destination.discussionStatus.fetchedAt));
    if (destination.providers) {
      requireValid(Array.isArray(destination.providers) && destination.providers.length <= 10);
      for (const provider of destination.providers) requireValid(provider && optionalDate(provider.fetchedAt));
    }
    destinationIds.add(destination.id);
  }
  const placeIds = new Set();
  for (const place of index.places) {
    requireValid(place && shortText(place.id, 250) && destinationIds.has(place.destinationId));
    const key = `${place.destinationId}:${place.id}`;
    requireValid(!placeIds.has(key));
    placeIds.add(key);
    requireValid(shortText(place.name, 500) && shortText(place.city, 200) && optionalDate(place.updatedAt));
    requireValid(typeof place.description === 'string' && place.description.length <= 20_000);
    requireValid(Array.isArray(place.sources) && place.sources.length > 0 && place.sources.length <= 30);
    for (const source of place.sources) {
      requireValid(source && validUrl(source.url));
      requireValid(optionalDate(source.retrievedAt) && optionalPublicationDate(source.publishedAt) && optionalDate(source.updatedAt) && optionalDate(source.listingUpdatedAt));
      if (source.licenseUrl) requireValid(validUrl(source.licenseUrl));
    }
    if (place.image) requireValid(typeof place.image === 'string' ? validUrl(place.image) : validUrl(place.image.url));
    if (place.coordinates) {
      requireValid(Number.isFinite(place.coordinates.lat) && Math.abs(place.coordinates.lat) <= 90);
      requireValid(Number.isFinite(place.coordinates.lng) && Math.abs(place.coordinates.lng) <= 180);
    }
    if (place.discovery) {
      requireValid(Number.isFinite(place.discovery.score) && place.discovery.score >= 0 && place.discovery.score <= 100);
      if (place.discovery.evidenceUrl) requireValid(validUrl(place.discovery.evidenceUrl));
    }
  }
  for (const discussion of index.discussions) {
    requireValid(discussion && destinationIds.has(discussion.destinationId) && validUrl(discussion.url));
    requireValid(discussion.type === 'indexed_link' && discussion.isReview === false);
    requireValid(validDate(discussion.retrievedAt) && optionalPublicationDate(discussion.publishedAt));
    requireValid(shortText(discussion.title, 180) && !discussion.text && !discussion.excerpt && !discussion.body);
    const url = new URL(discussion.url);
    if (discussion.source === 'reddit' || url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com')) {
      requireValid(redditHosts.has(url.hostname) && /^\/r\/[A-Za-z0-9_]+\/comments\/[A-Za-z0-9]+(?:\/|$)/i.test(url.pathname));
      requireValid(discussion.source === 'reddit' && discussion.title === 'Traveller discussion on Reddit');
    } else requireValid(discussion.source === 'web');
  }
  if (index.attribution) {
    requireValid(Array.isArray(index.attribution) && index.attribution.length <= 30);
    for (const attribution of index.attribution) requireValid(attribution && validUrl(attribution.url));
  }
  return index;
}

async function readBoundedJson(response) {
  if (!response.ok || !response.body) throw new Error('Published index is unavailable.');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_INDEX_BYTES) throw new Error('Published index is too large.');
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INDEX_BYTES) throw new Error('Published index is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function loadLastIndex({ target = DEFAULT_TARGET, fetchImpl = fetch, log = console.log } = {}) {
  let previous;
  try { previous = validateIndex(JSON.parse(await readFile(target, 'utf8'))); } catch { /* The remote snapshot can restore a missing or invalid local index. */ }
  try {
    const response = await fetchImpl(PUBLIC_INDEX_URL, {
      headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12_000),
    });
    const published = validateIndex(await readBoundedJson(response));
    if (previous && Date.parse(previous.generatedAt) >= Date.parse(published.generatedAt)) {
      log('Keeping the repository snapshot; it is at least as recent as the published index.');
      return { status: 'kept', reason: 'not_newer' };
    }
    const temporary = `${target}.restore-${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(published), 'utf8');
    await rename(temporary, target);
    log(`Restored the last published index (${published.places.length} places).`);
    return { status: 'restored', generatedAt: published.generatedAt };
  } catch {
    if (!previous) throw new Error('No valid repository or published index is available.');
    log('Published index could not be restored; keeping the repository snapshot.');
    return { status: 'kept', reason: 'unavailable' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await loadLastIndex();
}
