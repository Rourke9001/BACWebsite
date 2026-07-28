# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — Implementing `docs/brief-implementation-2026-07-27.md`

One branch and one PR per stage. Owner merges every PR.
Corrected figures come from `docs/validation-2026-07-27.md`.

### Stage 0 — gates — CLOSED

- [x] **Gate 1 — `/couch/uploads/` indexing. MEASURED 2026-07-28, no longer deferred.**
      Search Console verified (Domain property, DNS TXT, auto-verified). Answers:
      - **Indexed: yes, comprehensively.** Google Images `site:baclogistics.co.za` yields
        **≥47 distinct image URLs, 47 of 47 under `/couch/uploads/`** (26 `image/`,
        9 `services/`, 5 `blog/`, 5 `home/`, 2 `header/`). 47 is a *floor* — Google caps
        these result sets. So the brief's "if few or none, Stage 6 collapses to a rename
        plus a sweep" fallback is **off the table**.
      - **Worth anything: apparently not.** Image search = **0 clicks, 27 impressions,
        avg position 38.9** (≈ page 4). Web search = 5 clicks, 222 impressions, pos 16.1.
      - **Caveat, load-bearing:** that is **one day** of data (Jul 26 2026). GSC did not
        backfill on verification. Re-read before committing to 6b's architecture — the
        pre-existing sitemap submissions (Jun 2026 and Jul 2023) prove Google holds
        history for this domain, so more may materialise.
      - 46 of the 47 return 200 today; 1 (`the-advantages-of-professional-handling-…jpg`)
        already 404s — an old-site URL Google still holds, i.e. the image index is sticky.
      - `site/robots.txt:2` has a blank `Disallow:` — `/couch/` has always been crawlable.
      - Sitemap `https://baclogistics.co.za/sitemap.xml` re-submitted (was last read
        Jul 19, four days *before* the Azure go-live, so it was stale).
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
- [x] Stage 5 — OG/Twitter metadata, 135 URLs — ✅ MERGED (PR #20-#22). Detailed plan below.
- [x] **HARD STOP — set up Google Search Console with the owner before Stage 6.** Done;
      Gate 1 above records what it measured. Never touch MX, SPF, DKIM or autodiscover.
- [x] Stage 6a — 87 blog images to Blob Storage — ✅ MERGED (PR #25-#27). 90/90 posts
      render, 87/87 images serve `image/webp` with `immutable`.
- [x] Stage 6b — 69 static images to `site/media/`, `site/couch/` deleted — **this PR**.
      Review below.
- [ ] Stage 7 — housekeeping (PR 8)

**Everything through Stage 6b is on `develop`. Stages 1–6a are LIVE IN PRODUCTION** —
`main` and `develop` were level at `9c33299` when 6b started. Production was verified
after the 6a deploy: 137 pages, 32 redirects, 322 refs, 136 social, 6 files, 404 + admin
guard, all passing.

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

### Stage 4 follow-up — redirect the re-encoded `/couch/` images (branch `feature/couch-image-redirects`)

Found while measuring Gate 1, **not** in any brief. Stage 4 re-encoded 23 static images to
WebP and swept every repo reference — internally correct, fully verified, and green. But
`main` is still on PR #14, so those 23 old URLs are **live on production right now**, and
5 of them are indexed by Google Images. Merging `develop` → `main` would 404 them.

- [x] All 23 removed files confirmed to have an exact 1:1 `.webp` replacement on `develop`
      (asserted present in the tree *and* on disk; no orphans)
- [x] 23 × `301` added to `site/staticwebapp.config.json`
- [x] **Inserted ahead of the `/couch/*` cache-header rule** — SWA applies the *first*
      matching route, so placing them after it would have made all 23 dead entries.
      Asserted programmatically: `max(redirect index) < index('/couch/*')`
- [x] Routes 20 → 43; diff `115+/0−` = exactly 23 × 5 lines, 0 changed lines outside a
      redirect block; `check:chrome` 39/39; api 58/58
- [x] CRLF + no-trailing-newline preserved (see the new `-text` lesson — this file is
      **not** LF despite the "LF-pinned" shorthand in every handoff)
- [ ] **Verify on staging after merge** — the redirects cannot be tested before then; PRs
      into `develop` get no preview environment

Deliberately *not* done: nothing here changes Stage 6b's decision. 6b moves 156 files and
SWA config cannot express a pattern redirect with capture (`/couch/*` can only target one
fixed destination), so 6b means ~156 explicit entries or a Function. Doing 23 first tells
us how badly that scales while the blast radius is small.

### Derived independently this session (reproduces the brief exactly)

`site/couch/` = **156 live production images, not a backup** — the name is inherited from
CouchCMS, the contents are current and every one is referenced. Split by **reference
source**, not directory: 69 static (referenced by repo HTML) + 87 blog (referenced only by
`featured_image`/`json_ld` in blob post JSON), disjoint, 69 + 87 = 156. 70 distinct
referenced paths, of which one — `/couch/uploads/image/blog/x.png` — is the test fixture at
`api/test/blog-render.test.js:9` and resolves to nothing. 202 reference occurrences across
42 files. All 87 blog basenames are unique.

### Stage 6b — 69 static images to `site/media/` (branch `feature/static-images-to-media`)

`git mv site/couch/uploads/image site/media`; `site/couch/` deleted. It held nothing else.

- [x] **69 files moved, content provably unchanged** — SHA-256 per file before and after,
      all 69 identical; git records all 69 as renames (`R`), not delete+add.
- [x] **310 references swept, 45 deliberately left.** The discriminator is neither the
      directory nor the syntax: **an occurrence is rewritten iff its URL resolves to a file
      being moved.** All 45 survivors are then excluded *by construction* rather than by a
      skip list — 23 redirect route keys (the legacy URLs being redirected *from*), 13
      fixtures/prose in `blog-render.test.js` standing in for what the 90 live posts still
      store in Blob Storage, 4 regexes over stored blob values, 5 prose mentions.
- [x] **The trap avoided:** all 23 of PR #23's redirect *targets* pointed at `/couch/…webp`
      files this stage moved. They resolve, so they were swept; leaving them would have made
      every one a 301 into a 404 — worse than no redirect. Route `/couch/*` → `/media/*`.
- [x] **Redirects: all 69 added** (owner decision). The brief assumed only a Function could
      work; that was wrong. Azure documents the limit as *"Max file size is 20 KB"* with **no
      route-count limit**. Measured: **112 routes, 18,175 bytes, 2,305 under the ceiling** —
      repointing the 23 *saves* 322 bytes, the 69 add 11,325. Edge-served, so no Function, no
      cold start, and no `Cache-Control`-on-301 concern (there is no invocation to avoid).
      The 87 blog redirects genuinely didn't fit (20,227 bytes alone) — blog slugs are ~40 %
      longer per entry. That is why 6a 404'd and 6b doesn't.
- [x] **New CI guard** `api/test/staticwebapp-config.test.js` (5 tests): the 20 KB ceiling,
      every `/media/` redirect target exists on disk, nothing points into `/couch/`,
      redirects precede the cache rule (first-match-wins), no duplicate routes.
- [x] **The single-source payoff, first real one.** The logo is two lines in
      `data/site.json`; `check:chrome` stayed 39/39 across the change.
- [x] Verified: **64/64 api tests** (was 59, +5) · `check:chrome` 39/39 · all 69 distinct
      `/media/` URLs return 200 locally · 7 key pages render with **0** `/couch/` refs and no
      console errors · home page screenshotted, logo + hero correct.
- [x] Diff arithmetic exact per file (`site/index.html` +20/−20, `about` +18/−18,
      `services/index` +19/−19, …), **0 changed lines lacking `/media/`**; config +369/−24 =
      69×5 new lines + 23 repointed targets + 1 cache route.
- [ ] **Verify on staging after merge** — PRs into `develop` get no preview environment.
      `node scripts/verify-site.mjs <staging-url>`, then spot-check a 301:
      `curl -I .../couch/uploads/image/home/bac-header1.webp` → 301 to `/media/…`.

### Corrections made to my own work this stage

1. **The sweep's line-ending assertion compared the working copy to itself**, so it could
   not fail. It missed `api/src/blog-templates/error.html`, already CRLF on disk while its
   blob is LF (a checkout predating the `.gitattributes` pin). Read-modify-write flipped 54
   line endings and — because that path is pinned `-text` — git recorded the flip faithfully
   instead of normalising it. Caught by per-file diff arithmetic: a one-reference edit
   reporting 94 changed lines. Now asserted against `git show HEAD:<file>`. Captured in
   `tasks/lessons.md`; seven other files showed the same CRLF worktree symptom and were all
   harmless, which is what made the real one easy to wave through.
2. **`git grep '/couch/uploads/'` returned 0 files, exit 1 — and there are 61.** MSYS2
   rewrites the leading `/` into a Windows path before `git.exe` sees it, and the result is
   indistinguishable from "no matches". For a stage that is entirely a reference sweep this
   was the difference between 310 references and none. Captured in `tasks/lessons.md`.
3. **A destination-existence assertion fired 11 false positives** because `/media/…` also
   matches inside `/blog/media/…` — Stage 6a's Blob namespace, which resolves to no repo
   file by design. Anchored with a negative lookbehind.
4. **`census.json` was written into the repo root** by a scratch script that `chdir`'d there.
   Moved to the scratchpad; the tree was clean before any commit.

### Corrections to the Stage 6b handoff

- **`sitemap-static.xml` needed no edit** — it has zero `/couch/` references (it lists page
  URLs, not images). Only `staticwebapp.config.json` required the byte-exact JSON handling.
- **`site/404.html` also carries a logo reference** and is likewise a stripped shell outside
  `check:chrome`; the handoff named only `blog-templates/error.html`. The resolution-based
  sweep caught both without needing either to be listed.
- **The protected fixture count in `blog-render.test.js` is 10, not 9** — line 86's
  `` `/couch/uploads/image/${src}` `` template literal is also a `mediaUrl()` input.
- The handoff's "310 across 45 files" reconciles: 350 in code/config = 307 sweepable + 43
  protected; +3 live-doc refs (README ×2, DESIGN ×1) and +2 doc prose gives 310/45.

### Review

**Stage 6b is complete and verified locally.** `site/couch/` is gone; the 69 static images
live at `/media/…` with a 301 from every old URL. `site/` drops to ~5.8 MB of images.

Deliberately **not** done, and left for Stage 7: the stale `README.md` counts ("38 static
pages" → 37, "~99 blog posts" → 90, "5 downloadable docs" → 6), the apex `A` record note,
the dormant `documents/` feature, and the `az staticwebapp appsettings list` secrets
warning. All are housekeeping the handoff assigns to Stage 7, not 6b.
