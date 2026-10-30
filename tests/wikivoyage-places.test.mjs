import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchWikivoyagePlaces, parseWikivoyagePlaces, isNonPlaceName } from '../server/providers/wikivoyage.mjs';

const destinations = JSON.parse(await readFile(new URL('../data/india-destinations.json', import.meta.url), 'utf8'));
const gokarna = destinations.find(destination => destination.id === 'gokarna');
const metadata = { title: 'Gokarna', fetchedAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-03-26T11:23:21Z' };
const responseFor = (content, extras = {}) => new Response(JSON.stringify({ query: { pages: [{
  pageid: 2297, title: 'Gokarna', fullurl: 'https://en.wikivoyage.org/wiki/Gokarna',
  revisions: [{ timestamp: metadata.updatedAt, slots: { main: { content } } }], ...extras,
}] } }), { headers: { 'content-type': 'application/json' } });

test('India destinations have unique IDs, canonical wiki titles, aliases, and valid region windows', () => {
  assert.equal(destinations.length, 25);
  assert.equal(new Set(destinations.map(destination => destination.id)).size, 25);
  assert.ok(new Set(destinations.map(destination => destination.state)).size >= 12);
  for (const destination of destinations) {
    assert.ok(destination.city && destination.state && destination.wikivoyageTitle);
    assert.ok(Array.isArray(destination.aliases));
    assert.equal(destination.bbox.length, 4);
    assert.ok(destination.bbox.every(Number.isFinite));
    const [south, west, north, east] = destination.bbox;
    assert.ok(south < north && west < east && south >= 6 && north <= 36 && west >= 68 && east <= 98);
  }
  assert.equal(destinations.find(destination => destination.id === 'coorg').wikivoyageTitle, 'Kodagu');
  assert.equal(destinations.find(destination => destination.id === 'mysuru').wikivoyageTitle, 'Mysore');
});

test('nested templates and link pipes preserve real names, coordinates, and plain descriptions', () => {
  const places = parseWikivoyagePlaces(`== See ==
* {{see
| name=[[Hidden Lake|Hidden Lake]] | lat=14.55 | long=74.32
| content=Walk {{convert|2|km|abbr=on}} along [[Ridge|the ridge]] to a {{nowrap|quiet {{small|forest}}}} lake. Read [https://example.org/?a=1&b=2 the route]. <ref>Do not publish reference markup.</ref>
| lastedit=2025-11-02
}}
`, gokarna, metadata);
  assert.equal(places.length, 1);
  const place = places[0];
  assert.equal(place.name, 'Hidden Lake');
  assert.equal(place.category, 'Nature');
  assert.deepEqual(place.coordinates, { lat: 14.55, lng: 74.32 });
  assert.equal(place.description, 'Walk 2 km along the ridge to a quiet forest lake. Read the route.');
  assert.equal(place.sources[0].url, 'https://en.wikivoyage.org/wiki/Gokarna#Hidden_Lake');
  assert.equal(place.sources[0].kind, 'guide');
  assert.equal(place.sources[0].license, 'CC BY-SA 4.0');
  assert.equal(place.sources[0].publishedAt, null);
  assert.equal(place.sources[0].listingUpdatedAt, '2025-11-02T00:00:00.000Z');
  assert.equal(place.updatedAt, '2026-03-26T11:23:21.000Z');
  assert.equal(place.image, null);
  assert.deepEqual(place.tags, []);
});

test('Gokarna-style go beaches and bold temple listings are included only in sightseeing sections', () => {
  const text = `== Get in ==
* {{go|name=Gokarna Road railway station|lat=14.58|long=74.39}}
== See ==
* The '''Maha Ganapati Temple''' is meters away from the Shiva Temple.
== Do ==
=== Beaches ===
* {{go|name=Kudle Beach|lat=14.5283902|long=74.3156352|content=Kudle Beach is popular with those staying in town.}}
* {{go|name=Om Beach|lat=14.5192559|long=74.3226284|content=Om beach is named after its shape.}}
* {{go|name=Half-moon Beach|lat=14.5180052|long=74.3311407|content=A beach reached by a coastal walk.}}
* {{go|name=Paradise Beach|lat=14.518193|long=74.337449|content=A rocky beach with strong waves.}}
== Sleep ==
* {{see|name=Beach Hotel|lat=14.53|long=74.32}}
`;
  const places = parseWikivoyagePlaces(text, gokarna, metadata);
  assert.deepEqual(places.map(place => place.name), ['Maha Ganapati Temple', 'Kudle Beach', 'Om Beach', 'Half-moon Beach', 'Paradise Beach']);
  assert.equal(places[0].coordinates, null);
  assert.equal(places[0].sources[0].url, 'https://en.wikivoyage.org/wiki/Gokarna#See');
  assert.equal(places[1].category, 'Beaches');
});

test('invalid or missing coordinate numbers never become zero and known distant places are omitted', () => {
  const places = parseWikivoyagePlaces(`== See ==
{{see|name=Blank coordinates|lat=|long=|content=An unlocated listing.}}
{{see|name=Partial coordinates|lat=14.55|long=|content=Incomplete location.}}
{{see|name=Non-numeric coordinates|lat=14.55N|long=NaN}}
{{see|name=Out of range numbers|lat=Infinity|long=200}}
{{see|name=Impossible latitude|lat=91|long=74.32}}
{{see|name=Faraway Museum|lat=28.61|long=77.21}}
{{see|name=Zero default|lat=0|long=0}}
{{see|name=Local Temple|lat=14.55|long=74.32}}
`, gokarna);
  assert.equal(places.length, 6);
  assert.ok(places.slice(0, 5).every(place => place.coordinates === null));
  assert.deepEqual(places.at(-1).coordinates, { lat: 14.55, lng: 74.32 });
  assert.ok(!places.some(place => place.name === 'Faraway Museum' || place.name === 'Zero default'));
});

test('deduplication is stable across whitespace and punctuation and keeps better coordinates', () => {
  const places = parseWikivoyagePlaces(`== See ==
{{see|name=Hidden Lake|content=Original named source.}}
{{see|name=hidden  lake|lat=14.55|long=74.32|content=Repeated listing.}}
{{see|name=Hidden-Lake|lat=14.55|long=74.32}}
`, gokarna);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Hidden Lake');
  assert.deepEqual(places[0].coordinates, { lat: 14.55, lng: 74.32 });
  const again = parseWikivoyagePlaces('{{see|name=Hidden Lake}}', gokarna);
  assert.equal(again[0].id, places[0].id);
});

test('hospitality, hidden examples, and places with explicit private access are excluded', () => {
  const places = parseWikivoyagePlaces(`== See ==
<!-- {{see|name=Comment example}} -->
<nowiki>{{see|name=Nowiki example}}</nowiki>
{{sleep|name=Beach Resort}}
{{eat|name=Local Cafe}}
{{listing|type=drink|name=Beach Bar}}
{{see|name=Private Fort|access=private|content=Historic fort.}}
{{see|name=Closed Garden|content=This is private property, with no public access.}}
{{see|name=Closed Tower|content=Non-members are not welcome, so there is nothing to be seen.}}
{{see|name=Long Private Garden|content=${'A long description. '.repeat(50)} No public access.}}
{{do|name=Old Trail|content=Permanently closed.}}
{{see|name=Public Museum|content=Private tours are available alongside public entry.}}
* '''Bird Watching:''' Enjoy a generic activity.
* '''Annual Festival''' A music festival.
* '''Hari, Bamin, Dutta''' Three different villages.
=== Festivals ===
* '''Sawai Gandharva''' classical music festival.
== Eat ==
{{see|name=Incorrect Restaurant Template}}
`, gokarna);
  assert.deepEqual(places.map(place => place.name), ['Public Museum']);
});

test('place cap is bounded and source URLs cannot escape the public wiki host', () => {
  const wikitext = '== See ==\n' + Array.from({ length: 75 }, (_, index) => `{{see|name=Museum ${index}|content=A named museum.}}`).join('\n');
  const places = parseWikivoyagePlaces(wikitext, gokarna, { ...metadata, url: 'https://untrusted.example/Gokarna' });
  assert.equal(places.length, 60);
  assert.ok(places.every(place => new URL(place.sources[0].url).hostname === 'en.wikivoyage.org'));
  assert.ok(places.every(place => place.country === 'India' && place.destinationId === 'gokarna'));
});

test('plain named See bullets and bold paragraphs retain source names without inventing detail', () => {
  const places = parseWikivoyagePlaces(`== See ==
=== Beaches ===
* [[Agonda]] &mdash; A long beach described in the guide.
* [[Candolim]] and [[Sinquerim]]
=== Inland ===
* Banasura Sagar Dam
* Chembra Hills.
* [[Meppadi]] Hills.
'''Abbey falls''' are a scenic waterfall mentioned in the guide.
'''For example''' visitors can choose between several different sites.
* Walking around the city is a popular pastime.
* Waterfalls
== Do ==
* Hiking
`, gokarna, metadata);
  assert.deepEqual(places.map(place => place.name), ['Agonda', 'Banasura Sagar Dam', 'Chembra Hills', 'Meppadi Hills', 'Abbey falls']);
  assert.equal(places[0].category, 'Beaches');
  assert.equal(places[0].description, 'A long beach described in the guide.');
  assert.equal(places[1].description, '');
  assert.ok(places.every(place => place.coordinates === null));
  assert.equal(places[0].sources[0].url, 'https://en.wikivoyage.org/wiki/Gokarna#Beaches');
});

test('generic activities, people, performances and festival sections cannot become place records', () => {
  const rejected = ['Trekking and camping', 'Boating or fishing in Honnamana Kere Lake', 'Kodagu White Water Rafting', 'Rock Climbing and Rappelling', 'Wild elephant spotting', 'Kathakali and Kalarippayattu performances', 'Harbour Cruise', 'Pune University Heritage Tour', '17th Karmapa', 'Dharohar Dance Show @ Bagore-ki-Haveli', 'Yoga @Kaivalyam Retreat'];
  for (const name of rejected) assert.equal(isNonPlaceName(name), true, name);
  const text = `== See ==\n${rejected.map(name => `{{see|name=${name}}}`).join('\n')}
== Do ==
{{do|name=Yoga Niketan|content=A named institution.}}
{{do|name=Camping Ground Park|content=A named public park.}}
{{do|name=Har ki Dun Trek|content=A named walking route.}}
{{do|name=Chokarmudy Trekking|content=A named mountain route.}}
{{do|name=Casablanca and Titanic|content=The latter is a factory outlet of the former.}}
* '''Poonawallas Breeders Multimillion'''; on the last Sunday of February, this is the event to attend in Mumbai.
=== Events ===
{{do|name=Chitra Santhe (Paintings market)|lat=14.55|long=74.32|content=An annual exhibition.}}
==== Music ====
{{do|name=Named Music Gathering|lat=14.55|long=74.32}}
=== Parks ===
{{see|name=Local Garden|content=The garden hosts a festival each year.}}
`;
  assert.deepEqual(parseWikivoyagePlaces(text, gokarna).map(place => place.name), ['Yoga Niketan', 'Camping Ground Park', 'Har ki Dun Trek', 'Chokarmudy Trekking', 'Local Garden']);
});

test('provider requests latest revision content and retains its actual update timestamp', async () => {
  let request;
  const result = await fetchWikivoyagePlaces(gokarna, {
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return responseFor('== See ==\n{{see|name=Local Temple|lat=14.55|long=74.32|content=A temple recorded in this guide.}}');
    },
  });
  assert.equal(request.url.origin, 'https://en.wikivoyage.org');
  assert.equal(request.url.searchParams.get('rvprop'), 'content|timestamp|ids');
  assert.equal(request.url.searchParams.get('rvslots'), 'main');
  assert.equal(request.url.searchParams.get('titles'), 'Gokarna');
  assert.equal(request.options.redirect, 'error');
  assert.equal(result.provider, 'wikivoyage');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.refreshedSourceUrls, ['https://en.wikivoyage.org/wiki/Gokarna']);
  assert.equal(result.places.length, 1);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.places[0].sources[0].retrievedAt, result.fetchedAt);
  assert.equal(result.places[0].sources[0].updatedAt, '2026-03-26T11:23:21.000Z');
});

