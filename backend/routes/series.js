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

// A series found through search is not in the curated list, so it arrives as
// "source:id" and its label, units and frequency are read from the provider
// rather than from a table we maintain. The prefix is required: a bare id
// cannot say whether GDP means the FRED series or a Valet one.
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

// Metadata for a discovered series, so the chart gets real units and frequency:
// both matter, because the axis split reads units and the gap detection reads
// the cadence.
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

sweepFreshness();

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

// Shared by the JSON route and the CSV export. The export used to fetch the
// JSON route over HTTP, which broke as soon as the API required a session:
// the internal request carried no cookie and came back 401. An endpoint should
// never call itself.
function parseRequest(query) {
  const ids = String(query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // shape-checked, not just defaulted: it is concatenated into the Valet query
  // string downstream, where anything else could add parameters of its own
  const start = query.start ? isoDate(query.start) : isoAgo(10);

  if (!ids.length) return { error: 'ids required' };
  if (!start) return { error: 'start must be a date as YYYY-MM-DD' };

  const unknown = ids.filter((id) => !byId(id) && !discoveredMeta(id));
  if (unknown.length) return { error: `unknown series: ${unknown.join(', ')}` };

  return { ids, start };
}

// Cached per series, not per request. Keying on the whole id list meant adding
// a fifth series to a chart re-pulled the other four from upstream, and with
// two rate-limited FRED calls behind each of them that was the difference
// between a click and a five second wait.
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

// Long format on purpose. Series here run at different frequencies, and a wide
// grid would need a value on every row for every column, which means inventing
// the ones that never printed.
router.get('/csv', async (req, res) => {
  const asked = parseRequest(req.query);
  if (asked.error) return res.status(400).json({ error: asked.error });

  try {
    const series = await seriesFor(asked.ids, asked.start);

    const rows = ['series_id,label,country,source,units,date,value'];
    for (const s of series) {
      for (const o of s.observations) {
        rows.push(row([s.id, s.label, s.country, s.source, s.units, o.d, o.v]));
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="series.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
