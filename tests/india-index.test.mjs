import test from 'node:test';
import assert from 'node:assert/strict';
import { selectIndexPlaces, destinationsForQuery, validateIndex, safeSourceUrl } from '../src/lib/india-index.js';

const data = { schemaVersion: 1, destinations: [{ id: 'gokarna', city: 'Gokarna', aliases: [] }, { id: 'hampi', city: 'Hampi', aliases: [] }], places: [
  { id: 'a', name: 'Half Moon Beach', destinationId: 'gokarna', category: 'Beaches', sources: [], discovery: { score: 50, label: 'Worth investigating' } },
  { id: 'b', name: 'Stone Temple', destinationId: 'hampi', category: 'Culture', sources: [], discovery: { score: 60, label: 'Offbeat signal found' } },
] };
test('hashtag city matching, place names and offbeat filters do not leak unrelated destinations', () => {
  assert.deepEqual(destinationsForQuery(data.destinations, '#hiddenplacegokarna').map(city => city.id), ['gokarna']);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Half Moon Gokarna', crowdMode: 'all' }).map(place => place.id), ['a']);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Hampi', category: 'Beaches' }), []);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Gokarna', offbeatOnly: true }), []);
  assert.deepEqual(selectIndexPlaces(data, { query: 'Unknown city' }), []);
  assert.equal(selectIndexPlaces(data, { query: 'India', crowdMode: 'all' }).length, 2);
  assert.equal(selectIndexPlaces(data, { query: 'hidden places in India' }).length, 0);
  assert.equal(selectIndexPlaces(data, { query: 'all India', crowdMode: 'all' }).length, 2);
  assert.deepEqual(selectIndexPlaces(data, { query: 'hidden beaches in Gokarna', crowdMode: 'all' }).map(place => place.id), ['a']);
});

test('crowd intent defaults to evidence, excludes generic high scores and ranks explicit very-low reports first', () => {
  const fixture = { ...data, places: [
    { ...data.places[0], id: 'unknown', discovery: { score: 100, label: 'Offbeat signal found' } },
    { ...data.places[0], id: 'busy', discovery: { score: 99 }, crowd: { status: 'busy', evidence: [] } },
    { ...data.places[0], id: 'mixed', crowd: { status: 'mixed', evidence: [] } },
    { ...data.places[0], id: 'low', crowd: { status: 'quieter', level: 'low', evidence: [{ level: 'low' }] } },
    { ...data.places[0], id: 'very-low', discovery: { score: 0 }, crowd: { status: 'quieter', level: 'very_low', evidence: [{ level: 'very_low' }] } },
  ] };
  for (const query of ['Gokarna', '#hiddenplacegokarna', 'less populated places in Gokarna', 'quiet beaches near Gokarna', 'least crowded Gokarna']) {
    assert.deepEqual(selectIndexPlaces(fixture, { query }).map(p => p.id), ['very-low', 'low'], query);
  }
  assert.deepEqual(selectIndexPlaces(fixture, { crowdMode: 'mixed' }).map(p => p.id), ['mixed']);
  assert.deepEqual(selectIndexPlaces(fixture, { crowdMode: 'all' }).map(p => p.id), ['very-low', 'low', 'mixed', 'unknown', 'busy']);
});
test('index rejects incompatible data and strips unsafe source links', () => {
  assert.throws(() => validateIndex({ places: [] }));
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('https://user:password@example.org'), null);
  const result = validateIndex({ ...data, places: [{ ...data.places[0], sources: [{ url: 'javascript:alert(1)' }, { url: 'https://en.wikivoyage.org/wiki/Gokarna' }] }] });
  assert.equal(result.places[0].sources.length, 1);
});
