# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — Implementing `docs/brief-implementation-2026-07-27.md`

Staged implementation, one branch and one PR per stage. Owner merges every PR.
Corrected figures come from `docs/validation-2026-07-27.md`.

### Stage 0 — gates (owner tasks) — CLOSED

- [x] **Gate 1 — `/couch/uploads/` indexing.** Owner has no Search Console access, so the
      measurement is unavailable. **Deferred to Stage 6b (PR 7), where it first bites.**
      Standing recommendation: build the redirect Function. The validation doc removed the
      reason it was thought expensive (no router change needed — all 87 blog basenames
      already match `^[A-Za-z0-9][A-Za-z0-9._-]*$`), and `documents.js:11-12` already runs
      the `x-ms-original-url` pattern in production. Skipping it is a defensible owner call.
- [x] **Gate 2 — existing blog backup?** **No.** Answered from evidence, not recollection:
      - `archive/` + the WeTransfer zip are the *pre-migration CouchCMS* site (SQL + PHP).
        An ancestor of the content, not a copy of it — nothing can restore the 90 JSONs from it.
      - Git history *can* rebuild all 90 today: the 90 pre-cutover static pages sit at
        `f44ef75^` (99 files = 90 posts + index + 8 pagination) and the generator
        `scripts/migrate-blog.mjs` at `2e31cd2^`.
      - **That path expires on first CMS use.** All 90 blobs report
        `lastModified = 2026-07-17` (the cutover date) — the admin has never saved a post.
        The first `/admin/` publish diverges blob from git and nothing holds a second copy.

      → Stage 1 is mandatory and more urgent than the brief framed it.

### Stage 1 — back up the blog content (PR 1)

- [x] `scripts/backup-blog.mjs` — timestamped local pull of the `blog` container, zero deps
- [x] Manifest with per-blob SHA-256 so a restore can be verified, not just assumed
- [x] Covers `uploads/` and `documents/` too, not just `posts/` — after Stage 6a the 87 blog
      images become production-only data as well
- [x] Proven: 90 blobs / 0.98 MB pulled and verified; tamper tests catch a 1-byte append,
      a same-length bit flip, and a file present on disk but absent from the manifest
- [ ] `scripts/README.md` entry
- [ ] `README.md` Operations section: how to run it, and what does/doesn't protect this data
- [ ] `site/admin/admin.js:320` — the rollback promise is true only by storage config; make
      the wording accurate about the 30-day window and record the dependency
- [ ] Recommend `Standard_LRS` → GRS to the owner. **Do not execute** — Azure change.

### Verified storage facts (re-read from Azure 2026-07-27, for README)

| Setting | Value | Meaning |
|---|---|---|
| `sku.name` | `Standard_LRS` | 3 copies, one West Europe datacenter. No zone or geo redundancy. |
| `isVersioningEnabled` | `true` | Overwrites keep prior versions. |
| `deleteRetentionPolicy` | `enabled: true, days: 30` | Deleted blobs recoverable 30 days. |
| `containerDeleteRetentionPolicy` | `null` | **Container deletion is not protected.** |
| `restorePolicy` | `null` | No point-in-time restore. |
| `changeFeed` | `null` | No change log. |

### Remaining stages (not started)

- [ ] Stage 2 — single-source chrome (PR 2). Gate: zero-diff regeneration of all 39 files
      before any value changes. Owner's stated priority.
- [ ] Stage 3 — cache headers (PR 3)
- [ ] Stage 4 — re-encode the 95 images over 500 KB (PR 4)
- [ ] Stage 5 — OG/Twitter metadata, 135 URLs (PR 5)
- [ ] Stage 6a — 87 blog images to Blob Storage (PR 6)
- [ ] Stage 6b — 69 static images to `site/media/`, redirect Function (PR 7)
- [ ] Stage 7 — housekeeping (PR 8)

### Review

_(added when the stage completes)_
