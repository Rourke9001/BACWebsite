# Brief — implement the validated findings

Hand this to a fresh session. Everything below the line is the brief.

Supersedes the *plans* in `docs/brief-site-architecture-single-source.md` and
`docs/brief-duplication-and-couch-removal.md`, both of which remain useful as background.
Corrected figures come from `docs/validation-2026-07-27.md` — where that document and the
earlier ones disagree, **the validation document is right** and says why.

---

## Prompt

You are implementing a staged set of changes on **baclogistics.co.za** (static site on Azure
Static Web Apps, `app_location: site`, `api_location: api`, rg `rg-baclogistics-web`, Standard
SKU, West Europe). Read `README.md`, `DESIGN.md`, `CLAUDE.md`, `tasks/lessons.md` and
`docs/validation-2026-07-27.md` first. Read `docs/investigation-findings-2026-07-27.md` for the
502/latency background.

Work through the stages in order. **Each stage is its own branch and its own PR.** The owner
merges every PR to `main` — you never do.

### The requirement that started this

> "If I need to update the WhatsApp number, I want to change it in one place."

**The number has already been changed** — `d654afd`, merged in `e545cf9` — the hard way, as a
sweep across all 39 files. Doing it that way is what prompted this entire investigation.

The current values are `wa.me/+27113531111` (78 occurrences) and `tel:0119747472` (79), both
uniform and correct. **Do not change either one.** They are the fixture the expander must
reproduce byte-for-byte, not something to edit in order to demonstrate anything.

The problem to solve is that the *next* such change must not be a 39-file sweep. Everything else
in this brief is either a cheap safety fix that should land first, or work that becomes trivial
once it is solved.

### Established — do not re-measure

All independently re-verified on 2026-07-27:

- **39 chrome-bearing files**: **37** static pages in `site/` plus
  `api/src/blog-templates/{index,post}.html`. Three stripped shells are correctly excluded:
  `site/404.html`, `site/admin/index.html`, `api/src/blog-templates/error.html`.
- Those 39 files sit behind **135 public URLs**: 37 static + 8 blog index pages
  (`POSTS_PER_PAGE = 12`, ⌈90/12⌉ = 8) + 90 posts. **The two blog templates are 5 % of the files
  but 73 % of the URLs.**
- **Drift is zero.** Every shared region is byte-identical across all 39 files — re-measured
  independently with tag-balanced extraction and SHA-256. You can trust the files agree today.
- `tel:0119747472` appears **79** times, `wa.me/+27113531111` **78** times. The asymmetry is a
  **third `tel:` in `site/contact/index.html` body content, outside the chrome** — see Stage 2.
- **90 blog posts, 0 unpublished**, stored one-per-blob as `posts/<slug>.json` in the `blog`
  container of storage account `bacblogcontent`.
- `og_image` is empty on all 90 posts; `featured_image` is populated on all 90 and every one
  starts with `/couch/uploads/`. Post **bodies contain zero** `/couch/uploads` references —
  all 96 stored references are 90 × `featured_image` + 6 × `json_ld`.
- `site/` is a flattened static export. `.gitattributes` pins `site/** -text` for byte-exactness.

### Corrections to the earlier briefs — carry these forward

1. **`og:image` is empty on 135 of 135 public URLs, not 128.** No page carries a populated value;
   `post.html`'s `{{og_image}}` is a placeholder that renders empty. `twitter:image` is also empty
   on all 39 and was missing from the earlier audit.
2. **Do not enable enterprise-grade edge to chase HTTP logs.** The hypothesis that
   `StaticSiteHttpLogs` needs it is refuted — Azure lists the category as available on this
   resource with the CDN disabled. It would cost ~$17.52/mo for no documented benefit.
3. **"157 indexed image URLs" is unverified.** 157 is a real count of distinct *paths*; nothing
   measured how many are *indexed*. Stage 0 gates the work that depends on it.
4. The home page is ~2.11 MB over **~26** resources, not 23 — the earlier count missed two
   font-awesome `.woff2` files, a CSS-referenced `background.jpg`, and `favicon.ico`.
5. `bac-header1.png` is the largest asset **on the home page**, not on the site. There are
   **95 images over 500 KB totalling 96.99 MB**, and 44 PNGs over 1 MB; the largest is a blog
   image at 2,379,343 bytes.

---

## Stage 0 — two gates, before any code (owner tasks, ~15 min)

Ask the owner to do these; they change what gets built.

