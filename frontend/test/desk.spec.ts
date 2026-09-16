import { test, expect, type Page } from '@playwright/test';
import { tickDigits, niceScale } from '../app/lib/scale';
import { segments } from '../app/lib/gaps';
import { nearest, toTime } from '../app/lib/time';
import { populated, panel } from './fixtures';

const user = { id: '1', email: 'analyst@example.test', name: 'Test Analyst' };

async function session(page: Page, signedIn = true) {
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/auth/me') {
      await route.fulfill({ json: { user: signedIn ? user : null, provider: 'local' } });
    } else {
      await route.fulfill({ status: 503, json: { error: 'Provider temporarily unavailable' } });
    }
  });
}

test('login fits the viewport and preserves input after a failed attempt', async ({ page }) => {
  await session(page, false);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('typed-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Provider temporarily unavailable' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('typed-password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('signed-out visitors are redirected to login', async ({ page }) => {
  await session(page, false);
  await page.goto('/brief');
  await expect(page).toHaveURL(/\/login$/);
});

test('session outages offer retry without redirecting to login', async ({ page }) => {
  await session(page);
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 503, json: { error: 'Cannot check your session right now.' } }));
  await page.goto('/brief');
  await expect(page.getByRole('alert').filter({ hasText: 'Cannot check your session' })).toBeVisible();
  await expect(page).toHaveURL(/\/brief$/);
  await page.unroute('**/api/auth/me');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('navigation', { name: 'Desk modules' })).toBeVisible();
});

test('sign-out is reachable at every viewport and reports failures', async ({ page }) => {
  await session(page);
  await page.goto('/watchlist');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Dismiss' }) })).toContainText('Provider temporarily unavailable');
  await expect(page.getByRole('navigation', { name: 'Desk modules' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();

  await page.route('**/api/auth/logout', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: null, provider: 'local' } }));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('every desk module survives provider failures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await session(page);
  for (const route of ['brief', 'series', 'yield-curve', 'fx', 'international', 'sectors', 'news', 'heatmap', 'watchlist']) {
    await page.goto('/' + route);
    await expect(page.getByRole('navigation', { name: 'Desk modules' })).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This page could not load' })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('quarter-step axis labels retain their precision', () => {
  expect(tickDigits(0.25)).toBe(2);
  expect(tickDigits(2.5)).toBe(1);
  expect(tickDigits(5)).toBe(0);
  expect(niceScale(2, 2).hi).toBeGreaterThan(2);
});

test('charts preserve missing periods and pick real observations', () => {
  const points = ['01', '02', '03', '05', '06', '07'].map((month, index) => ({ d: '2026-' + month, v: index }));
  expect(segments(points)).toHaveLength(2);
  expect(nearest(points, toTime('2026-02'))).toEqual(points[1]);
  expect(nearest(points, toTime('2030-01'))).toBeNull();
});

test('populated modules render charts and export PNGs', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await populated(page);
  for (const path of ['brief', 'news', 'series', 'yield-curve', 'fx', 'international', 'sectors', 'heatmap']) {
    await page.goto('/' + path);
    await expect(page.locator('main')).toBeVisible();
    if (path === 'brief') await expect(page.getByText('Canada test CPI')).toBeVisible();
    if (path === 'brief') await expect(page.getByText('CA: Test housing starts')).toBeVisible();
    if (['series', 'yield-curve', 'fx', 'international', 'sectors', 'heatmap'].includes(path)) {
      await expect(page.locator('main svg[viewBox]').first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'This page could not load' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    expect(await page.locator('main').evaluate((main) => {
      const container = main.parentElement!;
      return container.scrollWidth <= container.clientWidth + 1;
    }), path + ' content fits its scroll container').toBe(true);
    if (['brief', 'series', 'heatmap'].includes(path)) await page.screenshot({ path: testInfo.outputPath(path + '.png'), fullPage: true });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /PNG/i }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  expect(errors).toEqual([]);
});

test('a slower country response cannot replace the newer selection', async ({ page }) => {
  await populated(page);
  await page.goto('/brief');
  await expect(page.getByText('Canada test CPI')).toBeVisible();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/brief/metrics?country=CAN', async (route) => {
    await held;
    await route.fulfill({ json: panel('CAN') });
  });
  const pending = page.waitForRequest('**/api/brief/metrics?country=CAN');
  await page.locator('main select').selectOption('CAN');
  await pending;
  await page.locator('main select').selectOption('USA');
  await expect(page.getByText('United States test CPI')).toBeVisible();
  const completed = page.waitForResponse('**/api/brief/metrics?country=CAN');
  release();
  await completed;
  await expect(page.getByText('Canada test CPI')).toHaveCount(0);
  await expect(page.getByText('United States test CPI')).toBeVisible();
});
