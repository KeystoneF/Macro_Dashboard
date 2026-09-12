const express = require('express');
const router = express.Router();
const { fail } = require('../redact');
const { row } = require('../csv');
const {
  search,
  flowByRef,
  flowDetail,
  dsdDimensions,
  seriesFor,
  budget,
  AREA_IDS,
} = require('../oecd');

// Curated OECD measures. Empty country segments fetch all countries.
// Keys must include every dimension in the dataset's structure.
const METRICS = {
  gdp: {
    label: 'Real GDP, y/y',
    units: '%',
    freq: 'Quarterly',
    flow: 'OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD,1.1',
    key: 'Q.Y..S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102',
    start: '2019-Q1',
  },
  cpi: {
    label: 'CPI, all items y/y',
    units: '%',
    freq: 'Monthly',
    flow: 'OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0',
    key: '.M.N.CPI.PA._T.N.GY',
    start: '2019-01',
  },
  unemployment: {
    label: 'Unemployment rate',
    units: '%',
    freq: 'Monthly',
    flow: 'OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0',
    key: '.UNE_LF_M.PT_LF_SUB._Z.Y._T.Y_GE15._Z.M',
    start: '2019-01',
  },
};

// Exclude aggregates from country rankings.
const GROUPINGS = new Set(['OECD', 'OECDE', 'EA', 'EA19', 'EA20', 'EU', 'EU27_2020', 'G7', 'G20', 'USMCA', 'WXOECD', 'W']);

const isGrouping = (code) => GROUPINGS.has(code) || code.length !== 3;

// A dataset or a key that does not exist is the caller's mistake, not an
// upstream failure, so it answers 400 rather than going out as a 502.
const refuse = (res, err) =>
  err.badRequest ? res.status(400).json({ error: err.message }) : fail(res, err);

const SEGMENT = /^[A-Za-z0-9_-]*$/;
const START = /^\d{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$/;

// Validate discovered selections against the dataset structure.
async function parseFound(query) {
  const ref = String(query.flow || '');
  const key = String(query.key || '');
  const start = String(query.start || '2016');

  if (!START.test(start)) return { error: 'start must be a year, a month or a quarter' };
  if (ref.length > 200 || key.length > 500) return { error: 'dataset reference or key is too long' };

  const flow = await flowByRef(ref);
  if (!flow.dsd) return { error: `${flow.name} names no structure` };

  const dimIds = await dsdDimensions(flow.dsd);
  const areaId = AREA_IDS.find((id) => dimIds.includes(id));
  if (!areaId) return { error: `${flow.name} has no reference area` };

  const segments = key.split('.');
  if (segments.length !== dimIds.length) {
    return { error: `key must have ${dimIds.length} segments, got ${segments.length}` };
  }
  if (segments.some((s) => !SEGMENT.test(s))) return { error: 'key segments must be codes' };

  for (let i = 0; i < dimIds.length; i++) {
    const wildcard = segments[i] === '';
    if (dimIds[i] === areaId && !wildcard) {
      return { error: 'the country segment carries every country, so it is left empty' };
    }
    if (dimIds[i] !== areaId && wildcard) {
      return { error: `pick a value for ${dimIds[i]}` };
    }
  }

  return { ref, key, start, label: flow.name };
}

// One measure across countries, whether it came from the three above or from a
// search. Both answer in the same shape, so the chart does not care which.
async function measureFrom(query) {
  const name = query.metric;
  if (query.flow) {
    const asked = await parseFound(query);
    if (asked.error) return asked;
    const data = await seriesFor(asked.ref, asked.key, asked.start);
    return { metric: 'found', ...data, start: asked.start };
  }

  const m = Object.hasOwn(METRICS, name || 'gdp') ? METRICS[name || 'gdp'] : null;
  if (!m) return { error: `unknown metric: ${name}` };

  const data = await seriesFor(m.flow, m.key, m.start, { core: true });
  return {
    ...data,
    metric: name || 'gdp',
    // the curated three are named by the desk rather than by the dataset, which
    // calls this "Consumer price indices (CPIs, HICPs), COICOP 1999"
    label: m.label,
    units: m.units,
    freq: m.freq,
    start: m.start,
  };
}

router.get('/', async (req, res) => {
  try {
    const body = await measureFrom(req.query);
    if (body.error) return res.status(400).json({ error: body.error });
    res.json({ ...body, budget: budget() });
  } catch (err) {
    refuse(res, err);
  }
});

// One row per country across the three curated measures. A country that has not
// reported one comes back null and renders as n/a rather than dropping out.
async function snapshot() {
  const names = Object.keys(METRICS);
  const sets = await Promise.all(
    names.map((n) => seriesFor(METRICS[n].flow, METRICS[n].key, METRICS[n].start, { core: true })),
  );

  const seen = new Map();
  sets.forEach((set, i) => {
    for (const area of set.areas) {
      const found = seen.get(area.code) || { code: area.code, name: area.name, grouping: isGrouping(area.code) };
      const last = area.observations[area.observations.length - 1] || null;
      found[names[i]] = last ? { value: last.v, period: last.d } : null;
      seen.set(area.code, found);
    }
  });

  const rows = [...seen.values()].map((r) => {
    for (const n of names) if (!(n in r)) r[n] = null;
    return r;
  });

  return {
    metrics: names.map((n) => ({ key: n, label: METRICS[n].label, units: METRICS[n].units, freq: METRICS[n].freq })),
    rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    source: 'OECD Data Explorer, SDMX',
  };
}

router.get('/snapshot', async (req, res) => {
  try {
    res.json(await snapshot());
  } catch (err) {
    fail(res, err);
  }
});

// Search the cached OECD catalogue locally.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  // Default is datasets still being published. The catalogue carries a few
  // hundred that stopped, and those are behind this flag.
  const includeAll = req.query.all === '1';

  if (q.length < 2) return res.json({ query: q, results: [], includeAll });

  try {
    const { results, budget: left } = await search(q, includeAll);
    res.json({ query: q, results, includeAll, budget: left });
  } catch (err) {
    fail(res, err);
  }
});

// The dimension picker for one dataset: which values exist, which combinations
// of them are published, and how current each one is.
router.get('/flow', async (req, res) => {
  try {
    res.json(await flowDetail(String(req.query.ref || '')));
  } catch (err) {
    refuse(res, err);
  }
});

router.get('/csv', async (req, res) => {
  try {
    const body = await measureFrom(req.query);
    if (body.error) return res.status(400).json({ error: body.error });

    const name = body.metric === 'found' ? body.flow : body.metric;
    const rows = ['measure,label,country_code,country,period,value,units'];
    for (const area of body.areas) {
      for (const o of area.observations) {
        rows.push(row([name, body.label, area.code, area.name, o.d, o.v, body.units]));
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="oecd-${String(name).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.csv"`,
    );
    res.send(rows.join('\n'));
  } catch (err) {
    refuse(res, err);
  }
});

// the brief reads the same snapshot for its country list and its metric rows
router.snapshot = snapshot;

module.exports = router;
