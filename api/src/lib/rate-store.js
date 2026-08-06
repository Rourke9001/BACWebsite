'use strict';

const crypto = require('node:crypto');

const TABLE_NAME = 'formratelimit';
const WINDOW_SEC = 600;
const MAX_ATTEMPTS = 3;
const MAX_CONFLICT_RETRIES = 2;

function keyFor(formId, ip) {
  return crypto.createHash('sha256').update(`${formId}|${ip}`).digest('hex');
}

/**
 * Rate limiter with the interface the handler depends on:
 *
 *   hit(formId, ip, nowSec) -> Promise<{ limited, count }>
 *
 * Backed by Azure Table Storage on the storage account the blog already uses, so
 * the window survives the Function cold starts that made the previous in-memory
 * limiter useless. Falls back to memory-only when BLOG_STORAGE_CONNECTION is
 * absent, and fails open on any storage error — see docs/form-anti-spam.md.
 */
function createRateStore(env, logger, clientFactory = defaultClientFactory) {
  const denyCache = new Map();
  const conn = env.BLOG_STORAGE_CONNECTION;

  if (!conn) {
    logger('[rate-store] BLOG_STORAGE_CONNECTION unset — rate limiting is per-instance only');
    return createMemoryRateStore();
  }

  let clientPromise = null;
  function getClient() {
    // Created on first use so a bad connection string cannot break module load.
    if (!clientPromise) {
      clientPromise = (async () => {
        const client = clientFactory(conn, TABLE_NAME);
        await client.createTable();
        return client;
      })().catch((err) => {
        clientPromise = null;
        throw err;
      });
    }
    return clientPromise;
  }

  return {
    async hit(formId, ip, nowSec) {
      const rowKey = keyFor(formId, ip);

      // Fast path only ever denies — never used to allow, so a stale cache
      // cannot let a blocked caller through.
      const cached = denyCache.get(rowKey);
      if (cached && nowSec < cached) {
        return { limited: true, count: MAX_ATTEMPTS + 1 };
      }
      prune(denyCache, nowSec, (resetAt) => resetAt);

      try {
        const client = await getClient();
        const { count, resetAt } = await bumpCounter(client, formId, rowKey, nowSec);
        const limited = count > MAX_ATTEMPTS;
        if (limited) denyCache.set(rowKey, resetAt);
        return { limited, count };
      } catch (err) {
        logger(`[rate-store] fail-open form=${formId}: ${err.message}`);
        return { limited: false, count: 0 };
      }
    },
  };
}

async function bumpCounter(client, formId, rowKey, nowSec) {
  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    let existing = null;
    try {
      existing = await client.getEntity(formId, rowKey);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    if (!existing || nowSec > existing.resetAt) {
      const entity = { partitionKey: formId, rowKey, count: 1, resetAt: nowSec + WINDOW_SEC };
      try {
        if (existing) {
          await client.updateEntity(entity, 'Replace', { etag: existing.etag });
        } else {
          await client.createEntity(entity);
        }
        return { count: 1, resetAt: entity.resetAt };
      } catch (err) {
        // 409 (raced insert) or 412 (raced update) — re-read and try again.
        if (err.statusCode !== 409 && err.statusCode !== 412) throw err;
        continue;
      }
    }

    const next = { partitionKey: formId, rowKey, count: existing.count + 1, resetAt: existing.resetAt };
    try {
      await client.updateEntity(next, 'Replace', { etag: existing.etag });
      return { count: next.count, resetAt: next.resetAt };
    } catch (err) {
      if (err.statusCode !== 412) throw err;
    }
  }
  throw new Error(`rate counter contended after ${MAX_CONFLICT_RETRIES + 1} attempts`);
}

function prune(map, nowSec, resetAtOf) {
  if (map.size <= 1000) return;
  for (const [key, value] of map) {
    if (nowSec >= resetAtOf(value)) map.delete(key);
  }
}

/** In-process fallback. Resets on cold start, which is why it is not the default. */
function createMemoryRateStore() {
  const counters = new Map();
  return {
    async hit(formId, ip, nowSec) {
      const key = keyFor(formId, ip);
      let entry = counters.get(key);
      if (!entry || nowSec > entry.resetAt) {
        entry = { count: 0, resetAt: nowSec + WINDOW_SEC };
      }
      entry.count += 1;
      counters.set(key, entry);
      prune(counters, nowSec, (e) => e.resetAt);
      return { limited: entry.count > MAX_ATTEMPTS, count: entry.count };
    },
  };
}

function defaultClientFactory(conn, tableName) {
  const { TableClient } = require('@azure/data-tables');
  return TableClient.fromConnectionString(conn, tableName);
}

module.exports = { createRateStore, createMemoryRateStore, WINDOW_SEC, MAX_ATTEMPTS, TABLE_NAME };
