import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchService, normalizeQuery } from '../server/search.mjs';
import { createApp } from '../server/index.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const mockResult = (url, title = 'A quiet place', content = 'Traveller suggestions') => ({ url, title, content });
const tavilyEnv = { TAVILY_API_KEY: 'test-server-only-key' };

test('normalizes compact hashtags, camelCase, and natural language without losing the city', () => {
  assert.equal(normalizeQuery('#hiddenplacegokarna'), 'hidden places gokarna');
  assert.equal(normalizeQuery('#hiddenGemsJaipur'), 'hidden gems Jaipur');
  assert.equal(normalizeQuery('#secretspotsMysore'), 'secret spots Mysore');
  assert.equal(normalizeQuery('  quiet cafés in Pune  '), 'quiet cafés in Pune');
  for (const query of ['', 'a', '# ', 'x'.repeat(161), null, ['gokarna']]) {
    assert.throws(() => normalizeQuery(query), { code: 'INVALID_QUERY' });
  }
});

test('reports missing configuration and never invents live results or calls a provider', async () => {
  const service = createSearchService({ env: {}, fetchImpl: () => assert.fail('must not call fetch') });
  const result = await service.search('#hiddenplacegokarna');
  assert.equal(result.configured, false);
  assert.equal(result.provider, null);
  assert.equal(result.error.code, 'SEARCH_NOT_CONFIGURED');
  assert.deepEqual(result.results, []);
  assert.equal(createSearchService({ env: { SEARXNG_URL: 'file:///secret' } }).status().configured, false);
  await assert.rejects(service.search('Gokarna', { source: 'tiktok' }), { code: 'INVALID_SOURCE' });
});

test('merges independent source searches, validates URLs, deduplicates, and cleans excerpts', async () => {
  const calls = [];
  const service = createSearchService({
    env: tavilyEnv,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, body });
      if (body.include_domains?.[0] === 'reddit.com') return json({ results: [
        mockResult('https://www.reddit.com/r/travel/comments/abc?utm_source=search', '<b>Gokarna suggestions</b>', 'A &amp; B <i>traveller notes</i>'),
        mockResult('https://www.reddit.com/r/travel/comments/abc'),
        mockResult('https://reddit.com.evil.example/deception'),
      ] });
      if (body.include_domains?.[0] === 'instagram.com') return json({ results: [mockResult('https://www.instagram.com/p/abc/')] });
      return json({ results: [
        mockResult('https://travel.example/gokarna?utm_campaign=spring#beach'),
        mockResult('javascript:alert(1)'),
        mockResult('https://user:password@travel.example/private'),
        mockResult('file:///etc/passwd'),
        mockResult('https://travel.example/empty', ''),
        null,
      ] });
    },
  });
  const result = await service.search('#hiddenplacegokarna');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url === 'https://api.tavily.com/search'));
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer test-server-only-key'));
  assert.ok(calls.every((call) => call.body.query === 'hidden places gokarna'));
  assert.deepEqual(result.results.map((item) => item.source), ['web', 'reddit', 'instagram']);
  assert.equal(result.results[0].url, 'https://travel.example/gokarna');
  assert.equal(result.results[1].title, 'Gokarna suggestions');
  assert.equal(result.results[1].excerpt, 'A & B traveller notes');
  assert.equal(result.results[1].domain, 'reddit.com');
  assert.equal(JSON.stringify(result).includes(tavilyEnv.TAVILY_API_KEY), false);
});

test('uses SearXNG JSON API, preserves installation paths, and applies social domain filtering', async () => {
  let requested;
  const service = createSearchService({
    env: { SEARXNG_URL: 'https://search.example/private-instance/' },
    fetchImpl: async (url) => {
      requested = new URL(url);
      return json({ results: [mockResult('https://reddit.com/r/travel/a'), mockResult('https://blog.example/a')] });
    },
  });
  const result = await service.search('quiet Gokarna', { source: 'reddit' });
  assert.equal(requested.pathname, '/private-instance/search');
  assert.equal(requested.searchParams.get('format'), 'json');
  assert.equal(requested.searchParams.get('q'), 'quiet Gokarna site:reddit.com');
  assert.equal(result.provider, 'searxng');
  assert.equal(result.results.length, 1);
  const webResult = await service.search('quiet Gokarna', { source: 'web' });
  assert.equal(requested.searchParams.get('q'), 'quiet Gokarna -site:reddit.com -site:instagram.com');
  assert.deepEqual(webResult.results.map((item) => item.domain), ['blog.example']);
});

