const { Pool } = require('pg');
const { redact, describe } = require('./redact');

function connectionOptions(env = process.env) {
  const url = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  const host = url?.hostname || env.DB_HOST || 'localhost';
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  const sslMode = env.DB_SSL ?? (url?.searchParams.get('sslmode') === 'disable' ? 'false' : undefined);
  const useTls = sslMode === 'true' || (sslMode !== 'false' && !local);
  const ca = env.DB_CA?.replace(/\\n/g, '\n');

  // URL SSL options otherwise replace pg's explicit TLS configuration.
  if (url) {
    for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(name);
  }

  return {
    ...(url ? { connectionString: url.toString() } : {
      host,
      port: Number(env.DB_PORT) || 5432,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    }),
    ssl: useTls ? {
      rejectUnauthorized: Boolean(ca) || env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(ca ? { ca } : {}),
    } : false,
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  };
}

const pool = new Pool(connectionOptions());
pool.on('error', (err) => console.error('idle client dropped:', redact(describe(err))));

async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

module.exports = { pool, ping, connectionOptions };
