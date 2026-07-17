# BAC-13 Dynamic Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/blog/*` dynamically from Azure Blob Storage via the existing `api/` Functions app, with a Couch-style `/admin/` UI behind SWA Entra ID auth, so publishing a post requires zero redeploys.

**Architecture:** A new HTTP Function reads post JSON blobs from a private `blog` container, caches them in memory (60s TTL, serve-stale on failure), and renders HTML through templates lifted verbatim from the current static blog markup. All ~90 existing post URLs, `/blog/`, and `/blog/pg/N/` are preserved exactly (verified by a red-then-green diff gate before any static page is deleted). Admin API + UI write back to the same container; SWA built-in Entra ID auth gates `/admin/*` with a `blog_author` role.

**Tech Stack:** Node 20 CommonJS Azure Functions v4 model (`app.http`), `@azure/storage-blob` (the one new runtime dep), native `node --test` (zero test deps), zero-dep ESM scripts in `scripts/` (mirror.mjs style), static admin page with hand-rolled contenteditable editor (no CDN).

**Spec:** `docs/superpowers/specs/2026-07-17-bac13-dynamic-blog-design.md` (approved 2026-07-17).

## Global Constraints

- Every existing blog URL must keep working with identical content: `/blog/`, `/blog/pg/1/`…`/blog/pg/8/`, `/blog/<slug>.html` (83 posts), `/blog/<folder>/<slug>.html` (7 posts in `road-freight`, `customs-clearing`, `mining-transport`, `liquor-transport`). **12 posts per listing page.** No folder-level listing pages exist — do not invent them.
- Publishing must trigger **no build, no commit, no PR**. Content lives only in blob storage.
- Storage: one account, one **private** container `blog` (`posts/<slug>.json`, `uploads/<file>`), blob versioning ON. Public blob access stays disabled — new images are served through the Function at `/blog/media/<file>` (documented deviation from spec's implied public reads; keeps unpublished post JSON unreadable).
- Connection string in app setting `BLOG_STORAGE_CONNECTION` (same pattern as `GRAPH_*`).
- Cache: per-instance, TTL 60s, `Cache-Control: public, max-age=60`; blob failure → serve stale; no cache at all → branded 503 for blog routes only.
- Auth: SWA built-in Entra ID only; role `blog_author` via invitation; API re-checks `x-ms-client-principal` per request. Zero custom auth code.
- Tests: extend `api/` native `node --test` suite; **no new devDependencies**. Pure lib functions with injected deps (existing `handler.js` pattern).
- `api/` code is CommonJS (`'use strict'` + `require`); `scripts/` are zero-dep ESM (`.mjs`).
- Site origin for canonical/OG/sitemap URLs: `https://baclogistics.co.za`.
- Git: feature branch `feature/bac-13-dynamic-blog` off `develop`; merge to `develop` locally; `develop → main` PRs opened with `gh`, **user merges**. Never commit secrets (`api/local.settings.json` must stay untracked).
- Azure resource changes (Task 1, 10): **walk the user through each `az` command — do not run them unprompted**; user wants to see what's created and what's billable.
- GTM id `GTM-MPPHRHH`; design tokens per `DESIGN.md`; admin UI uses a new `adm-` class prefix (admin is not part of the `gl-` template lineage).

## Post JSON schema (contract for every task)

```json
{
  "title": "What Is Bonded Warehousing? Duty Deferred Storage Explained",
  "name": "what-is-bonded-warehousing",
  "folder": null,
  "date": "2026-03-24",
  "author": "",
  "featured_image": "/couch/uploads/image/blog/bac-bonded-warehousing.png",
  "featured_image_alt": "Warehouse worker scanning boxed inventory",
  "excerpt": "<p dir=\"ltr\">First card paragraph…</p>",
  "body": "<p dir=\"ltr\">Full article HTML…</p>",
  "tags": ["Customs warehouse"],
  "meta_title": "What Is Bonded Warehousing?",
  "meta_description": "",
  "og_image": "",
  "canonical_url": "",
  "robots": "",
  "json_ld": "",
  "youtube_id": "",
  "youtube_title": "",
  "unpublished": false,
  "migrated_order": 42
}
```

Notes: `title` = article `<h1>`; `meta_title` = `<title>` tag (falls back to `title` when empty); `folder` ∈ {null, "road-freight", "customs-clearing", "mining-transport", "liquor-transport"}; `canonical_url` empty → derived `https://baclogistics.co.za/blog/[<folder>/]<name>.html`; `excerpt` = card teaser HTML (falls back to first 3 `<p>`s of `body`); `json_ld` = raw JSON string emitted as a `<script type="application/ld+json">` before `</head>`; `migrated_order` = position in the original static listing (tie-break only, absent on new posts). Sort order everywhere: `date` desc, then `migrated_order` asc (absent = -1, so new same-day posts lead), then `name` asc.

---

### Task 1: Azure storage provisioning (config only — WITH the user)

**Files:** none in repo (plus untracked `api/local.settings.json`).

**Interfaces:**
- Produces: storage account with private container `blog`, versioning on; app setting `BLOG_STORAGE_CONNECTION` on the SWA; same value in untracked `api/local.settings.json` for local dev.

This task is interactive: present each command to the user, explain it and its cost, let them run it (or run it only with their go-ahead). Billing summary to give the user: Standard LRS StorageV2 hot ≈ $0.02/GB/month — the whole blog (90 posts ≈ 2 MB JSON + future images) is realistically **under $1/month, likely cents**; read/write operations are ~$0.004–0.05 per 10k; blob versioning stores old copies of tiny JSON files (negligible); the SWA plan/bill does not change.

- [ ] **Step 1: Find the existing resource group and SWA name**

```
az staticwebapp list -o table
```
Expected: one row — note `name` (SWA) and `resourceGroup`. Location is likely `westeurope` or similar; put the storage account in the same region unless the user prefers `southafricanorth` (closer to visitors; either is fine and equally cheap).

- [ ] **Step 2: Create the storage account** (globally-unique lowercase name; suggest `bacblogcontent`, fall back to `bacblogcontent2` etc. if taken)

```
az storage account create --name bacblogcontent --resource-group <RG> --location <REGION> --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
```

- [ ] **Step 3: Enable blob versioning + 30-day delete retention** (Couch-parity rollback)

```
az storage account blob-service-properties update --account-name bacblogcontent --resource-group <RG> --enable-versioning true --enable-delete-retention true --delete-retention-days 30
```

- [ ] **Step 4: Get the connection string and create the container**

```
az storage account show-connection-string --name bacblogcontent --resource-group <RG> -o tsv
az storage container create --name blog --connection-string "<CONN>"
```

- [ ] **Step 5: Set the SWA app setting**

```
az staticwebapp appsettings set --name <SWA_NAME> --setting-names BLOG_STORAGE_CONNECTION="<CONN>"
```

- [ ] **Step 6: Local dev settings.** Create `api/local.settings.json` (verify it is untracked: `git check-ignore api/local.settings.json` or add to `.gitignore` if not):

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "BLOG_STORAGE_CONNECTION": "<CONN>"
  }
}
```

- [ ] **Step 7: Verify**: `az storage container list --connection-string "<CONN>" -o table` shows `blog`; `az staticwebapp appsettings list --name <SWA_NAME>` shows the key. Nothing to commit.

---

### Task 2: Blob store + cache modules

**Files:**
- Create: `api/src/lib/blog/store.js`
- Create: `api/src/lib/blog/cache.js`
- Modify: `api/package.json` (add `@azure/storage-blob`)
- Test: `api/test/blog-store.test.js`, `api/test/blog-cache.test.js`

**Interfaces:**
- Consumes: a `ContainerClient`-shaped object (injected; tests use fakes).
- Produces: `createBlogStore(containerClient)` → `{ loadAllPosts(), getPost(slug), savePost(post), deletePost(slug), getMedia(file), uploadImage(name, buffer, contentType) }`; `createPostCache(loadAll, {ttlMs, now})` → `async getPosts()`.

- [ ] **Step 1: Write failing tests** — `api/test/blog-store.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createBlogStore } = require('../src/lib/blog/store');
const { createPostCache } = require('../src/lib/blog/cache');

// Minimal fake of the @azure/storage-blob ContainerClient surface store.js uses.
function fakeContainer(blobs) {
  // blobs: { 'posts/a.json': '{"name":"a"}', ... }
  const asStream = (text) => ({
    readableStreamBody: (async function* () { yield Buffer.from(text); })(),
  });
  return {
    listBlobsFlat({ prefix }) {
      const names = Object.keys(blobs).filter((n) => n.startsWith(prefix));
      return (async function* () { for (const name of names) yield { name }; })();
    },
    getBlobClient(name) {
      return {
        async download() {
          if (!(name in blobs)) { const e = new Error('404'); e.statusCode = 404; throw e; }
          return asStream(blobs[name]);
        },
        async deleteIfExists() { delete blobs[name]; },
      };
    },
    getBlockBlobClient(name) {
      return { async upload(data) { blobs[name] = data.toString(); } };
    },
  };
}

