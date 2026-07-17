'use strict';

// Per-instance TTL cache with serve-stale-on-failure (spec: publish-to-live <= ~2 min,
// storage outage must not take down already-cached blog pages).
function createPostCache(loadAll, { ttlMs = 60_000, now = Date.now } = {}) {
  let data = null;
  let fetchedAt = 0;
  let inflight = null;

  return async function getPosts() {
    if (data && now() - fetchedAt < ttlMs) return data;
    if (!inflight) {
      inflight = loadAll()
        .then((fresh) => { data = fresh; fetchedAt = now(); return fresh; })
        .catch((err) => {
          if (data) return data; // stale beats down
          throw err;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
}

module.exports = { createPostCache };
