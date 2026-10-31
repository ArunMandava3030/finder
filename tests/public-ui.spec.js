import { test, expect } from '@playwright/test';

const apiRequests = new WeakMap();

test.beforeEach(async ({ page }) => {
  const requests = [];
  apiRequests.set(page, requests);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173' && /\/(?:api)(?:\/|$)/.test(url.pathname)) {
      requests.push(url.pathname);
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(apiRequests.get(page), 'GitHub Pages must work without an application API').toEqual([]);
});

async function mockWikimedia(page, { empty = false } = {}) {
  const requests = [];
  await page.route(/^https:\/\/en\.(?:wikipedia|wikivoyage)\.org\/w\/api\.php(?:\?|$)/, async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const voyage = url.hostname === 'en.wikivoyage.org';
    const fullGuide = voyage && !url.searchParams.has('generator');
    const extract = fullGuide
      ? 'Gokarna is a coastal town in Karnataka.\n\n== See ==\nHalf Moon Beach is a small coastal cove reached along the walking route.\n\n== Do ==\nExplore the coastal paths in daylight and carry drinking water.\n\n== Eat ==\nThe town has local restaurants.'
      : voyage
        ? 'A community-edited travel guide to Gokarna, its beaches, and coastal walks.'
        : 'Gokarna is a town on the coast of Karnataka in India.';
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      json: {
        batchcomplete: true,
        query: {
          pages: empty ? [] : [{
            pageid: voyage ? 100 : 200,
            title: 'Gokarna',
            index: 1,
            extract,
            fullurl: `https://en.${voyage ? 'wikivoyage' : 'wikipedia'}.org/wiki/Gokarna`,
          }],
        },
      },
    });
  });
  return requests;
}

async function searchFor(page, query) {
  await page.getByRole('searchbox').fill(query);
  await page.getByRole('searchbox').press('Enter');
}

