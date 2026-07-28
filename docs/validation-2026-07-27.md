# Validation of the 2026-07-27 investigation and briefs

Independent re-verification of `docs/investigation-findings-2026-07-27.md`,
`docs/brief-site-architecture-single-source.md`, `docs/brief-duplication-and-couch-removal.md`
and `tasks/todo.md`. Read-only: no repo file outside `docs/` and `tasks/` was touched, no Azure
resource was created, modified or deleted, nothing was pushed.

Every claim below was re-derived from source — the repo, the live site, the live Azure
resources, and the 90 post blobs — not from the documents being checked.

## Bottom line

The investigation is unusually well evidenced. Of the claims that can be re-derived, the large
majority reproduce **exactly** — including the ones the migration plan is sized on. Three
material errors, one of which would waste money if acted on. Separately, five system-level
risks that none of the four documents covers, two of which matter more than anything currently
on the plan.

**The sequencing recommendation — architecture first, then `/couch/` — is sound. It survives
scrutiny for a better reason than the one given** (below).

---

## 1. Claims that reproduce exactly

| Claim | Verified against | Result |
|---|---|---|
| 39 chrome-bearing files (37 static + 2 blog templates); 3 stripped shells excluded | `git ls-files "*.html"` = 42 | exact |
| **Measured drift is zero** | Independent re-extraction: 10 regions (incl. `glf-logo-wrapper`), tag-balanced, SHA-256 byte-exact, all 39 files | **1 variant per region, 0 drift** |
| 135 public URLs = 37 static + 8 index + 90 posts | `POSTS_PER_PAGE = 12` (`render.js:7`), ⌈90/12⌉ = 8; 90 posts, **0 unpublished** | exact |
| 202 `/couch/uploads` refs across 42 tracked files (excl. `docs/`) | 204 across 43 — the extra file is `tasks/todo.md` (2 prose refs) | exact |
| 96 blob refs = 90 `featured_image` + 6 `json_ld`, **0 in post bodies** | All 90 post JSONs downloaded and field-walked | **exact — 90 / 6 / 0** |
| 157 distinct paths (repo ∪ blob) | 70 repo-only + 87 blob-only, **zero overlap** | exact |
| `og_image` empty on all 90 posts | All 90 blobs | exact — 90 empty, 0 populated |
| `featured_image` populated on all 90, all `/couch/uploads/` | All 90 blobs | exact |
| 156 files, ~104 MB in `site/couch/`, all referenced | `find` + `du` | exact |
| `bac-header1.png` = 1,148,209 bytes | `ls -l` | exact |
| `Cache-Control: public, must-revalidate, max-age=30` on every static asset | Live `curl -I` × 7 asset types | exact |
| **ETag is deployment-scoped** | 8 distinct resources — HTML, CSS, JS, 3 images, favicon, 404 — **all `"66942793"`** | exact |
| No `globalHeaders` block | `staticwebapp.config.json` | exact |
| SWA has no diagnostic settings | `az monitor diagnostic-settings list` → `[]` | exact |
| `enterpriseGradeCdnStatus: Disabled` | `az staticwebapp show` | exact |
| `blog` container: only `posts/`, 90 blobs, 0.94 MB; `uploads/` + `documents/` empty | `az storage blob list` — 981,857 bytes | exact |
| No `StaticSiteHttpLogs` table in `bac-debug-logs` | Workspace table list | exact |
| `staticwebapp.config.json` byte-identical to pre-investigation | `git diff 571cd6d..HEAD` empty | exact |
| Old mobile number gone from `site/` | `grep` | exact |
| `tel:` 79, `wa.me` 78 | `grep -o` | exact |
| 404 page is 2,709 bytes | Live fetch | exact |
| **SWA wildcard redirects do not preserve the captured path** | Probe commit `1434906` reviewed; `/redirect-probe/*` → `redirect: /redirect-target/*` — a valid test of exactly the proposition | sound |
| Post bodies contain no `http://` and no old-host references | All 90 blobs | confirmed |

The care claims in `tasks/todo.md` also hold: the probe route was genuinely reverted, and the
diagnostic setting is genuinely gone.

---

## 2. Errors

### 2.1 The enterprise-grade CDN hypothesis is not supported — and acting on it costs money

