'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { handleBlogRequest } = require('../src/lib/blog/handler');

const fixture = {
  title: 'Handler Post', name: 'handler-post', folder: null, date: '2026-05-01',
  author: '', featured_image: '', featured_image_alt: '', excerpt: '',
  body: '<p>Body</p>', tags: [], meta_title: '', meta_description: '', og_image: '',
  canonical_url: '', robots: '', json_ld: '', youtube_id: '', youtube_title: '', unpublished: false,
};

const deps = (over = {}) => ({
  getPosts: async () => [fixture],
  getMedia: async () => null,
  log: () => {},
  ...over,
});

test('serves a post with cache headers', async () => {
  const res = await handleBlogRequest('/blog/handler-post.html', deps());
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'public, max-age=60');
  assert.ok(res.body.includes('Handler Post'));
});

test('strips the /api prefix from direct function calls', async () => {
  const res = await handleBlogRequest('/api/blog/handler-post.html', deps());
  assert.strictEqual(res.status, 200);
});

test('unknown slug and unpublished posts return branded 404', async () => {
  const missing = await handleBlogRequest('/blog/nope.html', deps());
  assert.strictEqual(missing.status, 404);
  const hidden = await handleBlogRequest('/blog/handler-post.html',
    deps({ getPosts: async () => [{ ...fixture, unpublished: true }] }));
  assert.strictEqual(hidden.status, 404);
});

test('storage failure with no cache returns branded 503, no-store', async () => {
  const res = await handleBlogRequest('/blog/', deps({ getPosts: async () => { throw new Error('down'); } }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
});

test('media route streams blob with long cache', async () => {
  const res = await handleBlogRequest('/blog/media/x.png',
    deps({ getMedia: async () => ({ buffer: Buffer.from('png'), contentType: 'image/png' }) }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Content-Type'], 'image/png');
  assert.ok(res.headers['Cache-Control'].includes('max-age=31536000'));
});

test('sitemap path renders xml', async () => {
  const res = await handleBlogRequest('/sitemap-blog.xml', deps());
  assert.ok(res.body.includes('/blog/handler-post.html'));
  assert.ok(res.headers['Content-Type'].includes('xml'));
});
