'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleSubmission, SUCCESS_REDIRECT, DEFAULT_RECIPIENT } = require('../src/lib/handler');
const { createEmailSender } = require('../src/lib/email');

const NOW = 2_000_000_000;
let ipCounter = 0;

function freshIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function validFields(overrides = {}) {
  return {
    form_id: 'contact_form',
    form_ts: String(NOW - 60),
    company_website: '',
    form_location: '/contact/',
    name: 'Jane Tester',
    email: 'jane@example.com',
    phone: '+27123456789',
    company: 'Example Ltd',
    message_subject: 'Quote',
    message: 'I would like a quote for sea freight.',
    consent: '1',
    ...overrides,
  };
}

function run(fields, { ip = freshIp(), wantsJson = true, sender, nowSec = NOW } = {}) {
  const sent = [];
  const deps = {
    sender: sender || { async send(msg) { sent.push(msg); } },
    logger: () => {},
  };
  const meta = { ip, userAgent: 'test-agent', wantsJson, nowSec };
  return handleSubmission(fields, meta, deps).then((result) => ({ result, sent }));
}

test('happy path sends email to info@ and reports ok', async () => {
  const { result, sent } = await run(validFields());
  assert.equal(result.payload.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, DEFAULT_RECIPIENT);
  assert.equal(sent[0].subject, 'BAC Logistics Contact Form');
  assert.equal(sent[0].replyTo, 'jane@example.com');
  assert.match(sent[0].text, /Jane Tester/);
});

test('service_form uses its own subject', async () => {
  const { sent } = await run(validFields({ form_id: 'service_form' }));
  assert.equal(sent[0].subject, 'BAC Logistics Service Form');
});

test('unknown form_id is rejected without sending', async () => {
  const { result, sent } = await run(validFields({ form_id: 'order_form' }));
  assert.equal(result.payload.ok, false);
  assert.equal(sent.length, 0);
});

test('honeypot value drops the submission', async () => {
  const { result, sent } = await run(validFields({ company_website: 'http://spam.example' }));
  assert.equal(result.payload.ok, false);
  assert.equal(sent.length, 0);
});

test('submissions faster than 3s are rejected; frozen/absent form_ts passes', async () => {
  const fast = await run(validFields({ form_ts: String(NOW - 1) }));
  assert.equal(fast.result.payload.ok, false);
  assert.equal(fast.sent.length, 0);

  const absent = await run(validFields({ form_ts: '' }));
  assert.equal(absent.result.payload.ok, true);

  const frozen = await run(validFields({ form_ts: '1784045684' }));
  assert.equal(frozen.result.payload.ok, true);
});

test('6th submission in the window from one IP is rate limited', async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) {
    const { result } = await run(validFields({ message: `unique message ${i}` }), { ip });
    assert.equal(result.payload.ok, true, `submission ${i + 1} should pass`);
  }
  const { result, sent } = await run(validFields({ message: 'unique message 6' }), { ip });
  assert.equal(result.payload.ok, false);
  assert.equal(sent.length, 0);
});

test('required fields and email format are validated', async () => {
  const { result } = await run(validFields({ name: '  ', email: 'not-an-email', message: '' }));
  assert.equal(result.payload.ok, false);
  assert.deepEqual(Object.keys(result.payload.errors).sort(), ['email', 'message', 'name']);
});

test('disposable email domains are rejected', async () => {
  const { result, sent } = await run(validFields({ email: 'bot@Mailinator.com' }));
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.errors.email, 'Please use a different email address');
  assert.equal(sent.length, 0);
});

test('more than 5 links in the message is rejected', async () => {
  const links = Array.from({ length: 6 }, (_, i) => `http://spam${i}.example.com`).join(' ');
  const { result } = await run(validFields({ message: `Buy now ${links}` }));
  assert.equal(result.payload.errors.message, 'Too many links');
});

test('duplicate submission inside TTL pretends success without re-sending', async () => {
  const ip = freshIp();
  const fields = validFields({ message: 'duplicate check message' });
  const first = await run(fields, { ip });
  assert.equal(first.sent.length, 1);

  const second = await run(fields, { ip });
  assert.equal(second.result.payload.ok, true);
  assert.equal(second.sent.length, 0);
});

test('browser (non-JSON) callers get redirects with status + rid', async () => {
  const ok = await run(validFields({ message: 'redirect check ok' }), { wantsJson: false });
  assert.equal(ok.result.kind, 'redirect');
  assert.equal(ok.result.status, 303);
  assert.match(ok.result.location, new RegExp(`^${SUCCESS_REDIRECT}\\?status=ok&rid=`));

  const bad = await run(validFields({ email: 'nope' }), { wantsJson: false });
  assert.equal(bad.result.status, 303);
  assert.match(bad.result.location, /^\/\?status=error&rid=/);
});

