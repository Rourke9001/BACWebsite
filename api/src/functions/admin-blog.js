'use strict';

const { app } = require('@azure/functions');
const { requireRole } = require('../lib/blog/auth');
const { validatePost } = require('../lib/blog/admin');
const { getShared } = require('./blog');

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Every admin endpoint re-verifies the role; route rules alone don't protect the API contract.
function guard(handler) {
  return async (request, context) => {
    const denied = requireRole(request, 'blog_author');
    if (denied) return denied;
    try {
      return await handler(request, context);
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: 'Server error.' } };
    }
  };
}

app.http('admin-posts-list', {
  methods: ['GET'], authLevel: 'anonymous', route: 'admin/posts',
  handler: guard(async () => {
    const posts = await getShared().store.loadAllPosts();
    posts.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    return {
      jsonBody: posts.map(({ name, title, folder, date, unpublished }) =>
        ({ name, title, folder, date, unpublished: Boolean(unpublished) })),
    };
  }),
});

app.http('admin-post', {
  methods: ['GET', 'PUT', 'DELETE'], authLevel: 'anonymous', route: 'admin/posts/{slug}',
  handler: guard(async (request) => {
    const { store } = getShared();
    const slug = request.params.slug;
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return { status: 400, jsonBody: { error: 'Bad slug.' } };

    if (request.method === 'GET') {
      const post = await store.getPost(slug);
      return post ? { jsonBody: post } : { status: 404, jsonBody: { error: 'Not found.' } };
    }
    if (request.method === 'DELETE') {
      await store.deletePost(slug);
      return { jsonBody: { deleted: slug } };
    }
    let input;
    try { input = await request.json(); } catch { return { status: 400, jsonBody: { error: 'Body must be JSON.' } }; }
    const { errors, post } = validatePost(input);
    if (errors.length) return { status: 400, jsonBody: { errors } };
    if (post.name !== slug) return { status: 400, jsonBody: { error: 'Slug in URL and body must match.' } };
    await store.savePost(post);
    return { jsonBody: post };
  }),
});

app.http('admin-upload', {
  methods: ['POST'], authLevel: 'anonymous', route: 'admin/upload',
  handler: guard(async (request) => {
    const form = await request.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file === 'string') return { status: 400, jsonBody: { error: 'Send multipart form-data with a "file" field.' } };
    const ext = ((file.name || '').match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
    if (!ext || !IMAGE_TYPES[ext]) return { status: 400, jsonBody: { error: 'Allowed types: png, jpg, jpeg, webp, gif.' } };
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return { status: 400, jsonBody: { error: 'Image exceeds 5 MB.' } };
    const base = (file.name.replace(/\.[^.]+$/, '').toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'image';
    const name = `${base}-${Date.now()}.${ext}`;
    await getShared().store.uploadImage(name, buffer, IMAGE_TYPES[ext]);
    return { jsonBody: { url: `/blog/media/${name}` } };
  }),
});

// TEMP BAC-13 diagnostic: flat route registered from this (currently-404ing) file.
app.http('adminping-flat', { methods: ['GET'], authLevel: 'anonymous', route: 'adminping', handler: async () => ({ jsonBody: { ok: 'flat-from-admin-blog-js' } }) });
