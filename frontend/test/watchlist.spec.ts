import { test, expect, type Page } from '@playwright/test';

async function fixtures(page: Page) {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()); requests.push(u.pathname + u.search);
    const id = u.pathname.includes('/2/') ? '2' : '1';
    const symbol = id === '2' ? 'SECOND' : 'FIRST';
    let body: unknown;
    if (u.pathname === '/api/auth/me') body = { user: { id: '1', email: 'analyst@example.test', name: 'Analyst' } };
    else if (u.searchParams.get('format') === 'csv') return route.fulfill({ contentType: 'text/csv', body: 'symbol,price\nFIRST,0' });
    else if (u.pathname === '/api/watchlists') body = { rows: [
      { id: '1', name: 'Canadian coverage', description: 'Canadian companies', tags: ['Canada'], count: 26 },
      { id: '2', name: 'US coverage', description: '', tags: ['US'], count: 1 },
    ] };
    else if (u.pathname.endsWith('/companies')) body = { rows: [{ id, symbol, name: `${symbol} Company`, price: 0, day: -2, week: 0, month: null, ytd: 4, year: 3, quotedAt: '2026-09-15T20:00:00Z', period: '2026-06-30', revenue: 1000, eps: 0 }], total: id === '1' ? 26 : 1, pages: id === '1' ? 2 : 1, coverage: id === '1' ? 26 : 1 };
    else if (u.pathname.endsWith('/news')) body = { rows: [{ id, symbol, company: `${symbol} Company`, title: `${symbol} reports quarterly earnings`, published: '2026-09-15T15:00:00Z', category: 'Financials', publisher: 'Newsfile', url: 'https://example.test/news' }], total: 26, pages: 2 };
    else if (u.pathname.endsWith('/filters')) body = { categories: ['Financials'], publishers: ['Newsfile'], exchanges: ['TSX+Venture'], companies: [{ id: '10', symbol, name: `${symbol} Company` }] };
    else if (u.pathname.endsWith('/earnings')) body = { rows: [{ symbol, name: `${symbol} Company`, date: '2026-09-17', epsEstimated: 0, epsActual: null }], coverage: id === '1' ? 26 : 1 };
    else if (u.pathname.endsWith('/calendar')) body = { rows: [{ date: '2026-09-16 12:30:00', country: 'CA', event: 'Canada CPI', impact: 'High', actual: 0, estimate: null, previous: 2, unit: '%' }] };
    else body = { rows: [] };
    await route.fulfill({ json: body });
  });
  return requests;
}

test('watchlist selection, filters, pagination and CSV work at both viewports', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const requests = await fixtures(page);
  await page.goto('/watchlist');
  await expect(page.getByRole('heading', { name: 'Companies & performance' })).toBeVisible();
  await expect(page.getByText('FIRST reports quarterly earnings')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Upcoming earnings estimates' })).toContainText('FIRST');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('watchlist.png') });
  await page.getByLabel('Next companies page').click();
  await expect.poll(() => requests.some((r) => /companies\?.*page=2/.test(r))).toBe(true);
  await page.getByLabel('Financial period').selectOption('annual');
  await expect.poll(() => requests.some((r) => /companies\?report=annual.*page=1/.test(r))).toBe(true);
  await page.getByText('More news filters').click();
  await page.getByRole('combobox', { name: 'Exchange', exact: true }).selectOption('TSX+Venture');
  await expect.poll(() => requests.some((r) => r.includes('exchange=TSX%2BVenture'))).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByLabel('Download news CSV').click();
  expect((await download).suggestedFilename()).toBe('watchlist-news.csv');
  await page.getByRole('heading', { name: 'News releases', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('watchlist-news.png') });
  await page.getByRole('heading', { name: 'Economic release calendar', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('watchlist-calendar.png') });
  await page.getByRole('combobox', { name: 'Watchlist', exact: true }).selectOption('2');
  await expect(page.getByText('SECOND reports quarterly earnings')).toBeVisible();
  await expect(page.getByText('FIRST reports quarterly earnings')).toHaveCount(0);
  await page.getByLabel('Find a watchlist').fill('no matching list');
  await expect(page.getByText('No results for this selection.')).toBeVisible();
  await expect(page.getByText('Canada CPI')).toBeVisible();
  expect(errors).toEqual([]);
});

test('watchlist partial outages preserve other panels and retry successfully', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/watchlists/*/earnings?*', (r) => r.fulfill({ status: 502, json: { error: 'Earnings temporarily unavailable' } }));
  await page.goto('/watchlist');
  const failure = page.getByRole('alert').filter({ hasText: 'Earnings temporarily unavailable' });
  await expect(failure).toBeVisible();
  await expect(page.getByText('FIRST reports quarterly earnings')).toBeVisible();
  await page.getByLabel('Financial period').selectOption('annual');
  await page.unroute('**/api/watchlists/*/earnings?*');
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'Upcoming earnings estimates' })).toBeVisible();
  await expect(page.getByLabel('Financial period')).toHaveValue('annual');
  await page.getByLabel('Calendar from').fill('2026-12-31');
  await page.getByLabel('Calendar to').fill('2026-01-01');
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a date range' })).toBeVisible();
  await expect(page.getByLabel('Download calendar CSV')).toBeDisabled();
});