test('district delegation follows at most two actually linked pages in one bounded request', async () => {
  const titles = [];
  const result = await fetchWikivoyagePlaces(gokarna, { fetchImpl: async url => {
    const requested = new URL(url).searchParams.get('titles');
    titles.push(requested);
    if (requested === 'Gokarna') return responseFor(`[[Gokarna/Coast|Coast]] [[Gokarna/Hills]] [[Gokarna/Third]] [[Other/Elsewhere]]
== See ==
{{SeeDistricts}}
{{see|name=Shared Temple}}
`);
    return new Response(JSON.stringify({ query: { pages: [
      { title: 'Gokarna/Coast', fullurl: 'https://en.wikivoyage.org/wiki/Gokarna/Coast', revisions: [{ timestamp: metadata.updatedAt, slots: { main: { content: '== See ==\n{{see|name=Shared Temple|lat=14.55|long=74.32}}\n{{see|name=Coastal Fort}}' } } }] },
      { title: 'Gokarna/Hills', fullurl: 'https://en.wikivoyage.org/wiki/Gokarna/Hills', revisions: [{ timestamp: metadata.updatedAt, slots: { main: { content: '[[Gokarna/Hills/Deeper]]\n== See ==\n{{seeDistricts}}\n{{see|name=Hill Cave}}' } } }] },
    ] } }));
  } });
  assert.deepEqual(titles, ['Gokarna', 'Gokarna/Coast|Gokarna/Hills']);
  assert.equal(result.status, 'ok');
  assert.equal(result.places.length, 3);
  assert.equal(result.places[0].sources.length, 2);
  assert.deepEqual(result.places[0].coordinates, { lat: 14.55, lng: 74.32 });
  assert.deepEqual(result.refreshedSourceUrls, ['https://en.wikivoyage.org/wiki/Gokarna', 'https://en.wikivoyage.org/wiki/Gokarna/Coast', 'https://en.wikivoyage.org/wiki/Gokarna/Hills']);
});

