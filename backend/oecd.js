// Share OECD's hourly request budget across catalogue, search and charts.

const { cached } = require('./providers');
const fetch = require('./http');

const BASE = 'https://sdmx.oecd.org/public/rest';

const STRUCTURE = 'application/vnd.sdmx.structure+json;version=1.0';
const DATA = 'application/vnd.sdmx.data+json;version=1.0';

const CATALOGUE_MS = 12 * 60 * 60_000; // the list itself moves on a release, not on a tick
const FLOW_MS = 12 * 60 * 60_000;
const DATA_MS = 6 * 60 * 60_000;

const HOUR_MS = 3600_000;
const CEILING = 60;
// held back for the curated metrics, so a search cannot take the module's own
// panels down with it
const RESERVED = 8;
// the block carries no Retry-After and the window it is counting is an hour
const BLOCK_MS = 15 * 60_000;

const calls = [];
let blockedUntil = 0;

function used() {
  const cutoff = Date.now() - HOUR_MS;
  while (calls.length && calls[0] < cutoff) calls.shift();
  return calls.length;
}

const minutesUntil = (at) => Math.max(1, Math.ceil((at - Date.now()) / 60_000));

// Keep the last successful response for rate-limit fallback.
const HELD_MAX = 200;
const held = new Map();

function keep(url, body) {
  held.delete(url);
  held.set(url, body);
  if (held.size > HELD_MAX) held.delete(held.keys().next().value);
}

// `core` is the curated metrics, which may spend into the reserve.
async function ask(url, accept, { core = false } = {}) {
  const limit = core ? CEILING : CEILING - RESERVED;
  const spare = held.get(url);

  if (Date.now() < blockedUntil) {
    if (spare) return spare;
    throw new Error(`OECD is rate limiting this server, ${minutesUntil(blockedUntil)} minutes left`);
  }
  if (used() >= limit) {
    if (spare) return spare;
    throw new Error(
      `this server has used ${used()} of OECD's 60 requests an hour, try again in a few minutes`,
    );
  }

  calls.push(Date.now());
  // omitting Accept-Language answers 500 with the body "languageTag1"
  const r = await fetch(url, { headers: { Accept: accept, 'Accept-Language': 'en' } });

  if (r.status === 429) {
    blockedUntil = Date.now() + BLOCK_MS;
    if (spare) return spare;
    throw new Error('OECD answered 429: 60 requests an hour is the published limit');
  }

  if (!r.ok) {
    const text = (await r.text()).slice(0, 200);
    // OECD uses different 404 codes for missing datasets and empty selections.
    if (r.status === 404) {
      const empty = /No(Results|Records|Data)Found/i.test(text);
      const err = new Error(empty ? 'that combination is not published' : `oecd 404 ${text}`);
      err.empty = empty;
      throw err;
    }
    // lastNObservations is blocked on the datasets over 20 million observations
    if (r.status === 413) {
      const err = new Error('OECD will not answer a dimension probe on a dataset this large');
      err.tooBig = true;
      throw err;
    }
    throw new Error(`oecd ${r.status} ${text}`.trim());
  }

  const body = await r.json();
  keep(url, body);
  return body;
}

const budget = () => ({ used: used(), ceiling: CEILING, blockedFor: Date.now() < blockedUntil ? minutesUntil(blockedUntil) : 0 });

// Catalogue

const strip = (html) =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// urn:...DataStructure=OECD.SDD.TPS:DSD_PRICES(1.0)
const urnParts = (urn) => {
  const m = /=([^:]+):([^(]+)\(([^)]+)\)/.exec(String(urn || ''));
  return m ? { agency: m[1], id: m[2], version: m[3] } : null;
};

