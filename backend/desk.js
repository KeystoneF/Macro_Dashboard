// Gather each module's sourced facts for the daily brief.

const { cached, pool, SOURCE_NAME, observations, isoAgo } = require('./providers');
const { redact, describe } = require('./redact');

const markets = require('./routes/markets');
const news = require('./routes/news');
const yields = require('./routes/yields');
const international = require('./routes/international');
const series = require('./routes/series');
const { load: loadShiller, SHILLER } = require('./shiller');
const { FX, COMMODITIES, BRIEF, sectorBoard } = require('./instruments');

// Numbering follows design/0-shell.html, the same table the sidebar carries.
const MODULE = {
  brief: { num: '01', label: 'Daily Brief' },
  news: { num: '02', label: 'News & Commentary' },
  series: { num: '03', label: 'Series Explorer' },
  'yield-curve': { num: '04', label: 'Yield Curve' },
  fx: { num: '05', label: 'FX & Commodities' },
  international: { num: '06', label: 'International' },
  sectors: { num: '07', label: 'Sector & Valuation' },
  watchlist: { num: '08', label: 'Watchlist & Calendar' },
  heatmap: { num: '09', label: 'Heatmap' },
};

const CACHE_MS = 30 * 60_000; // the fastest of these prints once a day

// Use national sources for Canada and the US, with OECD for other countries.
// US headline CPI uses the unadjusted index's annual change.
const METRICS = [
  { key: 'ca-cpi', country: 'CAN', label: 'CPI, all items y/y', src: 'boc', id: 'STATIC_TOTALCPICHANGE', freq: 'Monthly', units: '%', digits: 1, kind: 'cpi' },
  { key: 'us-cpi', country: 'USA', label: 'CPI, all items y/y', src: 'fred', id: 'CPIAUCNS', fredUnits: 'pc1', freq: 'Monthly', units: '%', digits: 1, kind: 'cpi' },
  { key: 'ca-unemployment', country: 'CAN', label: 'Unemployment rate', src: 'statcan', id: 'v2062815', freq: 'Monthly', units: '%', digits: 1, kind: 'unemployment' },
  { key: 'us-unemployment', country: 'USA', label: 'Unemployment rate', src: 'fred', id: 'UNRATE', freq: 'Monthly', units: '%', digits: 1, kind: 'unemployment' },
  { key: 'ca-policy', country: 'CAN', label: 'Policy rate target', src: 'boc', id: 'V39079', freq: 'Daily', units: '%', digits: 2, kind: 'policy' },
  { key: 'us-policy', country: 'USA', label: 'Fed funds target, upper', src: 'fred', id: 'DFEDTARU', freq: 'Daily', units: '%', digits: 2, kind: 'policy' },
];

const NATIONAL = { CAN: 'Canada', USA: 'United States' };

// the news feeds carry two-letter codes; every other country segment here is ISO3
const FEED_COUNTRY = { CAN: 'CA', USA: 'US' };

const YEARS = 3; // far enough back that a policy rate has moved inside the window

// Find when the latest value last changed within the available history.
function unchangedSince(obs) {
  const last = obs[obs.length - 1];
  let i = obs.length - 1;
  while (i > 0 && obs[i - 1].v === last.v) i--;
  // the run reaches the start of the window, so how long is not known from here
  if (i === 0) return null;
  return i === obs.length - 1 ? null : obs[i].d;
}

const describeMetric = (m) => ({
  key: m.key,
  country: m.country,
  countryName: NATIONAL[m.country] || m.country,
  kind: m.kind,
  label: m.label,
  units: m.units,
  freq: m.freq,
  digits: m.digits,
  id: m.id,
  source: SOURCE_NAME[m.src],
});

