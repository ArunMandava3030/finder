import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadLastIndex, validateIndex, MAX_INDEX_BYTES, PUBLIC_INDEX_URL } from '../scripts/load-last-index.mjs';

const fixture = (generatedAt = '2026-01-02T00:00:00.000Z') => ({
  schemaVersion: 1, generatedAt,
  destinations: [{ id: 'gokarna', city: 'Gokarna', state: 'Karnataka', fetchedAt: '2026-01-01T00:00:00Z' }],
  places: [{ id: 'one', destinationId: 'gokarna', name: 'Coastal walk', city: 'Gokarna', description: 'A sourced route.', sources: [{ url: 'https://en.wikivoyage.org/wiki/Gokarna', retrievedAt: '2026-01-01T00:00:00Z' }], coordinates: { lat: 14.54, lng: 74.32 }, discovery: { score: 50 } }],
  discussions: [],
});
const response = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

async function withTarget(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'finder-index-'));
  const target = path.join(directory, 'india-index.json');
  const previous = JSON.stringify(fixture());
  await writeFile(target, previous);
  try { await callback(target, previous); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('restores a newer validated snapshot from the fixed Pages URL without changing source dates', async () => {
  await withTarget(async (target) => {
    const newer = fixture('2026-01-03T00:00:00Z');
    const result = await loadLastIndex({ target, log: () => {}, fetchImpl: async (url, options) => {
      assert.equal(url, PUBLIC_INDEX_URL);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return response(newer);
    } });
    assert.equal(result.status, 'restored');
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), newer);
  });
});

test('keeps a newer repository snapshot and falls back byte-for-byte on provider failures', async () => {
  await withTarget(async (target, previous) => {
    for (const fetchImpl of [
      async () => response(fixture('2026-01-01T00:00:00Z')),
      async () => { throw new Error('Network unavailable'); },
      async () => new Response('unavailable', { status: 503 }),
      async () => new Response('{invalid json'),
      async () => new Response('{}', { headers: { 'content-length': String(MAX_INDEX_BYTES + 1) } }),
      async () => new Response(new Uint8Array(MAX_INDEX_BYTES + 1)),
    ]) {
      const result = await loadLastIndex({ target, log: () => {}, fetchImpl });
      assert.equal(result.status, 'kept');
      assert.equal(await readFile(target, 'utf8'), previous);
    }
  });
});

test('a later run from an older commit cannot remove a newer crowd-evidence methodology', async () => {
  await withTarget(async target => {
    const current = { ...fixture(), methodology: { version: 2 } };
    current.places[0].crowd = { status: 'quieter', evidence: [] };
    const saved = JSON.stringify(current);
    await writeFile(target, saved);
    const laterOldRun = { ...fixture('2026-01-03T00:00:00Z'), methodology: { version: 1 } };
    const result = await loadLastIndex({ target, log: () => {}, fetchImpl: async () => response(laterOldRun) });
    assert.deepEqual(result, { status: 'kept', reason: 'older_methodology' });
    assert.equal(await readFile(target, 'utf8'), saved);
    const compatible = { ...current, generatedAt: '2026-01-04T00:00:00Z' };
    assert.equal((await loadLastIndex({ target, log: () => {}, fetchImpl: async () => response(compatible) })).status, 'restored');
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), compatible);
  });
});

test('rejects malformed snapshots, unsafe URLs, future dates, and copied social text', () => {
  const invalid = [
    (index) => { index.schemaVersion = 99; },
    (index) => { index.places = []; },
    (index) => { index.generatedAt = 'not a date'; },
    (index) => { index.generatedAt = '2999-01-01T00:00:00Z'; },
    (index) => { index.places[0].sources[0].url = 'javascript:alert(1)'; },
    (index) => { index.places[0].sources[0].url = 'https://user:secret@example.org'; },
    (index) => { index.places[0].sources[0].retrievedAt = 'tomorrow'; },
    (index) => { index.places[0].coordinates.lat = 100; },
    (index) => { index.places[0].destinationId = 'unknown'; },
    (index) => { index.places.push(index.places[0]); },
    (index) => { index.discussions = [{ destinationId: 'gokarna', url: 'https://business.reddit.com/r/travel/comments/abc/', title: 'Traveller discussion on Reddit', source: 'reddit', type: 'indexed_link', isReview: false, publishedAt: null, retrievedAt: '2026-01-01T00:00:00Z' }]; },
    (index) => { index.discussions = [{ destinationId: 'gokarna', url: 'https://www.reddit.com/r/gokarna/', title: 'Traveller discussion on Reddit', source: 'reddit', type: 'indexed_link', isReview: false, publishedAt: null, retrievedAt: '2026-01-01T00:00:00Z' }]; },
    (index) => { index.discussions = [{ destinationId: 'gokarna', url: 'https://www.reddit.com/r/travel/comments/abc/', title: 'Traveller discussion on Reddit', text: 'Copied user text', source: 'reddit', type: 'indexed_link', isReview: false, publishedAt: null, retrievedAt: '2026-01-01T00:00:00Z' }]; },
  ];
  for (const mutate of invalid) {
    const index = fixture();
    mutate(index);
    assert.throws(() => validateIndex(index));
  }
});

test('unsafe remote data preserves the existing file and a missing fallback fails clearly', async () => {
  await withTarget(async (target, previous) => {
    const invalid = fixture('2026-01-04T00:00:00Z');
    invalid.places[0].sources[0].url = 'data:text/html,bad';
    assert.equal((await loadLastIndex({ target, fetchImpl: async () => response(invalid), log: () => {} })).status, 'kept');
    assert.equal(await readFile(target, 'utf8'), previous);
    await rm(target);
    await assert.rejects(loadLastIndex({ target, fetchImpl: async () => { throw new Error('Unavailable'); }, log: () => {} }), /No valid repository or published index/);
  });
});

test('restores manually checked discussion links with known dates without inventing a time', async () => {
  await withTarget(async (target) => {
    const newer = fixture('2026-01-03T00:00:00Z');
    newer.places[0].sources[0].publishedAt = '2025-12-01';
    newer.discussions = [{
      destinationId: 'gokarna', url: 'https://www.reddit.com/r/travel/comments/abc123/gokarna/',
      title: 'Traveller discussion on Reddit', source: 'reddit', type: 'indexed_link', isReview: false,
      collectionMethod: 'manual_search', publishedAt: '2025-12-02', retrievedAt: '2026-01-01T00:00:00Z',
    }];
    assert.equal((await loadLastIndex({ target, fetchImpl: async () => response(newer), log: () => {} })).status, 'restored');
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), newer);
    for (const publishedAt of ['2025-02-29', '2025-13-01', '2999-01-01', 'yesterday']) {
      newer.discussions[0].publishedAt = publishedAt;
      assert.throws(() => validateIndex(newer));
    }
    newer.discussions[0].publishedAt = '2025-12-02T03:00:00Z';
    assert.equal(validateIndex(newer).discussions[0].publishedAt, '2025-12-02T03:00:00Z');
    newer.discussions[0].retrievedAt = '2026-01-01';
    assert.throws(() => validateIndex(newer), 'collection dates still require timestamps');
  });
});
