import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicGuideSearch, searchPublicGuides } from '../src/lib/public-search.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const page = (title, extra = {}) => ({ pageid: 1, title, index: 1, extract: `A public guide to ${title}.`, ...extra });
const pages = (...value) => json({ batchcomplete: true, query: { pages: value } });

test('public guide search handles compact hashtags and returns attributed guides and sightseeing sections in three requests', async () => {
  const requests = [];
  const result = await searchPublicGuides('#hiddenplacegokarna', {
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      requests.push({ url, options });
      if (url.searchParams.has('titles')) return pages(page('Gokarna', {
        extract: 'A town by the sea.\n\n== See ==\nA historic temple stands near the shore and a small village trail.\n\n== Do ==\n\n=== Beaches ===\n1 Quiet Cove (Near the village). A rocky place beside the sea.\n\n2 Coastal Beach (Beyond the hill). Walk along the public coastal path.\n\n== Sleep ==\nA hotel description that should not be included as sightseeing.',
      }));
      assert.equal(url.searchParams.get('gsrsearch'), 'gokarna');
      return pages(page(url.hostname.includes('wikivoyage') ? 'Gokarna' : 'Gokarna, Karnataka'));
    },
  });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url, options }) => url.searchParams.get('origin') === '*' && options.credentials === 'omit'));
  assert.equal(result.provider, 'wikimedia');
  assert.equal(result.configured, true);
  assert.equal(result.normalizedQuery, 'gokarna');
  assert.ok(result.results.some((item) => item.title === 'Gokarna · See'));
  assert.ok(result.results.some((item) => item.title === 'Gokarna · Beaches' && item.excerpt.includes('Quiet Cove')));
  assert.equal(result.results.some((item) => item.title.includes('Sleep')), false);
  assert.ok(result.results.every((item) => item.source === 'web' && item.license === 'CC BY-SA 4.0'));
  assert.ok(result.warnings.some((warning) => warning.includes('Reddit and Instagram')));
});

test('normalizes arbitrary destination hashtags and rejects queries without a destination', async () => {
  let calls = 0;
  const search = createPublicGuideSearch({ fetchImpl: async () => { calls += 1; return json({ batchcomplete: true }); } });
  for (const [query, expected] of [['#hiddenplacesTbilisi', 'tbilisi'], ['#secretspotsKyoto', 'kyoto'], ['hidden places in Jaipur', 'jaipur'], ['#slowdayscoorg', 'coorg']]) {
    assert.equal((await search(query)).normalizedQuery, expected);
  }
  const before = calls;
  for (const query of ['#hiddenplaces', '# ', '', 'x', 'a'.repeat(161), null]) {
    await assert.rejects(search(query), { code: 'INVALID_QUERY' });
  }
  assert.equal(calls, before);
});

test('empty successful APIs return no results while total failure throws a safe error', async () => {
  const empty = await searchPublicGuides('Unlisted Village', { fetchImpl: async () => json({ batchcomplete: true }) });
  assert.deepEqual(empty.results, []);
  const broken = createPublicGuideSearch({ fetchImpl: async () => { throw new Error('private upstream error'); } });
  await assert.rejects(broken('Gokarna'), (error) => {
    assert.equal(error.code, 'GUIDE_UNAVAILABLE');
    assert.equal(error.message.includes('private'), false);
    return true;
  });
});

test('partial failure returns remaining guide results and an explicit availability warning', async () => {
  const result = await searchPublicGuides('Jaipur', {
    fetchImpl: async (input) => new URL(input).hostname.includes('wikivoyage')
      ? json({ error: { code: 'ratelimited', info: 'private upstream detail' } })
      : pages(page('Jaipur')),
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].domain, 'en.wikipedia.org');
  assert.ok(result.warnings.some((warning) => warning.includes('Wikivoyage could not be reached')));
  assert.equal(JSON.stringify(result).includes('private upstream detail'), false);
});

test('failed section extraction keeps useful summaries without pretending the section was empty', async () => {
  let calls = 0;
  const result = await searchPublicGuides('Jaipur', {
    fetchImpl: async (input) => {
      calls += 1;
      return new URL(input).searchParams.has('titles') ? json({}, 503) : pages(page('Jaipur'));
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.results.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('Detailed sightseeing sections could not be loaded')));
});

test('only emits trusted original wiki URLs and renders snippets as decoded plain text', async () => {
  const result = await searchPublicGuides('Kyoto', {
    fetchImpl: async (input) => {
      if (new URL(input).searchParams.has('titles')) return json({ batchcomplete: true });
      const host = new URL(input).hostname;
      return pages(
        page('Kyoto', { extract: '<b>Gardens</b> &amp; temples &#x2014; visitors&#39; tips', fullurl: `https://${host}/wiki/Kyoto` }),
        page('Unsafe', { pageid: 2, fullurl: 'javascript:alert(1)' }),
        page('Wrong domain', { pageid: 3, fullurl: 'https://en.wikipedia.org.evil.example/wiki/Kyoto' }),
        page('Missing', { pageid: 4, missing: true }),
        page('Kyoto (film)', { pageid: 5 }),
        page('Kyoto disambiguation', { pageid: 6, pageprops: { disambiguation: '' } }),
      );
    },
  });
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((item) => item.excerpt === "Gardens & temples — visitors' tips"));
});

test('cancelling a search aborts in-flight requests and prevents additional extraction', async () => {
  const controller = new AbortController();
  const signals = [];
  const search = createPublicGuideSearch({ fetchImpl: async (_input, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  } });
  const pending = search('Gokarna', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test('provider timeout aborts stalled fetches and fails distinctly from empty results', async () => {
  const signals = [];
  const search = createPublicGuideSearch({ timeoutMs: 10, fetchImpl: async (_url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  } });
  await assert.rejects(search('Gokarna'), { code: 'GUIDE_TIMEOUT' });
  assert.ok(signals.every((signal) => signal.aborted));
});

test('successful results cache for five minutes and evict oldest entries at the configured limit', async () => {
  let now = 1_000;
  let calls = 0;
  const search = createPublicGuideSearch({ now: () => now, maxCacheEntries: 1, fetchImpl: async () => {
    calls += 1;
    return json({ batchcomplete: true });
  } });
  assert.equal((await search('Gokarna')).cached, false);
  assert.equal((await search('gokarna')).cached, true);
  assert.equal(calls, 2);
  now += 300_001;
  assert.equal((await search('Gokarna')).cached, false);
  await search('Jaipur');
  await search('Gokarna');
  assert.equal(calls, 8);
});