const oneMetric = (m) =>
  cached(`brief:${m.key}`, CACHE_MS, async () => {
    const obs = await observations(m, isoAgo(YEARS));
    const last = obs[obs.length - 1] || null;
    const previous = obs.length > 1 ? obs[obs.length - 2] : null;

    return {
      ...describeMetric(m),
      value: last ? last.v : null,
      // the period always travels with the value: these print monthly, and a
      // July figure read in September is not the current month
      period: last ? last.d : null,
      previous: previous ? { value: previous.v, period: previous.d } : null,
      unchangedSince: last ? unchangedSince(obs) : null,
    };
  });

function nationalRows(wanted) {
  const want = METRICS.filter((m) => !wanted || m.country === wanted);
  return pool(want, async (m) => {
    try {
      return await oneMetric(m);
    } catch (err) {
      // one dead source must not empty the panel, so the row stays and says
      // what happened to it
      return { ...describeMetric(m), value: null, period: null, previous: null, unchangedSince: null, error: redact(describe(err)) };
    }
  });
}

// One OECD snapshot cell as a metric row, so a country with no national source
// reads the same way Canada and the United States do.
const oecdRow = (row, metric) => ({
  key: `${row.code}-${metric.key}`,
  country: row.code,
  countryName: row.name,
  kind: metric.key,
  label: metric.label,
  units: metric.units,
  freq: metric.freq,
  digits: 1,
  id: metric.key,
  source: 'OECD',
  value: row[metric.key].value,
  period: row[metric.key].period,
  previous: null,
  unchangedSince: null,
});

const oecdSnapshot = () => cached('brief:oecd-snapshot', CACHE_MS, () => international.snapshot());

// A measure never comes from two places at once: where a national source covers
// it, the OECD copy is dropped rather than listed beside it.
const covered = (code, kind) => METRICS.some((m) => m.country === code && m.kind === kind);

const NEWEST = 14;

// The panel's rows for one country, or the newest prints across every country
// OECD holds when none is picked.
async function metrics(country) {
  const wanted = country && country !== 'all' ? country : null;

  const [national, snapshot] = await Promise.all([
    wanted && !NATIONAL[wanted] ? [] : nationalRows(wanted),
    oecdSnapshot().catch((err) => ({ error: redact(describe(err)), rows: [], metrics: [] })),
  ]);

  const rows = [...national];

  for (const row of snapshot.rows || []) {
    if (row.grouping) continue;
    if (wanted && row.code !== wanted) continue;
    for (const metric of snapshot.metrics) {
      if (!row[metric.key] || covered(row.code, metric.key)) continue;
      rows.push(oecdRow(row, metric));
    }
  }

  if (wanted) return { rows, truncated: 0, error: snapshot.error || null };

  // Keep all national metrics and the newest metric from each other country.
  const elsewhere = rows.filter((r) => !NATIONAL[r.country]).sort(newest);

  const seen = new Set();
  const one = elsewhere.filter((r) => {
    if (seen.has(r.country)) return false;
    seen.add(r.country);
    return true;
  });

  const shown = [...national, ...one].slice(0, NEWEST);
  return { rows: shown, truncated: rows.length - shown.length, error: snapshot.error || null };
}

// Every country the desk can show a print for: the OECD list, plus the two with
// a national source.
async function countries() {
  const snapshot = await oecdSnapshot().catch(() => ({ rows: [] }));

  const seen = new Map();
  for (const [code, name] of Object.entries(NATIONAL)) {
    seen.set(code, { code, name, feed: FEED_COUNTRY[code] || null, national: true });
  }
  for (const row of snapshot.rows || []) {
    if (row.grouping || seen.has(row.code)) continue;
    seen.set(row.code, { code: row.code, name: row.name, feed: FEED_COUNTRY[row.code] || null, national: false });
  }

  const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  // the two with a national source lead, because they are the ones the feeds
  // and the boards also cover
  return [...list.filter((c) => c.national), ...list.filter((c) => !c.national)];
}

// ---- facts ----

const WINDOWS = {
  daily: { days: 1, change: '1D' },
  weekly: { days: 7, change: '1W' },
  monthly: { days: 30, change: '1M' },
};

