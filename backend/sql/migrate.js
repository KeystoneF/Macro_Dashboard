// Applies every .sql file in this directory in name order and records which ones
// ran. No framework: there are two files, and a dependency that rewrites the
// schema on its own would be a worse trade than a loop.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows: done } = await pool.query('SELECT name FROM schema_migrations');
  const already = new Set(done.map((r) => r.name));

  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (already.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    // one file can hold several statements, and the driver runs one at a time
    for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    console.log(`ran   ${file}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