test('loadAllPosts reads and parses every posts/*.json blob', async () => {
  const store = createBlogStore(fakeContainer({
    'posts/a.json': '{"name":"a","title":"A"}',
    'posts/b.json': '{"name":"b","title":"B"}',
    'uploads/pic.png': 'binary-not-a-post',
  }));
  const posts = await store.loadAllPosts();
  assert.deepStrictEqual(posts.map((p) => p.name).sort(), ['a', 'b']);
});

test('getPost returns null for a missing slug', async () => {
  const store = createBlogStore(fakeContainer({}));
  assert.strictEqual(await store.getPost('nope'), null);
});

test('savePost writes posts/<name>.json', async () => {
  const blobs = {};
  const store = createBlogStore(fakeContainer(blobs));
  await store.savePost({ name: 'new-post', title: 'New' });
  assert.ok(blobs['posts/new-post.json'].includes('"title": "New"'));
});
```

`api/test/blog-cache.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createPostCache } = require('../src/lib/blog/cache');

test('cache returns fresh data within TTL without reloading', async () => {
  let calls = 0;
  let t = 0;
  const getPosts = createPostCache(async () => { calls++; return [{ name: 'a' }]; },
    { ttlMs: 60_000, now: () => t });
  await getPosts();
  t = 30_000;
  await getPosts();
  assert.strictEqual(calls, 1);
});

test('cache reloads after TTL expires', async () => {
  let calls = 0;
  let t = 0;
  const getPosts = createPostCache(async () => { calls++; return [calls]; }, { ttlMs: 60_000, now: () => t });
  await getPosts();
  t = 61_000;
  const second = await getPosts();
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(second, [2]);
});

test('cache serves stale data when refresh fails', async () => {
  let calls = 0;
  let t = 0;
  const getPosts = createPostCache(async () => {
    calls++;
    if (calls > 1) throw new Error('storage down');
    return [{ name: 'a' }];
  }, { ttlMs: 60_000, now: () => t });
  await getPosts();
  t = 61_000;
  const stale = await getPosts();
  assert.deepStrictEqual(stale, [{ name: 'a' }]);
});

test('cache throws when there is no data at all', async () => {
  const getPosts = createPostCache(async () => { throw new Error('down'); }, { ttlMs: 60_000 });
  await assert.rejects(getPosts, /down/);
});

test('concurrent callers share one inflight load', async () => {
  let calls = 0;
  const getPosts = createPostCache(async () => { calls++; return []; }, { ttlMs: 60_000 });
  await Promise.all([getPosts(), getPosts(), getPosts()]);
  assert.strictEqual(calls, 1);
});
```

- [ ] **Step 2: Run to verify failure** — `cd api; npm test` → FAIL: `Cannot find module '../src/lib/blog/store'`.

- [ ] **Step 3: Implement.** `api/src/lib/blog/store.js`:

```js
'use strict';

// Blob-backed post store. The ContainerClient is injected so tests can use fakes.
// Layout: posts/<slug>.json (one post per blob), uploads/<file> (images).

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createBlogStore(containerClient) {
  async function downloadJson(name) {
    const res = await containerClient.getBlobClient(name).download();
    return JSON.parse((await streamToBuffer(res.readableStreamBody)).toString('utf8'));
  }

  return {
    async loadAllPosts() {
      const names = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix: 'posts/' })) {
        if (blob.name.endsWith('.json')) names.push(blob.name);
      }
      return Promise.all(names.map(downloadJson));
    },

    async getPost(slug) {
      try {
        return await downloadJson(`posts/${slug}.json`);
      } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
      }
    },

    async savePost(post) {
      const body = JSON.stringify(post, null, 2);
      await containerClient.getBlockBlobClient(`posts/${post.name}.json`).upload(
        Buffer.from(body), Buffer.byteLength(body),
        { blobHTTPHeaders: { blobContentType: 'application/json' } });
    },

    async deletePost(slug) {
      await containerClient.getBlobClient(`posts/${slug}.json`).deleteIfExists();
    },

    async getMedia(file) {
      try {
        const res = await containerClient.getBlobClient(`uploads/${file}`).download();
        return {
          buffer: await streamToBuffer(res.readableStreamBody),
          contentType: res.contentType || 'application/octet-stream',
        };
      } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
      }
    },

    async uploadImage(name, buffer, contentType) {
      await containerClient.getBlockBlobClient(`uploads/${name}`).upload(
        buffer, buffer.length, { blobHTTPHeaders: { blobContentType: contentType } });
    },
  };
}

module.exports = { createBlogStore };
```

`api/src/lib/blog/cache.js`:

```js
'use strict';

