const express = require('express');
const router = express.Router();
const { fail, redact, describe } = require('../redact');
const { cached, pool, SOURCE_NAME, observations, isoAgo } = require('../providers');

const CACHE_MS = 30 * 60_000; // the fastest of these prints once a day

// The six rows the brief's snapshot carries, as the mockup names them. Each one
// comes from the national source rather than from an international aggregator,
// because the OECD copy of the same figure lands weeks after the release.
//
// US prices are FRED's own percent change from a year ago rather than the index.
// The 12 month change BLS puts in the headline is taken on the unadjusted index,
// so this is CPIAUCNS and not the seasonally adjusted CPIAUCSL, which prints a
// tenth or two away from what an analyst reads anywhere else.
const METRICS = [
  { key: 'ca-cpi', country: 'CA', label: 'CPI, all items y/y', src: 'boc', id: 'STATIC_TOTALCPICHANGE', freq: 'Monthly', units: '%', digits: 1 },
  { key: 'us-cpi', country: 'US', label: 'CPI, all items y/y', src: 'fred', id: 'CPIAUCNS', fredUnits: 'pc1', freq: 'Monthly', units: '%', digits: 1 },
  { key: 'ca-unemployment', country: 'CA', label: 'Unemployment rate', src: 'statcan', id: 'v2062815', freq: 'Monthly', units: '%', digits: 1 },
  { key: 'us-unemployment', country: 'US', label: 'Unemployment rate', src: 'fred', id: 'UNRATE', freq: 'Monthly', units: '%', digits: 1 },
  { key: 'ca-policy', country: 'CA', label: 'Policy rate target', src: 'boc', id: 'V39079', freq: 'Daily', units: '%', digits: 2 },
  { key: 'us-policy', country: 'US', label: 'Fed funds target, upper', src: 'fred', id: 'DFEDTARU', freq: 'Daily', units: '%', digits: 2 },
];

const YEARS = 3; // far enough back that a policy rate has moved inside the window

// How long the newest value has stood. A policy rate that has not moved since
// March is the fact worth reading beside it, and a CPI print is never the same
// two months running, so one walk answers for both.
function unchangedSince(obs) {
  const last = obs[obs.length - 1];
  let i = obs.length - 1;
  while (i > 0 && obs[i - 1].v === last.v) i--;
  // the run reaches the start of the window, so how long is not known from here
  if (i === 0) return null;
  return i === obs.length - 1 ? null : obs[i].d;
}

const describeMetric = (m) => ({
  key: m.key,
  country: m.country,
  label: m.label,
  units: m.units,
  freq: m.freq,
  digits: m.digits,
  id: m.id,
  source: SOURCE_NAME[m.src],
});

const oneMetric = (m) =>
  cached(`brief:${m.key}`, CACHE_MS, async () => {
    const obs = await observations(m, isoAgo(YEARS));
    const last = obs[obs.length - 1] || null;
    const previous = obs.length > 1 ? obs[obs.length - 2] : null;

    return {
      ...describeMetric(m),
      value: last ? last.v : null,
      // the period always travels with the value: these print monthly, and a
      // July figure read in September is not the current month
      period: last ? last.d : null,
      previous: previous ? { value: previous.v, period: previous.d } : null,
      unchangedSince: last ? unchangedSince(obs) : null,
    };
  });

router.get('/metrics', async (req, res) => {
  try {
    const metrics = await pool(METRICS, async (m) => {
      try {
        return await oneMetric(m);
      } catch (err) {
        // one dead source must not empty the panel, so the row stays and says
        // what happened to it
        return { ...describeMetric(m), value: null, period: null, previous: null, unchangedSince: null, error: redact(describe(err)) };
      }
    });
    res.json({ metrics });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
