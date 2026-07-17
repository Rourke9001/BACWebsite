'use strict';

const { FOLDERS } = require('./router');

const MAX_BODY_BYTES = 500 * 1024;
const STRING_FIELDS = ['author', 'featured_image', 'featured_image_alt', 'excerpt',
  'meta_title', 'meta_description', 'og_image', 'canonical_url', 'robots',
  'json_ld', 'youtube_id', 'youtube_title'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Validates + normalizes an incoming post. Unknown fields are dropped.
function validatePost(input) {
  const errors = [];
  if (typeof input !== 'object' || input === null) return { errors: ['Post must be a JSON object.'], post: null };
  const post = {};
  post.title = str(input.title);
  if (!post.title) errors.push('title is required');
  post.name = str(input.name);
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(post.name)) errors.push('name (slug) must be lowercase letters, digits and hyphens');
  post.folder = input.folder || null;
  if (post.folder !== null && !FOLDERS.includes(post.folder)) errors.push(`folder must be one of: ${FOLDERS.join(', ')} or empty`);
  post.date = str(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) errors.push('date must be YYYY-MM-DD');
  post.body = typeof input.body === 'string' ? input.body : '';
  if (!post.body.trim()) errors.push('body is required');
  if (Buffer.byteLength(post.body, 'utf8') > MAX_BODY_BYTES) errors.push('body exceeds 500 KB');
  post.tags = Array.isArray(input.tags) ? input.tags.map(str).filter(Boolean) : [];
  for (const f of STRING_FIELDS) post[f] = str(input[f]);
  if (post.json_ld) {
    try { JSON.parse(post.json_ld); } catch { errors.push('json_ld must be valid JSON'); }
  }
  if (post.youtube_id && !/^[A-Za-z0-9_-]{5,20}$/.test(post.youtube_id)) errors.push('youtube_id does not look like a YouTube video id');
  post.unpublished = Boolean(input.unpublished);
  if (typeof input.migrated_order === 'number') post.migrated_order = input.migrated_order;
  return { errors, post: errors.length ? null : post };
}

module.exports = { validatePost, MAX_BODY_BYTES };
