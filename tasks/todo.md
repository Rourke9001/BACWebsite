# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — Implementing `docs/brief-implementation-2026-07-27.md`

One branch and one PR per stage. Owner merges every PR.
Corrected figures come from `docs/validation-2026-07-27.md`.

### Stage 0 — gates — CLOSED

- [x] **Gate 1 — `/couch/uploads/` indexing. MEASURED 2026-07-28, not deferred.**
      Google Images `site:baclogistics.co.za` → **≥47 distinct image URLs, 47 of 47 under
      `/couch/uploads/`**. So the brief's fallback — "if few or none are indexed, Stage 6
      collapses to a rename plus a sweep" — is **off the table**; the redirect question in
      6b is live and must be decided, not skipped by default.

      **Caveat that must survive to 6b:** Search Console showed Image search at 0 clicks /
      27 impressions / avg position 38.9 — but that is **one day of data (2026-07-26)**.
      GSC did not backfill on verification. **Re-read Performance → Search type: Image
      before locking 6b's architecture**; more may have materialised by then.

      Standing recommendation unchanged: build the redirect Function. No router change is
      needed (all 87 blog basenames already match `^[A-Za-z0-9][A-Za-z0-9._-]*$`), and
      `documents.js:11-12` already runs the `x-ms-original-url` pattern in production.
      A 301 transfers accumulated ranking to the new URL; a 404 discards it.

      **6b cannot use a wildcard.** SWA config cannot express a path-preserving capture —
      `/couch/*` can only target one fixed destination. That means ~156 explicit route
      entries or a Function. PR #23 did 23 by hand as a rehearsal; judge from that.
      **SWA applies the FIRST matching route**, so redirects for `/couch/...` must be
      ordered ahead of the `/couch/*` cache-header rule or they are dead entries.
- [x] **Gate 2 — existing blog backup?** **No.** Answered from evidence, not recollection:
      - `archive/` + the WeTransfer zip are the *pre-migration CouchCMS* site (SQL + PHP).
        An ancestor of the content, not a copy of it.
      - Git history *can* rebuild all 90 today: pre-cutover static pages at `f44ef75^`
        (99 files = 90 posts + index + 8 pagination), generator at `2e31cd2^`.
      - **That path expires on first CMS use.** All 90 blobs report
        `lastModified = 2026-07-17` (the cutover date) — the admin has never saved a post.

### Stage 1 — back up the blog content — ✅ MERGED (PR #15)

- [x] `scripts/backup-blog.mjs`, zero deps, whole container not just `posts/`
- [x] Manifest with per-blob SHA-256; tamper tests catch a 1-byte append, a same-length
      bit flip, and a file on disk absent from the manifest
- [x] `scripts/README.md` + `README.md` Operations: what protects this data and what doesn't
- [x] `site/admin/admin.js` rollback wording corrected to the real 30-day window
- [x] `Standard_LRS` → GRS recommended in README, **not applied** — needs owner approval

### Stage 2 — single-source chrome — ✅ MERGED (PR #16)

Verified on staging after merge: 137 pages, 9 redirects, 321 refs, 0 failures; blog
templates render with zero unresolved `${}` or `{{}}` tokens.


- [x] Regions derived from source, not assumed
- [x] **All 10 regions byte-identical across all 39 files — zero drift**, independently
      reproducing the validation doc's finding
- [x] `partials/` (10), `data/site.json` (9 values), `scripts/build-chrome.mjs`
- [x] **THE GATE: expander regenerates all 39 files byte-for-byte.** Marker-stripped output
      identical to the previous commit across 2,534,756 bytes. Diff is 704 inert comment
      lines, 0 content changes, 0 deletions.
- [x] Reverted demonstration: one edit to `data/site.json` → 78 lines across 39 files,
      exactly `wa.me` × 2 per file; every changed line contains `wa.me`; reverted.
- [x] CI check proven against all five failure modes; nothing written on a failing run
- [x] Contact page's third `tel:` given its own marked region
- [x] Retired-value assertion covers page body content, not just chrome
- [x] `.gitattributes` pins `api/src/blog-templates/**` + build inputs (latent CRLF hazard)
- [x] `api` tests 55/55; local preview 200s with chrome intact
- [x] Lessons captured in `tasks/lessons.md`
- [x] Merged `develop` (Stage 1) back in; re-verified after the merge

### Corrections made to my own work this stage

1. **Claimed all 39 files were CRLF. They are LF.** `grep -c $'\r$'` ate the CR and the
   pattern collapsed to `$`, which matches every line. Settled with `xxd`.
