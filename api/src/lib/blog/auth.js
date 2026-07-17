'use strict';

// SWA injects the authenticated user as base64 JSON in x-ms-client-principal.
// The API must re-check the role itself: route rules protect the page, not the API contract.
function getClientPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function requireRole(request, role) {
  const principal = getClientPrincipal(request);
  if (!principal) return { status: 401, jsonBody: { error: 'Not signed in.' } };
  if (!Array.isArray(principal.userRoles) || !principal.userRoles.includes(role)) {
    return { status: 403, jsonBody: { error: `Missing required role: ${role}` } };
  }
  return null;
}

module.exports = { getClientPrincipal, requireRole };
