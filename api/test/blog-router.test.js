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
