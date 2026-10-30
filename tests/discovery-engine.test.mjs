import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergePlaces, rankPlace, attachEvidence } from '../server/discovery/rank.mjs';
import { createDiscoveryStore } from '../server/discovery/store.mjs';
import { createDiscoveryEngine } from '../server/discovery/engine.mjs';

const place = (overrides = {}) => ({ id: 'a', name: 'Quiet Cove', destinationId: 'gokarna', city: 'Gokarna', category: 'Beaches', coordinates: { lat: 14.5, lng: 74.3 }, tags: [], sources: [{ publisher: 'Wikivoyage', kind: 'guide', url: 'https://en.wikivoyage.org/wiki/Gokarna', excerpt: 'A secluded cove reached by a walking trail.' }], ...overrides });

test('merges corroborating names and nearby coordinates without combining distant or cross-city places', () => {
  const result = mergePlaces([place(), place({ id: 'b', sources: [{ publisher: 'OpenStreetMap', kind: 'map', url: 'https://www.openstreetmap.org/node/1' }] }), place({ id: 'c', destinationId: 'varkala' }), place({ id: 'd', coordinates: { lat: 15, lng: 75 } })]);
  assert.equal(result.length, 3);
  assert.equal(result[0].sources.length, 2);
});

test('ranking explains uncertainty and never manufactures review stars from sparse coverage', () => {
  const ranked = rankPlace(place());
  assert.equal(ranked.reviewSummary.rating, null);
  assert.equal(ranked.reviewSummary.count, 0);
  assert.equal(ranked.discovery.confidence, 'low');
  assert.equal(ranked.discovery.evidenceUrl, 'https://en.wikivoyage.org/wiki/Gokarna');
  const noGuide = rankPlace(place({ sources: [{ kind: 'map', publisher: 'OSM', excerpt: '' }] }));
  assert.equal(noGuide.discovery.label, 'Worth investigating');
  assert.ok(noGuide.discovery.score < ranked.discovery.score);
});

test('evidence attaches by place name instead of distributing city opinions to every place', () => {
  const items = [{ title: 'Quiet Cove visit', text: 'A walking trip.', url: 'https://example.org/a' }];
  const matched = attachEvidence([place(), place({ id: 'other', name: 'Unrelated Temple' })], items);
  assert.equal(matched[0].evidence.length, 1);
  assert.equal(matched[1].evidence.length, 0);
});

