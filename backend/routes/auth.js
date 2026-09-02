const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { issue, ttlSeconds, providerName, canIssue } = require('../auth/verify');
const { COOKIE, cookieOptions, currentUser } = require('../auth/middleware');
const { redact, describe } = require('../redact');

// Sign-in attempts are the one place worth rate limiting: everything else here
// is read-only public statistics. Per address rather than per IP, since a whole
// office behind one NAT should not lock itself out.
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();

// The map is keyed by whatever address was typed, and /login is necessarily
// open, so without eviction anyone can grow it forever by trying a new address
// each time. Entries older than the window carry no meaning, so they go.
const SWEEP_MS = 5 * 60_000;

const sweep = setInterval(() => {
  const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
  for (const [key, rec] of attempts) if (rec.first < cutoff) attempts.delete(key);
}, SWEEP_MS);

// a bare interval keeps the process alive on shutdown
sweep.unref();

function tooManyAttempts(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > ATTEMPT_WINDOW_MS) return false;
  return rec.count >= MAX_ATTEMPTS;
}

function recordAttempt(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > ATTEMPT_WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else rec.count += 1;
}

const clearAttempts = (key) => attempts.delete(key);

router.post('/login', async (req, res) => {
  if (!canIssue()) {
    return res.status(400).json({ error: `${providerName()} signs in at its own portal` });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const remember = req.body?.remember !== false;

  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  if (tooManyAttempts(email)) {
    return res.status(429).json({ error: 'too many attempts, try again in 15 minutes' });
  }

  try {
    const user = await users.authenticate(email, password);
    if (!user) {
      recordAttempt(email);
      // one message for a wrong password and for an unknown address, so the
      // response cannot be used to enumerate who has an account
      return res.status(401).json({ error: 'email or password is incorrect' });
    }

    clearAttempts(email);
    res.cookie(COOKIE, issue(user), cookieOptions(remember ? ttlSeconds() : null));
    res.json({ user });
  } catch (err) {
    const message = redact(describe(err));
    console.error(message);
    // a database that will not answer is not the analyst's fault, and saying so
    // beats a blank error box
    const down = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
    res.status(down ? 503 : 500).json({
      error: down ? 'cannot reach the account database' : message,
    });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, cookieOptions(null));
  res.json({ ok: true });
});

// The gate on every desk page asks this. It answers 200 either way so a signed
// out visitor is a normal state rather than an error in the console.
router.get('/me', (req, res) => {
  res.json({ user: currentUser(req), provider: providerName() });
});

module.exports = router;
