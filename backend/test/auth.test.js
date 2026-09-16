const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
process.env.AUTH_PROVIDER = 'local';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.TRUST_PROXY = '0';
process.env.DATABASE_URL = 'postgres://test:test@localhost:1/test';

const { createApp } = require('../server');
const users = require('../auth/users');
const { pool } = require('../db');
const { issue, verify } = require('../auth/local');
const jwt = require('jsonwebtoken');
const nativeFetch = global.fetch;

let server;
let origin;
const account = { id: 1, email: 'analyst@example.test', name: 'Analyst', token_version: 2 };
const token = () => issue({ ...account, tokenVersion: 2 });
const cookie = () => ({ cookie: `macrodesk_session=${token()}` });
const request = (path, options) => nativeFetch(origin + path, options);
const login = (email, password = 'valid-password') => request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
  body: JSON.stringify({ email, password }),
});

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('protected endpoints require a session', async () => {
  for (const route of ['brief/metrics', 'news', 'series', 'yields', 'discover', 'international', 'markets/fx', 'valuation', 'watchlists', 'watchlists/94/news', 'watchlists/calendar']) {
    assert.equal((await request('/api/' + route)).status, 401, route);
  }
});

test('session checks reject revoked and deleted accounts', async (t) => {
  const lookup = t.mock.method(users, 'byId', async () => ({ ...account, token_version: 3 }));
  const me = await request('/api/auth/me', { headers: cookie() });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user, null);
  assert.match(me.headers.get('set-cookie'), /Expires=/);
  assert.equal((await request('/api/markets/periods', { headers: cookie() })).status, 401);
  lookup.mock.mockImplementation(async () => null);
  assert.equal((await request('/api/auth/me', { headers: cookie() }).then((r) => r.json())).user, null);
});

test('database outages fail closed and do not disclose driver details', async (t) => {
  t.mock.method(users, 'byId', async () => { throw new Error('private-db-host failure'); });
  for (const path of ['/api/auth/me', '/api/markets/periods']) {
    const response = await request(path, { headers: cookie() });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-db-host/);
  }
});

test('me returns current account details and disables response caching', async (t) => {
  t.mock.method(users, 'byId', async () => ({ ...account, name: 'Updated name' }));
  const response = await request('/api/auth/me', { headers: cookie() });
  assert.equal((await response.json()).user.name, 'Updated name');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('cross-origin writes are refused before authentication', async (t) => {
  const authenticate = t.mock.method(users, 'authenticate', async () => account);
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(response.status, 403);
  assert.equal(authenticate.mock.callCount(), 0);
});

test('malformed JSON and oversized bodies return JSON errors', async () => {
  for (const [body, status] of [['{', 400], [JSON.stringify({ value: 'x'.repeat(17_000) }), 413]]) {
    const response = await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('login sets an httpOnly cookie without leaking internal claims', async (t) => {
  t.mock.method(users, 'authenticate', async () => ({ ...account, tokenVersion: 2 }));
  const response = await login('valid@example.test');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.deepEqual(await response.json(), { user: { id: '1', email: account.email, name: account.name } });
});

test('concurrent login attempts cannot bypass the per-email limit', async (t) => {
  const authenticate = t.mock.method(users, 'authenticate', async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return null;
  });
  const responses = await Promise.all(Array.from({ length: 16 }, () => login('concurrent@example.test')));
  assert.equal(authenticate.mock.callCount(), 8);
  assert.equal(responses.filter((r) => r.status === 401).length, 8);
  assert.equal(responses.filter((r) => r.status === 429).length, 8);
  assert.equal(responses.find((r) => r.status === 429).headers.get('retry-after'), '900');
});

test('login rejects objects and passwords bcrypt would truncate', async () => {
  assert.equal((await login({ address: 'invalid' })).status, 400);
  assert.equal((await login('length@example.test', 'é'.repeat(37))).status, 400);
});

test('logout revokes only the presented token version', async (t) => {
  const revoke = t.mock.method(users, 'bumpTokenVersion', async () => 3);
  const response = await request('/api/auth/logout', { method: 'POST', headers: cookie() });
  assert.equal(response.status, 200);
  assert.deepEqual(revoke.mock.calls[0].arguments, ['1', 2]);
  assert.match(response.headers.get('set-cookie'), /Expires=/);
});

test('failed logout is reported instead of claiming the session ended', async (t) => {
  t.mock.method(users, 'bumpTokenVersion', async () => { throw new Error('db unavailable'); });
  const response = await request('/api/auth/logout', { method: 'POST', headers: cookie() });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('invalid query values are rejected before calling a provider', async (t) => {
  t.mock.method(users, 'byId', async () => account);
  const paths = [
    '/api/news?window=constructor',
    '/api/brief/digest?window=toString',
    '/api/markets/history?symbol=USDCAD&range=constructor',
    '/api/markets/heatmap?universe=toString',
    '/api/markets/sectors?board=constructor',
    '/api/markets/csv?kind=anything',
    '/api/international?metric=constructor',
    '/api/series?ids=UNRATE&start=2026-02-31',
    '/api/yields?date=2026-13-01',
    '/api/series?ids=UNRATE&ids=GDP',
    '/api/discover/cube/123456/resolve?picks=' + Array(11).fill('1').join(','),
  ];
  for (const path of paths) assert.equal((await request(path, { headers: cookie() })).status, 400, path);
});

test('liveness and readiness distinguish a database outage', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('private-host unavailable'); });
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).db, false);
  assert.equal((await request('/api/ready')).status, 503);
});

test('signed tokens still require valid versioned account claims', () => {
  const unversioned = jwt.sign({ sub: '1' }, process.env.JWT_SECRET, { issuer: 'macrodesk' });
  assert.equal(verify(unversioned), null);
  assert.equal(verify(token()).ver, 2);
  assert.equal(verify('not-a-token'), null);
});