2. **The expander wrote before validating** — a retired value reached all 39 files and was
   *then* reported. Now validate-all-then-write, with a test asserting 0 files written.
3. **`git checkout --` inside a test** stripped a file's markers and shrank the target set
   to 38, making a test bug look like a tool bug. Rebuilt the pipeline from HEAD instead.
4. **`backups/` was staged on the Stage 2 branch** — 90 live post JSONs. The `.gitignore`
   rule was only on the Stage 1 branch. Caught pre-commit; rule now on both.

### Item 1 — remove the previous agency's BCC — this PR

- [x] `site/contact/index.html:587` (the todo said 573; the real line is 587) — "Email Us"
      linked to `mailto:info@baclogistics.co.za&amp;bcc=leads@ideation.co.za`. Now a plain
      `mailto:info@baclogistics.co.za`.
- [x] Owner decision: plain mailto. "Link to `/contact/`" was a non-starter — the card
      *is* on `/contact/`, one of three action cards (Address → Maps, Email, Phone → `tel:`).
- [x] Line 587 verified outside every chrome region (between `@end:header-bottom` at 543 and
      `@chrome:contact-phone-link` at 596), so a hand-edit is correct here.
- [x] Diff arithmetic: 1 file, 1 insertion, 1 deletion, 0 changed lines lacking the mailto.
      LF preserved (`xxd`: trailing `0a`, no `0d`). `npm run check:chrome` → 39/39.
- [x] Swept the whole repo for the agency: only this one reference in shipped code.
      `docs/blog-author-guide.md:3` names Ideation as the blog-author audience and is
      **kept** — the owner confirms they still run blog posting through `/admin/`.

### Found, queued, not yet done

- [ ] **Embedded agency metadata in the image binaries.** 90 of 161 images in `site/` carry
      Adobe XMP (~1.19 MB of pure metadata). 11 name the agency workstation `IdeationDT1`
      directly; 12 leak `C:\Users\…` paths and Adobe account IDs, publicly served. All 11
      are blog images; 10 fall inside Stage 4's oversized set, so the re-encode strips them
      for free. **→ Stage 4, widened to strip metadata from all 161 images**, not just the 95
      being re-encoded (losslessly for the ones not otherwise touched).
- [ ] **GTM container `GTM-MPPHRHH` ownership is unverified** — not determinable from the
      repo. If it sits in the previous agency's Google Tag Manager account they retain the
      ability to inject tags. Owner to confirm/transfer; no code change implied.
- [ ] **Doubled JSON-LD tags** on
      `video-hub/cross-border-freight-delays-often-start-before-the-border.html`:
      `<script type="application/ld+json"><script type="application/ld+json">` …
      `</script></script>`, plus a placeholder `path-to-bac-logo.png`. → Stage 5.

### Remaining

