'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaptchaVerifier } = require('../src/lib/turnstile');

const ENV = { TURNSTILE_SECRET: 'sec-123' };
const ARGS = { token: 'tok-abc', ip: '203.0.113.7', rid: 'rid-1', formId: 'contact_form' };

function fakeFetch(result) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (result instanceof Error) throw result;
    return {
      status: result.status,
      async json() { return result.body; },
    };
  };
  return { calls, fetchImpl };
}

function pass(overrides = {}) {
  return { status: 200, body: { success: true, action: 'contact_form', hostname: 'baclogistics.co.za', ...overrides } };
}

test('no secret configured skips the check, warns, and lets the submission through', async () => {
  const logs = [];
  const verifier = createCaptchaVerifier({}, (m) => logs.push(m));
  assert.equal(verifier.configured, false);

  const verdict = await verifier.verify(ARGS);
  assert.deepEqual(verdict, { ok: true, outcome: 'skipped' });
  assert.match(logs[0], /TURNSTILE_SECRET unset/);
});

test('a missing token fails without calling Cloudflare', async () => {
  const { calls, fetchImpl } = fakeFetch(pass());
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify({ ...ARGS, token: '' });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'missing-token');
  assert.equal(calls.length, 0);
});

test('a valid token posts the documented parameters and passes', async () => {
  const { calls, fetchImpl } = fakeFetch(pass());
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.deepEqual(verdict, { ok: true, outcome: 'pass' });
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const params = new URLSearchParams(calls[0].options.body);
  assert.equal(params.get('secret'), 'sec-123');
  assert.equal(params.get('response'), 'tok-abc');
  assert.equal(params.get('remoteip'), '203.0.113.7');
  assert.equal(params.get('idempotency_key'), 'rid-1');
});

test('an unknown caller address is omitted rather than sent as "unknown"', async () => {
  const { calls, fetchImpl } = fakeFetch(pass());
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  await verifier.verify({ ...ARGS, ip: 'unknown' });

  assert.equal(new URLSearchParams(calls[0].options.body).has('remoteip'), false);
});

test('Cloudflare rejecting the token surfaces its error codes', async () => {
  const { fetchImpl } = fakeFetch({ status: 200, body: { success: false, 'error-codes': ['timeout-or-duplicate'] } });
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.reason, 'timeout-or-duplicate');
});

test('a token minted for another form is rejected', async () => {
  const { fetchImpl } = fakeFetch(pass({ action: 'service_form' }));
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /action-mismatch:service_form/);
});

test('a token minted on an unregistered hostname is rejected', async () => {
  const { fetchImpl } = fakeFetch(pass({ hostname: 'phisher.example' }));
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /hostname-mismatch:phisher\.example/);
});

test('TURNSTILE_HOSTNAMES overrides the built-in allowlist', async () => {
  const { fetchImpl } = fakeFetch(pass({ hostname: 'preview.example' }));
  const verifier = createCaptchaVerifier(
    { ...ENV, TURNSTILE_HOSTNAMES: 'preview.example, other.example' }, () => {}, fetchImpl,
  );
  assert.equal((await verifier.verify(ARGS)).ok, true);
});

test('a 5xx from siteverify fails open as unverified', async () => {
  const logs = [];
  const { fetchImpl } = fakeFetch({ status: 503, body: {} });
  const verifier = createCaptchaVerifier(ENV, (m) => logs.push(m), fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.equal(verdict.ok, true);
  assert.equal(verdict.outcome, 'unverified');
  assert.match(logs[0], /turnstile_unverified/);
});

test('a network failure fails open as unverified', async () => {
  const { fetchImpl } = fakeFetch(new Error('ECONNRESET'));
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.equal(verdict.ok, true);
  assert.equal(verdict.outcome, 'unverified');
  assert.equal(verdict.reason, 'ECONNRESET');
});

test('a 4xx is treated as a rejection, not an outage', async () => {
  const { fetchImpl } = fakeFetch({ status: 400, body: { success: false, 'error-codes': ['bad-request'] } });
  const verifier = createCaptchaVerifier(ENV, () => {}, fetchImpl);
  const verdict = await verifier.verify(ARGS);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'bad-request');
});