test('sender failure reports a friendly error', async () => {
  const sender = { async send() { throw new Error('smtp down'); } };
  const { result } = await run(validFields({ message: 'sender failure check' }), { sender });
  assert.equal(result.payload.ok, false);
  assert.match(result.payload.message, /could not send/i);
});

test('stub email sender logs instead of sending; unknown providers rejected', async () => {
  const logs = [];
  const stub = createEmailSender({}, (msg) => logs.push(msg));
  await stub.send({ to: 'info@baclogistics.co.za', subject: 'x' });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /email:stub/);

  assert.throws(() => createEmailSender({ EMAIL_PROVIDER: 'smtp' }, () => {}), /Unknown EMAIL_PROVIDER/);
  assert.throws(() => createEmailSender({ EMAIL_PROVIDER: 'pigeon' }, () => {}), /Unknown EMAIL_PROVIDER/);
});

// ---- Graph provider (BAC-9) ----

const GRAPH_ENV = {
  EMAIL_PROVIDER: 'graph',
  GRAPH_TENANT_ID: 'tenant-123',
  GRAPH_CLIENT_ID: 'client-456',
  GRAPH_CLIENT_SECRET: 'secret-789',
};

function graphMessage(overrides = {}) {
  return {
    to: 'rourke9001@gmail.com',
    from: 'donotreply@baclogistics.co.za',
    fromName: 'BAC Logistics',
    replyTo: 'jane@example.com',
    subject: 'BAC Logistics Contact Form',
    text: 'Name: Jane Tester',
    ...overrides,
  };
}

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const res = responses.shift();
    if (!res) throw new Error('fakeFetch: no response queued');
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      async json() { return res.body; },
      async text() { return JSON.stringify(res.body || ''); },
    };
  };
  return { calls, fetchImpl };
}

const TOKEN_OK = { status: 200, body: { access_token: 'tok-abc', expires_in: 3599 } };

test('graph provider requires all three credential settings', () => {
  assert.throws(
    () => createEmailSender({ EMAIL_PROVIDER: 'graph', GRAPH_TENANT_ID: 't' }, () => {}),
    /GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET/,
  );
});

test('graph send: client-credentials token then sendMail as the from mailbox', async () => {
  const { calls, fetchImpl } = fakeFetch([TOKEN_OK, { status: 202 }]);
  const sender = createEmailSender(GRAPH_ENV, () => {}, fetchImpl);
  await sender.send(graphMessage());

  assert.equal(calls.length, 2);

  const tokenCall = calls[0];
  assert.equal(tokenCall.url, 'https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token');
  const params = new URLSearchParams(tokenCall.options.body);
  assert.equal(params.get('grant_type'), 'client_credentials');
  assert.equal(params.get('client_id'), 'client-456');
  assert.equal(params.get('scope'), 'https://graph.microsoft.com/.default');

  const sendCall = calls[1];
  assert.equal(sendCall.url, 'https://graph.microsoft.com/v1.0/users/donotreply%40baclogistics.co.za/sendMail');
  assert.equal(sendCall.options.headers.Authorization, 'Bearer tok-abc');
  const body = JSON.parse(sendCall.options.body);
  assert.equal(body.message.subject, 'BAC Logistics Contact Form');
  assert.equal(body.message.toRecipients[0].emailAddress.address, 'rourke9001@gmail.com');
  assert.equal(body.message.replyTo[0].emailAddress.address, 'jane@example.com');
  assert.deepEqual(body.message.from.emailAddress, { address: 'donotreply@baclogistics.co.za', name: 'BAC Logistics' });
  assert.equal(body.message.body.content, 'Name: Jane Tester');
});

test('graph send reuses the cached token across sends', async () => {
  const { calls, fetchImpl } = fakeFetch([TOKEN_OK, { status: 202 }, { status: 202 }]);
  const sender = createEmailSender(GRAPH_ENV, () => {}, fetchImpl);
  await sender.send(graphMessage());
  await sender.send(graphMessage({ subject: 'second' }));
  assert.equal(calls.length, 3); // one token request, two sends
  assert.equal(calls[2].options.headers.Authorization, 'Bearer tok-abc');
});

test('graph send surfaces token and sendMail failures', async () => {
  const denied = fakeFetch([{ status: 401, body: { error: 'invalid_client' } }]);
  const sender1 = createEmailSender(GRAPH_ENV, () => {}, denied.fetchImpl);
  await assert.rejects(() => sender1.send(graphMessage()), /token request failed \(401\)/);

  const rejected = fakeFetch([TOKEN_OK, { status: 403, body: { error: { code: 'ErrorAccessDenied' } } }]);
  const sender2 = createEmailSender(GRAPH_ENV, () => {}, rejected.fetchImpl);
  await assert.rejects(() => sender2.send(graphMessage()), /sendMail failed \(403\)/);
});
