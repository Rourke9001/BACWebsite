'use strict';

const crypto = require('node:crypto');
const spam = require('./spam');

const FORMS = {
  contact_form: { subject: 'BAC Logistics Contact Form' },
  service_form: { subject: 'BAC Logistics Service Form' },
};

const REQUIRED_FIELDS = ['name', 'email', 'message'];
const SUCCESS_REDIRECT = '/information/thank-you.html';
const ERROR_REDIRECT = '/';
const DEFAULT_RECIPIENT = 'info@baclogistics.co.za';
const DEFAULT_FROM = 'noreply@baclogistics.co.za';
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
 * `deps` = { sender, recipient, from, logger }.
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

  // Anti-spam gates, in the old handler's order. Rejections use generic
  // messages on purpose — no hints for bots.
  if (spam.honeypotTriggered(fields)) {
    log(`[${rid}] honeypot_trigger form=${formId} ip=${ip}`);
    return buildResult(false, 'Something went wrong. Please try again.', { rid, wantsJson, silentDrop: true });
  }
  if (spam.filledTooFast(fields, nowSec)) {
    log(`[${rid}] min_time_gate form=${formId} ip=${ip}`);
    return buildResult(false, 'Please take a moment and try again.', { rid, wantsJson, silentDrop: true });
  }
  if (spam.rateLimited(formId, ip, nowSec)) {
    log(`[${rid}] rate_limited form=${formId} ip=${ip}`);
    return buildResult(false, 'Too many submissions. Please try again later.', { rid, wantsJson, silentDrop: true });
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

  // Duplicate submits inside the TTL pretend success without re-sending.
  const contentFields = cleanFields(fields);
  if (spam.isDuplicateSubmission(contentFields, ip, userAgent, nowSec)) {
    log(`[${rid}] duplicate_submit_dropped form=${formId} ip=${ip}`);
    return buildResult(true, 'Thank you.', { rid, wantsJson, silentDrop: true });
  }

  const to = deps.recipient || DEFAULT_RECIPIENT;
  try {
    await deps.sender.send({
      to,
      from: deps.from || DEFAULT_FROM,
      fromName: FROM_NAME,
      replyTo: String(fields.email),
      subject: formCfg.subject,
      text: composeBody(contentFields, { formId, ip, rid }),
    });
  } catch (err) {
    log(`[${rid}] send_failed form=${formId}: ${err.message}`);
    return buildResult(false, 'We could not send your message. Please try again later.', { rid, wantsJson });
  }

  log(`[${rid}] sent form=${formId} to=${to}`);
  return buildResult(true, 'Thank you.', { rid, wantsJson });
}

function cleanFields(fields) {
  const cleaned = { ...fields };
  delete cleaned.form_id;
  delete cleaned.form_ts;
  delete cleaned[spam.HONEYPOT_FIELD];
  return cleaned;
}

function composeBody(fields, { formId, ip, rid }) {
  const labels = {
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    company: 'Company',
    message_subject: 'Subject',
    message: 'Message',
    consent: 'Consent given',
    form_location: 'Submitted from',
  };
  const lines = [];
  for (const [key, label] of Object.entries(labels)) {
    const value = String(fields[key] || '').trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push('', `Form: ${formId}`, `IP: ${ip}`, `Request ID: ${rid}`);
  return lines.join('\n');
}

module.exports = { handleSubmission, SUCCESS_REDIRECT, ERROR_REDIRECT, DEFAULT_RECIPIENT };