- [x] Stage 3 — cache headers — ✅ MERGED (PR #18). **The gate passed on staging:** route
      `headers` do override the platform default. `/couch/*` and `/inc/font-awesome/*`
      (including the webfonts) now return `max-age=31536000, immutable`; `main.css` and
      `main.js` return `max-age=300` with `must-revalidate` dropped. HTML pages correctly
      still return `max-age=30` — the control proving the routes match selectively.
      **DECIDED — stays at one year.** The concern was that `/couch/*` filenames are not
      content-fingerprinted, so an in-place image replacement would go stale for up to a
      year. Resolved by a documented escape hatch rather than a shorter lifetime: append a
      query string to the *reference* (`…bac-header1.webp?v=2`). Verified on staging that a
      query string still serves the file, still matches the route and still carries the
      header, while being a distinct browser cache entry. Written up in
      `README.md` → Operations → Static asset caching. Does not arise for blog images —
      `admin-blog.js:63` timestamps every upload, so re-uploads always get a new filename.
- [x] Stage 4 — re-encode oversized images (PR #19). **Owner approved WebP q90** after
      reviewing 1:1 crops. **Scope narrowed on evidence:** only the **23 static** oversized
      images are re-encoded here. The 72 oversized *blog* images are deferred to Stage 6a
      because `render.js:55,109` emits `post.featured_image` verbatim — their URLs come
      from blob JSON, not the repo, so renaming them here would 404 all 90 posts. In 6a
      they move to Blob Storage under new names anyway, so they get encoded once.
      - 23 files, 23,757,322 → 3,308,634 bytes (−86%). `site/` 109.5 MB → 90 MB.
      - 42 reference occurrences across 36 files swept; diff arithmetic exact
        (42 ins / 42 del, 0 changed lines lacking the token), LF preserved.
      - **Metadata strip added** (filename-preserving, so safe for blog images too):
        93 files, 1,404,771 bytes of embedded metadata removed. `IdeationDT1` 11 → 0,
        `C:\Users\…` 12 → 0, `AdobeID` 12 → 0, `xmpmeta` 90 → 0. 43 JPEGs **kept** their
        ICC colour profile — the strip is surgical, asserted per file, not blanket.
      - Verified: chrome 39/39, api 55/55, every image 200s locally, home + about render
        correctly in a browser, no console errors.

      **Carried into Stage 6a:** the 72 oversized blog images, 74.3 MB, still unencoded in
      the repo. Encode them to WebP q90 as part of the blob upload so each is written once.
      Measured evidence behind the q90 choice: q75 −93.5 %, q82 −91.4 %, q90 −86.9 % across
      all 95; palette-PNG (extension stable) only −26…−75 % and *worst* on the home hero.
      Only **2** of the 95 genuinely use transparency, both blog images — WebP preserves it.
- [x] Stage 5 — OG/Twitter metadata, 135 URLs — ✅ MERGED (PR #21), plus the video-hub
      descriptions follow-up (PR #22). Detailed plan below.
- [x] **HARD STOP — Google Search Console.** ✅ Done 2026-07-28. Domain property, DNS TXT,
      auto-verified; sitemap re-submitted the same day. MX/SPF/DKIM untouched.
- [ ] Stage 6a — 87 blog images to Blob Storage (PR 6) — **in progress**, branch
      `feature/blog-images-to-blob`. Detailed plan below.
- [ ] Stage 6b — 69 static images to `site/media/`, redirect decision (PR 7)
- [ ] Stage 7 — housekeeping (PR 8)

### Stage 5 plan — OG/Twitter metadata (branch `feature/og-metadata`)

**Correction to the handoff note:** the OG/Twitter block is *not* inside a chrome region.
It sits between `@end:head-css` and `@chrome:head-meta`, uniform in shape across all 39
files (3 whitespace variants, identical tag lines) but carrying per-page values. So this is
**not** purely a `partials/` edit — the per-page values must be written into each file.

What is already correct, and stays untouched: `og:title`, `og:description`, `og:url`,
`twitter:title`, `twitter:description` on all 37 static pages and the blog index.

Owner decisions taken 2026-07-27: constants → a new chrome region; `og:image` → each
page's own hero; `twitter:site` → removed (no X account exists — header-top carries exactly
four social icons, `partials/header-top.html:54-79`, and none is X).

- [x] **Constants → `partials/social-meta.html`** + `og_locale` / `og_site_name` in
      `data/site.json`. New `<!-- @chrome:social-meta -->` region placed *after*
      `twitter:image` (meta order is semantically irrelevant), holding `og:locale`,
      `og:site_name`, `twitter:card`. Guarded by `npm run check:chrome` like the rest —
      `--list` now reports 11 regions × 39 files.
- [x] **`og:type`** stays per-page — a per-document semantic, not a site constant.
      `website` on the 37 static pages + blog index, `article` on `post.html`.
- [x] **`twitter:site` removed** from all 39 files.
- [x] **`og:image` + `twitter:image`**, absolute (per `DESIGN.md`: OG tags stay absolute):
      33 pages use their own `#gl-hero-image` src; `site/index.html` uses its slider image
      `bac-header1.webp`; the 3 `/information/` pages have no imagery and fall back to that
      same home hero as the site-wide default; the blog index uses `blog/news.webp`.
      All 1920×700. **18 distinct images across 38 literal URLs, all verified present on
      disk and 200 locally; `og:image == twitter:image` on every file.**
- [x] **`render.js:98`** — `esc(post.og_image)` → `esc(shareImage(post))`, the chain
      `og_image → featured_image → site default`, plus `absoluteUrl()` (OG requires an
      absolute URL; `featured_image` is stored root-relative, and `/admin/` accepts a
      free-text `og_image` so an author-supplied absolute URL must survive untouched).
      Fixes all 90 posts with no blob writes.
- [x] **`post.html`** — `og:description` / `twitter:description` were `content=""` while
      `{{meta_description}}` was already computed for `<meta name="description">`. Wired up.
- [x] **JSON-LD fix**, `video-hub/cross-border-freight-delays-often-start-before-the-border.html`.
      The doubled `<script>` made the block's *content* start with a literal
      `<script type="application/ld+json">`, so **the JSON never parsed and Google was
      discarding the page's structured data entirely** — the page had no working schema at
      all, not merely a duplicated one. Also: placeholder `path-to-bac-logo.png` → the real
      logo, and `@id`/`mainEntityOfPage` pointed at
      `https://www.baclogistics.co.za/video-hub/…-border/`, a trailing-slash URL that
      **404s** — both repointed at the page's canonical. Now parses; asserted with `json.loads`.
- [x] **`scripts/verify-site.mjs`** — `missingSocialMeta()` asserts nine og:/twitter: tags
      carry a value on every page crawled, wired into the report line and the pass/fail
      gate. `extractRefs` already fetched absolute `<meta content>` URLs, so a
      populated-but-404 `og:image` fails too. Exported behind an
      `import.meta.url === argv[1]` guard so it is testable without a deploy.
- [x] **Verify**: `check:chrome` 39/39 · api **58/58** (was 55, +3) · diff arithmetic
      uniform **9+/7−** on all 39 files with **0** changed lines lacking an expected token ·
      LF preserved (only `tasks/todo.md` carries CR, unpinned and pre-existing) · region
      inside `<head>` and correctly paired on 39/39 · local preview 200s · the new check
      run against `origin/develop` **fails 37/37** and against the working tree
      **passes 37/37**, plus rendered post and index.

### Stage 5 — found, NOT fixed, needs an owner decision

- [x] **14 of 17 `/video-hub/` pages had a defective `<meta name="description">`**, which
      `og:description` and `twitter:description` mirror. **12 carried the literal placeholder
      `Meta description for video`** (3 tags each = 36 live instances); 2 were empty
      (`chain-of-custody-…`, `why-one-late-delivery-…`). Live in production and shown in
      Google results. Surfaced by the migration's own assertion, not by any of the four
      investigation documents. **Owner chose "draft them, I'll edit" (2026-07-27)** —
      drafted from each page's own body copy, matching the tone of the one page that was
      done properly. 14 pages × 3 tags = 42 values, 139–149 chars, ASCII only (no em
      dashes or curly quotes, so nothing depends on encoding). Diff uniform 3+/3− per file,
      0 changed lines that are not a description tag. Repo-wide placeholder count now 0;
      all three tags agree on all 17 pages. **Copy is owner-editable — review in the PR.**
      Not touched: `full-container-load-fcl-vs-less-than-container-load-lcl.html`, whose
      description is populated but is just its title repeated. Suggested replacement in
      the PR body if wanted.
- [ ] **All 17 video-hub pages share one `og:image`** (`video_hub.webp`, the section hero).
      Each page has a YouTube id, so `https://img.youtube.com/vi/<id>/maxresdefault.jpg`
      would give 16 distinct, highly relevant share images at zero storage cost
      (`img.youtube.com` is already in `verify-site.mjs`'s allowlist). Trade-off: share
      cards would then depend on YouTube's CDN. Section hero kept as the safer default.
- [ ] **Share images are 1920×700 (2.74:1); Facebook/LinkedIn render 1.91:1.** Cards get
      centre-cropped — fine for banner photography, but purpose-built 1200×630 art would
      survive the crop intact. A separate piece of image work, not metadata.
- [ ] **Only one page in `site/` carries JSON-LD at all.** The other 16 video pages have no
      `VideoObject` schema, and no page carries `Organization` or `LocalBusiness`. Out of
      scope here; worth its own stage if search visibility matters.

### Derived independently this session (reproduces the brief exactly)

`site/couch/` = **156 live production images, not a backup** — the name is inherited from
CouchCMS, the contents are current and every one is referenced. Split by **reference
source**, not directory: 69 static (referenced by repo HTML) + 87 blog (referenced only by
`featured_image`/`json_ld` in blob post JSON), disjoint, 69 + 87 = 156. 70 distinct
referenced paths, of which one — `/couch/uploads/image/blog/x.png` — is the test fixture at
`api/test/blog-render.test.js:9` and resolves to nothing. 202 reference occurrences across
42 files. All 87 blog basenames are unique.

### Stage 6a plan — 87 blog images to Blob Storage (branch `feature/blog-images-to-blob`)

**Re-derived from the verified backup 2026-07-28, not carried over from a brief.**
90 `featured_image` + 6 `json_ld` refs → **87 distinct paths**, 0 on-disk misses, 76.5 MB,
**76 over 300 KB** (75.0 MB — the brief's "72 / 74.3 MB" is superseded), 0 duplicate
basenames, **0 stem collisions after the `.webp` swap**, 0 router-regex failures before or
after. The 6 `json_ld` paths are **already in the `featured_image` set** — they add no new
files, only a second place to rewrite. 3 images are shared by 2 posts each. They live in
two directories (`image/` 61, `image/blog/` 26); `image/blog/` also holds one *static*
image (`news.webp`), so **directory is not the discriminator — reference source is.**

Because basenames are unique and stems don't collide, the flat `uploads/` namespace is
safe and the render map is **one rule, no lookup table**.

**No new mechanism is needed — the target already exists and is live in production:**
`store.js:4,51,55` (layout + `uploadImage`), `handler.js:35-45` (serves `/blog/media/<f>`
with `max-age=31536000, immutable`), `router.js:13` (flat namespace, no subdirectories),
`admin-blog.js:64-65` (the admin upload already returns `/blog/media/<name>`).

Owner decisions 2026-07-28: **go straight through** (no pre-upload crop review — q90 was
approved in Stage 4 on the same photography; crops go in the PR for the record), and
**blob upload authorised**.

- [x] **Encoder ICC guard — the thing that nearly repeated silently.** 39 of the 87 carry
      an ICC profile, and `reencode-images.py`'s `encode_webp()` never passed
      `icc_profile` through. Measured what that already cost: Stage 4's 23 WebP outputs
      carry **0** profiles and **20 of their 23 sources had one**. Then identified them
      before calling it a defect — **every profile in both sets is plain
      `sRGB IEC61966-2.1`**, which is exactly what a browser assumes for an untagged
      image. So Stage 4 was perceptually a no-op and 6a would be too. Drop remains the
      right call (smaller files, no behaviour change), but it must stop being *silent*:
      **refuse to encode any image whose profile is not sRGB.** Add the guard to the new
      script and back-port it to `reencode-images.py` (no output change — nothing
      oversized remains there).
- [x] **`scripts/migrate-blog-images.py`** — `--check` reports and writes nothing;
      validate-all-then-write per `tasks/lessons.md`. Derives the 87 from post JSON by
      reference source. Encodes **all 87** to WebP q90, not just the 76 oversized —
      uniform `.webp` keeps the render map one rule instead of a conditional. Asserts per
      file: dimensions preserved, mode/alpha preserved (2 images have real transparency),
      ICC sRGB-or-refuse, output smaller, no stem collision, basename still matches the
      router regex.
- [x] **Upload** the 87 to `bacblogcontent` / `blog` / `uploads/` with correct
      `image/webp` content type. Adds only new objects — nothing existing is modified or
      deleted, no post JSON is touched. `--auth-mode login` is denied on this account (no
      data-plane RBAC); key auth works.
- [x] **Verify against production before any code change lands.** `/blog/media/*` is
      already served in production, so all 87 can be proven live *before* the repo
      deletion is committed. Assert 200, `Content-Type: image/webp`, byte length matches
      the local encode, and the immutable cache header, on all 87.
- [x] **`render.js` — map at render time. Do NOT rewrite the 90 post JSONs.** One helper
      maps a leading `/couch/uploads/…/<file>.<ext>` to `/blog/media/<stem>.webp` and
      returns everything else untouched. Applied to `post.featured_image` (`:81`, `:135`),
      to `post.og_image`/`post.featured_image` **inside** `shareImage` (`:50`), and to
      `post.json_ld` (`:126`). **Deliberately NOT applied to `DEFAULT_OG_IMAGE`
      (`render.js:11`)** — `image/home/bac-header1.webp` is a *static* repo image in the
      69 set, not a blog image; it stays `/couch/` until Stage 6b sweeps it. New posts
      saved through `/admin/` already carry `/blog/media/…` values and must pass through
      unchanged, extension included.
- [x] **`site/admin/admin.js:93` — regression this stage causes.** The edit form sets the
      featured-image preview `src` from the stored value verbatim, so once the 87 leave
      the repo the preview 404s on all 90 posts. Map for **display only**; the value
      posted back to `savePost` must stay the stored one.
- [x] **Tests** in `api/test/blog-render.test.js` (58 today). Fixture at `:9` is
      `/couch/uploads/image/blog/x.png` and resolves to nothing — update it. Cover: couch →
      `/blog/media/<stem>.webp`; `/blog/media/` passthrough with extension intact;
      author-supplied absolute URL untouched; empty → `DEFAULT_OG_IMAGE` **unmapped**;
      `json_ld` rewrite.
- [x] **Delete the 87 from the repo** — in this PR, but only after the production
      verification above proves the blob copies serve. Expect `site/` ≈ 90 MB → ≈ 14 MB.
- [ ] **Verify after the owner merges.** PRs into `develop` get no preview environment,
      so staging verification happens post-merge: all 90 posts render a featured image
      returning 200, blog index cards intact, `scripts/verify-site.mjs` clean.

### Review

_(added when the work completes)_
