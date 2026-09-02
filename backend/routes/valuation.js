const express = require('express');
const router = express.Router();
const { SHILLER, YARDENI, YARDENI_PAGE, chart } = require('../valuation');
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

const num = (m) => (m && Number.isFinite(Number(m[1])) ? Number(m[1]) : null);

// reads the UTC stamp printed on the chart, falling back to last-modified.
// "Sept." is trimmed to three letters for Date.parse
function stampOf(svg, lastModified) {
  const printed = svg.match(/Interactive Charts\.\s*([^<]*?)\.\s*Powered by/i);
  if (printed) {
    const t = Date.parse(printed[1].replace(/^([A-Za-z]{3})[a-z]*\.?/, '$1'));
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  const t = Date.parse(lastModified || '');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// reads the figures GuruFocus writes as text in the SVG, null without a stamp
function readShiller(body, lastModified) {
  const svg = body.toString('utf8');
  const value = num(svg.match(/current:\s*([\d.]+)/i));
  const average = num(svg.match(/Historical Average:\s*([\d.]+)/i));
  const asOf = stampOf(svg, lastModified);
  return { value: asOf ? value : null, average: asOf ? average : null, asOf };
}

router.get('/', async (req, res) => {
  let shiller = { value: null, average: null, asOf: null };
  let error = null;

  try {
    const { body, lastModified } = await load(SHILLER);
    shiller = readShiller(body, lastModified);
  } catch (err) {
    // rows stay at n/a and the panel still renders
    error = redact(err.message);
  }

  res.json({
    shiller: {
      id: SHILLER.id,
      label: SHILLER.label,
      source: SHILLER.source,
      page: SHILLER.page,
      ...shiller,
      error,
    },
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
