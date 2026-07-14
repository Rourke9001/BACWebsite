#!/usr/bin/env node
/**
 * Mirror baclogistics.co.za into site/ as a static snapshot (BAC-6).
 *
 * - Seeds from the live sitemap.xml plus known unlisted pages.
 * - Follows same-host page links and downloads all same-host assets
 *   (incl. /couch/uploads/ images and CSS url() refs).
 * - Query-string pagination (/blog/?pg=2) is materialised as /blog/pg/2/
 *   and pagination links are rewritten to match (static hosts ignore
 *   query strings).
 * - Same-host absolute URLs are rewritten to root-relative so the site
 *   works on the SWA staging URL — EXCEPT canonical/alternate links,
 *   og:/twitter: meta tags and JSON-LD, which must stay absolute.
 * - E-commerce/CMS routes are never crawled as pages (dead, unlaunched).
 *
 * Usage: node scripts/mirror.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://baclogistics.co.za';
const HOSTS = new Set(['baclogistics.co.za', 'www.baclogistics.co.za']);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const UA = 'BACWebsite-mirror/1.0 (owner-authorised site migration)';
const CONCURRENCY = 4;

// Never crawl these as pages (unlaunched e-commerce, CMS admin, dead search)
const EXCLUDED_PAGE_PREFIXES = [
  '/cart', '/checkout', '/products', '/product-search', '/orders',
  '/payment-success', '/payment-cancel', '/blog-search', '/couch/',
];

const ASSET_EXT = /\.(png|jpe?g|webp|gif|svg|ico|css|js|mjs|xml|txt|webmanifest|json|woff2?|ttf|otf|eot|mp4|webm|pdf|xlsx?|docx?|pptx?|csv|zip)$/i;

const SEEDS = [
  '/', '/information/thank-you.html', '/robots.txt', '/favicon.ico',
  '/sitemap.xml', '/site.webmanifest',
  '/android-chrome-192x192.png', '/android-chrome-512x512.png',
];

const queue = [];
const seen = new Set();
const saved = { pages: 0, assets: 0 };
const failures = [];
const skippedQueries = new Set();

function enqueue(url) {
  const key = url.href;
  if (seen.has(key)) return;
  seen.add(key);
  queue.push(url);
}

/** Normalise a discovered reference; returns URL or null if out of scope. */
function normalise(raw, baseUrl) {
  if (!raw) return null;
  const v = raw.trim();
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(v)) return null;
  let u;
  try { u = new URL(v, baseUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !HOSTS.has(u.hostname)) return null;
  u.hash = '';
  u.protocol = 'https:';
  u.hostname = 'baclogistics.co.za';
  // Canonicalise extensionless page URLs to their trailing-slash form
  // (/about → /about/) so they don't collide with the directory on disk.
  const last = u.pathname.split('/').pop();
  if (last && !last.includes('.') && !u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

function isAsset(u) { return ASSET_EXT.test(u.pathname); }

function isExcludedPage(u) {
  return EXCLUDED_PAGE_PREFIXES.some(p =>
    u.pathname === p || u.pathname.startsWith(p.endsWith('/') ? p : p + '/') || u.pathname.startsWith(p + '.'));
}

/** Map a URL to an output file path, or null if unrepresentable. */
function outPath(u) {
  let p = u.pathname;
  if (u.search) {
    const m = u.search.match(/^\?pg=(\d+)$/);
    if (m && p.endsWith('/')) p = `${p}pg/${m[1]}/`;
    else if (isAsset(u)) { /* cache-buster query: strip */ }
    else { skippedQueries.add(u.href); return null; }
  }
  if (p.endsWith('/')) p += 'index.html';
  const segs = p.split('/').filter(Boolean).map(s => decodeURIComponent(s));
  if (segs.some(s => s === '..' || s === '.')) return null;
  return path.join(OUT, ...segs);
}

/** Extract same-host references from HTML; enqueue them. */
function extractFromHtml(html, baseUrl) {
  const found = [];
  for (const m of html.matchAll(/\b(?:href|src|action|poster|data-src)\s*=\s*("[^"]*"|'[^']*')/gi)) {
    found.push(m[1].slice(1, -1));
  }
  for (const m of html.matchAll(/\bsrcset\s*=\s*("[^"]*"|'[^']*')/gi)) {
    for (const part of m[1].slice(1, -1).split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) found.push(url);
    }
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi)) found.push(m[1]);
  // og:image / twitter:image content URLs still need downloading
  for (const m of html.matchAll(/<meta[^>]+content\s*=\s*("https?:[^"]*"|'https?:[^']*')[^>]*>/gi)) {
    found.push(m[1].slice(1, -1));
  }
  for (const raw of found) {
    const u = normalise(raw, baseUrl);
    if (!u) continue;
    if (!isAsset(u) && isExcludedPage(u)) continue;
    enqueue(u);
  }
}

function extractFromCss(css, baseUrl) {
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi)) {
    const u = normalise(m[1], baseUrl);
    if (u) enqueue(u);
  }
  for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) {
    const u = normalise(m[1], baseUrl);
    if (u) enqueue(u);
  }
}

