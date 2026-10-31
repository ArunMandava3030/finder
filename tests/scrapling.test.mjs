import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeScraplingBatch, mergeScraplingBatch, readScraplingBatch } from '../server/providers/scrapling.mjs';
import { createDiscoveryEngine } from '../server/discovery/engine.mjs';
import { rankPlaces } from '../server/discovery/rank.mjs';

const exec = promisify(execFile);
const OLD = '2026-10-01T00:00:00.000Z';
const CURRENT = '2026-10-30T00:00:00.000Z';
const destination = { id: 'gokarna', city: 'Gokarna', state: 'Karnataka', bbox: [14.3, 74.15, 14.85, 74.7] };
const registry = { schemaVersion: 1, sources: [
  { id: 'tourism-gokarna', destinationId: 'gokarna', url: 'https://tourism.example.org/gokarna/', publisher: 'Regional Tourism', parser: 'listing', maxPlaces: 5 },
  { id: 'district-gokarna', destinationId: 'gokarna', url: 'https://district.example.org/tourism/', publisher: 'District Tourism', parser: 'listing', maxPlaces: 5 },
] };

function scrapedPlace(name = 'Quiet Cove', sourceId = 'tourism-gokarna', overrides = {}) {
  const entry = registry.sources.find(source => source.id === sourceId);
  const url = new URL(`place/${name.toLowerCase().replace(/ /g, '-')}/`, entry.url).href;
  return {
    id: `scrapling:${sourceId}:untrusted`, name, destinationId: destination.id, city: destination.city, state: destination.state,
    country: 'India', category: 'Beaches', coordinates: { lat: 14.52, lng: 74.31 }, description: 'A named coastal attraction listed by the tourism office.', tags: [], image: null,
    sources: [{ url, title: name, publisher: entry.publisher, kind: 'guide', provider: 'scrapling', retrievedAt: CURRENT, excerpt: 'A coastal attraction.', license: 'Untrusted license claim' }],
    ...overrides,
  };
}

function batchSource(sourceId = 'tourism-gokarna', overrides = {}) {
  const { id, destinationId, url, publisher } = registry.sources.find(source => source.id === sourceId);
  return { id, destinationId, url, publisher, status: 'ok', fetchedAt: CURRENT, attemptedAt: CURRENT, places: [scrapedPlace('Quiet Cove', sourceId)], warnings: [], ...overrides };
}

const batch = (sources = [batchSource()], overrides = {}) => ({ schemaVersion: 1, provider: 'scrapling', generatedAt: CURRENT, sources, ...overrides });
const normalize = value => normalizeScraplingBatch(value, { registry, destinations: [destination], now: () => Date.parse(CURRENT) });
const earlier = (sources = [batchSource()]) => mergeScraplingBatch([], normalize(batch(sources.map(source => ({ ...source, fetchedAt: OLD, attemptedAt: OLD })), { generatedAt: OLD })));
const wikiPlace = () => ({ id: 'wv-cove', name: 'Quiet Cove', destinationId: 'gokarna', city: 'Gokarna', state: 'Karnataka', country: 'India', category: 'Beaches', coordinates: { lat: 14.52, lng: 74.31 }, description: 'A guide-listed coastal walk.', tags: [], sources: [{ url: 'https://en.wikivoyage.org/wiki/Gokarna#Quiet_Cove', kind: 'guide', publisher: 'Wikivoyage', excerpt: 'A guide-listed coastal walk.', retrievedAt: OLD, license: 'CC BY-SA 4.0' }] });

