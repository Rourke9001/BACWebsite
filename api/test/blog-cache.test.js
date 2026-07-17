'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createPostCache } = require('../src/lib/blog/cache');

test('cache returns fresh data within TTL without reloading', async () => {
  let calls = 0;
  let t = 0;
  const getPosts = createPostCache(async () => { calls++; return [{ name: 'a' }]; },
    { ttlMs: 60_000, now: () => t });
  await getPosts();
  t = 30_000;
  await getPosts();
  assert.strictEqual(calls, 1);
});

test('cache reloads after TTL expires', async () => {
  let calls = 0;
  let t = 0;
  const getPosts = createPostCache(async () => { calls++; return [calls]; }, { ttlMs: 60_000, now: () => t });
  await getPosts();
  t = 61_000;
  const second = await getPosts();
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(second, [2]);
});

test('cache serves stale data when refresh fails', async () => {
  let calls = 0;
  let t = 0;
  const getPosts = createPostCache(async () => {
    calls++;
    if (calls > 1) throw new Error('storage down');
    return [{ name: 'a' }];
  }, { ttlMs: 60_000, now: () => t });
  await getPosts();
  t = 61_000;
  const stale = await getPosts();
  assert.deepStrictEqual(stale, [{ name: 'a' }]);
});

test('cache throws when there is no data at all', async () => {
  const getPosts = createPostCache(async () => { throw new Error('down'); }, { ttlMs: 60_000 });
  await assert.rejects(getPosts, /down/);
});

test('concurrent callers share one inflight load', async () => {
  let calls = 0;
  const getPosts = createPostCache(async () => { calls++; return []; }, { ttlMs: 60_000 });
  await Promise.all([getPosts(), getPosts(), getPosts()]);
  assert.strictEqual(calls, 1);
});
