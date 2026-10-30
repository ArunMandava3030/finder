import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function mockSearch(page, { configured = false, results = [], warnings = [] } = {}) {
  const provider = configured ? 'tavily' : null;
  await page.route('**/api/health', route => route.fulfill({
    json: { ok: true, search: { configured, provider } },
  }));
  await page.route('**/api/search?**', route => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q');
    return route.fulfill({
      status: configured ? 200 : 503,
      json: {
        query, normalizedQuery: query, source: 'all', configured, provider,
        results, warnings, retrievedAt: '2026-10-29T12:00:00.000Z', cached: false,
        ...(!configured ? { error: { code: 'SEARCH_NOT_CONFIGURED', message: 'Live search is not connected yet.' } } : {}),
      },
    });
  });
}

async function searchFor(page, query) {
  await page.getByRole('searchbox').fill(query);
  await page.getByRole('searchbox').press('Enter');
}

test('the starter guide supports categories, destinations, and list layout', async ({ page }) => {
  await mockSearch(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'A little off the beaten path.' })).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Beaches', exact: true }).click();
  await expect(page.locator('.place-card')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Beaches', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Culture', exact: true }).click();
  await expect(page.locator('.place-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'All discoveries', exact: true }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Your next destination').selectOption('Coorg');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.place-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Mandalpatti Viewpoint' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nisargadhama' })).toBeVisible();
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.places-grid')).toHaveClass(/list-layout/);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'There’s more out there' }).click();
  await expect(page.locator('.place-card')).toHaveCount(12);
});

