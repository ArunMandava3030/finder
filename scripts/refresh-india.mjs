import 'dotenv/config';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createDiscoveryEngine } from '../server/discovery/engine.mjs';
import { destinations } from '../server/discovery/destinations.mjs';
import { setTimeout as pause } from 'node:timers/promises';
import { rankPlaces } from '../server/discovery/rank.mjs';
import { retainEarlierDiscussionLinks } from '../server/discovery/discussions.mjs';
import { readScraplingBatch, mergeScraplingBatch } from '../server/providers/scrapling.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const target = option('--output', 'public/data/india-index.json');
const choice = option('--destinations', 'all');
const selected = choice === 'none' ? [] : choice === 'all' ? destinations : choice.split(',').map(id => {
  const destination = destinations.find(item => item.id === id);
  if (!destination) throw new Error(`Unknown destination: ${id}`);
  return destination;
});
let previous = { destinations: [], places: [], discussions: [] };
try { previous = JSON.parse(await readFile(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const scrapedFile = option('--scraped', null);
let scrapedBatch = null;
if (scrapedFile) {
  const registryFile = option('--scraping-registry', new URL('../data/scrapling-sources.json', import.meta.url));
  const registry = JSON.parse(await readFile(registryFile, 'utf8'));
  // Reject malformed input before starting any provider work or changing the output.
  scrapedBatch = await readScraplingBatch(scrapedFile, { registry });
}
const engine = createDiscoveryEngine();
const records = new Map(previous.destinations.map(destination => [destination.id, destination]));
const keyForPlace = place => `${place.destinationId}:${place.id}`;
const placeMap = new Map(previous.places.map(place => [keyForPlace(place), place]));
const startedAt = new Date().toISOString();
let succeeded = 0;

// Actions runners start empty: give the engine the last published source observations
// so it can replace successful sources while retaining unavailable ones accurately.
for (const destination of selected) {
  const prior = records.get(destination.id);
  if (!prior) continue;
  await engine.store.put(destination.id, {
    destination, fetchedAt: prior.fetchedAt, attemptedAt: prior.attemptedAt,
    places: previous.places.filter(place => place.destinationId === destination.id),
    providers: prior.providers || [], warnings: prior.warnings || [],
    cached: true, stale: prior.status === 'stale',
  });
}

// Serial batches respect the shared Overpass service; each batch has at most two provider calls.
for (const destination of selected) {
  if (destination !== selected[0]) await pause(1500);
  console.log(`Collecting ${destination.city}…`);
  try {
    const result = await engine.discover(destination.id, { refresh: true });
    // The engine performs source-level replacement, including legitimate empty responses.
    // Its retained records already carry their original collection timestamps.
    for (const [id, place] of placeMap) if (place.destinationId === destination.id) placeMap.delete(id);
    for (const place of result.places) placeMap.set(keyForPlace(place), place);
    if (result.providers.some(provider => provider.status === 'ok' || provider.status === 'partial')) succeeded += 1;
    records.set(destination.id, { ...records.get(destination.id), ...destination, count: result.places.length, fetchedAt: result.fetchedAt, attemptedAt: result.attemptedAt || startedAt, status: result.stale ? 'stale' : result.providers.every(provider => provider.status === 'ok') ? 'ok' : 'partial', providers: result.providers, warnings: result.warnings });
    console.log(`${destination.city}: ${result.places.length} places; ${result.providers.map(provider => `${provider.provider}=${provider.status}`).join(', ')}`);
  } catch (error) {
    const prior = records.get(destination.id);
    records.set(destination.id, { ...destination, ...prior, attemptedAt: startedAt, status: prior?.count ? 'stale' : 'unavailable', warnings: ['Collection failed; any earlier records retain their original timestamps.'] });
    console.log(`${destination.city}: unavailable (${error.code || 'provider error'})`);
  }
}

let scraping = previous.scraping || null;
if (scrapedBatch) {
  const merged = mergeScraplingBatch([...placeMap.values()], scrapedBatch, { previousScraping: scraping });
  placeMap.clear();
  for (const place of merged.places) placeMap.set(keyForPlace(place), place);
  scraping = merged.scraping;
  for (const { destinationId, ...provider } of merged.destinationProviders) {
    const destination = destinations.find(item => item.id === destinationId);
    if (!destination) continue;
    const previousRecord = records.get(destinationId);
    const providers = [...(previousRecord?.providers || []).filter(item => item.provider !== 'scrapling'), provider];
    const count = merged.places.filter(place => place.destinationId === destinationId).length;
    const freshSources = scrapedBatch.sources.filter(source => source.destinationId === destinationId && source.status === 'ok');
    const fetchedAt = [...freshSources.map(source => source.fetchedAt), previousRecord?.fetchedAt].filter(Boolean).sort().at(-1) || null;
    const attemptedAt = [provider.attemptedAt, previousRecord?.attemptedAt].filter(Boolean).sort().at(-1) || null;
    const allOk = providers.every(item => item.status === 'ok');
    const hasRetained = providers.some(item => item.retainedCount > 0);
    const previousScrapingWarnings = new Set((previous.scraping?.sources || []).filter(source => source.destinationId === destinationId).flatMap(source => source.warnings || []));
    records.set(destinationId, {
      ...previousRecord, ...destination, count, fetchedAt, attemptedAt, providers,
      status: count ? hasRetained ? 'stale' : allOk ? 'ok' : 'partial' : allOk ? 'ok' : 'unavailable',
      warnings: [...new Set([...(previousRecord?.warnings || []).filter(warning => !previousScrapingWarnings.has(warning)), ...scraping.sources.filter(source => source.destinationId === destinationId).flatMap(source => source.warnings || [])])],
    });
  }
}

const evidenceFile = option('--evidence', null);
let discussions = previous.discussions || [];
if (evidenceFile) {
  const batch = JSON.parse(await readFile(evidenceFile, 'utf8'));
  if (batch.validationVersion !== 2 || batch.relevanceChecked !== true) throw new Error('Discussion batch must pass the current relevance checks.');
  discussions = [...discussions];
  for (const result of batch.results || []) {
    if (!destinations.some(destination => destination.id === result.id)) continue;
    const record = records.get(result.id);
    if (record) record.discussionStatus = { status: result.status, fetchedAt: batch.generatedAt, warnings: result.warnings || [] };
    // An unavailable search must not erase the last useful links or make them look newly collected.
    if (result.status === 'error' || result.status === 'empty') {
      discussions = retainEarlierDiscussionLinks(discussions, result.id);
      continue;
    }
    discussions = discussions.filter(item => item.destinationId !== result.id);
    for (const item of result.items || []) {
      let url;
      try { url = new URL(item.url); } catch { continue; }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      // Static publication contains source links, not copied social posts, authors, comments or ratings.
      const reddit = url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com');
      if (reddit && !/^\/r\/[^/]+\/comments\/[^/]+(?:\/|$)/i.test(url.pathname)) continue;
      discussions.push({ id: `${result.id}:${discussions.length}`, destinationId: result.id, url: url.href, title: reddit ? 'Traveller discussion on Reddit' : String(item.title || 'Travel source').slice(0, 180), source: reddit ? 'reddit' : 'web', type: 'indexed_link', publishedAt: item.publishedAt || null, retrievedAt: item.retrievedAt || batch.generatedAt, isReview: false });
    }
  }
}
// Old search links stay useful but are explicitly stale. No review text is retained here.
const places = rankPlaces([...placeMap.values()]);
for (const record of records.values()) record.count = places.filter(place => place.destinationId === record.id).length;
if (!places.length) throw new Error('No place data collected. Refusing to publish an empty replacement index.');
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  destinations: destinations.map(destination => records.get(destination.id) || { ...destination, count: 0, status: 'not_collected', fetchedAt: null, warnings: [] }),
  places,
  ...(scraping ? { scraping } : {}),
  discussions: [...new Map(discussions.map(item => [`${item.destinationId}:${item.url}`, item])).values()],
  stats: { places: places.length, destinationsWithData: new Set(places.map(place => place.destinationId)).size, refreshedThisRun: succeeded, indexedDiscussions: discussions.length, scrapedPlaces: places.filter(place => place.sources.some(source => source.provider === 'scrapling')).length },
  methodology: { version: 1, scoreLabel: 'Discovery fit', explanation: 'A rule-based estimate using source descriptions, mapped location, category and independent source corroboration. Missing ratings or low web coverage do not prove a place is hidden or underrated.', reviews: 'No verified visitor ratings are available. Community guide descriptions and indexed discussion links are distinct from reviews.', freshness: 'Periodically refreshed observations, not real-time reviews. Check each source date and the original page.' },
  attribution: [
    { name: 'OpenStreetMap contributors', license: 'ODbL', url: 'https://www.openstreetmap.org/copyright' },
    { name: 'Wikivoyage contributors', license: 'CC BY-SA 4.0', url: 'https://en.wikivoyage.org/wiki/Wikivoyage:Copyleft' },
    ...[...new Map((scraping?.sources || []).map(source => [source.publisher, { name: source.publisher, license: 'Factual metadata; see source terms', url: source.url }])).values()],
  ],
};
await mkdir(path.dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(output), 'utf8');
await rename(temporary, target);
console.log(JSON.stringify(output.stats));
