# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — Implementing `docs/brief-implementation-2026-07-27.md`

One branch and one PR per stage. Owner merges every PR.
Corrected figures come from `docs/validation-2026-07-27.md`.

### Stage 0 — gates — CLOSED

- [x] **Gate 1 — `/couch/uploads/` indexing.** No Search Console access, so unmeasurable
      today. **Deferred to Stage 6b (PR 7).** Owner has domains.co.za access and wants to
      set the property up together before then — TXT verification record, nothing near
      MX/SPF/DKIM. Standing recommendation: build the redirect Function. The validation
      doc removed the reason it was thought expensive (no router change needed — all 87
      blog basenames already match `^[A-Za-z0-9][A-Za-z0-9._-]*$`), and `documents.js:11-12`
      already runs the `x-ms-original-url` pattern in production. A 301 transfers
      accumulated ranking to the new URL; a 404 discards it. Skipping is a defensible
      owner call.
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
- [ ] Stage 5 — OG/Twitter metadata, 135 URLs (PR 5). Static side is a `partials/` +
      `data/site.json` edit; `render.js:98` needs the `featured_image` → `og_image`
      fallback, which fixes all 90 posts without touching a blob. Fix the doubled JSON-LD
      here too.
- [ ] **HARD STOP — set up Google Search Console with the owner before Stage 6.**
      Owner has domains.co.za access for the TXT verification record. Never touch MX, SPF,
      DKIM or autodiscover.
- [ ] Stage 6a — 87 blog images to Blob Storage (PR 6)
- [ ] Stage 6b — 69 static images to `site/media/`, redirect decision (PR 7)
- [ ] Stage 7 — housekeeping (PR 8)

### Derived independently this session (reproduces the brief exactly)

`site/couch/` = **156 live production images, not a backup** — the name is inherited from
CouchCMS, the contents are current and every one is referenced. Split by **reference
source**, not directory: 69 static (referenced by repo HTML) + 87 blog (referenced only by
`featured_image`/`json_ld` in blob post JSON), disjoint, 69 + 87 = 156. 70 distinct
referenced paths, of which one — `/couch/uploads/image/blog/x.png` — is the test fixture at
`api/test/blog-render.test.js:9` and resolves to nothing. 202 reference occurrences across
42 files. All 87 blog basenames are unique.

### Review

_(added when the work completes)_