test('normalizes factual metadata against the registry without publishing ratings, authors, comments or copied review fields', () => {
  const input = scrapedPlace('<b>Quiet Cove</b>', 'tourism-gokarna', {
    rating: 5, reviewSummary: { count: 999, rating: 5 }, reviews: ['PRIVATE REVIEW'], comments: ['PRIVATE COMMENT'], author: 'PRIVATE AUTHOR', evidence: ['PRIVATE EVIDENCE'], image: 'https://social.example.org/private-photo',
    description: 'PRIVATE COPIED DESCRIPTION',
  });
  input.sources[0].excerpt = 'PRIVATE COPIED EXCERPT';
  input.sources[0].catalogUrl = registry.sources[0].url;
  const value = normalize(batch([batchSource('tourism-gokarna', { places: [input] })]));
  const place = value.sources[0].places[0];
  assert.match(place.id, /^scrapling:tourism-gokarna:[a-f0-9]{16}$/);
  assert.equal(place.name, 'Quiet Cove');
  assert.equal(place.image, null);
  assert.equal(place.sources[0].provider, 'scrapling');
  assert.equal(place.sources[0].sourceId, 'tourism-gokarna');
  assert.equal(place.sources[0].collectionMethod, 'scrapling');
  assert.equal(place.sources[0].license, 'Factual metadata; see source terms');
  assert.equal(place.sources[0].publishedAt, null);
  assert.equal(place.sources[0].updatedAt, null);
  assert.equal(place.sources[0].retrievedAt, CURRENT);
  assert.equal(place.sources[0].catalogUrl, registry.sources[0].url);
  assert.equal(place.sources[0].excerpt, '');
  assert.equal(place.description, 'Listed by Regional Tourism. Open the original source for place details and current visitor information.');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|Untrusted license|"rating"|"reviews"|"author"/);
});

test('rejects unknown or mismatched batch sources, unsafe URLs, duplicate sources, future timestamps and record overflow', () => {
  const badSources = [
    batchSource('tourism-gokarna', { id: 'unknown' }),
    batchSource('tourism-gokarna', { destinationId: 'hampi' }),
    batchSource('tourism-gokarna', { publisher: 'A fake publisher' }),
    batchSource('tourism-gokarna', { url: 'https://user:password@tourism.example.org/gokarna/' }),
    batchSource('tourism-gokarna', { fetchedAt: '2999-01-01T00:00:00Z' }),
    batchSource('tourism-gokarna', { places: Array.from({ length: 6 }, () => scrapedPlace()) }),
  ];
  for (const source of badSources) assert.throws(() => normalize(batch([source])), { code: 'INVALID_SCRAPLING_BATCH' });
  assert.throws(() => normalize(batch([batchSource(), batchSource()])), { code: 'INVALID_SCRAPLING_BATCH' });
  assert.throws(() => normalize(batch([], { provider: 'other' })), { code: 'INVALID_SCRAPLING_BATCH' });
  for (const url of ['http://tourism.example.org/', 'https://127.0.0.1/', 'https://www.reddit.com/r/travel/', 'javascript:alert(1)']) {
    const unsafeRegistry = { schemaVersion: 1, sources: [{ ...registry.sources[0], url }] };
    assert.throws(() => normalizeScraplingBatch(batch([]), { registry: unsafeRegistry }), { code: 'INVALID_SCRAPLING_BATCH' });
  }
});

test('out-of-area, cross-origin, social and review records downgrade the source without replacing previous observations', () => {
  const prior = earlier();
  const cases = [
    scrapedPlace('Quiet Cove', 'tourism-gokarna', { coordinates: { lat: 28, lng: 77 } }),
    scrapedPlace('Quiet Cove', 'tourism-gokarna', { destinationId: 'hampi' }),
    scrapedPlace('Quiet Cove', 'tourism-gokarna', { isReview: true }),
    scrapedPlace('Quiet Cove', 'tourism-gokarna', { sources: [{ ...scrapedPlace().sources[0], url: 'https://www.reddit.com/r/travel/comments/abc/' }] }),
    scrapedPlace('Quiet Cove', 'tourism-gokarna', { sources: [{ ...scrapedPlace().sources[0], url: 'https://another.example.org/place/' }] }),
    scrapedPlace('Quiet Cove', 'tourism-gokarna', { sources: [{ ...scrapedPlace().sources[0], url: 'javascript:alert(1)' }] }),
  ];
  for (const input of cases) {
    const normalized = normalize(batch([batchSource('tourism-gokarna', { places: [input] })]));
    assert.equal(normalized.sources[0].status, 'unavailable');
    const result = mergeScraplingBatch(prior.places, normalized, { previousScraping: prior.scraping });
    assert.equal(result.places[0].sources[0].retrievedAt, OLD);
    assert.equal(result.scraping.sources[0].fetchedAt, OLD);
  }
});