`investigation-findings-2026-07-27.md:124-128` gives, as "the most plausible reason"
`StaticSiteHttpLogs` never appeared, that HTTP logging depends on the enterprise-grade edge and
`enterpriseGradeCdnStatus` is `Disabled`. It is correctly labelled a hypothesis. It is a wrong one:

- `az monitor diagnostic-settings categories list` **on this exact resource, in its exact
  current state**, lists `StaticSiteHttpLogs` and `StaticSiteDiagnosticLogs` as available
  categories. Azure is not gating the category on the edge tier.
- Microsoft's supported-logs reference for `Microsoft.Web/staticsites` lists both categories with
  **no SKU or edge dependency stated**.
- The enterprise-grade edge doc's prerequisites are a custom domain with TTL < 48 h and the
  Standard plan. Its entire limitations section concerns Private Endpoint. HTTP logs are not
  mentioned.

The empty table is more likely an undocumented platform gap (cf. `Azure/static-web-apps#1295`,
open since 2023). **Option (a) in the report — "enable enterprise-grade CDN and retest" — would
cost ~$17.52/month (Standard Azure Front Door Add-on, West Europe, from the Azure Retail Prices
API) with no documented reason to expect it to fix anything.**

There is a cheaper option the report does not consider, which addresses the actual need — catch
and timestamp the next 502: an **Application Insights standard availability test**. It requires
no SKU change, no Front Door, and records the failing response. One test, one location, 5-minute
frequency ≈ **$5.57/month**. (URL ping tests are free but retire 2026-09-30 — don't build on them.)

### 2.2 The `og:image` accounting is wrong, and understates the problem

`investigation-findings-2026-07-27.md:271` records `og:image` as **populated 1 / empty 38**, and
line 275 as "38 of 39 static pages … 128 of 135 public URLs".

Re-derived:

- **Zero of the 39 files carry a populated `og:image`.** 38 have literal `content=""`; the 39th,
  `api/src/blog-templates/post.html:37`, has `content="{{og_image}}"` — a placeholder that renders
  empty, because all 90 posts have `og_image: ""` (verified against blob data).
- There are **37** static pages, not 39. The 38 empties are 37 static pages + `blog-templates/index.html`.
- The `128` is an arithmetic slip: 38 files + 90 posts. It multiplies `post.html` by its 90 URLs
  but counts `index.html` as 1 instead of its 8. `135 − 128 = 7 = 8 − 1`.
- **The true figure is 135 of 135 public URLs rendering an empty `og:image`** — confirmed live on
  `/`, `/about/`, `/blog/` and a real post.
- `twitter:image` is empty on all 39 files and is **absent from the audit table entirely**
  (lines 267-272 list four rows; there should be five).

The recommendation is unaffected and gets stronger. The scope is 135 URLs, not 128.

### 2.3 "157 indexed image URLs" — a measured number attached to an unmeasured claim

`157` is real: distinct `/couch/uploads/` paths across repo ∪ blob (I reproduced it exactly:
70 + 87, disjoint). But at `investigation-findings-2026-07-27.md:355-356` it becomes "**157
indexed image URLs** — indexed by Google Images and potentially hotlinked".

Nothing in any of the four documents — nor in the original brief,
`investigation-brief-shared-components.md:113`, where the assertion first appears — cites Search
Console, crawl data, referrer logs or any hotlink measurement. The claim is inherited verbatim
downstream and a measured count is lent to it.

This matters because **that premise is the sole justification for the redirect Function**, which
is the most complex item in Part 2. It should be checked before it is built: Search Console →
Pages / Images coverage for `/couch/uploads/` will settle it in minutes. If few or none are
indexed, the Function is unnecessary and Part 2 collapses to a rename plus a sweep.

### 2.4 Home-page inventory: the total is right, the resource count is not

I initially read the 2,118,186-byte figure as unreproducible — live HEAD summing gave 1,746,346
across 23 tag-scanned resources, and I found a 24th
(`/couch/uploads/image/home/background.jpg`, 75,056 bytes) referenced only inside an inline
`<style> url(...)`, reaching 1,821,402. **That was my error, and it is corrected here:** adding
the font-awesome webfonts a browser actually downloads (`fa-solid-900.woff2` 158,220 +
`fa-brands-400.woff2` 118,684) and `favicon.ico` (15,406, requested by convention with no `<link>`)
gives **2,113,712 bytes — within 0.2 % of the report's figure.**

So the total stands and the 54 % share of `bac-header1.png` stands. What is wrong is the
**inventory**: "23 resources" misses at least three real fetches (two webfonts, one CSS-referenced
background, plus favicon). Anyone re-running the measurement will not reproduce 23.

### 2.5 "The single largest lever on this site" is an overreach

True for the home page. Site-wide, `bac-header1.png` is ~1 % of the problem:

- **95 images over 500 KB, totalling 96.99 MB** (of `site/`'s ~109 MB)
- **44 PNGs over 1 MB**
- the largest is a *blog* image at **2,379,343 bytes** — more than twice `bac-header1.png`

Recommendation 1 is correctly scoped to the incident it investigated, but the prose invites the
reader to fix one file. A batch re-encode of the 95 is the same class of work, hits every page,
and would cut the deploy artifact by roughly two-thirds — which also removes most of what Part 2's
Blob-migration option was trying to achieve.

### 2.6 The two briefs contradict each other on the Functions host

`brief-site-architecture-single-source.md:87-88` rejects Function-rendered pages partly because
the Functions host "currently reports itself unhealthy every 30 s" and "availability of the whole
site would then depend on it."

`brief-duplication-and-couch-removal.md:127-130` then routes 157 legacy image URLs — the ones
whose continued availability is the entire justification — through that same host, without
acknowledging the risk it just used to reject option 3.

Both positions may be defensible; the difference is not stated or argued. Related: the redirect
Function is specified with **no `Cache-Control` on its 301s**, so every crawler revisit and every
hotlink hit for the whole ~6-month retirement window is a live Function invocation. `documents.js:31`
sets an explicit header for exactly this reason — the pattern being copied already solves it.

---

## 3. What none of the four documents examines

These came out of reviewing the setup itself rather than the documents. Two of them outrank
everything currently on the plan.

### 3.1 The blog content has no backup, and lives in one datacenter

The 90 posts in `bacblogcontent/blog/posts/` are **the only data in this system not in git.**
`site/` is versioned; the post JSONs are not.

- Storage account SKU is **`Standard_LRS`** — three copies in one West Europe datacenter. No zone
  redundancy, no geo-redundancy. A regional incident is a real data-loss scenario.
- There is no scheduled export anywhere in the repo or the runbook.

Mitigating, and better than expected: `isVersioningEnabled: true` and blob soft delete
`enabled: true, days: 30`. So an accidental delete *is* recoverable for 30 days. But
`containerDeleteRetentionPolicy` is `null` — container-level deletion is not protected — and none
of this is recorded in `README.md`. It is incidental infrastructure config that nobody has written
down and anyone could turn off.

The whole content store is 0.94 MB. A scheduled `az storage blob download-batch` into a private
repo or a second account is close to free. Switching LRS → GRS on 1 MB of data is also close to free.

### 3.2 The apex A record is pinned to an IP Azure no longer reports

`README.md:95` documents the apex `A` record as `9.163.40.246`, "the Static Web App's
`stableInboundIP`". Today:

- `az staticwebapp show --query stableInboundIp` returns **`null`**.
- `stableInboundIp` does not appear in Microsoft's published `Microsoft.Web/staticSites` schema
  in either the 2023-01-01 or the current 2026-07-15 REST API reference.
- Microsoft's apex-domain guidance is explicit: *"If the IP address changes, a CNAME entry is
  still valid, unlike A record"*, and recommends ALIAS/ANAME/CNAME-flattening over A records.

The site is serving correctly right now — `nslookup` returns that IP and the apex returns 200.
But the field the runbook says to refresh the record from is empty, so **if Azure ever reassigns
the regional host there is currently no documented way to obtain the new value.** Worth moving to
ALIAS/ANAME at domains.co.za if supported, and worth correcting the README either way.

### 3.3 Two CMS features are fully built, deployed and unused

Both are correct, tested code with zero production data:

- **Admin image upload.** `/admin/` → `POST /api/blog-admin/upload` → `uploads/<slug>-<timestamp>.<ext>`
  in the `blog` container, served at `/blog/media/<file>` with `max-age=31536000, immutable`
  (`handler.js:43`). Whitelist png/jpg/jpeg/webp/gif, 5 MB cap. **The `uploads/` prefix is empty** —
  all 90 posts still point at `/couch/uploads/…` in the static deploy. The feature works; it has
  never been used. The report's "the contrast is stark — `/blog/media/*` already sets
  `immutable`" is technically true but describes a path that serves zero bytes in production.
- **Admin document upload.** `documents/<name>` in the same container, served at `/documents/<name>`
  (`max-age=300`, stable names, overwrite-in-place). **Also empty** — while `site/files/` holds
  six real downloadable documents served statically. Two document systems, one unused, neither
  documented as the intended one. (`README.md:20` also says five; there are six.)

This is directly relevant to Part 2: **the migration target already exists and is already wired
up.** If `/couch/uploads/` images move to blob `uploads/`, they inherit the immutable cache
header for free, without touching `staticwebapp.config.json`.

### 3.4 No concurrency control on post save

`store.js` writes with an unconditional `getBlockBlobClient(...).upload(...)` — no ETag, no
`ifMatch`, no lease. Two authors editing the same post: last write silently wins, no conflict
response. And a slug rename in `admin.js:126-137` is `PUT` new then `DELETE` old with no
rollback — if the DELETE fails the post exists twice.

Low urgency at the current author count. Worth knowing before inviting more authors.

### 3.5 Smaller items

- **`site/admin/admin.js:320`** tells authors "Old versions are kept in storage for rollback."
  Nothing in the application code implements that. It happens to be true because of §3.1's
  storage-account settings — a promise the code does not make and no document records.
- **`az staticwebapp appsettings list` returns secrets in plaintext** (storage key, Graph client
  secret) with no masking flag. `README.md:119` documents this command shape. Worth a warning
  next to it.
- **`README.md` counts are stale**: "38 static pages" (37), "~99 blog posts" (90 — the
  investigation corrected this but README was never updated), "5 downloadable docs" (6).
- **A third `tel:0119747472` sits in `site/contact/index.html` body content**, outside the chrome.
  The investigation counted it (79 = 2×39 + 1). Neither the include-expander (chrome-only) nor a
  value-substitution script keyed to header markers is guaranteed to catch it. Whichever option
  ships needs an explicit sweep for it.

---

## 4. On the sequencing recommendation

**It holds.** Architecture first, then `/couch/`. The stated reason — the logo path change becomes
a one-file edit — is correct. Two things strengthen it:

- The logo lives in `#glhb-logo-wrapper` and `#glf-logo-wrapper`, both verified byte-identical
  across all 39 files, so extraction is mechanical and the guard-style consistency check passes
  before and after.
- The redirect Function's precondition is **proven, not assumed**: `documents.js:11-12` already
  recovers the original path from `x-ms-original-url` behind a SWA rewrite
  (`staticwebapp.config.json:29-32`), and `/documents/*` is live. The brief citing it as "the
  pattern to copy" is validated.

One correction to the ordering logic: doing the architecture work first only helps if
`api/src/blog-templates/` shares the same source. The brief already requires this
(`brief-site-architecture-single-source.md:98-100`) — worth keeping load-bearing, because those
two files carry 98 of 135 URLs.

## 5. Recommended order, revised

1. **Check Search Console for `/couch/uploads/` indexing** (minutes). It decides whether §2.3's
   redirect Function is needed at all, and it gates the most complex item in Part 2.
2. **Back up the 90 post JSONs and put it on a schedule** (§3.1). This is the only unversioned
   data in the system and it has no backup. Consider LRS → GRS at the same time.
3. **Cache headers** — recommendation 2 of the report, unchanged. Verify on staging that route
   `headers` override the platform default before trusting it.
4. **Batch re-encode the 95 oversized images** (§2.5), not just `bac-header1.png`.
5. **Populate OG tags** — scope is 135 URLs, not 128; add `twitter:image`; add the
   `featured_image` → `og_image` fallback in `render.js`, which does not exist today.
6. **Architecture / single-source chrome**, then **`/couch/` → `/media/`**, per the existing briefs.
7. **Fix the apex record** (§3.2) and correct the stale README counts (§3.5).

Not recommended: enabling enterprise-grade edge to chase HTTP logs (§2.1). If tracing the next
502 matters, use an availability test at roughly a third the cost.