test('atomic store preserves concurrent writes and old collection dates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'finder-store-'));
  try {
    const store = createDiscoveryStore(path.join(directory, 'index.json'));
    await Promise.all([store.put('gokarna', { fetchedAt: '2026-01-01', places: [place()] }), store.put('hampi', { fetchedAt: '2026-01-02', places: [] })]);
    assert.equal((await store.get('gokarna')).fetchedAt, '2026-01-01');
    assert.equal((await store.read()).destinations.hampi.fetchedAt, '2026-01-02');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const OLD = '2026-10-01T10:00:00.000Z';
const CURRENT = '2026-10-30T10:00:00.000Z';
const guideUrl = 'https://en.wikivoyage.org/wiki/Gokarna';
const guide = (overrides = {}) => ({ publisher: 'Wikivoyage', kind: 'guide', url: `${guideUrl}#Quiet_Cove`, retrievedAt: OLD, excerpt: 'A quiet beach.', ...overrides });
const mapSource = (overrides = {}) => ({ publisher: 'OpenStreetMap', kind: 'map', url: 'https://www.openstreetmap.org/node/12', retrievedAt: OLD, excerpt: 'Beach mapped on OpenStreetMap.', ...overrides });
const response = (places = [], overrides = {}) => ({ places, warnings: [], status: 'ok', fetchedAt: CURRENT, ...overrides });

function memoryStore(previous) {
  const values = new Map(previous ? [['gokarna', previous]] : []);
  const writes = [];
  return { get: async id => values.get(id) || null, put: async (id, value) => { values.set(id, value); writes.push(value); }, writes };
}

function oldCollection(places = [place({ sources: [guide(), mapSource()] })]) {
  return { destination: { id: 'gokarna' }, places, warnings: [], fetchedAt: OLD, providers: [{ provider: 'wikivoyage', status: 'ok', fetchedAt: OLD }, { provider: 'osm', status: 'ok', fetchedAt: OLD }], stale: false };
}

const makeEngine = options => createDiscoveryEngine({ store: memoryStore(), env: {}, now: () => Date.parse(CURRENT), wikiProvider: async () => response(), osmProvider: async () => response(), ...options });

test('fulfilled unavailable provider responses never masquerade as valid empty collections', async () => {
  const store = memoryStore();
  const engine = makeEngine({ store, wikiProvider: async () => response([], { status: 'unavailable', warnings: ['HTTP 429; guide unavailable.'] }), osmProvider: async () => { throw new Error('private upstream error'); } });
  await assert.rejects(engine.discover('#hiddenplacegokarna'), error => {
    assert.equal(error.code, 'DISCOVERY_UNAVAILABLE');
    assert.equal(error.status, 502);
    assert.equal(error.message.includes('private'), false);
    return true;
  });
  assert.equal(store.writes.length, 0);
});

test('partial refresh keeps failed-provider sources with original dates and replaces successful-provider sources', async () => {
  const store = memoryStore(oldCollection());
  const freshGuide = guide({ retrievedAt: CURRENT, excerpt: 'Updated guide description.' });
  const engine = makeEngine({ store, wikiProvider: async () => response([place({ sources: [freshGuide] })]), osmProvider: async () => { throw Object.assign(new Error('TLS failure'), { code: 'OSM_UNAVAILABLE' }); } });
  const result = await engine.discover('#hiddenplacegokarna');
  assert.equal(result.destination.id, 'gokarna');
  assert.equal(result.places.length, 1);
  assert.equal(result.stale, true);
  assert.equal(result.fetchedAt, CURRENT);
  assert.equal(result.places[0].sources.find(source => source.publisher === 'OpenStreetMap').retrievedAt, OLD);
  assert.equal(result.places[0].sources.find(source => source.publisher === 'Wikivoyage').retrievedAt, CURRENT);
  assert.equal(result.providers[1].status, 'unavailable');
  assert.equal(result.providers[1].retainedCount, 1);
  assert.equal(result.providers[1].fetchedAt, OLD);
  assert.equal(result.providers[1].errorCode, 'OSM_UNAVAILABLE');
  assert.equal(store.writes.length, 1);
  assert.equal(result.places[0].reviewSummary.rating, null);
});

test('successful empty provider results delete its old records while failed sources survive', async () => {
  const store = memoryStore(oldCollection([place({ id: 'wiki-only', name: 'Removed Guide Beach', sources: [guide()] }), place({ id: 'map-only', name: 'Mapped Cove', sources: [mapSource()] })]));
  const engine = makeEngine({ store, wikiProvider: async () => response([]), osmProvider: async () => response([], { status: 'unavailable' }) });
  const result = await engine.discover('Gokarna');
  assert.deepEqual(result.places.map(item => item.name), ['Mapped Cove']);
  assert.equal(result.places[0].sources[0].retrievedAt, OLD);
  assert.equal(result.providers[0].status, 'ok');
});

test('partial guide refresh retains failed districts but removes old entries from successfully fetched empty pages', async () => {
  const districtUrl = `${guideUrl}/Coast`;
  const store = memoryStore(oldCollection([
    place({ name: 'Removed Main Listing', sources: [guide()] }),
    place({ id: 'district', name: 'District Cove', sources: [guide({ url: `${districtUrl}#Beach` })] }),
  ]));
  const engine = makeEngine({ store, wikiProvider: async () => response([], { status: 'partial', refreshedSourceUrls: [guideUrl] }) });
  const result = await engine.discover('Gokarna');
  assert.deepEqual(result.places.map(item => item.name), ['District Cove']);
  assert.equal(result.providers[0].status, 'partial');
  assert.equal(result.stale, true);
  assert.equal(result.places[0].sources[0].retrievedAt, OLD);
});

test('two genuine successful empty reads replace old collection instead of keeping deleted listings forever', async () => {
  const store = memoryStore(oldCollection());
  const result = await makeEngine({ store }).discover('Gokarna');
  assert.deepEqual(result.places, []);
  assert.equal(result.stale, false);
  assert.equal(result.fetchedAt, CURRENT);
  assert.deepEqual(store.writes[0].places, []);
});

test('total outage retains old dates and unavailable statuses without rewriting storage or hammering providers', async () => {
  let calls = 0;
  let timestamp = Date.parse(CURRENT);
  const fail = async () => { calls += 1; throw new Error('upstream failed'); };
  const store = memoryStore(oldCollection());
  const engine = makeEngine({ store, wikiProvider: fail, osmProvider: fail, now: () => timestamp, partialCacheTtlMs: 100 });
  const result = await engine.discover('Gokarna');
  assert.equal(result.fetchedAt, OLD);
  assert.equal(result.attemptedAt, CURRENT);
  assert.equal(result.cached, true);
  assert.equal(result.stale, true);
  assert.ok(result.providers.every(provider => provider.status === 'unavailable'));
  assert.equal(store.writes.length, 0);
  assert.equal((await engine.discover('Gokarna')).stale, true);
  assert.equal(calls, 2);
  timestamp += 101;
  await engine.discover('Gokarna');
  assert.equal(calls, 4);
});

test('partial collection retries sooner than a full collection and injected Overpass configuration reaches provider', async () => {
  let timestamp = Date.parse(CURRENT);
  let calls = 0;
  const engine = makeEngine({
    now: () => timestamp, partialCacheTtlMs: 100, cacheTtlMs: 10000,
    env: { OVERPASS_URL: 'https://maps.example/interpreter', OVERPASS_USER_AGENT: 'Elsewhere/test' },
    wikiProvider: async () => response([place({ sources: [guide()] })]),
    osmProvider: async (_destination, options) => { calls += 1; assert.equal(options.endpoint, 'https://maps.example/interpreter'); assert.equal(options.userAgent, 'Elsewhere/test'); return response([], { status: 'unavailable' }); },
  });
  await engine.discover('Gokarna');
  assert.equal((await engine.discover('Gokarna')).cached, true);
  timestamp += 101;
  await engine.discover('Gokarna');
  assert.equal(calls, 2);
});

test('coalesced collection survives one caller cancelling and limits simultaneous distinct destinations', async () => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const engine = makeEngine({ maxConcurrentDiscoveries: 1, wikiProvider: async () => { calls += 1; await gate; return response([place()]); } });
  const first = engine.discover('Gokarna', { signal: controller.signal });
  const duplicate = engine.discover('#hiddenplacegokarna');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(engine.discover('Hampi'), { code: 'DISCOVERY_BUSY' });
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  release();
  assert.equal((await duplicate).places.length, 1);
  assert.equal(calls, 1);
});

test('a stalled place provider times out without discarding the successful provider', async () => {
  let signal;
  const engine = makeEngine({ discoveryTimeoutMs: 10, wikiProvider: async () => response([place()]), osmProvider: async (_destination, options) => { signal = options.signal; return new Promise(() => {}); } });
  const result = await engine.discover('Gokarna');
  assert.equal(result.places.length, 1);
  assert.equal(result.providers[0].status, 'ok');
  assert.equal(result.providers[1].status, 'unavailable');
  assert.equal(signal.aborted, true);
});

test('evidence keeps successful indexed links when Reddit fails, removes unsafe URLs, and retries failures', async () => {
  let calls = 0;
  const engine = makeEngine({
    env: { DDGS_URL: 'http://localhost:8787/service/' },
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url.href, 'http://localhost:8787/service/search');
      assert.equal(JSON.parse(options.body).freshness, 'month');
      return new Response(JSON.stringify({ items: [{ title: 'Quiet Cove', url: 'https://example.org/cove', isReview: true }, { url: 'javascript:bad()' }, { url: 'https://user:secret@example.org' }] }));
    },
    redditProvider: async () => { throw new Error('secret oauth response'); },
  });
  const result = await engine.evidence('Quiet Cove Gokarna');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].isReview, false);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.providers[1].status, 'unavailable');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  await engine.evidence('Quiet Cove Gokarna');
  assert.equal(calls, 2);
});

