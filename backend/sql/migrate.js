// Run each migration atomically, with one runner holding the schema lock.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');
const { redact, describe } = require('../redact');

async function migrate(database = pool, directory = __dirname) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(174038201)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const already = new Set(rows.map((row) => row.name));

    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
      if (already.has(file)) continue;
      await client.query(fs.readFileSync(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`ran   ${file}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .catch((err) => {
      console.error(redact(describe(err)));
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { migrate };
