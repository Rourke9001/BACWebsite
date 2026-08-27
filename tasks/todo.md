# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-28 — Digital Presence Audit: contact-detail corrections

Source: "BAC Logistics — Digital Presence Audit" (external, predates the Stage 1–6b work).
Every audit finding was re-verified against the repo before acting — most were already
fixed by that work and needed no change.

### Audit findings — verification results

- [x] **WhatsApp number wrong — REAL, fixed.** The audit reported three numbers; Stage 2's
      single-sourcing had already collapsed them to one, so the live state was *consistently
      wrong* rather than inconsistent: `+27113531111` on all 39 chrome-bearing pages.
      Corrected to `+27743531111` in `data/site.json`.
- [x] **LinkedIn points at the old company URL — REAL, fixed.** `social_linkedin` in
      `data/site.json` was still `broughton-amiss-consulting`; now `bac-logistics-sa`.
      Header only — the footer carries no social links, contrary to the audit's
      "header and footer".
- [x] **`gcz.co.za` download links — ALREADY FIXED, no action.** Zero occurrences anywhere
      in the repo. All 6 documents live at `site/files/` and all 6 references resolve
      exactly (URL-encoded names match the files on disk byte-for-byte).
      `verify:site` against production: **Files 6 ok, 0 fail.**
- [x] **5 P's image on About — ALREADY FIXED, no action.** Now `/media/about/5ps.png`,
      present in the repo and resolving live (inside the 322 passing refs).
- [x] **Homepage counters show "0" — NOT A DEFECT, no action.** `0` is the pre-JS
      placeholder. `site/inc/js/main.js:191` takes the `!isFinite` branch for the
      non-numeric targets `25+`, `24/7`, `100%` and writes the literal string immediately.
- [x] **Broughton's personal number `+27 83 375 5906` — ALREADY GONE.** Zero occurrences;
      `scripts/build-chrome.mjs` has hard-failed the build on it since Stage 2.

### What the change actually touched

- [x] `data/site.json` — two values (`whatsapp`, `social_linkedin`)
- [x] `scripts/build-chrome.mjs` — added the retired WhatsApp number and old LinkedIn slug
      to `RETIRED`, so neither can silently return
- [x] `site/information/privacy-policy.html` — **the guard earned its keep immediately.**
      The regenerate refused to write, reporting `+27 11 353 1111` as body text in the POPIA
      contact block at line 820, outside every chrome region. A chrome-only expander would
      have left it stale and nothing would have flagged it.
- [x] 39 generated files rewritten by `npm run build:chrome`

### Verification

- [x] `npm run check:chrome` — ✓ 39 files match `partials/` + `data/site.json`
- [x] `grep` for every retired value across `site/` + `api/` — **0 occurrences**
- [x] New values present at the expected multiplicity: 78 `wa.me/+27743531111`
      (39 files × 2 links: desktop CTA + mobile social) and 39 `company/bac-logistics-sa`
      (1 per file)
- [x] `npm run verify:site` against **production** (pre-merge baseline): 137 pages,
      101 redirects, 6 files, 322 refs, 136 social — **0 failures**
- [ ] `node scripts/verify-site.mjs <staging-url>` after the PR merges to `develop`
- [ ] Confirm the corrected WhatsApp link opens the right chat on a real handset —
      only the owner can do this

### Corroboration worth recording

The privacy policy labelled the number **"Mobile: +27 11 353 1111"**. `011` is a
Johannesburg landline prefix; `074` is a mobile prefix. The field name and the digits
contradicted each other, which is independent evidence — separate from the audit's
Facebook cross-check — that `74` was transposed to `11` at some point.

### Review

Two data values and one line of body text were wrong; everything else the audit raised had
already been fixed by the Stage 1–6b work and was confirmed clean rather than assumed.
The `RETIRED` list is the load-bearing part of this change: it converted "remember to also
check page bodies" into a build failure, and caught a real instance on the first run.

Deliberately **not** done: the `tel:` landline `0119747472` is unchanged — the audit did
not flag it, and it is consistent site-wide (39 pages plus the displayed
`+27 11 974 7472` on the contact and privacy pages). The Stage 7 README housekeeping
listed at the end of the previous task also remains outstanding.