// Per-instance TTL cache with serve-stale-on-failure (spec: publish-to-live <= ~2 min,
// storage outage must not take down already-cached blog pages).
function createPostCache(loadAll, { ttlMs = 60_000, now = Date.now } = {}) {
  let data = null;
  let fetchedAt = 0;
  let inflight = null;

  return async function getPosts() {
    if (data && now() - fetchedAt < ttlMs) return data;
    if (!inflight) {
      inflight = loadAll()
        .then((fresh) => { data = fresh; fetchedAt = now(); return fresh; })
        .catch((err) => {
          if (data) return data; // stale beats down
          throw err;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
}

module.exports = { createPostCache };
```

Add the dependency: in `api/`, run `npm install @azure/storage-blob` (updates `package.json` + lockfile if present).

- [ ] **Step 4: Run tests** — `cd api; npm test` → all PASS (existing handler tests must still pass).

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/blog/store.js api/src/lib/blog/cache.js api/test/blog-store.test.js api/test/blog-cache.test.js api/package.json api/package-lock.json
git commit -m "BAC-13: blob post store + TTL cache with serve-stale"
```

---

### Task 3: Router, templates, renderer

**Files:**
- Create: `api/src/lib/blog/router.js`, `api/src/lib/blog/render.js`
- Create: `api/src/blog-templates/post.html`, `index.html`, `error.html` (tokenized copies of static pages)
- Test: `api/test/blog-router.test.js`, `api/test/blog-render.test.js`

**Interfaces:**
- Consumes: post objects per the schema above.
- Produces: `routeBlogPath(pathname)` → `{kind:'index',page}` | `{kind:'post',folder,slug}` | `{kind:'media',file}` | `{kind:'notfound'}`; `render.renderPost(post)`, `render.renderIndex(allPosts, page)` (null when page out of range), `render.renderBlogSitemap(allPosts)`, `render.renderError(title, message)`, `render.publishedSorted(allPosts)`, `render.postUrlPath(post)`, `render.POSTS_PER_PAGE`.

- [ ] **Step 1: Create templates from the static mirror (exact copies, then tokenize).**

`post.html`: `cp site/blog/what-is-bonded-warehousing.html api/src/blog-templates/post.html`, then make ONLY these edits:
1. `<title>What Is Bonded Warehousing?</title>` → `<title>{{title_tag}}</title>`
2. `<meta name="description" content="" />` → `content="{{meta_description}}"`
3. canonical `href="https://baclogistics.co.za/blog/what-is-bonded-warehousing.html"` → `href="{{canonical}}"`, and add on the next line: `{{robots_meta}}`
4. `og:title` and `twitter:title` content → `{{title_tag}}`; `og:url` content → `{{canonical}}`; `og:image` and `twitter:image` content → `{{og_image}}`
5. Immediately before `</head>` add `{{json_ld}}`
6. Replace the entire `<section class="gl-blog-article-section"> … </section>` block with `{{article_section}}`

Everything else (fonts, favicon links, GTM `GTM-MPPHRHH`, full header nav, footer, trailing CouchCMS comment) stays byte-identical.

`index.html`: `cp site/blog/index.html api/src/blog-templates/index.html`, then: canonical href → `{{canonical}}`; replace all 12 `<article class="gl-blog-card">…</article>` blocks with `{{cards}}`; replace the inner `<div class="pagination">…</div>` of `<div id="b-paginate">` with `{{pagination}}`. Check the index `<title>`/og — if they contain no page-specific text, leave as-is.

`error.html`: `cp site/404.html api/src/blog-templates/error.html`, replace its `<title>` text with `{{error_title}}`, the visible headline text with `{{error_title}}`, the explanatory paragraph with `{{error_message}}`, and delete any canonical tag.

- [ ] **Step 2: Verify template assumptions against the mirror** (adjust renderer constants below if these greps disagree):

```bash
grep -o 'rel="canonical"[^>]*' site/blog/pg/2/index.html          # expected: .../blog/?pg=2 or /blog/pg/2/
grep -o 'class="prev"[^>]*\|page_disabled prev' site/blog/pg/2/index.html  # prev-link markup on page 2
grep -o '<div class="pagination">.*' site/blog/pg/8/index.html | head -c 400  # next-disabled markup on last page
```

- [ ] **Step 3: Write failing tests** — `api/test/blog-router.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { routeBlogPath } = require('../src/lib/blog/router');

test('routes blog URLs', () => {
  assert.deepStrictEqual(routeBlogPath('/blog/'), { kind: 'index', page: 1 });
  assert.deepStrictEqual(routeBlogPath('/blog'), { kind: 'index', page: 1 });
  assert.deepStrictEqual(routeBlogPath('/blog/pg/3/'), { kind: 'index', page: 3 });
  assert.deepStrictEqual(routeBlogPath('/blog/what-is-bonded-warehousing.html'),
    { kind: 'post', folder: null, slug: 'what-is-bonded-warehousing' });
  assert.deepStrictEqual(routeBlogPath('/blog/road-freight/some-post.html'),
    { kind: 'post', folder: 'road-freight', slug: 'some-post' });
  assert.deepStrictEqual(routeBlogPath('/blog/media/pic-123.png'), { kind: 'media', file: 'pic-123.png' });
  assert.strictEqual(routeBlogPath('/blog/unknown-folder/x.html').kind, 'notfound');
  assert.strictEqual(routeBlogPath('/blog/../etc/passwd').kind, 'notfound');
});
```

`api/test/blog-render.test.js` (fixture posts inline):

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const render = require('../src/lib/blog/render');

const post = (over = {}) => ({
  title: 'Test Post Heading', name: 'test-post', folder: null, date: '2026-03-24',
  author: '', featured_image: '/couch/uploads/image/blog/x.png', featured_image_alt: 'Alt text',
  excerpt: '', body: '<p>One</p><p>Two</p><p>Three</p><p>Four</p>', tags: ['Tag A', 'Tag B'],
  meta_title: 'Test Post', meta_description: 'Desc', og_image: '', canonical_url: '',
  robots: '', json_ld: '', youtube_id: '', youtube_title: '', unpublished: false, ...over,
});

test('renderPost fills head and article', () => {
  const html = render.renderPost(post());
  assert.ok(html.includes('<title>Test Post</title>'));
  assert.ok(html.includes('href="https://baclogistics.co.za/blog/test-post.html"'));
  assert.ok(html.includes('<h1 class="gl-blog-article-title">Test Post Heading</h1>'));
  assert.ok(html.includes('<span class="gl-blog-article-date">24 March 2026</span>'));
  assert.ok(html.includes('<strong>Tags:</strong> Tag A, Tag B'));
  assert.ok(html.includes('GTM-MPPHRHH')); // chrome survived tokenizing
  assert.ok(!html.includes('{{'));         // no unfilled tokens
});

test('renderPost adds video, json_ld and robots only when present', () => {
  const plain = render.renderPost(post());
  assert.ok(!plain.includes('gl-blog-article-video'));
  assert.ok(!plain.includes('application/ld+json'));
  const rich = render.renderPost(post({
    youtube_id: 'lyvv36Vc2m4', json_ld: '{"@type":"NewsArticle"}', robots: 'noindex',
  }));
  assert.ok(rich.includes('youtube.com/embed/lyvv36Vc2m4'));
  assert.ok(rich.includes('application/ld+json'));
  assert.ok(rich.includes('content="noindex"'));
});

test('folder posts get folder URLs', () => {
  assert.strictEqual(render.postUrlPath(post({ folder: 'road-freight' })),
    '/blog/road-freight/test-post.html');
});

test('renderIndex paginates 12 per page, hides unpublished, sorts date desc', () => {
  const posts = [];
  for (let i = 1; i <= 14; i++) {
    posts.push(post({ name: `p${i}`, title: `P${i}`, date: `2026-01-${String(i).padStart(2, '0')}` }));
  }
  posts.push(post({ name: 'hidden', unpublished: true, date: '2026-02-01' }));
  const page1 = render.renderIndex(posts, 1);
  assert.ok(page1.includes('/blog/p14.html'));  // newest first
  assert.ok(!page1.includes('/blog/hidden.html'));
  assert.ok(page1.includes('<span class="page_current">1</span>'));
  assert.ok(page1.includes('href="/blog/pg/2/"'));
  const page2 = render.renderIndex(posts, 2);
  assert.ok(page2.includes('/blog/p1.html'));   // oldest lands on page 2
  assert.strictEqual(render.renderIndex(posts, 3), null);
});

test('excerpt falls back to first three body paragraphs', () => {
  const html = render.renderIndex([post()], 1);
  assert.ok(html.includes('<p>Three</p>'));
  assert.ok(!html.includes('<p>Four</p>'));
});

test('renderBlogSitemap lists index + published posts', () => {
  const xml = render.renderBlogSitemap([post(), post({ name: 'z', unpublished: true })]);
  assert.ok(xml.includes('<loc>https://baclogistics.co.za/blog/</loc>'));
  assert.ok(xml.includes('<loc>https://baclogistics.co.za/blog/test-post.html</loc>'));
  assert.ok(!xml.includes('/blog/z.html'));
});

test('renderError produces branded page', () => {
  const html = render.renderError('Blog briefly unavailable', 'Try again shortly.');
  assert.ok(html.includes('Blog briefly unavailable'));
  assert.ok(!html.includes('{{'));
});
```

- [ ] **Step 4: Run to verify failure** — `cd api; npm test` → FAIL (modules missing).

- [ ] **Step 5: Implement.** `api/src/lib/blog/router.js`:

```js
'use strict';

const FOLDERS = ['road-freight', 'customs-clearing', 'mining-transport', 'liquor-transport'];

// Maps a public URL path to a blog route. Input comes from x-ms-original-url
// (SWA rewrite) or the raw /api/blog/... path — caller strips the /api prefix.
function routeBlogPath(rawPath) {
  let p;
  try { p = decodeURIComponent(rawPath); } catch { return { kind: 'notfound' }; }
  if (p === '/blog' || p === '/blog/') return { kind: 'index', page: 1 };
  const pg = p.match(/^\/blog\/pg\/(\d{1,3})\/?$/);
  if (pg) return { kind: 'index', page: Number(pg[1]) };
  const media = p.match(/^\/blog\/media\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (media) return { kind: 'media', file: media[1] };
  const folderPost = p.match(/^\/blog\/([a-z0-9-]+)\/([a-z0-9-]+)\.html$/);
  if (folderPost && FOLDERS.includes(folderPost[1])) {
    return { kind: 'post', folder: folderPost[1], slug: folderPost[2] };
  }
  const post = p.match(/^\/blog\/([a-z0-9-]+)\.html$/);
  if (post) return { kind: 'post', folder: null, slug: post[1] };
  return { kind: 'notfound' };
}

module.exports = { routeBlogPath, FOLDERS };
```

`api/src/lib/blog/render.js`:

```js
'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://baclogistics.co.za';
const POSTS_PER_PAGE = 12;
const TPL_DIR = path.join(__dirname, '..', '..', 'blog-templates');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const tplCache = new Map();
function tpl(name) {
  if (!tplCache.has(name)) tplCache.set(name, readFileSync(path.join(TPL_DIR, name), 'utf8'));
  return tplCache.get(name);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in values ? values[key] : ''));
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function postUrlPath(post) {
  return post.folder ? `/blog/${post.folder}/${post.name}.html` : `/blog/${post.name}.html`;
}

function publishedSorted(allPosts) {
  return allPosts
    .filter((p) => !p.unpublished)
    .sort((a, b) =>
      b.date.localeCompare(a.date) ||
      ((a.migrated_order ?? -1) - (b.migrated_order ?? -1)) ||
      a.name.localeCompare(b.name));
}

function firstParagraphs(html, n) {
  return (html.match(/<p\b[\s\S]*?<\/p>/g) || []).slice(0, n).join('\n');
}

function renderArticleSection(post) {
  const tagsHtml = post.tags && post.tags.length
    ? `\n                <p class="gl-blog-article-tags"><strong>Tags:</strong> ${esc(post.tags.join(', '))}</p>`
    : '';
  const imageHtml = post.featured_image
    ? `<div class="gl-blog-article-image">
                <img src="${esc(post.featured_image)}" alt="${esc(post.featured_image_alt)}" />
            </div>`
    : '';
  const videoHtml = post.youtube_id
    ? `\n            <div class="gl-blog-article-video">
                <iframe
                    src="https://www.youtube.com/embed/${esc(post.youtube_id)}"
                    title="${esc(post.youtube_title || post.title)}"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowfullscreen
                ></iframe>
            </div>`
    : '';
  return `<section class="gl-blog-article-section">
    <div class="container">
        <article class="gl-blog-article">
            <header class="gl-blog-article-header">
                <h1 class="gl-blog-article-title">${esc(post.title)}</h1>

                <div class="gl-blog-article-meta">
                    <span class="gl-blog-article-date">${formatDate(post.date)}</span>
                </div>
${tagsHtml}
            </header>

            ${imageHtml}

            <div class="gl-blog-article-body">
${post.body}
            </div>
${videoHtml}
        </article>
    </div>
</section>`;
}

function renderPost(post) {
  const canonical = post.canonical_url || `${ORIGIN}${postUrlPath(post)}`;
  return fill(tpl('post.html'), {
    title_tag: esc(post.meta_title || post.title),
    meta_description: esc(post.meta_description),
    canonical: esc(canonical),
    og_image: esc(post.og_image),
    robots_meta: post.robots ? `<meta name="robots" content="${esc(post.robots)}" />` : '',
    json_ld: post.json_ld ? `<script type="application/ld+json">\n${post.json_ld}\n</script>` : '',
    article_section: renderArticleSection(post),
  });
}

function renderCard(post) {
  const author = post.author ? `<span>${esc(post.author)}</span>                                    ` : '';
  const imageHtml = post.featured_image
    ? `<div class="gl-blog-card-image">
            <img src="${esc(post.featured_image)}" alt="${esc(post.featured_image_alt)}" />
        </div>`
    : '';
  return `<article class="gl-blog-card">
    <a class="gl-blog-card-link" href="${postUrlPath(post)}">
        ${imageHtml}
        <div class="gl-blog-card-content">
            <div class="gl-blog-card-meta">
                ${author}<span>${formatDate(post.date)}</span>
            </div>
            <h2 class="gl-blog-card-title">${esc(post.title)}</h2>
            <div class="gl-blog-card-text line-clamp-3">
${post.excerpt || firstParagraphs(post.body, 3)}
            </div>
        </div>
    </a>
</article>`;
}

// Markup mirrors the static pagination exactly (verify with Task 3 Step 2 greps).
function renderPagination(page, totalPages) {
  const href = (n) => `/blog/pg/${n}/`;
  const prev = page > 1
    ? `<a href="${href(page - 1)}" class="prev">&#171; prev</a>`
    : '<span class="page_disabled prev">&#171; prev</span>';
  const next = page < totalPages
    ? `<a href="${href(page + 1)}" class="next">next &#187;</a>`
    : '<span class="page_disabled next">next &#187;</span>';
  let nums = '';
  for (let n = 1; n <= totalPages; n++) {
    nums += n === page ? `<span class="page_current">${n}</span>` : `<a href="${href(n)}">${n}</a>`;
  }
  return `<div class="pagination">${prev}${nums}${next}</div>`;
}

function renderIndex(allPosts, page) {
  const posts = publishedSorted(allPosts);
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  if (page < 1 || page > totalPages) return null;
  const slice = posts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);
  // Canonical pattern must match the static mirror (Task 3 Step 2 grep).
  const canonical = page === 1 ? `${ORIGIN}/blog/` : `${ORIGIN}/blog/?pg=${page}`;
  return fill(tpl('index.html'), {
    canonical: esc(canonical),
    cards: slice.map(renderCard).join('\n'),
    pagination: renderPagination(page, totalPages),
  });
}

function renderBlogSitemap(allPosts) {
  const urls = [`${ORIGIN}/blog/`, ...publishedSorted(allPosts).map((p) => ORIGIN + postUrlPath(p))];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    '\n</urlset>\n';
}

function renderError(title, message) {
  return fill(tpl('error.html'), { error_title: esc(title), error_message: esc(message) });
}

module.exports = {
  renderPost, renderIndex, renderBlogSitemap, renderError,
  publishedSorted, postUrlPath, formatDate, esc, POSTS_PER_PAGE, ORIGIN,
};
```

- [ ] **Step 6: Run tests** — `cd api; npm test` → all PASS. If a fixture assertion fails because the real template differs from an assumption (e.g. index canonical), fix the template/renderer to match the mirror, not the test to match the code.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/blog/router.js api/src/lib/blog/render.js api/src/blog-templates api/test/blog-router.test.js api/test/blog-render.test.js
git commit -m "BAC-13: blog router + template renderer (markup lifted from static mirror)"
```

---

### Task 4: Public blog HTTP Functions

**Files:**
- Create: `api/src/lib/blog/handler.js`, `api/src/functions/blog.js`
- Test: `api/test/blog-handler.test.js`

**Interfaces:**
- Consumes: `routeBlogPath`, `render.*`, and a `deps` object `{ getPosts(), getMedia(file), log(msg) }`.
- Produces: `handleBlogRequest(pathname, deps)` → `{status, headers, body}`; HTTP routes `blog/{*path}`, `blog`, `sitemap-blog.xml` on the Functions app (reachable pre-cutover at `/api/blog/...` and `/api/sitemap-blog.xml`).

- [ ] **Step 1: Write failing tests** — `api/test/blog-handler.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { handleBlogRequest } = require('../src/lib/blog/handler');

const fixture = {
  title: 'Handler Post', name: 'handler-post', folder: null, date: '2026-05-01',
  author: '', featured_image: '', featured_image_alt: '', excerpt: '',
  body: '<p>Body</p>', tags: [], meta_title: '', meta_description: '', og_image: '',
  canonical_url: '', robots: '', json_ld: '', youtube_id: '', youtube_title: '', unpublished: false,
};

const deps = (over = {}) => ({
  getPosts: async () => [fixture],
  getMedia: async () => null,
  log: () => {},
  ...over,
});

test('serves a post with cache headers', async () => {
  const res = await handleBlogRequest('/blog/handler-post.html', deps());
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Cache-Control'], 'public, max-age=60');
  assert.ok(res.body.includes('Handler Post'));
});

test('strips the /api prefix from direct function calls', async () => {
  const res = await handleBlogRequest('/api/blog/handler-post.html', deps());
  assert.strictEqual(res.status, 200);
});

test('unknown slug and unpublished posts return branded 404', async () => {
  const missing = await handleBlogRequest('/blog/nope.html', deps());
  assert.strictEqual(missing.status, 404);
  const hidden = await handleBlogRequest('/blog/handler-post.html',
    deps({ getPosts: async () => [{ ...fixture, unpublished: true }] }));
  assert.strictEqual(hidden.status, 404);
});

test('storage failure with no cache returns branded 503, no-store', async () => {
  const res = await handleBlogRequest('/blog/', deps({ getPosts: async () => { throw new Error('down'); } }));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
});

test('media route streams blob with long cache', async () => {
  const res = await handleBlogRequest('/blog/media/x.png',
    deps({ getMedia: async () => ({ buffer: Buffer.from('png'), contentType: 'image/png' }) }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['Content-Type'], 'image/png');
  assert.ok(res.headers['Cache-Control'].includes('max-age=31536000'));
});

test('sitemap path renders xml', async () => {
  const res = await handleBlogRequest('/sitemap-blog.xml', deps());
  assert.ok(res.body.includes('/blog/handler-post.html'));
  assert.ok(res.headers['Content-Type'].includes('xml'));
});
```

- [ ] **Step 2: Run to verify failure** — `cd api; npm test` → FAIL.

- [ ] **Step 3: Implement.** `api/src/lib/blog/handler.js`:

```js
'use strict';

const { routeBlogPath } = require('./router');
const render = require('./render');

const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' };

function notFound() {
  return {
    status: 404,
    headers: { ...HTML, 'Cache-Control': 'no-store' },
    body: render.renderError('Page not found', 'That blog page does not exist. Visit /blog/ for the latest posts.'),
  };
}

async function handleBlogRequest(pathname, deps) {
  const publicPath = pathname.replace(/^\/api(?=\/)/, '');

  if (publicPath === '/sitemap-blog.xml') {
    try {
      const posts = await deps.getPosts();
      return {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
        body: render.renderBlogSitemap(posts),
      };
    } catch (err) {
      deps.log(`sitemap-blog storage failure: ${err.message}`);
      return { status: 503, headers: { 'Cache-Control': 'no-store' }, body: '' };
    }
  }

  const route = routeBlogPath(publicPath);

  if (route.kind === 'media') {
    const media = await deps.getMedia(route.file).catch((err) => {
      deps.log(`media read failure: ${err.message}`);
      return null;
    });
    if (!media) return notFound();
    return {
      status: 200,
      headers: { 'Content-Type': media.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: media.buffer,
    };
  }

  let posts;
  try {
    posts = await deps.getPosts();
  } catch (err) {
    deps.log(`blog storage failure: ${err.message}`);
    return {
      status: 503,
      headers: { ...HTML, 'Cache-Control': 'no-store' },
      body: render.renderError('Blog briefly unavailable',
        'Our blog is having a moment — please try again in a minute. The rest of the site is unaffected.'),
    };
  }

  if (route.kind === 'index') {
    const html = render.renderIndex(posts, route.page);
    if (html == null) return notFound();
    return { status: 200, headers: HTML, body: html };
  }

  if (route.kind === 'post') {
    const post = posts.find((p) =>
      p.name === route.slug && (p.folder || null) === route.folder && !p.unpublished);
    if (!post) return notFound();
    return { status: 200, headers: HTML, body: render.renderPost(post) };
  }

  return notFound();
}

module.exports = { handleBlogRequest };
```

`api/src/functions/blog.js`:

```js
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
```

Note: `{status, headers, body}` from `handleBlogRequest` is already a valid v4 response object (body may be string or Buffer).

- [ ] **Step 4: Run tests** — `cd api; npm test` → all PASS.

- [ ] **Step 5: Smoke locally (needs Task 1's `local.settings.json`; container may be empty — expect an empty index, not an error).** `cd api; func start`, then `curl -s http://localhost:7071/api/blog/ | head -40`. Expected: the blog index chrome with zero cards (or 503 branded page ONLY if the connection string is wrong — that means fix settings, not code).

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/blog/handler.js api/src/functions/blog.js api/test/blog-handler.test.js
git commit -m "BAC-13: public blog HTTP function (index, pagination, posts, media, sitemap)"
```

---

### Task 5: Migration script (static pages → post JSON)

**Files:**
- Create: `scripts/migrate-blog.mjs`
- Output (untracked): `scripts/out/blog-posts/*.json` — add `scripts/out/` to `.gitignore`.

**Interfaces:**
- Consumes: `site/blog/**/*.html`.
- Produces: one JSON file per post matching the schema; console report. Upload happens via `az storage blob upload-batch` (with the user, Step 4).

- [ ] **Step 1: Write the script.** `scripts/migrate-blog.mjs`:

```js
// One-off BAC-13 migration: parse each static blog post page in site/blog/
// into a post JSON blob (schema: docs/superpowers/plans/2026-07-17-bac13-dynamic-blog.md).
// Zero dependencies, mirrors the mirror.mjs style. Usage:
//   node scripts/migrate-blog.mjs          # writes scripts/out/blog-posts/*.json + report
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BLOG = path.join(ROOT, 'site', 'blog');
const OUT = path.join(ROOT, 'scripts', 'out', 'blog-posts');
const FOLDERS = ['road-freight', 'customs-clearing', 'mining-transport', 'liquor-transport'];
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

const warnings = [];
const warn = (slug, msg) => warnings.push(`${slug}: ${msg}`);

// --- helpers -------------------------------------------------------------
const grab = (html, re) => (html.match(re) || [])[1] ?? '';

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

// Inner HTML of the first div matched by openRe, honoring nested divs.
function divInner(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 1;
  for (let t; (t = re.exec(html)); ) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return null;
}

function toIsoDate(text, slug) {
  const m = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) { warn(slug, `unparseable date "${text}"`); return '1970-01-01'; }
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// --- card map (author/excerpt/order come from the listing pages) ---------
async function buildCardMap() {
  const map = new Map(); // href -> { author, excerpt, order }
  const listingFiles = [path.join(BLOG, 'index.html')];
  for (let n = 2; n <= 8; n++) listingFiles.push(path.join(BLOG, 'pg', String(n), 'index.html'));
  let order = 0;
  for (const file of listingFiles) {
    const html = await readFile(file, 'utf8');
    for (const m of html.matchAll(/<article class="gl-blog-card">/g)) {
      const card = divlessSlice(html, m.index);
      const href = grab(card, /class="gl-blog-card-link" href="([^"]+)"/);
      const metaInner = divInner(card, /<div class="gl-blog-card-meta">/) || '';
      const spans = [...metaInner.matchAll(/<span>([^<]*)<\/span>/g)].map((s) => decode(s[1]));
      const excerpt = (divInner(card, /<div class="gl-blog-card-text line-clamp-3">/) || '').trim();
      map.set(href, { author: spans.length > 1 ? spans[0] : '', excerpt, order: order++ });
    }
  }
  return map;
}

// Slice from an <article ...> opening tag to its matching close.
function divlessSlice(html, from) {
  const end = html.indexOf('</article>', from);
  return html.slice(from, end === -1 ? html.length : end);
}

// --- per-post extraction -------------------------------------------------
function parsePost(html, slug, folder, cardMap) {
  const title = decode(grab(html, /<h1 class="gl-blog-article-title">([\s\S]*?)<\/h1>/));
  if (!title) warn(slug, 'missing h1 title');
  const dateText = decode(grab(html, /<span class="gl-blog-article-date">([\s\S]*?)<\/span>/));
  const tagsText = decode(grab(html, /<p class="gl-blog-article-tags"><strong>Tags:<\/strong>\s*([\s\S]*?)<\/p>/));
  const imageBlock = divInner(html, /<div class="gl-blog-article-image">/) || '';
  const body = divInner(html, /<div class="gl-blog-article-body">/);
  if (body == null) warn(slug, 'missing article body');
  const videoBlock = divInner(html, /<div class="gl-blog-article-video">/) || '';
  let json_ld = '';
  const ld = html.match(/<script type="application\/ld\+json">\s*(?:<script[^>]*>)?\s*([\s\S]*?)\s*<\/script>/);
  if (ld) {
    try { json_ld = JSON.stringify(JSON.parse(ld[1]), null, 2); }
    catch { warn(slug, 'json-ld present but unparseable — carried over raw'); json_ld = ld[1]; }
  }
  const href = folder ? `/blog/${folder}/${slug}.html` : `/blog/${slug}.html`;
  const card = cardMap.get(href);
  if (!card) warn(slug, 'no listing card found (author/excerpt/order missing)');

  return {
    title,
    name: slug,
    folder,
    date: toIsoDate(dateText, slug),
    author: card?.author ?? '',
    featured_image: grab(imageBlock, /src="([^"]*)"/),
    featured_image_alt: decode(grab(imageBlock, /alt="([^"]*)"/)),
    excerpt: card?.excerpt ?? '',
    body: (body ?? '').trim(),
    tags: tagsText ? tagsText.split(',').map((t) => t.trim()).filter(Boolean) : [],
    meta_title: decode(grab(html, /<title>([\s\S]*?)<\/title>/)),
    meta_description: decode(grab(html, /<meta name="description" content="([^"]*)"/)),
    og_image: grab(html, /<meta property="og:image" content="([^"]*)"/),
    canonical_url: grab(html, /<link rel="canonical" href="([^"]*)"/),
    robots: grab(html, /<meta name="robots" content="([^"]*)"/),
    json_ld,
    youtube_id: grab(videoBlock, /youtube\.com\/embed\/([A-Za-z0-9_-]+)/),
    youtube_title: decode(grab(videoBlock, /title="([^"]*)"/)),
    unpublished: false,
    ...(card ? { migrated_order: card.order } : {}),
  };
}

