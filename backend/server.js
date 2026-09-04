require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { ping } = require('./db');
const { requireAuth } = require('./auth/middleware');
const { redact, describe } = require('./redact');

const app = express();

// The version banner names the framework to anyone scanning, and nothing reads it
app.disable('x-powered-by');

// req.ip is the proxy's own address unless express is told how many hops sit in
// front, and the per-source sign-in limit is only as good as that address.
// Trusting the header where nothing is in front of this process is worse than
// not having it: a client would set its own address and walk past the limit. So
// it follows the platform rather than defaulting on.
//
// Express reads a string as a list of proxy addresses and throws at boot on
// anything that is not one, so the words are answered before the number is.
function trustProxy() {
  const set = process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '0');
  if (set === 'true') return true;
  if (set === 'false') return false;
  const hops = Number(set);
  return Number.isFinite(hops) ? hops : set;
}

app.set('trust proxy', trustProxy());

// Headers this API can set for itself. It answers JSON and one PNG and never a
// document, so the policy is the restrictive one: the page-level policy belongs
// to whatever serves the pages, and lives in frontend/next.config.ts.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Only where there is TLS to insist on. A browser ignores HSTS over plain
  // http, and asserting it from a box reached over http would be a promise the
  // next request cannot keep.
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// An allowlist, not a reflector. Reflecting whatever Origin arrives while also
// sending Access-Control-Allow-Credentials lets any site read this API with a
// signed-in analyst's session. That is survivable today only because the cookie
// is SameSite=Lax, so the browser withholds it cross-site. Single sign-on with
// the KeyStocks portal would likely need SameSite=None, which removes the one
// thing making the reflector safe, so the allowlist goes in now.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
  // render supplies a bare hostname, and an Origin header always carries a scheme
  .map((o) => (/^https?:\/\//.test(o) ? o : `https://${o}`));

app.use(
  cors({
    credentials: true,
    origin(origin, done) {
      // no Origin header at all is curl, a server, or a same-origin navigation
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return done(null, true);
      done(null, false);
    },
  }),
);
app.use(express.json());
app.use(cookieParser());

// open: getting a session, and reporting whether the box is alive
app.use('/api/auth', require('./routes/auth'));

// everything below needs one
app.use('/api/yields', requireAuth, require('./routes/yields'));
app.use('/api/series', requireAuth, require('./routes/series'));
app.use('/api/discover', requireAuth, require('./routes/discover'));
app.use('/api/international', requireAuth, require('./routes/international'));
app.use('/api/markets', requireAuth, require('./routes/markets'));
app.use('/api/news', requireAuth, require('./routes/news'));
app.use('/api/valuation', requireAuth, require('./routes/valuation'));

// health reports db separately so a dead postgres does not look like a dead api
app.get('/api/health', async (req, res) => {
  let db = false;
  let dbError = null;
  try {
    db = await ping();
  } catch (err) {
    dbError = redact(describe(err));
  }
  res.json({
    ok: true,
    db,
    dbError,
    fmpKey: Boolean(process.env.FMP_API_KEY),
    time: new Date().toISOString(),
  });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// Node exits on an unhandled rejection. One stray promise in a route would take
// the whole desk down, so it is logged and the process kept alive instead.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', redact(describe(reason)));
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`api on :${port}`));
