'use strict';

const FOLDERS = ['road-freight', 'customs-clearing', 'mining-transport', 'liquor-transport'];

// Maps a public URL path to a blog route. Input comes from x-ms-original-url
// (SWA rewrite) or the raw /api/blog/... path — caller strips the /api prefix.
function routeBlogPath(rawPath) {
  let p;
  try { p = decodeURIComponent(rawPath); } catch { return { kind: 'notfound' }; }
  if (p === '/blog' || p === '/blog/') return { kind: 'index', page: 1 };
  const pg = p.match(/^\/blog\/pg\/(\d{1,3})\/?$/);
  if (pg) return { kind: 'index', page: Number(pg[1]) };
  const media = p.match(/^\/blog\/media\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (media) return { kind: 'media', file: media[1] };
  const folderPost = p.match(/^\/blog\/([a-z0-9-]+)\/([a-z0-9-]+)\.html$/);
  if (folderPost && FOLDERS.includes(folderPost[1])) {
    return { kind: 'post', folder: folderPost[1], slug: folderPost[2] };
  }
  const post = p.match(/^\/blog\/([a-z0-9-]+)\.html$/);
  if (post) return { kind: 'post', folder: null, slug: post[1] };

  const legacy = routeLegacyNewsPath(p);
  if (legacy) return legacy;

  return { kind: 'notfound' };
}

// The pre-2026 Couch site published articles under /news/. Those URLs are still
// indexed, so they resolve to a 301 rather than a 404 — the handler turns a
// { kind: 'legacy' } route into the canonical /blog/ location. A null slug means
// "nothing specific to point at", which the handler sends to the blog index.
function routeLegacyNewsPath(p) {
  if (p === '/news' || p === '/news/') return { kind: 'legacy', folder: null, slug: null };

  const m = p.match(/^\/news\/(?:([a-z0-9_-]+)\/)?([a-z0-9_-]+)\.html$/);
  if (!m) return null;

  // The retired host's .htaccess rewrote underscore slugs to hyphens per article;
  // that rewrite died with the host, so normalise here instead.
  const folder = m[1] ? m[1].replace(/_/g, '-') : null;
  const slug = m[2].replace(/_/g, '-');

  // An unrecognised folder is a URL shape we never published — send it to the
  // index rather than minting a 301 that lands on a 404.
  if (folder && !FOLDERS.includes(folder)) return { kind: 'legacy', folder: null, slug: null };

  return { kind: 'legacy', folder, slug };
}

module.exports = { routeBlogPath, FOLDERS };
