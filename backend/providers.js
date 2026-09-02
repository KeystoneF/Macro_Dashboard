// One place for the three upstreams. The catalogue route and the discovery
// search both talk to them, and both must share the same FRED rate limiter:
// two independent queues would each stay under 120 requests a minute and
// together sail past it.

const VALET_BASE = 'https://www.bankofcanada.ca/valet';
const FRED_BASE = 'https://api.stlouisfed.org/fred';
const STATCAN_BASE = 'https://www150.statcan.gc.ca/t1/wds/rest';

const cache = new Map();

// Holds the promise, not the value: two analysts asking for the same series at
// once should share one upstream call rather than race to make two.
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = fn().catch((err) => {
    cache.delete(key); // a failure must not be served for the next half hour
    throw err;
  });
  cache.set(key, { at: Date.now(), data });
  return data;
}

const FAN_OUT = 4;

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(FAN_OUT, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// FRED allows 120 requests a minute, and resolving the catalogue asks about
// every FRED series in it. Past the limit it answers 403 on everything for the
// rest of the window, which reads as a dead key rather than as backpressure, so
// every FRED call is spaced instead of merely capped in flight.
const FRED_GAP_MS = 550;

// Two lanes rather than one chain. The catalogue freshness sweep is one call
// per FRED series and holds the queue for the better part of a minute; behind
// it, opening the explorer or adding a searched series waited eight to ten
// seconds for a single chart. Interactive calls go ahead of sweep calls, which
// only ever delays a column that is already allowed to fill in late.
const fredWaiting = { live: [], background: [] };
let fredPumping = false;

function fredPump() {
  const next = fredWaiting.live.shift() || fredWaiting.background.shift();
  if (!next) {
    fredPumping = false;
    return;
  }
  fredPumping = true;
  fetch(next.url).then(next.resolve, next.reject);
  // spacing is on dispatch, not on completion, so a slow reply does not make
  // the next caller wait for it as well
  setTimeout(fredPump, FRED_GAP_MS);
}

function fredFetch(url, { background = false } = {}) {
  return new Promise((resolve, reject) => {
    fredWaiting[background ? 'background' : 'live'].push({ url, resolve, reject });
    if (!fredPumping) fredPump();
  });
}

const SOURCE_NAME = { boc: 'Bank of Canada', fred: 'FRED', statcan: 'Statistics Canada' };


const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Valet single-series shape:
//   { observations: [ { d: "2026-08-06", "FXUSDCAD": { v: "1.3712" } } ] }
// A suppressed print comes back as an empty string rather than a missing row.
async function bocObs(id, start) {
  const r = await fetch(`${VALET_BASE}/observations/${id}/json?start_date=${start}`);
  if (!r.ok) throw new Error(`valet ${id} ${r.status}`);
  const body = await r.json();

  return (body.observations || [])
    .map((row) => ({ d: row.d, v: num(row[id] && row[id].v) }))
    .filter((o) => o.d && o.v !== null)
    .sort((a, b) => a.d.localeCompare(b.d));
}

// FRED writes "." for a non-trading day, so those rows are dropped rather than zeroed
async function fredObs(id, start) {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY missing');

  const params = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: 'json',
    observation_start: start,
    sort_order: 'asc',
  });

  const r = await fredFetch(`${FRED_BASE}/series/observations?${params}`);
  if (!r.ok) throw new Error(`fred ${id} ${r.status}`);
  const body = await r.json();

  return (body.observations || [])
    .map((o) => ({ d: o.date, v: num(o.value) }))
    .filter((o) => o.v !== null);
}

// Statistics Canada Web Data Service. Three things about it shape this code.
//
// It answers with an HTML error page, not JSON, when its database is briefly
// unreachable, so the body is inspected before it is parsed and the call is
// retried rather than thrown at the caller as a parse error.
//
// It does not answer in request order. Results carry their own vectorId and
// must be keyed by it; reading them off by index silently pairs one series'
// values with another series' name, which is exactly the kind of wrong that
// looks right.
//
// And it has no start-date parameter, only "latest N periods", so the window is
// sized from the frequency and then trimmed to the dates actually asked for.
const SC_RETRIES = 4;