1. **Google Search Console → Pages / Images, filter `/couch/uploads/`.** How many of those image
   URLs are actually indexed? This decides whether Stage 6 needs a redirect Function at all. If
   the answer is "few or none", Stage 6 collapses to a rename plus a reference sweep.
2. **Confirm there is no existing backup of the blog posts.** If there genuinely isn't, Stage 1
   is not optional.

---

## Stage 1 — back up the blog content (do first; ~1 h)

The 90 post JSONs are **the only data in this system that is not in git**, on a `Standard_LRS`
account — three copies in one West Europe datacenter, no zone or geo redundancy, no export.
Total size is 0.94 MB.

- Add `scripts/backup-blog.mjs` (or a documented `az` one-liner) that pulls `posts/*` to a
  timestamped local directory. Document it in `README.md` under Operations.
- Recommend to the owner — **do not execute without approval, this is an Azure change**:
  switch the account to GRS. At 0.94 MB the cost delta is negligible.
- Record in `README.md` what already protects this data, because nothing does today:
  `isVersioningEnabled: true`, blob soft delete `enabled: true, days: 30`,
  `containerDeleteRetentionPolicy: null` (container deletion is **not** protected).
- While here: `site/admin/admin.js:320` promises authors "Old versions are kept in storage for
  rollback." That is true only because of the storage-account settings above, which the code does
  not guarantee. Either soften the wording or note the dependency in `README.md`.

**PR 1.** Docs + a backup script. No behaviour change.

---

## Stage 2 — single-source chrome (the main event)

### The design

**Partials for structure, a data file for values, one expander covering both targets,
generated output committed.**

```
site/_partials/            header-top.html, header-bottom.html, nav.html, footer.html,
                           gtm-script.html, gtm-noscript.html, head-meta.html
data/site.json             phone, whatsapp, email, GTM id, social URLs, logo paths
scripts/build-chrome.mjs   expands partials + data into the 39 files, in place
```

The owner edits `data/site.json` (a value) or a partial (structure), runs
`npm run build:chrome`, and commits the resulting diff. **One place. One command.**

### Why generated output is committed rather than built in CI

This is the load-bearing decision — justify it in the PR description:

- `python -m http.server` in `site/` stays a faithful preview, because the files on disk are
  always the real files. A CI-only build would serve pages full of visible placeholder tokens.
- SWA keeps deploying `site/` directly. `app_location` does not change, no build step enters the
  deploy path, and the latency profile measured in the investigation is untouched.
- The owner reviews a real diff before publishing, which is how this repo already works.
- Rollback is `git revert`.

The cost — generated files live in git — is paid off by the CI check below.

### `api/src/blog-templates/` uses the same mechanism

Non-negotiable: those two files are 73 % of the public URLs. The expander writes chrome into
`api/src/blog-templates/{index,post}.html` at **build time**, exactly as it does for `site/`.
`render.js` continues to read them from disk and do its `{{token}}` substitution at request time,
unchanged. **One mechanism, two targets** — not a CLI script for `site/` and a runtime read for
the blog.

Be careful that the expander does not touch `render.js`'s `{{...}}` tokens. Use a distinct marker
syntax for chrome regions, e.g. HTML comments:

```html
<!-- @chrome:header-top -->
   …generated…
<!-- @end:header-top -->
```

Comments are inert in HTML, unambiguous to parse, and survive markup changes inside the region.
Insert them once during the migration.

### CI check — replaces the drift guard from the superseded brief

`scripts/check-chrome.mjs` re-runs the expander into a temp dir and fails the PR if any committed
file differs from its generated form. This is strictly better than the file-vs-file consistency
guard the earlier brief proposed: it catches "someone edited a generated file by hand" and
"someone changed a partial and forgot to rebuild", including the
5 %-of-files / 73 %-of-URLs trap of forgetting `api/src/blog-templates/`.

### The contact-page trap

`site/contact/index.html` has a **third** `tel:0119747472` in page body content, outside any
chrome region. A chrome-only expander will not catch it and a marker-keyed value script will not
either. Handle it explicitly — either give it its own inline marker or add a value-substitution
pass over all files, not just chrome regions — and add a test or CI assertion that the literal
old number appears nowhere in `site/` or `api/src/blog-templates/`.

### Why the alternatives lose

- **Client-side injection** — rejected twice on evidence. Puts the primary CTAs and phone number
  behind JavaScript on a site whose value is organic search, and flashes the top bar on load.
  Do not re-propose it.
- **Server-side includes** — SWA static hosting has none.
- **Full SSG (Eleventy etc.)** — solves a bigger problem than exists. Drift is zero and the site
  is 37 stable pages; a framework adds a dependency surface and a migration for no gain here.
