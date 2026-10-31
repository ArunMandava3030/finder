import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRefreshBatch, validateRefreshBatch } from '../scripts/select-refresh-batch.mjs';

const catalog = ['a', 'b', 'c', 'd'].map(id => ({ id }));
const registry = { sources: [{ id: 'one' }, { id: 'two' }, { id: 'disabled', enabled: false }] };

test('refresh batches prioritize never attempted destinations, then oldest attempts, and rotate failures', () => {
  const prior = { destinations: [
    { id: 'a', collectionAttemptedAt: '2026-10-31T01:00:00Z' },
    { id: 'b', collectionAttemptedAt: '2026-10-01T01:00:00Z', status: 'unavailable' },
    { id: 'd', collectionAttemptedAt: '2026-10-30T01:00:00Z' },
  ] };
  assert.deepEqual(selectRefreshBatch(catalog, prior, registry, { limit: 2 }).destinationIds, ['c', 'b']);
  prior.destinations.push({ id: 'c', collectionAttemptedAt: '2026-10-31T02:00:00Z' });
  prior.destinations.find(item => item.id === 'b').collectionAttemptedAt = '2026-10-31T02:00:00Z';
  assert.deepEqual(selectRefreshBatch(catalog, prior, registry, { limit: 2 }).destinationIds, ['d', 'a']);
});

test('scraper-only dates cannot defer initial place collection and source refreshes rotate independently', () => {
  const previous = { destinations: [
    { id: 'a', attemptedAt: '2026-10-31T00:00:00Z', providers: [{ provider: 'scrapling', fetchedAt: '2026-10-31T00:00:00Z' }] },
    { id: 'b', attemptedAt: '2026-10-01T00:00:00Z', providers: [{ provider: 'wikivoyage', fetchedAt: '2026-10-01T00:00:00Z' }] },
  ], scraping: { sources: [{ id: 'one', attemptedAt: '2026-10-31T00:00:00Z' }] } };
  const batch = selectRefreshBatch(catalog, previous, registry, { limit: 1, sourceLimit: 1 });
  assert.deepEqual(batch.destinationIds, ['a']);
  assert.deepEqual(batch.sourceIds, ['two']);
  previous.destinations[0].providers.push({ provider: 'wikivoyage', fetchedAt: '2026-09-01T00:00:00Z' });
  assert.deepEqual(selectRefreshBatch(catalog.slice(0, 2), previous, registry, { limit: 1 }).destinationIds, ['a']);
});

test('scheduled batches stay bounded as the catalog grows and reject unknown/duplicate IDs', () => {
  const large = Array.from({ length: 90 }, (_, i) => ({ id: `city-${i}` }));
  const selected = selectRefreshBatch(large, {}, registry);
  assert.equal(selected.destinationIds.length, 20);
  assert.equal(new Set(selected.destinationIds).size, 20);
  assert.deepEqual(validateRefreshBatch(selected, large), selected.destinationIds);
  for (const destinationIds of [['missing'], ['a', 'a'], Array(26).fill('a')]) assert.throws(() => validateRefreshBatch({ schemaVersion: 1, destinationIds }, catalog));
  assert.throws(() => selectRefreshBatch(catalog, {}, registry, { limit: 90 }));
});
