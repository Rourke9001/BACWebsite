'use strict';

const $ = (sel) => document.querySelector(sel);
const state = { editingSlug: null, slugTouched: false };

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); detail = j.error || (j.errors || []).join('; ') || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

function setStatus(msg, cls) {
  const el = $('#adm-status');
  el.textContent = msg;
  el.className = 'adm-status' + (cls ? ' ' + cls : '');
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

// Mirrors render.js's postUrlPath() on the server.
function postUrl(post) {
  return post.folder ? `/blog/${post.folder}/${post.name}.html` : `/blog/${post.name}.html`;
}

function showBanner(msg, url) {
  $('#adm-banner-msg').textContent = msg;
  const link = $('#adm-banner-link');
  link.hidden = !url;
  if (url) link.href = url;
  $('#adm-banner').hidden = false;
}

function hideBanner() {
  $('#adm-banner').hidden = true;
}

function selectTab(which) {
  $('#adm-tab-posts').classList.toggle('active', which === 'posts');
  $('#adm-tab-docs').classList.toggle('active', which === 'docs');
}

// ---- list view ----------------------------------------------------------
async function showList() {
  selectTab('posts');
  $('#adm-edit-view').hidden = true;
  $('#adm-docs-view').hidden = true;
  $('#adm-list-view').hidden = false;
  const posts = await api('/api/blog-admin/posts');
  const tbody = $('#adm-table tbody');
  tbody.innerHTML = '';
  for (const p of posts) {
    const tr = document.createElement('tr');
    if (p.unpublished) tr.className = 'adm-unpublished';
    for (const v of [p.title, p.folder || '—', p.date, p.unpublished ? 'Unpublished' : 'Live']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tr.addEventListener('click', () => showEditor(p.name));
    tbody.appendChild(tr);
  }
}

// ---- editor view --------------------------------------------------------
async function showEditor(slug) {
  hideBanner();
  selectTab('posts');
  $('#adm-docs-view').hidden = true;
  const form = $('#adm-form');
  form.reset();
  $('#adm-editor').innerHTML = '';
  $('#adm-featured-preview').hidden = true;
  state.editingSlug = slug;
  state.slugTouched = Boolean(slug);
  $('#adm-delete').hidden = !slug;
  $('#adm-edit-title').textContent = slug ? 'Edit post' : 'New post';
  setStatus('');
  if (slug) {
    const p = await api(`/api/blog-admin/posts/${slug}`);
    for (const f of ['title', 'name', 'author', 'featured_image', 'featured_image_alt', 'excerpt',
      'meta_title', 'meta_description', 'og_image', 'canonical_url', 'robots',
      'youtube_id', 'youtube_title', 'json_ld', 'date']) form.elements[f].value = p[f] || '';
    form.elements.folder.value = p.folder || '';
    form.elements.tags.value = (p.tags || []).join(', ');
    form.elements.unpublished.checked = Boolean(p.unpublished);
    $('#adm-editor').innerHTML = p.body || '';
    if (p.featured_image) { $('#adm-featured-preview').src = p.featured_image; $('#adm-featured-preview').hidden = false; }
    state.savedPost = p;
  } else {
    form.elements.date.value = new Date().toISOString().slice(0, 10);
    state.savedPost = null;
  }
  $('#adm-list-view').hidden = true;
  $('#adm-edit-view').hidden = false;
}

async function save() {
  const form = $('#adm-form');
  const post = {
    title: form.elements.title.value.trim(),
    name: form.elements.name.value.trim() || slugify(form.elements.title.value),
    folder: form.elements.folder.value || null,
    date: form.elements.date.value,
    author: form.elements.author.value,
    featured_image: form.elements.featured_image.value,
    featured_image_alt: form.elements.featured_image_alt.value,
    excerpt: form.elements.excerpt.value,
    body: $('#adm-editor').innerHTML,
    tags: form.elements.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    meta_title: form.elements.meta_title.value,
    meta_description: form.elements.meta_description.value,
    og_image: form.elements.og_image.value,
    canonical_url: form.elements.canonical_url.value,
    robots: form.elements.robots.value,
    json_ld: form.elements.json_ld.value,
    youtube_id: form.elements.youtube_id.value,
    youtube_title: form.elements.youtube_title.value,
    unpublished: form.elements.unpublished.checked,
  };
  if (state.savedPost && typeof state.savedPost.migrated_order === 'number') {
    post.migrated_order = state.savedPost.migrated_order;
  }
  try {
    const oldSlug = state.editingSlug;
    setStatus('Saving…');
    await api(`/api/blog-admin/posts/${post.name}`, { method: 'PUT', body: JSON.stringify(post) });
    if (oldSlug && oldSlug !== post.name) {
      await api(`/api/blog-admin/posts/${oldSlug}`, { method: 'DELETE' });
    }
    state.editingSlug = post.name;
    state.savedPost = post;
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, 'err');
    return;
  }
  // Land back on the post list with an unmissable confirmation instead of
  // leaving the filled-in form on screen. The save has succeeded at this
  // point, so a failed list reload must not mask the confirmation.
  await showList().catch(() => {});
  if (post.unpublished) {
    showBanner(`"${post.title}" saved as unpublished — it is hidden from the site.`, null);
  } else {
    showBanner(`"${post.title}" published — live on the site within about a minute.`, postUrl(post));
  }
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/blog-admin/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
  return (await res.json()).url;
}

// ---- documents view -----------------------------------------------------
function setDocsStatus(msg, cls) {
  const el = $('#adm-docs-status');
  el.textContent = msg;
  el.className = 'adm-status' + (cls ? ' ' + cls : '');
}

function formatBytes(n) {
  if (typeof n !== 'number') return '—';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

async function showDocs() {
  hideBanner();
  selectTab('docs');
  $('#adm-list-view').hidden = true;
  $('#adm-edit-view').hidden = true;
  $('#adm-docs-view').hidden = false;
  const docs = await api('/api/blog-admin/documents');
  const tbody = $('#adm-docs-table tbody');
  tbody.innerHTML = '';
  for (const d of docs) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    const link = document.createElement('a');
    link.href = d.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = d.name;
    nameTd.appendChild(link);
    tr.appendChild(nameTd);

    for (const v of [formatBytes(d.size), d.lastModified ? d.lastModified.slice(0, 10) : '—']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }

    const actions = document.createElement('td');
    actions.className = 'adm-doc-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'adm-btn adm-btn-small';
    copyBtn.textContent = 'Copy link';
    copyBtn.addEventListener('click', async () => {
      const url = location.origin + d.url;
      try {
        await navigator.clipboard.writeText(url);
        setDocsStatus('Link copied to clipboard.', 'ok');
      } catch {
        setDocsStatus(`Link: ${url}`, 'ok');
      }
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'adm-btn adm-btn-small adm-btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${d.name}"? Its /documents/ link will stop working.`)) return;
      try {
        await api(`/api/blog-admin/documents/${d.name}`, { method: 'DELETE' });
        await showDocs();
        setDocsStatus(`Deleted ${d.name}.`, 'ok');
      } catch (err) {
        setDocsStatus(`Delete failed: ${err.message}`, 'err');
      }
    });
    actions.append(copyBtn, delBtn);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
  if (!docs.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No documents uploaded yet.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

// ---- wiring -------------------------------------------------------------
$('#adm-tab-posts').addEventListener('click', () => {
  hideBanner();
  showList().catch((err) => setStatus(`Could not load posts: ${err.message}`, 'err'));
});
$('#adm-tab-docs').addEventListener('click', () =>
  showDocs().catch((err) => setDocsStatus(`Could not load documents: ${err.message}`, 'err')));
$('#adm-banner-close').addEventListener('click', hideBanner);
$('#adm-doc-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    setDocsStatus('Uploading…');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/blog-admin/documents', { method: 'POST', body: fd });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).error || detail; } catch {}
      throw new Error(detail);
    }
    const doc = await res.json();
    await showDocs();
    setDocsStatus(`Uploaded — link: ${location.origin}${doc.url}`, 'ok');
  } catch (err) {
    setDocsStatus(`Upload failed: ${err.message}`, 'err');
  }
});

