const { verify } = require('./verify');
const users = require('./users');

const COOKIE = 'macrodesk_session';

// httpOnly so page scripts cannot read it, which is the whole reason the token
// is not in localStorage. sameSite lax keeps it on normal navigation, including
// the CSV download links, while withholding it from cross-site form posts.
//
// secure is deliberately its own switch rather than being inferred from
// NODE_ENV. A browser refuses to store a Secure cookie sent over plain http, so
// a production build served without TLS answers 200 to a sign-in and then keeps
// bouncing the analyst back to the login page with nothing explaining why. The
// sibling KeyStocks portal is plain http on a bare IP, so this is a live risk
// and not a hypothetical one. Default on in production, and turning it off has
// to be a deliberate COOKIE_SECURE=false.
//
// maxAge null makes it a session cookie, gone when the browser closes. That is
// what an analyst declining "remember me" is asking for. The token's own expiry
// caps the session either way, so a forgotten cookie cannot outlive it.
const cookieOptions = (maxAgeSeconds) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: cookieSecure(),
  path: '/',
  ...(maxAgeSeconds == null ? {} : { maxAge: maxAgeSeconds * 1000 }),
});

function cookieSecure() {
  const set = process.env.COOKIE_SECURE;
  if (set === 'true') return true;
  if (set === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

const readToken = (req) => (req.cookies && req.cookies[COOKIE]) || null;

function currentUser(req) {
  return verify(readToken(req));
}

// A valid signature is not the same as a live account. Without this check a
// deleted analyst keeps working for the rest of the token's twelve hours,
// because nothing between issuing it and its expiry ever looks at the database.
// The row also carries the token version, which is how a signed-out token is
// told from a current one.
//
// Cached for a minute so this costs one primary-key lookup per analyst per
// minute rather than one per request. Signing out drops the entry rather than
// waiting the minute out, so the token it just ended stops working now.
const ACCOUNT_TTL_MS = 60_000;
const accounts = new Map();

async function accountFor(id) {
  const hit = accounts.get(id);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.row;
  const row = await users.byId(id);
  accounts.set(id, { at: Date.now(), row });
  return row;
}

const forget = (id) => accounts.delete(id);

// Guards everything the desk fetches. /api/health stays open so the status page
// can report a dead database without a session, and /api/auth/* has to be
// reachable to get one in the first place.
async function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'not signed in' });

  try {
    const account = await accountFor(user.id);
    if (!account) return res.status(401).json({ error: 'account no longer active' });

    // A token issued before the analyst signed out carries the older version.
    // No version at all is a provider that does not number its tokens, and
    // revocation there belongs to whoever issued them.
    if (user.ver != null && user.ver !== account.token_version) {
      return res.status(401).json({ error: 'session ended' });
    }
  } catch (err) {
    // The database being unreachable is not evidence the account is gone. The
    // token is signed and unexpired, which is exactly the assurance this app
    // had before the check existed, so the request goes through and the failure
    // is logged. Failing closed here would take the whole desk down with postgres,
    // and nothing else on it needs postgres at all.
    console.error('account check unavailable, trusting signed token:', err.code || err.message);
  }

  req.user = user;
  next();
}

module.exports = { COOKIE, cookieOptions, currentUser, requireAuth, forget };