---

## Contact form anti-spam (2026-08-06)

- [x] Diagnose which gate the live spam passed — all five, three of them broken
- [x] Cloudflare Turnstile: client injection + server-side siteverify
- [x] Bound `form_ts` at both ends (the actual root cause)
- [x] Move rate limiting to Azure Table Storage on the existing account
- [x] Weighted content scoring, logged on every submission
- [x] `<noscript>` fallback on all 14 form pages
- [x] Tests: 64 -> 96, including four that asserted the old broken behaviour
- [x] Create the Turnstile widget, 9 hostnames covering both sites
- [x] Verify on localhost and on the staging deployment
- [x] PR #32 develop -> main
- [ ] **Owner action:** set `TURNSTILE_SECRET` on both SWAs
- [ ] Port to `BACTransportWebsite` (handoff prompt issued) — includes its CSP fix

### Review

The honeypot and rate limiter were widely assumed to be working. They were not: the
rate limiter's in-memory `Map` resets on every SWA Consumption cold start, and the
min-fill-time gate could only ever reject submissions that were too *fast* — so the
frozen build-time `form_ts` literal, which is weeks stale, passed it every time. That
one-sided comparison is the reason a plain scripted POST sailed through, and fixing it
was three lines. Turnstile is the durable answer, but the bug was ours.

Four existing tests encoded the broken behaviour, one named "frozen/absent form_ts
passes". Tests asserting a bug is present are worse than no tests: they convert a defect
into a documented invariant and make the next person hesitate to fix it.

Deliberately **not** done: the frozen `form_ts` literals were left in the HTML rather
than emptied across 28 files. The age check makes them self-correcting — with no build
step they only ever get older — so removing them buys nothing.

Fail-open on a Cloudflare outage, a missing secret, or an unreachable rate-limit table
is intentional and flagged with an `[UNVERIFIED]` subject prefix. For a logistics
business, dropping real enquiries silently is the worse failure.

---

## Digital estate audit remediation — 2026-08-23

Working from `BAC-Digital-Estate-Report-2026-08-23.docx`, addressing only what
`baclogistics.co.za` owns in this repo. `bactrans.co.za` is a separate task.

### Verified against the live site before acting

Three findings in the report did not survive checking, and are recorded here so
nobody re-fixes them:

- [x] **A2 "legacy site still live and indexed" — mostly wrong.** `/about.html`,
  `/logistics.html`, `/air-freight.html`, `/contact.html`, `/sea-freight.html` and
  `/bonded-warehousing.html` all already return 301. The auditor appears to have
  read Google SERP entries rather than fetching the URLs. Only `/news/` was real.
- [x] **A2 "conflicting founding date" — already resolved.** The current site says
  1999 throughout; "over 25 years" is consistent with it. The 1998 figure existed
  only on the retired `/about.html`, which now redirects.
- [x] **A4 "canonical points at non-www while the site serves www" — backwards.**
  The site uses the apex form in all 151 absolute self-references and zero www
  ones, and the canonical tags match. The real defect is that both hostnames
  return 200 with no redirect between them — an Azure custom-domain setting, not
  a repo change. Carried to the owner-action list below.

### Done

- [x] **`/news/*` → `/blog/*` 301s.** Two wildcard routes to the blog Function,
  which resolves the slug against live posts. Handles foldered posts, underscore
  slugs, deleted posts, and a storage outage. See `docs/legacy-news-redirects.md`.
- [x] **Removed the superseded per-article `/news/` redirect** — config went from
  18,175 to 17,507 bytes against the 20 KB SWA ceiling.
- [x] **POPIA consent is now enforceable.** `required` on all 14 forms, rejected
  server-side, and recorded affirmatively with the exact wording and an ISO
  timestamp instead of a bare `1` that was absent when unticked.
- [x] **Standardised the consent wording.** The 13 service pages said "you consent"
  while the contact page said "I consent" — a drift the new test caught. All 14 now
  use the first-person form, pinned to `handler.CONSENT_WORDING`.
