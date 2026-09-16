const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { inspect, privatePath } = require('../security-check');
const watchlists = require('../watchlists');
const { cell } = require('../csv');
const { redact, fail } = require('../redact');
const { cookieOptions } = require('../auth/middleware');

function env(t, key, value) {
  const old = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
}

test('production supports the supplied KeyStocks endpoint while validating origins', async (t) => {
  env(t, 'NODE_ENV', 'production');
  env(t, 'KEYSTOCKS_BASE_URL', undefined);
  env(t, 'KEYSTOCKS_API_KEY', 'test-transport-key');
  const fetch = t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(new URL(url).origin, 'http://52.54.224.232');
    assert.equal(options.headers.Authorization, 'test-transport-key');
    assert.equal(options.redirect, 'error');
    return Response.json({ status: 200, resData: { data: [] } });
  });
  assert.equal((await watchlists.request('/watchlists')).status, 200);
  assert.equal(fetch.mock.callCount(), 1);
  process.env.KEYSTOCKS_BASE_URL = 'https://provider.example';
  assert.equal(watchlists.baseUrl(), 'https://provider.example');
  for (const value of ['file:///tmp', 'https://user:password@provider.example', 'https://provider.example/path', 'https://provider.example?key=1']) {
    process.env.KEYSTOCKS_BASE_URL = value;
    assert.throws(watchlists.baseUrl, /HTTP\(S\) origin/);
  }
});

test('credential rotation never returns cached data from the old key', async (t) => {
  env(t, 'NODE_ENV', 'test');
  env(t, 'KEYSTOCKS_BASE_URL', 'https://cache-test.example');
  env(t, 'KEYSTOCKS_API_KEY', 'first-test-key');
  let calls = 0;
  t.mock.method(global, 'fetch', async () => Response.json({ status: 200, value: ++calls }));
  assert.equal((await watchlists.request('/watchlists')).value, 1);
  assert.equal((await watchlists.request('/watchlists')).value, 1);
  process.env.KEYSTOCKS_API_KEY = 'second-test-key';
  assert.equal((await watchlists.request('/watchlists')).value, 2);
});

test('production cookies stay Secure even with an unsafe environment override', (t) => {
  env(t, 'NODE_ENV', 'production'); env(t, 'COOKIE_SECURE', 'false');
  assert.equal(cookieOptions(60).secure, true);
  assert.equal(cookieOptions(60).httpOnly, true);
  assert.equal(cookieOptions(60).sameSite, 'lax');
  process.env.NODE_ENV = 'development';
  assert.equal(cookieOptions(60).secure, false);
});

test('spreadsheet formulas with whitespace and controls are neutralized', () => {
  for (const text of [' =1+1', '\t=1+1', '\n=1+1', '\u0000@SUM(A1)', '  +CMD()', '\r-1+2']) assert.ok(cell(text).includes("'"), JSON.stringify(text));
  assert.equal(cell(-1.5), '-1.5'); assert.equal(cell('-1.5'), '-1.5');
  assert.equal(cell(0), '0'); assert.equal(cell('ordinary name'), 'ordinary name');
});

test('error responses conceal internal details and header credentials are redacted', (t) => {
  const key = 'secret-for-this-test';
  env(t, 'DATABASE_URL', `postgres://user:${key}@private.example/db`);
  assert.doesNotMatch(redact(`authentication failed: ${key}`), /secret-for-this-test/);
  assert.doesNotMatch(redact('Authorization: abcdef1234567890'), /abcdef/);
  assert.doesNotMatch(redact('"Authorization":"abcdef1234567890"'), /abcdef/);
  let status, body;
  t.mock.method(console, 'error', () => {});
  fail({ status: (s) => { status = s; return { json: (b) => { body = b; } }; } }, new Error('private.example provider SQL debug'));
  assert.equal(status, 502);
  assert.doesNotMatch(JSON.stringify(body), /private\.example|SQL|debug/);
});

test('outbound links cannot contain executable schemes or URL credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://secret:token@example.com']) assert.equal(watchlists.safeUrl(url), null);
  assert.equal(watchlists.safeUrl('https://example.com/news'), 'https://example.com/news');
});

test('repository checks detect private files and credentials without echoing values', () => {
  for (const name of ['backend/.env', '.env.production', 'KeyStocks.json', 'keystock.json', 'API.postman_environment.json', 'database.dump']) assert.equal(privatePath(name), true, name);
  assert.equal(privatePath('backend/.env.example'), false);
  assert.equal(privatePath('backend/sql/001-users.sql'), false);
  const key = 'a'.repeat(32);
  assert.deepEqual(inspect(`apikey=${key}`), ['literal API credential']);
  assert.deepEqual(inspect(`value=${key}`, [['KEYSTOCKS_API_KEY', key]]), ['configured KEYSTOCKS_API_KEY']);
  assert.deepEqual(inspect('process.env.KEYSTOCKS_API_KEY'), []);
});

test('Git excludes credentials and artifacts while keeping env templates', () => {
  const root = path.resolve(__dirname, '../..');
  for (const file of ['backend/.env', '.env.production', 'KeyStocks.json', 'keystock.json', 'keystocks.json', 'API.postman_environment.json', 'frontend/test-results/trace.zip', 'db.dump']) {
    assert.equal(execFileSync('git', ['check-ignore', '--no-index', file], { cwd: root }).toString().trim(), file);
  }
  assert.throws(() => execFileSync('git', ['check-ignore', '--no-index', 'backend/.env.example'], { cwd: root }));
});

test('IP limits protect the API before account or data access', async (t) => {
  const { createApp } = require('../server');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/watchlists`;
  for (let i = 0; i < 360; i++) assert.equal((await fetch(url)).status, 401);
  const limited = await fetch(url);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});