// Compare mixed monthly and quarterly periods chronologically.
function periodTime(period) {
  const p = String(period || '');
  const q = p.match(/^(\d{4})-Q(\d)$/);
  if (q) return Date.UTC(+q[1], (+q[2] - 1) * 3, 1);
  const m = p.match(/^(\d{4})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, 1);
  const d = p.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3]);
  return /^\d{4}$/.test(p) ? Date.UTC(+p, 0, 1) : 0;
}

const newest = (a, b) => periodTime(b.period) - periodTime(a.period);

const fmt = (v, digits, suffix = '') => (v == null ? null : `${v.toFixed(digits)}${suffix}`);

const signed = (v, digits, suffix = '') =>
  v == null ? null : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;

const fact = (slug, f) => ({ module: slug, moduleNum: MODULE[slug].num, moduleLabel: MODULE[slug].label, ...f });

// A gather that fails costs its own facts and nothing else. The reason is kept
// so the panel can name the module that is missing.
async function gather(slug, fn) {
  try {
    return { slug, facts: (await fn()) || [] };
  } catch (err) {
    return { slug, facts: [], error: redact(describe(err)) };
  }
}

function metricFacts(rows) {
  return rows
    .filter((r) => r.value != null)
    .map((r) =>
      fact('brief', {
        country: r.country,
        label: `${r.countryName}: ${r.label}`,
        value: fmt(r.value, r.digits, r.units === '%' ? '%' : ` ${r.units}`),
        period: r.period,
        note: r.unchangedSince ? `unchanged since ${r.unchangedSince}` : null,
        source: r.source,
      }),
    );
}

const NEWS_MAX = 24;

function newsFacts(items, since, feed) {
  return items
    .filter((i) => i.published >= since && (!feed || i.country === feed))
    .slice(0, NEWS_MAX)
    .map((i) =>
      fact('news', {
        country: i.country === 'CA' ? 'CAN' : 'USA',
        label: `${i.source}, ${i.category}`,
        title: i.title,
        link: i.link,
        value: null,
        period: i.published.slice(0, 10),
        published: i.published,
        source: i.source,
      }),
    );
}

function yieldFacts(curve) {
  const out = [];
  const sides = [
    { side: 'ca', code: 'CAN', name: 'Canada', asOf: curve.asOf.caBonds },
    { side: 'us', code: 'USA', name: 'United States', asOf: curve.asOf.us },
  ];

  for (const s of sides) {
    const ten = curve.points.find((p) => p.key === '10Y');
    if (ten && ten[s.side] != null) {
      out.push(fact('yield-curve', {
        country: s.code,
        label: `${s.name}: 10-year benchmark yield`,
        value: fmt(ten[s.side], 2, '%'),
        period: s.asOf,
        source: curve.sources[s.side],
      }));
    }
    for (const [pair, bps] of Object.entries(curve.spreads[s.side])) {
      if (bps == null) continue;
      out.push(fact('yield-curve', {
        country: s.code,
        label: `${s.name}: ${pair} spread`,
        value: `${bps > 0 ? '+' : ''}${bps} bps`,
        period: s.asOf,
        source: curve.sources[s.side],
      }));
    }
  }
  return out;
}

// The biggest absolute moves on a board over the window, which is a sort on
// published changes rather than a judgement about them.
const movers = (rows, change, take) =>
  rows
    .filter((r) => r.changePct && r.changePct[change] != null)
    .sort((a, b) => Math.abs(b.changePct[change]) - Math.abs(a.changePct[change]))
    .slice(0, take);

const lastPrice = (r) =>
  r.price == null ? 'last n/a' : `last ${r.price.toFixed(r.decimals)} ${r.currency}`;

const boardFact = (slug, r, change) =>
  fact(slug, {
    label: r.label,
    // the value is a move over a period rather than a level, which is what lets
    // the ranked panel's line say the thing rose
    carriesChange: true,
    value: `${signed(r.changePct[change], 2, '%')} over ${change}, ${lastPrice(r)}`,
    period: r.quotedAt ? r.quotedAt.slice(0, 10) : null,
    source: 'FMP',
  });