- **Function-rendered pages** — moves 37 static pages behind the Functions host, makes whole-site
  availability depend on it, and cold pages get slower (~650 ms static TTFB vs ~1.2 s cold
  Function, measured). Rejected.
- **Data file alone, no partials** — meets the WhatsApp requirement but not nav or footer
  structure, and needs a second mechanism for the blog templates. Rejected on those grounds; the
  scalar half of it survives as `data/site.json` above.

### Verification

- `git diff --shortstat` must equal (occurrences per file × files). `site/** -text` means any tool
  that rewrites line endings shows every line of every file as changed — **detect the current line
  endings in `site/*.html` and have the expander preserve them exactly.** See `tasks/lessons.md`.
- The first expander run must produce a **zero diff** against the current files before you change
  any value. That proves the expander reproduces today's byte-exact chrome. Do not proceed until
  it does.
- `cd api; npm test` — 55 tests, all passing today. Keep them passing.
- `scripts/verify-site.mjs` against staging.

**PR 2.** Expander, partials, data file, CI check, contact-page fix.

Two pieces of evidence belong in the PR description. The contact details are already correct, so
neither may involve altering a live value:

1. **The zero-diff run.** The expander regenerates all 39 files byte-for-byte identical to what is
   committed today. This is the primary proof and the gate on the whole stage.
2. **A reverted demonstration.** Change one value in `data/site.json`, rebuild, paste the
   `git diff --shortstat` showing exactly the expected occurrences across the expected files, then
   revert it. Shows one-file editing works without touching a real phone number.

The first genuine single-source edit is the logo path in Stage 6b, which has to happen anyway.
That is the real acceptance test, and it arrives on its own.

---

## Stage 3 — cache headers (~30 min + staging soak)

Every static asset returns `Cache-Control: public, must-revalidate, max-age=30` (the SWA platform
default — there is no `globalHeaders` block), and the `ETag` is deployment-scoped: eight distinct
resources all returned `"66942793"`, so every deploy invalidates every client's copy of everything.

Add to `staticwebapp.config.json`:

```
/couch/*  (or /media/* after Stage 6)  → public, max-age=31536000, immutable
/inc/font-awesome/*                    → public, max-age=31536000, immutable
/inc/css/main.css, /inc/js/main.js     → public, max-age=300   (drop must-revalidate)
```

**Verify on staging first that route `headers` override the platform default** — push, `curl -I`,
confirm. If they do not, stop and report; the rest of this stage depends on it. At `max-age=300`
no cache-busting scheme is needed.

**PR 3.**

---

## Stage 4 — images (~2–3 h)

Batch re-encode the **95 images over 500 KB (96.99 MB)** to WebP/JPEG at equivalent visual
quality — not just `bac-header1.png`. Keep filenames stable so no references change, or sweep
references in the same commit and prove the diff arithmetic.

Expect to remove a large majority of `site/`'s ~109 MB. Check a sample visually against `DESIGN.md`
before and after; do not degrade the hero imagery to win bytes.

**Do this before Stage 6, not after.** Re-encoding in the repo means git tracks the change and the
owner can review it; Stage 6 then uploads already-optimised files to Blob Storage. Re-encoding
after the move would mean re-uploading 87 blobs for no reason. The worst offenders are in the
static set that stays in the repo (`services/` alone is 19.2 MB across 35 files, ten of them over
800 KB), so both stages benefit.

**PR 4.**

---

## Stage 5 — OG/Twitter metadata (~2 h)

**135 of 135 public URLs currently render an empty `og:image`.** The markup already exists and is
uniform, so this is value population, not a structural change — and after Stage 2 the static side
is a partial edit.

- Constants: `og:locale` = `en_ZA`, `og:site_name` = `BAC Logistics`, `og:type` = `website` for
  pages / `article` for posts.
- Fill `og:image` and `twitter:image` on the 37 static pages and the blog index.
- In `render.js`, **add the `featured_image` → `og_image` fallback that does not exist today**
  (`render.js:98` reads `post.og_image` directly with no coalescing). That fixes all 90 posts
  without touching a single blob.
- Pick a site-wide default image for pages that have no obvious one.

**PR 5.**

---

## Stage 6 — split the image assets by owner (gated on Stage 0)

