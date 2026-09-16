const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const service = require('../watchlists');
const markets = require('../routes/markets');
const { redact } = require('../redact');

const member = (id, symbol) => ({ id, company_name: `Company ${symbol}`, company_symbol: symbol, company_slug: `C${id}`, is_cad: 1, revenue: null, eps: 0, date: '2026-06-30T00:00:00Z' });
const response = (rows, page = 1, pages = 1, total = rows.length) => new Response(JSON.stringify({ status: 200, resData: { data: rows, current: page, totalPages: pages, totalData: total } }));

test('watchlist membership follows every page, preserves zeroes and does not substitute preview members', async (t) => {
  process.env.KEYSTOCKS_API_KEY = 'test-watchlist-key';
  const pages = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    const u = new URL(url); pages.push(u.searchParams.get('page'));
    assert.equal(options.headers.Authorization, 'test-watchlist-key');
    assert.equal(options.redirect, 'error');
    assert.equal(u.searchParams.get('watchlist_id'), '901');
    return response([member(Number(u.searchParams.get('page')), u.searchParams.get('page') === '1' ? 'AAA.TO' : 'BBB')], +u.searchParams.get('page'), 2, 2);
  });
  t.mock.method(markets, 'fmp', async (path) => path.startsWith('/batch-quote') ? [{ symbol: 'AAA.TO', price: 0, timestamp: 0 }] : [{ symbol: 'AAA.TO', '1D': -2, ytd: 0 }]);
  const data = await service.companies('901');
  assert.deepEqual(pages.sort(), ['1', '2']);
  assert.equal(data.total, 2);
  assert.equal(data.rows[0].price, 0);
  assert.equal(data.rows[0].day, -2);
  assert.equal(data.rows[0].ytd, 0);
  assert.equal(data.rows[1].price, null);
  assert.equal(data.rows[1].eps, 0);
});

test('FMP outages retain company rows and disclose partial coverage', async (t) => {
  process.env.KEYSTOCKS_API_KEY = 'test-watchlist-key';
  t.mock.method(global, 'fetch', async () => response([member(1, 'OUTAGE')]));
  t.mock.method(markets, 'fmp', async () => { throw new Error('private provider details'); });
  const data = await service.companies('902');
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].price, null);
  assert.equal(data.warnings.length, 2);
  assert.doesNotMatch(JSON.stringify(data), /private provider/);
});

test('news forwards encoded filters and removes unsafe outbound URLs', async (t) => {
  process.env.KEYSTOCKS_API_KEY = 'test-watchlist-key';
  t.mock.method(global, 'fetch', async (url) => {
    const p = new URL(url).searchParams;
    assert.equal(p.get('watchlist_id'), '903');
    assert.equal(p.get('categories[]'), 'Dividend Increase');
    assert.equal(p.get('exchanges[]'), 'TSX+Venture');
    assert.equal(p.get('companies[]'), '12');
    assert.equal(p.get('publishers[]'), 'Business Wire');
    return response([{ id: 1, url: 'javascript:alert(1)' }, { id: 2, url: 'https://example.test/news' }]);
  });
  const data = await service.news('903', { category: 'Dividend Increase', exchange: 'TSX+Venture', company: '12', publisher: 'Business Wire' });
  assert.equal(data.rows[0].url, null);
  assert.equal(data.rows[1].url, 'https://example.test/news');
});

test('earnings matches all members, excludes unrelated or past events, and splits capped calendars', async (t) => {
  process.env.KEYSTOCKS_API_KEY = 'test-watchlist-key';
  t.mock.method(global, 'fetch', async () => response([member(1, 'EARN')]));
  const ranges = [];
  t.mock.method(markets, 'fmp', async (path) => {
    const p = new URL('https://test.invalid' + path).searchParams;
    ranges.push([p.get('from'), p.get('to')]);
    return [
      { symbol: 'EARN', date: service.today(), epsEstimated: 0 },
      { symbol: 'EARN', date: service.offset(service.today(), -1) },
      { symbol: 'UNRELATED', date: service.today() },
    ];
  });
  const data = await service.earnings('904', 30);
  assert.equal(ranges.length, 5);
  assert.ok(ranges.every(([a, b]) => Date.parse(b) - Date.parse(a) <= 6 * 864e5));
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].epsEstimated, 0);
});

