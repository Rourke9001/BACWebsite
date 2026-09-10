'use strict';

// The API now redirects a rejected submission back to the page it came from with
// ?status=error&reason=<code>, which initFormStatus() (site/inc/js/main.js) surfaces to
// the visitor. Native browser validation (required/type="email") is the first line of
// feedback before that round trip ever happens, so every shipped contact-form tag must
// keep novalidate off and keep its required/type attributes intact.

const { test } = require('node:test');
const assert = require('node:assert');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', '..', 'site');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return full.endsWith('.html') ? [full] : [];
  });
}

function findForms(html) {
  const forms = [];
  const formOpenRe = /<form\b[^>]*>/g;
  let match;
  while ((match = formOpenRe.exec(html))) {
    const openTag = match[0];
    const bodyStart = match.index + openTag.length;
    const closeIndex = html.indexOf('</form>', bodyStart);
    if (closeIndex === -1) continue;
    forms.push({ openTag, body: html.slice(bodyStart, closeIndex) });
  }
  return forms;
}

const pages = htmlFiles(SITE)
  .map((file) => ({ file, forms: findForms(readFileSync(file, 'utf8')) }))
  .map(({ file, forms }) => ({
    file,
    contactForms: forms.filter((form) => /action="\/api\/contact-form"/.test(form.openTag)),
  }))
  .filter(({ contactForms }) => contactForms.length > 0);

const allContactForms = pages.flatMap(({ file, contactForms }) =>
  contactForms.map((form) => ({ file, ...form })));

test('all 14 shipped contact forms are found by the scan', () => {
  assert.ok(allContactForms.length >= 14,
    `expected at least 14 contact forms, found ${allContactForms.length}`);
});

test('no contact form carries novalidate', () => {
  for (const { file, openTag } of allContactForms) {
    assert.doesNotMatch(openTag, /\bnovalidate\b/,
      `contact form still has novalidate in ${path.relative(SITE, file)}`);
  }
});

test('name, email and message controls are required, and email is type="email"', () => {
  for (const { file, body } of allContactForms) {
    const nameTag = (body.match(/<input[^>]*name="name"[^>]*>/) || [])[0];
    const emailTag = (body.match(/<input[^>]*name="email"[^>]*>/) || [])[0];
    const messageTag = (body.match(/<textarea[^>]*name="message"[^>]*>/) || [])[0];
    const where = path.relative(SITE, file);

    assert.ok(nameTag, `no name control in ${where}`);
    assert.match(nameTag, /\brequired\b/, `name control is optional in ${where}`);

    assert.ok(emailTag, `no email control in ${where}`);
    assert.match(emailTag, /\brequired\b/, `email control is optional in ${where}`);
    assert.match(emailTag, /type="email"/, `email control is not type="email" in ${where}`);

    assert.ok(messageTag, `no message control in ${where}`);
    assert.match(messageTag, /\brequired\b/, `message control is optional in ${where}`);
  }
});
