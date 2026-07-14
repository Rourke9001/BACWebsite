# tasks/todo.md

## BAC-7 — Post-mirror cleanup + staticwebapp.config.json (2026-07-14)

### Findings from pre-work scan (basis for the plan)
- `gridlink` refs: exactly 2 per page (`/inc/css/gridlink.css`, `/inc/js/gridlink.js`), 136 HTML pages, all root-relative. No `gridlink-product-filter-logic.js` refs in the mirror. No internal self-refs inside the css/js files.
- `/couch/` refs: 688, **all** `/couch/uploads/image/...` content media (155 files mirrored into `site/couch/uploads/`). Zero admin/system URLs. Decision: keep media paths as-is (content, not CMS admin; preserves og:image + any external image indexing).
- blog-search / product-search: 0 refs — already clean.
- Absolute `baclogistics.co.za` URLs: canonical + og:url on each page, sitemap.xml, robots.txt — all correct, keep.
- GTM-MPPHRHH: present on all 136 pages — keep intact.
- Legacy pages `/about.html`, `/logistics.html`, `/transport.html`, `/high-value.html` do not exist in mirror → need 301s.
- `/files/`: .xls, .xlsx, .docx downloads → need MIME types.
- `.gitignore` working-tree change ignores CLAUDE.md — conflicts with user's instruction that conventions travel with the repo → revert.

### Checklist
- [x] Revert `.gitignore` CLAUDE.md ignore; commit populated CLAUDE.md
- [x] Rename `site/inc/css/gridlink.css` → `main.css`, `site/inc/js/gridlink.js` → `main.js` (git mv)
- [x] Update all 272 references across 136 HTML files
- [x] Create branded `site/404.html`
- [x] Create `site/staticwebapp.config.json`: 301s (`/about.html`→`/about/`, `/logistics.html`|`/transport.html`|`/high-value.html`→`/`), 404 rewrite → `/404.html`, MIME types (.xls/.xlsx/.docx/.webmanifest), trailingSlash auto. (HTTPS enforcement is automatic on SWA.)
- [x] Verify: zero `gridlink` refs remain; local server serves pages + renamed assets 200; config JSON valid; 404 page renders
- [ ] Commit on develop, push, open PR → main (user merges)
- [ ] Jira: comment findings + decisions on BAC-7, transition

### Review
- Diff shape verified: exactly 272 insertions / 272 deletions across 136 HTML files (the two asset refs per page), plus 2 renames and 2 new files. No other content touched.
- Local server check: `/`, `/about/`, `/blog/`, `/blog/pg/3/`, a service page, `/inc/css/main.css`, `/inc/js/main.js`, a `/files/` download, and `/404.html` all return 200; 404 page title renders.
- Deliberate scope decisions:
  - `/couch/uploads/` media paths kept as-is — they are content images (og:image targets included), not CMS admin URLs; the audit's "strip couch URLs" clause targeted admin/system URLs, of which the mirror contains none.
  - Canonical/og:url absolute URLs kept — correct SEO behavior.
  - blog-search/product-search: nothing to remove (0 refs in mirror).
  - `gl-`/`glht-` CSS class prefixes left alone — internal naming, not a visible provider reference; renaming would churn every page for no user-facing gain.
- Not verifiable locally: SWA 301s, 404 rewrite, and MIME overrides need the Azure runtime — verify at BAC-11 deploy.