test('the static project subpath loads its scripts, styles, and photographs', async ({ page }) => {
  await mockWikimedia(page);
  const failedAssets = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === 'http://127.0.0.1:4173' && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${url.pathname}`);
    }
  });
  await page.goto('./', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'A little off the beaten path.' })).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await page.locator('img[loading="lazy"]').evaluateAll(images => {
    images.forEach(image => { image.loading = 'eager'; });
  });
  await expect.poll(() => page.locator('img').evaluateAll(images =>
    images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0),
  )).toBe(true);
  const assetPaths = await page.locator('script[src], link[rel="stylesheet"], img[src]').evaluateAll(elements =>
    elements.map(element => new URL(element.src || element.href, document.baseURI))
      .filter(url => url.origin === window.location.origin)
      .map(url => url.pathname),
  );
  expect(assetPaths.some(path => path.startsWith('/finder/assets/'))).toBe(true);
  expect(assetPaths.some(path => path.startsWith('/finder/images/'))).toBe(true);
  expect(assetPaths.every(path => path.startsWith('/finder/'))).toBe(true);
  expect(failedAssets).toEqual([]);
  await expect(page.getByRole('button', { name: 'Connect search', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Connect live search' })).toHaveCount(0);
});

test('a compact hashtag retrieves public travel guides without credentials', async ({ page }) => {
  const requests = await mockWikimedia(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await searchFor(page, '#hiddenplacegokarna');
  await expect(page.locator('.web-result a[href="https://en.wikivoyage.org/wiki/Gokarna"]').first()).toBeVisible();
  await expect(page.locator('.web-result a[href="https://en.wikipedia.org/wiki/Gokarna"]').first()).toBeVisible();
  expect(requests.some(url => url.hostname === 'en.wikipedia.org')).toBe(true);
  expect(requests.some(url => url.hostname === 'en.wikivoyage.org')).toBe(true);
  for (const url of requests.filter(url => url.searchParams.has('generator'))) {
    expect(url.searchParams.get('origin')).toBe('*');
    expect(url.searchParams.get('gsrsearch')).toMatch(/gokarna/i);
    expect(url.searchParams.get('gsrsearch')).not.toContain('#hiddenplace');
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('TAVILY_API_KEY', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: /Field guide/ }).click();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await expect(page.locator('.place-card').getByRole('heading', { name: 'Paradise Beach' })).toBeVisible();
  await page.getByRole('button', { name: /Travel guides/ }).click();
  await expect(page.locator('.web-result a[href="https://en.wikivoyage.org/wiki/Gokarna"]').first()).toBeVisible();
});

test('public results filter by their actual Wikimedia source', async ({ page }) => {
  await mockWikimedia(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await searchFor(page, '#hiddenplacegokarna');
  await expect(page.locator('.web-result').first()).toBeVisible();
  await page.getByRole('button', { name: 'Wikipedia', exact: true }).click();
  await expect(page.locator('.web-result')).toHaveCount(1);
  await expect(page.locator('.web-result a')).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Gokarna');
  await page.getByRole('button', { name: 'Wikivoyage', exact: true }).click();
  await expect(page.locator('.web-result').first()).toBeVisible();
  const voyageLinks = await page.locator('.web-result a').evaluateAll(links => links.map(link => link.href));
  expect(voyageLinks.length).toBeGreaterThan(0);
  expect(voyageLinks.every(href => new URL(href).hostname === 'en.wikivoyage.org')).toBe(true);
  await page.getByRole('button', { name: 'All guides', exact: true }).click();
  await expect(page.locator('.web-result a[href="https://en.wikipedia.org/wiki/Gokarna"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reddit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Instagram', exact: true })).toHaveCount(0);
  for (const link of await page.locator('.web-result a').all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  }
});

test('external web and social searches encode the query and open safely in a new tab', async ({ page }) => {
  await mockWikimedia(page, { empty: true });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await searchFor(page, 'Gokarna & Coorg #quiet coves');
  const expected = [
    ['Search the web', 'duckduckgo.com', 'gokarna & coorg quiet coves hidden places travel tips'],
    ['Search Reddit', 'www.reddit.com', 'gokarna & coorg quiet coves travel tips'],
    ['Search Instagram', 'www.google.com', 'site:instagram.com gokarna & coorg quiet coves hidden places'],
  ];
  for (const [name, hostname, query] of expected) {
    const link = page.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    const href = await link.getAttribute('href');
    const url = new URL(href);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe(hostname);
    expect([...url.searchParams.keys()]).toEqual(['q']);
    expect(url.searchParams.get('q')).toBe(query);
    expect(url.hash).toBe('');
    expect(href).toContain('%26');
  }
});

test('saved places persist after reloading the project subpath', async ({ page }) => {
  await mockWikimedia(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Save Paradise Beach', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Unsave Paradise Beach', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Saved places/ }).click();
  await expect(page.locator('.place-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Paradise Beach', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unsave Paradise Beach', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next adventure starts with a bookmark.' })).toBeVisible();
});

test('an unknown destination with empty public results does not show unrelated places', async ({ page }) => {
  const requests = await mockWikimedia(page, { empty: true });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await searchFor(page, 'Uncharted Zzyzx Valley');
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Find my elsewhere', exact: true })).toBeEnabled();
  await expect(page.locator('.web-result')).toHaveCount(0);
  await expect(page.locator('.place-card')).toHaveCount(0);
  await page.getByRole('button', { name: /Field guide/ }).click();
  await expect(page.locator('.place-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'A little further off our map.' })).toBeVisible();
});

test('the home and public search views fit desktop and small phones', async ({ page }, testInfo) => {
  await mockWikimedia(page);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.place-card')).toHaveCount(6);
  const initialViewport = page.viewportSize();
  const widths = testInfo.project.name === 'mobile' ? [390, 320] : [1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: initialViewport.height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await searchFor(page, '#hiddenplacegokarna');
  await expect(page.locator('.web-result').first()).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: initialViewport.height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

const indexFixture = {
  schemaVersion: 1,
  destinations: [
    { id: 'gokarna', city: 'Gokarna', aliases: [], state: 'Karnataka', count: 1, status: 'partial', fetchedAt: '2026-10-28T10:00:00Z', attemptedAt: '2026-10-30T10:00:00Z', providers: [{ provider: 'wikivoyage', status: 'ok', count: 1 }, { provider: 'osm', status: 'unavailable', count: 0 }], warnings: ['The map source was unavailable.'], discussionStatus: { status: 'error' } },
    { id: 'hampi', city: 'Hampi', aliases: [], state: 'Karnataka', count: 1, status: 'ok' },
  ],
  places: [
    { id: 'g1', destinationId: 'gokarna', city: 'Gokarna', state: 'Karnataka', name: 'Test Coastal Cove', category: 'Beaches', description: 'A secluded cove described by the community guide.', coordinates: { lat: 14.5, lng: 74.3 }, discovery: { label: 'Offbeat signal found', score: 70, confidence: 'low', reasons: ['A source describes it as secluded'] }, sources: [{ publisher: 'Wikivoyage', title: 'Gokarna cove', url: 'https://en.wikivoyage.org/wiki/Gokarna', retrievedAt: '2026-10-28T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', license: 'CC BY-SA 4.0' }] },
    { id: 'h1', destinationId: 'hampi', city: 'Hampi', state: 'Karnataka', name: 'Test Hampi Temple', category: 'Culture', description: 'A named temple.', discovery: { label: 'Worth investigating', score: 40, confidence: 'low', reasons: [] }, sources: [{ publisher: 'Wikivoyage', url: 'https://en.wikivoyage.org/wiki/Hampi' }] },
  ],
  discussions: [],
};

test('the collected index searches real place records and exposes source age and missing reviews', async ({ page }) => {
  await mockWikimedia(page);
  await page.route('**/data/india-index.json', route => route.fulfill({ json: indexFixture }));
  await page.goto('./');
  const index = page.getByRole('region', { name: 'Explore the India place index' });
  await expect(index.locator('.india-place')).toHaveCount(1);
  await expect(index.getByText('Test Coastal Cove', { exact: true })).toBeVisible();
  await index.getByText('Sources & why it appears', { exact: true }).click();
  await expect(index.getByText(/Collected 28 Oct 2026 · Source updated 1 Sept 2026/)).toBeVisible();
  await expect(index.getByText(/Visitor ratings are not available/)).toBeVisible();
  await expect(index.getByText(/Discussion search was unavailable/)).toBeVisible();
  await page.getByLabel('Index destination').selectOption('');
  await expect(index.locator('.india-place')).toHaveCount(2);
  await page.getByLabel('Index destination').selectOption('hampi');
  await expect(index.getByText('Test Hampi Temple', { exact: true })).toBeVisible();
  await expect(index.getByText('Test Coastal Cove', { exact: true })).toHaveCount(0);
  await searchFor(page, '#hiddenplacegokarna');
  await expect(index.getByText('Test Coastal Cove', { exact: true })).toBeVisible();
  await expect(index.getByText('Test Hampi Temple', { exact: true })).toHaveCount(0);
  await page.getByLabel('Index category').selectOption('Culture');
  await expect(index.locator('.india-place')).toHaveCount(0);
});

test('an unavailable index leaves the rest of the static site usable', async ({ page }) => {
  await mockWikimedia(page);
  await page.route('**/data/india-index.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('./');
  await expect(page.getByText(/collected place index couldn’t load/)).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await searchFor(page, 'Gokarna');
  await expect(page.locator('.web-result').first()).toBeVisible();
});

test('official tourism records show their provider and factual source attribution', async ({ page }) => {
  await mockWikimedia(page);
  const fixture = structuredClone(indexFixture);
  fixture.destinations[0].providers.push({ provider: 'scrapling', status: 'ok', count: 1 });
  fixture.places[0].sources = [{ provider: 'scrapling', publisher: 'Karnataka Tourism', title: 'Test Coastal Cove', url: 'https://karnatakatourism.org/en/attractions/test-cove/', retrievedAt: '2026-10-30T10:00:00Z', license: 'Factual metadata; see source terms' }];
  await page.route('**/data/india-index.json', route => route.fulfill({ json: fixture }));
  await page.goto('./');
  const index = page.getByRole('region', { name: 'Explore the India place index' });
  await index.getByText('Collection status', { exact: true }).click();
  await expect(index.getByText('Official tourism websites: ok (1 places)', { exact: true })).toBeVisible();
  await index.getByText('Sources & why it appears', { exact: true }).click();
  await expect(index.locator('.india-source').getByText(/Place name and source link/)).toBeVisible();
  await expect(index.locator('.india-source').getByText(/Text adapted/)).toHaveCount(0);
});