// --- main ----------------------------------------------------------------
const cardMap = await buildCardMap();
await mkdir(OUT, { recursive: true });
const posts = [];

async function walkPosts(dir, folder) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (folder === null && FOLDERS.includes(entry.name)) await walkPosts(full, entry.name);
      continue; // pg/ and anything else: not posts
    }
    if (!entry.name.endsWith('.html') || entry.name === 'index.html') continue;
    const slug = entry.name.replace(/\.html$/, '');
    posts.push(parsePost(await readFile(full, 'utf8'), slug, folder, cardMap));
  }
}
await walkPosts(BLOG, null);

for (const post of posts) {
  await writeFile(path.join(OUT, `${post.name}.json`), JSON.stringify(post, null, 2) + '\n');
}

console.log(`Wrote ${posts.length} posts to ${OUT}`);
console.log(`Folders: ${JSON.stringify(Object.fromEntries(
  FOLDERS.map((f) => [f, posts.filter((p) => p.folder === f).length])))}`);
console.log(`With card data: ${posts.filter((p) => 'migrated_order' in p).length}/${posts.length}`);
if (warnings.length) { console.log('\nWARNINGS:'); for (const w of warnings) console.log('  ' + w); }
```

- [ ] **Step 2: Run it** — `node scripts/migrate-blog.mjs`. Expected: `Wrote 90 posts`, folder counts `{road-freight: 2, customs-clearing: 3, mining-transport: 1, liquor-transport: 1}`, `With card data: 90/90`, and few/no warnings. Investigate every warning (open the named file, fix the parser — not the data — unless the source page is genuinely broken; the one known nested-`<script>` JSON-LD bug in `why-industry-experience-matters-in-regulated-freight.html` is handled by the regex above).

- [ ] **Step 3: Spot-check 3 JSON files** (one plain, one folder post, the video post `road-bonds-explained-moving-goods-under-customs-control`): fields populated, body starts/ends where the static page's does, `youtube_id` = `lyvv36Vc2m4` on the video post.

- [ ] **Step 4: Upload (WITH the user — writes to their storage account, negligible cost):**

```
az storage blob upload-batch --destination blog --destination-path posts --source scripts/out/blog-posts --pattern "*.json" --content-type "application/json" --connection-string "<CONN>"
```

Verify: `az storage blob list --container-name blog --prefix posts/ --connection-string "<CONN>" --query "length(@)"` → `90`.

- [ ] **Step 5: Add `scripts/out/` to `.gitignore` and commit**

```bash
git add scripts/migrate-blog.mjs .gitignore
git commit -m "BAC-13: one-off migration script, static blog pages -> post JSON"
```

---

### Task 6: Diff gate (rendered vs static) — red then green

**Files:**
- Create: `scripts/diff-blog.mjs`

**Interfaces:**
- Consumes: `site/blog/**` (truth) and a deployed Functions app at `<base>/api/blog/...`.
- Produces: pass/fail report; exit 1 on any mismatch. This is the acceptance gate before deleting anything from `site/`.

- [ ] **Step 1: Write the script.** `scripts/diff-blog.mjs`:

```js
// BAC-13 acceptance gate: compare every static blog page against the
// Function-rendered version. Usage:
//   node scripts/diff-blog.mjs https://<deployment-host>
// Fetches <base>/api/blog/<path> (works pre-cutover; post-cutover /blog/<path> too).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.argv[2]?.replace(/\/$/, '');
if (!BASE) { console.error('usage: node scripts/diff-blog.mjs <base-url>'); process.exit(2); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BLOG = path.join(ROOT, 'site', 'blog');
const FOLDERS = ['road-freight', 'customs-clearing', 'mining-transport', 'liquor-transport'];

const grab = (html, re) => (html.match(re) || [])[1] ?? '';
const norm = (s) => s.replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const text = (html) => norm(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

function divInner(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return '';
  const start = m.index + m[0].length;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 1;
  for (let t; (t = re.exec(html)); ) {
    depth += t[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return '';
}

function postFacts(html) {
  return {
    title_tag: norm(grab(html, /<title>([\s\S]*?)<\/title>/)),
    canonical: grab(html, /<link rel="canonical" href="([^"]*)"/),
    description: grab(html, /<meta name="description" content="([^"]*)"/),
    og_image: grab(html, /<meta property="og:image" content="([^"]*)"/),
    h1: text(grab(html, /<h1 class="gl-blog-article-title">([\s\S]*?)<\/h1>/)),
    date: norm(grab(html, /<span class="gl-blog-article-date">([\s\S]*?)<\/span>/)),
    tags: text(grab(html, /<p class="gl-blog-article-tags">([\s\S]*?)<\/p>/)),
    featured: grab(divInner(html, /<div class="gl-blog-article-image">/), /src="([^"]*)"/),
    body_text: text(divInner(html, /<div class="gl-blog-article-body">/)),
    body_images: [...divInner(html, /<div class="gl-blog-article-body">/).matchAll(/src="([^"]*)"/g)].map((m) => m[1]).join(' '),
    youtube: grab(html, /youtube\.com\/embed\/([A-Za-z0-9_-]+)/),
  };
}

function listingFacts(html) {
  const cards = [];
  for (const m of html.matchAll(/<article class="gl-blog-card">([\s\S]*?)<\/article>/g)) {
    cards.push({
      href: grab(m[1], /href="([^"]+)"/),
      title: text(grab(m[1], /<h2 class="gl-blog-card-title">([\s\S]*?)<\/h2>/)),
      meta: text(divInner(m[1], /<div class="gl-blog-card-meta">/)),
    });
  }
  const pagination = [...(grab(html, /<div class="pagination">([\s\S]*?)<\/div>/) || '')
    .matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(' ');
  return { cards: JSON.stringify(cards), pagination };
}

let failures = 0;
async function compare(label, urlPath, factsFn) {
  const staticFile = urlPath === '/blog/' ? path.join(BLOG, 'index.html')
    : urlPath.startsWith('/blog/pg/') ? path.join(BLOG, 'pg', urlPath.split('/')[3], 'index.html')
    : path.join(BLOG, ...urlPath.replace('/blog/', '').split('/'));
  const expected = factsFn(await readFile(staticFile, 'utf8'));
  const res = await fetch(`${BASE}/api${urlPath === '/blog/' ? '/blog/' : urlPath.replace('/blog', '/blog')}`.replace('/api/blog', '/api/blog'), { redirect: 'manual' });
  if (res.status !== 200) { console.log(`FAIL ${label}: HTTP ${res.status}`); failures++; return; }
  const actual = factsFn(await res.text());
  const diffs = Object.keys(expected).filter((k) => expected[k] !== actual[k]);
  if (diffs.length) {
    failures++;
    console.log(`FAIL ${label}`);
    for (const k of diffs) console.log(`  ${k}\n    static:   ${String(expected[k]).slice(0, 200)}\n    rendered: ${String(actual[k]).slice(0, 200)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// Post pages
async function* postPaths() {
  for (const entry of await readdir(BLOG, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html') && entry.name !== 'index.html') yield `/blog/${entry.name}`;
    if (entry.isDirectory() && FOLDERS.includes(entry.name)) {
      for (const f of await readdir(path.join(BLOG, entry.name))) {
        if (f.endsWith('.html')) yield `/blog/${entry.name}/${f}`;
      }
    }
  }
}

for await (const p of postPaths()) await compare(p, p, postFacts);
await compare('/blog/', '/blog/', listingFacts);
for (let n = 1; n <= 8; n++) await compare(`/blog/pg/${n}/`, `/blog/pg/${n}/`, listingFacts);

console.log(failures ? `\n${failures} FAILURES` : '\nALL PAGES MATCH');
process.exit(failures ? 1 : 0);
```

Note the fetch URL construction: for path `/blog/x.html` it requests `<BASE>/api/blog/x.html`. Simplify that expression to `` `${BASE}/api${urlPath}` `` when implementing — the convoluted replace chain above is equivalent; use the simple form.

- [ ] **Step 2: RED run (prove the gate can fail).** Temporarily edit one JSON in `scripts/out/blog-posts/` (change a title), re-upload that one blob, run against the deployed base once Task 7 Step 1's PR preview (or production post-merge of the function-only changes) is up, and confirm the script reports exactly that one FAIL. Revert the JSON, re-upload, wait ~60s (cache TTL).

- [ ] **Step 3: GREEN run** — `node scripts/diff-blog.mjs <base>` → `ALL PAGES MATCH`, exit 0. Iterate on renderer/migration until green: every mismatch is a real fidelity bug — fix code or data, never the comparison (loosen a comparison only if the difference is provably cosmetic whitespace the `norm()` already should cover).

- [ ] **Step 4: Commit**

```bash
git add scripts/diff-blog.mjs
git commit -m "BAC-13: rendered-vs-static diff gate for the migration"
```

---

### Task 7: Ship the Function pre-cutover, then the cutover PR

**Files:**
- Modify: `site/staticwebapp.config.json`, `site/sitemap.xml`, `scripts/verify-site.mjs`, `README.md`, `DESIGN.md`
- Create: `site/sitemap-static.xml`
- Delete: `site/blog/**` (90 posts, index, `pg/1..8`) — ONLY after Task 6 is green.

**Interfaces:**
- Consumes: green diff gate; deployed function.
- Produces: live dynamic blog at the public URLs; sitemap index; verify-site covering blob-backed blog URLs.

- [ ] **Step 1: Pre-cutover deploy of the Functions (safe: no route changes yet).** Merge the feature branch into `develop`, open PR `develop → main` with `gh pr create` titled "BAC-13 (1/2): blog Function + migration tooling (no route changes)". **User merges.** The static blog still serves; the Function is reachable only at `/api/blog/...`. Then check app settings reach the API: `curl -s https://<prod-host>/api/blog/ | head -5` → blog index HTML (NOT the branded 503; a 503 means `BLOG_STORAGE_CONNECTION` isn't visible — fix with the user via `az staticwebapp appsettings set` before proceeding). Run the Task 6 red-then-green gate against the production host now.

- [ ] **Step 2 (new branch `feature/bac-13-cutover` off develop): route the blog to the Function.** In `site/staticwebapp.config.json`, insert at the TOP of the `routes` array (SWA is first-match; admin entries land here in Task 8 too):

```json
{ "route": "/blog", "rewrite": "/api/blog" },
{ "route": "/blog/*", "rewrite": "/api/blog" },
{ "route": "/sitemap-blog.xml", "rewrite": "/api/sitemap-blog.xml" },
```

(The existing `/news/...` redirect keeps pointing at `/blog/...html`, which now rewrites to the Function — chain works, leave it.)

- [ ] **Step 3: Sitemap split.**
1. `cp site/sitemap.xml site/sitemap-static.xml`, then delete from `sitemap-static.xml` every `<url>` block whose `<loc>` contains `/blog/` (87 of them). One-liner check: `grep -c '/blog/' site/sitemap-static.xml` → `0`.
2. Replace `site/sitemap.xml` entirely with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://baclogistics.co.za/sitemap-static.xml</loc></sitemap>
  <sitemap><loc>https://baclogistics.co.za/sitemap-blog.xml</loc></sitemap>
</sitemapindex>
```

- [ ] **Step 4: Delete the static blog** — `git rm -r site/blog` (only now, with Task 6 green against production). `/couch/uploads/` stays — migrated posts reference those images.

- [ ] **Step 5: verify-site.mjs.** After the static URL list is built from `walkHtml(SITE)`, merge in the dynamic blog URLs. Add:

```js
// BAC-13: blog pages are dynamic (blob-backed); enumerate them from the live
// blog sitemap instead of the filesystem, plus derived pagination pages.
async function blogUrls(base) {
  const res = await fetch(new URL('/sitemap-blog.xml', base));
  if (!res.ok) throw new Error(`sitemap-blog.xml: HTTP ${res.status}`);
  const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  const postCount = locs.filter((p) => p.endsWith('.html')).length;
  for (let n = 1; n <= Math.max(1, Math.ceil(postCount / 12)); n++) locs.push(`/blog/pg/${n}/`);
  return locs;
}
```

and call it where the page list is assembled (`urls.push(...await blogUrls(BASE))` — match the file's existing variable names when wiring in). Run `node scripts/verify-site.mjs` against the PR preview once available.

- [ ] **Step 6: Docs.**
- `README.md`: replace the blog-publishing section (the "clunky part" describing copy-an-HTML-file + PR) with: blog is dynamic — Functions render `/blog/*` from Azure Blob Storage (`blog` container, post JSON + images), publishing happens in `/admin/` with zero deploys; update the layout table (`site/` no longer contains `blog/`; `api/` = contact form + blog + admin API); update page counts ("47 static pages in `site/` + ~90 blob-backed blog posts served dynamically" — use the real count from `git rm` output); local preview: `python -m http.server` for static-only, `swa start site --api-location api` for the full site incl. blog.
- `DESIGN.md`: add one line — blog page templates now live in `api/src/blog-templates/` (tokenized copies of the static markup); edit them there, not in `site/`.

- [ ] **Step 7: Cutover PR.** Commit, merge feature → develop, `gh pr create` develop → main titled "BAC-13 (2/2): cutover — /blog/* served from Blob Storage". On the PR preview environment: spot-check `/blog/`, one post, one folder post, `/blog/pg/8/`, `/sitemap-blog.xml`, and one static page (unaffected). Run `node scripts/verify-site.mjs <preview-url>` and `node scripts/diff-blog.mjs <preview-url>`. **User merges.** After merge: re-run both scripts against production, and comment on Jira BAC-13 with results.

---

### Task 8: Admin API (auth + CRUD + upload)

**Files:**
- Create: `api/src/lib/blog/auth.js`, `api/src/lib/blog/admin.js`, `api/src/functions/admin-blog.js`
- Modify: `site/staticwebapp.config.json` (auth routes; ships with Task 9's PR)
- Test: `api/test/blog-auth.test.js`, `api/test/blog-admin.test.js`

**Interfaces:**
- Consumes: `createBlogStore` (Task 2), `getShared()` from `api/src/functions/blog.js` (Task 4).
- Produces: `getClientPrincipal(request)`, `requireRole(request, role)` → `null | {status, jsonBody}`; `validatePost(input)` → `{errors: string[], post}`; HTTP routes `GET /api/admin/posts`, `GET|PUT|DELETE /api/admin/posts/{slug}`, `POST /api/admin/upload`.

- [ ] **Step 1: Failing tests.** `api/test/blog-auth.test.js`:

```js
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
```

`api/test/blog-admin.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { validatePost } = require('../src/lib/blog/admin');

const valid = {
  title: 'T', name: 'my-post', folder: null, date: '2026-07-17',
  body: '<p>hello</p>', tags: ['a'], unpublished: false,
};

test('valid post passes and is normalized', () => {
  const { errors, post } = validatePost({ ...valid, author: '  BAC  ', junk_field: 'dropped' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(post.author, 'BAC');
  assert.ok(!('junk_field' in post));
});

test('rejects bad slug, folder, date, empty body', () => {
  assert.ok(validatePost({ ...valid, name: 'Bad Slug!' }).errors.length);
  assert.ok(validatePost({ ...valid, folder: 'not-a-folder' }).errors.length);
  assert.ok(validatePost({ ...valid, date: '17/07/2026' }).errors.length);
  assert.ok(validatePost({ ...valid, body: '  ' }).errors.length);
});

test('rejects invalid json_ld and oversized body', () => {
  assert.ok(validatePost({ ...valid, json_ld: '{nope' }).errors.length);
  assert.ok(validatePost({ ...valid, body: 'x'.repeat(600 * 1024) }).errors.length);
});
```

- [ ] **Step 2: Run to verify failure**, then implement. `api/src/lib/blog/auth.js`:

```js
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
```

`api/src/lib/blog/admin.js`:

```js
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
```

`api/src/functions/admin-blog.js`:

```js
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
```

- [ ] **Step 3: Run tests** — `cd api; npm test` → all PASS.

- [ ] **Step 4: staticwebapp.config.json auth entries** (top of `routes`, before the blog rewrites; committed here, ships with Task 9's PR):

```json
{ "route": "/admin*", "allowedRoles": ["blog_author"] },
{ "route": "/api/admin/*", "allowedRoles": ["blog_author"] },
{ "route": "/.auth/login/github", "statusCode": 404 },
{ "route": "/.auth/login/twitter", "statusCode": 404 },
```

and add alongside the existing `responseOverrides` entry:

```json
"401": { "redirect": "/.auth/login/aad?post_login_redirect_uri=/admin/", "statusCode": 302 }
```

(Entra ID is the only login left enabled; unauthenticated hits on `/admin/` bounce straight to the Microsoft login.)

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/blog/auth.js api/src/lib/blog/admin.js api/src/functions/admin-blog.js api/test/blog-auth.test.js api/test/blog-admin.test.js site/staticwebapp.config.json
git commit -m "BAC-13: admin API (role-guarded CRUD + image upload) and auth routes"
```

---

### Task 9: Admin UI (Couch-style form)

**Files:**
- Create: `site/admin/index.html`, `site/admin/admin.css`, `site/admin/admin.js`

**Interfaces:**
- Consumes: `/api/admin/posts` (GET list), `/api/admin/posts/<slug>` (GET/PUT/DELETE), `/api/admin/upload` (POST), `/.auth/me` (who am I), `/.auth/logout`.
- Produces: list view + editor replicating the Couch form. Styling: DESIGN.md tokens (Roboto, `--accent` #e2202a, `--border`, `--radius` 18px, `.btn-2`-style primary buttons), `adm-` class prefix, single column under 700px. No external/CDN resources.

- [ ] **Step 1: `site/admin/index.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta content="width=device-width, initial-scale=1" name="viewport">
    <meta name="robots" content="noindex">
    <title>Blog Admin — BAC Logistics</title>
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="stylesheet" href="/inc/css/main.css">
    <link rel="stylesheet" href="/admin/admin.css">
</head>
<body class="adm">
    <header class="adm-topbar">
        <span class="adm-logo">BAC Logistics — Blog Admin</span>
        <span class="adm-user" id="adm-user"></span>
        <a class="adm-logout" href="/.auth/logout">Log out</a>
    </header>

    <main class="adm-main">
        <!-- List view -->
        <section id="adm-list-view">
            <div class="adm-list-head">
                <h1>Posts</h1>
                <button class="adm-btn adm-btn-primary" id="adm-new">+ New post</button>
            </div>
            <table class="adm-table" id="adm-table">
                <thead><tr><th>Title</th><th>Folder</th><th>Date</th><th>Status</th></tr></thead>
                <tbody></tbody>
            </table>
        </section>

        <!-- Editor view -->
        <section id="adm-edit-view" hidden>
            <div class="adm-list-head">
                <h1 id="adm-edit-title">New post</h1>
                <div>
                    <button class="adm-btn" id="adm-back">&#171; Back to list</button>
                    <button class="adm-btn adm-btn-primary" id="adm-save">Save &amp; publish</button>
                </div>
            </div>
            <p class="adm-status" id="adm-status" role="status"></p>

            <form class="adm-form" id="adm-form">
                <div class="adm-grid">
                    <label>Title *<input name="title" required></label>
                    <label>Slug (URL name) *<input name="name" pattern="[a-z0-9][a-z0-9-]*" required></label>
                    <label>Folder
                        <select name="folder">
                            <option value="">— none —</option>
                            <option value="road-freight">Road Freight</option>
                            <option value="customs-clearing">Customs Clearing</option>
                            <option value="mining-transport">Mining Transport</option>
                            <option value="liquor-transport">Liquor Transport</option>
                        </select>
                    </label>
                    <label>Date *<input name="date" type="date" required></label>
                    <label>Author<input name="author" placeholder="BAC Logistics"></label>
                    <label>Tags (comma-separated)<input name="tags"></label>
                </div>

                <fieldset class="adm-fieldset">
                    <legend>Featured image</legend>
                    <div class="adm-grid">
                        <label>Image URL<input name="featured_image"></label>
                        <label>Alt text<input name="featured_image_alt"></label>
                    </div>
                    <label class="adm-upload">Upload new image
                        <input type="file" id="adm-featured-file" accept=".png,.jpg,.jpeg,.webp,.gif">
                    </label>
                    <img id="adm-featured-preview" class="adm-preview" alt="" hidden>
                </fieldset>

                <fieldset class="adm-fieldset">
                    <legend>Body *</legend>
                    <div class="adm-toolbar" id="adm-toolbar">
                        <button type="button" data-cmd="bold"><b>B</b></button>
                        <button type="button" data-cmd="italic"><i>I</i></button>
                        <button type="button" data-block="h2">H2</button>
                        <button type="button" data-block="h3">H3</button>
                        <button type="button" data-block="p">&para;</button>
                        <button type="button" data-cmd="insertUnorderedList">&bull; List</button>
                        <button type="button" data-cmd="insertOrderedList">1. List</button>
                        <button type="button" id="adm-link">Link</button>
                        <button type="button" id="adm-body-image">Image&#8230;</button>
                        <input type="file" id="adm-body-file" accept=".png,.jpg,.jpeg,.webp,.gif" hidden>
                    </div>
                    <div class="adm-editor" id="adm-editor" contenteditable="true"></div>
                </fieldset>

                <fieldset class="adm-fieldset">
                    <legend>SEO &amp; extras (optional)</legend>
                    <div class="adm-grid">
                        <label>Meta title<input name="meta_title"></label>
                        <label>Meta description<input name="meta_description"></label>
                        <label>Card excerpt (HTML)<input name="excerpt"></label>
                        <label>OG image URL<input name="og_image"></label>
                        <label>Canonical URL<input name="canonical_url"></label>
                        <label>Robots<input name="robots" placeholder="e.g. noindex"></label>
                        <label>YouTube video ID<input name="youtube_id"></label>
                        <label>YouTube title<input name="youtube_title"></label>
                    </div>
                    <label>JSON-LD<textarea name="json_ld" rows="4"></textarea></label>
                    <label class="adm-check"><input type="checkbox" name="unpublished"> Unpublished (hide from the site)</label>
                </fieldset>

                <div class="adm-danger">
                    <button type="button" class="adm-btn adm-btn-danger" id="adm-delete" hidden>Delete post</button>
                </div>
            </form>
        </section>
    </main>
    <script src="/admin/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: `site/admin/admin.css`** (uses main.css `:root` tokens):

```css
/* BAC blog admin — Couch-style, DESIGN.md tokens, adm- prefix. */
.adm { background: #f4f5f7; font-family: 'Roboto', sans-serif; color: var(--text); margin: 0; }
.adm-topbar { display: flex; align-items: center; gap: 16px; padding: 14px 24px;
  background: var(--brand-blue); color: #fff; }
.adm-logo { font-weight: 700; }
.adm-user { margin-left: auto; opacity: .8; font-size: .9rem; }
.adm-logout { color: #fff; text-decoration: underline; }
.adm-main { max-width: 1000px; margin: 32px auto; padding: 0 16px; }
.adm-list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.adm-btn { min-height: 48px; padding: 10px 22px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); cursor: pointer; font: inherit; }
.adm-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.adm-btn-danger { background: #fff; border-color: var(--accent); color: var(--accent); }
.adm-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.adm-table { width: 100%; border-collapse: collapse; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.adm-table th, .adm-table td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.adm-table tbody tr { cursor: pointer; }
.adm-table tbody tr:hover { background: var(--accent-soft); }
.adm-unpublished { color: var(--text-muted); font-style: italic; }
.adm-form label { display: block; font-weight: 600; margin: 12px 0 4px; }
.adm-form input, .adm-form select, .adm-form textarea { width: 100%; box-sizing: border-box;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; font: inherit; font-weight: 400; }
.adm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
.adm-fieldset { border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 16px 20px; margin: 20px 0; }
.adm-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.adm-toolbar button { min-height: 36px; padding: 4px 12px; border: 1px solid var(--border);
  border-radius: 8px; background: #fff; cursor: pointer; font: inherit; }
.adm-editor { min-height: 320px; background: #fff; border: 1px solid var(--border);
  border-radius: 12px; padding: 16px; line-height: 1.65; }
.adm-editor:focus { outline: 2px solid var(--accent); }
.adm-editor img { max-width: 100%; }
.adm-preview { max-width: 240px; border-radius: 12px; margin-top: 8px; }
.adm-status { min-height: 1.2em; font-weight: 600; }
.adm-status.ok { color: #1a7f37; }
.adm-status.err { color: var(--accent); }
.adm-check input { width: auto; margin-right: 8px; }
.adm-danger { margin: 24px 0; }
@media (max-width: 700px) { .adm-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: `site/admin/admin.js`:**

```js
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
    setStatus('Saving…');
    await api(`/api/admin/posts/${post.name}`, { method: 'PUT', body: JSON.stringify(post) });
    state.editingSlug = post.name;
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
```

- [ ] **Step 4: Local test with the SWA emulator** (it simulates auth + roles): from repo root, `swa start site --api-location api` (install note for the user if missing: `npm i -g @azure/static-web-apps-cli` — dev machine only, not the repo). Open `http://localhost:4280/admin/`, use the emulator's fake login screen, add role `blog_author`, confirm: list loads real posts (Task 5 data), opening a post fills the form, Save round-trips (re-open shows the edit), a post WITHOUT the role gets 401/403 (log in without the role and hit `/api/admin/posts` directly). Then verify the public side shows an edit after ~60s at `http://localhost:4280/blog/`.

- [ ] **Step 5: Commit**

```bash
git add site/admin
git commit -m "BAC-13: Couch-style /admin UI (list, editor, uploads) behind SWA auth"
```

---

### Task 10: Role invitation, live E2E publish, author guide, closeout

**Files:**
- Create: `docs/blog-author-guide.md`
- Modify: `README.md` (link the guide)

- [ ] **Step 1: Ship it.** Merge feature branch → develop, `gh pr create` develop → main titled "BAC-13 (3/3): admin UI + API". User merges. (Preview envs can't test Entra invitations properly — roles are invited per-hostname — so auth E2E happens on production.)

- [ ] **Step 2: Invite the authors (WITH the user — outward-facing).** Explain: this sends no email; it generates an invitation link to pass on. MFA follows their tenant policy; recommend keeping it on. For each of `rourke9001@gmail.com` (test) and `developer@baclogistics.co.za`:

```
az staticwebapp users invite --name <SWA_NAME> --resource-group <RG> --authentication-provider aad --user-details <EMAIL> --roles blog_author --domain <PUBLIC_HOSTNAME> --invitation-expiration-in-hours 168
```

`<PUBLIC_HOSTNAME>` = the domain users will visit (custom domain if configured, else the azurestaticapps.net hostname). The invitee opens the returned URL, signs in with Entra ID, and the role sticks to their account. Verify with `az staticwebapp users list --name <SWA_NAME> --resource-group <RG>`.

- [ ] **Step 3: Live E2E publish (the BAC-9/10 standard).** With the user signed in as an invited account on production `/admin/`: create a real test post (e.g. title "BAC-13 test post", robots `noindex`, folder none), Save, confirm it appears at `/blog/` and its own URL within ~2 minutes, confirm it's in `/sitemap-blog.xml`, then edit it (title tweak, confirm the change goes live), then delete it and confirm 404 + gone from the index. Capture 3 screenshots during this run (login, filled form, live post) into `docs/img/admin-login.png`, `docs/img/admin-form.png`, `docs/img/admin-live.png`.

- [ ] **Step 4: Author guide.** `docs/blog-author-guide.md`:

```markdown
# Publishing a blog post — BAC Logistics

Audience: blog authors (Ideation). No technical setup needed — just a browser.

## Log in
1. Go to **https://baclogistics.co.za/admin/**.
2. Sign in with your work Microsoft account (`developer@baclogistics.co.za`).
   You'll only see the login the first time or after logging out.

![Login](img/admin-login.png)

## Write a post
1. Click **+ New post**.
2. Fill in the form — it works like the old Couch admin:
   - **Title** — the headline. The **Slug** (the URL) fills itself in; only change it if you must.
   - **Folder** — pick a category, or leave "— none —" for a general post.
   - **Featured image** — click *Upload new image* and pick a file (PNG/JPG, under 5 MB).
     Always fill in the **Alt text** (describe the image in one sentence).
   - **Body** — write the article. Use the toolbar for headings, bold, lists, links
     and inline images.
   - **Tags / SEO fields** — same as Couch; leave blank anything you don't use.
3. Click **Save & publish**.

![The form](img/admin-form.png)

## That's it
The post is **live on the website within about a minute** — no one needs to
deploy anything. Check it at baclogistics.co.za/blog/.

![Live post](img/admin-live.png)

## Fixing mistakes
- **Edit**: open the post from the list, change it, Save — live in ~a minute.
- **Hide**: tick **Unpublished** and Save. It disappears from the site but stays in the list.
- **Delete**: open the post → Delete. (We keep old versions in storage, so nothing is ever
  truly lost — ask Rourke if you need something restored.)
```

Also add a one-line link to the guide from README's blog section.

- [ ] **Step 5: Final verification** — `node scripts/verify-site.mjs` against production (all green) and `cd api; npm test` (all green).

- [ ] **Step 6: Commit + Jira closeout.**

```bash
git add docs/blog-author-guide.md docs/img README.md
git commit -m "BAC-13: author guide with screenshots"
```

Merge → develop, PR → main, user merges. Jira BAC-13: comment summarizing what shipped (architecture, URLs preserved, E2E publish proof, storage costs) and transition to Done.

---

## Self-review notes

- Spec coverage: read path (T3/T4), caching + serve-stale + 503 (T2/T4), storage + versioning (T1), all-URLs-preserved + 12/page (T3/T6), migration + red-then-green gate (T5/T6), cutover + sitemap index + verify-site + README/DESIGN (T7), Entra auth + roles + API re-check (T8), Couch-form admin + editor + uploads + list/unpublish (T9), invitation + live E2E + author guide + Jira (T10), delivery order preserved (1→10 maps to spec steps 1→5). Deviation documented in Global Constraints: new images served via `/blog/media/*` through the Function because the container must stay private (unpublished posts live in the same container).
- Known verification points deliberately left as greps (not placeholders): pg-page canonical pattern and prev/next pagination markup (Task 3 Step 2) — the diff gate (Task 6) is the enforcement backstop for both.
- Type consistency: `getShared()` exported from `functions/blog.js`, consumed by `functions/admin-blog.js`; `FOLDERS` exported from `router.js`, consumed by `admin.js`; store surface `{loadAllPosts, getPost, savePost, deletePost, getMedia, uploadImage}` consistent across T2/T4/T8; schema field names identical in migration (T5), renderer (T3), validator (T8), and admin UI (T9).
