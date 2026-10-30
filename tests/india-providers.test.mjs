import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOsmPlaces } from '../server/providers/osm.mjs';
import { fetchRedditEvidence, INDIA_TRAVEL_SUBREDDITS } from '../server/providers/reddit.mjs';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const DAY = 86_400_000;
const destination = { id: 'gokarna', name: 'Gokarna', state: 'Karnataka', bbox: [14.45, 74.25, 14.65, 74.45] };
const env = { REDDIT_CLIENT_ID: 'test-client', REDDIT_CLIENT_SECRET: 'test-secret', REDDIT_USER_AGENT: 'node:elsewhere-test:1.0 (by /u/test_user)' };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const now = () => NOW;
const osmNode = (id, tags = {}, extra = {}) => ({ type: 'node', id, lat: 14.55, lon: 74.35, timestamp: '2026-08-01T09:00:00Z', tags: { name: 'Mapped Beach', natural: 'beach', ...tags }, ...extra });
const post = (id = 'p1', extra = {}) => ({ id, title: 'Gokarna trip notes', selftext: 'A coastal walk near Gokarna.', author: 'traveller_one', subreddit: 'IndiaTravel', score: 7, created_utc: (NOW - DAY) / 1000, permalink: `/r/IndiaTravel/comments/${id}/gokarna_trip/`, ...extra });
const comment = (id = 'c1', postId = 'p1', extra = {}) => ({ id, body: 'I visited last week and suggest an early start.', author: 'traveller_two', subreddit: 'IndiaTravel', score: 3, created_utc: (NOW - DAY / 2) / 1000, link_id: `t3_${postId}`, permalink: `/r/IndiaTravel/comments/${postId}/gokarna_trip/${id}/`, ...extra });
const listing = (kind, entries) => ({ kind: 'Listing', data: { children: entries.map((data) => ({ kind, data })) } });
const token = () => json({ access_token: 'test-oauth-token', token_type: 'bearer', expires_in: 3600 });

test('OSM constructs a bounded named-feature query and maps node and way evidence without invented ratings', async () => {
  let request;
  const result = await fetchOsmPlaces(destination, { now, fetchImpl: async (url, options) => {
    request = { url, options, query: new URLSearchParams(options.body).get('data') };
    return json({ elements: [
      osmNode(10, { 'name:en': 'Paradise Cove', name: 'Native name', description: '<b>A rocky beach.</b>' }),
      { type: 'way', id: 20, center: { lat: 14.56, lon: 74.36 }, tags: { name: 'Old Fort', historic: 'fort' } },
      osmNode(30, { name: 'Cave', natural: 'cave_entrance' }),
    ] });
  } });
  assert.equal(request.url, 'https://overpass-api.de/api/interpreter');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.match(request.query, /14\.45,74\.25,14\.65,74\.45/);
  assert.match(request.query, /out meta center 301/);
  assert.match(request.query, /waterfall/);
  assert.equal(result.provider, 'osm');
  assert.equal(result.fetchedAt, '2026-10-30T10:00:00.000Z');
  assert.deepEqual(result.places.map((item) => item.category), ['Beaches', 'Culture', 'Trails']);
  assert.equal(result.places[0].name, 'Paradise Cove');
  assert.equal(result.places[0].description, 'A rocky beach.');
  assert.deepEqual(result.places[1].coordinates, { lat: 14.56, lng: 74.36 });
  assert.equal(result.places[0].sources[0].url, 'https://www.openstreetmap.org/node/10');
  assert.equal(result.places[0].sources[0].license, 'ODbL');
  assert.equal(result.places[0].sources[0].publishedAt, null);
  assert.equal(result.places[0].sources[0].updatedAt, '2026-08-01T09:00:00.000Z');
  assert.ok(result.places.every((item) => item.image === null && !('rating' in item) && !('reviews' in item)));
});

