const express = require('express');
const router = express.Router();
const { fail, redact } = require('../redact');
const CATALOGUE = require('../catalogue');
const {
  cached,
  pool,
  SOURCE_NAME,
  observations,
  latestDate,
  isoAgo,
  isoDate,
  describeSeries,
} = require('../providers');
const { row } = require('../csv');

const CACHE_MS = 30 * 60_000; // official stats print monthly at best
// The catalogue only moves when a series prints, and resolving it costs one
// request per series, so it is held far longer than the observations are.
const CATALOGUE_CACHE_MS = 6 * 60 * 60_000;

const byId = (id) => CATALOGUE.find((s) => s.id === id);

// Discovered series use source:id to avoid provider ID collisions.
const DISCOVERED = /^(fred|boc|statcan):(.+)$/;

// what each provider will accept in an id, so nothing unchecked reaches a URL
const ID_SHAPE = {
  fred: /^[A-Za-z0-9_.@-]{1,64}$/,
  boc: /^[A-Za-z0-9_.\-+]{1,64}$/,
  statcan: /^v\d{1,12}$/i,
};

const META_CACHE_MS = 6 * 60 * 60_000;

function discoveredMeta(ref) {
  const match = DISCOVERED.exec(ref);
  if (!match) return null;
  const [, src, id] = match;
  if (!ID_SHAPE[src].test(id)) return null;
  return { src, id };
}

// Read discovered series metadata for axis units and gap detection.
const metaFor = (ref) =>
  cached(`meta:${ref}`, META_CACHE_MS, async () => {
    const found = discoveredMeta(ref);
    if (!found) throw new Error(`unknown series: ${ref}`);
    const meta = await describeSeries(found.src, found.id);
    return { ...meta, id: found.id, ref, src: found.src, source: SOURCE_NAME[found.src] };
  });

// duplicate FRED traffic was enough to trip the rate limit on its own.
const freshness = new Map();
let sweptAt = 0;
let sweeping = null;

function sweepFreshness() {
  if (sweeping) return sweeping;
  sweeping = pool(CATALOGUE, async (s) => {
    try {
      // behind anything an analyst is waiting on: the Last column is allowed
      // to say "checking" for a minute, a chart is not
      freshness.set(s.id, await latestDate(s, { background: true }));
    } catch {
      // one dead series must not cost the other 118 their row
      freshness.set(s.id, null);
    }
  })
    .then(() => {
      sweptAt = Date.now();
    })
    .catch((err) => console.error('freshness sweep failed:', redact(err.message)))
    .finally(() => {
      sweeping = null;
    });
  return sweeping;
}

router.warm = sweepFreshness;

router.get('/catalogue', (req, res) => {
  if (!sweeping && Date.now() - sweptAt > CATALOGUE_CACHE_MS) sweepFreshness();

  res.json({
    series: CATALOGUE.map(({ src, ...s }) => ({
      ...s,
      source: SOURCE_NAME[src],
      updated: freshness.has(s.id) ? freshness.get(s.id) : null,
    })),
    // tells the explorer that a blank Last column is a pending lookup rather
    // than a series that has stopped printing
    resolving: freshness.size < CATALOGUE.length,
  });
});

// Share parsing between JSON and CSV routes.
function parseRequest(query) {
  const ids = [...new Set(String(query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean))];
  // shape-checked, not just defaulted: it is concatenated into the Valet query
  // string downstream, where anything else could add parameters of its own
  const start = query.start ? isoDate(query.start) : isoAgo(10);

  if (!ids.length) return { error: 'ids required' };
  if (ids.length > 12) return { error: 'request at most 12 series at a time' };
  if (!start) return { error: 'start must be a date as YYYY-MM-DD' };
  if (start < '1600-01-01' || start > new Date().toISOString().slice(0, 10)) {
    return { error: 'start must be between 1600-01-01 and today' };
  }

  const unknown = ids.filter((id) => !byId(id) && !discoveredMeta(id));
  if (unknown.length) return { error: `unknown series: ${unknown.join(', ')}` };

  return { ids, start };
}

// Cache each series independently so adding one does not refetch the others.
const oneSeries = (ref, start) =>
  cached(`obs:${ref}:${start}`, CACHE_MS, async () => {
    const meta = byId(ref) || (await metaFor(ref));
    return {
      id: ref,
      label: meta.label,
      country: meta.country,
      group: meta.group ?? 'Found by search',
      source: SOURCE_NAME[meta.src],
      units: meta.units,
      freq: meta.freq,
      observations: await observations(meta, start),
    };
  });

const seriesFor = (ids, start) => pool(ids, (ref) => oneSeries(ref, start));

router.get('/', async (req, res) => {
  const asked = parseRequest(req.query);
  if (asked.error) return res.status(400).json({ error: asked.error });

  try {
    res.json({ start: asked.start, series: await seriesFor(asked.ids, asked.start) });
  } catch (err) {
    fail(res, err);
  }
});

// Export one column block per series, each with its own dates.
const COLUMNS = ['series_id', 'label', 'country', 'source', 'units', 'date', 'value'];

router.get('/csv', async (req, res) => {
  const asked = parseRequest(req.query);
  if (asked.error) return res.status(400).json({ error: asked.error });

  try {
    const series = await seriesFor(asked.ids, asked.start);
    const longest = Math.max(0, ...series.map((s) => s.observations.length));

    const rows = [row(series.flatMap(() => COLUMNS))];
    for (let i = 0; i < longest; i++) {
      rows.push(
        row(
          series.flatMap((s) => {
            const o = s.observations[i];
            if (!o) return COLUMNS.map(() => null);
            return [s.id, s.label, s.country, s.source, s.units, o.d, o.v];
          }),
        ),
      );
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="series.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    fail(res, err);
  }
});

// last print per curated series, for the brief's digest. Already swept at
// boot, so reading it costs nothing upstream.
router.freshness = () => CATALOGUE.map((s) => ({
  id: s.id,
  label: s.label,
  country: s.country,
  group: s.group,
  units: s.units,
  freq: s.freq,
  source: SOURCE_NAME[s.src],
  updated: freshness.get(s.id) ?? null,
}));

module.exports = router;