- [x] **`tel:` links international** — `+27119747472` across 89 page-body hrefs and
  `data/site.json`. Display text stays `011 974 7472`.
- [x] **`alt="alt"` removed** — the three contact icons are decorative (`alt=""`,
  their headings already name them); the homepage image got a real description.
- [x] **YouTube `?si=…?rel=0` fixed** on 6 pages, so `rel=0` is honoured and
  competitors' videos stop appearing in end screens.
- [x] **Homepage counters server-render their values** (`25+`, `24/7`, `100%`)
  instead of a literal `0`; the count-up resets to zero when it actually starts.
- [x] **Meta descriptions written for 21 pages**, all 150–160 chars, and
  `og:description` / `twitter:description` synced to match on 21 pages.
- [x] **Organization JSON-LD on all 37 pages** via a new `partials/org-schema.html`.
- [x] **FAQPage JSON-LD on `/about/`**, derived from the accordion by
  `scripts/build-faq-schema.mjs` so the two cannot drift.
- [x] **Guards added** — `tel:0119747472` and `alt="alt"` to the build's `RETIRED`
  list, plus `api/test/site-markup.test.js` and `api/test/consent-markup.test.js`.
- [x] Tests 96 → 119, all passing. `check:chrome` and `check:faq-schema` clean.

### Owner actions — outside this repo

- [ ] **A1 CRITICAL: enable DKIM** on both domains in the Defender portal.
- [ ] **A1 CRITICAL: publish DMARC + a working `rua` mailbox** on both domains.
- [ ] A1: map every third-party sender, then move to `p=quarantine`, then `p=reject`.
- [ ] A1: publish CAA records; correct the `baclogistics.co.za` MX endpoint, which
      currently points at `bactrans-co-za.mail.protection.outlook.com`.
- [ ] Decide www vs apex and make one 301 to the other (Azure custom domain).
      The repo already commits to apex, so www → apex is the no-change-here option.
- [ ] Run WHOIS on `bactransport.co.za`; record the expiry date. Register
      `bactransport.online` and other free variants.
- [ ] Facebook vanity URL, Instagram, the two LinkedIn company pages, the YouTube
      "depenable" typo, the orphaned `BAC_Updates` handle.
- [ ] Trade mark filing in Class 39; brand standardisation on "BAC Logistics" /
      "BAC Transport" in full.

### Blocked on a decision from Rourke

- [ ] **Incoterms 2020 `.docx`** — ICC licensed content. Remove, or link to the ICC,
      or keep pending legal advice? Currently still served from `/files/`.
- [ ] **Information Officer** — the privacy policy refers to "the Information
      Officer" generically. POPIA wants them named. Who is registered?
- [ ] **Postal code** — omitted from the Organization schema because it is not
      published anywhere on the site. Supply it and the schema improves.
- [ ] **Opening hours** — not published, so the schema is `Organization` rather
      than `LocalBusiness`. Supply them to upgrade it.
- [ ] **Counter labels** — "Real-time Monitoring" and "Customer Satisfaction Rate"
      are not numeric metrics and arguably should not be counters. Left as-is:
      that is a design decision, not a defect.

### Deferred — separate project

- [ ] Convert the `.xls` / `.docx` clearing instructions to PDF or fillable web
      forms. Rourke's call: this is a project, not a defect fix.

---

# SEO brief — "BAC Logistics Developer Briefing Doc, August 2026 2.0"

Source: `BAC Logistics Developer Briefing Doc_ August 2026 2.0.md` (SEO: Rifumo,
25/08/2026). Four tasks; the doc numbers the last one "#1" again — treated as #4.

## Task 1 — BCC `leads@ideation.co.za` on every form and email link

- [x] Added a `bcc` leg to the email sender interface (`api/src/lib/email.js`):
      `bccRecipients` on the Graph payload, logged by the stub.
- [x] Default `leads@ideation.co.za` in `api/src/lib/handler.js`, overridable via
      a `CONTACT_BCC` app setting (same shape as `CONTACT_RECIPIENT`).
- [x] Appended `?bcc=leads@ideation.co.za` to all 16 `mailto:` hrefs (14 pages).
- [x] Tests: the handler passes the BCC through, Graph puts it in `bccRecipients`
      and not `toRecipients`, and a markup test pins the mailto parameter.