test('evidence missing configuration is truthful, memory cache expires, and bodies never enter the place store', async () => {
  let timestamp = Date.parse(CURRENT);
  let calls = 0;
  const store = memoryStore();
  const engine = makeEngine({ store, now: () => timestamp, redditProvider: async () => { calls += 1; return { status: 'ok', warnings: [], items: [{ id: 'comment', type: 'comment', source: 'reddit', text: 'Real comment', url: 'https://www.reddit.com/r/IndiaTravel/comments/abc/_/def/', retrievedAt: CURRENT }] }; } });
  const result = await engine.evidence('Quiet Cove Gokarna');
  assert.equal(result.providers[0].status, 'not_configured');
  assert.equal(result.items[0].type, 'comment');
  assert.equal((await engine.evidence('quiet cove gokarna')).cached, true);
  assert.equal(calls, 1);
  timestamp += 600001;
  assert.equal((await engine.evidence('Quiet Cove Gokarna')).cached, false);
  assert.equal(calls, 2);
  assert.equal(store.writes.length, 0);
});

test('discussion concurrency is bounded and stalled provider work is aborted by a deadline', async () => {
  let signal;
  const engine = makeEngine({ maxConcurrentEvidence: 1, evidenceTimeoutMs: 15, redditProvider: async (_query, options) => { signal = options.signal; return new Promise(() => {}); } });
  const first = engine.evidence('Quiet Cove Gokarna');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(engine.evidence('Hampi Temple'), { code: 'EVIDENCE_BUSY' });
  await assert.rejects(first, { code: 'EVIDENCE_TIMEOUT', status: 504 });
  assert.equal(signal.aborted, true);
});
