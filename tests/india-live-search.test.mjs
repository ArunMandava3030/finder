import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createIndiaPlaceSearch } from '../src/lib/india-live-search.js';
import { parseWikivoyagePlaces as parseServer, fetchWikivoyagePlaces } from '../server/providers/wikivoyage.mjs';
import { parseWikivoyagePlaces as parseBrowser } from '../shared/wikivoyage-parser.mjs';

const now = () => Date.parse('2026-10-31T00:00:00Z');
const response = pages => new Response(JSON.stringify({ batchcomplete: true, query: { pages } }), { headers: { 'content-type': 'application/json' } });
const page = (title, text, extra = {}) => ({ title, pageid: 1, fullurl: `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, revisions: [{ timestamp: '2026-07-01T00:00:00Z', slots: { main: { content: text } } }], ...extra });
const listing = (name = 'River Garden', content = 'A peaceful garden with trees.') => `==See==\n{{see|name=${name}|content=${content}|lat=26.9|long=75.8}}`;
const jaipur = { id: 'jaipur', city: 'Jaipur', state: 'Rajasthan', aliases: ['Pink City'], wikivoyageTitle: 'Jaipur', bbox: [26, 75, 28, 77] };

test('known city and natural-language aliases load named listings with unknown crowd levels, not generic quiet guide cards', async () => {
  const calls = [];
  const search = createIndiaPlaceSearch({ now, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response([page('Jaipur', `${listing()}\n{{eat|name=Garden Cafe|content=Quiet cafe}}\n{{see|name=Private Estate|access=private}}`)]);
  } });
  const result = await search('less populated places in Jaipur', { destinations: [jaipur] });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.places.map(item => item.name), ['River Garden']);
  assert.equal(result.places[0].crowd.status, 'unknown');
  assert.equal(result.places[0].reviewSummary.rating, null);
  assert.equal(result.places[0].sources[0].license, 'CC BY-SA 4.0');
  assert.equal(result.places[0].sources[0].retrievedAt, new Date(now()).toISOString());
  assert.match(result.places[0].sources[0].url, /Jaipur#River_Garden$/);
  assert.equal(calls[0].url.searchParams.get('titles'), 'Jaipur');
  assert.equal(calls[0].url.searchParams.get('origin'), '*');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  const cached = await search('Pink City', { destinations: [jaipur] });
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 1);
  cached.places[0].name = 'mutated';
  assert.equal((await search('Jaipur', { destinations: [jaipur] })).places[0].name, 'River Garden');
});

test('unindexed Indian city verifies guide ancestry and keeps direct crowd claims separate from atmosphere', async () => {
  const calls = [];
  const search = createIndiaPlaceSearch({ now, fetchImpl: async url => {
    const title = new URL(url).searchParams.get('titles'); calls.push(title);
    if (title === 'hyderabad') return response([page('Hyderabad', `{{IsPartOf|Southern Telangana}}\n${listing('Lake Garden', 'Lake Garden is uncrowded.')}\n{{see|name=Hill Garden|content=A secluded and peaceful garden.}}`)]);
    return response([page('Southern Telangana', '{{IsPartOf|Telangana}}')]);
  } });
  const result = await search('#hiddenplacehyderabad');
  assert.deepEqual(calls, ['hyderabad', 'Southern Telangana']);
  assert.equal(result.destinations[0].state, 'Telangana');
  assert.equal(result.places.find(item => item.name === 'Lake Garden').crowd.status, 'quieter');
  assert.equal(result.places.find(item => item.name === 'Hill Garden').crowd.status, 'unknown');
  assert.ok(result.places.every(item => item.country === 'India' && item.live));
});

test('foreign guides and guides with no verified India ancestry never leak into India results', async () => {
  let requests = 0;
  const search = createIndiaPlaceSearch({ now, fetchImpl: async () => { requests += 1; return response([page('Paris', `{{IsPartOf|France}}\n${listing()}`)]); } });
  const result = await search('Paris');
  assert.deepEqual(result.places, []);
  assert.match(result.warnings[0], /could not be confirmed/);
  assert.ok(requests <= 4);
});

test('missing exact titles use a bounded title-matched search instead of unrelated popular city results', async () => {
  const calls = [];
  const search = createIndiaPlaceSearch({ now, fetchImpl: async url => {
    const params = new URL(url).searchParams; calls.push(params);
    if (params.has('titles')) return response([{ title: 'new city', missing: true }]);
    return response([page('Mumbai', `{{IsPartOf|Maharashtra}}\n${listing()}`, { index: 1 }), page('New City (Rajasthan)', `{{IsPartOf|Rajasthan}}\n${listing('Old Garden')}`, { index: 2 })]);
  } });
  const result = await search('New City');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].get('gsrlimit'), '3');
  assert.equal(calls[1].get('origin'), '*');
  assert.equal(result.destinations[0].city, 'New City');
  assert.deepEqual(result.places.map(item => item.name), ['Old Garden']);
});

test('only two linked district guides are fetched and district failures preserve main-guide places', async () => {
  const calls = [];
  const search = createIndiaPlaceSearch({ now, fetchImpl: async url => {
    const title = new URL(url).searchParams.get('titles'); calls.push(title);
    if (calls.length === 1) return response([page('Jaipur', `${listing()}\n{{seeDistricts}}\n[[Jaipur/Old City]] [[Jaipur/North]] [[Jaipur/South]]`)]);
    return new Response('', { status: 429 });
  } });
  const result = await search('Jaipur', { destinations: [jaipur] });
  assert.equal(result.status, 'partial');
  assert.equal(result.places.length, 1);
  assert.equal(calls[1], 'Jaipur/Old City|Jaipur/North');
});

test('state queries are not silently converted into the only indexed city in that state', async () => {
  let title;
  const search = createIndiaPlaceSearch({ now, fetchImpl: async url => { title = new URL(url).searchParams.get('titles'); return response([page('Rajasthan', listing())]); } });
  const result = await search('Rajasthan', { destinations: [jaipur] });
  assert.equal(title, 'rajasthan');
  assert.equal(result.destinations[0].city, 'Rajasthan');
});

test('live named-place and category filters match saved-index semantics without narrowing the cached city guide', async () => {
  let requests = 0;
  const search = createIndiaPlaceSearch({ now, fetchImpl: async () => {
    requests += 1;
    return response([page('Jaipur', `${listing('Lake Garden')}\n{{see|name=Ancient Temple|content=A stone shrine.}}`)]);
  } });
  assert.deepEqual((await search('Ancient Temple Jaipur', { destinations: [jaipur] })).places.map(item => item.name), ['Ancient Temple']);
  assert.equal((await search('Jaipur', { destinations: [jaipur] })).places.length, 2);
  assert.deepEqual((await search('beaches Jaipur', { destinations: [jaipur] })).places, []);
  assert.equal(requests, 1);
});

test('unavailable services, size caps and timeouts return honest failures while aborts reject', async () => {
  for (const fetchImpl of [async () => new Response('', { status: 429 }), async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }), () => new Promise(() => {})]) {
    const result = await createIndiaPlaceSearch({ now, fetchImpl, timeoutMs: 10 })('Jaipur', { destinations: [jaipur] });
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.places, []);
  }
  const controller = new AbortController();
  const pending = createIndiaPlaceSearch({ now, fetchImpl: () => new Promise(() => {}) })('Jaipur', { signal: controller.signal, destinations: [jaipur] });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const result = await createIndiaPlaceSearch({ now, fetchImpl: async () => response([]) })('No Such City');
  assert.equal(result.status, 'ok'); assert.deepEqual(result.places, []);
});

test('India ancestry traversal is bounded and cycles cannot trigger crawling', async () => {
  let calls = 0;
  const search = createIndiaPlaceSearch({ now, fetchImpl: async () => { calls += 1; return response([page(`Region ${calls}`, `{{IsPartOf|Region ${calls + 1}}}\n${listing()}`)]); } });
  const result = await search('Mystery City');
  assert.equal(calls, 4);
  assert.deepEqual(result.places, []);
});

test('shared browser parser preserves server record IDs and parses identical factual listings', () => {
  const options = { fetchedAt: '2026-10-30T00:00:00Z' };
  const [server] = parseServer(listing(), jaipur, options);
  const [browser] = parseBrowser(listing(), jaipur, options);
  assert.equal(server.id, `wv-jaipur-${createHash('sha256').update('rivergarden').digest('hex').slice(0, 12)}`);
  assert.deepEqual({ ...browser, id: server.id }, server);
});

test('destinations with a verified missing guide skip both browser and server requests', async () => {
  const unavailable = { ...jaipur, wikivoyageAvailable: false };
  const fetchImpl = async () => { throw new Error('No request should run'); };
  const browser = await createIndiaPlaceSearch({ now, fetchImpl })('Jaipur', { destinations: [unavailable] });
  const server = await fetchWikivoyagePlaces(unavailable, { fetchImpl });
  assert.equal(browser.status, 'unavailable');
  assert.equal(browser.reason, 'guide_not_available');
  assert.equal(server.status, 'unavailable');
  assert.deepEqual(browser.places, []);
  assert.deepEqual(server.refreshedSourceUrls, []);
});
