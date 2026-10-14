import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_LIMIT, GLOBAL_LIMIT, clientKey, createBucket, createSearchRateLimiter, take } from './rateLimit.js';

const request = (headers = {}, remoteAddress = '10.0.0.1') => ({ headers, socket: { remoteAddress } });

function response() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function run(limiter, req) {
  const res = response();
  let passed = false;
  limiter(req, res, () => { passed = true; });
  return { passed, res };
}

test('a bucket spends its capacity, then refills over time', () => {
  const bucket = createBucket({ capacity: 2, refillPerSec: 1 }, 0);
  assert.equal(take(bucket, 0).ok, true);
  assert.equal(take(bucket, 0).ok, true);
  const blocked = take(bucket, 0);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSec, 1);
  assert.equal(take(bucket, 1000).ok, true);
});

test('the client key is the first forwarded address, then x-real-ip, then the socket', () => {
  assert.deepEqual(clientKey(request({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), { key: '1.1.1.1', source: 'xff', hops: 2 });
  assert.deepEqual(clientKey(request({ 'x-real-ip': '3.3.3.3' })), { key: '3.3.3.3', source: 'x-real-ip', hops: 0 });
  assert.deepEqual(clientKey(request({}, '4.4.4.4')), { key: '4.4.4.4', source: 'socket', hops: 0 });
});

test('enforcing: a client over its limit gets 429 with Retry-After; others are unaffected', () => {
  const limiter = createSearchRateLimiter({ enforce: true, clock: () => 0, log: () => {} });
  const busy = request({ 'x-forwarded-for': '1.1.1.1' });
  for (let i = 0; i < CLIENT_LIMIT.capacity; i += 1) assert.equal(run(limiter, busy).passed, true);
  const { passed, res } = run(limiter, busy);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '1');
  assert.equal(run(limiter, request({ 'x-forwarded-for': '9.9.9.9' })).passed, true);
});

test('enforcing: the shared limit holds even when every request has a new address', () => {
  const limiter = createSearchRateLimiter({ enforce: true, clock: () => 0, log: () => {} });
  let passed = 0;
  for (let i = 0; i < GLOBAL_LIMIT.capacity + 10; i += 1) {
    if (run(limiter, request({ 'x-forwarded-for': `10.1.${i >> 8}.${i & 255}` })).passed) passed += 1;
  }
  assert.equal(passed, GLOBAL_LIMIT.capacity);
});

test('log-only: nothing is blocked, and the minute summary counts what would have been', () => {
  let now = 0;
  const lines = [];
  const limiter = createSearchRateLimiter({ enforce: false, clock: () => now, log: (l) => lines.push(l) });
  const busy = request({ 'x-forwarded-for': '1.1.1.1, 5.5.5.5' });
  for (let i = 0; i < CLIENT_LIMIT.capacity + 5; i += 1) assert.equal(run(limiter, busy).passed, true);
  now = 61_000;
  run(limiter, busy);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /mode=log-only requests=65 clients=1 max_per_client=65 over_client=5 over_global=0/);
  assert.match(lines[0], /key_source=\{"xff":65\} xff_hops=\{"2":65\}/);
  assert.match(lines[0], /candidates=\{"xff_first":\[65,1,65\],"xff_last":\[65,1,65\]\}/);
  assert.doesNotMatch(lines[0], /1\.1\.1\.1|5\.5\.5\.5/);
});
