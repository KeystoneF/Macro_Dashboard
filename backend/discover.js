// Search across everything the three providers

const {
  VALET_BASE,
  FRED_BASE,
  cached,
  fredFetch,
  statcanPost,
  statcanGet,
  bocObs,
  isoAgo,
  SOURCE_NAME,
} = require('./providers');

const LIST_CACHE_MS = 12 * 60 * 60_000; // provider catalogues barely move
const SEARCH_CACHE_MS = 10 * 60_000;

const STALE_AFTER_DAYS = 400;

const isStale = (lastPrint) =>
  !lastPrint || Date.now() - Date.parse(lastPrint) > STALE_AFTER_DAYS * 864e5;




const words = (q) =>
  String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

// Matching is on how many of the words are found
function scoreLocal(haystack, terms) {
  const text = haystack.toLowerCase();
  let matched = 0;
  let position = 0;

  for (const term of terms) {
    const at = text.indexOf(term);
    if (at < 0) continue;
    matched += 1;
    // earlier, and at a word boundary, is the better match
    position += at === 0 ? 3 : /\s/.test(text[at - 1] || ' ') ? 2 : 1;
  }

  if (!matched) return 0;
  // matched count dominates
  return matched * 100 + position;
}

// BoC

const valetIndex = () =>
  cached('valet:index', LIST_CACHE_MS, async () => {
    const r = await fetch(`${VALET_BASE}/lists/series/json`);
    if (!r.ok) throw new Error(`valet list ${r.status}`);
    const body = await r.json();
    return Object.entries(body.series || {}).map(([id, meta]) => ({
      id,
      label: meta.label || id,
      description: meta.description || '',
    }));
  });

// Most of Valet is not economic data.
const PUBLICATION_SNAPSHOT = /_(19|20)\d{2}([MQ]\d{1,2}|FALL|SPRING|_\d{2})?_/i;

const PUBLICATION_PREFIX =
  /^(MPR|BOS|BOSBG|SAN|CES|WM|CSCE|FSR|FSS|AR|SPEECH|CLIMATE|CSCB|BLP|SABA|INDINF)[_.]/i;

// Removing
const isPublicationPanel = (s) =>
  PUBLICATION_SNAPSHOT.test(s.id) || PUBLICATION_PREFIX.test(s.id) || !s.label || s.label === s.id;

function valetPenalty(s) {
  let penalty = 0;
  if (PUBLICATION_SNAPSHOT.test(s.id)) penalty += 250;
  if (PUBLICATION_PREFIX.test(s.id)) penalty += 150;
  // a label that is just the id carries no meaning to read
  if (s.label === s.id) penalty += 200;
  return penalty;
}

// Valet's list carries no dates
const lastPrintOf = (id) =>
  cached(`valet:last:${id}`, LIST_CACHE_MS, async () => {
    try {
      const obs = await bocObs(id, isoAgo(2));
      return obs.length ? obs[obs.length - 1].d : null;
    } catch {
      return null;
    }
  });

// Look at more than will be shown
const CANDIDATE_DEPTH = 3;

