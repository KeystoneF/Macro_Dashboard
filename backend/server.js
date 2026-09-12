require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { pool, ping } = require('./db');
const auth = require('./auth/verify');
const { requireAuth } = require('./auth/middleware');
const { redact, describe } = require('./redact');
const { limiter } = require('./ratelimit');

function trustProxy() {
  const value = process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '0');
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(/^https?:\/\//.test(value) ? value : `https://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('ALLOWED_ORIGINS must contain origins without paths or credentials');
      }
      return url.origin;
    });
}

function createApp() {
  const app = express();
  const origins = allowedOrigins();
  const requests = limiter({ max: 240, windowMs: 60_000 });

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy());
  app.set('query parser', 'simple');

  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // CORS alone does not stop cross-origin writes.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if ((origin && !origins.includes(origin)) || (!origin && req.get('sec-fetch-site') === 'cross-site')) {
        return res.status(403).json({ error: 'origin not allowed' });
      }
    }
    if (Object.values(req.query).some((value) => typeof value !== 'string')) {
      return res.status(400).json({ error: 'query parameters must have a single value' });
    }
    next();
  });

  app.use(cors({
    credentials: true,
    origin: (origin, done) => done(null, !origin || origins.includes(origin)),
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api/auth', require('./routes/auth'));

  // Liveness stays green during a database outage; readiness does not.
  app.get('/api/health', async (req, res) => {
    let db = false;
    try {
      db = await ping();
    } catch (err) {
      console.error('database health check failed:', redact(describe(err)));
    }
    res.json({
      ok: true,
      db,
      dbError: db ? null : 'Account database unavailable',
      fmpKey: Boolean(process.env.FMP_API_KEY),
      openAiKey: Boolean(process.env.OPEN_AI_KEY),
      time: new Date().toISOString(),
    });
  });

  app.get('/api/ready', async (req, res) => {
    try {
      const ready = await ping();
      res.status(ready ? 200 : 503).json({ ok: ready });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  for (const route of ['brief', 'yields', 'series', 'discover', 'international', 'markets', 'news', 'valuation']) {
    app.use(`/api/${route}`, requireAuth, (req, res, next) => {
      if (!requests.take(req.user.id)) {
        return res.set('Retry-After', '60').status(429).json({ error: 'too many requests, try again in a minute' });
      }
      next();
    }, require(`./routes/${route}`));
  }

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.type === 'entity.too.large' ? 413 : err.status === 400 ? 400 : 500;
    if (status === 500) console.error('request failed:', redact(describe(err)));
    res.status(status).json({
      error: status === 413 ? 'request body too large' : status === 400 ? 'invalid request' : 'request failed',
    });
  });
  return app;
}

function start() {
  auth.validate();
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS?.trim()) {
    throw new Error('ALLOWED_ORIGINS is required in production');
  }
  const app = createApp();
  const port = Number(process.env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

  const server = app.listen(port, () => console.log(`api on :${port}`));
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  require('./routes/series').warm();
  require('./routes/valuation').warm();
  const stopNews = require('./routes/news').startRefresh();

  let closing = false;
  const shutdown = (exitCode = 0) => {
    if (closing) return;
    closing = true;
    stopNews();
    const deadline = setTimeout(() => process.exit(1), 15_000);
    deadline.unref();
    server.close(async () => {
      try {
        await pool.end();
      } catch (err) {
        console.error('database shutdown failed:', redact(describe(err)));
        exitCode = 1;
      }
      process.exit(exitCode);
    });
  };

  process.once('SIGTERM', () => shutdown());
  process.once('SIGINT', () => shutdown());
  process.on('unhandledRejection', (reason) => {
    console.error('unhandled rejection:', redact(describe(reason)));
    shutdown(1);
  });
  return server;
}

if (require.main === module) start();

module.exports = { createApp, start };
