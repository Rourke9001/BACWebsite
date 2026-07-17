'use strict';

const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const { createBlogStore } = require('../lib/blog/store');
const { createPostCache } = require('../lib/blog/cache');
const { handleBlogRequest } = require('../lib/blog/handler');

let shared = null;
function getShared() {
  if (!shared) {
    const svc = BlobServiceClient.fromConnectionString(process.env.BLOG_STORAGE_CONNECTION);
    const store = createBlogStore(svc.getContainerClient('blog'));
    shared = { store, getPosts: createPostCache(() => store.loadAllPosts()) };
  }
  return shared;
}

// Exported for the admin function (same store + cache instance per worker).
module.exports = { getShared };

async function handler(request, context) {
  const original = request.headers.get('x-ms-original-url');
  const pathname = original ? new URL(original).pathname : new URL(request.url).pathname;
  const { store, getPosts } = getShared();
  return handleBlogRequest(pathname, {
    getPosts,
    getMedia: (file) => store.getMedia(file),
    log: (msg) => context.log(msg),
  });
}

app.http('blog', { methods: ['GET', 'HEAD'], authLevel: 'anonymous', route: 'blog/{*path}', handler });
app.http('blog-root', { methods: ['GET', 'HEAD'], authLevel: 'anonymous', route: 'blog', handler });
app.http('sitemap-blog', { methods: ['GET'], authLevel: 'anonymous', route: 'sitemap-blog.xml', handler });

// TEMP BAC-13 diagnostic: multi-segment route registered from this (known-working) file.
app.http('admin-ping', { methods: ['GET'], authLevel: 'anonymous', route: 'admin/ping', handler: async () => ({ jsonBody: { ok: 'admin-ping-from-blog-js' } }) });
