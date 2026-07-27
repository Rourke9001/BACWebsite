# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — Validation of the investigation findings and the two briefs

Re-verify every re-derivable claim in `docs/investigation-findings-2026-07-27.md`,
`docs/brief-site-architecture-single-source.md`, `docs/brief-duplication-and-couch-removal.md`
and the prior `tasks/todo.md` review, plus a first-principles review of the site and CMS setup.
Read-only: nothing pushed, no Azure resource changed.

### Re-derivation from source

- [x] Repo counts: 39 chrome files, 135 URLs, 202/42 `/couch/uploads` refs, `tel:`/`wa.me`
- [x] **Independent drift re-measurement** — 10 regions, tag-balanced extraction, SHA-256 byte-exact
- [x] Disk inventory: `site/couch/` size, oversized-image census
- [x] OG/Twitter tag audit across all 39 files
- [x] `staticwebapp.config.json` byte-identical to `571cd6d`; probe commit `1434906` reviewed
- [x] Azure live state: diagnostic settings, CDN status, blob inventory, app-setting names
- [x] **All 90 post JSONs downloaded and field-walked** (then deleted); `featured_image`/`json_ld`/
      `body` reference counts, `og_image`, `unpublished`
- [x] Live HTTP: cache headers, ETag, page weight, blog Function headers, 80-request burst
- [x] Official Microsoft docs on `StaticSiteHttpLogs` and apex-domain guidance
- [x] `api/` architecture review — storage model, image path, auth, caching, single responsibility
- [x] Adversarial pass over my own findings before reporting

### Review

Full report: **`docs/validation-2026-07-27.md`**.

**Verdict: the investigation holds up well.** Every claim the migration is sized on reproduces
exactly — 90 posts / 0 unpublished, 96 blob refs = 90 `featured_image` + 6 `json_ld` + **0 in
bodies**, 157 distinct paths (70 repo + 87 blob, disjoint), 202 refs across 42 files, 1,148,209
bytes for `bac-header1.png`, deployment-scoped ETag identical across 8 resources, and **zero
drift** on an independent re-measurement.

**Three errors.** (1) The enterprise-grade CDN hypothesis for the missing `StaticSiteHttpLogs` is
refuted — Azure lists the category as available on this exact resource with the CDN disabled, and
acting on it would cost ~$17.52/mo for no documented benefit; an App Insights availability test
does the actual job for ~$5.57/mo. (2) The `og:image` count is wrong in the safe direction —
**135 of 135** public URLs render an empty `og:image`, not 128; no page has a populated one; and
`twitter:image` is missing from the audit table. (3) "157 indexed image URLs" attaches a measured
path count to an unmeasured SEO claim — and that premise is the sole justification for the
redirect Function.

**One correction to my own audit:** I first reported the 2.02 MB home-page total as
unreproducible. It reproduces to within 0.2 % once the font-awesome webfonts and favicon are
counted. The total is right; the "23 resources" inventory is what is wrong.

**Five things none of the four documents examines**, two of which outrank the current plan: the
90 post JSONs are the only unversioned data in the system and have **no backup** on a
single-datacenter `Standard_LRS` account; and the apex `A` record is pinned to an IP from
`stableInboundIp`, which now returns `null` and is absent from Microsoft's published schema. Also:
the admin image-upload and document features are fully built, deployed and **completely unused**
(the migration target for Part 2 already exists and already sets an immutable cache header); post
saves have no concurrency control; and `README.md` counts are stale.

**Sequencing recommendation stands** — architecture first, then `/couch/`. The redirect Function's
precondition is proven rather than assumed: `documents.js:11-12` already recovers the original path
from `x-ms-original-url` behind a live SWA rewrite.

Revised order in §5 of the validation doc. Nothing committed or pushed.
