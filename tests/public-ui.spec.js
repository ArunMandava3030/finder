import { test, expect } from '@playwright/test';

const date = '2026-10-31T00:00:00.000Z';
const destinations = [
  { id: 'gokarna', city: 'Gokarna', state: 'Karnataka' },
  { id: 'goa', city: 'Goa', state: 'Goa' },
  { id: 'varkala', city: 'Varkala', state: 'Kerala' },
  { id: 'jaipur', city: 'Jaipur', state: 'Rajasthan' },
].map(item => ({ ...item, aliases: [], count: 1, status: 'ok', fetchedAt: date }));

function place(id, name, destinationId, status = 'quieter') {
  const destination = destinations.find(item => item.id === destinationId);
  const source = { kind: 'guide', provider: 'wikivoyage', url: `https://en.wikivoyage.org/wiki/${destination.city}#${id}`, title: name, publisher: 'Wikivoyage', license: 'CC BY-SA 4.0', retrievedAt: date, updatedAt: date, excerpt: status === 'quieter' ? `${name} receives few visitors.` : status === 'busy' ? `${name} is crowded.` : 'A named place from a public travel guide.' };
  return { id, name, destinationId, city: destination.city, state: destination.state, category: 'Nature', description: 'A named place from a public travel guide.', sources: [source], crowd: { status, confidence: 'low', level: status === 'quieter' ? 'low' : null, evidence: status === 'quieter' ? [{ ...source, claim: `${name} has fewer visitors according to its source.`, sourceUpdatedAt: date }] : [] } };
}

const fixture = { schemaVersion: 1, generatedAt: date, destinations, discussions: [], places: [
  place('cove', 'Coastal Cove', 'gokarna'), place('cliff', 'Little Cliff', 'gokarna'),
  place('goa-cove', 'Goa Cove', 'goa'), place('kerala-cove', 'Kerala Cove', 'varkala'),
  place('garden', 'Jaipur Garden', 'jaipur', 'unknown'),
  place('busy', 'Busy Main Beach', 'gokarna', 'busy'),
  place('unknown', 'Gokarna Temple', 'gokarna', 'unknown'),
] };

function wikiPage(title, content) {
  return { title, fullurl: `https://en.wikivoyage.org/wiki/${encodeURIComponent(title)}`, revisions: [{ timestamp: date, slots: { main: { content } } }] };
}

async function mockGuides(page, handler = () => []) {
  await page.route('https://en.wikivoyage.org/w/api.php?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    const pages = await handler(params);
    await route.fulfill({ json: { batchcomplete: true, query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/data/india-index.json', route => route.fulfill({ json: fixture }));
  await mockGuides(page);
  const apiRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/finder/api/')) apiRequests.push(request.url()); });
  page.on('close', () => expect(apiRequests, 'Pages works without an application API').toEqual([]));
});

async function search(page, query) {
  await page.getByRole('combobox', { name: 'Search places in India' }).fill(query);
  await page.getByRole('button', { name: 'Find places', exact: true }).click();
}

test('home is a simple nationwide search with diverse quieter places and no filter panels', async ({ page }) => {
  const failures = [];
  page.on('response', response => { if (response.url().includes('127.0.0.1:4173') && response.status() >= 400) failures.push(response.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Find a quieter corner of India.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search places in India' })).toHaveCount(1);
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('.discovery-card')).toHaveCount(4);
  expect(await page.locator('.discovery-card h3').allTextContents()).toEqual(['Coastal Cove', 'Goa Cove', 'Kerala Cove', 'Little Cliff']);
  await expect(page.getByRole('heading', { name: 'Busy Main Beach' })).toHaveCount(0);
  await expect(page.locator('.general-guides')).toHaveCount(0);
  expect(failures).toEqual([]);
  const assetPaths = await page.locator('script[src], link[rel=stylesheet]').evaluateAll(items => items.map(item => new URL(item.src || item.href, document.baseURI)).filter(url => url.origin === location.origin).map(url => url.pathname));
  expect(assetPaths.every(path => path.startsWith('/finder/'))).toBe(true);
});

test('hashtag and natural-language city searches preserve the fewer-crowds requirement', async ({ page }) => {
  await page.goto('./');
  for (const query of ['#hiddenplacegokarna', 'less populated places in Gokarna']) {
    await search(page, query);
    await expect(page.locator('.quieter-results .discovery-card')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Goa Cove', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Busy Main Beach' })).toHaveCount(0);
  }
  await page.getByRole('button', { name: /See other places/ }).click();
  await expect(page.getByRole('heading', { name: 'Gokarna Temple' })).toBeVisible();
  await expect(page.getByText('Crowds unverified', { exact: true })).toBeVisible();
});

test('state, city alias, and place-name queries work beyond Gokarna', async ({ page }) => {
  await page.goto('./');
  await search(page, 'Kerala');
  await expect(page.locator('.quieter-results .discovery-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Kerala Cove', exact: true })).toBeVisible();
  await search(page, 'Panaji');
  await expect(page.getByRole('heading', { name: 'Goa Cove', exact: true })).toBeVisible();
  await search(page, 'Coastal Cove');
  await expect(page.locator('.quieter-results .discovery-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Coastal Cove', exact: true })).toBeVisible();
});

test('cities without quiet evidence still show available places with honest labels', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Jaipur', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jaipur Garden' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No confirmed quieter spots here yet.' })).toBeVisible();
  await expect(page.locator('.other-results .discovery-card')).toHaveCount(1);
  await expect(page.locator('.quieter-results .discovery-card')).toHaveCount(0);
});

