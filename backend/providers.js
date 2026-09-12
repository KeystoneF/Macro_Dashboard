// Shared provider clients, cache and FRED request queue.

const fetch = require('./http');
const VALET_BASE = 'https://www.bankofcanada.ca/valet';
const FRED_BASE = 'https://api.stlouisfed.org/fred';
const STATCAN_BASE = 'https://www150.statcan.gc.ca/t1/wds/rest';

const cache = new Map();

// Bound caches whose keys include user input.
const CACHE_MAX = 2_000;

// Share in-flight requests; a zero TTL bypasses stored results.
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && (hit.pending || (ttl > 0 && Date.now() < hit.expiresAt))) return hit.data;
  const entry = { pending: true, expiresAt: 0, data: null };
  entry.data = Promise.resolve().then(fn).then((data) => {
    entry.pending = false;
    entry.expiresAt = Date.now() + ttl;
    return data;
  }).catch((err) => {
    if (cache.get(key) === entry) cache.delete(key);
    throw err;
  });
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return entry.data;
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

// Space FRED dispatches to stay within its request budget.
const FRED_GAP_MS = 550;

// Prioritize chart requests over catalogue freshness lookups.
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
  if (fredWaiting.live.length + fredWaiting.background.length >= 100) {
    return Promise.reject(new Error('FRED request queue is full, try again shortly'));
  }
  return new Promise((resolve, reject) => {
    fredWaiting[background ? 'background' : 'live'].push({ url, resolve, reject });
    if (!fredPumping) fredPump();
  });
}

const SOURCE_NAME = { boc: 'Bank of Canada', fred: 'FRED', statcan: 'Statistics Canada' };


const num = (v) => {
  if ((typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Valet stores each series value under its ID; suppressed values are empty.
async function bocObs(id, start) {
  const r = await fetch(`${VALET_BASE}/observations/${encodeURIComponent(id)}/json?start_date=${start}`);
  if (!r.ok) throw new Error(`valet ${id} ${r.status}`);
  const body = await r.json();

  return (body.observations || [])
    .map((row) => ({ d: row.d, v: num(row[id] && row[id].v) }))
    .filter((o) => o.d && o.v !== null)
    .sort((a, b) => a.d.localeCompare(b.d));
}

// FRED writes "." for a non-trading day, so those rows are dropped rather than zeroed
async function fredObs(id, start, units) {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY missing');

  const params = new URLSearchParams({
    series_id: id,
    api_key: key,
    file_type: 'json',
    observation_start: start,
    sort_order: 'asc',
  });

  // FRED publishes the year over year change itself, so a caller asking for it
  // gets the provider's figure rather than one worked out here
  if (units) params.set('units', units);

  const r = await fredFetch(`${FRED_BASE}/series/observations?${params}`);
  if (!r.ok) throw new Error(`fred ${id} ${r.status}`);
  const body = await r.json();

  return (body.observations || [])
    .map((o) => ({ d: o.date, v: num(o.value) }))
    .filter((o) => o.v !== null);
}

// StatCan can return HTML during outages. Retry those responses.
// Match observations by vector ID, then trim to the requested date range.
const SC_RETRIES = 4;

// The cube list uses GET; vector queries use POST.
async function statcanRequest(path, options) {
  let last;
  for (let attempt = 0; attempt < SC_RETRIES; attempt++) {
    const response = await fetch(`${STATCAN_BASE}/${path}`, options);
    const text = (await response.text()).trimStart();
    if (response.ok && !text.startsWith('<')) return JSON.parse(text);
    last = new Error(`statcan ${path} ${response.status}`);
    if (attempt < SC_RETRIES - 1) {
      await new Promise((done) => setTimeout(done, 1500 * (attempt + 1)));
    }
  }
  throw last;
}

const statcanGet = (path) => statcanRequest(path);
const statcanPost = (path, body) => statcanRequest(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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
  return fredObs(meta.id, start, meta.fredUnits);
}

// Use FRED metadata to check freshness without downloading observations.
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

// Validate dates before they reach provider URLs.
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function isoAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}



// Keep StatCan's scalar factor in the units; values already use that scale.
const SCALAR_UNITS = {
  0: '', 1: 'Tens', 2: 'Hundreds', 3: 'Thousands', 4: 'Tens of thousands',
  5: 'Hundreds of thousands', 6: 'Millions', 7: 'Tens of millions',
  8: 'Hundreds of millions', 9: 'Billions',
};

const SC_FREQUENCY = {
  1: 'Daily', 2: 'Weekly', 4: 'Biweekly', 6: 'Monthly',
  7: 'Bimonthly', 9: 'Quarterly', 11: 'Semi-annual', 12: 'Annual',
};

// Provider metadata supplies chart labels, units and cadence.
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
    // Valet's metadata endpoint uses seriesDetails (plural).
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
  isoDate,
};
