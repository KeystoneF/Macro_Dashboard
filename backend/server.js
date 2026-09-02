require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { ping } = require('./db');
const { requireAuth } = require('./auth/middleware');
const { redact, describe } = require('./redact');

const app = express();

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
