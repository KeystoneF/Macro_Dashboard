const express = require('express');
const router = express.Router();
const { FX, COMMODITIES, BRIEF, SECTOR_SYMBOLS, sectorBoard, PERIODS } = require('../instruments');
const { fail } = require('../redact');
const { row } = require('../csv');
const { cached, num } = require('../providers');
const fetch = require('../http');

const BASE = 'https://financialmodelingprep.com/stable';

// Briefly cache quotes to combine bursts; fresh=1 bypasses stored quotes.
const QUOTE_CACHE_MS = 5_000;
// Bars that have already closed, and the constituent list, do not move.
const CACHE_MS = 60_000;

// Prices stay in memory; PostgreSQL stores accounts.
async function fmp(path, ttl = CACHE_MS) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY missing');

  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apikey=${key}`;

  return cached(`fmp:${path}`, ttl, async () => {
    const r = await fetch(url);

    // FMP sometimes returns subscription errors as plain text under HTTP 200.
    const text = (await r.text()).trim();
    if (!text.startsWith('[') && !text.startsWith('{')) {
      const err = new Error(`fmp declined this request: ${text.slice(0, 120)}`);
      err.declined = /subscription|premium|special endpoint/i.test(text);
      throw err;
    }
    if (!r.ok) throw new Error(`fmp ${r.status}`);
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      const message = data?.['Error Message'] || data?.error || data?.message || 'unexpected response';
      const err = new Error(`fmp declined this request: ${String(message).slice(0, 120)}`);
      err.declined = /subscription|premium|special endpoint/i.test(String(message));
      throw err;
    }
    return data;
  });
}

// batch-quote uses symbols; stock-price-change uses symbol for a list.
const quoteBatch = (symbols, fresh = false) =>
  fmp(`/batch-quote?symbols=${symbols.join(',')}`, fresh ? 0 : QUOTE_CACHE_MS);
const changeBatch = (symbols) => fmp(`/stock-price-change?symbol=${symbols.join(',')}`);

const indexBy = (rows, key = 'symbol') => {
  const m = new Map();
  for (const r of rows || []) m.set(r[key], r);
  return m;
};

// Keep a row with missing values when the provider omits an instrument.
function buildRows(instruments, quotes, changes) {
  return instruments.map((inst) => {
    const q = quotes.get(inst.symbol);
    const c = changes.get(inst.symbol);
    const changePct = {};
    for (const p of PERIODS) changePct[p.key] = c ? num(c[p.field]) : null;

    return {
      ...inst,
      name: q ? q.name : null,
      // Use the provider's quote time so delayed prices remain visible.
      quotedAt: q && num(q.timestamp) !== null && Number.isFinite(new Date(Number(q.timestamp) * 1000).getTime())
        ? new Date(Number(q.timestamp) * 1000).toISOString() : null,
      price: q ? num(q.price) : null,
      dayChange: q ? num(q.change) : null,
      dayLow: q ? num(q.dayLow) : null,
      dayHigh: q ? num(q.dayHigh) : null,
      yearLow: q ? num(q.yearLow) : null,
      yearHigh: q ? num(q.yearHigh) : null,
      changePct,
    };
  });
}

async function instrumentRows(instruments, fresh) {
  const symbols = instruments.map((i) => i.symbol);
  const [quotes, changes] = await Promise.all([quoteBatch(symbols, fresh), changeBatch(symbols)]);
  return buildRows(instruments, indexBy(quotes), indexBy(changes));
}

// The period columns are percentage moves over a day or more, so they do not
// need the cache skipped the way the last price does.
const wantsFresh = (req) => req.query.fresh === '1';

// The oldest quote determines the board's freshness.
const oldestQuote = (rows) => {
  const stamps = rows.map((r) => r.quotedAt).filter(Boolean).sort();
  return stamps.length ? stamps[0] : null;
};

const asOfBody = (rows) => ({
  rows,
  quotedAt: oldestQuote(rows),
  // when this process asked, which is a different fact from when the prices
  // were struck and the two were being conflated
  fetchedAt: new Date().toISOString(),
});

router.get('/periods', (req, res) => res.json({ periods: PERIODS.map((p) => p.key) }));

router.get('/fx', async (req, res) => {
  try {
    res.json(asOfBody(await instrumentRows(FX, wantsFresh(req))));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/commodities', async (req, res) => {
  try {
    res.json(asOfBody(await instrumentRows(COMMODITIES, wantsFresh(req))));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/brief', async (req, res) => {
  try {
    res.json(asOfBody(await instrumentRows(BRIEF, wantsFresh(req))));
  } catch (err) {
    fail(res, err);
  }
});

// Shared by the board route and its export. One call for the quotes and one
// for every period column, whichever board is asked for.
async function sectorRows(board, fresh) {
  const symbols = [...board.sectors.map((s) => s.symbol), board.benchmark.symbol];
  const [quotes, changes] = await Promise.all([quoteBatch(symbols, fresh), changeBatch(symbols)]);
  const q = indexBy(quotes);
  const c = indexBy(changes);

  const rows = buildRows(board.sectors, q, c);
  const [benchmark] = buildRows([board.benchmark], q, c);

  // Relative performance is the sector's change minus its benchmark's.
  for (const r of rows) {
    r.relative = {};
    for (const p of PERIODS) {
      const a = r.changePct[p.key];
      const b = benchmark.changePct[p.key];
      r.relative[p.key] = a == null || b == null ? null : Number((a - b).toFixed(2));
    }
  }

  return { rows, benchmark };
}

const boardOf = (req) => sectorBoard(req.query.board);

router.get('/sectors', async (req, res) => {
  const board = boardOf(req);
  if (!board) return res.status(400).json({ error: `unknown board: ${req.query.board}` });

  try {
    const { rows, benchmark } = await sectorRows(board, wantsFresh(req));
    res.json({
      ...asOfBody(rows),
      benchmark,
      board: { key: board.key, label: board.label, currency: board.currency },
    });
  } catch (err) {
    fail(res, err);
  }
});

const KNOWN = new Map([...FX, ...COMMODITIES, ...SECTOR_SYMBOLS].map((i) => [i.symbol, i]));

const isoAgo = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

const HISTORY_DAYS = { '1D': 5, '1W': 14, '1M': 40, '3M': 110, YTD: null, '1Y': 380 };

const startOfYear = () => `${new Date().getFullYear()}-01-01`;

// Use intraday bars for short windows, with 30-minute bars as fallback.
const INTRADAY = { '1D': ['5min', '30min'], '1W': ['30min'] };

// Anchor short windows to the newest bar so weekends still show history.
const INTRADAY_HOURS = { '1D': 24, '1W': 24 * 7 };

async function intraday(symbol, range) {
  let last = null;

  for (const interval of INTRADAY[range]) {
    let raw;
    try {
      raw = await fmp(`/historical-chart/${interval}?symbol=${encodeURIComponent(symbol)}`);
    } catch (err) {
      last = err;
      continue;
    }

    // FMP returns newest first here too
    const points = (Array.isArray(raw) ? raw : [])
      .map((p) => ({ d: String(p.date).replace(' ', 'T'), v: num(p.close) }))
      .filter((p) => p.v !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.d))
      .sort((a, b) => a.d.localeCompare(b.d));

    if (!points.length) continue;

    const newest = Date.parse(`${points[points.length - 1].d}Z`);
    const cutoff = newest - INTRADAY_HOURS[range] * 3600_000;
    return {
      interval,
      // exchange local time, as FMP prints it. Converting to UTC here would
      // mean guessing the venue's offset on the date of every bar.
      timezone: 'America/New_York',
      points: points.filter((p) => Date.parse(`${p.d}Z`) >= cutoff),
    };
  }

  throw last || new Error(`no intraday bars for ${symbol}`);
}

async function daily(symbol, range) {
  const from = HISTORY_DAYS[range] === null ? startOfYear() : isoAgo(HISTORY_DAYS[range]);
  const to = isoAgo(0);

  let raw;
  try {
    raw = await fmp(
      `/historical-price-eod/light?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`,
    );
  } catch (err) {
    // Report unavailable daily history without substituting a shorter window.
    if (!err.declined) throw err;
    return {
      interval: 'daily',
      timezone: 'UTC',
      points: [],
      from,
      to,
      note: 'Daily history for this instrument is not on the current FMP plan. The 1D and 1W windows come from intraday bars and do work.',
    };
  }

  // FMP returns newest first, and a chart drawn in that order runs backwards
  const points = (Array.isArray(raw) ? raw : [])
    .map((p) => ({ d: p.date, v: num(p.price) }))
    .filter((p) => p.d && p.v !== null)
    .sort((a, b) => a.d.localeCompare(b.d));

  return { interval: 'daily', timezone: 'UTC', points, from, to };
}

// Detail chart for one instrument. Restricted to symbols this app already
// lists, so the route cannot be used to proxy arbitrary FMP lookups.
router.get('/history', async (req, res) => {
  const symbol = String(req.query.symbol || '');
  const range = String(req.query.range || '1M');
  const inst = KNOWN.get(symbol);

  if (!inst) return res.status(400).json({ error: `unknown symbol: ${symbol || 'none'}` });
  if (!Object.hasOwn(HISTORY_DAYS, range)) return res.status(400).json({ error: `unknown range: ${range}` });

  try {
    const series = INTRADAY[range]
      ? await intraday(symbol, range).catch(() => daily(symbol, range))
      : await daily(symbol, range);

    res.json({ symbol, label: inst.label, currency: inst.currency, range, ...series });
  } catch (err) {
    fail(res, err);
  }
});

// Long format, matching the series explorer's export. Prices are passthrough,
// so this is the only way a board leaves the app as data.
function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send([header, ...rows].join('\n'));
}

router.get('/csv', async (req, res) => {
  const kind = String(req.query.kind || 'fx');
  if (!['fx', 'commodities', 'sectors'].includes(kind)) {
    return res.status(400).json({ error: `unknown export: ${kind}` });
  }
  try {
    if (kind === 'sectors') {
      const board = boardOf(req);
      if (!board) return res.status(400).json({ error: `unknown board: ${req.query.board}` });

      const { rows } = await sectorRows(board);
      return sendCsv(
        res,
        `sectors-${board.key}.csv`,
        `sector,symbol,currency,price,${PERIODS.map((p) => `change_${p.key}`).join(',')},${PERIODS.map((p) => `relative_${p.key}`).join(',')}`,
        rows.map((r) =>
          row([
            r.label,
            r.symbol,
            board.currency,
            r.price,
            ...PERIODS.map((p) => r.changePct[p.key]),
            ...PERIODS.map((p) => r.relative[p.key]),
          ]),
        ),
      );
    }

    const instruments = kind === 'commodities' ? COMMODITIES : FX;
    const rows = await instrumentRows(instruments);
    return sendCsv(
      res,
      `${kind}.csv`,
      `instrument,symbol,currency,price,${PERIODS.map((p) => `change_${p.key}`).join(',')}`,
      rows.map((r) =>
        row([r.label, r.symbol, r.currency, r.price, ...PERIODS.map((p) => r.changePct[p.key])]),
      ),
    );
  } catch (err) {
    fail(res, err);
  }
});

// Batch quotes and changes across each heatmap universe.
const HEATMAP_CACHE_MS = 5 * 60_000;
// Membership moves at a quarterly rebalance and the fund holdings files update
// once a day, so it is held far longer than the prices drawn on it.
const MEMBERSHIP_CACHE_MS = 6 * 60 * 60_000;

// Same shape from both universes: the names to draw, and anything the source
// listed that is not one, so a gap is reported rather than quietly dropped.
async function sp500Members() {
  const rows = await fmp('/sp500-constituent', MEMBERSHIP_CACHE_MS);
  return {
    members: (rows || []).filter((r) => r.symbol).map((r) => ({
      symbol: r.symbol,
      ticker: r.symbol,
      name: r.name,
      // FMP's own sector labels, not a mapping of our own invention
      sector: r.sector || 'Unclassified',
    })),
    skipped: [],
  };
}

// Use the union of XIC and ZCN holdings for TSX membership.
const TSX_FUNDS = ['XIC.TO', 'ZCN.TO'];

// Name matching only suppresses duplicate warnings; it never creates a tile.
const nameKey = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 14);

async function tsxMembers() {
  const [holdings, listed] = await Promise.all([
    Promise.all(TSX_FUNDS.map((f) => fmp(`/etf/holdings?symbol=${f}`, MEMBERSHIP_CACHE_MS))),
    fmp('/company-screener?exchange=TSX&limit=5000', MEMBERSHIP_CACHE_MS),
  ]);

  const onTsx = new Map((listed || []).map((r) => [r.symbol, r]));
  const members = new Map();
  const unresolved = [];

  for (const row of holdings.flat()) {
    // Resolve interlisted holdings to Toronto so market caps stay in CAD.
    const ticker = [row.asset, row.asset && `${row.asset}.TO`].find((s) => s && onTsx.has(s));
    if (!ticker) {
      unresolved.push(row.name || 'unnamed holding');
      continue;
    }
    if (members.has(ticker)) continue;
    const company = onTsx.get(ticker);
    members.set(ticker, {
      symbol: ticker,
      // Hide .TO in labels, but retain it in symbols and exports.
      ticker: ticker.replace(/\.TO$/, ''),
      name: company.companyName || row.name,
      sector: company.sector || 'Unclassified',
    });
  }

  const drawn = new Set([...members.values()].map((m) => nameKey(m.name)));
  return {
    members: [...members.values()],
    skipped: [...new Set(unresolved)].filter((n) => !drawn.has(nameKey(n))),
  };
}

const UNIVERSES = {
  sp500: { label: 'S&P 500', currency: 'USD', members: sp500Members },
  tsx: { label: 'S&P/TSX Composite', currency: 'CAD', members: tsxMembers },
};

const heatmapCache = new Map();
// keyed by universe: one shared slot handed a TSX request the S&P answer
// whenever the two were asked for at once
const heatmapInFlight = new Map();

function heatmapData(key) {
  const hit = heatmapCache.get(key);
  if (hit && Date.now() - hit.at < HEATMAP_CACHE_MS) return Promise.resolve(hit.data);
  const running = heatmapInFlight.get(key);
  if (running) return running;

  const universe = UNIVERSES[key];
  const work = (async () => {
    const { members, skipped } = await universe.members();
    const symbols = members.map((m) => m.symbol);
    const [quotes, changes] = await Promise.all([quoteBatch(symbols), changeBatch(symbols)]);
    const q = indexBy(quotes);
    const c = indexBy(changes);

    const tiles = members
      .map((m) => {
        const quote = q.get(m.symbol);
        const change = c.get(m.symbol);
        const changePct = {};
        for (const p of PERIODS) changePct[p.key] = change ? num(change[p.field]) : null;
        return {
          ...m,
          marketCap: quote ? num(quote.marketCap) : null,
          price: quote ? num(quote.price) : null,
          changePct,
        };
      })
      // Tiles need positive market caps to have meaningful areas.
      .filter((t) => t.marketCap && t.marketCap > 0);

    const data = {
      tiles,
      universe: universe.label,
      // every tile on one board is quoted in this, and the two boards are not
      // the same currency
      currency: universe.currency,
      listed: members.length,
      drawn: tiles.length,
      skipped,
      asOf: new Date().toISOString(),
    };
    heatmapCache.set(key, { at: Date.now(), data });
    return data;
  })().finally(() => heatmapInFlight.delete(key));

  heatmapInFlight.set(key, work);
  return work;
}

const universeOf = (req) => String(req.query.universe || 'sp500');

router.get('/heatmap', async (req, res) => {
  const key = universeOf(req);
  if (!Object.hasOwn(UNIVERSES, key)) return res.status(400).json({ error: `unknown universe: ${key}` });
  try {
    res.json(await heatmapData(key));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/heatmap/csv', async (req, res) => {
  const period = String(req.query.period || '1D');
  const key = universeOf(req);
  if (!Object.hasOwn(UNIVERSES, key)) return res.status(400).json({ error: `unknown universe: ${key}` });
  if (!PERIODS.some((p) => p.key === period)) {
    return res.status(400).json({ error: `unknown period: ${period}` });
  }
  try {
    const { tiles, currency } = await heatmapData(key);
    sendCsv(
      res,
      `heatmap-${key}-${period}.csv`,
      `ticker,symbol,name,sector,currency,market_cap,price,change_pct`,
      tiles.map((t) =>
        row([
          t.ticker,
          t.symbol,
          t.name,
          t.sector,
          currency,
          t.marketCap,
          t.price,
          t.changePct[period],
        ]),
      ),
    );
  } catch (err) {
    fail(res, err);
  }
});

// Hung off the router for the brief's digest, which reads these boards without
// going back through HTTP: an internal request would carry no session cookie.
router.briefBoard = () => instrumentRows(BRIEF, false);
router.instrumentRows = instrumentRows;
router.sectorRows = sectorRows;
router.heatmapData = heatmapData;
router.fmp = fmp;

module.exports = router;