test('a compact Gokarna hashtag shows the sourced guide and connection notice', async ({ page }) => {
  await mockSearch(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await searchFor(page, '#hiddenplacegokarna');
  await expect(page.getByRole('status')).toContainText('Live search is not connected yet');
  await expect(page.locator('.place-card')).toHaveCount(6);
  await expect(page.locator('.place-card').getByRole('heading', { name: 'Paradise Beach' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect search', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect live search' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('TAVILY_API_KEY');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Across the web/ }).click();
  await expect(page.getByRole('heading', { name: 'A world of stories, one connection away.' })).toBeVisible();
  await expect(page.locator('.web-result')).toHaveCount(0);
});

test('unknown destinations do not masquerade as matching curated places', async ({ page }) => {
  await mockSearch(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await searchFor(page, 'Uncharted Zzyzx Valley');
  await expect(page.getByRole('heading', { name: 'A little further off our map.' })).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore the field guide', exact: true }).click();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await expect(page.getByRole('searchbox')).toHaveValue('');
});

test('saved places survive reload and can be removed from the saved view', async ({ page }) => {
  await mockSearch(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Save Paradise Beach', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave Paradise Beach', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Unsave Paradise Beach', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Saved places/ }).click();
  await expect(page.getByRole('heading', { name: 'For your someday list.' })).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Unsave Paradise Beach', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next adventure starts with a bookmark.' })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Save Paradise Beach', exact: true })).toBeVisible();
});

test('place details link to original sources and return focus on Escape', async ({ page }) => {
  await mockSearch(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const explore = page.getByRole('button', { name: 'Explore Paradise Beach', exact: true });
  await explore.click();
  const dialog = page.getByRole('dialog', { name: 'Paradise Beach', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Illustrative photo', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Find on map' })).toHaveAttribute('href', /google\.com\/maps\/search/);
  const sources = dialog.locator('.detail-source');
  expect(await sources.count()).toBeGreaterThan(0);
  for (const source of await sources.all()) {
    await expect(source).toHaveAttribute('href', /^https:\/\//);
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', /noopener/);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(explore).toBeFocused();
});

test('live results preserve source links, filter by source, and show coverage warnings', async ({ page }) => {
  const warning = 'Instagram coverage is limited to publicly indexed pages.';
  await mockSearch(page, {
    configured: true,
    warnings: [warning],
    results: [
      { id: 'web-1', title: 'Gokarna coastal guide', url: 'https://example.org/gokarna', excerpt: 'A published guide to quieter coastal walks.', source: 'web', domain: 'example.org' },
      { id: 'reddit-1', title: 'Travellers share their Gokarna tips', url: 'https://www.reddit.com/r/travel/comments/example', excerpt: 'Visitors discuss walking routes and daytime access.', source: 'reddit', domain: 'reddit.com' },
      { id: 'instagram-1', title: 'A public Gokarna photo diary', url: 'https://www.instagram.com/p/example/', excerpt: 'A publicly indexed coastal photo caption.', source: 'instagram', domain: 'instagram.com' },
    ],
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await searchFor(page, '#hiddenplacegokarna');
  await expect(page.locator('.web-result')).toHaveCount(3);
  await expect(page.getByText(warning, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gokarna coastal guide' })).toHaveAttribute('href', 'https://example.org/gokarna');
  await page.getByRole('button', { name: 'Reddit', exact: true }).click();
  await expect(page.locator('.web-result')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Travellers share their Gokarna tips' })).toBeVisible();
  await page.getByRole('button', { name: 'Instagram', exact: true }).click();
  await expect(page.locator('.web-result')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'A public Gokarna photo diary' })).toBeVisible();
  await page.getByRole('button', { name: 'Travel sites', exact: true }).click();
  await expect(page.locator('.web-result')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Gokarna coastal guide' })).toBeVisible();
  await page.getByRole('button', { name: /Field guide/ }).click();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await expect(page.locator('.web-result')).toHaveCount(0);
});

test('partial provider warnings remain visible when the unavailable source is selected', async ({ page }) => {
  const warning = 'Reddit results could not be retrieved. Other available sources are shown.';
  await mockSearch(page, {
    configured: true,
    warnings: [warning],
    results: [
      { id: 'web-only', title: 'Available Gokarna travel guide', url: 'https://example.org/gokarna', excerpt: 'A published coastal travel guide.', source: 'web', domain: 'example.org' },
    ],
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await searchFor(page, 'Gokarna');
  await expect(page.locator('.web-result')).toHaveCount(1);
  await expect(page.getByText(warning, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reddit', exact: true }).click();
  await expect(page.locator('.web-result')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No indexed results from this source.' })).toBeVisible();
  await expect(page.getByText(warning, { exact: true })).toBeVisible();
});

test('returning to Discover cancels a pending search and ignores its late response', async ({ page }) => {
  await mockSearch(page, { configured: true });
  let releaseResponse;
  let markIntercepted;
  let markHandled;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const intercepted = new Promise(resolve => { markIntercepted = resolve; });
  const handled = new Promise(resolve => { markHandled = resolve; });
  await page.route('**/api/search?**', async route => {
    markIntercepted();
    await responseGate;
    try {
      await route.fulfill({
        json: {
          query: 'Gokarna', normalizedQuery: 'Gokarna', source: 'all', configured: true, provider: 'tavily',
          retrievedAt: '2026-10-29T12:00:00.000Z', cached: false,
          warnings: ['Stale provider warning'],
          results: [{ id: 'late', title: 'Stale search result', url: 'https://example.org/late', excerpt: 'This response arrived after leaving search.', source: 'web', domain: 'example.org' }],
        },
      });
    } finally {
      markHandled();
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await searchFor(page, 'Gokarna');
  await intercepted;
  await expect(page.getByRole('heading', { name: 'Following a few promising trails…' })).toBeVisible();
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: request => new URL(request.url()).pathname === '/api/search',
    timeout: 8_000,
  });
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  releaseResponse();
  await Promise.all([handled, cancelled]);
  await expect(page.getByRole('heading', { name: 'A little off the beaten path.' })).toBeVisible();
  await expect(page.locator('.place-card')).toHaveCount(6);
  await expect(page.locator('.web-result')).toHaveCount(0);
  await expect(page.getByText('Stale provider warning', { exact: true })).toHaveCount(0);
  await expect(page.locator('.search-notice')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Find my elsewhere', exact: true })).toBeEnabled();
});

test('the page fits the viewport and produces a local preview', async ({ page }, testInfo) => {
  await mockSearch(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.place-card')).toHaveCount(6);
  const originalViewport = page.viewportSize();
  const widths = testInfo.project.name === 'mobile' ? [390, 320] : [1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: originalViewport.height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize(originalViewport);
  await page.locator('img[loading="lazy"]').evaluateAll(images => images.forEach(img => { img.loading = 'eager'; }));
  // Images are external; an unavailable photo should not fail an interaction test.
  await page.waitForFunction(() => [...document.images].every(img => img.complete), undefined, { timeout: 8_000 }).catch(() => {});
  mkdirSync('.local', { recursive: true });
  await page.screenshot({ path: `.local/elsewhere-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });
});
