const express = require('express');
const router = express.Router();
const { fail } = require('../redact');
const { cachedSearch, cubeDimensions, resolveCube } = require('../discover');

const SOURCES = ['all', 'fred', 'boc', 'statcan'];

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const sources = String(req.query.source || 'all');
  // Default is series an analyst can actually use. Everything else, the
  // discontinued and the single chart panels, is behind this flag.
  const includeAll = req.query.all === '1';

  if (!SOURCES.includes(sources)) {
    return res.status(400).json({ error: `unknown source: ${sources}` });
  }
  if (q.length < 2) return res.json({ query: q, results: [], notes: [] });

  try {
    const { results, notes } = await cachedSearch(q, sources, includeAll);
    res.json({ query: q, results, notes, includeAll });
  } catch (err) {
    fail(res, err);
  }
});

// The dimension picker for one StatCan table. A cube is not a series, so this
// is the step between finding a table and naming a single line on a chart.
router.get('/cube/:productId', async (req, res) => {
  const productId = String(req.params.productId);
  if (!/^\d{6,10}$/.test(productId)) {
    return res.status(400).json({ error: 'productId must be numeric' });
  }
  try {
    res.json(await cubeDimensions(productId));
  } catch (err) {
    fail(res, err);
  }
});

// Turns the picker's choices into a vector.
router.get('/cube/:productId/resolve', async (req, res) => {
  const productId = String(req.params.productId);
  const picks = String(req.query.picks || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (!/^\d{6,10}$/.test(productId)) {
    return res.status(400).json({ error: 'productId must be numeric' });
  }
  if (!picks.length || picks.some((p) => !/^\d+$/.test(p))) {
    return res.status(400).json({ error: 'picks must be member ids' });
  }

  try {
    const series = await resolveCube(productId, picks);
    if (series.terminated) {
      // still returned, because an analyst may want the history on purpose.
      // Saying so beats letting a dead series onto a chart unannounced.
      series.note = 'This series has been terminated and will not update.';
    }
    res.json(series);
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