// These datasets reject lastNObservations probes with HTTP 413.
const PROBE_BLOCKED = new Set([
  'OECD.SDD.TPS:DSD_BATIS@DF_BATIS',
  'OECD.ENV.EPI:DSD_ECH@EXT_TEMP_P',
  'OECD.STI.PIE:DSD_TIM_2023@DF_TIM_2023',
  'OECD.STI.PIE:DSD_TIM_2021@DF_TIM_2021',
  'OECD.STI.PIE:DSD_TIMBC_2023@DF_TIMBC_2023',
  'OECD.SDD.STES:DSD_STES_REVISIONS@DF_STES_REVISIONS',
  'OECD.SDD.TPS:DSD_BIMTS@DF_BIMTS_HS2017_2D',
  'OECD.SDD.TPS:DSD_BIMTS@DF_BIMTS_CPA_2_1',
  'OECD.SDD.TPS:DSD_SDBSBSC_ISIC4@DF_SDBS_ISIC4',
  'OECD.CFE.EDS:DSD_LA_EXTREME_TEMP_DDOWN@DF_EXTREME_TEMP_DDOWN',
  'OECD.CFE.EDS:DSD_LA_DEMO_POP_AGE_DDOWN@DF_POP_AGE_DDOWN',
  'OECD.EDU.IMEP:DSD_EAG_UOE_FIN@DF_UOE_FIN_INDIC_SOURCE_NATURE',
]);

// Subnational cuts of a dataset. The module compares countries, so these rank
// below a national one rather than being dropped.
const SUBNATIONAL = /[-–]\s*(regions?|local areas?|cities and fuas|metropolitan areas)\s*(\(.*\))?$/i;

const STALE_AFTER_DAYS = 400;

const isStale = (updated) =>
  !updated || Date.now() - Date.parse(updated) > STALE_AFTER_DAYS * 864e5;

