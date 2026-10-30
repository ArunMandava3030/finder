import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPlace, rankPlaces, mergePlaces, attachEvidence } from '../server/discovery/rank.mjs';

const source = (excerpt = '', overrides = {}) => ({ publisher: 'Wikivoyage', kind: 'guide', url: 'https://en.wikivoyage.org/wiki/Gokarna#Cove', excerpt, ...overrides });
const place = (overrides = {}) => ({ id: 'wv-gokarna-cove', name: 'Quiet Cove', destinationId: 'gokarna', category: 'Beaches', coordinates: { lat: 14.52, lng: 74.31 }, tags: [], aliases: [], sources: [source('A beach reached by a trail.')], ...overrides });
const withText = text => rankPlace(place({ sources: [source(text)] }));

test('negated, qualified and former offbeat descriptions do not become affirmative hidden-place claims', () => {
  for (const text of [
    'The cove is not quiet.', 'The cove is no longer secluded.', "It isn't a hidden gem.",
    'This beach is never uncrowded.', 'It is not particularly quiet or secluded.',
    'The beach is anything but quiet.', 'It is far from secluded.', 'It is less quiet than the town.',
    'It used to be quiet.', 'It was formerly a hidden gem.',
  ]) {
    const ranked = withText(text);
    assert.equal(ranked.discovery.label, 'Worth investigating', text);
    assert.equal(ranked.discovery.evidenceUrl, null, text);
    assert.equal(ranked.discovery.confidence, 'low', text);
  }
});

test('affirmative phrases after contrasts remain evidence and not-only phrases are positive', () => {
  for (const text of ['The beach is not crowded but secluded.', 'The town is noisy; the cove is quiet.', 'Not only quiet but also secluded.', 'There are no shops. A quiet cove awaits.']) {
    const ranked = withText(text);
    assert.equal(ranked.discovery.label, 'Offbeat signal found', text);
    assert.equal(ranked.discovery.evidenceUrl, source().url);
    assert.equal(ranked.discovery.confidence, 'low');
  }
  assert.equal(withText('The cove is not quiet but crowded.').discovery.label, 'Established attraction');
});

test('explicit famous, popular and crowded source descriptions downrank without inventing visitor numbers', () => {
  const baseline = withText('A beach reached by a trail.').discovery.score;
  for (const text of ['A famous beach.', 'A popular attraction.', 'The beach is crowded.', 'A well-known landmark.', 'A tourist hotspot.']) {
    const ranked = withText(text);
    assert.ok(ranked.discovery.score < baseline, text);
    assert.equal(ranked.discovery.label, 'Established attraction');
    assert.equal(ranked.discovery.confidence, 'low');
    assert.equal(ranked.discovery.evidenceUrl, source().url);
    assert.deepEqual(ranked.reviewSummary, { count: 0, rating: null, status: 'not_available' });
    assert.match(ranked.discovery.explanation, /not a rating, popularity measurement/);
    assert.equal(ranked.popularity, undefined);
  }
});

test('negated mainstream language is not treated as popularity and does not imply hidden status', () => {
  const baseline = withText('A beach reached by a trail.').discovery.score;
  for (const text of ['It is not famous.', 'This beach is no longer popular.', "The cove isn't crowded.", 'A less crowded place.', 'It is not very popular or well-known.', 'Never crowded.']) {
    const ranked = withText(text);
    assert.equal(ranked.discovery.score, baseline, text);
    assert.equal(ranked.discovery.label, 'Worth investigating', text);
    assert.equal(ranked.discovery.evidenceUrl, null, text);
  }
});

test('missing and duplicate publisher identities never count as independent corroboration', () => {
  const ranked = rankPlace(place({ sources: [source('A quiet cove.'), source('', { publisher: undefined, kind: 'map', url: 'https://maps.example/1' }), source('', { publisher: ' ', kind: 'map', url: 'https://maps.example/2' }), source('', { publisher: ' wikivoyage ', url: 'https://en.wikivoyage.org/wiki/Other' })] }));
  assert.equal(ranked.discovery.confidence, 'low');
  assert.equal(ranked.discovery.reasons.some(reason => /Corroborated/.test(reason)), false);
  const corroborated = rankPlace(place({ sources: [source('A quiet cove.'), source('', { publisher: 'OpenStreetMap', kind: 'map', url: 'https://www.openstreetmap.org/node/12' })] }));
  assert.equal(corroborated.discovery.confidence, 'medium');
});

test('reranking preserves unique aliases and evidence matching through aliases', () => {
  const original = place({ aliases: ['Secret Bay', 'secret bay', 'Quiet Cove', '  Cove Walk  '] });
  const once = rankPlaces([original]);
  const twice = rankPlaces(once);
  assert.deepEqual(twice[0].aliases, ['Secret Bay', 'Cove Walk']);
  assert.deepEqual(twice, once);
  assert.equal(attachEvidence(twice, [{ title: 'Secret Bay walk', url: 'https://example.org/trip' }])[0].evidence.length, 1);
  assert.deepEqual(original.aliases, ['Secret Bay', 'secret bay', 'Quiet Cove', '  Cove Walk  ']);
});

test('nearby temples with overlapping generic names or different deity names remain distinct', () => {
  const names = ['Sri Lakshmi Narasimha Swamy Temple', 'Sri Lakshmi Venkateswara Swamy Temple', 'Sri Hanuman Temple', 'Sri Shiva Temple'];
  const input = names.map((name, index) => place({ id: `osm:node:${index + 1}`, name, category: 'Culture', coordinates: { lat: 14.52 + index * 0.0001, lng: 74.31 } }));
  assert.equal(mergePlaces(input).length, names.length);
  assert.equal(mergePlaces([place({ id: 'a', name: 'Shiva Temple', coordinates: null }), place({ id: 'b', name: 'Shiva Temple', coordinates: null })]).length, 2);
  assert.equal(mergePlaces([place({ id: 'a', name: 'Shiva Temple' }), place({ id: 'b', name: 'Shiva Temple', coordinates: { lat: 14.521, lng: 74.31 } })]).length, 2);
});

test('distinctive honorific variants merge while differently named viewpoints and distant names stay separate', () => {
  const merged = mergePlaces([
    place({ id: 'a', name: 'Sri Virupaksha Temple', aliases: ['Virupaksha Mandir'], category: 'Culture' }),
    place({ id: 'b', name: 'Virupaksha Temple', aliases: ['Virupaksha shrine'], category: 'Culture', coordinates: { lat: 14.5202, lng: 74.31 } }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].aliases, ['Virupaksha Mandir', 'Virupaksha Temple', 'Virupaksha shrine']);
  assert.equal(mergePlaces([place({ id: 'a', name: 'Om Beach' }), place({ id: 'b', name: 'Om Beach Viewpoint' })]).length, 2);
  assert.equal(mergePlaces([place({ id: 'a' }), place({ id: 'b', coordinates: { lat: 14.53, lng: 74.31 } })]).length, 2);
  assert.equal(mergePlaces([place({ id: 'a' }), place({ id: 'a', destinationId: 'hampi' })]).length, 2);
});
