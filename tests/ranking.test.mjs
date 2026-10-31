import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPlace, rankPlaces, mergePlaces, attachEvidence, assessCrowd } from '../server/discovery/rank.mjs';

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

const crowdNow = () => Date.parse('2026-10-31T00:00:00Z');
const crowdOf = text => assessCrowd(place({ sources: [source(text)] }), { now: crowdNow });
const crowdTable = (name, level, overrides = {}) => ({
  url: 'https://tourism.example.org/gokarna/', publisher: 'State Tourism', claim: `The tourism guide classifies ${name} crowd levels as ${level.replace('_', ' ')}.`,
  direction: level === 'high' ? 'busy' : level === 'moderate' ? 'mixed' : 'quieter', level, provider: 'scrapling', sourceId: 'crowd-guide', sourceType: 'official',
  publishedPeriod: '2026-06', sourceUpdatedAt: null, retrievedAt: '2026-10-30T00:00:00Z', conditional: false, ...overrides,
});

test('crowd assessment does not infer fewer visitors from quiet atmosphere, scenery, obscurity or missing reviews', () => {
  for (const text of ['A quiet beach.', 'Secluded and peaceful.', 'A hidden gem with pristine sand.', 'A lesser-known attraction.', 'A popular and famous beach.', 'An isolated cove.', 'Few reviews are available.']) {
    assert.equal(crowdOf(text).status, 'unknown', text);
    assert.deepEqual(crowdOf(text).evidence, [], text);
  }
  const mapped = rankPlace(place({ sources: [], reviewSummary: { count: 0, rating: null } }), { now: crowdNow });
  assert.equal(mapped.crowd.status, 'unknown');
  assert.equal(mapped.crowd.confidence, 'low');
});

test('explicit place-specific visitor claims qualify while negated claims and descriptions of other places do not', () => {
  for (const text of ['Quiet Cove is uncrowded.', 'The beach is less crowded.', 'Quiet Cove is rarely visited.', 'There is not much crowd.', 'Very few tourists visit Quiet Cove.', 'Quiet Cove is not crowded.', 'The cove is deserted.']) {
    assert.equal(crowdOf(text).status, 'quieter', text);
    assert.equal(crowdOf(text).confidence, 'low', text);
  }
  for (const text of ['Quiet Cove is not uncrowded.', 'The cove is no longer deserted.', 'The beach is not less crowded.', 'Om Beach is less crowded.', 'Om Beach is crowded.', 'Half Moon Beach is less crowded than Quiet Cove.', 'The road to Quiet Cove is crowded.']) {
    assert.equal(crowdOf(text).status, 'unknown', text);
  }
  assert.equal(crowdOf('Quiet Cove is crowded.').status, 'busy');
  assert.equal(crowdOf('Om Beach is crowded; this cove is uncrowded.').status, 'quieter');
});