> **`site/couch/` is not a backup and must not be deleted.** It is **156 live image files,
> 104 MB, all 156 of them referenced** — every blog post's featured image, the home page hero
> (`bac-header1.png`), and the service page photography. Deleting it strips the images from the
> site. The folder merely inherited its name from CouchCMS; the contents are current production
> assets. **This stage is a rename, never a delete.**
>
> The old site's actual backup is `archive/` — gitignored, holds the SQL dump and legacy source.
> That is the thing that is safe to remove, and it is already outside the deploy artifact.

### The goal, stated by the owner

Blog images belong in Blob Storage next to the posts they belong to. Static-site images belong in
the repo next to the pages that use them. Today all 156 sit in one folder and the split is invisible.

**Do not rename the whole folder to `/media/` as the earlier brief proposed.** That preserves the
wrong grouping. Split by owner instead.

### The split — measured, not estimated

| | Files | Size | Referenced by | Destination |
|---|---:|---:|---|---|
| Blog post featured images | **87** | **77.7 MB** | only `featured_image`/`json_ld` in blob post JSON | **Blob `uploads/`**, served `/blog/media/<file>` |
| Static site images | **69** | 26.6 MB | repo HTML (202 occurrences, 42 files) | **`site/media/`**, plain rename |

The two sets are **completely disjoint** — no file is referenced by both. The 69 break down as
`services/` 35, `home/` 15, `about/` 11, `contact/` 4, `header/` 2 (the logo, inside the chrome),
`video-hub/` 1, `blog/` 1 (the blog *index* hero, a site asset). Derive both sets yourself before
moving anything; do not hand-classify by directory — the blog images are split across
`image/` and `image/blog/`, so directory is not the discriminator. **Reference source is.**

### 6a — move the 87 blog images to Blob Storage

Feasibility is already verified, so the earlier brief's objections do not apply:

- **All 87 basenames are unique.** Zero collisions in the flat `uploads/` namespace.
- **All 87 match the `/blog/media/` router regex** `^[A-Za-z0-9][A-Za-z0-9._-]*$`. **No router
  change is needed** — the earlier brief's "extend `routeBlogPath` for one subdirectory level" is
  unnecessary.
- The five colliding basenames that brief used to argue *against* blob migration
  (`air-freight.jpg`, `aog.jpg`, `bonded-warehousing.jpg`, `road-freight.jpg`, `sea-freight.jpg`)
  are **all in the 69 static set**. They never move. The objection does not survive the split.

Steps:

1. Upload the 87 to the `uploads/` prefix of the `blog` container. `store.uploadImage` already
   does exactly this, or use `az storage blob upload-batch`. Verify the count is 87 afterwards.
2. **Map `featured_image` at render time in `render.js`** rather than rewriting 90 production
   blobs: a leading `/couch/uploads/image/blog/<f>` or `/couch/uploads/image/<f>` becomes
   `/blog/media/<f>`. No writes to live data, trivially reversible. Apply the same map to the
   `og_image` fallback added in Stage 5 and to the 6 `json_ld` strings.
3. Confirm all 90 posts render a featured image that returns **200** from `/blog/media/`, then
   delete the 87 files from the repo — **not before**.
