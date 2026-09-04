const express = require('express');
const router = express.Router();
const { YARDENI, YARDENI_PAGE, chart } = require('../valuation');
const { SHILLER, load: loadShiller } = require('../shiller');
const { USER_AGENT } = require('../feeds');
const { fail, redact } = require('../redact');

const CACHE_MS = 10 * 60_000;

// fetched chart bodies, keyed by chart id
const cache = new Map();
const inFlight = new Map();

// the Datastream gateway returns HTML when Accept-Language is `*`
const HEADERS = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-CA,en', Accept: '*/*' };

async function fetchChart(entry) {
  const r = await fetch(entry.url, { headers: HEADERS });
  if (!r.ok) throw new Error(`${entry.id} ${r.status}`);

  // upstream can answer 200 with an error page
  const type = r.headers.get('content-type') || '';
  if (!type.startsWith(entry.type)) throw new Error(`${entry.id} answered ${type || 'no type'}`);

  return {
    at: Date.now(),
    body: Buffer.from(await r.arrayBuffer()),
    lastModified: r.headers.get('last-modified'),
  };
}

// returns the cached body, or one fetch shared by concurrent callers
function load(entry) {
  const hit = cache.get(entry.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit);
  if (inFlight.has(entry.id)) return inFlight.get(entry.id);

  const p = fetchChart(entry)
    .then((fresh) => {
      cache.set(entry.id, fresh);
      return fresh;
    })
    .finally(() => inFlight.delete(entry.id));

  inFlight.set(entry.id, p);
  return p;
}

// Warmed at boot, because the workbook is 1.6MB and the parse is the slowest
// thing on this module.
loadShiller().catch((err) => console.error('shiller warm failed:', redact(err.message)));

router.get('/', async (req, res) => {
  let shiller = { observations: [], value: null, average: null, asOf: null, from: null, updated: null };
  let error = null;

  try {
    const { at, ...series } = await loadShiller();
    shiller = series;
  } catch (err) {
    // rows stay at n/a and the panel still renders
    error = redact(err.message);
  }

  res.json({
    shiller: { ...SHILLER, ...shiller, error },
    yardeni: {
      page: YARDENI_PAGE,
      source: YARDENI[0].source,
      charts: YARDENI.map((c) => ({ id: c.id, label: c.label })),
    },
    fetchedAt: new Date().toISOString(),
  });
});

router.get('/chart/:id', async (req, res) => {
  const entry = chart(req.params.id);
  if (!entry) return res.status(404).json({ error: `unknown chart: ${req.params.id}` });

  try {
    const { body } = await load(entry);
    res.type(entry.type);
    res.set('Cache-Control', `private, max-age=${CACHE_MS / 1000}`);
    res.send(body);
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
