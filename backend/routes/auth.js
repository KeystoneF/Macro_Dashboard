const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { issue, ttlSeconds, providerName, canIssue } = require('../auth/verify');
const { COOKIE, cookieOptions, currentUser, forget } = require('../auth/middleware');
const { redact, describe } = require('../redact');
const { limiter } = require('../ratelimit');

// Sign-in attempts are the one place worth rate limiting: everything else here
// is read-only public statistics. Two counters, because either one alone leaves
// the door open.
//
// Per address, so a whole office behind one NAT does not lock itself out when
// one analyst fumbles a password.
//
// Per source as well, because the per-address counter never fires for someone
// cycling addresses, and every attempt costs a bcrypt comparison whether or not
// the account exists: the dummy hash that hides which addresses are registered
// means an unknown address is exactly as expensive as a real one. Node runs one
// thread, so an unlimited stream of those is enough on its own to stall the desk
// for everyone signed in.
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 8;
const MAX_PER_SOURCE = 40; // well above a room full of typos, well below a flood

const perEmail = limiter({ max: MAX_PER_EMAIL, windowMs: ATTEMPT_WINDOW_MS });
const perSource = limiter({ max: MAX_PER_SOURCE, windowMs: ATTEMPT_WINDOW_MS });

// req.ip reads x-forwarded-for only where server.js has been told to trust it,
// and falls back to the socket address where it has not
const sourceOf = (req) => req.ip || req.socket.remoteAddress || 'unknown';

// The token version is how the desk decides a session has ended, and nothing on
// the page has any use for it, so it stops here rather than going out on the wire.
const publicUser = (user) =>
  user ? { id: user.id, email: user.email, name: user.name } : null;

router.post('/login', async (req, res) => {
  if (!canIssue()) {
    return res.status(400).json({ error: `${providerName()} signs in at its own portal` });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const remember = req.body?.remember !== false;

  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const source = sourceOf(req);
  if (perEmail.blocked(email) || perSource.blocked(source)) {
    return res.status(429).json({ error: 'too many attempts, try again in 15 minutes' });
  }

  try {
    const user = await users.authenticate(email, password);
    if (!user) {
      perEmail.record(email);
      perSource.record(source);
      // one message for a wrong password and for an unknown address, so the
      // response cannot be used to enumerate who has an account
      return res.status(401).json({ error: 'email or password is incorrect' });
    }

    // the source counter is not cleared: one correct password does not buy back
    // the budget for a stream of wrong ones from the same place
    perEmail.clear(email);
    res.cookie(COOKIE, issue(user), cookieOptions(remember ? ttlSeconds() : null));
    res.json({ user: publicUser(user) });
  } catch (err) {
    const message = redact(describe(err));
    console.error(message);
    // a database that will not answer is not the analyst's fault, and saying so
    // beats a blank error box
    // pg's own connect timeout carries no code, only a message
    const down =
      ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code) ||
      /timeout exceeded when trying to connect/.test(err.message || '');
    // the detail is logged above. An open endpoint answering with the driver's
    // own text hands out table names and hostnames to anyone who asks.
    res.status(down ? 503 : 500).json({
      error: down ? 'cannot reach the account database' : 'sign-in failed',
    });
  }
});

// Clearing the cookie stops this browser sending the token. It does nothing to
// the token, which stayed good for the rest of its twelve hours anywhere it had
// been copied to, so the account's token version is bumped as well and the
// cached account row dropped so the next request sees it.
//
// That ends the analyst's other sessions too. Signing out of the desk means
// signing out of the desk, not out of one window of it.
router.post('/logout', async (req, res) => {
  const user = currentUser(req);
  res.clearCookie(COOKIE, cookieOptions(null));

  if (user) {
    try {
      await users.bumpTokenVersion(user.id);
      forget(user.id);
    } catch (err) {
      // the cookie is gone either way, so this is reported and not retried
      console.error('sign-out could not revoke the token:', redact(describe(err)));
    }
  }

  res.json({ ok: true });
});

// The gate on every desk page asks this. It answers 200 either way so a signed
// out visitor is a normal state rather than an error in the console.
router.get('/me', (req, res) => {
  res.json({ user: publicUser(currentUser(req)), provider: providerName() });
});

module.exports = router;
