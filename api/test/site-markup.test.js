'use strict';

// Guards the front-end defects fixed in the August 2026 digital-estate remediation.
// Each test pins one defect so it cannot silently return via a page edit.

const { test } = require('node:test');
const assert = require('node:assert');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { buildFaqSchema } = require('../src/lib/faq-schema');

const SITE = path.join(__dirname, '..', '..', 'site');

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return full.endsWith('.html') ? [full] : [];
  });
}

const pages = htmlFiles(SITE)
  .filter((f) => !f.includes(`${path.sep}admin${path.sep}`))
  .map((file) => ({ rel: path.relative(SITE, file), html: readFileSync(file, 'utf8') }));

test('tel: links are international — a local-format number will not dial from abroad', () => {
  for (const { rel, html } of pages) {
    for (const href of html.match(/tel:[^"']+/g) || []) {
      assert.match(href, /^tel:\+/, `${rel} carries a local-format number: ${href}`);
    }
  }
});

// SEO brief, Aug 2026: leads@ideation.co.za counts leads, so a visitor who clicks an
// address must open a composer with that mailbox already in BCC. The forms carry the
// same copy server-side — see api/test/handler.test.js.
test('every mailto: link pre-fills the lead-tracking BCC', () => {
  let found = 0;
  for (const { rel, html } of pages) {
    for (const href of html.match(/mailto:[^"']+/g) || []) {
      assert.ok(href.includes('?bcc=leads@ideation.co.za'),
        `${rel} has a mailto without the lead BCC: ${href}`);
      found += 1;
    }
  }
  assert.ok(found >= 16, `expected the 16 known mailto links, found ${found}`);
});

test('no placeholder alt text survives', () => {
  for (const { rel, html } of pages) {
    assert.ok(!html.includes('alt="alt"'), `${rel} renders placeholder alt text on screen`);
  }
});

test('YouTube embeds carry a single query string, so rel=0 is honoured', () => {
  // "?si=XXX?rel=0" folds rel=0 into the si value; YouTube then ignores it and
  // shows competitors' videos in the end screen.
  for (const { rel, html } of pages) {
    for (const url of html.match(/https:\/\/www\.youtube[^"']*/g) || []) {
      assert.ok(url.split('?').length <= 2, `${rel} has a double query string: ${url}`);
    }
  }
});

// Deleting this tag un-verifies the Search Console property and silently stops the
// performance data the SEO work is measured on. It is one line, so it is easy to lose
// in a homepage edit — hence a test rather than a comment.
test('the homepage still carries the Google Search Console verification tag', () => {
  const home = pages.find((p) => p.rel === 'index.html');
  assert.match(home.html,
    /<meta name="google-site-verification" content="MT2UTR0nIg-agVuktScp68_-MIDQs4eu2daVYQXTNWc" \/>/);
});

test('homepage counters ship their final value, not a literal 0', () => {
  const home = pages.find((p) => p.rel === 'index.html');
  const counters = home.html.match(/data-counter-target="([^"]+)">([^<]*)</g) || [];
  assert.ok(counters.length >= 3, 'expected the three homepage counters');
  for (const c of counters) {
    const [, target, rendered] = c.match(/data-counter-target="([^"]+)">([^<]*)</);
    assert.strictEqual(rendered, target,
      `counter renders "${rendered}" to crawlers and no-JS readers, not "${target}"`);
  }
});

test('every indexable page has a purpose-written meta description', () => {
  for (const { rel, html } of pages) {
    if (rel === '404.html') continue; // an error page is not a search result
    const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
    assert.ok(m, `${rel} has no meta description`);
    const desc = m[1];
    assert.ok(desc.length >= 120, `${rel} description is ${desc.length} chars — too thin to be useful`);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
    assert.notStrictEqual(desc.trim(), title.trim(), `${rel} description just repeats its title`);
  }
});

test('social descriptions match the page description rather than repeating the title', () => {
  for (const { rel, html } of pages) {
    const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [, null])[1];
    if (!desc) continue;
    for (const re of [/<meta\s+property="og:description"\s+content="([^"]*)"/,
      /<meta\s+name="twitter:description"\s+content="([^"]*)"/]) {
      const found = html.match(re);
      if (found) assert.strictEqual(found[1], desc, `${rel} social description is out of sync`);
    }
  }
});

test('every chrome-bearing page carries Organization structured data', () => {
  const withChrome = pages.filter((p) => p.html.includes('<!-- @chrome:head-meta -->'));
  assert.ok(withChrome.length >= 37, `expected 37+ chrome pages, found ${withChrome.length}`);
  for (const { rel, html } of withChrome) {
    const block = html.match(/<!-- @chrome:org-schema -->([\s\S]*?)<!-- @end:org-schema -->/);
    assert.ok(block, `${rel} has no Organization schema`);
    const json = block[1].match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(json[1]);
    assert.strictEqual(parsed['@type'], 'Organization');
    assert.match(parsed.contactPoint.telephone, /^\+27/);
  }
});

// scripts/build-sitemap.mjs derives sitemap-static.xml from the pages themselves.
// Re-deriving the expected URL set here means a new page, a rename, or a page turned
// noindex fails the suite rather than quietly going missing from search — which is
// exactly the drift that left the hand-made sitemap a video-hub page short.
test('sitemap-static.xml lists exactly the pages that ask to be indexed', () => {
  const xml = readFileSync(path.join(SITE, 'sitemap-static.xml'), 'utf8');
  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  const expected = [];
  for (const { html } of pages) {
    const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/);
    if (robots && /noindex/i.test(robots[1])) continue;
    const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/);
    if (canonical) expected.push(canonical[1]);
  }
  for (const file of readdirSync(path.join(SITE, 'files'))) {
    expected.push(`https://baclogistics.co.za${encodeURI(`/files/${file}`)}`);
  }

  assert.deepStrictEqual(listed.slice().sort(), expected.sort(),
    'sitemap-static.xml is stale — run `npm run build:sitemap`');
  assert.deepStrictEqual(listed, listed.slice().sort(), 'entries are not in sorted order');
});

test('the About FAQ schema still matches the accordion it describes', () => {
  const about = pages.find((p) => p.rel === path.join('about', 'index.html'));
  const block = about.html.match(/<!-- @faq-schema[\s\S]*?<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(block, 'About page has no FAQPage schema');
  assert.deepStrictEqual(JSON.parse(block[1]), buildFaqSchema(about.html),
    'FAQPage schema is stale — run `npm run build:faq-schema`');
});
