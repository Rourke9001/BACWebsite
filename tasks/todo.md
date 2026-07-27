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

- [ ] Stage 3 — cache headers (PR 3). **Gate:** verify on staging that route `headers`
      override the platform default (push, `curl -I`, confirm) before trusting the rest of
      the stage. If they don't, stop and report. Write `/couch/*` now; Stage 6b renames it.
- [ ] Stage 4 — re-encode the 95 images over 500 KB (PR 4). **Question resolved:** WebP,
      sweeping references. Measured below; the "keep filenames stable" constraint was
      written before anyone counted the references, and it costs 42 lines.
      - 72 of the 95 (74.3 MB, 77 %) are **blog** images with **zero** repo references —
        Stage 6a already rewrites their paths in `render.js` at render time, so the
        extension change rides along on an edit that was happening anyway.
      - 23 are **static**, referenced 42 times across 36 files. Provable per `lessons.md`.
      - Measured savings: WebP q82 −89…−96 %, JPEG q85 −82…−91 %, palette-PNG (extension
        stable) only −26…−75 % and *worst* on the home hero. Site drops ~97 MB → ~10 MB.
      - 18 of the 20 oversized static PNGs are 1920×700 heroes that declare RGBA but never
        use it, at 2–5 k colours: photographs in the wrong container. Only **2** of all 95
        genuinely use transparency (both blog images; WebP preserves it).
      - **Gate before replacing any file:** build a side-by-side original-vs-re-encoded
        comparison for the owner to approve. Quality is the whole risk in this stage.
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