test('conditions, partial-place claims, contradictions and older source dates remain qualified crowd evidence', () => {
  for (const text of ['Quiet Cove is uncrowded on weekdays.', 'The northern end of Quiet Cove is less crowded.', 'Quiet Cove is crowded during festivals.', 'The cove used to be deserted.']) assert.equal(crowdOf(text).status, 'mixed', text);
  const conflicting = assessCrowd(place({ sources: [source('Quiet Cove is uncrowded.'), source('Quiet Cove is crowded.', { url: 'https://other.example.org/trip', publisher: 'Other Guide' })] }), { now: crowdNow });
  assert.equal(conflicting.status, 'mixed');
  assert.equal(conflicting.evidence.length, 2);
  const old = assessCrowd(place({ sources: [source('Quiet Cove is uncrowded.', { updatedAt: '2020-01-01', retrievedAt: '2026-10-30T00:00:00Z' })] }), { now: crowdNow });
  assert.equal(old.status, 'mixed');
  assert.equal(old.evidence[0].stale, true);
  assert.equal(old.evidence[0].sourceUpdatedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(old.evidence[0].retrievedAt, '2026-10-30T00:00:00.000Z');
});

test('ambiguous subjects, disputed quotations and negated idioms never promote a place as quieter', () => {
  for (const text of [
    'Quiet Cove is anything but uncrowded.',
    'There are few visitors at Om Beach.', 'Om Beach has few visitors.',
    'The cafe at Quiet Cove has few visitors.', 'The water is uncrowded with boats.',
    'The claim that Quiet Cove is uncrowded is false.',
    'Quiet Cove is described as uncrowded, but that claim is false.',
    'Calangute got too crowded for them.',
  ]) assert.equal(crowdOf(text).status, 'unknown', text);
  assert.equal(crowdOf('Quiet Cove was uncrowded before it became popular.').status, 'mixed');
  const anjuna = assessCrowd(place({ name: 'Anjuna beach', sources: [source('Anjuna was the second home in the 1960s and 1970s, after other destinations like Calangute got too "crowded" for them.')] }), { now: crowdNow });
  assert.equal(anjuna.status, 'unknown');
  assert.equal(crowdOf('Not many people go there.').status, 'quieter');
  assert.equal(crowdOf('It is the least crowded among nearby beaches.').status, 'quieter');
});

test('unknown publication dates lower confidence without disguising retrieval dates as observation dates', () => {
  const undated = assessCrowd(place({ sources: [source('Quiet Cove is uncrowded.', { retrievedAt: '2026-10-30T00:00:00Z' })] }), { now: crowdNow });
  assert.equal(undated.status, 'quieter');
  assert.equal(undated.confidence, 'low');
  assert.equal(undated.evidence[0].sourceUpdatedAt, null);
  assert.equal(undated.evidence[0].dateUnknown, true);
  const corroborated = assessCrowd(place({ sources: [source('Quiet Cove is uncrowded.', { updatedAt: '2026-06-01' }), source('Quiet Cove sees few visitors.', { publisher: 'Independent Guide', url: 'https://other.example.org/quiet-cove', updatedAt: '2026-07-01' })] }), { now: crowdNow });
  assert.equal(corroborated.confidence, 'medium');
});

test('reviewed crowd-table evidence retains month precision and sorts very-low crowds ahead of low and generic discovery scores', () => {
  const input = [
    place({ id: 'paradise', name: 'Paradise Beach', crowdEvidence: [crowdTable('Paradise Beach', 'low')], sources: [source('Paradise Beach is uncrowded.', { updatedAt: '2026-06-01' })] }),
    place({ id: 'unknown', name: 'Generic Scenic Cove', crowdEvidence: [], sources: [source('A quiet and secluded hidden gem.')] }),
    place({ id: 'nirvana', name: 'Nirvana Beach', coordinates: null, category: 'Attractions', sources: [], crowdEvidence: [crowdTable('Nirvana Beach', 'very_low')] }),
    place({ id: 'om', name: 'Om Beach', crowdEvidence: [crowdTable('Om Beach', 'high')], sources: [] }),
    place({ id: 'kudle', name: 'Kudle Beach', crowdEvidence: [crowdTable('Kudle Beach', 'moderate')], sources: [] }),
  ];
  const ranked = rankPlaces(input, { now: crowdNow });
  assert.deepEqual(ranked.map(item => item.id), ['nirvana', 'paradise', 'kudle', 'unknown', 'om']);
  assert.equal(ranked[0].crowd.confidence, 'low');
  assert.equal(ranked[1].crowd.confidence, 'medium');
  assert.equal(ranked[0].crowd.evidence[0].publishedPeriod, '2026-06');
  assert.equal(ranked[0].crowd.evidence[0].sourceUpdatedAt, null);
  assert.equal(ranked[0].reviewSummary.rating, null);
  assert.ok(ranked[0].discovery.score < ranked[3].discovery.score);
});