test('narrow registry name and path restrictions are enforced again during ingestion', () => {
  const scoped = { schemaVersion: 1, sources: [{ ...registry.sources[0], scope: 'selected_places', allowedNames: ['Quiet Cove'], allowedPaths: ['/gokarna/place/quiet-cove/'] }] };
  const options = { registry: scoped, destinations: [destination], now: () => Date.parse(CURRENT) };
  assert.equal(normalizeScraplingBatch(batch(), options).sources[0].status, 'ok');
  assert.equal(normalizeScraplingBatch(batch([batchSource('tourism-gokarna', { places: [scrapedPlace('Another Cove')] })]), options).sources[0].status, 'unavailable');
  const wrongPath = scrapedPlace();
  wrongPath.sources[0].url = 'https://tourism.example.org/unapproved/';
  assert.equal(normalizeScraplingBatch(batch([batchSource('tourism-gokarna', { places: [wrongPath] })]), options).sources[0].status, 'unavailable');
});

test('successful refresh replaces only the attempted scraper source and retains blocked-source dates and other providers', () => {
  const prior = earlier([batchSource(), batchSource('district-gokarna', { places: [scrapedPlace('Forest Trail', 'district-gokarna')] })]);
  const value = normalize(batch([
    batchSource('tourism-gokarna', { places: [scrapedPlace('New Coastal Park')] }),
    batchSource('district-gokarna', { status: 'blocked', places: [], warnings: ['The source denied access.'] }),
  ]));
  const result = mergeScraplingBatch([...prior.places, wikiPlace()], value, { previousScraping: prior.scraping });
  assert.deepEqual(result.places.map(place => place.name).sort(), ['Forest Trail', 'New Coastal Park', 'Quiet Cove']);
  const wiki = result.places.find(place => place.name === 'Quiet Cove');
  assert.equal(wiki.sources.length, 1);
  assert.equal(wiki.sources[0].publisher, 'Wikivoyage');
  const forest = result.places.find(place => place.name === 'Forest Trail');
  assert.equal(forest.sources[0].retrievedAt, OLD);
  const blocked = result.scraping.sources.find(source => source.id === 'district-gokarna');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.fetchedAt, OLD);
  assert.equal(blocked.attemptedAt, CURRENT);
  assert.equal(blocked.retainedCount, 1);
  assert.equal(result.destinationProviders[0].status, 'partial');
  assert.equal(result.destinationProviders[0].count, 2);
});

test('empty extraction, unavailable and blocked runs retain old observations and never manufacture new collection dates', () => {
  const prior = earlier();
  for (const status of ['empty', 'unavailable', 'blocked', 'ok']) {
    const normalized = normalize(batch([batchSource('tourism-gokarna', { status, places: [] })]));
    const result = mergeScraplingBatch(prior.places, normalized, { previousScraping: prior.scraping });
    assert.equal(result.places.length, 1);
    assert.equal(result.places[0].sources[0].retrievedAt, OLD);
    assert.equal(result.scraping.sources[0].fetchedAt, OLD);
    assert.equal(result.scraping.sources[0].attemptedAt, CURRENT);
    assert.equal(result.scraping.sources[0].status, status === 'ok' ? 'empty' : status);
    assert.equal(result.destinationProviders[0].retainedCount, 1);
  }
});