4. Optionally, once proven, migrate the stored `featured_image` values so the data is clean too.
   Back up the 90 posts first (Stage 1's script) and make the rewrite idempotent. **Raise this
   with the owner as a separate decision** — the render-time map alone is a complete fix.

They inherit `Cache-Control: public, max-age=31536000, immutable` for free (`handler.js:43`).

**Availability note, and why it is weaker here than it looks:** this puts blog images behind the
Functions host, which the investigation flagged as logging itself unhealthy every 30 s. But the
blog *page* that references them is already served by that same Function — if the host is down,
the page is down regardless. Moving its images there **adds no new failure mode for blog
readers.** It does for images hotlinked or surfaced directly in Google Images. That is a real but
much narrower exposure than the earlier brief's framing implies, and it should be stated that way.

### 6b — rename the 69 static images

- `git mv site/couch/uploads/image site/media`, preserving the subdirectory structure
  (`header/`, `home/`, `about/`, `services/`, `contact/`, `video-hub/`, `blog/`). Then delete the
  now-empty `site/couch/`.
- Sweep the **202 references across 42 tracked files**. After Stage 2 the two logo references are
  a one-line edit in a partial; the rest are page-specific. Count first, replace, prove the diff
  arithmetic per `tasks/lessons.md`.
- One reference resolves to nothing and is not an asset: the test fixture
  `/couch/uploads/image/blog/x.png` at `api/test/blog-render.test.js:9`. Update it, don't chase it.

### Redirects — only if Stage 0 justified them

If Search Console showed meaningful indexing, add **one** catch-all Function on `/couch/uploads/*`
that 301s to the right destination for both sets: blog basenames → `/blog/media/<f>`, static paths
→ `/media/<subdir>/<f>`.

- **The pattern is proven, not speculative.** `api/src/functions/documents.js:11-12` already
  recovers the original path from `x-ms-original-url` behind a SWA rewrite
  (`staticwebapp.config.json:29-32`). Copy it.
- **Set a `Cache-Control` on the 301s.** The earlier brief specifies none, so every crawler
  revisit and hotlink hit for the whole retirement window is a live invocation.
  `documents.js:31` already does this for its own responses.
- **Azure SWA wildcard redirects do not preserve the captured path** — verified on staging;
  `{"route": "/couch/uploads/*", "redirect": "/media/*"}` emits the `*` literally. Do not ship it.
- Plan to retire the Function after ~6 months once Search Console shows the old URLs recrawled.

If Stage 0 showed little or no indexing, skip the Function entirely and let the old paths 404.

### Net effect

`site/` drops from **109.5 MB to ~32 MB** (less again after Stage 4). Blog content — text and
images — lives in one store, changeable entirely through `/admin/` with no deploy. Static images
live beside the pages that use them. The `/couch/` name is gone.

**PR 6 (6a) and PR 7 (6b).** Keep them separate; 6a touches production data paths and 6b is a
mechanical repo sweep.

---

## Stage 7 — housekeeping (~1 h)

- **Apex DNS.** `README.md:95` documents the apex `A` record as sourced from `stableInboundIp`,
  which now returns `null` and is absent from Microsoft's published `Microsoft.Web/staticSites`
  schema. The site serves fine today, but there is no documented way to obtain a new IP if Azure
  reassigns the host. Microsoft recommends ALIAS/ANAME over A records for apex. **Do not touch
  DNS without explicit approval, and never touch MX, SPF, DKIM or autodiscover.** Propose, don't act.
- **Stale `README.md` counts**: "38 static pages" → 37; "~99 blog posts" → 90; "5 downloadable
  docs in `/files/`" → 6.
- **Document the two unused features**: admin image upload (`uploads/` prefix, served at
  `/blog/media/<file>` with `max-age=31536000, immutable`) and admin document upload
  (`documents/` prefix, served at `/documents/<name>`). Both are fully built, tested and deployed
  with **zero production data**, while the six real downloads sit statically in `site/files/`.
  Either adopt them or record why they are dormant.
- Add a warning next to `README.md:119`: `az staticwebapp appsettings list` prints secrets in
  plaintext with no masking flag.
- Update `docs/shared-header-duplication.md` — it still lists the `privacy-policy.html` mobile
  number as a known inconsistency; that was fixed in `571cd6d`.
- Adopt or retire the dormant `documents/` feature (see above) now that Stage 6 has established
  the principle: content that changes without a deploy lives in Blob Storage, content that ships
  with the site lives in the repo. The six files in `site/files/` are linked from static pages and
  change rarely — leaving them in the repo is defensible, but say so deliberately.

**PR 8.**

---

## Not in scope

- **Enterprise-grade edge.** See correction 2. If tracing the next 502 matters, an Application
  Insights standard availability test costs ~$5.57/mo against ~$17.52/mo and actually records the
  failing response. Propose it; do not enable anything without approval.
- **Optimistic concurrency on post save.** `store.js` writes unconditionally — last write wins,
  and a slug rename is PUT-then-DELETE with no rollback (`admin.js:126-137`). Real, but low
  urgency at the current author count. Note it; don't build it now.

---

## Ground rules

- `develop` is the working branch; branch off it, merge back into it. `main` is protected and
  **only the owner merges**.
- Pushes to `develop` deploy staging. **Don't rapid-fire pushes** — two deploys 14 s apart raced
  during the investigation and one failed with *"No matching Static Web App environment was found."*
  Let each staging deploy finish.
- Staging and preview environments share **production** app settings — an `/admin/` publish or a
  form submission there touches live data.
- `/admin/*` is role-gated: an unauthenticated `curl` returns an empty 302, not the file. That is
  not a failed deploy.
- Use a bash heredoc for multi-line commit messages in the Bash tool; a PowerShell here-string
  passed through bash silently produces a malformed subject.
- Ask before anything outward-facing other than pushing branches and opening PRs. No Azure
  resource changes without approval.
- Never touch MX, SPF, DKIM or autodiscover DNS at domains.co.za. Never commit anything under
  `archive/` or any `*.sql` file.
