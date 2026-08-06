'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateStore, createMemoryRateStore, WINDOW_SEC, MAX_ATTEMPTS } = require('../src/lib/rate-store');

const NOW = 2_000_000_000;
const CONN = 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net';

function fakeTable() {
  const rows = new Map();
  let etagSeq = 0;
  const stamp = () => `W/"${(etagSeq += 1)}"`;

  return {
    rows,
    createTableCalls: 0,
    async createTable() { this.createTableCalls += 1; },
    async getEntity(pk, rk) {
      const found = rows.get(`${pk}|${rk}`);
      if (!found) {
        const err = new Error('ResourceNotFound');
        err.statusCode = 404;
        throw err;
      }
      return { ...found };
    },
    async createEntity(entity) {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      if (rows.has(key)) {
        const err = new Error('EntityAlreadyExists');
        err.statusCode = 409;
        throw err;
      }
      rows.set(key, { ...entity, etag: stamp() });
    },
    async updateEntity(entity, _mode, options) {
      const key = `${entity.partitionKey}|${entity.rowKey}`;
      const current = rows.get(key);
      if (current && options && options.etag && options.etag !== current.etag) {
        const err = new Error('UpdateConditionNotSatisfied');
        err.statusCode = 412;
        throw err;
      }
      rows.set(key, { ...entity, etag: stamp() });
    },
  };
}

function storeWith(table, logs = []) {
  return createRateStore({ BLOG_STORAGE_CONNECTION: CONN }, (m) => logs.push(m), () => table);
}

test('counts accumulate across calls and trip at the threshold', async () => {
  const store = storeWith(fakeTable());
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const { limited, count } = await store.hit('contact_form', '203.0.113.1', NOW);
    assert.equal(limited, false, `attempt ${i} should pass`);
    assert.equal(count, i);
  }
  const over = await store.hit('contact_form', '203.0.113.1', NOW);
  assert.equal(over.limited, true);
});

test('the counter resets once the window has elapsed', async () => {
  const store = storeWith(fakeTable());
  for (let i = 0; i <= MAX_ATTEMPTS; i += 1) await store.hit('contact_form', '203.0.113.2', NOW);
  assert.equal((await store.hit('contact_form', '203.0.113.2', NOW)).limited, true);

  const after = await store.hit('contact_form', '203.0.113.2', NOW + WINDOW_SEC + 1);
  assert.equal(after.limited, false);
  assert.equal(after.count, 1);
});

test('separate IPs and separate forms have independent windows', async () => {
  const store = storeWith(fakeTable());
  for (let i = 0; i <= MAX_ATTEMPTS; i += 1) await store.hit('contact_form', '203.0.113.3', NOW);
  assert.equal((await store.hit('contact_form', '203.0.113.3', NOW)).limited, true);

  assert.equal((await store.hit('contact_form', '203.0.113.4', NOW)).limited, false);
  assert.equal((await store.hit('service_form', '203.0.113.3', NOW)).limited, false);
});

test('a raced write is retried rather than lost', async () => {
  const table = fakeTable();
  const store = storeWith(table);
  await store.hit('contact_form', '203.0.113.5', NOW);

  // Force one stale-etag rejection, then let the retry through.
  const realUpdate = table.updateEntity.bind(table);
  let failed = false;
  table.updateEntity = async (entity, mode, options) => {
    if (!failed) {
      failed = true;
      const err = new Error('UpdateConditionNotSatisfied');
      err.statusCode = 412;
      throw err;
    }
    return realUpdate(entity, mode, options);
  };

  const { limited, count } = await store.hit('contact_form', '203.0.113.5', NOW);
  assert.equal(limited, false);
  assert.equal(count, 2);
});

test('a storage outage fails open and is logged', async () => {
  const logs = [];
  const store = createRateStore({ BLOG_STORAGE_CONNECTION: CONN }, (m) => logs.push(m), () => ({
    async createTable() { throw new Error('storage unreachable'); },
  }));

  const { limited } = await store.hit('contact_form', '203.0.113.6', NOW);
  assert.equal(limited, false);
  assert.match(logs.join('\n'), /fail-open.*storage unreachable/);
});

test('once blocked, further attempts short-circuit without touching storage', async () => {
  const table = fakeTable();
  const store = storeWith(table);
  for (let i = 0; i <= MAX_ATTEMPTS; i += 1) await store.hit('contact_form', '203.0.113.8', NOW);

  let touched = false;
  table.getEntity = async () => { touched = true; throw new Error('should not be called'); };

  const { limited } = await store.hit('contact_form', '203.0.113.8', NOW);
  assert.equal(limited, true);
  assert.equal(touched, false);
});

test('the table is created once, not on every request', async () => {
  const table = fakeTable();
  const store = storeWith(table);
  await store.hit('contact_form', '203.0.113.9', NOW);
  await store.hit('contact_form', '203.0.113.9', NOW);
  assert.equal(table.createTableCalls, 1);
});

test('without a connection string it degrades to a per-instance limiter', async () => {
  const logs = [];
  const store = createRateStore({}, (m) => logs.push(m));
  assert.match(logs[0], /per-instance only/);

  for (let i = 0; i <= MAX_ATTEMPTS; i += 1) await store.hit('contact_form', '203.0.113.10', NOW);
  assert.equal((await store.hit('contact_form', '203.0.113.10', NOW)).limited, true);
});

test('the memory fallback tracks and resets its window', async () => {
  const store = createMemoryRateStore();
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    assert.equal((await store.hit('contact_form', '203.0.113.11', NOW)).limited, false);
  }
  assert.equal((await store.hit('contact_form', '203.0.113.11', NOW)).limited, true);
  assert.equal((await store.hit('contact_form', '203.0.113.11', NOW + WINDOW_SEC + 1)).limited, false);
});