test('accepts Python collector failures with null fetchedAt and a distinct attemptedAt, preserving the last successful date', () => {
  const prior = earlier();
  for (const status of ['blocked', 'unavailable']) {
    // This is the shape emitted by search-service/scrape_places.py for robots, HTTP and transport failures.
    const failed = batchSource('tourism-gokarna', { status, fetchedAt: null, attemptedAt: CURRENT, places: [], warnings: ['Collection or extraction could not complete. No replacement records were emitted.'] });
    const normalized = normalize(batch([failed]));
    assert.equal(normalized.sources[0].fetchedAt, null);
    assert.equal(normalized.sources[0].attemptedAt, CURRENT);
    const retained = mergeScraplingBatch(prior.places, normalized, { previousScraping: prior.scraping });
    assert.equal(retained.scraping.sources[0].status, status);
    assert.equal(retained.scraping.sources[0].fetchedAt, OLD);
    assert.equal(retained.scraping.sources[0].attemptedAt, CURRENT);
    assert.equal(retained.places[0].sources[0].retrievedAt, OLD);
    const firstAttempt = mergeScraplingBatch([], normalized);
    assert.equal(firstAttempt.scraping.sources[0].fetchedAt, null);
    assert.equal(firstAttempt.scraping.sources[0].attemptedAt, CURRENT);
    assert.equal(firstAttempt.destinationProviders[0].status, 'unavailable');
    assert.throws(() => normalize(batch([{ ...failed, attemptedAt: null }])), { code: 'INVALID_SCRAPLING_BATCH' });
    assert.throws(() => normalize(batch([{ ...failed, attemptedAt: 'not a date' }])), { code: 'INVALID_SCRAPLING_BATCH' });
  }
});

test('catalog provenance must match the registered listing page', () => {
  const record = scrapedPlace();
  record.sources[0].catalogUrl = 'https://tourism.example.org/unapproved-catalog/';
  assert.equal(normalize(batch([batchSource('tourism-gokarna', { places: [record] })])).sources[0].status, 'unavailable');
});

test('deduplicates corroborated places, counts retained places once, and preserves sources omitted from a batch', () => {
  const initial = earlier([batchSource(), batchSource('district-gokarna')]);
  assert.equal(initial.places.length, 1);
  assert.equal(initial.places[0].sources.length, 2);
  const failed = normalize(batch([batchSource('tourism-gokarna', { status: 'blocked', places: [] }), batchSource('district-gokarna', { status: 'unavailable', places: [] })]));
  const result = mergeScraplingBatch(initial.places, failed, { previousScraping: initial.scraping });
  assert.equal(result.destinationProviders[0].count, 1);
  assert.equal(result.destinationProviders[0].retainedCount, 1);
  assert.equal(result.places[0].reviewSummary.rating, null);
  assert.equal(result.places[0].reviewSummary.count, 0);
  const omitted = mergeScraplingBatch(initial.places, normalize(batch([])), { previousScraping: initial.scraping });
  assert.deepEqual(omitted.places, initial.places);
  assert.equal(omitted.scraping.sources.length, 2);
});

test('a generic scraper listing notice never replaces a real guide description in either merge order', () => {
  const scraped = normalize(batch()).sources[0].places[0];
  const guide = wikiPlace();
  assert.ok(scraped.description.length > guide.description.length);
  for (const input of [[guide, scraped], [scraped, guide]]) {
    const merged = rankPlaces(input);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].description, guide.description);
    assert.equal(merged[0].sources.length, 2);
    assert.equal(rankPlaces(merged)[0].description, guide.description);
  }
  const oldMerged = { ...guide, description: scraped.description, sources: [...guide.sources, ...scraped.sources] };
  assert.equal(rankPlaces([oldMerged])[0].description, guide.sources[0].excerpt);
});

test('an older scraper batch cannot replace newer source observations or regress source status', () => {
  const newer = mergeScraplingBatch([], normalize(batch()));
  const older = normalize(batch([batchSource('tourism-gokarna', { fetchedAt: OLD, attemptedAt: OLD, places: [scrapedPlace('Outdated Name')] })], { generatedAt: OLD }));
  const result = mergeScraplingBatch(newer.places, older, { previousScraping: newer.scraping });
  assert.deepEqual(result.places, newer.places);
  assert.equal(result.scraping.generatedAt, CURRENT);
  assert.equal(result.scraping.sources[0].fetchedAt, CURRENT);
});