test('a city outside the downloaded snapshot retrieves actual place listings without a key', async ({ page }) => {
  const requests = [];
  await mockGuides(page, params => {
    requests.push(params);
    return [wikiPage('Hyderabad', '{{IsPartOf|Telangana}}\n==See==\n{{see|name=Hidden Lake Garden|content=Hidden Lake Garden receives few visitors.}}\n{{see|name=Rock Garden|content=A peaceful landscaped garden.}}')];
  });
  await page.goto('./');
  await search(page, '#hiddenplacehyderabad');
  await expect(page.getByRole('heading', { name: 'Hidden Lake Garden' })).toBeVisible();
  await expect(page.locator('.quieter-results .discovery-card')).toHaveCount(1);
  await page.getByRole('button', { name: /See other places/ }).click();
  await expect(page.getByRole('heading', { name: 'Rock Garden' })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(params => params.get('origin') === '*' && params.get('prop').includes('revisions'))).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('guide failures keep collected results visible and offer a retry', async ({ page }) => {
  await page.route('https://en.wikivoyage.org/w/api.php?**', route => route.abort());
  await page.goto('./');
  await search(page, 'Jaipur');
  await expect(page.getByText('The public guide couldn’t be reached.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jaipur Garden' })).toBeVisible();
  await mockGuides(page);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('The public guide couldn’t be reached.', { exact: false })).toHaveCount(0);
});

test('missing places have a useful empty state without unrelated Gokarna results', async ({ page }) => {
  await page.goto('./');
  await search(page, 'Unlisted Village');
  await expect(page.getByRole('heading', { name: 'No confirmed quieter spots here yet.' })).toBeVisible();
  await expect(page.locator('.discovery-card')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Search traveller discussions/ })).toHaveAttribute('href', /Unlisted%20Village/);
  await page.getByRole('button', { name: 'All India', exact: true }).click();
  await expect(page.locator('.quieter-results .discovery-card')).toHaveCount(4);
});

test('bookmarks persist and can be removed from the saved view', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Save Goa Cove', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Saved (1)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your saved places' })).toBeVisible();
  await expect(page.locator('.discovery-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Unsave Goa Cove', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep a few places for later.' })).toBeVisible();
});

test('sources and maps are direct links and details stay out of the main flow', async ({ page }) => {
  await page.goto('./');
  const card = page.locator('.discovery-card').first();
  await expect(card.locator('details')).not.toHaveAttribute('open');
  await expect(card.getByRole('link', { name: 'Read source' })).toHaveAttribute('href', 'https://en.wikivoyage.org/wiki/Gokarna#cove');
  await expect(card.getByRole('link', { name: 'Find on map' })).toHaveAttribute('href', /maps\/search/);
  await card.getByText('Details & sources', { exact: true }).click();
  await expect(card.getByText('CC BY-SA 4.0', { exact: false })).toBeVisible();
  await expect(card.getByText('Source date:', { exact: false })).toBeVisible();
});

test('shareable search URLs restore the place and narrow screens do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('./?q=Kerala');
  await expect(page.getByRole('combobox', { name: 'Search places in India' })).toHaveValue('Kerala');
  await expect(page.getByRole('heading', { name: 'Kerala Cove', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Elsewhere home' }).click();
  await expect(page.getByRole('combobox', { name: 'Search places in India' })).toHaveValue('');
  await expect(page).not.toHaveURL(/q=/);
});

test('a failed snapshot still allows public city lookup', async ({ page }) => {
  await page.route('**/data/india-index.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await mockGuides(page, () => [wikiPage('Hyderabad', '==See==\n{{see|name=Lake Garden|content=A park by the lake.}}')]);
  await page.goto('./');
  await expect(page.getByText('The saved index couldn’t load.', { exact: false })).toBeVisible();
  await search(page, 'Hyderabad');
  await expect(page.getByRole('heading', { name: 'Lake Garden', exact: true })).toBeVisible();
  await expect(page.getByText('Crowds unverified', { exact: true })).toBeVisible();
});
