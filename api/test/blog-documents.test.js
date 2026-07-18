'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeDocName, isStoredDocName, MAX_DOC_BYTES } = require('../src/lib/blog/documents');
const { createBlogStore } = require('../src/lib/blog/store');

// ---- sanitizeDocName ----------------------------------------------------

test('sanitizeDocName normalizes name and keeps a stable URL-safe result', () => {
  assert.deepStrictEqual(sanitizeDocName('Terms & Conditions 2026.PDF'), {
    name: 'terms-conditions-2026.pdf',
    contentType: 'application/pdf',
  });
});

test('sanitizeDocName maps each allowed extension to its MIME type', () => {
  assert.strictEqual(sanitizeDocName('a.docx').contentType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.strictEqual(sanitizeDocName('a.xls').contentType, 'application/vnd.ms-excel');
  assert.strictEqual(sanitizeDocName('a.xlsx').contentType,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.strictEqual(sanitizeDocName('a.doc').contentType, 'application/msword');
});

test('sanitizeDocName rejects disallowed or missing extensions', () => {
  assert.ok(sanitizeDocName('malware.exe').error);
  assert.ok(sanitizeDocName('script.html').error);
  assert.ok(sanitizeDocName('no-extension').error);
  assert.ok(sanitizeDocName('').error);
});

test('sanitizeDocName rejects names with no usable characters', () => {
  assert.ok(sanitizeDocName('???.pdf').error);
});

test('MAX_DOC_BYTES is 20 MB', () => {
  assert.strictEqual(MAX_DOC_BYTES, 20 * 1024 * 1024);
});

// ---- isStoredDocName ----------------------------------------------------

test('isStoredDocName accepts sanitized names and rejects everything else', () => {
  assert.ok(isStoredDocName('terms-conditions-2026.pdf'));
  assert.ok(isStoredDocName('popia.docx'));
  assert.ok(!isStoredDocName('../escape.pdf'));
  assert.ok(!isStoredDocName('has space.pdf'));
  assert.ok(!isStoredDocName('UPPER.pdf'));
  assert.ok(!isStoredDocName('bad.exe'));
  assert.ok(!isStoredDocName(''));
  // Round-trip: whatever sanitize produces must validate.
  assert.ok(isStoredDocName(sanitizeDocName('Terms & Conditions 2026.PDF').name));
});

// ---- store document helpers ---------------------------------------------

function fakeContainer(blobs) {
  const asStream = (text) => ({
    readableStreamBody: (async function* () { yield Buffer.from(text); })(),
  });
  return {
    listBlobsFlat({ prefix }) {
      const names = Object.keys(blobs).filter((n) => n.startsWith(prefix));
      return (async function* () {
        for (const name of names) yield { name, properties: { contentLength: blobs[name].length, lastModified: '2026-07-18T08:00:00Z' } };
      })();
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

test('listDocuments returns documents/ blobs with prefix stripped', async () => {
  const store = createBlogStore(fakeContainer({
    'documents/terms.pdf': 'pdf-bytes',
    'posts/a.json': '{}',
    'uploads/pic.png': 'img',
  }));
  const docs = await store.listDocuments();
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].name, 'terms.pdf');
  assert.strictEqual(docs[0].size, 'pdf-bytes'.length);
  assert.strictEqual(docs[0].lastModified, '2026-07-18T08:00:00.000Z');
});

test('uploadDocument then getDocument round-trips; deleteDocument removes', async () => {
  const blobs = {};
  const store = createBlogStore(fakeContainer(blobs));
  await store.uploadDocument('terms.pdf', Buffer.from('pdf-bytes'), 'application/pdf');
  assert.ok('documents/terms.pdf' in blobs);
  const doc = await store.getDocument('terms.pdf');
  assert.strictEqual(doc.buffer.toString(), 'pdf-bytes');
  await store.deleteDocument('terms.pdf');
  assert.ok(!('documents/terms.pdf' in blobs));
  assert.strictEqual(await store.getDocument('terms.pdf'), null);
});