test('OSM drops private, abandoned, unnamed, invalid, foreign and out-of-area records and duplicates', async () => {
  const result = await fetchOsmPlaces(destination, { now, fetchImpl: async () => json({ elements: [
    osmNode(1), osmNode(1),
    osmNode(2, { access: 'private' }), osmNode(3, { foot: 'no' }),
    osmNode(4, { access: 'no;private' }), osmNode(5, { abandoned: 'yes' }),
    osmNode(6, { 'disused:tourism': 'attraction' }), osmNode(7, { 'addr:country': 'NP' }),
    osmNode(8, { name: ' ' }), osmNode(9, {}, { lat: 16 }),
    osmNode(10, {}, { lon: '74.35' }), osmNode(11, {}, { type: 'area' }),
    osmNode(-1), null, { type: 'way', id: 12, tags: { name: 'No coordinates', tourism: 'attraction' } },
  ] }) });
  assert.deepEqual(result.places.map((item) => item.id), ['osm:node:1']);
});

test('OSM rejects malformed or country-wide bounds before making network requests', async () => {
  let calls = 0;
  const fetchImpl = () => { calls += 1; assert.fail('fetch must not run'); };
  for (const invalid of [
    { ...destination, bbox: ['14);out;', 74, 15, 75] },
    { ...destination, bbox: [6, 68, 37, 97] },
    { ...destination, bbox: [14, 74, 13, 75] },
    { ...destination, bbox: [-30, 74, -29, 75] },
    { ...destination, id: '' },
  ]) await assert.rejects(fetchOsmPlaces(invalid, { fetchImpl }), { code: 'OSM_INVALID_DESTINATION' });
  assert.equal(calls, 0);
});

test('OSM enforces result caps and distinguishes incomplete snapshots from successful empty results', async () => {
  const capped = await fetchOsmPlaces(destination, { maxPlaces: 2, fetchImpl: async () => json({ elements: [osmNode(1), osmNode(2), osmNode(3)] }) });
  assert.equal(capped.places.length, 2);
  assert.ok(capped.warnings.some((warning) => warning.includes('limited to 2')));
  assert.deepEqual((await fetchOsmPlaces(destination, { fetchImpl: async () => json({ elements: [] }) })).places, []);
  await assert.rejects(fetchOsmPlaces(destination, { fetchImpl: async () => json({ elements: [osmNode(1)], remark: 'runtime error: timeout' }) }), { code: 'OSM_UNAVAILABLE' });
});

test('OSM surfaces rate limits without retries and bounds response size', async () => {
  let calls = 0;
  await assert.rejects(fetchOsmPlaces(destination, { fetchImpl: async () => { calls += 1; return json({}, 429, { 'Retry-After': '120' }); } }), { code: 'OSM_RATE_LIMITED', retryAfterSeconds: 120 });
  assert.equal(calls, 1);
  await assert.rejects(fetchOsmPlaces(destination, { fetchImpl: async () => json({}, 200, { 'Content-Length': '99999999' }) }), { code: 'OSM_UNAVAILABLE' });
});

test('OSM supports cancellation and aborts stalled requests on timeout', async () => {
  const signals = [];
  const fetchImpl = async (_url, options) => { signals.push(options.signal); return new Promise(() => {}); };
  await assert.rejects(fetchOsmPlaces(destination, { timeoutMs: 10, fetchImpl }), { code: 'OSM_TIMEOUT' });
  assert.equal(signals[0].aborted, true);
  const controller = new AbortController();
  const pending = fetchOsmPlaces(destination, { signal: controller.signal, fetchImpl });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signals[1].aborted, true);
});

test('Reddit truthfully reports missing approval credentials without contacting anonymous endpoints', async () => {
  const fetchImpl = () => assert.fail('must not call an anonymous endpoint');
  const result = await fetchRedditEvidence('Gokarna', { env: {}, fetchImpl });
  assert.equal(result.status, 'not_configured');
  assert.deepEqual(result.items, []);
  assert.ok(result.warnings[0].includes('approved Reddit app'));
  assert.equal((await fetchRedditEvidence('Gokarna', { env: { ...env, REDDIT_USER_AGENT: '' }, fetchImpl })).status, 'not_configured');
});

