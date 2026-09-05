const express = require('express');
const router = express.Router();
const { FX, COMMODITIES, SECTOR_SYMBOLS, sectorBoard, PERIODS } = require('../instruments');
const { fail } = require('../redact');
const { row } = require('../csv');

const BASE = 'https://financialmodelingprep.com/stable';

// A quote held for a minute, behind a page that also polls once a minute, put
// a price on screen that could be two minutes old under a label reading
// "Quoted" and the current clock. Held only long enough now to collapse a
// burst: two tabs, or a reload landing on top of a poll. `?fresh=1` skips it
// outright, which is what a deliberate click on the module gets.
const QUOTE_CACHE_MS = 5_000;
// Bars that have already closed, and the constituent list, do not move.
const CACHE_MS = 60_000;
const cache = new Map();

// prices are passthrough, not stored. only official stats go to postgres.
async function fmp(path, ttl = CACHE_MS) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY missing');

  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apikey=${key}`;

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const r = await fetch(url);

  // A symbol or interval outside the plan answers with a sentence of prose
  // where the JSON should be, sometimes under a 402 and sometimes under a 200,
  // so the body is read before the status is judged. Parsing first reported a
  // syntax error instead of what actually happened.
  const text = await r.text();
  if (!text.startsWith('[') && !text.startsWith('{')) {
    const err = new Error(`fmp declined this request: ${text.slice(0, 120)}`);
    err.declined = /subscription|premium|special endpoint/i.test(text);
    throw err;
  }
  if (!r.ok) throw new Error(`fmp ${r.status}`);
  const data = JSON.parse(text);

  cache.set(url, { at: Date.now(), data });
  return data;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Batching is the whole game here, and the two endpoints disagree about how.
//
// /batch-quote takes `symbols` plural. /quote takes `symbol` singular and
// handles exactly one: give it a comma-separated list and it answers 200 with
// an empty array rather than an error, so a board built on it renders every row
// as n/a and looks like a dead key.
//
// /stock-price-change takes `symbol` singular but does accept a list, and works
// for FX pairs and commodities despite the name. That is one call for every
// period column on a board.
const quoteBatch = (symbols, fresh = false) =>
  fmp(`/batch-quote?symbols=${symbols.join(',')}`, fresh ? 0 : QUOTE_CACHE_MS);
const changeBatch = (symbols) => fmp(`/stock-price-change?symbol=${symbols.join(',')}`);

const indexBy = (rows, key = 'symbol') => {
  const m = new Map();
  for (const r of rows || []) m.set(r[key], r);
  return m;
};

// One row per instrument: the live quote, plus every period column. A symbol
// the upstream did not return keeps its row and reports n/a rather than
// vanishing from a board an analyst is reading as complete.
function buildRows(instruments, quotes, changes) {
  return instruments.map((inst) => {
    const q = quotes.get(inst.symbol);
    const c = changes.get(inst.symbol);
    const changePct = {};
    for (const p of PERIODS) changePct[p.key] = c ? num(c[p.field]) : null;

    return {
      ...inst,
      name: q ? q.name : null,
      // when this price was struck, not when we asked. FMP delays some
      // instruments and not others: gold runs about ten minutes behind while
      // the majors are seconds behind, and a board that stamps every row with
      // the time of its own fetch says none of that.
      quotedAt: q && q.timestamp ? new Date(q.timestamp * 1000).toISOString() : null,
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

// The oldest print on the board, which is the one that decides how current the
// board as a whole is. Reporting the newest would hide the delayed rows behind
// the live ones.
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

// Shared by the board route and its export. One call for the quotes and one
// for every period column, whichever board is asked for.
async function sectorRows(board, fresh) {
  const symbols = [...board.sectors.map((s) => s.symbol), board.benchmark.symbol];
  const [quotes, changes] = await Promise.all([quoteBatch(symbols, fresh), changeBatch(symbols)]);
  const q = indexBy(quotes);
  const c = indexBy(changes);

  const rows = buildRows(board.sectors, q, c);
  const [benchmark] = buildRows([board.benchmark], q, c);

  // Relative is the sector's move less the benchmark's over the same period.
  // Both numbers are published, so the difference is arithmetic on real data
  // rather than a modelled figure, and it is null whenever either side is.
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

// The short windows come off the intraday endpoints, not off daily closes. A
// "1D" chart drawn from /historical-price-eod was four daily closes with
// today's partial bar on the end, so the panel showed nothing that happened
// today and disagreed with the price in the row above it.
//
// Interval per range, finest first. The plan carries 1min, 5min and 1hour for
// gold, silver, Brent, the FX pairs and the ETFs, but declines them for WTI,
// natural gas, copper, wheat and corn; 30min is the only one it serves for
// every instrument on these boards. So the finer interval is asked for and
// 30min is the fallback, and the interval actually used is reported rather
// than left for the reader to infer from the spacing.
const INTRADAY = { '1D': ['5min', '30min'], '1W': ['30min'] };

// Hours of bars to keep, measured back from the newest bar rather than from
// the clock. Anchoring on the data is what makes this work over a weekend, a
// holiday, or an instrument that stopped printing hours ago: no window has to
// be guessed and no bar is invented to fill one.
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
    // The plan carries daily closes for gold, silver and Brent but not for WTI,
    // natural gas, copper, wheat or corn, so five of the eight commodities have
    // no line at all beyond a week. Saying that beats a panel that sits on
    // "Loading", and drawing the three weeks of 30 minute bars that are
    // available instead would be a shorter window wearing this one's label.
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
  if (!(range in HISTORY_DAYS)) return res.status(400).json({ error: `unknown range: ${range}` });

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

// --- heatmap ----------------------------------------------------------------
//
// The design doc flagged this module as a rate-limit risk: market cap and
// returns across hundreds of symbols. It is not, on these endpoints. A whole
// index fits in one /batch-quote and one /stock-price-change, roughly 2.2kB of
// URL each, so the S&P 500 is three upstream calls including the constituent
// list and the TSX is five, rather than one call per symbol.
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

// FMP publishes no TSX constituent list: /tsx-constituent answers 404, and the
// exchange screener is not a membership source. It offers 2,104 TSX rows and
// puts LLY.TO, Eli Lilly, at the top of them on a USD market cap, which is the
// kind of wrong that looks entirely plausible on a treemap.
//
// So membership comes from the funds that physically replicate the index: a
// name is in because a fund tracking the index holds it. Neither fund alone is
// enough, and the gaps are not the same gaps. XIC names the two Brookfield
// partnerships but gives them no ticker, while ZCN carries BIP-UN.TO and
// BEP-UN.TO and instead drops Thomson Reuters and Strathcona. The union of the
// two resolves every holding that is a security at all, and the leftovers are
// cash, collateral and a TSX 60 futures contract.
const TSX_FUNDS = ['XIC.TO', 'ZCN.TO'];

// A fund lists some companies twice, once with a ticker and once without, so a
// holding is only worth reporting as skipped when nothing else resolved it.
// This decides what to say, never what to draw: no tile is ever built from a
// name match.
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
    // A holding with no exchange suffix is the US line of an interlisted name.
    // Quoting it there would put a USD market cap into a CAD treemap, and the
    // tile is sized by that number: Waste Connections is USD 41.3B on NYSE and
    // CAD 57.4B in Toronto. Moved to its Toronto listing, and only when the
    // exchange actually lists one.
    const ticker = [row.asset, row.asset && `${row.asset}.TO`].find((s) => s && onTsx.has(s));
    if (!ticker) {
      unresolved.push(row.name || 'unnamed holding');
      continue;
    }
    if (members.has(ticker)) continue;
    const company = onTsx.get(ticker);
    members.set(ticker, {
      symbol: ticker,
      // Every name on this board is a Toronto listing, so the .TO that FMP
      // needs to identify one says nothing here and costs a third of the room
      // on a tile. Kept on `symbol`, which is what the export carries and what
      // reproduces the pull.
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
      // a tile needs an area, and market cap is the area. A name with no cap
      // cannot be drawn to scale, so it is reported as excluded rather than
      // given a size it did not earn
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
  if (!UNIVERSES[key]) return res.status(400).json({ error: `unknown universe: ${key}` });
  try {
    res.json(await heatmapData(key));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/heatmap/csv', async (req, res) => {
  const period = String(req.query.period || '1D');
  const key = universeOf(req);
  if (!UNIVERSES[key]) return res.status(400).json({ error: `unknown universe: ${key}` });
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

module.exports = router;
