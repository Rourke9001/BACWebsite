# tasks/todo.md

## BAC-9 — Graph email provider (2026-07-14)

### Spec (BAC-3 decision, recorded on the ticket)
- Provider: Microsoft Graph app-only `POST /users/{mailbox}/sendMail`, `Mail.Send` application permission, client-credentials token from `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (scope `https://graph.microsoft.com/.default`). No SDK — Node 20 global fetch, zero new deps.
- SMTP AUTH ruled out: Microsoft disables basic-auth client submission by default Dec 2026.
- Config via SWA app settings only: `EMAIL_PROVIDER=graph`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, plus existing `CONTACT_RECIPIENT` / `CONTACT_FROM`. Stub stays the default provider until settings are applied.
- Test config: from `donotreply@baclogistics.co.za` (exists; also scanner@ identity), to Rourke's personal address. Go-live: recipient → `info@` (alias on broughton@). Dedicated `noreply@` shared mailbox remains the cleaner long-term sender (trade-off on BAC-3).
- Security: scope app registration to the sending mailbox (Exchange application access policy) before production.

### Checklist
- [x] email.js: implement `graph` provider (token cache, sendMail, clear missing-config errors); drop dead `smtp` branch
- [x] handler.js: DEFAULT_FROM → donotreply@ (noreply@ doesn't exist in the tenant)
- [x] Unit tests: graph request shapes, token caching, non-202 failure, missing config
- [x] npm test green (17/17)
- [x] Entra app registration "BAC Website Contact Form" (appId 1d7da6a8-6ea2-4a27-8dcd-cbf59f13df75) + Mail.Send app role + SP
- [x] Admin consent granted by Global Admin (2026-07-15) — Mail.Send active
- [x] SWA app settings via az: EMAIL_PROVIDER=graph, GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET, CONTACT_FROM=donotreply@; CONTACT_RECIPIENT tested with rourke9001@gmail.com, then switched to broughton@baclogistics.co.za (2026-07-15, verified applied)
- [ ] Application access policy scoping app → donotreply@ (Exchange Online PowerShell; rourke@ has Exchange Admin, can run) — **last open hardening item**
- [x] Commit → develop (cb2dfab), merged to main via PR #4, live E2E confirmed, Jira → Done (2026-07-15)

### Review
- 17/17 unit tests pass; provider is dependency-free (Node 20 fetch), token cached with 60s early-refresh, non-202/again non-2xx token responses raise with trimmed Graph error detail.
- First secret got echoed to the terminal by a cmd.exe parse error (az.cmd + parens in --query); rotated immediately — the exposed value is invalid. Settings applied with `-o none` on retry.
- App currently has zero effective permissions until admin consent is granted, so the exposure window was inert anyway.


## BAC-10 — Repoint forms + form_ts stamp (2026-07-14)

### Checklist
- [x] 14 HTML forms: action="/inc/form/action.php" → "/api/contact-form" (byte-exact replace, UTF-8 no BOM preserved)
- [x] main.js: initFormTimestamps() stamps input[name=form_ts] at page load (min-fill gate live once deployed)
- [x] Browser verification on local server: contact + service forms repointed, fresh epoch stamp each load (raw HTML still frozen), no console errors, form-less pages no-op
- [x] PR #4 merged by user, SWA deployed
- [x] Live E2E: production form → Graph → delivered to external Gmail test recipient (inbox), confirmed by Rourke (2026-07-15)
- [x] Jira comment + transition → Done (2026-07-15)

### Review
- Full chain proven on production: form POST → /api/contact-form → Graph sendMail as donotreply@ → external delivery. Recipient then switched to broughton@ via CONTACT_RECIPIENT app setting (config-only, no redeploy).
- Optional residual check: one service-page form submission to exercise the service_form path live (unit-tested; only form_id/subject differ from the proven contact path).


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


## BAC-12 — Staging verification sweep incl. mobile (2026-07-15)

### Checklist
- [x] Build `scripts/verify-site.mjs` (zero-dep crawler, models `mirror.mjs`'s style): filesystem-driven page discovery (137 pages — the authoritative count; `sitemap.xml` has only 127 `<loc>` entries and is known-incomplete, README's "148" is a stale figure from an earlier count), config-driven redirect/404 checks, `site/files/` content-type checks, same-site reference extraction (href/src/poster/data-src/srcset/meta/CSS `url()`) against a small external-domain allowlist
- [x] Baseline run against live staging (pre-fix): confirmed clean except 8 known-bad `gcz.co.za` URLs — proved the tool catches real bugs (red-then-green)
- [x] Found + fixed 3 bug categories:
  - 10 pages (About + 9 service pages) linked docs/one info page/one image to the agency's dev-preview domain `gcz.co.za` instead of local `site/files/`/`site/couch/uploads/` paths. Fetched the missing image fresh from the still-live `gcz.co.za` URL, SHA-256 hash-verified it against the same file in the gitignored local `archive/` backup (matched), stripped the literal URL prefix from all 10 files.
  - 12 nav/CTA links on Home + About had a duplicated leading slash (`href="//about"`, `"//services/*.html"`, `"//contact/"`) resolving to bogus hosts instead of root-relative paths.
  - 34 blog posts contain inline body-text links to 5 distinct old flat URLs (`/air-freight.html`, `/bonded-warehousing.html`, `/sea-freight.html`, `/contact.html`, one `/news/*.html` post) that 404 today. Fixed via 5 new redirect routes in `staticwebapp.config.json` mirroring the 4 already there, rather than editing every post.
- [x] Feature branch → develop (merged), PR #5 (develop → main) opened — **not yet merged** (user merges per convention)
- [x] Clean `verify-site.mjs` run against PR #5's Azure preview environment: 137/137 pages, 9/9 redirects, 404 ok, 6/6 files, 321/321 refs ok, 0 fail
- [x] Manual Chrome walkthrough (desktop) of home/about/contact/one service page/blog index+post+pagination/video-hub/one info page/404 — all correct; clicked through the fixed doc-link and internal-link fixes live
- [x] Mobile: `resize_window` tool doesn't work in this environment (confirmed 3× via `window.innerWidth`, stuck at 1920×1080) — worked around it with a headless Chrome screenshot (`chrome --headless=new --window-size=390,844`), a true 390px render. Found the hamburger trigger shows *alongside* the full desktop nav (not replacing it) at mobile width — confirmed via a side-by-side screenshot **pixel-identical to current live production** (`baclogistics.co.za`), so this is a pre-existing site characteristic, not a migration regression; out of scope to fix here. Mobile nav toggle JS logic verified separately by dispatching a real click in-page (`aria-expanded` flips, panel opens with 28 correctly root-relative links).
- [x] Contact form: synthetic probe (`form_id=bogus_value`, rejected before spam/send logic) → expected 400 JSON, zero emails sent — per user's explicit decision to rely on BAC-10's already-proven real delivery rather than send another test email this round
- [x] Confirmed "nothing public yet": `baclogistics.co.za` DNS still resolves to the old host (41.76.104.35), zero custom hostnames bound to the Azure Static Web App
- [ ] User merges PR #5 → main
- [ ] Final `verify-site.mjs` run + synthetic form probe against the real `ambitious-bush-...` default hostname (post-merge)
- [ ] Jira comment + transition → Done (post-merge confirmation)

### Review
- Fable (advisor) review before planning caught an important sequencing issue: the default staging hostname only redeploys on push to `main`, so "fix it, then re-check staging" would have silently checked the stale, unfixed deployment. Verified against the PR preview environment instead (created on PR open, no merge needed).
- Fable review before declaring done confirmed the "In Review, not Done" gate is correct per the ticket's literal wording ("on the *.azurestaticapps.net staging URL"), flagged the mobile-viewport gap (resolved via headless Chrome, above), and flagged that "every page loads with correct layout" is exhaustively proven for load/asset-resolution but only sampled for visual layout correctness (~10 template types) — noting that distinction here rather than overclaiming full-site pixel review.
- `cd api && npm test` — untouched by this ticket, sanity-checked green.

