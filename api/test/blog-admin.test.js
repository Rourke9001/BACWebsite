'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { validatePost } = require('../src/lib/blog/admin');

const valid = {
  title: 'T', name: 'my-post', folder: null, date: '2026-07-17',
  body: '<p>hello</p>', tags: ['a'], unpublished: false,
};

test('valid post passes and is normalized', () => {
  const { errors, post } = validatePost({ ...valid, author: '  BAC  ', junk_field: 'dropped' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(post.author, 'BAC');
  assert.ok(!('junk_field' in post));
});

test('rejects bad slug, folder, date, empty body', () => {
  assert.ok(validatePost({ ...valid, name: 'Bad Slug!' }).errors.length);
  assert.ok(validatePost({ ...valid, folder: 'not-a-folder' }).errors.length);
  assert.ok(validatePost({ ...valid, date: '17/07/2026' }).errors.length);
  assert.ok(validatePost({ ...valid, body: '  ' }).errors.length);
});

test('rejects invalid json_ld and oversized body', () => {
  assert.ok(validatePost({ ...valid, json_ld: '{nope' }).errors.length);
  assert.ok(validatePost({ ...valid, body: 'x'.repeat(600 * 1024) }).errors.length);
});
