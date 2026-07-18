'use strict';

// Site documents (terms & conditions, policies, …) uploaded via the admin
// Documents tab. Stored as documents/<name> in the blog container and served
// publicly at /documents/<name>; nothing on the site links to them until a
// later ticket wires them in.

const DOC_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const MAX_DOC_BYTES = 20 * 1024 * 1024;

// 'Terms & Conditions 2026.PDF' -> { name: 'terms-conditions-2026.pdf', contentType: 'application/pdf' }.
// Names are stable (no timestamp suffix): re-uploading a document replaces it
// at the same public URL, which is the point for evergreen files like T&Cs.
function sanitizeDocName(filename) {
  const ext = ((String(filename || '').match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
  if (!DOC_TYPES[ext]) return { error: `Allowed types: ${Object.keys(DOC_TYPES).join(', ')}.` };
  const base = String(filename).replace(/\.[^.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!base) return { error: 'File name must contain letters or digits.' };
  return { name: `${base}.${ext}`, contentType: DOC_TYPES[ext] };
}

// True for names previously produced by sanitizeDocName — used to validate
// route/path input before it reaches storage.
function isStoredDocName(name) {
  return /^[a-z0-9][a-z0-9-]{0,79}\.(pdf|doc|docx|xls|xlsx)$/.test(String(name || ''));
}

module.exports = { DOC_TYPES, MAX_DOC_BYTES, sanitizeDocName, isStoredDocName };
