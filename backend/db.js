const { Pool } = require('pg');

// Render hands the whole connection over as one string, local docker sets the
// parts, so the string wins when it is there.
const url = process.env.DATABASE_URL;

// A managed host refuses a plain connection, and Render's chain is not in the
// container trust store. Local docker speaks no TLS at all, so this follows
// DB_SSL and otherwise turns on only for a url pointing off this machine.
//
// DB_CA is the host's own certificate, which is what turns the connection from
// encrypted into encrypted and checked: without one, nothing says the far end
// is the database rather than whatever answered. Render publishes its chain.
// An env var cannot hold a real newline, so an escaped one is read as one.
function sslMode() {
  const set = process.env.DB_SSL;
  if (set === 'false') return false;

  const ca = process.env.DB_CA ? process.env.DB_CA.replace(/\\n/g, '\n') : null;
  const tls = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };

  if (set === 'true') return tls;
  return url && !/@(localhost|127\.0\.0\.1)[:/]/.test(url) ? tls : false;
}

// pooled from the start, connection-per-request bit us on the last project
const pool = new Pool({
  ...(url
    ? { connectionString: url }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }),
  ssl: sslMode(),
  max: 10,
  connectionTimeoutMillis: 3000, // fail fast, otherwise /api/health just hangs when postgres is down
});

// An idle client dropped by the server raises on the pool with no query to
// attach to, and pg treats an unhandled one as fatal. Render's free tier drops
// idle connections, so this is the normal case rather than an edge.
pool.on('error', (err) => console.error('idle client dropped:', err.code || err.message));

async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

module.exports = { pool, ping };
