import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createSearchService } from '../server/search.mjs';

const mockEngine = overrides => ({
  destinations: [{ id: 'gokarna', city: 'Gokarna', state: 'Karnataka' }],
  discover: async query => ({ destination: { id: 'gokarna' }, query, places: [], providers: [{ provider: 'wikivoyage', status: 'ok' }], warnings: [], cached: false, stale: false }),
  evidence: async query => ({ query, items: [], providers: [{ provider: 'reddit', status: 'not_configured' }, { provider: 'ddgs', status: 'not_configured' }], warnings: [], reviewCount: 0 }),
  ...overrides,
});

async function withServer(options, run) {
  const app = createApp({ service: createSearchService({ env: {} }), engine: mockEngine(), ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('optional API lists supported destinations and passes a bounded discovery request without enabling force refresh', async () => {
  let captured;
  await withServer({ engine: mockEngine({ discover: async (query, options) => { captured = { query, options }; return { places: [{ id: 'a' }], providers: [], stale: false }; } }) }, async base => {
    const listResponse = await fetch(`${base}/api/destinations`);
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get('cache-control'), 'no-store');
    const list = await listResponse.json();
    assert.equal(list.total, 1);
    assert.equal(list.destinations[0].city, 'Gokarna');
    const result = await fetch(`${base}/api/discover?q=%23hiddenplacegokarna&refresh=true`);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).places[0].id, 'a');
    assert.equal(captured.query, '#hiddenplacegokarna');
    assert.equal(captured.options.refresh, undefined);
    assert.ok(captured.options.signal instanceof AbortSignal);
  });
});

test('optional API rejects empty, oversized and repeated query parameters before reaching providers', async () => {
  let calls = 0;
  const fail = async () => { calls += 1; assert.fail('invalid query must not reach providers'); };
  await withServer({ engine: mockEngine({ discover: fail, evidence: fail }) }, async base => {
    for (const endpoint of ['discover', 'evidence']) {
      for (const suffix of ['', '?q=aa', '?q=gokarna&q=hampi', `?q=${'x'.repeat(161)}`]) {
        const result = await fetch(`${base}/api/${endpoint}${suffix}`);
        assert.equal(result.status, 400);
        assert.equal((await result.json()).error.code, 'INVALID_QUERY');
      }
    }
    assert.equal(calls, 0);
  });
});

test('optional API maps unavailable and unknown-destination errors and hides private error messages', async () => {
  await withServer({ engine: mockEngine({ discover: async query => {
    if (query === 'Atlantis') throw Object.assign(new Error('private provider debug'), { code: 'UNKNOWN_DESTINATION' });
    if (query === 'Gokarna') throw Object.assign(new Error('secret token in upstream error'), { code: 'DISCOVERY_UNAVAILABLE' });
    throw new Error('private filesystem location');
  } }) }, async base => {
    for (const [query, expectedStatus, code] of [['Atlantis', 400, 'UNKNOWN_DESTINATION'], ['Gokarna', 502, 'DISCOVERY_UNAVAILABLE'], ['Hampi', 500, 'DISCOVERY_ERROR']]) {
      const result = await fetch(`${base}/api/discover?q=${query}`);
      assert.equal(result.status, expectedStatus);
      const body = await result.json();
      assert.equal(body.error.code, code);
      assert.doesNotMatch(JSON.stringify(body), /private|secret/);
    }
  });
});

test('optional evidence API distinguishes no configuration, provider outage and successful partial evidence', async () => {
  await withServer({ engine: mockEngine({ evidence: async query => ({
    items: query === 'partial' ? [{ url: 'https://example.org/source', isReview: false }] : [], warnings: [], reviewCount: 0,
    providers: [{ provider: 'ddgs', status: query === 'missing' ? 'not_configured' : query === 'partial' ? 'ok' : 'unavailable' }, { provider: 'reddit', status: 'not_configured' }],
  }) }) }, async base => {
    for (const [query, status, code] of [['missing', 503, 'EVIDENCE_NOT_CONFIGURED'], ['outage', 502, 'EVIDENCE_UNAVAILABLE'], ['partial', 200, undefined]]) {
      const result = await fetch(`${base}/api/evidence?q=${query}`);
      const body = await result.json();
      assert.equal(result.status, status);
      assert.equal(body.error?.code, code);
      assert.equal(body.reviewCount, 0);
    }
  });
});

test('optional routes and legacy search share one IP quota, ignoring forwarded IP spoofing', async () => {
  let timestamp = 1000;
  await withServer({ now: () => timestamp, rateLimit: 3, windowMs: 1000 }, async base => {
    assert.equal((await fetch(`${base}/api/destinations`)).status, 200);
    assert.equal((await fetch(`${base}/api/discover?q=Gokarna`)).status, 200);
    assert.equal((await fetch(`${base}/api/evidence?q=Quiet+Cove`)).status, 503);
    const result = await fetch(`${base}/api/search?q=Gokarna`, { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('retry-after'), '1');
    const body = await result.json();
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.deepEqual(body.results, []);
    timestamp += 1001;
    assert.equal((await fetch(`${base}/api/destinations`)).status, 200);
  });
});

test('optional API deadlines return 504 and abort the waiter even when an injected engine stalls', async () => {
  let signal;
  await withServer({ discoveryRequestTimeoutMs: 10, engine: mockEngine({ discover: async (_query, options) => { signal = options.signal; return new Promise(() => {}); } }) }, async base => {
    const result = await fetch(`${base}/api/discover?q=Gokarna`);
    assert.equal(result.status, 504);
    assert.equal((await result.json()).error.code, 'DISCOVERY_TIMEOUT');
    assert.equal(signal.aborted, true);
  });
});
