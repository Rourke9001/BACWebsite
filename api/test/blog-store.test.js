'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createBlogStore } = require('../src/lib/blog/store');
const { createPostCache } = require('../src/lib/blog/cache');

// Minimal fake of the @azure/storage-blob ContainerClient surface store.js uses.
function fakeContainer(blobs) {
  // blobs: { 'posts/a.json': '{"name":"a"}', ... }
  const asStream = (text) => ({
    readableStreamBody: (async function* () { yield Buffer.from(text); })(),
  });
  return {
    listBlobsFlat({ prefix }) {
      const names = Object.keys(blobs).filter((n) => n.startsWith(prefix));
      return (async function* () { for (const name of names) yield { name }; })();
    },
    getBlobClient(name) {
      return {
        async download() {
          if (!(name in blobs)) { const e = new Error('404'); e.statusCode = 404; throw e; }
          return asStream(blobs[name]);
        },
        async deleteIfExists() { delete blobs[name]; },
      };
    },
    getBlockBlobClient(name) {
      return { async upload(data) { blobs[name] = data.toString(); } };
    },
  };
}

test('loadAllPosts reads and parses every posts/*.json blob', async () => {
  const store = createBlogStore(fakeContainer({
    'posts/a.json': '{"name":"a","title":"A"}',
    'posts/b.json': '{"name":"b","title":"B"}',
    'uploads/pic.png': 'binary-not-a-post',
  }));
  const posts = await store.loadAllPosts();
  assert.deepStrictEqual(posts.map((p) => p.name).sort(), ['a', 'b']);
});

test('getPost returns null for a missing slug', async () => {
  const store = createBlogStore(fakeContainer({}));
  assert.strictEqual(await store.getPost('nope'), null);
});

test('savePost writes posts/<name>.json', async () => {
  const blobs = {};
  const store = createBlogStore(fakeContainer(blobs));
  await store.savePost({ name: 'new-post', title: 'New' });
  assert.ok(blobs['posts/new-post.json'].includes('"title": "New"'));
});
