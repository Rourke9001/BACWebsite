'use strict';

const crypto = require('node:crypto');

// Thresholds mirror the old inc/form/action.php config.
const HONEYPOT_FIELD = 'company_website';
const MIN_FILL_SECONDS = 3;
const RATE_LIMIT_WINDOW_SEC = 300;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const IDEMPOTENCY_TTL_SEC = 180;
const BLOCKED_DOMAINS = ['mailinator.com', 'tempmail.com', '10minutemail.com'];
const MAX_LINKS = 5;

// In-memory stores, per Function instance. The old handler's stores were
// file-based and per-server, so parity is equivalent for this traffic level;
// a cold start simply resets the window.
const rateStore = new Map();
const idempotencyStore = new Map();

function honeypotTriggered(fields) {
  return Boolean((fields[HONEYPOT_FIELD] || '').trim());
}

function filledTooFast(fields, nowSec) {
  const started = parseInt(fields.form_ts, 10);
  if (!Number.isFinite(started) || started <= 0) return false;
  return nowSec - started < MIN_FILL_SECONDS;
}

function rateLimited(formId, ip, nowSec) {
  const key = crypto.createHash('sha256').update(`${formId}|${ip}`).digest('hex');
  let entry = rateStore.get(key);
  if (!entry || nowSec > entry.reset) {
    entry = { reset: nowSec + RATE_LIMIT_WINDOW_SEC, count: 0 };
  }
  entry.count += 1;
  rateStore.set(key, entry);
  pruneStore(rateStore, nowSec, (e) => e.reset);
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

function blockedEmailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at === -1) return false;
  const domain = String(email).slice(at + 1).toLowerCase();
  return BLOCKED_DOMAINS.includes(domain);
}

function countLinks(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/gi);
  return matches ? matches.length : 0;
}

function tooManyLinks(text) {
  return countLinks(text) > MAX_LINKS;
}

function isDuplicateSubmission(fields, ip, userAgent, nowSec) {
  const hash = crypto
    .createHash('sha256')
    .update(`${JSON.stringify(fields)}|${ip}|${userAgent}`)
    .digest('hex');
  const seenAt = idempotencyStore.get(hash);
  if (seenAt !== undefined && nowSec - seenAt < IDEMPOTENCY_TTL_SEC) {
    return true;
  }
  idempotencyStore.set(hash, nowSec);
  pruneStore(idempotencyStore, nowSec, (seen) => seen + IDEMPOTENCY_TTL_SEC);
  return false;
}

function pruneStore(store, nowSec, expiryOf) {
  if (store.size <= 1000) return;
  for (const [key, value] of store) {
    if (nowSec > expiryOf(value)) store.delete(key);
  }
}

module.exports = {
  HONEYPOT_FIELD,
  honeypotTriggered,
  filledTooFast,
  rateLimited,
  blockedEmailDomain,
  tooManyLinks,
  isDuplicateSubmission,
};
