'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { routeBlogPath } = require('../src/lib/blog/router');

test('routes blog URLs', () => {
  assert.deepStrictEqual(routeBlogPath('/blog/'), { kind: 'index', page: 1 });
  assert.deepStrictEqual(routeBlogPath('/blog'), { kind: 'index', page: 1 });
  assert.deepStrictEqual(routeBlogPath('/blog/pg/3/'), { kind: 'index', page: 3 });
  assert.deepStrictEqual(routeBlogPath('/blog/what-is-bonded-warehousing.html'),
    { kind: 'post', folder: null, slug: 'what-is-bonded-warehousing' });
  assert.deepStrictEqual(routeBlogPath('/blog/road-freight/some-post.html'),
    { kind: 'post', folder: 'road-freight', slug: 'some-post' });
  assert.deepStrictEqual(routeBlogPath('/blog/media/pic-123.png'), { kind: 'media', file: 'pic-123.png' });
  assert.strictEqual(routeBlogPath('/blog/unknown-folder/x.html').kind, 'notfound');
  assert.strictEqual(routeBlogPath('/blog/../etc/passwd').kind, 'notfound');
});

test('routes retired /news/ URLs to the legacy kind', () => {
  // The pre-2026 Couch site published articles under /news/. Google still holds
  // those URLs; they must resolve, not 404. See docs/legacy-news-redirects.md.
  assert.deepStrictEqual(routeBlogPath('/news/choose-road-freight-provider.html'),
    { kind: 'legacy', folder: null, slug: 'choose-road-freight-provider' });
  assert.deepStrictEqual(routeBlogPath('/news/'), { kind: 'legacy', folder: null, slug: null });
  assert.deepStrictEqual(routeBlogPath('/news'), { kind: 'legacy', folder: null, slug: null });
  assert.deepStrictEqual(routeBlogPath('/news/customs-clearing/some-post.html'),
    { kind: 'legacy', folder: 'customs-clearing', slug: 'some-post' });
});

test('normalises the underscore slugs the old .htaccess rewrote', () => {
  // 00_OLD/.htaccess carried per-article underscore->hyphen rewrites; that host is
  // gone, so the normalisation has to live here or those URLs die.
  assert.deepStrictEqual(routeBlogPath('/news/benefits_of_choosing_bonded_warehousing.html'),
    { kind: 'legacy', folder: null, slug: 'benefits-of-choosing-bonded-warehousing' });
});

test('a /news/ path in an unknown folder still resolves to the blog index', () => {
  assert.deepStrictEqual(routeBlogPath('/news/no-such-folder/x.html'),
    { kind: 'legacy', folder: null, slug: null });
});
