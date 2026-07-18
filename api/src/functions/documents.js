'use strict';

const { app } = require('@azure/functions');
const { isStoredDocName } = require('../lib/blog/documents');
const { getShared } = require('./blog');

// Public serving of admin-uploaded site documents at /documents/<name>
// (staticwebapp.config.json rewrites /documents/* here). Unlinked from the
// site for now — anyone with the exact URL can fetch, which is intended.
async function handler(request, context) {
  const original = request.headers.get('x-ms-original-url');
  const pathname = original ? new URL(original).pathname : new URL(request.url).pathname;
  let file;
  try {
    file = decodeURIComponent(pathname.replace(/^\/api(?=\/)/, '').replace(/^\/documents\//, ''));
  } catch {
    return { status: 404, body: 'Not found' };
  }
  if (!isStoredDocName(file)) return { status: 404, body: 'Not found' };

  const doc = await getShared().store.getDocument(file).catch((err) => {
    context.log(`document read failure: ${err.message}`);
    return null;
  });
  if (!doc) return { status: 404, body: 'Not found' };
  return {
    status: 200,
    headers: {
      'Content-Type': doc.contentType,
      // Short-lived cache: documents keep stable URLs, so replacements must propagate.
      'Cache-Control': 'public, max-age=300',
      'Content-Disposition': `inline; filename="${file}"`,
    },
    body: doc.buffer,
  };
}

app.http('documents', { methods: ['GET', 'HEAD'], authLevel: 'anonymous', route: 'documents/{*path}', handler });
app.http('documents-root', { methods: ['GET', 'HEAD'], authLevel: 'anonymous', route: 'documents', handler });