async function searchValet(terms, limit, includeAll) {
  const index = await valetIndex();

  const ranked = index
    .filter((s) => includeAll || !isPublicationPanel(s))
    .map((s) => ({
      s,
      score: scoreLocal(`${s.label} ${s.id} ${s.description}`, terms) - valetPenalty(s),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id.length - b.s.id.length)
    .slice(0, limit * CANDIDATE_DEPTH);

  const dated = await Promise.all(
    ranked.map(async ({ s }) => ({ s, lastPrint: await lastPrintOf(s.id) })),
  );

  return dated
    .filter(({ lastPrint }) => includeAll || !isStale(lastPrint))
    .slice(0, limit)
    .map(({ s, lastPrint }) => ({
      source: 'boc',
      sourceName: SOURCE_NAME.boc,
      country: 'CA',
      id: s.id,
      label: s.label,
      detail: s.description.slice(0, 140),
      // Valet publishes no frequency in its list
      freq: null,
      units: null,
      lastPrint,
      stale: isStale(lastPrint),
      addable: true,
    }));
}

// FRED

// Ranking
async function searchFred(query, limit, includeAll) {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY missing');

  const ask = async (text) => {
    const params = new URLSearchParams({
      search_text: text,
      api_key: key,
      file_type: 'json',
      limit: String(limit * CANDIDATE_DEPTH),
      order_by: 'search_rank',
      sort_order: 'desc',
    });
    const r = await fredFetch(`${FRED_BASE}/series/search?${params}`);
    if (!r.ok) throw new Error(`fred search ${r.status}`);
    return (await r.json()).seriess || [];
  };

  let hits = await ask(query);

  // FRED stems some words and not others
  const parts = words(query).sort((a, b) => b.length - a.length);
  for (let i = 0; !hits.length && i < Math.min(2, parts.length); i++) {
    if (parts[i] === query.toLowerCase()) continue;
    hits = await ask(parts[i]);
  }

  return hits
    .filter((s) => includeAll || !isStale(s.observation_end))
    .slice(0, limit)
    .map((s) => ({
    source: 'fred',
    sourceName: SOURCE_NAME.fred,
    country: /canada|canadian/i.test(s.title) ? 'CA' : 'US',
    id: s.id,
    label: s.title,
    detail: s.notes ? String(s.notes).slice(0, 140) : '',
    freq: s.frequency || null,
    units: s.units_short || s.units || null,
    lastPrint: s.observation_end || null,
    stale: isStale(s.observation_end),
    addable: true,
  }));
}

// Statistics Canada

const cubeIndex = () =>
  cached('statcan:cubes', LIST_CACHE_MS, async () => {
    const body = await statcanGet('getAllCubesListLite');
    return (Array.isArray(body) ? body : []).map((c) => ({
      productId: c.productId,
      title: c.cubeTitleEn || '',
      start: c.cubeStartDate || null,
      end: c.cubeEndDate ? String(c.cubeEndDate).slice(0, 10) : null,
      // getAllCubesListLite calls this field `archived`, not
      // `archiveStatusCode`
      archived: String(c.archived || '') === '1',
      frequencyCode: c.frequencyCode,
    }));
  });

const SC_FREQ = {
  1: 'Daily', 2: 'Weekly', 4: 'Biweekly', 6: 'Monthly',
  7: 'Bimonthly', 9: 'Quarterly', 11: 'Semi-annual', 12: 'Annual',
};

// A cube is a table, not a series.
const cubePenalty = (c) => (c.archived ? 260 : 0) + (isStale(c.end) ? 180 : 0);

// 8,229 tables
async function searchCubes(terms, limit, includeAll) {
  const index = await cubeIndex();
  return index
    .filter((c) => includeAll || (!c.archived && !isStale(c.end)))
    .map((c) => ({ c, score: scoreLocal(c.title, terms) - cubePenalty(c) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(b.c.end).localeCompare(String(a.c.end)))
    .slice(0, limit)
    .map(({ c }) => ({
      source: 'statcan',
      sourceName: SOURCE_NAME.statcan,
      country: 'CA',
      id: String(c.productId),
      label: c.title,
      detail: c.archived ? 'Archived table' : '',
      freq: SC_FREQ[c.frequencyCode] || null,
      units: null,
      lastPrint: c.end,
      stale: c.archived || isStale(c.end),
      // needs the dimension picker before it names a single series
      addable: false,
      productId: c.productId,
    }));
}

// Dimensions and their members
const cubeDimensions = (productId) =>
  cached(`statcan:cube:${productId}`, LIST_CACHE_MS, async () => {
    const body = await statcanPost('getCubeMetadata', [{ productId: Number(productId) }]);
    const row = (body || []).find((x) => x.status === 'SUCCESS');
    if (!row) throw new Error(`statcan cube ${productId} not found`);

    return {
      productId: Number(productId),
      title: row.object.cubeTitleEn,
      end: row.object.cubeEndDate ? String(row.object.cubeEndDate).slice(0, 10) : null,
      frequency: SC_FREQ[row.object.frequencyCode] || null,
      dimensions: (row.object.dimension || []).map((d) => ({
        name: d.dimensionNameEn,
        // the picker
        members: (d.member || []).map((m) => ({ id: m.memberId, name: m.memberNameEn })),
      })),
    };
  });

// A coordinate is positional
const COORD_WIDTH = 10;

const padCoordinate = (picks) =>
  [...picks.map((n) => String(Number(n) || 0)), ...Array(COORD_WIDTH).fill('0')]
    .slice(0, COORD_WIDTH)
    .join('.');

async function resolveCube(productId, picks) {
  const coordinate = padCoordinate(picks);
  const body = await statcanPost('getSeriesInfoFromCubePidCoord', [
    { productId: Number(productId), coordinate },
  ]);
  const row = (body || []).find((x) => x.status === 'SUCCESS');
  if (!row) throw new Error('that combination is not published as a series');

  const o = row.object;

  // A coordinate that names no series still answers status SUCCESS.
  if (!o.vectorId || o.responseStatusCode !== 0) {
    throw new Error('that combination is not published as a series');
  }

  return {
    source: 'statcan',
    sourceName: SOURCE_NAME.statcan,
    country: 'CA',
    // stored with the leading v the rest of StatCan uses
    id: `v${o.vectorId}`,
    label: o.SeriesTitleEn || `Vector ${o.vectorId}`,
    freq: SC_FREQ[o.frequencyCode] || null,
    // the scalar factor is the unit: a value of 21214.8 with a scalar of
    // thousands is 21.2 million
    scalarFactorCode: o.scalarFactorCode,
    terminated: Boolean(o.terminated),
    coordinate,
    addable: true,
  };
}

//one search across all three

const PER_SOURCE = 12;

async function search(query, sources, includeAll) {
  const terms = words(query);
  if (!terms.length) return { results: [], notes: [] };

  const wanted = (s) => sources === 'all' || sources === s;
  const notes = [];

  const run = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      // one provider being down must not empty the whole result list
      notes.push(`${name} search unavailable: ${err.message}`);
      return [];
    }
  };

  const [fred, boc, statcan] = await Promise.all([
    wanted('fred') ? run('FRED', () => searchFred(query, PER_SOURCE, includeAll)) : [],
    wanted('boc') ? run('Bank of Canada', () => searchValet(terms, PER_SOURCE, includeAll)) : [],
    wanted('statcan')
      ? run('Statistics Canada', () => searchCubes(terms, PER_SOURCE, includeAll))
      : [],
  ]);

  return { results: [...fred, ...boc, ...statcan], notes };
}

const cachedSearch = (query, sources, includeAll) =>
  cached(`search:${sources}:${includeAll ? 'all' : 'live'}:${query.toLowerCase()}`, SEARCH_CACHE_MS, () =>
    search(query, sources, includeAll),
  );

module.exports = { cachedSearch, cubeDimensions, resolveCube, isStale };