// Fetch catalogue metadata in bulk; avoid requests per search result.
const catalogue = () =>
  cached('oecd:catalogue', CATALOGUE_MS, async () => {
    const [flowBody, stampBody, schemeBody, catBody] = await Promise.all([
      ask(`${BASE}/dataflow/all`, STRUCTURE, { core: true }),
      ask(`${BASE}/contentconstraint/all?detail=allstubs`, STRUCTURE, { core: true }),
      ask(`${BASE}/categoryscheme/OECD/OECDCS1/latest`, STRUCTURE, { core: true }),
      ask(`${BASE}/categorisation/all`, STRUCTURE, { core: true }),
    ]);

    // "Availability (A) for X" carries the timestamp of the last release
    const stamps = new Map();
    for (const c of stampBody.data.contentConstraints || []) {
      if (c.type !== 'Actual' || !c.validFrom) continue;
      // two datasets carry 9999-12-31, which is a placeholder and not a date
      if (Date.parse(c.validFrom) > Date.now()) continue;
      stamps.set(`${c.agencyID}:${c.id}`, c.validFrom);
    }

    const catNames = new Map();
    for (const scheme of schemeBody.data.categorySchemes || []) {
      const walk = (list, ids, names) => {
        for (const c of list) {
          const nextIds = [...ids, c.id];
          const nextNames = [...names, c.name];
          catNames.set(nextIds.join('.'), nextNames);
          walk(c.categories || [], nextIds, nextNames);
        }
      };
      walk(scheme.categories || [], [], []);
    }

    const topics = new Map();
    for (const c of catBody.data.categorisations || []) {
      const source = /Dataflow=([^:]+):([^(]+)\(/.exec(c.source || '');
      const target = /Category=[^:]+:[^(]+\([^)]*\)\.(.+)$/.exec(c.target || '');
      if (!source || !target) continue;
      const names = catNames.get(target[1]);
      if (!names) continue;
      const key = `${source[1]}:${source[2]}`;
      if (!topics.has(key)) topics.set(key, new Set());
      for (const n of names) topics.get(key).add(n);
    }

    const flows = (flowBody.data.dataflows || []).map((f) => {
      const key = `${f.agencyID}:${f.id}`;
      const dsd = urnParts(f.structure);
      const annotation = (type) => (f.annotations || []).find((a) => a.type === type);
      return {
        ref: `${f.agencyID},${f.id},${f.version}`,
        key,
        id: f.id,
        agency: f.agencyID,
        name: f.name,
        // long enough to search rather than to show: the key indicators
        // dataset does not name interest rates until well past 400 characters
        description: strip(f.description).slice(0, 700),
        topics: [...(topics.get(key) || [])],
        updated: stamps.get(`${f.agencyID}:CR_A_${f.id}`) || null,
        dsd,
        // the Data Explorer's own opening selection, which is a better starting
        // point for the picker than the first value of every dimension
        defaults: annotation('DEFAULT') ? String(annotation('DEFAULT').title || '') : '',
        subnational: SUBNATIONAL.test(f.name),
        probeBlocked: PROBE_BLOCKED.has(key),
      };
    });

    return { flows, byRef: new Map(flows.map((f) => [f.ref, f])) };
  });

// Search

const words = (q) =>
  String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

// same shape as the explorer's: how many of the words are found, and where
function scoreLocal(haystack, terms) {
  const text = haystack.toLowerCase();
  let matched = 0;
  let position = 0;

  for (const term of terms) {
    const at = text.indexOf(term);
    if (at < 0) continue;
    matched += 1;
    position += at === 0 ? 3 : /\s/.test(text[at - 1] || ' ') ? 2 : 1;
  }

  if (!matched) return 0;
  return matched * 100 + position;
}

// Prefer the full search phrase over scattered matching words.
const PHRASE = 700;
const SUBNATIONAL_PENALTY = 300;
const PER_SEARCH = 12;

async function search(query, includeAll) {
  const terms = words(query);
  if (!terms.length) return { results: [], budget: budget() };

  const phrase = terms.join(' ');
  const { flows } = await catalogue();

  const ranked = flows
    .filter((f) => includeAll || !isStale(f.updated))
    .map((f) => {
      const idWords = f.id.replace(/^DSD_|@DF_/g, ' ').replace(/_/g, ' ');
      const topic = f.topics.join(' ');
      const all = `${f.name} ${idWords} ${topic} ${f.description}`.toLowerCase();
      const covered = terms.filter((t) => all.includes(t)).length;

      let score =
        scoreLocal(f.name, terms) * 3 +
        scoreLocal(idWords, terms) * 2 +
        scoreLocal(topic, terms) * 2 +
        scoreLocal(f.description, terms);

      if (terms.length > 1) {
        if (f.name.toLowerCase().includes(phrase)) score += PHRASE;
        if (topic.toLowerCase().includes(phrase)) score += PHRASE;
        if (f.description.toLowerCase().includes(phrase)) score += PHRASE / 2;
      }
      if (f.subnational) score -= SUBNATIONAL_PENALTY;

      return { f, score, covered };
    })
    .filter((x) => x.score > 0)
    // a dataset matching every word beats one matching most of them, whatever
    // the words are worth
    .sort((a, b) => b.covered - a.covered || b.score - a.score || a.f.name.length - b.f.name.length)
    .slice(0, PER_SEARCH);

  return {
    results: ranked.map(({ f, covered }) => ({
      ref: f.ref,
      id: f.id,
      agency: f.agency,
      name: f.name,
      detail: f.description.slice(0, 160),
      topics: f.topics,
      updated: f.updated,
      stale: isStale(f.updated),
      partial: covered < terms.length,
      probeBlocked: f.probeBlocked,
    })),
    budget: budget(),
  };
}

const flowByRef = async (ref) => {
  const { byRef } = await catalogue();
  const flow = byRef.get(ref);
  // the catalogue is the allowlist: a ref that is not in it never reaches a url
  if (!flow) {
    const err = new Error(`unknown dataset: ${ref}`);
    // the caller asked for something that does not exist, which is not an
    // upstream failure and must not answer 502
    err.badRequest = true;
    throw err;
  }
  return flow;
};

// One dataset

// Every DSD here calls it REF_AREA, but the key is positional and a dataset
// that named it otherwise would be read with the country in the wrong slot.
const AREA_IDS = ['REF_AREA', 'COUNTRY', 'COU', 'LOCATION', 'REPORTING_COUNTRY'];

const dsdDimensions = (dsd) =>
  cached(`oecd:dsd:${dsd.agency}:${dsd.id}:${dsd.version}`, FLOW_MS, async () => {
    const body = await ask(
      `${BASE}/datastructure/${dsd.agency}/${dsd.id}/${dsd.version}`,
      STRUCTURE,
    );
    const structure = (body.data.dataStructures || [])[0];
    if (!structure) throw new Error(`no structure for ${dsd.id}`);
    return (structure.dataStructureComponents.dimensionList.dimensions || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((d) => d.id);
  });

const readObservations = (body) => {
  const dims = body.data.structure.dimensions.observation;
  const rows = Object.entries((body.data.dataSets[0] || {}).observations || {}).map(([k, cells]) => ({
    idx: k.split(':').map(Number),
    cells,
  }));
  return { dims, rows };
};

const valueAt = (dims, row, pos) => (pos < 0 ? null : dims[pos].values[row.idx[pos]]);

// Probe one observation per series to find published dimension combinations.
const PROBE_AREAS = 'CAN+USA';

async function flowDetail(ref) {
  const flow = await flowByRef(ref);

  return cached(`oecd:flow:${ref}`, FLOW_MS, async () => {
    if (!flow.dsd) throw new Error(`${flow.name} names no structure`);
    if (flow.probeBlocked) {
      throw new Error(
        `OECD blocks the dimension probe on ${flow.name}, which holds over 20 million observations`,
      );
    }

    const dimIds = await dsdDimensions(flow.dsd);
    const areaId = AREA_IDS.find((id) => dimIds.includes(id));
    if (!areaId) {
      throw new Error(`${flow.name} has no reference area, so it cannot be compared by country`);
    }

    const probe = async (areas) => {
      const key = dimIds.map((id) => (id === areaId ? areas : '')).join('.');
      return ask(
        `${BASE}/data/${ref}/${key}?lastNObservations=1&dimensionAtObservation=AllDimensions`,
        DATA,
      );
    };

    let body;
    try {
      body = await probe(PROBE_AREAS);
    } catch (err) {
      // a dataset that covers neither Canada nor the US still has combinations
      // worth listing, so the probe widens rather than reporting nothing
      if (!err.empty) throw err;
      try {
        body = await probe('');
      } catch (wider) {
        // nothing was picked yet, so "that combination is not published" would
        // name a choice the analyst has not made
        if (wider.empty) throw new Error(`${flow.name} publishes no observations to probe`);
        throw wider;
      }
    }

    const { dims, rows } = readObservations(body);
    const at = (id) => dims.findIndex((d) => d.id === id);
    const areaPos = at(areaId);
    const timePos = at('TIME_PERIOD');
    const keyPositions = dimIds
      .map((id) => ({ id, pos: at(id) }))
      .filter((d) => d.id !== areaId && d.pos >= 0);

    const combos = new Map();
    for (const row of rows) {
      if (typeof row.cells[0] !== 'number') continue;
      const values = keyPositions.map((d) => dims[d.pos].values[row.idx[d.pos]].id);
      const id = values.join('.');
      const period = valueAt(dims, row, timePos);
      const area = valueAt(dims, row, areaPos);

      const found = combos.get(id) || { values, last: null, areas: [] };
      if (period && (!found.last || period.id > found.last)) found.last = period.id;
      if (area && !found.areas.includes(area.id)) found.areas.push(area.id);
      combos.set(id, found);
    }

    // only the values that take part in a real combination, so the picker
    // cannot offer one the dataset does not hold
    const present = keyPositions.map((d, i) => {
      const seen = new Map();
      for (const combo of combos.values()) {
        const value = dims[d.pos].values.find((v) => v.id === combo.values[i]);
        if (value && !seen.has(value.id)) seen.set(value.id, { id: value.id, name: value.name });
      }
      return {
        id: d.id,
        name: dims[d.pos].name || d.id,
        values: [...seen.values()],
      };
    });

    return {
      ref,
      name: flow.name,
      description: flow.description,
      topics: flow.topics,
      updated: flow.updated,
      area: { id: areaId, name: (dims[areaPos] && dims[areaPos].name) || areaId },
      // the whole key in order, including the country slot, so the picker
      // builds exactly the key this route validates
      dimIds,
      dimensions: present,
      combos: [...combos.values()],
      defaults: pickDefault(present, combos, flow.defaults),
      probedAreas: (dims[areaPos] && dims[areaPos].values.map((v) => v.id)) || [],
    };
  });
}

// Choose the published combination closest to OECD's default selection.
function pickDefault(dimensions, combos, annotation) {
  const wanted = new Map();
  for (const part of String(annotation || '').split(',')) {
    const [id, value] = part.split('=');
    if (id && value) wanted.set(id.trim(), value.split('+')[0].trim());
  }

  let best = null;
  let bestScore = -1;
  for (const combo of combos.values()) {
    let score = 0;
    dimensions.forEach((d, i) => {
      if (wanted.get(d.id) === combo.values[i]) score += 1;
    });
    if (score > bestScore) {
      bestScore = score;
      best = combo;
    }
  }
  return best ? best.values : null;
}

// Drawing one

// Leave the country segment empty to fetch all countries in one call.
function buildKey(dimIds, areaId, picks) {
  return dimIds.map((id) => (id === areaId ? '' : (picks[id] ?? ''))).join('.');
}

const attributeNames = (body, wanted) => {
  const structure = body.data.structure;
  const out = new Set();

  const dataSet = structure.attributes.dataSet || [];
  const dsPos = dataSet.findIndex((a) => a.id === wanted);
  if (dsPos >= 0) {
    const idx = ((body.data.dataSets[0] || {}).attributes || [])[dsPos];
    const value = idx == null ? null : dataSet[dsPos].values[idx];
    if (value) out.add(value.name);
  }

  const observation = structure.attributes.observation || [];
  const obsPos = observation.findIndex((a) => a.id === wanted);
  if (obsPos >= 0) {
    for (const [, cells] of Object.entries((body.data.dataSets[0] || {}).observations || {})) {
      const idx = cells[obsPos + 1];
      const value = idx == null ? null : observation[obsPos].values[idx];
      if (value) out.add(value.name);
    }
  }

  return [...out];
};

async function seriesFor(ref, key, start, { core = false } = {}) {
  const flow = await flowByRef(ref);
  const body = await cached(`oecd:data:${ref}:${key}:${start}`, DATA_MS, () =>
    ask(
      `${BASE}/data/${ref}/${key}?startPeriod=${start}&dimensionAtObservation=AllDimensions`,
      DATA,
      { core },
    ),
  );

  const { dims, rows } = readObservations(body);
  const areaId = AREA_IDS.find((id) => dims.some((d) => d.id === id));
  const areaPos = dims.findIndex((d) => d.id === areaId);
  const timePos = dims.findIndex((d) => d.id === 'TIME_PERIOD');

  const byArea = new Map();
  for (const row of rows) {
    const value = row.cells[0];
    // a country that has not reported the period, rather than a zero
    if (!Number.isFinite(value)) continue;
    const area = valueAt(dims, row, areaPos);
    const period = valueAt(dims, row, timePos);
    if (!area || !period) continue;

    const found = byArea.get(area.id) || { code: area.id, name: area.name, observations: [] };
    found.observations.push({ d: period.id, v: value });
    byArea.set(area.id, found);
  }

  // periods come back in publication order, not chronological
  for (const area of byArea.values()) area.observations.sort((a, b) => a.d.localeCompare(b.d));

  // what was actually asked for, read back from the answer: every dimension
  // the key pinned carries exactly one value here
  const selection = dims
    .filter((d) => d.id !== areaId && d.id !== 'TIME_PERIOD' && d.values.length === 1)
    .map((d) => ({ dim: d.name || d.id, value: d.values[0].name }));

  const freqDim = dims.find((d) => d.id === 'FREQ');
  const unitDim = dims.find((d) => d.id === 'UNIT_MEASURE');
  const units = unitDim && unitDim.values.length === 1
    ? [unitDim.values[0].name]
    : attributeNames(body, 'UNIT_MEASURE');
  // the value is expressed in its multiplier rather than multiplied through by
  // it, the same trap StatCan's scalar factor carries
  const scale = attributeNames(body, 'UNIT_MULT').filter((s) => s && !/^unit/i.test(s));

  return {
    flow: ref,
    key,
    label: flow.name,
    selection,
    freq: freqDim && freqDim.values.length === 1 ? freqDim.values[0].name : null,
    units: [...units, ...scale].join(', ') || null,
    // one chart, one unit. Where a dataset reports countries in their own
    // currency there is no comparison to draw and the panel says so.
    mixedUnits: units.length > 1 ? units : null,
    areas: [...byArea.values()].sort((a, b) => a.name.localeCompare(b.name)),
    source: 'OECD Data Explorer, SDMX',
  };
}

module.exports = {
  catalogue,
  search,
  flowByRef,
  flowDetail,
  dsdDimensions,
  buildKey,
  seriesFor,
  isStale,
  budget,
  AREA_IDS,
};
