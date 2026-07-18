'use strict';

const { app } = require('@azure/functions');
const { guardRole } = require('../lib/blog/auth');
const { sanitizeDocName, isStoredDocName, MAX_DOC_BYTES } = require('../lib/blog/documents');
const { getShared } = require('./blog');

// Every admin endpoint re-verifies the role; route rules alone don't protect the API contract.
// NOTE: routes must never start with the reserved `admin/` prefix (see tasks/lessons.md).
const guard = (handler) => guardRole('blog_author', handler);

app.http('admin-documents', {
  methods: ['GET', 'POST'], authLevel: 'anonymous', route: 'blog-admin/documents',
  handler: guard(async (request) => {
    const { store } = getShared();

    if (request.method === 'GET') {
      const docs = await store.listDocuments();
      docs.sort((a, b) => a.name.localeCompare(b.name));
      return { jsonBody: docs.map((d) => ({ ...d, url: `/documents/${d.name}` })) };
    }

    const form = await request.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file === 'string') return { status: 400, jsonBody: { error: 'Send multipart form-data with a "file" field.' } };
    const { error, name, contentType } = sanitizeDocName(file.name);
    if (error) return { status: 400, jsonBody: { error } };
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_DOC_BYTES) return { status: 400, jsonBody: { error: 'Document exceeds 20 MB.' } };
    await store.uploadDocument(name, buffer, contentType);
    return { jsonBody: { name, url: `/documents/${name}` } };
  }),
});

app.http('admin-document', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'blog-admin/documents/{name}',
  handler: guard(async (request) => {
    const name = request.params.name;
    if (!isStoredDocName(name)) return { status: 400, jsonBody: { error: 'Bad document name.' } };
    await getShared().store.deleteDocument(name);
    return { jsonBody: { deleted: name } };
  }),
});
