const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

test('PostgreSQL migrations, login and revocation', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const schema = 'audit_' + randomBytes(8).toString('hex');
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  process.env.AUTH_PROVIDER = 'local';
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

  const { pool } = require('../db');
  const { migrate } = require('../sql/migrate');
  const users = require('../auth/users');
  const { createApp } = require('../server');

  await pool.query(`CREATE SCHEMA ${schema}`);
  let server;
  try {
    await t.test('concurrent migrations run once', async () => {
      await Promise.all([migrate(), migrate()]);
      const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
      assert.deepEqual(rows.map((r) => r.name), ['001-users.sql', '002-token-version.sql']);
    });

    await t.test('failed migration rolls back schema and tracking changes', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'macrodesk-migration-'));
      try {
        fs.writeFileSync(path.join(directory, '999-failure.sql'), "CREATE TABLE rollback_probe (id int); DO $$ BEGIN RAISE EXCEPTION 'expected failure'; END $$;");
        await assert.rejects(migrate(pool, directory), /expected failure/);
        const { rows } = await pool.query("SELECT to_regclass('rollback_probe') AS probe");
        assert.equal(rows[0].probe, null);
        assert.equal((await pool.query("SELECT * FROM schema_migrations WHERE name = '999-failure.sql'")).rowCount, 0);
      } finally {
        fs.unlinkSync(path.join(directory, '999-failure.sql'));
        fs.rmdirSync(directory);
      }
    });

    const account = await users.create({ email: 'audit@example.test', name: 'Audit User', password: 'test-password-only' });
    server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const login = async () => {
      const response = await fetch(origin + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: 'test-password-only' }),
      });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const signedIn = async (cookie) => {
      const response = await fetch(origin + '/api/auth/me', { headers: { cookie } });
      assert.equal(response.status, 200);
      return (await response.json()).user;
    };

    await t.test('logout ends issued sessions and stale logout leaves newer sessions alone', async () => {
      const first = await login();
      assert.equal((await signedIn(first)).email, account.email);
      assert.equal((await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { cookie: first } })).status, 200);
      assert.equal(await signedIn(first), null);
      const second = await login();
      await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { cookie: first } });
      assert.equal((await signedIn(second)).email, account.email);
      await pool.query('DELETE FROM users WHERE id = $1', [account.id]);
      assert.equal(await signedIn(second), null);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});
