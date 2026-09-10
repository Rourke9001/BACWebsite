'use strict';

const DEFAULT_URLS = {
  contact_form: 'https://webhooks.integrately.com/a/webhooks/5e1a84dd2f4e4ac6946a9da67229c0d9',
  service_form: 'https://webhooks.integrately.com/a/webhooks/c8759a85c90344c98bb1531935333afc',
};
const SITE_ORIGIN = 'https://baclogistics.co.za';
const FORWARD_TIMEOUT_MS = 5000;

const ENV_OVERRIDES = {
  contact_form: 'INTEGRATELY_WEBHOOK_CONTACT_FORM',
  service_form: 'INTEGRATELY_WEBHOOK_SERVICE_FORM',
};

/**
 * Forwards every accepted enquiry to the agency's Integrately webhook so lead
 * tracking receives it. This runs server-side, after the email has already
 * been sent, and must never affect the visitor — the caller (handler.js)
 * catches and logs any error rather than letting it change the response.
 *
 *   urlFor(formId) -> resolved URL, or '' when disabled/unknown
 *   forward({ formId, fields, rid, nowSec }) ->
 *     { ok: true, status } on a 2xx response, or
 *     { ok: false, skipped: true, reason: 'disabled' } without calling fetch.
 *   A non-2xx response or a network error/timeout throws — callers decide
 *   how to log it. No retries.
 */
function createWebhookForwarder(env, logger, fetchImpl = fetch) {
  const urls = {};
  for (const [formId, envVar] of Object.entries(ENV_OVERRIDES)) {
    // `??`, not `||`: an app setting deliberately blanked must disable
    // forwarding for that form, not silently fall back to the default.
    const url = env[envVar] ?? DEFAULT_URLS[formId];
    urls[formId] = url;
    if (!url) logger(`[webhook] forwarding disabled for ${formId}`);
  }

  function urlFor(formId) {
    return urls[formId] || '';
  }

  return {
    urlFor,

    async forward({ formId, fields, rid, nowSec }) {
      const url = urlFor(formId);
      if (!url) return { ok: false, skipped: true, reason: 'disabled' };

      const payload = {};
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'form_location') continue;
        payload[key] = value;
      }
      if (typeof fields.form_location === 'string' && fields.form_location.startsWith('/')) {
        payload['Landing Page'] = SITE_ORIGIN + fields.form_location;
      }
      payload.Timestamp = new Date(nowSec * 1000).toISOString();
      payload.Form = formId;
      payload['Request ID'] = rid;

      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
      if (res.status < 200 || res.status >= 300) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Integrately webhook failed (${res.status}): ${body}`);
      }
      return { ok: true, status: res.status };
    },
  };
}

module.exports = { createWebhookForwarder, DEFAULT_URLS, SITE_ORIGIN };
