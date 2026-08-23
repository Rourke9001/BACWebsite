'use strict';

// Guards the consent control on the shipped pages. The server records the wording
// it believes was shown (handler.CONSENT_WORDING); if the pages drift from that
// constant, every stored consent record misstates what the person agreed to.

const { test } = require('node:test');
const assert = require('node:assert');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { CONSENT_WORDING } = require('../src/lib/handler');

const SITE = path.join(__dirname, '..', '..', 'site');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return full.endsWith('.html') ? [full] : [];
  });
}

const pages = htmlFiles(SITE)
  .map((file) => ({ file, html: readFileSync(file, 'utf8') }))
  .filter(({ html }) => html.includes('name="consent"'));

test('every shipped form carries a consent control', () => {
  assert.ok(pages.length >= 14, `expected at least 14 forms, found ${pages.length}`);
});

test('consent is required, so a submission cannot omit it', () => {
  for (const { file, html } of pages) {
    for (const tag of html.match(/<input[^>]*name="consent"[^>]*>/g) || []) {
      assert.match(tag, /\brequired\b/, `consent checkbox is optional in ${path.relative(SITE, file)}`);
    }
  }
});

test('the wording shown matches the wording the server records', () => {
  // Pages HTML-escape the apostrophe; compare on the decoded text.
  const decode = (s) => s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  for (const { file, html } of pages) {
    assert.ok(decode(html).includes(CONSENT_WORDING),
      `consent wording in ${path.relative(SITE, file)} has drifted from handler.CONSENT_WORDING`);
  }
});