// The heatmap is ranked by market cap, so the moves that matter to the board are
// the ones inside the largest names rather than the largest percentage anywhere.
const HEAT_TOP = 25;
const HEAT_TAKE = 4;

function heatmapFacts(data, change) {
  const large = [...data.tiles]
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, HEAT_TOP)
    .filter((t) => t.changePct[change] != null)
    .sort((a, b) => b.changePct[change] - a.changePct[change]);

  const picked = [...large.slice(0, HEAT_TAKE), ...large.slice(-HEAT_TAKE)];

  return [...new Map(picked.map((t) => [t.symbol, t])).values()].map((t) =>
    fact('heatmap', {
      label: `${data.universe}: ${t.name}`,
      carriesChange: true,
      value: `${signed(t.changePct[change], 2, '%')} over ${change}`,
      period: data.asOf.slice(0, 10),
      note: `one of the ${HEAT_TOP} largest by market cap`,
      source: 'FMP',
    }),
  );
}

function sectorFacts(board, rows, benchmark, change) {
  const ranked = rows
    .filter((r) => r.changePct[change] != null)
    .sort((a, b) => b.changePct[change] - a.changePct[change]);

  const picked = ranked.length > 1 ? [ranked[0], ranked[ranked.length - 1]] : ranked;
  const code = board.key === 'ca' ? 'CAN' : 'USA';

  const out = picked.map((r) => {
    const rel = r.relative[change];
    return fact('sectors', {
      country: code,
      label: `${board.label} sectors: ${r.label}`,
      carriesChange: true,
      value: `${signed(r.changePct[change], 2, '%')} over ${change}`,
      note: rel == null ? null : `${signed(rel, 2, '%')} against ${benchmark.label}`,
      period: r.quotedAt ? r.quotedAt.slice(0, 10) : null,
      source: 'FMP',
    });
  });

  if (benchmark.changePct[change] != null) {
    out.push(fact('sectors', {
      country: code,
      label: `${board.label}: ${benchmark.label}`,
      carriesChange: true,
      value: `${signed(benchmark.changePct[change], 2, '%')} over ${change}`,
      period: benchmark.quotedAt ? benchmark.quotedAt.slice(0, 10) : null,
      source: 'FMP',
    }));
  }
  return out;
}

const SERIES_MAX = 10;

// Curated series whose last print landed inside the window. The sweep behind
// this already runs for the explorer's Last column, so it costs nothing here.
function seriesFacts(rows, since) {
  const day = since.slice(0, 10);
  return rows
    .filter((r) => r.updated && r.updated >= day)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, SERIES_MAX)
    .map((r) =>
      fact('series', {
        country: r.country === 'CA' ? 'CAN' : 'USA',
        label: `${r.label} printed`,
        value: null,
        period: r.updated,
        note: `${r.freq}, ${r.source}`,
        source: r.source,
      }),
    );
}

// More than the panel shows, because the key metrics panel picks by the same
// newest-per-country rule and its rows are deduped out of this ahead of them.
const OECD_MAX = 20;

function internationalFacts(snapshot, wanted) {
  const out = [];

  for (const row of snapshot.rows || []) {
    if (row.grouping) continue;
    if (wanted && row.code !== wanted) continue;
    for (const metric of snapshot.metrics) {
      const cell = row[metric.key];
      // the same rule the panel uses: where a national source covers a measure,
      // the OECD copy is not offered beside it with a different figure on it
      if (!cell || covered(row.code, metric.key)) continue;
      out.push(fact('international', {
        country: row.code,
        label: `${row.name}: ${metric.label}`,
        value: fmt(cell.value, 1, '%'),
        period: cell.period,
        source: 'OECD',
      }));
    }
  }

  if (wanted) return out.sort(newest);

  // one country per slot, or the twelve are three measures across four countries
  const seen = new Set();
  return out
    .sort(newest)
    .filter((f) => {
      if (seen.has(f.country)) return false;
      seen.add(f.country);
      return true;
    })
    .slice(0, OECD_MAX);
}

