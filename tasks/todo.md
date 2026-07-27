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
- [ ] Controlled test: staging deploy while probing production at 2s intervals
- [ ] Evaluate cache-header mitigation and the cache-busting strategy it requires

### Workstream 2 — shared components and duplication

- [x] Enumerate every full-shell page (`site/` + `api/src/blog-templates/`)
- [x] Extract and hash each shared region per file; detect drift byte-exactly
- [x] Detect duplicated blocks empirically, not only by named region
- [ ] Evaluate consolidation options and give a verdict

### Workstream 3 — the `/couch/uploads/…` asset path

- [x] Full reference inventory across tracked repo files
- [x] Inventory references in the Blob Storage post JSON
- [x] Check which `site/couch/` files are actually referenced
- [x] Establish where blog images actually live today
- [ ] Target path, redirect strategy, data migration, rollback, verdict

### Review

(To be completed with the final report.)