test('Reddit collects at most three recent India-travel threads and actual top comment excerpts using read-only OAuth', async () => {
  const requests = [];
  const validPosts = [post('p1'), post('p2', { created_utc: (NOW - DAY * 2) / 1000 }), post('p3', { created_utc: (NOW - DAY * 3) / 1000 }), post('p4', { created_utc: (NOW - DAY * 4) / 1000 })];
  const fetchImpl = async (input, options) => {
    const url = new URL(input); requests.push({ url, options });
    if (url.pathname === '/api/v1/access_token') return token();
    if (url.pathname.endsWith('/search')) return json(listing('t3', [
      ...validPosts, post('old', { created_utc: (NOW - DAY * 500) / 1000 }),
      post('nsfw', { over_18: true }), post('gone', { selftext: '[removed]' }),
      post('wrong', { subreddit: 'othercommunity', permalink: '/r/othercommunity/comments/wrong/story/' }),
      post('irrelevant', { title: 'Jaipur trip', selftext: 'Pink city walk' }),
    ]));
    const id = url.pathname.split('/').at(-1);
    const header = validPosts.find((item) => item.id === id);
    return json([listing('t3', [header]), listing('t1', [
      comment(`c${id}`, id), comment(`deleted${id}`, id, { body: '[deleted]' }),
      comment(`private${id}`, id, { author: '[deleted]' }), comment(`adult${id}`, id, { over_18: true }),
      comment(`bot${id}`, id, { author: 'AutoModerator' }),
    ])]);
  };
  const result = await fetchRedditEvidence('Gokarna', { env, now, fetchImpl, maxThreads: 99, commentsPerThread: 99 });
  assert.equal(result.status, 'ok');
  assert.equal(requests.length, 5);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.body, 'grant_type=client_credentials');
  assert.equal(requests[0].options.headers.Authorization, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
  assert.ok(requests.every(({ options }) => options.redirect === 'error'));
  assert.equal(requests[1].url.hostname, 'oauth.reddit.com');
  assert.equal(requests[1].url.pathname, `/r/${INDIA_TRAVEL_SUBREDDITS.join('+')}/search`);
  assert.equal(requests[1].url.searchParams.get('sort'), 'new');
  assert.equal(requests[1].url.searchParams.get('restrict_sr'), 'true');
  assert.ok(requests.slice(2).every(({ url }) => url.searchParams.get('sort') === 'top' && url.searchParams.get('depth') === '1'));
  assert.equal(result.items.filter((item) => item.type === 'discussion').length, 3);
  assert.equal(result.items.filter((item) => item.type === 'comment').length, 3);
  assert.ok(result.items.every((item) => item.isReview === false && item.source === 'reddit' && item.publishedAt && item.retrievedAt));
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
  assert.equal(JSON.stringify(result).includes('test-oauth-token'), false);
});

test('Reddit applies place-and-city relevance rather than returning every post mentioning the city', async () => {
  const fetchImpl = async (input) => new URL(input).pathname === '/api/v1/access_token' ? token() : json(listing('t3', [
    post('p1', { title: 'Paradise Beach Gokarna visit' }), post('p2'),
    post('p3', { title: 'Paradise Beach in Pondicherry', selftext: 'A different coast' }),
  ]));
  const result = await fetchRedditEvidence('Paradise Beach Gokarna', { env, now, fetchImpl, commentsPerThread: 0 });
  assert.deepEqual(result.items.map((item) => item.id), ['reddit:t3_p1']);
});