// Quote the combined board once, then assign each row to its module.
const BRIEF_ONLY = BRIEF.filter((b) => ![...FX, ...COMMODITIES].some((i) => i.symbol === b.symbol));
const BOARD = [...FX, ...COMMODITIES, ...BRIEF_ONLY];
const BOARD_TAKE = 8;

async function boardFacts(change) {
  const rows = await markets.instrumentRows(BOARD, false);
  const own = new Set(BRIEF_ONLY.map((b) => b.symbol));
  return movers(rows, change, BOARD_TAKE).map((r) =>
    boardFact(own.has(r.symbol) ? 'brief' : 'fx', r, change),
  );
}

async function sectorAndValuation(change) {
  const boards = await Promise.all(
    ['us', 'ca'].map(async (key) => {
      const board = sectorBoard(key);
      const { rows, benchmark } = await markets.sectorRows(board, false);
      return sectorFacts(board, rows, benchmark, change);
    }),
  );

  // the workbook is the slowest thing on module 7, so a cold cache costs this
  // panel its CAPE row rather than the whole digest
  const cape = await loadShiller().then(
    (s) => [
      fact('sectors', {
        label: `${SHILLER.label}`,
        value: s.value == null ? null : s.value.toFixed(2),
        period: s.asOf,
        note: 'the latest row is a partial month',
        source: SHILLER.source,
      }),
    ],
    () => [],
  );

  return [...boards.flat(), ...cape];
}

// Everything the nine modules are showing, for one window and one country.
async function facts({ window = 'daily', country = 'all' } = {}) {
  const w = WINDOWS[window] || WINDOWS.daily;
  const wanted = country && country !== 'all' ? country : null;
  const feed = wanted ? FEED_COUNTRY[wanted] || null : null;
  // a country with no publisher in the aggregator has no headlines of its own,
  // and showing every publisher's instead would not be that country's news
  const feedless = Boolean(wanted && !feed);

  const mine = (f) => !wanted || !f.country || f.country === wanted;

  const done = await Promise.all([
    gather('brief', async () => metricFacts((await metrics(country)).rows)),

    gather('news', async () => {
      if (feedless) return [];
      const { items, at } = await news.recent();
      return newsFacts(items, new Date(at - w.days * 864e5).toISOString(), feed);
    }),

    gather('series', async () =>
      seriesFacts(series.freshness(), new Date(Date.now() - w.days * 864e5).toISOString()).filter(mine),
    ),

    gather('yield-curve', async () => yieldFacts(await yields.curveFor(null)).filter(mine)),

    gather('fx', async () => boardFacts(w.change)),

    gather('international', async () => internationalFacts(await oecdSnapshot(), wanted)),

    gather('sectors', async () => (await sectorAndValuation(w.change)).filter(mine)),

    gather('heatmap', async () => heatmapFacts(await markets.heatmapData('sp500'), w.change)),
  ]);

  // Deduplicate facts shared by modules; the first source wins.
  const seen = new Set();
  const once = done.flatMap((d) => d.facts).filter((f) => {
    const key = `${f.label}|${f.value}|${f.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ids are handed out here so a bundle numbers itself the same way every time
  const cutoff = Date.now() - w.days * 864e5;
  const list = once.map((f, i) => ({
    id: `f${i + 1}`,
    // whether this printed inside the window being read, which is what separates
    // a release from a figure that has stood since July
    printedInWindow: periodTime(f.published || f.period) >= cutoff,
    ...f,
  }));

  return {
    window,
    country,
    facts: list,
    missing: done.filter((d) => d.error).map((d) => ({ module: d.slug, num: MODULE[d.slug].num, error: d.error })),
    // module 8 holds no data of its own until Raman's watchlist API lands
    skipped: [{ module: 'watchlist', num: MODULE.watchlist.num, reason: 'not built' }],
    gatheredAt: new Date().toISOString(),
  };
}

module.exports = { MODULE, METRICS, WINDOWS, NATIONAL, FEED_COUNTRY, metrics, countries, facts, periodTime };
