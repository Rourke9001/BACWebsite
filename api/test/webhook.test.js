'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookForwarder, DEFAULT_URLS, SITE_ORIGIN } = require('../src/lib/webhook');

const FIELDS = {
  name: 'Jane',
  email: 'jane@example.com',
  phone: '',
  company: '',
  message_subject: 'Quote',
  message: 'Hi',
  consent: '1',
  form_location: '/services/mining-transport.html',
};

function fakeFetch(result) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (result instanceof Error) throw result;
    return {
      status: result.status,
      async text() { return result.body; },
    };
  };
  return { calls, fetchImpl };
}

test('urlFor returns the documented defaults for known forms and "" for unknown ones', () => {
  const forwarder = createWebhookForwarder({}, () => {});
  assert.equal(forwarder.urlFor('contact_form'), DEFAULT_URLS.contact_form);
  assert.equal(forwarder.urlFor('service_form'), DEFAULT_URLS.service_form);
  assert.equal(forwarder.urlFor('nonsense_form'), '');
});

test('an env override replaces the default URL for that form', () => {
  const forwarder = createWebhookForwarder(
    { INTEGRATELY_WEBHOOK_CONTACT_FORM: 'https://example.com/hook-a' }, () => {},
  );
  assert.equal(forwarder.urlFor('contact_form'), 'https://example.com/hook-a');
  // Untouched form keeps its default.
  assert.equal(forwarder.urlFor('service_form'), DEFAULT_URLS.service_form);
});

test('an env override of empty string disables that form, logs once, and forward skips without calling fetch', async () => {
  const logs = [];
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: 'ok' });
  const forwarder = createWebhookForwarder(
    { INTEGRATELY_WEBHOOK_SERVICE_FORM: '' }, (m) => logs.push(m), fetchImpl,
  );

  assert.equal(forwarder.urlFor('service_form'), '');
  assert.equal(calls.length, 0, 'disabling must not call fetch merely by constructing the forwarder');

  const result = await forwarder.forward({ formId: 'service_form', fields: FIELDS, rid: 'abc', nowSec: 2000000000 });
  assert.deepEqual(result, { ok: false, skipped: true, reason: 'disabled' });
  assert.equal(calls.length, 0);
  assert.ok(logs.some((m) => /forwarding disabled for service_form/.test(m)), `expected a disabled-notice log, got: ${JSON.stringify(logs)}`);
});

test('an unknown form id is disabled and forward skips without calling fetch', async () => {
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: 'ok' });
  const forwarder = createWebhookForwarder({}, () => {}, fetchImpl);

  const result = await forwarder.forward({ formId: 'mystery_form', fields: FIELDS, rid: 'abc', nowSec: 2000000000 });
  assert.deepEqual(result, { ok: false, skipped: true, reason: 'disabled' });
  assert.equal(calls.length, 0);
});

test('forward posts the exact JSON payload to the resolved URL', async () => {
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: 'ok' });
  const forwarder = createWebhookForwarder({}, () => {}, fetchImpl);

  const result = await forwarder.forward({ formId: 'service_form', fields: FIELDS, rid: 'abc', nowSec: 2000000000 });
  assert.deepEqual(result, { ok: true, status: 200 });

  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, DEFAULT_URLS.service_form);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.ok(options.signal, 'expected an AbortSignal to be passed');

  const body = JSON.parse(options.body);
  assert.deepEqual(body, {
    name: 'Jane',
    email: 'jane@example.com',
    phone: '',
    company: '',
    message_subject: 'Quote',
    message: 'Hi',
    consent: '1',
    'Landing Page': `${SITE_ORIGIN}/services/mining-transport.html`,
    Timestamp: '2033-05-18T03:33:20.000Z',
    Form: 'service_form',
    'Request ID': 'abc',
  });
  assert.equal('form_location' in body, false);
});

test('a form_location that is not a site-relative path is omitted rather than forwarded', async () => {
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: 'ok' });
  const forwarder = createWebhookForwarder({}, () => {}, fetchImpl);

  await forwarder.forward({
    formId: 'contact_form',
    fields: { ...FIELDS, form_location: 'https://evil.example/x' },
    rid: 'abc',
    nowSec: 2000000000,
  });
  const body1 = JSON.parse(calls[0].options.body);
  assert.equal('Landing Page' in body1, false);

  await forwarder.forward({
    formId: 'contact_form',
    fields: { ...FIELDS, form_location: '' },
    rid: 'abc',
    nowSec: 2000000000,
  });
  const body2 = JSON.parse(calls[1].options.body);
  assert.equal('Landing Page' in body2, false);
});

test('a non-2xx response throws with the status and a snippet of the body', async () => {
  const { fetchImpl } = fakeFetch({ status: 500, body: 'x'.repeat(400) });
  const forwarder = createWebhookForwarder({}, () => {}, fetchImpl);

  await assert.rejects(
    forwarder.forward({ formId: 'contact_form', fields: FIELDS, rid: 'abc', nowSec: 2000000000 }),
    (err) => {
      assert.match(err.message, /Integrately webhook failed \(500\):/);
      assert.equal(err.message.length <= 'Integrately webhook failed (500): '.length + 300, true);
      return true;
    },
  );
});

test('a network failure propagates rather than being swallowed', async () => {
  const { fetchImpl } = fakeFetch(new Error('ECONNRESET'));
  const forwarder = createWebhookForwarder({}, () => {}, fetchImpl);

  await assert.rejects(
    forwarder.forward({ formId: 'contact_form', fields: FIELDS, rid: 'abc', nowSec: 2000000000 }),
    /ECONNRESET/,
  );
});
