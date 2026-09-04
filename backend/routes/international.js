const express = require('express');
const router = express.Router();
const { fail } = require('../redact');
const { row } = require('../csv');

const SDMX = 'https://sdmx.oecd.org/public/rest/data';

const CACHE_MS = 6 * 60 * 60_000; // OECD republishes on release, not intraday
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

const AREAS = [
  { code: 'CAN', name: 'Canada' },
  { code: 'USA', name: 'United States' },
  { code: 'GBR', name: 'United Kingdom' },
  { code: 'DEU', name: 'Germany' },
  { code: 'FRA', name: 'France' },
  { code: 'ITA', name: 'Italy' },
  { code: 'JPN', name: 'Japan' },
  { code: 'OECD', name: 'OECD total' },
];

const AREA_KEY = AREAS.map((a) => a.code).join('+');

// Every key below is positional and the full width of its DSD, wildcards included.
// A key with the wrong number of segments returns 422 rather than an empty result,
// so these were each checked against a live response before being written down.
const METRICS = {
  gdp: {
    label: 'Real GDP, y/y',
    units: '%',
    freq: 'Quarterly',
    flow: 'OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD,1.1',
    key: `Q.Y.${AREA_KEY}.S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102`,
    start: '2019-Q1',
  },
  cpi: {
    label: 'CPI, all items y/y',
    units: '%',
    freq: 'Monthly',
    flow: 'OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0',
    key: `${AREA_KEY}.M.N.CPI.PA._T.N.GY`,
    start: '2019-01',
  },
  unemployment: {
    label: 'Unemployment rate',
    units: '%',
    freq: 'Monthly',
    flow: 'OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0',
    key: `${AREA_KEY}.UNE_LF_M.PT_LF_SUB._Z.Y._T.Y_GE15._Z.M`,
    start: '2019-01',
  },
};

// SDMX-JSON 1.0 keys each observation by colon-joined positions into the
// dimension value lists, so nothing can be read without the structure block.
// Two traps, both hit against live responses:
//   1. omitting Accept-Language returns a 500 reading "languageTag1"
//   2. the response nests under data.structure, not data.structures
async function sdmx(flow, key, start) {
  const url = `${SDMX}/${flow}/${key}?startPeriod=${start}&dimensionAtObservation=AllDimensions`;
  const r = await fetch(url, {
    headers: {
      Accept: 'application/vnd.sdmx.data+json;version=1.0',
      'Accept-Language': 'en',
    },
  });
  if (!r.ok) throw new Error(`oecd ${r.status}`);

  const body = await r.json();
  const dims = body.data.structure.dimensions.observation;
  const at = (id) => dims.findIndex((d) => d.id === id);

  const areaPos = at('REF_AREA');
  const timePos = at('TIME_PERIOD');
  const dataset = body.data.dataSets[0];

  const byArea = new Map();
  for (const [k, v] of Object.entries(dataset.observations || {})) {
    const value = v[0];
    if (typeof value !== 'number') continue; // a country that has not reported the period

    const idx = k.split(':').map(Number);
    const code = dims[areaPos].values[idx[areaPos]].id;
    const period = dims[timePos].values[idx[timePos]].id;

    if (!byArea.has(code)) byArea.set(code, []);
    byArea.get(code).push({ d: period, v: value });
  }

  // periods come back in publication order, not chronological
  for (const obs of byArea.values()) obs.sort((a, b) => a.d.localeCompare(b.d));
  return byArea;
}

async function metricSeries(name) {
  const m = METRICS[name];
  return cached(`intl:${name}`, async () => {
    const byArea = await sdmx(m.flow, m.key, m.start);
    return AREAS.map((a) => ({
      code: a.code,
      name: a.name,
      observations: byArea.get(a.code) || [],
    }));
  });
}

router.get('/', async (req, res) => {
  const name = req.query.metric || 'gdp';
  const m = METRICS[name];
  if (!m) return res.status(400).json({ error: `unknown metric: ${name}` });

  try {
    res.json({
      metric: name,
      label: m.label,
      units: m.units,
      freq: m.freq,
      areas: await metricSeries(name),
      source: 'OECD Data Explorer, SDMX',
    });
  } catch (err) {
    fail(res, err);
  }
});

// One row per country across all three metrics. Countries that have not reported
// a metric come back null and render as n/a rather than dropping out of the table.
router.get('/snapshot', async (req, res) => {
  try {
    const names = Object.keys(METRICS);
    const sets = await Promise.all(names.map(metricSeries));

    const rows = AREAS.map((a) => {
      const row = { code: a.code, name: a.name };
      names.forEach((n, i) => {
        const obs = sets[i].find((s) => s.code === a.code)?.observations || [];
        const last = obs[obs.length - 1] || null;
        row[n] = last ? { value: last.v, period: last.d } : null;
      });
      return row;
    });

    res.json({
      metrics: names.map((n) => ({ key: n, label: METRICS[n].label, units: METRICS[n].units })),
      rows,
      source: 'OECD Data Explorer, SDMX',
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/csv', async (req, res) => {
  const name = req.query.metric || 'gdp';
  const m = METRICS[name];
  if (!m) return res.status(400).json({ error: `unknown metric: ${name}` });

  try {
    const areas = await metricSeries(name);
    const rows = ['metric,country_code,country,period,value,units'];
    for (const a of areas) {
      for (const o of a.observations) {
        rows.push(row([name, a.code, a.name, o.d, o.v, m.units]));
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="oecd-${name}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
