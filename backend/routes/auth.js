const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { issue, ttlSeconds, providerName, canIssue } = require('../auth/verify');
const { COOKIE, cookieOptions, currentUser, activeUser, unavailable } = require('../auth/middleware');
const { redact, describe } = require('../redact');
const { limiter } = require('../ratelimit');

const ATTEMPT_WINDOW_MS = 15 * 60_000;
const perEmail = limiter({ max: 8, windowMs: ATTEMPT_WINDOW_MS });
const perSource = limiter({ max: 40, windowMs: ATTEMPT_WINDOW_MS });

const publicUser = (user) =>
  user ? { id: String(user.id), email: user.email, name: user.name } : null;

router.post('/login', async (req, res) => {
  const source = req.ip || req.socket.remoteAddress || 'unknown';
  if (!perSource.take(source)) {
    return res.set('Retry-After', '900').status(429).json({ error: 'too many attempts, try again in 15 minutes' });
  }

  const { email: rawEmail, password, remember = true } = req.body || {};
  if (typeof rawEmail !== 'string' || typeof password !== 'string' || typeof remember !== 'boolean') {
    return res.status(400).json({ error: 'email and password required' });
  }
  const email = rawEmail.trim().toLowerCase();
  if (!email || email.length > 255 || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'email or password has an invalid length' });
  }
  if (!perEmail.take(email)) {
    return res.set('Retry-After', '900').status(429).json({ error: 'too many attempts, try again in 15 minutes' });
  }

  try {
    if (!canIssue()) {
      return res.status(400).json({ error: `${providerName()} signs in at its own portal` });
    }
    const user = await users.authenticate(email, password);
    if (!user) return res.status(401).json({ error: 'email or password is incorrect' });

    perEmail.clear(email);
    res.cookie(COOKIE, issue(user), cookieOptions(remember ? ttlSeconds() : null));
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('sign-in failed:', redact(describe(err)));
    res.status(503).json({ error: 'Sign-in is unavailable right now. Please try again.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const user = currentUser(req);
    // A stale token cannot revoke sessions issued after it was signed out.
    if (user) await users.bumpTokenVersion(user.id, user.ver);
    res.clearCookie(COOKIE, cookieOptions(null));
    res.json({ ok: true });
  } catch (err) {
    console.error('sign-out failed:', redact(describe(err)));
    res.status(503).json({ error: 'Could not sign out. Please try again.' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const user = await activeUser(req);
    if (!user && req.cookies?.[COOKIE]) res.clearCookie(COOKIE, cookieOptions(null));
    res.json({ user: publicUser(user), provider: providerName() });
  } catch (err) {
    unavailable(res, err);
  }
});

module.exports = router;
