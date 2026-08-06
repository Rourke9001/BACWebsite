'use strict';

const crypto = require('node:crypto');

const HONEYPOT_FIELD = 'company_website';
const MIN_FILL_SECONDS = 3;
// The pages ship a frozen form_ts literal that only main.js refreshes, so an
// implausibly OLD stamp means our JS never ran — the no-JS bot signature.
const MAX_FORM_AGE_SEC = 12 * 60 * 60;
const IDEMPOTENCY_TTL_SEC = 180;
const BLOCKED_DOMAINS = ['mailinator.com', 'tempmail.com', '10minutemail.com'];
const MAX_LINKS = 5;
const SCORE_THRESHOLD = 4;

const idempotencyStore = new Map();

function honeypotTriggered(fields) {
  return Boolean((fields[HONEYPOT_FIELD] || '').trim());
}

/** Returns a reason string when the timestamp is implausible, otherwise null. */
function timestampSuspect(fields, nowSec) {
  const started = parseInt(fields.form_ts, 10);
  if (!Number.isFinite(started) || started <= 0) return 'missing';
  const age = nowSec - started;
  if (age < MIN_FILL_SECONDS) return 'too_fast';
  if (age > MAX_FORM_AGE_SEC) return 'stale';
  return null;
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

// Signals drawn from the July 2026 blast; weights tuned so no single one blocks.
const BRAND_SQUAT = ['google', 'facebook', 'microsoft', 'amazon', 'apple', 'yahoo', 'test'];
const BLAST_PHRASES =
  /(for reseller|price for reseller|know your price|write about your\s+price|saya ingin tahu harga|ваш[аи]? цен)/i;
const NON_LATIN = /[Ѐ-ӿ؀-ۿ฀-๿一-鿿぀-ヿ]/;
const BOT_GREETING = /^\s*(hallo|aloha|hai|privet|bonjour)\b/i;

/**
 * Weighted spam score. Returns { score, signals } — the handler logs this on
 * every submission, including accepted ones, so the threshold can be tuned
 * against real traffic rather than guesswork.
 */
function score(fields) {
  const signals = [];
  const add = (weight, name) => { signals.push(`${name}:${weight}`); return weight; };
  let total = 0;

  const phone = String(fields.phone || '').replace(/[\s()-]/g, '');
  // Real local numbers start 0; international ones carry + or the 27 country code.
  if (/^\d{11,}$/.test(phone) && !phone.startsWith('0') && !phone.startsWith('27')) {
    total += add(2, 'phone_bare_intl');
  }

  const company = String(fields.company || '').trim().toLowerCase();
  if (BRAND_SQUAT.includes(company)) total += add(2, 'company_brand_squat');

  const subject = String(fields.message_subject || '');
  const message = String(fields.message || '');

  if (BLAST_PHRASES.test(`${subject} ${message}`)) total += add(3, 'blast_phrase');
  if (NON_LATIN.test(message)) total += add(2, 'non_latin_body');
  if (BOT_GREETING.test(subject)) total += add(1, 'bot_greeting');
  // Template-assembly artefact: runs of whitespace inside a one-line subject.
  if (/\S {3,}\S/.test(subject)) total += add(1, 'subject_padding');

  return { score: total, signals };
}

function isSpamByScore(result) {
  return result.score >= SCORE_THRESHOLD;
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
  if (idempotencyStore.size > 1000) {
    for (const [key, seen] of idempotencyStore) {
      if (nowSec > seen + IDEMPOTENCY_TTL_SEC) idempotencyStore.delete(key);
    }
  }
  return false;
}

module.exports = {
  HONEYPOT_FIELD,
  MIN_FILL_SECONDS,
  MAX_FORM_AGE_SEC,
  SCORE_THRESHOLD,
  honeypotTriggered,
  timestampSuspect,
  blockedEmailDomain,
  tooManyLinks,
  score,
  isSpamByScore,
  isDuplicateSubmission,
};
