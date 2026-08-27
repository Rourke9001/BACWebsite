'use strict';

const crypto = require('node:crypto');
const spam = require('./spam');
const { TOKEN_FIELD } = require('./turnstile');

const FORMS = {
  contact_form: { subject: 'BAC Logistics Contact Form' },
  service_form: { subject: 'BAC Logistics Service Form' },
};

const REQUIRED_FIELDS = ['name', 'email', 'message', 'consent'];
// POPIA s11 wants consent that is voluntary, specific, informed AND demonstrable.
// The exact string shown to the person is recorded with every submission, so a
// later subject-access request can be answered with what they actually agreed to.
// Changing the wording on the pages means bumping this in the same commit --
// api/test/handler.test.js pins the two together.
const CONSENT_WORDING = "By filling in this form, I consent to being contacted and agree to BAC Logistics' Privacy Policy.";
const SUCCESS_REDIRECT = '/information/thank-you.html';
const ERROR_REDIRECT = '/';
const DEFAULT_RECIPIENT = 'info@baclogistics.co.za';
// Ideation's lead-tracking mailbox takes a blind copy of every submission (SEO
// brief, Aug 2026). Blind so the address never reaches the enquirer or anyone the
// mail is forwarded to. Override or disable with the CONTACT_BCC app setting —
// an empty string sends with no BCC at all.
const DEFAULT_BCC = 'leads@ideation.co.za';
// Must be a real tenant mailbox — the Graph app sends *as* it. donotreply@ is
// shared with the office scanner identity; swap to a dedicated noreply@ shared
// mailbox if one is created. Override: CONTACT_FROM.
const DEFAULT_FROM = 'donotreply@baclogistics.co.za';
const FROM_NAME = 'BAC Logistics';

