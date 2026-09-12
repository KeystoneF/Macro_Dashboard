const { verify } = require('./verify');
const users = require('./users');
const { redact, describe } = require('../redact');

const COOKIE = 'macrodesk_session';

const cookieOptions = (maxAgeSeconds) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'false'
    ? false
    : process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  path: '/',
  ...(maxAgeSeconds == null ? {} : { maxAge: maxAgeSeconds * 1000 }),
});

const currentUser = (req) => verify(req.cookies?.[COOKIE]);

async function activeUser(req) {
  const user = currentUser(req);
  if (!user) return null;

  // Check each request so revocation also works across API instances.
  const account = await users.byId(user.id);
  if (!account || user.ver !== account.token_version) return null;
  return { id: String(account.id), email: account.email, name: account.name };
}

function unavailable(res, err) {
  console.error('account check failed:', redact(describe(err)));
  return res.status(503).json({ error: 'Cannot check your session right now. Please try again.' });
}

async function requireAuth(req, res, next) {
  try {
    req.user = await activeUser(req);
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    next();
  } catch (err) {
    unavailable(res, err);
  }
}

module.exports = { COOKIE, cookieOptions, currentUser, activeUser, requireAuth, unavailable };
