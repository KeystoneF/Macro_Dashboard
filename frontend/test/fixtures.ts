import type { Page } from '@playwright/test';

export const countries = [
  { code: 'CAN', name: 'Canada', feed: 'CA', national: true },
  { code: 'USA', name: 'United States', feed: 'US', national: true },
];
const stamp = new Date().toISOString();
const points = Array.from({ length: 24 }, (_, i) => ({
  d: new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 10),
  v: 2 + i / 10,
}));
const changePct = { '1D': 0.25, '1W': -0.2, '1M': 0.5, '3M': 1, YTD: 2, '1Y': 3 };
const quote = {
  symbol: 'USDCAD', label: 'USD / CAD', group: 'Majors', currency: 'CAD', decimals: 4,
  price: 1.4, dayLow: 1.3, dayHigh: 1.5, yearLow: 1.2, yearHigh: 1.6,
  quotedAt: stamp, changePct, relative: changePct,
};
const metadata = ['STATIC_TOTALCPICHANGE', 'LRUNTTTTCAM156S'].map((id, i) => ({
  id, label: i ? 'Unemployment' : 'CPI', country: 'CA', group: 'Prices',
  source: 'Test provider', units: '%', freq: 'Monthly', updated: points.at(-1)!.d,
}));

export function panel(country: string) {
  return {
    metrics: countries.filter((c) => country === 'all' || c.code === country).map((c) => ({
      key: c.code + '-cpi', id: 'cpi', country: c.code, countryName: c.name, kind: 'cpi',
      label: c.name + ' test CPI', source: 'Test provider', value: 2.5,
      units: '%', freq: 'Monthly', digits: 1, period: '2026-08', previous: null, unchangedSince: null,
    })),
    countries, truncated: 0, snapshotError: null,
  };
}

export async function populated(page: Page) {
  await page.route('**/api/**', async (route) => {
    const { pathname: path, searchParams: q } = new URL(route.request().url());
    let body: unknown;
    if (path === '/api/auth/me') body = { user: { id: '1', email: 'test@example.test', name: 'Test Analyst' }, provider: 'local' };
    else if (path === '/api/brief/metrics') body = panel(q.get('country') || 'all');
    else if (path === '/api/brief/digest') body = {
      country: q.get('country') || 'all', window: q.get('window') || 'daily',
      items: [], ranked: false, model: null, modelError: null, facts: 2,
      missing: [], skipped: [], modules: ['01'], gatheredAt: stamp,
    };
    else if (path === '/api/brief/deck') body = {
      country: q.get('country') || 'all', window: q.get('window') || 'daily', total: 9, from: '2026-09-16', to: '2026-09-17', fetchedAt: stamp,
      rows: [{ date: '2026-09-16 12:30:00', country: 'CA', event: 'Test housing starts', impact: 'Medium', unit: 'K', estimate: 240, previous: 229.1 }],
    };
    else if (path === '/api/news') body = {
      items: [{
        id: 'test-news', source: 'StatCan', feedId: 'test-feed', country: 'CA', category: 'Economy',
        title: 'Test release headline', summary: 'A sample release for browser verification.',
        link: 'https://example.test/release', published: stamp, publisher: null,
      }],
      sources: [{ id: 'test-feed', source: 'StatCan', country: 'CA', category: 'Economy', count: 1, error: null }],
      fetchedAt: stamp,
    };
    else if (path === '/api/series/catalogue') body = { series: metadata, resolving: false };
    else if (path === '/api/series') body = { series: metadata.map((m) => ({ ...m, observations: points })) };
    else if (path === '/api/yields') body = {
      points: ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'].map((key, i) => ({
        key, months: i + 1, ca: [0, 9].includes(i) ? null : 2 + i / 10, us: 3 + i / 10, caNote: null,
      })),
      asOf: { caBonds: '2026-09-10', caBills: '2026-09-08', us: '2026-09-10' },
      spreads: { ca: { '10Y-2Y': 40, '10Y-3M': 70, '30Y-10Y': 20 }, us: { '10Y-2Y': 40, '10Y-3M': 70, '30Y-10Y': 20 } },
      sources: { ca: 'Test Canada', us: 'Test US' },
    };
    else if (path === '/api/international/snapshot') body = {
      metrics: [{ key: 'gdp', label: 'Real GDP', units: '%' }],
      rows: countries.map((c) => ({ ...c, grouping: false, gdp: { value: 2, period: '2026-Q2' }, cpi: null, unemployment: null })),
      source: 'Test OECD',
    };
    else if (path === '/api/international') body = {
      metric: q.get('metric') || 'gdp', label: 'Test GDP', units: '%', freq: 'Monthly',
      areas: countries.map((c) => ({ ...c, observations: points })), source: 'Test OECD', start: '2025-01',
    };
    else if (path === '/api/markets/history') body = {
      symbol: q.get('symbol'), range: q.get('range'), interval: 'daily', timezone: 'UTC',
      label: 'USD / CAD', currency: 'CAD', points,
    };
    else if (path === '/api/markets/sectors') body = {
      rows: [{ ...quote, symbol: 'XLF', label: 'Financials' }],
      benchmark: { ...quote, label: 'Benchmark' },
      board: { key: q.get('board') || 'us', label: 'United States', currency: 'USD' },
      quotedAt: stamp, fetchedAt: stamp,
    };
    else if (path === '/api/valuation') body = {
      shiller: { label: 'CAPE', source: 'Test Shiller', page: 'https://example.test', observations: points,
        value: 4.3, average: 3.1, asOf: '2026-12', from: '2025-01', updated: stamp, error: null },
      yardeni: { page: 'https://example.test', source: 'Test Yardeni', charts: [] },
    };
    else if (path === '/api/markets/heatmap') body = {
      universe: q.get('universe') === 'tsx' ? 'S&P/TSX Composite' : 'S&P 500', currency: 'USD',
      tiles: ['AAA', 'BBB', 'CCC'].map((ticker, i) => ({
        symbol: ticker, ticker, name: 'Test Company ' + ticker, sector: i ? 'Technology' : 'Financials',
        marketCap: (i + 1) * 1e9, price: 100, changePct,
      })),
      listed: 3, drawn: 3, skipped: [], asOf: stamp,
    };
    else if (path.startsWith('/api/markets/')) body = { rows: [quote], quotedAt: stamp, fetchedAt: stamp };
    else if (path === '/api/auth/logout') body = { ok: true };
    else body = { results: [], query: q.get('q') || '' };
    await route.fulfill({ json: body });
  });
}