test('returns successful sources during partial failures and retries failed sources next time', async () => {
  let calls = 0;
  const service = createSearchService({
    env: tavilyEnv,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      if (body.include_domains) throw new Error('private provider error with test-server-only-key');
      return json({ results: [mockResult('https://travel.example/place')] });
    },
  });
  const result = await service.search('Gokarna');
  assert.equal(result.results.length, 1);
  assert.equal(result.warnings.length, 3);
  assert.equal(JSON.stringify(result).includes('test-server-only-key'), false);
  await service.search('Gokarna');
  assert.equal(calls, 6);
});

test('provider errors do not expose upstream response bodies or credentials', async () => {
  const service = createSearchService({
    env: tavilyEnv,
    fetchImpl: async () => json({ error: 'test-server-only-key expired' }, 401),
  });
  await assert.rejects(service.search('Gokarna', { source: 'web' }), (error) => {
    assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(error.status, 502);
    assert.equal(error.message.includes('test-server-only-key'), false);
    return true;
  });
});

test('timeouts cover stalled providers and abort their request', async () => {
  let signal;
  const service = createSearchService({
    env: tavilyEnv, timeoutMs: 15,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(service.search('Gokarna', { source: 'web' }), { code: 'SEARCH_TIMEOUT', status: 504 });
  assert.equal(signal.aborted, true);
});

test('bounds response sizes before decoding provider data', async () => {
  const service = createSearchService({
    env: tavilyEnv,
    fetchImpl: async () => new Response('{}', { headers: { 'Content-Length': '5000000' } }),
  });
  await assert.rejects(service.search('Gokarna', { source: 'web' }), { code: 'PROVIDER_UNAVAILABLE' });
});

test('coalesces concurrent identical queries, bounds concurrency, and expires cached results', async () => {
  let timestamp = 1000;
  let calls = 0;
  let release;
  const firstResponse = new Promise((resolve) => { release = resolve; });
  const service = createSearchService({
    env: tavilyEnv, now: () => timestamp, cacheTtlMs: 100, maxConcurrentSearches: 1, maxCacheEntries: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) await firstResponse;
      return json({ results: [mockResult('https://travel.example/place')] });
    },
  });
  const first = service.search('Gokarna', { source: 'web' });
  const duplicate = service.search('gokarna', { source: 'web' });
  await assert.rejects(service.search('Mysore', { source: 'web' }), { code: 'SEARCH_BUSY' });
  release();
  assert.equal((await first).cached, false);
  assert.equal((await duplicate).cached, true);
  assert.equal((await service.search('Gokarna', { source: 'web' })).cached, true);
  assert.equal(calls, 1);
  timestamp += 101;
  await service.search('Gokarna', { source: 'web' });
  assert.equal(calls, 2);
  await service.search('Mysore', { source: 'web' });
  await service.search('Gokarna', { source: 'web' });
  assert.equal(calls, 4);
});

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('HTTP API returns honest health, 503 configuration status, validation errors, and 404s', async () => {
  const app = createApp({ service: createSearchService({ env: {} }) });
  await withServer(app, async (base) => {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.deepEqual(health, { ok: true, search: { configured: false, provider: null } });
    const unavailable = await fetch(`${base}/api/search?q=Gokarna`);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'SEARCH_NOT_CONFIGURED');
    assert.equal((await fetch(`${base}/api/search?q=x`)).status, 400);
    assert.equal((await fetch(`${base}/api/search?q=Gokarna&source=unknown`)).status, 400);
    assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
  });
});

test('HTTP API limits requests and allows a new window without trusting forwarded IP headers', async () => {
  let timestamp = 1000;
  const app = createApp({ service: createSearchService({ env: {} }), now: () => timestamp, rateLimit: 2, windowMs: 1000 });
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/search?q=Gokarna`)).status, 503);
    assert.equal((await fetch(`${base}/api/search?q=Gokarna`)).status, 503);
    const limited = await fetch(`${base}/api/search?q=Gokarna`, { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '1');
    timestamp += 1001;
    assert.equal((await fetch(`${base}/api/search?q=Gokarna`)).status, 503);
  });
});
