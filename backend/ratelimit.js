// Reserve attempts before async work; concurrent requests share the same budget.
function limiter({ max, windowMs, maxKeys = 10_000 }) {
  const hits = new Map();

  function sweep(now) {
    for (const [key, rec] of hits) {
      if (now >= rec.until) hits.delete(key);
    }
  }

  const timer = setInterval(() => sweep(Date.now()), Math.min(windowMs, 300_000));
  timer.unref();

  return {
    take(key) {
      const now = Date.now();
      let rec = hits.get(key);
      if (rec && now >= rec.until) {
        hits.delete(key);
        rec = null;
      }
      if (!rec) {
        if (hits.size >= maxKeys) sweep(now);
        if (hits.size >= maxKeys) return false;
        rec = { count: 0, until: now + windowMs };
        hits.set(key, rec);
      }
      if (rec.count >= max) return false;
      rec.count++;
      return true;
    },
    clear: (key) => hits.delete(key),
  };
}

module.exports = { limiter };
