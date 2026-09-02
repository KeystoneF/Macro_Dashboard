const express = require('express');
const router = express.Router();
const { fail } = require('../redact');

const VALET = 'https://www.bankofcanada.ca/valet/observations';
const FRED = 'https://api.stlouisfed.org/fred/series/observations';

const CACHE_MS = 15 * 60_000; // yields print once a day, no reason to hammer either source
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Maturity grid. Canada cannot fill every rung and that is a data fact, not a bug:
//   1M   BoC stopped issuing after the CDOR wind-down, so there is no usable series
//   20Y  Canada publishes no 20-year benchmark
// Short-end Canada comes from T-bill auctions, which print weekly on Tuesdays,
// so the front of the CA curve is a different as-of date than the back. We report both.
const GRID = [
  { key: '1M', months: 1, ca: null, us: 'DGS1MO' },
  { key: '3M', months: 3, ca: 'V80691303', caGroup: 'tbill', us: 'DGS3MO' },
  { key: '6M', months: 6, ca: 'V80691304', caGroup: 'tbill', us: 'DGS6MO' },
  { key: '1Y', months: 12, ca: 'V80691305', caGroup: 'tbill', us: 'DGS1' },
  { key: '2Y', months: 24, ca: 'BD.CDN.2YR.DQ.YLD', caGroup: 'bond', us: 'DGS2' },
  { key: '3Y', months: 36, ca: 'BD.CDN.3YR.DQ.YLD', caGroup: 'bond', us: 'DGS3' },
  { key: '5Y', months: 60, ca: 'BD.CDN.5YR.DQ.YLD', caGroup: 'bond', us: 'DGS5' },
  { key: '7Y', months: 84, ca: 'BD.CDN.7YR.DQ.YLD', caGroup: 'bond', us: 'DGS7' },
  { key: '10Y', months: 120, ca: 'BD.CDN.10YR.DQ.YLD', caGroup: 'bond', us: 'DGS10' },
  { key: '20Y', months: 240, ca: null, us: 'DGS20' },
  { key: '30Y', months: 360, ca: 'BD.CDN.LONG.DQ.YLD', caGroup: 'bond', us: 'DGS30' },
];

const CA_GAP = {
  '1M': 'BoC publishes no 1-month bill series',
  '20Y': 'BoC publishes no 20-year benchmark',
};

const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Valet group response: { observations: [ { d: "2026-08-06", "SERIES.ID": { v: "2.85" } } ] }
//
// Two traps here, both found against live data:
//   1. `recent=N` is unreliable on groups. Valet accepts it and then returns a window
//      we did not ask for, so we pass an explicit date range instead.
//   2. Row order is not guaranteed, and a group's series do not all end on the same day
//      (the dead 1-month bill series is years behind the rest of its group). So we take
//      the newest value per series rather than trusting one shared "latest row".
async function valetGroup(group, endDate) {
  const end = endDate || new Date().toISOString().slice(0, 10);
  const start = new Date(new Date(end).getTime() - 400 * 864e5).toISOString().slice(0, 10);

  const res = await fetch(`${VALET}/group/${group}/json?start_date=${start}&end_date=${end}`);
  if (!res.ok) throw new Error(`valet ${group} ${res.status}`);
  const body = await res.json();

  const latest = {}; // series id -> { date, value }
  for (const row of body.observations || []) {
    const d = row.d;
    if (!d) continue;
    for (const [k, v] of Object.entries(row)) {
      if (k === 'd' || v == null) continue;
      const parsed = num(v.v);
      if (parsed === null) continue;
      if (!latest[k] || d > latest[k].date) latest[k] = { date: d, value: parsed };
    }
  }

  const values = {};
  const dates = [];
  for (const [id, { date, value }] of Object.entries(latest)) {
    values[id] = value;
    dates.push(date);
  }
  return { date: dates.sort().pop() || null, values, seriesDates: latest };
}

async function fredSeries(id, endDate) {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY missing');

  const params = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: 'json',
    sort_order: 'desc',
    limit: '40',
  });
  if (endDate) params.set('observation_end', endDate);

  const res = await fetch(`${FRED}?${params}`);
  if (!res.ok) throw new Error(`fred ${id} ${res.status}`);
  const body = await res.json();

  // FRED writes "." for a non-trading day, so skip down to the first real print
  for (const o of body.observations || []) {
    const v = num(o.value);
    if (v !== null) return { date: o.date, value: v };
  }
  return { date: null, value: null };
}

const bps = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 100));

function spreadsFor(points, field) {
  const at = (k) => points.find((p) => p.key === k)?.[field] ?? null;
  return {
    '10Y-2Y': bps(at('10Y'), at('2Y')),
    '10Y-3M': bps(at('10Y'), at('3M')),
    '30Y-10Y': bps(at('30Y'), at('10Y')),
  };
}

// Both routes below need the same payload, so it is built once here. The CSV
// route used to fetch its own JSON endpoint over HTTP, which broke the moment
// the API required a session: the internal request carried no cookie and came
// back 401. An endpoint should never call itself.
async function curveFor(date) {
  const [bonds, bills, ...us] = await cached(`yields:${date || 'latest'}`, () =>
    Promise.all([
      valetGroup('bond_yields_benchmark', date),
      valetGroup('tbill_tuesday', date),
      ...GRID.map((g) => fredSeries(g.us, date)),
    ]),
  );

  const points = GRID.map((g, i) => {
    const caSource = g.caGroup === 'tbill' ? bills : bonds;
    const ca = g.ca ? caSource.values[g.ca] ?? null : null;
    return {
      key: g.key,
      months: g.months,
      ca,
      us: us[i].value,
      caNote: g.ca ? null : CA_GAP[g.key],
    };
  });

  return {
    asOf: {
      caBonds: bonds.date,
      caBills: bills.date, // biweekly Tuesday print, will lag the bond date
      us: us.find((u) => u.date)?.date ?? null,
    },
    points,
    spreads: { ca: spreadsFor(points, 'ca'), us: spreadsFor(points, 'us') },
    sources: {
      ca: 'Bank of Canada Valet (benchmark bonds, T-bill auction averages)',
      us: 'U.S. Treasury constant maturity via FRED',
    },
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(await curveFor(req.query.date || null));
  } catch (err) {
    fail(res, err);
  }
});

// CSV export, a stated requirement in the design doc
router.get('/csv', async (req, res) => {
  try {
    const data = await curveFor(req.query.date || null);

    const rows = [
      'maturity,months,canada_yield_pct,us_yield_pct,canada_note',
      ...data.points.map((p) =>
        [p.key, p.months, p.ca ?? '', p.us ?? '', p.caNote ? `"${p.caNote}"` : ''].join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="yield-curve-${data.asOf.us || 'latest'}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
