# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — Investigation: 502s, shared components, legacy asset path

Brief: `docs/investigation-brief-shared-components.md`. Investigate and report;
no production behaviour changes without approval.

### Workstream 1 — intermittent 502 on static assets

- [x] Confirm the reported cache headers and asset size on production
- [x] Establish a quiet-period latency baseline (6 targets across apex/www/default hostname)
- [x] Check Application Insights (`bac-swa-debug`) for the window
- [x] Determine whether the Functions host is in the static path at all
- [x] Measure `site/` size and the `site/couch/` share of it
- [x] Reconstruct the deploy timeline from GitHub Actions and correlate
- [x] Enable `StaticSiteHttpLogs` → `bac-debug-logs` (temporary — remove after)
- [x] Controlled test: staging deploy while probing production at 2s intervals
- [x] Concurrent full-page-load reproduction (the test that found the mechanism)
- [x] Evaluate cache-header mitigation and the cache-busting strategy it requires

### Workstream 2 — shared components and duplication

- [x] Enumerate every full-shell page (`site/` + `api/src/blog-templates/`)
- [x] Extract and hash each shared region per file; detect drift byte-exactly
- [x] Detect duplicated blocks empirically, not only by named region
- [x] Evaluate consolidation options and give a verdict

### Workstream 3 — the `/couch/uploads/…` asset path

- [x] Full reference inventory across tracked repo files
- [x] Inventory references in the Blob Storage post JSON
- [x] Check which `site/couch/` files are actually referenced
- [x] Establish where blog images actually live today
- [x] Verify on staging whether SWA wildcard redirects preserve the captured path
- [x] Target path, redirect strategy, data migration, rollback, verdict

### Review

Full report: **`docs/investigation-findings-2026-07-27.md`**.

**WS1.** The 502 did not reproduce in 1,374 requests, so no root cause is claimed. Two
things were settled, though. The Functions host is provably not in the static path — 776
static requests produced zero App Insights entries while `/blog/*` logs reliably, and
Function telemetry has never recorded a 502. And the 10–20 s stalls reported alongside the
502 turn out to be a *different* problem with a clear cause: sequential probing never
exceeded 2.75 s, but loading the whole page concurrently — what a browser does — hit
8.98 s, with TTFB at 0.77 s. The server answers promptly; the time goes into transfer of a
2.02 MB page, 54 % of which is a single 1.1 MB PNG. Recommended, in order: re-encode that
image, set real cache headers (every asset currently gets `max-age=30, must-revalidate`
with a deployment-scoped ETag), keep `StaticSiteHttpLogs` on until a 502 is caught.

**WS2.** Duplication is ~60 % of every page, but **drift is zero** — every shared region is
byte-identical across all 39 full-shell pages, and the four near-universal-but-not-universal
lines are legitimate structural differences. The case for a build step rested on drift risk
that does not exist, so the prior "leave it" recommendation stands. Proposed a CI guard
(`scripts/check-chrome.mjs`) that makes drift unmergeable without introducing a build step.

**WS3.** Recommended **not** renaming. A precondition failed: SWA emits the destination `*`
literally, verified on staging, so a wildcard redirect cannot preserve the path and 157
indexed image URLs have no cheap way to keep resolving. Two brief assumptions were also
corrected — post *bodies* contain no `/couch/uploads` references (all 96 stored references
are `featured_image`/`json_ld`), and blog images are not in Blob Storage at all today.

**Care taken.** The only production-facing change was a diagnostic setting, enabled with
approval and documented for removal. A temporary probe route was pushed to `develop` to
test wildcard redirects on staging and reverted immediately;
`site/staticwebapp.config.json` is byte-identical to its pre-investigation state
(`git diff 571cd6d..HEAD -- site/staticwebapp.config.json` is empty).
