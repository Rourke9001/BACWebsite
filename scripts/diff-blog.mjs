// BAC-13 acceptance gate: compare every static blog page against the
// Function-rendered version. Usage:
//   node scripts/diff-blog.mjs https://<deployment-host>
// Fetches <base>/api/blog/<path> (works pre-cutover; post-cutover /blog/<path> too).
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.argv[2]?.replace(/\/$/, '');
if (!BASE) { console.error('usage: node scripts/diff-blog.mjs <base-url>'); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG = path.join(ROOT, 'site', 'blog');
const FOLDERS = ['road-freight', 'customs-clearing', 'mining-transport', 'liquor-transport'];

const grab = (html, re) => (html.match(re) || [])[1] ?? '';
const norm = (s) => s.replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const text = (html) => norm(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

function divInner(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return '';
  const start = m.index + m[0].length;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 1;
  for (let t; (t = re.exec(html)); ) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return '';
}

function postFacts(html) {
  const body = divInner(html, /<div class="gl-blog-article-body">/);
  return {
    title_tag: text(grab(html, /<title>([\s\S]*?)<\/title>/)),
    canonical: grab(html, /<link rel="canonical" href="([^"]*)"/),
    description: grab(html, /<meta name="description" content="([^"]*)"/),
    og_image: grab(html, /<meta property="og:image" content="([^"]*)"/),
    h1: text(grab(html, /<h1 class="gl-blog-article-title">([\s\S]*?)<\/h1>/)),
    date: norm(grab(html, /<span class="gl-blog-article-date">([\s\S]*?)<\/span>/)),
    tags: text(grab(html, /<p class="gl-blog-article-tags">([\s\S]*?)<\/p>/)),
    featured: grab(divInner(html, /<div class="gl-blog-article-image">/), /src="([^"]*)"/),
    body_text: text(body),
    body_images: [...body.matchAll(/src="([^"]*)"/g)].map((m) => m[1]).join(' '),
    youtube: grab(html, /youtube\.com\/embed\/([A-Za-z0-9_-]+)/),
  };
}

function listingFacts(html) {
  const cards = [];
  for (const m of html.matchAll(/<article class="gl-blog-card">([\s\S]*?)<\/article>/g)) {
    cards.push({
      href: grab(m[1], /href="([^"]+)"/),
      title: text(grab(m[1], /<h2 class="gl-blog-card-title">([\s\S]*?)<\/h2>/)),
      meta: text(divInner(m[1], /<div class="gl-blog-card-meta">/)),
    });
  }
  const pagination = [...(divInner(html, /<div class="pagination">/) || '')
    .matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(' ');
  return { cards: JSON.stringify(cards), pagination };
}

let failures = 0;
async function compare(label, urlPath, factsFn) {
  try {
    const staticFile = urlPath === '/blog/' ? path.join(BLOG, 'index.html')
      : urlPath.startsWith('/blog/pg/') ? path.join(BLOG, 'pg', urlPath.split('/')[3], 'index.html')
      : path.join(BLOG, ...urlPath.replace('/blog/', '').split('/'));
    const expected = factsFn(await readFile(staticFile, 'utf8'));
    const res = await fetch(`${BASE}/api${urlPath}`, { redirect: 'manual' });
    if (res.status !== 200) { console.log(`FAIL ${label}: HTTP ${res.status}`); failures++; return; }
    const actual = factsFn(await res.text());
    const diffs = Object.keys(expected).filter((k) => expected[k] !== actual[k]);
    if (diffs.length) {
      failures++;
      console.log(`FAIL ${label}`);
      for (const k of diffs) console.log(`  ${k}\n    static:   ${String(expected[k]).slice(0, 200)}\n    rendered: ${String(actual[k]).slice(0, 200)}`);
    } else {
      console.log(`ok   ${label}`);
    }
  } catch (err) {
    failures++;
    console.log(`FAIL ${label}: ${err.message}`);
  }
}

// Post pages
async function* postPaths() {
  for (const entry of await readdir(BLOG, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html') && entry.name !== 'index.html') yield `/blog/${entry.name}`;
    if (entry.isDirectory() && FOLDERS.includes(entry.name)) {
      for (const f of await readdir(path.join(BLOG, entry.name))) {
        if (f.endsWith('.html')) yield `/blog/${entry.name}/${f}`;
      }
    }
  }
}

for await (const p of postPaths()) await compare(p, p, postFacts);
await compare('/blog/', '/blog/', listingFacts);
for (let n = 1; n <= 8; n++) await compare(`/blog/pg/${n}/`, `/blog/pg/${n}/`, listingFacts);

console.log(failures ? `\n${failures} FAILURES` : '\nALL PAGES MATCH');
process.exit(failures ? 1 : 0);
