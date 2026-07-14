# tasks/todo.md

## BAC-8 — Contact-form Azure Function (2026-07-14)

### Spec (from old inc/form/action.php + BAC-8 rescope comment)
- Form IDs: `contact_form`, `service_form`; fields: name, email, phone, company, message_subject, message, consent, form_location, form_ts, honeypot `company_website`.
- Anti-spam (replicate): honeypot must be empty; min-fill 3s (only when form_ts present/valid); rate limit 5 per IP+form per 300s; disposable domains mailinator.com/tempmail.com/10minutemail.com; >5 links in message rejected; idempotency sha256(fields|ip|ua) TTL 180s → duplicate pretends success.
- Required: name, email (valid), message. Subjects: "BAC Logistics Contact Form" / "BAC Logistics Service Form".
- Response contract: JSON when Accept: application/json or X-Requested-With; else redirect — success → `/information/thank-you.html?status=ok&rid=…`, error → `/?status=error&rid=…`.
- Recipient: info@baclogistics.co.za only. From noreply@baclogistics.co.za. NO Integrately, NO ideation BCC, NO reCAPTCHA, no file uploads.
- Email send stubbed behind interface (`EMAIL_PROVIDER=stub|smtp|graph`) for BAC-9.
- Known gap for BAC-10: mirrored pages carry a frozen `form_ts`, so the min-fill gate is a no-op until BAC-10's front-end sets form_ts at page load (and repoints action to /api/contact-form).

### Checklist
- [x] Scaffold api/: host.json, package.json, .funcignore, Node v4 programming model
- [x] src/functions/contact-form.js — thin HTTP adapter (only file importing @azure/functions)
- [x] src/lib/handler.js + spam.js + email.js — pure, testable logic
- [x] Unit tests (node:test) covering each anti-spam gate + happy path + response contract
- [x] Run tests, verify green (13/13 pass, `npm test`)
- [ ] Commit develop, push, Jira comment + In Review

### Review
- 13 unit tests pass with plain Node (no npm install needed — handler/spam/email have zero deps; only the adapter imports @azure/functions, which the SWA build installs).
- Every old-handler gate replicated with identical thresholds and identical response contract (JSON vs 303 redirect w/ status+rid). Integrately, ideation BCC, reCAPTCHA, uploads all dropped per rescope.
- Rate-limit/idempotency stores are in-memory per instance — equivalent parity to the old per-server file store for this traffic; documented in api/README.md.
- Flagged for BAC-10: mirrored `form_ts` is frozen → min-fill gate inert until front-end sets it at page load.


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