$('#adm-new').addEventListener('click', () => showEditor(null));
$('#adm-back').addEventListener('click', () => showList());
$('#adm-save').addEventListener('click', save);
$('#adm-form').addEventListener('submit', (e) => { e.preventDefault(); save(); });

$('#adm-form').elements.title.addEventListener('input', (e) => {
  if (!state.slugTouched) $('#adm-form').elements.name.value = slugify(e.target.value);
});
$('#adm-form').elements.name.addEventListener('input', () => { state.slugTouched = true; });

$('#adm-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  $('#adm-editor').focus();
  if (btn.dataset.cmd) document.execCommand(btn.dataset.cmd);
  if (btn.dataset.block) document.execCommand('formatBlock', false, btn.dataset.block);
});
$('#adm-link').addEventListener('click', () => {
  const url = prompt('Link URL:');
  if (url) { $('#adm-editor').focus(); document.execCommand('createLink', false, url); }
});
$('#adm-body-image').addEventListener('click', () => $('#adm-body-file').click());
$('#adm-body-file').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  try {
    setStatus('Uploading image…');
    const url = await uploadFile(e.target.files[0]);
    $('#adm-editor').focus();
    document.execCommand('insertImage', false, url);
    setStatus('Image inserted.', 'ok');
  } catch (err) { setStatus(err.message, 'err'); }
});
$('#adm-featured-file').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  try {
    setStatus('Uploading image…');
    const url = await uploadFile(e.target.files[0]);
    $('#adm-form').elements.featured_image.value = url;
    $('#adm-featured-preview').src = url;
    $('#adm-featured-preview').hidden = false;
    setStatus('Featured image uploaded.', 'ok');
  } catch (err) { setStatus(err.message, 'err'); }
});
$('#adm-delete').addEventListener('click', async () => {
  if (!state.editingSlug) return;
  if (!confirm('Delete this post? (Old versions are kept in storage for rollback.)')) return;
  try {
    await api(`/api/blog-admin/posts/${state.editingSlug}`, { method: 'DELETE' });
    showList();
  } catch (err) { setStatus(`Delete failed: ${err.message}`, 'err'); }
});

fetch('/.auth/me').then((r) => r.json()).then((d) => {
  $('#adm-user').textContent = d.clientPrincipal ? d.clientPrincipal.userDetails : '';
}).catch(() => {});

showList().catch((err) => setStatus(`Could not load posts: ${err.message}`, 'err'));
