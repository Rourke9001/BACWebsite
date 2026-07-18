#!/usr/bin/env node
/**
 * Verify a deployed copy of site/ (staging, a PR preview, or eventually prod):
 * every page loads, every same-site reference on every page resolves, the
 * configured redirects + 404 page behave, and the downloadable docs serve
 * with the right content-type. Zero dependencies, mirrors mirror.mjs's style.
 *
 * The static page list comes straight from the site/ filesystem (not
 * sitemap.xml, which is incomplete); the dynamic blog pages (BAC-13, served
 * from Blob Storage via the Function) are enumerated from the live
 * /sitemap-blog.xml instead, since they no longer exist on disk. Redirects
 * and mimeTypes come from staticwebapp.config.json at runtime — nothing
 * about the site is hardcoded, so this keeps working as pages/redirects
 * change and is reusable as-is for a future production cutover check (BAC-16).
 *
 * Usage: node scripts/verify-site.mjs [base-url]
 * Exit code 0 = all clean, 1 = something failed (see report).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE = 'https://ambitious-bush-084cda303.7.azurestaticapps.net';
const BASE = new URL(process.argv[2] || DEFAULT_BASE);
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const UA = 'BACWebsite-verify/1.0 (owner-authorised site migration)';
const CONCURRENCY = 6;
const MAX_REDIRECTS = 5;

// Domains a mirrored page is expected to reference besides itself. The legacy
// prod host is kept absolute in canonical/OG/JSON-LD tags by design (see
// mirror.mjs's rewriteHtml); the rest are third-party CDNs/embeds/social
// links. Anything NOT here is treated as a bug — this is exactly the check
// that would have caught the gcz.co.za incident (BAC-12).
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'baclogistics.co.za', 'www.baclogistics.co.za',
  'cdn.jsdelivr.net', 'code.jquery.com',
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'www.googletagmanager.com',
  'img.youtube.com', 'www.youtube.com', 'www.youtube-nocookie.com',
  'www.facebook.com', 'www.instagram.com', 'www.linkedin.com',
  'wa.me', 'share.google', 'www.google.com', 'maps.google.com', 'www.multi.co.za',
]);

async function walkHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Inverse of mirror.mjs's outPath(): local site/ file -> URL path. */
function toUrlPath(file) {
  const rel = path.relative(SITE, file).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel;
}

function extractRefs(html) {
  const found = [];
  for (const m of html.matchAll(/\b(?:href|src|poster|data-src)\s*=\s*("[^"]*"|'[^']*')/gi)) {
    found.push(m[1].slice(1, -1));
  }
  for (const m of html.matchAll(/\bsrcset\s*=\s*("[^"]*"|'[^']*')/gi)) {
    for (const part of m[1].slice(1, -1).split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) found.push(u);
    }
  }
  for (const m of html.matchAll(/<meta[^>]+content\s*=\s*("https?:[^"]*"|'https?:[^']*')[^>]*>/gi)) {
    found.push(m[1].slice(1, -1));
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi)) found.push(m[1]);
  return found;
}

function extractCssRefs(css) {
  const found = [];
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi)) found.push(m[1]);
  for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) found.push(m[1]);
  return found;
}

function resolve(raw, baseUrl) {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || /^(mailto:|tel:|javascript:|data:|#)/i.test(v)) return null;
  try { return new URL(v, baseUrl); } catch { return null; }
}

/** Follow redirects manually (capped) so we can assert the final hop lands same-origin + ok. */
async function fetchFollow(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current.href, {
      headers: { 'user-agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error(`>${MAX_REDIRECTS} redirects starting from ${url.href}`);
}

// BAC-13: blog pages are dynamic (blob-backed); enumerate them from the live
// blog sitemap instead of the filesystem, plus derived pagination pages.
async function blogUrls(base) {
  let res;
  try {
    res = await fetch(new URL('/sitemap-blog.xml', base), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(`sitemap-blog.xml: fetch failed — ${e.message}`);
  }
  if (!res.ok) throw new Error(`sitemap-blog.xml: HTTP ${res.status}`);
  const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const postCount = locs.filter((p) => p.endsWith('.html')).length;
  for (let n = 1; n <= Math.max(1, Math.ceil(postCount / 12)); n++) locs.push(`/blog/pg/${n}/`);
  return locs;
}

async function pool(items, worker, concurrency = CONCURRENCY) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await worker(item);
      await new Promise(r => setTimeout(r, 40)); // pace requests, matches mirror.mjs's politeness delay
    }
  }));
}