test('calendar filters Canada and US, retains missing estimates and actual zero', async (t) => {
  t.mock.method(markets, 'fmp', async () => [
    { country: 'CA', event: 'CPI', date: '2026-09-15 12:30:00', actual: 0, estimate: null },
    { country: 'US', event: 'Retail', date: '2026-09-15 12:30:00' },
    { country: 'GB', event: 'CPI', date: '2026-09-15 12:30:00' },
  ]);
  const data = await service.calendar({ from: '2026-09-15', to: '2026-09-15', country: 'CA' });
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].actual, 0);
  assert.equal(data.rows[0].estimate, null);
});

test('provider failures do not disclose credentials and failed responses can be retried', async (t) => {
  process.env.KEYSTOCKS_API_KEY = 'test-private-key';
  const mock = t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({ status: 500, message: 'test-private-key' }), { status: 500 }));
  await assert.rejects(service.request('/test-error'), (e) => !e.message.includes('test-private-key'));
  mock.mock.mockImplementation(async () => response([]));
  assert.equal((await service.request('/test-error')).status, 200);
  assert.equal(redact('test-private-key'), '[redacted]');
});

test('routes reject invalid filters before providers and CSV neutralizes formulas', async (t) => {
  const app = express(); app.set('query parser', 'simple'); app.use('/api/watchlists', require('../routes/watchlists'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/watchlists`;
  const mocked = t.mock.method(service, 'news', async () => ({ rows: [{ title: '=HYPERLINK("bad")', symbol: 'AAA' }] }));
  for (const path of ['/x/news', '/1/news?page=0', '/1/news?from=2026-02-30', '/1/news?from=2026-09-15&to=2026-09-01', '/1/companies?report=bad', '/1/news?page=1&page=2', '/1/earnings?days=365', '/calendar?from=2026-01-01&to=2026-12-31']) {
    assert.equal((await fetch(base + path)).status, 400, path);
  }
  assert.equal(mocked.mock.callCount(), 0);
  const csv = await fetch(base + '/1/news?format=csv');
  assert.match(csv.headers.get('content-disposition'), /watchlist-news.csv/);
  assert.match(await csv.text(), /'=HYPERLINK/);
});

test('the brief deck keeps releases still ahead, caps the rows and follows the country', async (t) => {
  const app = express(); app.set('query parser', 'simple'); app.use('/api/brief', require('../routes/brief'));
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/brief/deck`;
  const asked = [];
  t.mock.method(service, 'calendar', async (options) => {
    asked.push(options.country);
    const soon = new Date(Date.now() + 36e5).toISOString().slice(0, 19).replace('T', ' ');
    return { rows: [
      { date: '2000-01-01 12:00:00', country: 'US', event: 'Printed', impact: 'High', unit: '%', actual: 1, estimate: 1, previous: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ date: soon, country: 'CA', event: `Ahead ${i}`, impact: 'Low', unit: '', actual: null, estimate: null, previous: 2 })),
    ] };
  });
  const deck = await (await fetch(base + '?window=weekly&country=CAN')).json();
  assert.deepEqual(asked, ['CA']);
  assert.equal(deck.total, 10);
  assert.equal(deck.rows.length, 8);
  assert.ok(deck.rows.every((r) => r.event.startsWith('Ahead') && !('actual' in r)));
  assert.equal(deck.rows[0].estimate, null);
  const none = await (await fetch(base + '?window=daily&country=DEU')).json();
  assert.deepEqual(none.rows, []);
  assert.equal(asked.length, 1);
  assert.equal((await fetch(base + '?window=yearly')).status, 400);
});
