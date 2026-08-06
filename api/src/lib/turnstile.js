'use strict';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOKEN_FIELD = 'cf-turnstile-response';
const VERIFY_TIMEOUT_MS = 5000;

// The widget is registered against these. Preview environments get dynamic
// hostnames that cannot be pre-registered — test forms on staging instead.
const ALLOWED_HOSTNAMES = [
  'baclogistics.co.za',
  'www.baclogistics.co.za',
  'ambitious-bush-084cda303.7.azurestaticapps.net',
  'ambitious-bush-084cda303-staging.7.azurestaticapps.net',
  'localhost',
];

/**
 * Cloudflare Turnstile verifier. The Function depends only on this interface:
 *
 *   verify({ token, ip, rid, formId }) -> { ok, outcome, reason }
 *
 * outcome is "pass", "fail", "skipped" (no secret configured) or "unverified"
 * (Cloudflare unreachable). Both "skipped" and "unverified" return ok:true —
 * see docs/form-anti-spam.md for why this fails open.
 */
function createCaptchaVerifier(env, logger, fetchImpl = fetch) {
  const secret = env.TURNSTILE_SECRET;
  const allowedHostnames = env.TURNSTILE_HOSTNAMES
    ? env.TURNSTILE_HOSTNAMES.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    : ALLOWED_HOSTNAMES;

  return {
    configured: Boolean(secret),

    async verify({ token, ip, rid, formId }) {
      if (!secret) {
        logger(`[${rid}] turnstile_skipped: TURNSTILE_SECRET unset — forms are unprotected`);
        return { ok: true, outcome: 'skipped' };
      }
      if (!token) {
        return { ok: false, outcome: 'fail', reason: 'missing-token' };
      }

      const params = new URLSearchParams({ secret, response: token, idempotency_key: rid });
      if (ip && ip !== 'unknown') params.set('remoteip', ip);

      let data;
      try {
        const res = await fetchImpl(VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        // 5xx is Cloudflare's problem, not the visitor's — treat it as an outage.
        if (res.status >= 500) throw new Error(`siteverify HTTP ${res.status}`);
        data = await res.json();
      } catch (err) {
        logger(`[${rid}] turnstile_unverified form=${formId}: ${err.message}`);
        return { ok: true, outcome: 'unverified', reason: err.message };
      }

      if (!data.success) {
        const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
        return { ok: false, outcome: 'fail', reason: codes.join(',') || 'unknown' };
      }
      // A token minted for one form must not be replayable against another.
      if (formId && data.action && data.action !== formId) {
        return { ok: false, outcome: 'fail', reason: `action-mismatch:${data.action}` };
      }
      if (data.hostname && !allowedHostnames.includes(String(data.hostname).toLowerCase())) {
        return { ok: false, outcome: 'fail', reason: `hostname-mismatch:${data.hostname}` };
      }
      return { ok: true, outcome: 'pass' };
    },
  };
}

module.exports = { createCaptchaVerifier, TOKEN_FIELD, ALLOWED_HOSTNAMES };