const HOST_RE = /https?:\/\/(?:www\.)?baclogistics\.co\.za(?=[\/"'\s)])/gi;
const PAGINATE_RE = /((?:href|src|action)\s*=\s*["'][^"']*\/)\?pg=(\d+)/gi;

/** Rewrite HTML: root-relative links + path-based pagination, preserving SEO tags. */
function rewriteHtml(html) {
  const protectedBlocks = [];
  const protect = (re) => {
    html = html.replace(re, (block) => {
      protectedBlocks.push(block);
      return `\x00P${protectedBlocks.length - 1}\x00`;
    });
  };
  protect(/<link[^>]+rel\s*=\s*["'](?:canonical|alternate)["'][^>]*>/gi);
  protect(/<meta[^>]+(?:property|name)\s*=\s*["'](?:og:|twitter:)[^>]*>/gi);
  protect(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi);
  html = html.replace(HOST_RE, '');
  html = html.replace(PAGINATE_RE, (_, pre, n) => `${pre}pg/${n}/`);
  html = html.replace(/\x00P(\d+)\x00/g, (_, i) => protectedBlocks[+i]);
  return html;
}

function rewriteCss(css) { return css.replace(HOST_RE, ''); }

async function fetchWithRetry(u) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(u.href, {
        headers: { 'user-agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function processUrl(u) {
  const file = outPath(u);
  if (!file) return;
  let res;
  try { res = await fetchWithRetry(u); }
  catch (e) { failures.push(`${u.href} — ${e.message}`); return; }
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  await mkdir(path.dirname(file), { recursive: true });
  if (type === 'text/html') {
    const html = await res.text();
    extractFromHtml(html, u);
    await writeFile(file, rewriteHtml(html));
    saved.pages++;
  } else if (type === 'text/css' || /\.css$/i.test(u.pathname)) {
    const css = await res.text();
    extractFromCss(css, u);
    await writeFile(file, rewriteCss(css));
    saved.assets++;
  } else {
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    saved.assets++;
  }
}

async function main() {
  // Seed from live sitemap
  const smRes = await fetch(`${ORIGIN}/sitemap.xml`, { headers: { 'user-agent': UA } });
  const sm = await smRes.text();
  for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = normalise(m[1], ORIGIN);
    if (u && !isExcludedPage(u)) enqueue(u);
  }
  for (const s of SEEDS) enqueue(new URL(s, ORIGIN));

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const u = queue.shift();
      if (u) await processUrl(u);
      await new Promise(r => setTimeout(r, 60));
    }
  });
  // Workers may drain while extraction adds more; loop until truly done
  let active = true;
  while (active) {
    await Promise.all(workers.splice(0));
    if (queue.length) {
      workers.push(...Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
          const u = queue.shift();
          if (u) await processUrl(u);
          await new Promise(r => setTimeout(r, 60));
        }
      }));
    } else active = false;
  }

  console.log(`\nMirror complete → ${OUT}`);
  console.log(`Pages saved:  ${saved.pages}`);
  console.log(`Assets saved: ${saved.assets}`);
  if (skippedQueries.size) {
    console.log(`\nSkipped query-string URLs (${skippedQueries.size}):`);
    for (const q of skippedQueries) console.log(`  ${q}`);
  }
  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