test('Reddit refresh rechecks deletion and updated text before emitting thread comments', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/api/v1/access_token') return token();
    if (url.pathname.endsWith('/search')) return json(listing('t3', [post('p1'), post('p2')]));
    if (url.pathname === '/comments/p1') return json([listing('t3', [post('p1', { selftext: '[removed]' })]), listing('t1', [comment()])]);
    return json([listing('t3', [post('p2', { selftext: 'Updated Gokarna travel notes.' })]), listing('t1', [comment('c2', 'p2', { permalink: undefined })])]);
  };
  const result = await fetchRedditEvidence('Gokarna', { env, now, fetchImpl });
  assert.deepEqual(result.items.map((item) => item.id), ['reddit:t3_p2', 'reddit:t1_c2']);
  assert.equal(result.items[0].text, 'Updated Gokarna travel notes.');
  assert.equal(result.items[1].url, 'https://www.reddit.com/r/IndiaTravel/comments/p2/_/c2/');
});

test('Reddit caches only authentication, refreshes discussion content on each lookup, and keeps credentials server-side', async () => {
  let authCalls = 0;
  let searches = 0;
  const fetchImpl = async (input) => {
    if (new URL(input).pathname === '/api/v1/access_token') { authCalls += 1; return token(); }
    searches += 1;
    return json(listing('t3', [post('p1', { selftext: `Gokarna update ${searches}` })]));
  };
  await fetchRedditEvidence('Gokarna', { env, now, fetchImpl, commentsPerThread: 0 });
  const latest = await fetchRedditEvidence('Gokarna', { env, now, fetchImpl, commentsPerThread: 0 });
  assert.equal(authCalls, 1);
  assert.equal(searches, 2);
  assert.equal(latest.items[0].text, 'Gokarna update 2');
});

test('Reddit permission failures do not expose response bodies or retry through unauthenticated endpoints', async () => {
  let calls = 0;
  const result = await fetchRedditEvidence('Gokarna', { env, now, fetchImpl: async () => {
    calls += 1;
    return json({ error: 'test-secret was denied' }, 403);
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.ok(result.warnings[0].includes('approval'));
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});

test('Reddit respects exhausted quota headers and stops further requests until the reset time', async () => {
  let time = NOW;
  let calls = 0;
  const fetchImpl = async (input) => {
    calls += 1;
    if (new URL(input).pathname === '/api/v1/access_token') return token();
    return json(listing('t3', [post()]), 200, { 'X-Ratelimit-Remaining': '0.0', 'X-Ratelimit-Reset': '30' });
  };
  const result = await fetchRedditEvidence('Gokarna', { env, now: () => time, fetchImpl });
  assert.equal(result.status, 'ok');
  assert.equal(result.items.length, 1);
  assert.equal(calls, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('comment threads')));
  const paused = await fetchRedditEvidence('Gokarna', { env, now: () => time, fetchImpl });
  assert.equal(paused.status, 'unavailable');
  assert.equal(calls, 2);
  time += 31_000;
  await fetchRedditEvidence('Gokarna', { env, now: () => time, fetchImpl, commentsPerThread: 0 });
  assert.equal(calls, 3);
});

test('Reddit timeout, cancellation, and invalid data are distinct from a valid empty discussion listing', async () => {
  const signals = [];
  const stalled = async (_input, options) => { signals.push(options.signal); return new Promise(() => {}); };
  const result = await fetchRedditEvidence('Gokarna', { env, timeoutMs: 10, fetchImpl: stalled });
  assert.equal(result.status, 'unavailable');
  assert.equal(signals[0].aborted, true);
  const controller = new AbortController();
  const pending = fetchRedditEvidence('Gokarna', { env, signal: controller.signal, fetchImpl: stalled });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signals[1].aborted, true);
  const empty = await fetchRedditEvidence('Gokarna', { env, now, fetchImpl: async (input) => new URL(input).pathname === '/api/v1/access_token' ? token() : json(listing('t3', [])) });
  assert.equal(empty.status, 'ok');
  assert.deepEqual(empty.items, []);
  const malformed = await fetchRedditEvidence('Gokarna', { env, now, fetchImpl: async (input) => new URL(input).pathname === '/api/v1/access_token' ? token() : json({}) });
  assert.equal(malformed.status, 'unavailable');
});
