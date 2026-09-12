const express = require('express');
const router = express.Router();
const { fail } = require('../redact');
const { metrics, countries, WINDOWS } = require('../desk');
const { digest } = require('../digest');

// ISO3 from the OECD country list, or every country at once. Checked rather
// than passed through: it reaches a filter and a cache key.
const COUNTRY = /^[A-Za-z]{3}$/;

function parseCountry(query) {
  const asked = String(query.country || 'all');
  if (asked === 'all') return { country: 'all' };
  if (!COUNTRY.test(asked)) return { error: 'country must be a three letter code, or all' };
  return { country: asked.toUpperCase() };
}

router.get('/metrics', async (req, res) => {
  const asked = parseCountry(req.query);
  if (asked.error) return res.status(400).json({ error: asked.error });

  try {
    const [panel, list] = await Promise.all([metrics(asked.country), countries()]);
    // `error` is never a key here: the frontend reads that as the whole
    // request having failed, and a dead OECD snapshot is one panel short
    res.json({
      metrics: panel.rows,
      truncated: panel.truncated,
      countries: list,
      snapshotError: panel.error,
    });
  } catch (err) {
    fail(res, err);
  }
});

// The ranked panel. It answers 200 with an empty ranking and a reason when the
// model is unavailable, because the facts behind it are still real.
router.get('/digest', async (req, res) => {
  const asked = parseCountry(req.query);
  if (asked.error) return res.status(400).json({ error: asked.error });

  const window = String(req.query.window || 'daily');
  if (!(window in WINDOWS)) return res.status(400).json({ error: `unknown window: ${window}` });

  try {
    res.json(await digest({ window, country: asked.country }));
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
