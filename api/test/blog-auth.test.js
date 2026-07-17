'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { requireRole, getClientPrincipal } = require('../src/lib/blog/auth');

const req = (principal) => ({
  headers: {
    get: (name) => name === 'x-ms-client-principal' && principal
      ? Buffer.from(JSON.stringify(principal)).toString('base64')
      : null,
  },
});

test('no principal -> 401', () => {
  assert.strictEqual(requireRole(req(null), 'blog_author').status, 401);
});

test('authenticated without the role -> 403', () => {
  assert.strictEqual(requireRole(req({ userRoles: ['anonymous', 'authenticated'] }), 'blog_author').status, 403);
});

test('with role -> null (allowed)', () => {
  assert.strictEqual(requireRole(req({ userRoles: ['authenticated', 'blog_author'] }), 'blog_author'), null);
});

test('garbage header -> 401, not a crash', () => {
  const bad = { headers: { get: () => '!!!not-base64-json!!!' } };
  assert.strictEqual(requireRole(bad, 'blog_author').status, 401);
});