## Task 2 — dynamic sitemap

- [x] `scripts/build-sitemap.mjs` generates `site/sitemap-static.xml` from the
      file tree (indexable pages + `/files/` downloads), `lastmod` from git.
      Replaces the hand-made "Free Online Sitemap Generator" file, which was
      already stale — it missed a video-hub page and a download added since.
- [x] `npm run build:sitemap` / `check:sitemap`, a CI step, and a test so it
      cannot drift.
- [x] `site/sitemap.xml` stays the index over static + the already-dynamic
      `/sitemap-blog.xml`.

## Task 3 — 301s for seven retired `.php` URLs

- [x] Routes in `site/staticwebapp.config.json`. Space-bearing paths got both the
      literal and the `%20` spelling, since SWA's decode order is not documented.
- [x] Config is 18,457 bytes against the 20 KB ceiling (was 17,507).

## Task 4 — Google Search Console verification

- [x] `<meta name="google-site-verification" content="MT2UTR0nIg-agVuktScp68_-MIDQs4eu2daVYQXTNWc" />`
      in the homepage `<head>`, pinned by a test.

## Verification

- [x] `npm test` 119 → 127, all passing. `check:chrome`, `check:faq-schema` and
      `check:sitemap` clean.
- [ ] Push to `develop`, then check the redirects and sitemap on staging.
- [ ] Open the PR to `main`; Rourke merges.

## Review

**Task 1.** The blind copy is server-side for forms and client-side for `mailto:`,
because those are the only places each can live. The server default sits in
`handler.js` next to `DEFAULT_RECIPIENT` and reads `deps.bcc ?? DEFAULT_BCC` — `??`
rather than `||`, so an operator who deliberately blanks `CONTACT_BCC` gets no blind
copy instead of silently getting the default back. It is `bccRecipients`, never a
second `toRecipients`: the enquirer, and anyone the mail is later forwarded to, must
not see the address.

**Task 2 — the judgement call.** The brief says "populates the sitemap.xml file".
`/sitemap.xml` is a sitemap *index* over a static half and a blog half, and it stays
one: the blog lives in Blob Storage, changes without a deploy, and is already served
dynamically at `/sitemap-blog.xml`. Only the static half was hand-maintained, and it
had already drifted. So the fix is a generator for that half, not a rewrite of the
index. It reads the pages rather than a list: a page is listed when it declares a
canonical and is not `noindex`, and the `<loc>` **is** that canonical byte for byte —
a sitemap URL that contradicts the page's own canonical is a wasted crawl. Net effect:
40 URLs → 42, picking up `cross-border-freight-delays-often-start-before-the-border.html`
and `Customs Tariff - Brief.docx`, both of which the old file had missed.

`priority` and `changefreq` are gone. Google has said publicly it ignores both, and
the old file's identical `2026-06-11T14:40:03` on every page was a `lastmod` that told
crawlers nothing true. Real per-file commit dates are worth more than a uniform lie.

`--check` compares only the `<loc>` set, not the whole file. `lastmod` moves with every
commit that touches a page, so a byte-exact check would fail on the very commit that
regenerates it — unsatisfiable by construction. Missing and orphaned URLs are the drift
that matters, and they are also what a shallow CI checkout can still see.

**One change nobody asked for:** `/information/thank-you.html` is now `noindex,follow`.
It was already absent from the hand-made sitemap, and the generator's rule is "the page
decides" — so leaving it indexable would have *added* a form-confirmation page to search,
the opposite of the brief's objective. Marking it noindex keeps the rule honest and the
outcome the same. Flagged because it is a content change outside the brief.

**Task 3.** All seven URLs are covered by six rules — the brief lists `/index.php` twice
(www and apex), and SWA routes are host-agnostic, so one rule serves both. The test
asserts each destination is a file that exists: a 301 onto a 404 is worse than the 404
it replaced.

**Task 4.** Homepage only, which is where Search Console looks for a URL-prefix property.
A test pins the exact content string, because losing one line in a homepage edit would
un-verify the property and silently stop the data the SEO work is measured on.
