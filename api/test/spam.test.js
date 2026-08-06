'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const spam = require('../src/lib/spam');

const NOW = 2_000_000_000;

test('timestamp bounds reject too-fast, stale and unparseable stamps', () => {
  assert.equal(spam.timestampSuspect({ form_ts: String(NOW - 60) }, NOW), null);
  assert.equal(spam.timestampSuspect({ form_ts: String(NOW - 1) }, NOW), 'too_fast');
  assert.equal(spam.timestampSuspect({ form_ts: String(NOW - spam.MAX_FORM_AGE_SEC - 1) }, NOW), 'stale');
  assert.equal(spam.timestampSuspect({ form_ts: '' }, NOW), 'missing');
  assert.equal(spam.timestampSuspect({ form_ts: 'abc' }, NOW), 'missing');
  assert.equal(spam.timestampSuspect({}, NOW), 'missing');
});

test('a stamp right on each boundary is accepted', () => {
  assert.equal(spam.timestampSuspect({ form_ts: String(NOW - spam.MIN_FILL_SECONDS) }, NOW), null);
  assert.equal(spam.timestampSuspect({ form_ts: String(NOW - spam.MAX_FORM_AGE_SEC) }, NOW), null);
});

test('the two observed spam payloads score above the threshold', () => {
  const first = spam.score({
    phone: '83461666195',
    company: 'google',
    message_subject: 'Hallo    write about your   price for reseller',
    message: 'Hi, I wanted to know your price.',
  });
  assert.ok(spam.isSpamByScore(first), `expected block, got ${first.score} (${first.signals})`);

  const second = spam.score({
    phone: '88392631456',
    company: 'google',
    message_subject: 'Aloha  i writing about     price',
    message: 'Hai, saya ingin tahu harga Anda.',
  });
  assert.ok(spam.isSpamByScore(second), `expected block, got ${second.score} (${second.signals})`);
});

test('realistic enquiries score clean', () => {
  const enquiries = [
    {
      phone: '0821234567', company: 'Acme Freight',
      message_subject: 'Customs clearing quote',
      message: 'We need help clearing machinery at Durban harbour. Please advise on cost.',
    },
    {
      phone: '+27 11 234 5678', company: 'Mining Supplies SA',
      message_subject: 'Cross-border transport to Zambia',
      message: 'Looking for a quote on road freight to Lusaka, roughly 20 tonnes monthly.',
    },
    {
      phone: '27821234567', company: '',
      message_subject: 'Price enquiry',
      message: 'Hi, I wanted to know your price for bonded warehousing.',
    },
  ];

  for (const fields of enquiries) {
    const result = spam.score(fields);
    assert.ok(!spam.isSpamByScore(result), `false positive: ${result.score} (${result.signals})`);
  }
});

test('no single signal is enough to block on its own', () => {
  const singles = [
    { phone: '83461666195' },
    { company: 'google' },
    { message_subject: 'Hallo there' },
    { message_subject: 'Quote    please' },
    { message: 'Здравствуйте, мне нужна помощь с грузом.' },
    { message: 'I wanted to know your price.' },
  ];

  for (const fields of singles) {
    const result = spam.score(fields);
    assert.ok(!spam.isSpamByScore(result), `single signal blocked: ${result.score} (${result.signals})`);
  }
});

test('honeypot, disposable domains and link flooding still fire', () => {
  assert.equal(spam.honeypotTriggered({ [spam.HONEYPOT_FIELD]: 'http://spam.example' }), true);
  assert.equal(spam.honeypotTriggered({ [spam.HONEYPOT_FIELD]: '  ' }), false);

  assert.equal(spam.blockedEmailDomain('bot@Mailinator.com'), true);
  assert.equal(spam.blockedEmailDomain('jane@example.com'), false);

  const links = Array.from({ length: 6 }, (_, i) => `http://s${i}.example`).join(' ');
  assert.equal(spam.tooManyLinks(links), true);
  assert.equal(spam.tooManyLinks('one http://a.example link'), false);
});