// Not everything on the service is a POST: the cube list is a GET, and asking
// for it with a body comes back 405.
async function statcanGet(path) {
  let last = null;
  for (let attempt = 0; attempt < SC_RETRIES; attempt++) {
    const r = await fetch(`${STATCAN_BASE}/${path}`);
    const text = await r.text();
    if (r.ok && !text.startsWith('<')) return JSON.parse(text);
    last = `statcan ${path} ${r.status}`;
    await new Promise((done) => setTimeout(done, 1500 * (attempt + 1)));
  }
  throw new Error(last || `statcan ${path} failed`);
}

async function statcanPost(path, body) {
  let last = null;
  for (let attempt = 0; attempt < SC_RETRIES; attempt++) {
    const r = await fetch(`${STATCAN_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (r.ok && !text.startsWith('<')) return JSON.parse(text);
    last = `statcan ${path} ${r.status}`;
    await new Promise((done) => setTimeout(done, 1500 * (attempt + 1)));
  }
  throw new Error(last || `statcan ${path} failed`);
}

const PERIODS_PER_YEAR = { Daily: 260, Weekly: 53, Biweekly: 27, Monthly: 12, Quarterly: 4, Annual: 1 };

function periodsSince(start, freq) {
  const years = (Date.now() - Date.parse(start)) / (365.25 * 864e5);
  // four spare periods so a revision or an early release cannot fall off the end
  return Math.max(2, Math.ceil(years * (PERIODS_PER_YEAR[freq] || 12)) + 4);
}

// ids are stored with the leading v the rest of StatCan uses; the service wants
// the bare number
const vectorNumber = (id) => Number(String(id).replace(/^v/i, ''));

const pointsFor = (body, vectorId) => {
  const row = (body || []).find(
    (x) => x.status === 'SUCCESS' && x.object && x.object.vectorId === vectorId,
  );
  return row ? row.object.vectorDataPoint || [] : null;
};

async function statcanObs(meta, start) {
  const vectorId = vectorNumber(meta.id);
  const body = await statcanPost('getDataFromVectorsAndLatestNPeriods', [
    { vectorId, latestN: periodsSince(start, meta.freq) },
  ]);

  const pts = pointsFor(body, vectorId);
  if (!pts) throw new Error(`statcan ${meta.id} no data`);

  // a suppressed point comes back as value null rather than as a missing row
  return pts
    .map((o) => ({ d: o.refPer, v: o.value == null ? null : num(o.value) }))
    .filter((o) => o.d && o.v !== null && o.d >= start)
    .sort((a, b) => a.d.localeCompare(b.d));
}

function observations(meta, start) {
  if (meta.src === 'boc') return bocObs(meta.id, start);
  if (meta.src === 'statcan') return statcanObs(meta, start);
  return fredObs(meta.id, start);
}

// Date of the last print, which is what tells an analyst whether a series has
// gone stale. FRED carries it in the series metadata, so asking for that beats
// pulling a year of daily observations and reading the last row off the end.
async function latestDate(meta, { background = false } = {}) {
  if (meta.src === 'fred') {
    const key = process.env.FRED_API_KEY;
    if (!key) throw new Error('FRED_API_KEY missing');
    const r = await fredFetch(
      `${FRED_BASE}/series?series_id=${meta.id}&api_key=${key}&file_type=json`,
      { background },
    );
    if (!r.ok) throw new Error(`fred ${meta.id} ${r.status}`);
    const s = (await r.json()).seriess[0];
    return s ? s.observation_end : null;
  }

  if (meta.src === 'statcan') {
    const vectorId = vectorNumber(meta.id);
    // the last few rather than one, because the newest point can be suppressed
    const body = await statcanPost('getDataFromVectorsAndLatestNPeriods', [
      { vectorId, latestN: 4 },
    ]);
    const printed = (pointsFor(body, vectorId) || []).filter((o) => o.value != null);
    return printed.length ? printed[printed.length - 1].refPer : null;
  }

  // Valet has no metadata endpoint carrying the last date, so it gets a bounded
  // window instead. Two years covers the slowest series here, which is monthly.
  const obs = await bocObs(meta.id, isoAgo(2));
  return obs.length ? obs[obs.length - 1].d : null;
}

function isoAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// Last print per series. Spacing the FRED calls means resolving all 119 takes
// the better part of a minute, so it runs in the background and the catalogue
// endpoint answers immediately with whatever has landed. A blocking version
// made every cold request start its own copy of the same sweep, and the

// StatCan publishes a value alongside a scalar factor and the value is
// expressed IN that factor, so the scale belongs in the units string or the
// figure is wrong by three or six orders of magnitude.
const SCALAR_UNITS = {
  0: '', 1: 'Tens', 2: 'Hundreds', 3: 'Thousands', 4: 'Tens of thousands',
  5: 'Hundreds of thousands', 6: 'Millions', 7: 'Tens of millions',
  8: 'Hundreds of millions', 9: 'Billions',
};

const SC_FREQUENCY = {
  1: 'Daily', 2: 'Weekly', 4: 'Biweekly', 6: 'Monthly',
  7: 'Bimonthly', 9: 'Quarterly', 11: 'Semi-annual', 12: 'Annual',
};

// Label, units and frequency for a series that is not in the curated catalogue.
// Both matter downstream: the explorer splits axes by units and breaks chart
// lines on the series' own cadence.
async function describeSeries(src, id) {
  if (src === 'fred') {
    const key = process.env.FRED_API_KEY;
    if (!key) throw new Error('FRED_API_KEY missing');
    const r = await fredFetch(
      `${FRED_BASE}/series?series_id=${encodeURIComponent(id)}&api_key=${key}&file_type=json`,
    );
    if (!r.ok) throw new Error(`fred ${id} ${r.status}`);
    const s = ((await r.json()).seriess || [])[0];
    if (!s) throw new Error(`fred ${id} not found`);
    return {
      label: s.title,
      units: s.units_short || s.units || '',
      freq: s.frequency || 'Monthly',
      country: /canada|canadian/i.test(s.title) ? 'CA' : 'US',
    };
  }

  if (src === 'boc') {
    const r = await fetch(`${VALET_BASE}/series/${encodeURIComponent(id)}/json`);
    if (!r.ok) throw new Error(`valet ${id} ${r.status}`);
    // seriesDetails, plural. Valet's single-series response uses the plural
    // where its observation response uses the singular, and reading the wrong
    // one gives an empty object and a chart labelled with the raw id.
    const detail = (await r.json()).seriesDetails || {};
    return {
      label: detail.label || id,
      // Valet publishes no unit field. The description carries it in prose,
      // which is not something to parse into an axis label.
      units: '',
      // Valet does not publish a cadence, so it is read from the prints
      freq: await inferValetFrequency(id),
      country: 'CA',
    };
  }

  const vectorId = vectorNumber(id);
  const body = await statcanPost('getSeriesInfoFromVector', [{ vectorId }]);
  const row = (body || []).find((x) => x.status === 'SUCCESS' && x.object.vectorId === vectorId);
  if (!row) throw new Error(`statcan ${id} not found`);
  const o = row.object;
  const scale = SCALAR_UNITS[o.scalarFactorCode] || '';
  return {
    label: o.SeriesTitleEn || id,
    units: scale || 'Units',
    freq: SC_FREQUENCY[o.frequencyCode] || 'Monthly',
    country: 'CA',
  };
}

// Two years of prints is enough to tell daily from monthly, and the cadence is
// what the chart uses to decide whether a gap is a hole.
async function inferValetFrequency(id) {
  const obs = await bocObs(id, isoAgo(2));
  if (obs.length < 3) return 'Monthly';
  const steps = [];
  for (let i = 1; i < obs.length; i++) {
    steps.push(Math.round((Date.parse(obs[i].d) - Date.parse(obs[i - 1].d)) / 864e5));
  }
  const median = steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)];
  if (median <= 4) return 'Daily';
  if (median <= 10) return 'Weekly';
  if (median <= 20) return 'Biweekly';
  if (median <= 45) return 'Monthly';
  if (median <= 135) return 'Quarterly';
  return 'Annual';
}

module.exports = {
  describeSeries,
  VALET_BASE,
  FRED_BASE,
  STATCAN_BASE,
  cached,
  pool,
  fredFetch,
  statcanPost,
  statcanGet,
  vectorNumber,
  pointsFor,
  periodsSince,
  SOURCE_NAME,
  num,
  bocObs,
  fredObs,
  statcanObs,
  observations,
  latestDate,
  isoAgo,
};
