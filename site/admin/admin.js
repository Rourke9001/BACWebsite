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

// ---- list view ----------------------------------------------------------
async function showList() {
  $('#adm-edit-view').hidden = true;
  $('#adm-list-view').hidden = false;
  const posts = await api('/api/admin/posts');
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
    const p = await api(`/api/admin/posts/${slug}`);
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
    await api(`/api/admin/posts/${post.name}`, { method: 'PUT', body: JSON.stringify(post) });
    if (oldSlug && oldSlug !== post.name) {
      await api(`/api/admin/posts/${oldSlug}`, { method: 'DELETE' });
    }
    state.editingSlug = post.name;
    state.savedPost = post;
    $('#adm-edit-title').textContent = 'Edit post';
    $('#adm-delete').hidden = false;
    setStatus('Saved. Live on the site within about a minute.', 'ok');
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, 'err');
  }
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
  return (await res.json()).url;
}

// ---- wiring -------------------------------------------------------------
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
    await api(`/api/admin/posts/${state.editingSlug}`, { method: 'DELETE' });
    showList();
  } catch (err) { setStatus(`Delete failed: ${err.message}`, 'err'); }
});

fetch('/.auth/me').then((r) => r.json()).then((d) => {
  $('#adm-user').textContent = d.clientPrincipal ? d.clientPrincipal.userDetails : '';
}).catch(() => {});

showList().catch((err) => setStatus(`Could not load posts: ${err.message}`, 'err'));
