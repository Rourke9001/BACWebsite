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
  return { kind: 'notfound' };
}

module.exports = { routeBlogPath, FOLDERS };
