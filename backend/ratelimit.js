// Fixed window counters. Sign-in limits on two of them at once: the address
// that was typed, and the address it was typed from.
//
// Keys arrive from an endpoint that has to stay open, so entries older than the
// window are swept rather than kept: without that, anyone can grow the map
// forever by sending a new key each time.
const SWEEP_MS = 5 * 60_000;

function limiter({ max, windowMs }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, rec] of hits) if (rec.first < cutoff) hits.delete(key);
  }, SWEEP_MS);

  // a bare interval keeps the process alive on shutdown
  sweep.unref();

  return {
    blocked(key) {
      const rec = hits.get(key);
      if (!rec || Date.now() - rec.first > windowMs) return false;
      return rec.count >= max;
    },

    record(key) {
      const now = Date.now();
      const rec = hits.get(key);
      if (!rec || now - rec.first > windowMs) hits.set(key, { first: now, count: 1 });
      else rec.count += 1;
    },

    clear: (key) => hits.delete(key),
  };
}

module.exports = { limiter };
