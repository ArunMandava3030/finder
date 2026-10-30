import test from 'node:test';
import assert from 'node:assert/strict';
import { selectIndexPlaces, destinationsForQuery, validateIndex, safeSourceUrl } from '../src/lib/india-index.js';

const data = { schemaVersion: 1, destinations: [{ id: 'gokarna', city: 'Gokarna', aliases: [] }, { id: 'hampi', city: 'Hampi', aliases: [] }], places: [
  { id: 'a', name: 'Half Moon Beach', destinationId: 'gokarna', category: 'Beaches', sources: [], discovery: { score: 50, label: 'Worth investigating' } },
  { id: 'b', name: 'Stone Temple', destinationId: 'hampi', category: 'Culture', sources: [], discovery: { score: 60, label: 'Offbeat signal found' } },
] };
test('hashtag city matching, place names and offbeat filters do not leak unrelated destinations', () => {
  assert.deepEqual(destinationsForQuery(data.destinations, '#hiddenplacegokarna').map(city => city.id), ['gokarna']);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Half Moon Gokarna' }).map(place => place.id), ['a']);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Hampi', category: 'Beaches' }), []);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Gokarna', offbeatOnly: true }), []);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Unknown city' }), []);
  assert.equal(selectIndexPlaces(data, { query: 'India' }).length, 2);
  assert.equal(selectIndexPlaces(data, { query: 'hidden places in India' }).length, 2);
  assert.equal(selectIndexPlaces(data, { query: 'all India' }).length, 2);
  assert.deepEqual(selectIndexPlaces(data, { query: 'hidden beaches in Gokarna' }).map(place => place.id), ['a']);
});
test('index rejects incompatible data and strips unsafe source links', () => {
  assert.throws(() => validateIndex({ places: [] }));
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('https://user:password@example.org'), null);
  const result = validateIndex({ ...data, places: [{ ...data.places[0], sources: [{ url: 'javascript:alert(1)' }, { url: 'https://en.wikivoyage.org/wiki/Gokarna' }] }] });
  assert.equal(result.places[0].sources.length, 1);
});
