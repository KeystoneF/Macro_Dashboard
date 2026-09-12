const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { num, isoDate, cached, statcanObs } = require('../providers');
const { limiter } = require('../ratelimit');
const { cell, row } = require('../csv');
const { redact } = require('../redact');
const { connectionOptions } = require('../db');
const fetchWithTimeout = require('../http');
const markets = require('../routes/markets');

test('missing and malformed values stay missing, while zero and negatives survive', () => {
  for (const value of [null, undefined, '', ' ', '.', 'bad', '2bad', true, [], Infinity, NaN]) {
    assert.equal(num(value), null, String(value));
  }
  for (const [value, expected] of [[0, 0], ['0', 0], ['-3.25', -3.25], ['1e3', 1000]]) {
    assert.equal(num(value), expected);
  }
});

test('dates are real calendar dates, including leap days', () => {
  assert.equal(isoDate('2024-02-29'), '2024-02-29');
  for (const date of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-01-01&x=1', ['2026-01-01']]) {
    assert.equal(isoDate(date), null);
  }
});

test('cached requests share work and failed work can be retried', async () => {
  let calls = 0;
  let release;
  const work = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const first = cached('test-shared', 1000, work);
  const second = cached('test-shared', 1000, work);
  assert.equal(first, second);
  await Promise.resolve();
  release('result');
  assert.equal(await first, 'result');
  assert.equal(await cached('test-shared', 1000, work), 'result');
  assert.equal(calls, 1);
  assert.equal(await cached('test-shared', 0, () => 'fresh result'), 'fresh result');
  await assert.rejects(cached('test-failure', 1000, () => { throw new Error('failed'); }));
  assert.equal(await cached('test-failure', 1000, () => 'retried'), 'retried');
});

test('rate limits reserve attempts synchronously and bound key growth', () => {
  const limit = limiter({ max: 2, windowMs: 1000, maxKeys: 2 });
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), true);
  assert.equal(limit.take('a'), false);
  assert.equal(limit.take('b'), true);
  assert.equal(limit.take('c'), false);
  limit.clear('a');
  assert.equal(limit.take('c'), true);
});

test('CSV escapes quotes and neutralizes formulas without changing numbers', () => {
  assert.equal(cell('6" pipe'), '"6"" pipe"');
  assert.equal(cell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(cell(-3.5), '-3.5');
  assert.equal(row(['a,b', null, 0]), '"a,b",,0');
});

test('logs redact credentials and URL-encoded secrets', () => {
  const old = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'abcdef+123456';
  try {
    const text = redact('postgres://dbuser:secret@db.example/db?apikey=abcdef%2B123456 Bearer abcdefgh123456');
    assert.doesNotMatch(text, /dbuser|secret|abcdef/);
  } finally {
    if (old === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = old;
  }
});

test('database TLS verifies remote servers and preserves a custom CA', () => {
  assert.equal(connectionOptions({ DB_HOST: 'localhost' }).ssl, false);
  assert.deepEqual(connectionOptions({ DB_HOST: 'db.example' }).ssl, { rejectUnauthorized: true });
  const options = connectionOptions({
    DATABASE_URL: 'postgres://user:password@db.example/db?sslmode=require',
    DB_CA: 'first\\nsecond',
    DB_SSL_REJECT_UNAUTHORIZED: 'false',
  });
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca: 'first\nsecond' });
  assert.doesNotMatch(options.connectionString, /sslmode/);
});

test('market rows do not turn missing quotes or changes into zero', async (t) => {
  process.env.FMP_API_KEY = 'test-api-key';
  t.mock.method(global, 'fetch', async () => Response.json([{ symbol: 'NULLTEST', price: null, timestamp: null, '1D': null }]));
  const [result] = await markets.instrumentRows([{ symbol: 'NULLTEST', label: 'Test' }], true);
  assert.equal(result.price, null);
  assert.equal(result.quotedAt, null);
  assert.equal(result.changePct['1D'], null);
});

test('market provider errors under HTTP 200 are not cached as data', async (t) => {
  process.env.FMP_API_KEY = 'test-api-key';
  t.mock.method(global, 'fetch', async () => Response.json({ 'Error Message': 'Premium subscription required' }));
  await assert.rejects(markets.instrumentRows([{ symbol: 'ERRTEST' }], true), /Premium subscription/);
});

test('StatCan matches vector IDs when responses arrive out of order', async (t) => {
  t.mock.method(global, 'fetch', async () => Response.json([
    { status: 'SUCCESS', object: { vectorId: 2, vectorDataPoint: [{ refPer: '2026-01-01', value: 999 }] } },
    { status: 'SUCCESS', object: { vectorId: 1, vectorDataPoint: [
      { refPer: '2026-01-01', value: 0 }, { refPer: '2026-02-01', value: null },
    ] } },
  ]));
  assert.deepEqual(await statcanObs({ id: 'v1', freq: 'Monthly' }, '2026-01-01'), [{ d: '2026-01-01', v: 0 }]);
});

test('upstream timeouts cover stalled response bodies', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 100 });
    await assert.rejects(response.text());
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
