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
      MX/SPF/DKIM. Standing recommendation: build the redirect Function (301s transfer
      accumulated ranking to the new URLs; a 404 discards it).
- [x] **Gate 2 — existing blog backup?** **No.** The zip/`archive/` are the pre-migration
      CouchCMS site. Git history can rebuild all 90 posts today only because every blob
      still reports `lastModified = 2026-07-17` — the CMS has never been used. First
      `/admin/` publish ends that.

### Stage 1 — blog backup — PR #15 (open)

- [x] `scripts/backup-blog.mjs`, manifest + SHA-256, tamper tests, README Operations,
      `admin.js` wording, GRS recommended but not applied

### Stage 2 — single-source chrome — IN PROGRESS

- [x] Derive the shared regions from source rather than assuming them
- [x] **All 10 regions byte-identical across all 39 files — zero drift**, independently
      reproducing the validation doc's finding
- [x] `partials/` (10), `data/site.json` (9 values), `scripts/build-chrome.mjs`
- [x] **THE GATE: expander regenerates all 39 files byte-for-byte.** Marker-stripped
      output is identical to the previous commit across 2,534,756 bytes. Diff is 704
      inert comment lines, 0 content changes, 0 deletions.
- [x] Reverted demonstration: one edit to `data/site.json` → 78 lines across 39 files,
      exactly `wa.me` × 2 per file; every changed line contains `wa.me`; reverted.
- [x] CI check (`.github/workflows/checks.yml`) proven to catch all five failure modes
- [x] Contact page's third `tel:` given its own marked region — `data/site.json` really
      is the only place
- [x] Retired-value assertion covers page body content, not just chrome
- [x] `api` tests 55/55; local preview 200s with chrome intact
- [ ] Commit, push, PR

### Corrections made to my own work this stage

1. **Claimed all 39 files were CRLF. They are LF.** My check used
   `grep -c $'\r$'`; the CR was eaten and the pattern collapsed to `$`, which matches
   every line — so LF files reported as 100% CRLF. Settled with `xxd`. Load-bearing:
   the expander emits LF.
2. **The expander wrote before validating.** A retired value was written to all 39 files
   and *then* reported. Now everything is expanded and validated before anything is
   written; proven with a test asserting 0 files written on a failing run.
3. **`git checkout --` inside a test** reverted a file to its pre-migration state and
   silently shrank the target set to 38. Rebuilt the whole pipeline from HEAD instead of
   patching around it.

### Found, not in this PR

- **`site/contact/index.html:573`** — "Email Us" links to
  `mailto:info@baclogistics.co.za&amp;bcc=leads@ideation.co.za`, BCCing the previous
  agency. Contradicts README's "no third-party forwarding or agency BCCs". Also malformed
  (`&` where the first mailto parameter needs `?`). **Own one-line PR after Stage 2.**
- **A video-hub page has doubled JSON-LD tags** —
  `<script type="application/ld+json"><script type="application/ld+json">` … `</script></script>`
  on `cross-border-freight-delays-often-start-before-the-border.html`, plus a placeholder
  `path-to-bac-logo.png` and `www.` URLs. Invalid markup; the structured data likely does
  not parse. → Stage 5.
- `.gitattributes` did not pin `api/src/blog-templates/**`, so a Windows checkout would
  get CRLF working copies of LF blobs and every generated file would read as fully
  changed. Pinned in this PR — a latent hazard the CI check would otherwise have tripped on.

### Remaining

- [ ] Stage 3 — cache headers (PR 3)
- [ ] Stage 4 — re-encode the 95 images over 500 KB (PR 4). Open question: "keep filenames
      stable" is incompatible with PNG→WebP; needs a decision.
- [ ] Stage 5 — OG/Twitter metadata, 135 URLs (PR 5)
- [ ] **STOP — set up Google Search Console with the owner before Stage 6**
- [ ] Stage 6a — 87 blog images to Blob Storage (PR 6)
- [ ] Stage 6b — 69 static images to `site/media/`, redirect decision (PR 7)
- [ ] Stage 7 — housekeeping (PR 8)

### Review

_(added when the stage completes)_