test('ordinary API refreshes preserve Scrapling provenance, dates and provider status even when Wiki and OSM return valid empty', async () => {
  const prior = earlier();
  const provider = prior.destinationProviders[0];
  let previous = { destination, fetchedAt: OLD, places: [...prior.places, wikiPlace()], providers: [{ provider: 'wikivoyage', status: 'ok', fetchedAt: OLD }, { provider: 'osm', status: 'ok', fetchedAt: OLD }, provider], warnings: [] };
  const store = { get: async () => previous, put: async (_id, value) => { previous = value; } };
  const empty = async () => ({ places: [], warnings: [], status: 'ok', fetchedAt: CURRENT });
  const engine = createDiscoveryEngine({ store, wikiProvider: empty, osmProvider: empty, now: () => Date.parse(CURRENT), env: {} });
  const result = await engine.discover('Gokarna', { refresh: true });
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0].sources.length, 1);
  assert.equal(result.places[0].sources[0].provider, 'scrapling');
  assert.equal(result.places[0].sources[0].retrievedAt, OLD);
  assert.match(result.places[0].description, /^Listed by Regional Tourism\./);
  assert.deepEqual(result.providers.find(item => item.provider === 'scrapling'), provider);
  assert.equal(result.stale, false);
});

test('a total API outage still returns scraper-only prior places with their old dates', async () => {
  const prior = earlier();
  const previous = { destination, fetchedAt: OLD, places: prior.places, providers: prior.destinationProviders, warnings: [] };
  const engine = createDiscoveryEngine({ store: { get: async () => previous, put: async () => assert.fail('failed APIs must not persist a new collection') }, wikiProvider: async () => ({ places: [], status: 'unavailable', warnings: [] }), osmProvider: async () => { throw new Error('unavailable'); }, now: () => Date.parse(CURRENT), env: {} });
  const result = await engine.discover('Gokarna', { refresh: true });
  assert.equal(result.places.length, 1);
  assert.equal(result.fetchedAt, OLD);
  assert.equal(result.places[0].sources[0].retrievedAt, OLD);
  assert.equal(result.stale, true);
});

test('offline --scraped integration publishes merged coverage and leaves the old file untouched for malformed batches', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'finder-scrapling-'));
  try {
    const target = path.join(directory, 'index.json');
    const batchFile = path.join(directory, 'batch.json');
    const registryFile = path.join(directory, 'registry.json');
    await writeFile(target, JSON.stringify({ schemaVersion: 1, generatedAt: OLD, destinations: [{ ...destination, fetchedAt: OLD, count: 1, providers: [{ provider: 'wikivoyage', status: 'ok', fetchedAt: OLD }] }], places: [wikiPlace()], discussions: [] }));
    await writeFile(batchFile, JSON.stringify(batch()));
    await writeFile(registryFile, JSON.stringify(registry));
    const args = ['scripts/refresh-india.mjs', '--destinations', 'none', '--output', target, '--scraped', batchFile, '--scraping-registry', registryFile];
    await exec(process.execPath, args, { timeout: 10_000 });
    const output = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(output.places.length, 1);
    assert.equal(output.places[0].sources.length, 2);
    assert.equal(output.destinations.find(item => item.id === 'gokarna').count, 1);
    assert.equal(output.destinations.find(item => item.id === 'gokarna').providers.find(item => item.provider === 'scrapling').count, 1);
    assert.equal(output.scraping.sources[0].status, 'ok');
    assert.equal(output.stats.scrapedPlaces, 1);
    assert.ok(output.attribution.some(item => item.name === 'Regional Tourism' && item.license === 'Factual metadata; see source terms'));
    await writeFile(batchFile, JSON.stringify(batch([batchSource('tourism-gokarna', { status: 'blocked', fetchedAt: null, attemptedAt: CURRENT, places: [] })])));
    await exec(process.execPath, args, { timeout: 10_000 });
    const failedOutput = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(failedOutput.scraping.sources[0].status, 'blocked');
    assert.equal(failedOutput.scraping.sources[0].fetchedAt, CURRENT);
    assert.equal(failedOutput.scraping.sources[0].attemptedAt, CURRENT);
    assert.equal(failedOutput.places[0].sources.find(source => source.provider === 'scrapling').retrievedAt, CURRENT);
    const original = await readFile(target, 'utf8');
    await writeFile(batchFile, JSON.stringify(batch([], { schemaVersion: 999 })));
    await assert.rejects(exec(process.execPath, args, { timeout: 10_000 }));
    assert.equal(await readFile(target, 'utf8'), original);
    await writeFile(batchFile, '{invalid json');
    await assert.rejects(readScraplingBatch(batchFile, { registry }), { code: 'INVALID_SCRAPLING_BATCH' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
