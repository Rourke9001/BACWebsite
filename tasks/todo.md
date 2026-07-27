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

### Stage 2 — single-source chrome — PR #16 (open)

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

### Found, queued, not yet done

- [ ] **`site/contact/index.html:573`** — "Email Us" links to
      `mailto:info@baclogistics.co.za&amp;bcc=leads@ideation.co.za`, BCCing the previous
      agency. Contradicts README's "no third-party forwarding or agency BCCs". Also
      malformed (`&` where the first mailto parameter needs `?`). **Own one-line PR next.**
- [ ] **Doubled JSON-LD tags** on
      `video-hub/cross-border-freight-delays-often-start-before-the-border.html`:
      `<script type="application/ld+json"><script type="application/ld+json">` …
      `</script></script>`, plus a placeholder `path-to-bac-logo.png`. → Stage 5.

### Remaining

- [ ] Stage 3 — cache headers (PR 3). Verify on staging that route `headers` override the
      platform default before trusting the rest of the stage.
- [ ] Stage 4 — re-encode the 95 images over 500 KB (PR 4). **Open question:** "keep
      filenames stable" is incompatible with PNG→WebP, which changes the extension.
      Needs a decision before starting.
- [ ] Stage 5 — OG/Twitter metadata, 135 URLs (PR 5)
- [ ] **STOP — set up Google Search Console with the owner before Stage 6**
- [ ] Stage 6a — 87 blog images to Blob Storage (PR 6)
- [ ] Stage 6b — 69 static images to `site/media/`, redirect decision (PR 7)
- [ ] Stage 7 — housekeeping (PR 8)

### Review

_(added when the work completes)_
