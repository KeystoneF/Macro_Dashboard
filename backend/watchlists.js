const fetch = require('./http');
const { cached, pool, num, isoDate } = require('./providers');
const markets = require('./routes/markets');
const { createHash } = require('node:crypto');

const TTL = 5 * 60_000;
const today = () => new Date().toISOString().slice(0, 10);
const offset = (date, days) => new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10);
const safeUrl = (value) => {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
};

function baseUrl() {
  let url;
  try { url = new URL(process.env.KEYSTOCKS_BASE_URL || 'http://52.54.224.232'); }
  catch { throw new Error('KEYSTOCKS_BASE_URL must be an HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('KEYSTOCKS_BASE_URL must be an HTTP(S) origin without credentials, paths, or query parameters.');
  }
  // the supplied KeyStocks host is plain http, so http is allowed in production too
  return url.origin;
}

// the key goes in Authorization as a bare value, no Bearer prefix
async function request(path, params = {}, ttl = TTL) {
  const key = process.env.KEYSTOCKS_API_KEY;
  if (!key) throw new Error('KeyStocks is not configured. Set KEYSTOCKS_API_KEY on the server.');
  const base = baseUrl();
  // the cache key carries a hash of the api key so a rotated key misses
  const scope = createHash('sha256').update(key).digest('hex');
  const query = new URLSearchParams(params);
  return cached(`keystocks:${base}:${scope}:${path}?${query}`, ttl, async () => {
    const r = await fetch(`${base}/api/v2${path}?${query}`, {
      headers: { Authorization: key, Accept: 'application/json', tz: 'UTC' },
      redirect: 'error',
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || Number(body.status) !== 200) {
      // the provider body is dropped, it can carry html or the key
      throw new Error(`KeyStocks could not load this data (${r.status}). Please retry.`);
    }
    return body;
  });
}

function pageOf(body) {
  const data = body.resData;
  if (!data || !Array.isArray(data.data)) throw new Error('KeyStocks returned an invalid data page.');
  return { rows: data.data, page: num(data.current) || 1, pages: num(data.totalPages) || 0, total: num(data.totalData) ?? data.data.length };
}

// the list endpoint previews two members per list, membership comes from the pages
async function allPages(path, params = {}) {
  const first = pageOf(await request(path, { ...params, page: 1, limit: 500 }));
  if (first.pages > 20) throw new Error('This watchlist exceeds the 10,000-row limit. Narrow the list in KeyStocks.');
  const rest = await pool(Array.from({ length: Math.max(0, first.pages - 1) }, (_, i) => i + 2), async (page) =>
    pageOf(await request(path, { ...params, page, limit: 500 })));
  return [...first.rows, ...rest.flatMap((p) => p.rows)];
}

async function lists() {
  const rows = await allPages('/watchlists', { column: 'name', dir: 'ASC' });
  return { rows: rows.map((r) => ({ id: String(r.id), slug: r.slug, name: r.name, description: r.description || '', tags: Array.isArray(r.tags) ? r.tags : [], count: num(r.allCompanies) })), fetchedAt: new Date().toISOString() };
}

async function members(id, report = 'ttm') {
  const raw = await allPages('/watchlists/companies', { watchlist_id: id, report_type: report, column: 'date', dir: 'DESC' });
  const unique = new Map();
  for (const r of raw) {
    const symbol = String(r.company_symbol || '').trim();
    if (!unique.has(String(r.id))) unique.set(String(r.id), {
      id: String(r.id), symbol, name: r.company_name, slug: r.company_slug,
      country: r.is_cad === 1 ? 'CA' : r.is_cad === 0 ? 'US' : null,
      period: r.date?.slice(0, 10) || null, revenue: num(r.revenue), eps: num(r.eps),
    });
  }
  return [...unique.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function companies(id, { report = 'ttm', q = '', page = 1 } = {}) {
  const all = await members(id, report);
  const filtered = all.filter((r) => `${r.name} ${r.symbol}`.toLowerCase().includes(q.toLowerCase()));
  const rows = filtered.slice((page - 1) * 25, page * 25);
  const symbols = rows.map((r) => r.symbol).filter((s) => /^[A-Za-z0-9.^_-]{1,32}$/.test(s));
  const warnings = [];
  const [quotes, changes] = symbols.length ? await Promise.all([
    markets.fmp(`/batch-quote?symbols=${encodeURIComponent(symbols.join(','))}`).catch(() => { warnings.push('FMP quotes unavailable. Company data is still shown.'); return []; }),
    markets.fmp(`/stock-price-change?symbol=${encodeURIComponent(symbols.join(','))}`).catch(() => { warnings.push('FMP price changes unavailable.'); return []; }),
  ]) : [[], []];
  const qm = new Map(quotes.map((r) => [r.symbol, r]));
  const cm = new Map(changes.map((r) => [r.symbol, r]));
  return {
    rows: rows.map((r) => {
      const quote = qm.get(r.symbol), change = cm.get(r.symbol);
      const stamp = num(quote?.timestamp);
      return { ...r, price: num(quote?.price), quotedAt: stamp !== null && Number.isFinite(new Date(stamp * 1000).getTime()) ? new Date(stamp * 1000).toISOString() : null,
        day: num(change?.['1D']), week: num(change?.['5D']), month: num(change?.['1M']), ytd: num(change?.ytd), year: num(change?.['1Y']) };
    }), total: filtered.length, coverage: all.length, page, pages: Math.ceil(filtered.length / 25), report, warnings, fetchedAt: new Date().toISOString(),
  };
}

async function filters(id) {
  const [body, companies] = await Promise.all([request('/news/filters'), allPages('/news/companies', { watchlist_id: id })]);
  return { categories: body.categories || [], regions: body.regions || [], exchanges: body.exchanges || [], publishers: body.publishers || [],
    companies: companies.map((r) => ({ id: String(r.id), name: r.name, symbol: r.symbol })) };
}

async function news(id, options = {}) {
  const params = { watchlist_id: id, page: options.page || 1, limit: 25, column: 'date', dir: 'DESC' };
  // the live api wants array params here, the collection's scalar examples 400
  const mapping = { q: 'query', from: 'startDate', to: 'endDate', category: 'categories[]', region: 'regions[]', exchange: 'exchanges[]', publisher: 'publishers[]', company: 'companies[]' };
  for (const [key, target] of Object.entries(mapping)) if (options[key]) params[target] = options[key];
  const data = pageOf(await request('/news', params));
  return { ...data, rows: data.rows.map((r) => ({ id: String(r.id), symbol: r.symbol || '', company: r.company_name || '', title: r.title || 'Untitled release', published: r.date || '',
    category: r.category || '', region: r.region || '', exchange: r.exchange || '', publisher: r.publisher || '', url: safeUrl(r.url) })), fetchedAt: new Date().toISOString() };
}

async function earnings(id, days = 30) {
  const from = today(), to = offset(from, days - 1);
  const companies = await members(id);
  const symbols = new Map(companies.map((r) => [r.symbol, r]));
  if (!symbols.size) return { rows: [], coverage: 0, from, to, fetchedAt: new Date().toISOString() };
  // weekly windows stay under FMP's response cap and the cache is shared across lists
  const windows = Array.from({ length: Math.ceil(days / 7) }, (_, i) => ({ from: offset(from, i * 7), to: offset(from, Math.min(days - 1, i * 7 + 6)) }));
  const batches = await pool(windows, async (w) => {
    const rows = await markets.fmp(`/earnings-calendar?from=${w.from}&to=${w.to}`, TTL);
    if (rows.length >= 4000) throw new Error('FMP earnings calendar reached its response limit. Try a shorter window.');
    return rows;
  });
  const unique = new Map();
  for (const r of batches.flat()) {
    if (!symbols.has(r.symbol) || !isoDate(r.date) || r.date < from || r.date > to) continue;
    unique.set(`${r.symbol}:${r.date}`, { symbol: r.symbol, name: symbols.get(r.symbol).name, date: r.date, epsEstimated: num(r.epsEstimated), epsActual: num(r.epsActual), revenueEstimated: num(r.revenueEstimated), lastUpdated: r.lastUpdated || null });
  }
  return { rows: [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)), coverage: companies.length, from, to, fetchedAt: new Date().toISOString() };
}

async function calendar({ from = today(), to = offset(from, 6), country = 'all' } = {}) {
  const data = await markets.fmp(`/economic-calendar?from=${from}&to=${to}`, TTL);
  if (data.length >= 4000) throw new Error('FMP economic calendar reached its response limit. Select a shorter range.');
  const rows = data.filter((r) => ['CA', 'US'].includes(r.country) && (country === 'all' || r.country === country) && r.date?.slice(0, 10) >= from && r.date.slice(0, 10) <= to)
    .map((r) => ({ date: r.date, country: r.country, event: r.event, impact: r.impact || '', unit: r.unit || '', actual: num(r.actual), estimate: num(r.estimate), previous: num(r.previous) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { rows, from, to, fetchedAt: new Date().toISOString() };
}

module.exports = { lists, members, companies, filters, news, earnings, calendar, request, allPages, safeUrl, baseUrl, today, offset };