// Same shape the old handler produced: JSON for AJAX callers, otherwise a
// redirect target carrying status + request id.
function buildResult(ok, message, { errors, rid, wantsJson, silentDrop } = {}) {
  const payload = { ok, message, request_id: rid };
  if (errors) payload.errors = errors;
  if (wantsJson) {
    return { kind: 'json', status: ok ? 200 : 400, payload, silentDrop: Boolean(silentDrop) };
  }
  const target = ok ? SUCCESS_REDIRECT : ERROR_REDIRECT;
  const query = `status=${ok ? 'ok' : 'error'}&rid=${encodeURIComponent(rid)}`;
  return { kind: 'redirect', status: 303, location: `${target}?${query}`, silentDrop: Boolean(silentDrop) };
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

/**
 * Pure submission pipeline. `meta` = { ip, userAgent, wantsJson, nowSec }.
 * `deps` = { sender, recipient, bcc, from, logger, verifyCaptcha, rateStore }.
 */
async function handleSubmission(fields, meta, deps) {
  const rid = crypto.randomUUID();
  const { ip, userAgent, wantsJson } = meta;
  const nowSec = meta.nowSec ?? Math.floor(Date.now() / 1000);
  const log = deps.logger || (() => {});

  const formId = String(fields.form_id || '');
  const formCfg = FORMS[formId];
  if (!formCfg) {
    log(`[${rid}] unknown form_id "${formId}" from ${ip}`);
    return buildResult(false, 'Unknown form.', { rid, wantsJson });
  }

  // Cheapest gates first, then the durable rate limit, then the external
  // verify last — a blast must not become thousands of siteverify calls.
  // Rejections use generic messages on purpose: no hints for bots.
  if (spam.honeypotTriggered(fields)) {
    log(`[${rid}] honeypot_trigger form=${formId} ip=${ip}`);
    return buildResult(false, 'Something went wrong. Please try again.', { rid, wantsJson, silentDrop: true });
  }

  const tsReason = spam.timestampSuspect(fields, nowSec);
  if (tsReason) {
    log(`[${rid}] timestamp_${tsReason} form=${formId} ip=${ip}`);
    return buildResult(false, 'Please reload the page and try again.', { rid, wantsJson, silentDrop: true });
  }

  if (deps.rateStore) {
    const { limited, count } = await deps.rateStore.hit(formId, ip, nowSec);
    if (limited) {
      log(`[${rid}] rate_limited form=${formId} ip=${ip} count=${count}`);
      return buildResult(false, 'Too many submissions. Please try again later.', { rid, wantsJson, silentDrop: true });
    }
  }

  let captchaOutcome = 'disabled';
  if (deps.verifyCaptcha) {
    const verdict = await deps.verifyCaptcha.verify({ token: fields[TOKEN_FIELD], ip, rid, formId });
    captchaOutcome = verdict.outcome;
    if (!verdict.ok) {
      log(`[${rid}] captcha_fail form=${formId} ip=${ip} reason=${verdict.reason}`);
      return buildResult(false, 'Verification failed. Please reload the page and try again.', { rid, wantsJson, silentDrop: true });
    }
  }

  // Validation
  const errors = {};
  for (const field of REQUIRED_FIELDS) {
    if (!String(fields[field] || '').trim()) errors[field] = 'Required';
  }
  if (!errors.email && !validEmail(fields.email)) errors.email = 'Invalid email';
  if (!errors.email && spam.blockedEmailDomain(fields.email)) {
    errors.email = 'Please use a different email address';
  }
  if (!errors.message && spam.tooManyLinks(fields.message)) errors.message = 'Too many links';

  if (Object.keys(errors).length > 0) {
    log(`[${rid}] validation_fail form=${formId} ip=${ip} fields=${Object.keys(errors).join(',')}`);
    return buildResult(false, 'Please correct the highlighted fields.', { errors, rid, wantsJson });
  }

  // Logged on every submission, accepted ones included, so the threshold can be
  // tuned against real traffic.
  const spamScore = spam.score(fields);
  if (spam.isSpamByScore(spamScore)) {
    log(`[${rid}] spam_score_block form=${formId} ip=${ip} score=${spamScore.score} signals=${spamScore.signals.join(',')}`);
    return buildResult(false, 'Something went wrong. Please try again.', { rid, wantsJson, silentDrop: true });
  }

  // Duplicate submits inside the TTL pretend success without re-sending.
  const contentFields = cleanFields(fields);
  if (spam.isDuplicateSubmission(contentFields, ip, userAgent, nowSec)) {
    log(`[${rid}] duplicate_submit_dropped form=${formId} ip=${ip}`);
    return buildResult(true, 'Thank you.', { rid, wantsJson, silentDrop: true });
  }

  const to = deps.recipient || DEFAULT_RECIPIENT;
  // `?? DEFAULT_BCC`, not `|| DEFAULT_BCC`: an app setting deliberately blanked
  // must turn the blind copy off, not silently fall back to the default.
  const bcc = deps.bcc ?? DEFAULT_BCC;
  // Mail that reached the inbox without a passing captcha is flagged rather than
  // dropped, so a Cloudflare outage or a missing secret is visible, not silent.
  const verified = captchaOutcome === 'pass';
  try {
    await deps.sender.send({
      to,
      bcc,
      from: deps.from || DEFAULT_FROM,
      fromName: FROM_NAME,
      replyTo: String(fields.email),
      subject: verified ? formCfg.subject : `[UNVERIFIED] ${formCfg.subject}`,
      text: composeBody(contentFields, { formId, ip, rid, captchaOutcome, spamScore, nowSec }),
    });
  } catch (err) {
    log(`[${rid}] send_failed form=${formId}: ${err.message}`);
    return buildResult(false, 'We could not send your message. Please try again later.', { rid, wantsJson });
  }

  log(`[${rid}] sent form=${formId} to=${to} bcc=${bcc || 'none'} captcha=${captchaOutcome} score=${spamScore.score}`);
  return buildResult(true, 'Thank you.', { rid, wantsJson });
}

function cleanFields(fields) {
  const cleaned = { ...fields };
  delete cleaned.form_id;
  delete cleaned.form_ts;
  delete cleaned[spam.HONEYPOT_FIELD];
  delete cleaned[TOKEN_FIELD];
  return cleaned;
}

function composeBody(fields, { formId, ip, rid, captchaOutcome, spamScore, nowSec }) {
  const labels = {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    company: 'Company',
    message_subject: 'Subject',
    message: 'Message',
    form_location: 'Submitted from',
  };
  const lines = [];
  for (const [key, label] of Object.entries(labels)) {
    const value = String(fields[key] || '').trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  // Spelled out rather than echoing the raw "1": validation above guarantees it was
  // ticked, and the wording plus timestamp are what make the record demonstrable.
  const recordedAt = new Date((nowSec ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  lines.push(
    'Consent given: Yes',
    `Consent wording: ${CONSENT_WORDING}`,
    `Consent recorded: ${recordedAt}`,
  );
  lines.push('', `Form: ${formId}`, `IP: ${ip}`, `Request ID: ${rid}`);
  if (captchaOutcome && captchaOutcome !== 'pass') {
    lines.push(`Captcha: ${captchaOutcome} — this message was NOT verified as human`);
  }
  if (spamScore && spamScore.score > 0) {
    lines.push(`Spam score: ${spamScore.score} (${spamScore.signals.join(', ')})`);
  }
  return lines.join('\n');
}

module.exports = {
  handleSubmission, SUCCESS_REDIRECT, ERROR_REDIRECT, DEFAULT_RECIPIENT, DEFAULT_BCC, CONSENT_WORDING,
};