test('failed district requests are partial while root failures are unavailable and valid empty pages are ok', async () => {
  const result = await fetchWikivoyagePlaces(gokarna, { fetchImpl: async url => new URL(url).searchParams.get('titles') === 'Gokarna'
    ? responseFor('[[Gokarna/Coast]]\n== See ==\n{{seeDistricts}}\n{{see|name=Root Temple}}')
    : new Response('limited', { status: 429 }) });
  assert.equal(result.status, 'partial');
  assert.equal(result.places[0].name, 'Root Temple');
  assert.deepEqual(result.refreshedSourceUrls, ['https://en.wikivoyage.org/wiki/Gokarna']);
  const unavailable = await fetchWikivoyagePlaces(gokarna, { fetchImpl: async () => new Response('limited', { status: 429 }) });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.refreshedSourceUrls, []);
  const empty = await fetchWikivoyagePlaces(gokarna, { fetchImpl: async () => responseFor('== See ==\nNo listings yet.') });
  assert.equal(empty.status, 'ok');
  assert.deepEqual(empty.places, []);
  assert.deepEqual(empty.refreshedSourceUrls, ['https://en.wikivoyage.org/wiki/Gokarna']);
});

test('missing pages, upstream errors, and oversized responses return warnings without invented places', async () => {
  for (const fetchImpl of [
    async () => new Response(JSON.stringify({ query: { pages: [{ title: 'Gokarna', missing: true }] } })),
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response(JSON.stringify({ error: { code: 'maxlag' } })),
    async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    async () => responseFor('== Eat ==\n{{eat|name=Local Cafe}}'),
  ]) {
    const result = await fetchWikivoyagePlaces(gokarna, { fetchImpl });
    assert.deepEqual(result.places, []);
    assert.ok(result.warnings.length > 0);
  }
});

test('timeouts settle even with an uncooperative fetch and caller cancellation remains an AbortError', async () => {
  const result = await fetchWikivoyagePlaces(gokarna, { timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  assert.deepEqual(result.places, []);
  assert.match(result.warnings[0], /timed out/);
  const controller = new AbortController();
  const pending = fetchWikivoyagePlaces(gokarna, { signal: controller.signal, fetchImpl: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(fetchWikivoyagePlaces({ ...gokarna, bbox: [Infinity, 74, 15, 75] }), /valid bounded search region/);
});