async function main() {
  console.log(`Verifying ${BASE.href}\n`);
  const config = JSON.parse(await readFile(path.join(SITE, 'staticwebapp.config.json'), 'utf8'));
  const brokenPages = [];
  const brokenRefs = new Map(); // href -> { reason, pages: Set }
  const addBrokenRef = (href, reason, page) => {
    let e = brokenRefs.get(href);
    if (!e) { e = { reason, pages: new Set() }; brokenRefs.set(href, e); }
    e.pages.add(page);
  };

  // --- Redirects + 404 (config-driven, not hardcoded) ---
  let redirectsOk = 0, redirectsFail = 0;
  for (const route of config.routes || []) {
    if (!route.redirect) continue;
    const target = new URL(route.route, BASE);
    const res = await fetch(target.href, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const loc = res.headers.get('location');
    const wantStatus = route.statusCode || 301;
    const gotTargetPath = loc ? new URL(loc, target).pathname : null;
    if (res.status === wantStatus && gotTargetPath === route.redirect) redirectsOk++;
    else { redirectsFail++; brokenPages.push(`redirect ${route.route} -> expected ${wantStatus} to ${route.redirect}, got ${res.status} Location:${loc}`); }
  }
  const notFoundRes = await fetch(new URL('/__bac12-verify-404-check__/', BASE).href, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  const notFoundBody = await notFoundRes.text();
  const notFoundOk = notFoundRes.status === 404 && notFoundBody.includes('Page Not Found | BAC Logistics');
  if (!notFoundOk) brokenPages.push(`404 check -> HTTP ${notFoundRes.status}, expected branded 404.html body`);

  // --- /admin/ is auth-guarded (blog_author): anonymous GET must land on the Entra login ---
  const adminRes = await fetch(new URL('/admin/', BASE).href, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const adminOk = adminRes.redirected && new URL(adminRes.url).hostname === 'login.microsoftonline.com';
  if (!adminOk) brokenPages.push(`/admin/ auth guard -> expected redirect to login.microsoftonline.com, got HTTP ${adminRes.status} at ${adminRes.url}`);

  // --- site/files/ downloadable docs ---
  const mimeMap = config.mimeTypes || {};
  const fileNames = await readdir(path.join(SITE, 'files'));
  let filesOk = 0, filesFail = 0;
  await pool(fileNames, async (name) => {
    const target = new URL('/files/' + encodeURIComponent(name), BASE);
    const res = await fetch(target.href, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    const ext = path.extname(name).toLowerCase();
    const ctype = res.headers.get('content-type') || '';
    const expected = mimeMap[ext];
    if (res.ok && (!expected || ctype.startsWith(expected))) filesOk++;
    else { filesFail++; brokenPages.push(`/files/${name} -> HTTP ${res.status}, content-type "${ctype}" (expected ${expected || 'any 2xx'})`); }
  });

  // --- Discover + fetch every page straight from disk, plus the dynamic blog ---
  const pageFiles = await walkHtml(SITE);
  // /admin/* is role-guarded and checked above as the auth-guard probe, not as a public page.
  const urls = pageFiles.map(toUrlPath).filter((u) => !u.startsWith('/admin/'));
  urls.push(...await blogUrls(BASE));
  const pages = urls.map(urlPath => ({ urlPath })).sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  let pagesOk = 0, pagesFail = 0;
  const refsByPage = new Map(); // page.urlPath -> raw refs[]

  await pool(pages, async (page) => {
    const target = new URL(page.urlPath, BASE);
    let res;
    try {
      res = await fetch(target.href, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    } catch (e) {
      pagesFail++; brokenPages.push(`${page.urlPath} -> ${e.message}`); return;
    }
    if (!res.ok) { pagesFail++; brokenPages.push(`${page.urlPath} -> HTTP ${res.status}`); return; }
    if (res.redirected) { pagesFail++; brokenPages.push(`${page.urlPath} -> unexpectedly redirected to ${res.url}`); return; }
    pagesOk++;
    const ctype = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (ctype === 'text/html') refsByPage.set(page.urlPath, extractRefs(await res.text()));
  });

  // --- Resolve + de-dupe every same-site reference across all pages, check each exactly once ---
  const refPages = new Map(); // href -> Set(referencing page paths)
  let externalCount = 0;
  for (const [pagePath, raws] of refsByPage) {
    const pageUrl = new URL(pagePath, BASE);
    for (const raw of raws) {
      const u = resolve(raw, pageUrl);
      if (!u) continue;
      if (u.hostname !== BASE.hostname) {
        if (ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) externalCount++;
        else addBrokenRef(u.href, 'disallowed external domain', pagePath);
        continue;
      }
      u.hash = '';
      if (!refPages.has(u.href)) refPages.set(u.href, new Set());
      refPages.get(u.href).add(pagePath);
    }
  }

  let refsOk = 0, refsFail = 0;
  const cssToScan = [];
  await pool([...refPages.entries()], async ([href, referencingPages]) => {
    const u = new URL(href);
    try {
      const { res, finalUrl } = await fetchFollow(u);
      if (finalUrl.hostname !== BASE.hostname || !res.ok) {
        refsFail++;
        for (const p of referencingPages) addBrokenRef(href, `HTTP ${res.status}`, p);
        return;
      }
      refsOk++;
      const ctype = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (ctype === 'text/css' || /\.css$/i.test(finalUrl.pathname)) {
        cssToScan.push({ href, text: await res.text(), referencingPages });
      }
    } catch (e) {
      refsFail++;
      for (const p of referencingPages) addBrokenRef(href, e.message, p);
    }
  });

  // One extra hop for CSS-embedded refs (fonts, background images, @import)
  const cssRefPages = new Map();
  for (const { href, text, referencingPages } of cssToScan) {
    const cssUrl = new URL(href);
    for (const raw of extractCssRefs(text)) {
      const u = resolve(raw, cssUrl);
      if (!u) continue;
      if (u.hostname !== BASE.hostname) {
        if (ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) externalCount++;
        else for (const p of referencingPages) addBrokenRef(u.href, 'disallowed external domain', `${p} (via ${cssUrl.pathname})`);
        continue;
      }
      if (refPages.has(u.href)) continue; // already checked as a direct page reference
      if (!cssRefPages.has(u.href)) cssRefPages.set(u.href, new Set());
      for (const p of referencingPages) cssRefPages.get(u.href).add(`${p} (via ${cssUrl.pathname})`);
    }
  }
  await pool([...cssRefPages.entries()], async ([href, referencingPages]) => {
    const u = new URL(href);
    try {
      const { res, finalUrl } = await fetchFollow(u);
      if (finalUrl.hostname !== BASE.hostname || !res.ok) {
        refsFail++;
        for (const p of referencingPages) addBrokenRef(href, `HTTP ${res.status}`, p);
      } else refsOk++;
    } catch (e) {
      refsFail++;
      for (const p of referencingPages) addBrokenRef(href, e.message, p);
    }
  });

  // --- Report ---
  console.log(`Pages:     ${pagesOk} ok, ${pagesFail} fail (of ${pages.length} discovered on disk + live blog sitemap)`);
  console.log(`Redirects: ${redirectsOk} ok, ${redirectsFail} fail`);
  console.log(`404 page:  ${notFoundOk ? 'ok' : 'FAIL'}`);
  console.log(`Admin:     ${adminOk ? 'auth guard ok' : 'FAIL'}`);
  console.log(`Files:     ${filesOk} ok, ${filesFail} fail (of ${fileNames.length} in site/files/)`);
  console.log(`Refs:      ${refsOk} ok, ${refsFail} fail, ${externalCount} external (allowlisted, not fetched)`);

  if (brokenPages.length) {
    console.log(`\nBROKEN PAGES/CHECKS (${brokenPages.length}):`);
    for (const b of brokenPages) console.log(`  ${b}`);
  }
  if (brokenRefs.size) {
    console.log(`\nBROKEN REFERENCES (${brokenRefs.size} unique):`);
    for (const [href, { reason, pages }] of brokenRefs) {
      console.log(`  ${href} — ${reason}`);
      for (const p of pages) console.log(`      <- ${p}`);
    }
  }

  const clean = pagesFail === 0 && redirectsFail === 0 && notFoundOk && adminOk && filesFail === 0 && brokenRefs.size === 0;
  console.log(clean ? '\nAll checks passed.' : '\nFAILED — see above.');
  process.exitCode = clean ? 0 : 1;
}

main().catch(e => { console.error(e); process.exit(1); });
