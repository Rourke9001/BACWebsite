// One-off BAC-13 migration: parse each static blog post page in site/blog/
// into a post JSON blob (schema: docs/superpowers/plans/2026-07-17-bac13-dynamic-blog.md).
// Zero dependencies, mirrors the mirror.mjs style. Usage:
//   node scripts/migrate-blog.mjs          # writes scripts/out/blog-posts/*.json + report
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG = path.join(ROOT, 'site', 'blog');
const OUT = path.join(ROOT, 'scripts', 'out', 'blog-posts');
const FOLDERS = ['road-freight', 'customs-clearing', 'mining-transport', 'liquor-transport'];
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const warnings = [];
const warn = (slug, msg) => warnings.push(`${slug}: ${msg}`);

// --- helpers -------------------------------------------------------------
const grab = (html, re) => (html.match(re) || [])[1] ?? '';

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

// Inner HTML of the first div matched by openRe, honoring nested divs.
function divInner(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 1;
  for (let t; (t = re.exec(html)); ) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return null;
}

function toIsoDate(text, slug) {
  const m = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) { warn(slug, `unparseable date "${text}"`); return '1970-01-01'; }
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// --- card map (author/excerpt/order come from the listing pages) ---------
async function buildCardMap() {
  const map = new Map(); // href -> { author, excerpt, order }
  const listingFiles = [path.join(BLOG, 'index.html')];
  for (let n = 2; n <= 8; n++) listingFiles.push(path.join(BLOG, 'pg', String(n), 'index.html'));
  let order = 0;
  for (const file of listingFiles) {
    const html = await readFile(file, 'utf8');
    for (const m of html.matchAll(/<article class="gl-blog-card">/g)) {
      const card = divlessSlice(html, m.index);
      const href = grab(card, /class="gl-blog-card-link" href="([^"]+)"/);
      const metaInner = divInner(card, /<div class="gl-blog-card-meta">/) || '';
      const spans = [...metaInner.matchAll(/<span>([^<]*)<\/span>/g)].map((s) => decode(s[1]));
      const excerpt = (divInner(card, /<div class="gl-blog-card-text line-clamp-3">/) || '').trim();
      map.set(href, { author: spans.length > 1 ? spans[0] : '', excerpt, order: order++ });
    }
  }
  return map;
}

// Slice from an <article ...> opening tag to its matching close.
function divlessSlice(html, from) {
  const end = html.indexOf('</article>', from);
  return html.slice(from, end === -1 ? html.length : end);
}

// --- per-post extraction -------------------------------------------------
function parsePost(html, slug, folder, cardMap) {
  const title = decode(grab(html, /<h1 class="gl-blog-article-title">([\s\S]*?)<\/h1>/));
  if (!title) warn(slug, 'missing h1 title');
  const dateText = decode(grab(html, /<span class="gl-blog-article-date">([\s\S]*?)<\/span>/));
  const tagsText = decode(grab(html, /<p class="gl-blog-article-tags"><strong>Tags:<\/strong>\s*([\s\S]*?)<\/p>/));
  const imageBlock = divInner(html, /<div class="gl-blog-article-image">/) || '';
  const body = divInner(html, /<div class="gl-blog-article-body">/);
  if (body == null) warn(slug, 'missing article body');
  const videoBlock = divInner(html, /<div class="gl-blog-article-video">/) || '';
  let json_ld = '';
  const ld = html.match(/<script type="application\/ld\+json">\s*(?:<script[^>]*>)?\s*([\s\S]*?)\s*<\/script>/);
  if (ld) {
    try { json_ld = JSON.stringify(JSON.parse(ld[1]), null, 2); }
    catch { warn(slug, 'json-ld present but unparseable — carried over raw'); json_ld = ld[1]; }
  }
  const href = folder ? `/blog/${folder}/${slug}.html` : `/blog/${slug}.html`;
  const card = cardMap.get(href);
  if (!card) warn(slug, 'no listing card found (author/excerpt/order missing)');

  return {
    title,
    name: slug,
    folder,
    date: toIsoDate(dateText, slug),
    author: card?.author ?? '',
    featured_image: grab(imageBlock, /src="([^"]*)"/),
    featured_image_alt: decode(grab(imageBlock, /alt="([^"]*)"/)),
    excerpt: card?.excerpt ?? '',
    body: (body ?? '').trim(),
    tags: tagsText ? tagsText.split(',').map((t) => t.trim()).filter(Boolean) : [],
    meta_title: decode(grab(html, /<title>([\s\S]*?)<\/title>/)),
    meta_description: decode(grab(html, /<meta name="description" content="([^"]*)"/)),
    og_image: grab(html, /<meta property="og:image" content="([^"]*)"/),
    canonical_url: grab(html, /<link rel="canonical" href="([^"]*)"/),
    robots: grab(html, /<meta name="robots" content="([^"]*)"/),
    json_ld,
    youtube_id: grab(videoBlock, /youtube\.com\/embed\/([A-Za-z0-9_-]+)/),
    youtube_title: decode(grab(videoBlock, /title="([^"]*)"/)),
    unpublished: false,
    ...(card ? { migrated_order: card.order } : {}),
  };
}

// --- main ----------------------------------------------------------------
const cardMap = await buildCardMap();
await mkdir(OUT, { recursive: true });
const posts = [];

async function walkPosts(dir, folder) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (folder === null && FOLDERS.includes(entry.name)) await walkPosts(full, entry.name);
      continue; // pg/ and anything else: not posts
    }
    if (!entry.name.endsWith('.html') || entry.name === 'index.html') continue;
    const slug = entry.name.replace(/\.html$/, '');
    posts.push(parsePost(await readFile(full, 'utf8'), slug, folder, cardMap));
  }
}
await walkPosts(BLOG, null);

for (const post of posts) {
  await writeFile(path.join(OUT, `${post.name}.json`), JSON.stringify(post, null, 2) + '\n');
}

console.log(`Wrote ${posts.length} posts to ${OUT}`);
console.log(`Folders: ${JSON.stringify(Object.fromEntries(
  FOLDERS.map((f) => [f, posts.filter((p) => p.folder === f).length])))}`);
console.log(`With card data: ${posts.filter((p) => 'migrated_order' in p).length}/${posts.length}`);
if (warnings.length) { console.log('\nWARNINGS:'); for (const w of warnings) console.log('  ' + w); }
