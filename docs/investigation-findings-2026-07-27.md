# Investigation findings — 502s, shared components, and the legacy asset path

Answers `docs/investigation-brief-shared-components.md`. Investigated 2026-07-27.
No production behaviour was changed. Measurements, commands and counts are given so
every claim here can be re-run.

## Verdicts up front

| Workstream | Verdict |
|---|---|
| 1 — intermittent 502 | **Root cause not established**; the 502 did not reproduce in 1,661 requests. But the *10–20 s stalls* reported alongside it are a **separate, explained problem**: bandwidth contention on a 2.02 MB home page, 54 % of which is one PNG. |
| 2 — duplication | **Leave it.** Duplication is real and large (~60 % of every page, 39 files behind 135 public URLs), but measured drift is **zero**. The case for a build step rested on drift risk that does not exist. Add a CI guard instead — and separately, fix `og:image`, which is empty on 128 of those 135 URLs. |
| 3 — `/couch/uploads/…` | **Don't rename.** A precondition failed: SWA wildcard redirects do **not** preserve the captured path (proven on staging), so 157 indexed image URLs cannot be kept alive by a one-line rule. |

---

## Workstream 1 — the 502 and the stalls

### What was measured

| Probe | Requests | Non-200 | p50 | max |
|---|---:|---:|---:|---:|
| Sequential, 6 targets × 3 hostnames, from 07:24 UTC | 393 | 0 | 0.92 s | 2.75 s |
| Sequential, `/inc/css/main.css` @ 2 s, 07:40–07:56 UTC | 345 | 0 | 0.72 s | 2.21 s |
| Sequential, `/` @ 2 s, 07:40–07:56 UTC | 325 | 0 | 0.89 s | 2.61 s |
| **Concurrent** — 25 × full 23-resource page load | 598 | 0 | 0.55 s | **8.98 s** |

**1,661 requests, zero 502s, zero 5xx.** The failure is rarer than that.

(The first probe was still running when this was written; its count is as of 07:57 UTC
and only grew. No non-200 was ever recorded on any probe.)

### The Functions host is not in the static path — settled

- Over 1,000 sequential static-asset requests produced **zero** entries in Application
  Insights, while `/blog/*` requests appear there reliably. The instrumentation works;
  static requests simply never reach the app.
- The deployed `staticwebapp.config.json` matches the repo byte for byte (verified by
  behaviour: 301 on `/about.html`, 302 to Entra on `/admin/`, 404 override serving the
  2,709-byte `404.html`, `/blog/` served by the Function). **No route matches `/inc/*`
  or `/couch/*`.** The `404` `responseOverrides` entry is a static rewrite, not a
  Function invocation.
- Function telemetry has **never recorded a 502** — result codes across the workspace's
  full history are 200, 303, 400, 401, 403, 404, 499 and 500 (the 17 × 500 on 2026-07-23
  are the cutover-day Key Vault failure already documented in the README).

So the 502 was emitted by the SWA edge, which is the only server in the path.

### The stalls are bandwidth contention, not an origin stall

This is the part that *is* solved.

- Sequential probing never exceeded **2.75 s** in 1,063 samples.
- The same machine, same network, loading the **whole page concurrently** — which is what
  a browser does — hit **8.98 s**, and 3 of 25 page loads exceeded 3 s.
- On that 8.98 s request, **TTFB was 0.77 s**. The server answered promptly; the
  remaining 8.2 s was transfer. The small requests that showed high TTFB (2.1–2.9 s) were
  all in rounds where large transfers were in flight — queuing on a saturated link.

The cause is page weight:

| Home page | |
|---|---:|
| Resources | 23 |
| Total | **2,118,186 bytes (2.02 MB)** |
| `/couch/` images | 1.54 MB (76 %) |
| `bac-header1.png` alone | **1,148,209 bytes — 54 % of the page** |

A 1.1 MB PNG used as a photographic header is the single largest lever on this site.
The reported 13.4 s / 10.1 s / 20.1 s figures are consistent with this mechanism on a
slower or more contended link than the one used here.

### Cache headers make it worse than it needs to be

Every static asset returns `Cache-Control: public, must-revalidate, max-age=30`. There is
no `globalHeaders` block anywhere in `staticwebapp.config.json`, so this is the Azure SWA
platform default, not a project choice. Consequences:

- A returning visitor revalidates **all 23 subresources every 30 seconds**.
- `ETag` is **deployment-scoped, not content-scoped** — `main.css`, the home page,
  `all.min.css` and a PNG all returned the identical `ETag: "66942793"`. Every deploy
  therefore invalidates every client's copy of every asset simultaneously.
- The contrast is stark: `/blog/media/*`, served by the Function, already sets
  `max-age=31536000, immutable`. The 104 MB of images in the deploy get 30 seconds.

Origin contact is roughly **20–40× higher than necessary**. That does not cause a 502,
but it multiplies the number of chances to hit one.

### Ranked hypotheses for the 502 itself

**H1 — transient SWA edge fault (most likely).** A 502 requires a server to answer, and
the edge is the only candidate. The app provably never produced one. Rate is low enough
that 1,661 requests missed it. Not falsifiable with the evidence available today —
which is precisely the gap now closed (below).

**H2 — deploy-window content distribution.** The 502 and the stalls were observed inside
a 30-minute window containing **five deployments** (06:34, 06:38 ×2, 06:54 ×2 UTC, then
production at 07:03). A deployment-scoped ETag means every deploy forces a full re-fetch
of every asset from origin at once. A **controlled staging deploy** run for this
investigation (07:41:43 → 07:42:57 UTC) produced the only elevated sample in an otherwise
flat period — but only 2.2 s. The mechanism is real; the magnitude observed does not
account for a 502 or a 20 s stall. A *production* deploy is a stronger test and was not
run, since that means publishing.

### There were no HTTP logs — that gap is now closed

The SWA had **no diagnostic settings at all**, which is why the original 502 cannot be
traced retrospectively. With your approval I enabled `StaticSiteHttpLogs` → the existing
`bac-debug-logs` workspace:

```powershell
az monitor diagnostic-settings create --name swa-http-logs-temp `
  --resource <swa-resource-id> --workspace <workspace-resource-id> `
  --logs '[{"category":"StaticSiteHttpLogs","enabled":true}]'
```

First data had not yet landed when this was written (new tables typically take 30–60 min).
When a 502 next occurs:

```kusto
StaticSiteHttpLogs
| where ScStatus >= 500
| project TimeGenerated, CsUriStem, ScStatus, TimeTaken, CIp, UserAgent
```

You asked for this **temporarily**. Remove it once a 502 has been caught and understood:

```powershell
az monitor diagnostic-settings delete --name swa-http-logs-temp --resource <swa-resource-id>
```

Cost while it runs: Log Analytics ingestion at ~$2.76/GB — cents per month at this traffic.

### Recommendation — costed

| # | Change | Effort | Effect |
|---|---|---|---|
| 1 | **Re-encode `bac-header1.png`** as JPEG/WebP at equivalent visual quality | ~1 h | Removes ~1 MB (≈50 %) from every cold home-page load. Directly attacks the mechanism that produced the 9 s stall. Highest user-visible value. |
| 2 | **Cache headers** in `staticwebapp.config.json`: `/couch/*` and `/inc/font-awesome/*` → `max-age=31536000, immutable`; `main.css` / `main.js` → `max-age=300` (drop `must-revalidate`) | ~30 min + staging soak | 20 of 23 requests stop revalidating every 30 s. Cuts origin contact ~20×, and with it the exposure to whatever produces the 502. |
| 3 | **Keep `StaticSiteHttpLogs` on** until a 502 is caught | done | Turns the next occurrence into one query instead of another blind investigation. |

On (2), no cache-busting scheme is needed: at `max-age=300` the worst case for a CSS change
is five minutes' staleness, which avoids the 39-file versioning sweep the brief was rightly
wary of. One precondition to verify on staging first — that route `headers` override the
platform default `Cache-Control`. That is a two-push test using the same method that settled
the wildcard-redirect question below.

**Not recommended as a 502 fix:** moving `site/couch/` out of the deploy. `site/` is
109.55 MB against the SWA Standard 500 MB limit (22 %), deploys complete in 70–85 s, and
static assets provably never touch the Functions host — so app size has no path by which it
could affect static-asset latency. That is a Workstream 3 question, not a Workstream 1 fix.

---

## Workstream 2 — shared components and duplication

### Scope

42 tracked HTML files: 39 under `site/`, 3 under `api/src/blog-templates/`. Three are
stripped shells with no public chrome (`site/404.html`, `site/admin/index.html`,
`api/src/blog-templates/error.html`), leaving **39 full-shell pages** — matching the
figure in `docs/shared-header-duplication.md`.

### How much is duplicated

Measured empirically rather than by naming regions in advance: for a representative page
(`site/about/index.html`), lines appearing verbatim in ≥ 36 of the 39 pages.

| Block | Span | Non-blank lines |
|---|---|---:|
| `</head>` through the end of the header/nav/hero | lines 58–532 | 318 |
| Footer | lines 829–891 | 53 |
| Doctype, preconnects, favicon/manifest | lines 2–24 | 17 |
| Twitter/OG meta scaffolding | lines 43–54, 36–40 | 15 |

**403 of 675 non-blank lines (60 %) of a typical page is shared chrome.** 204 lines are
identical across all 39 pages.

### Per-block inventory

| Block | Files | Instances per file | Total | Byte-exact variants | Drifted? |
|---|---:|---:|---:|---|---|
| Header top bar (contact strip) | 39 | 1 | 39 | 1 | no |
| — CTA buttons (`#glht-cta-btns`) | 39 | 1 | 39 | 1 | no |
| — Socials + mobile CTAs (`#glht-socials`) | 39 | 1 | 39 | 1 | no |
| Header bottom (`#gl-header-bottom`) | 39 | 1 | 39 | 1 | no |
| — Logo wrapper | 39 | 1 | 39 | 1 | no |
| — Nav | 39 | 1 | 39 | 1 | no |
| Footer | 39 | 1 | 39 | 1 | no |
| GTM script | 41 | 1 | 41 | 3 (2 are stripped shells) | no |
| GTM noscript | 39 | 1 | 39 | 1 | no |
| Favicon / manifest block | 41 | 1 | 41 | 2 (1 is a stripped shell) | no |
| Font preconnects | 41 | 2 | 82 | 2 (1 is a stripped shell) | no |
| OG / Twitter meta scaffolding | 39 | 12 tags | 468 | 1 *structure* | no (see below) |

The contact-detail counts inside those blocks reconcile exactly with the existing
documentation: `wa.me/+27113531111` → 78 (2 × 39); `tel:0119747472` → 79 (2 × 39, plus the
third instance in `site/contact/index.html`); `GTM-MPPHRHH` → one per file.

### Blast radius

Source files are a misleading measure, because two of the 39 are templates:

| | Source files | Public URLs served |
|---|---:|---:|
| Static pages in `site/` | 37 | 37 |
| `api/src/blog-templates/post.html` | 1 | 90 (published posts) |
| `api/src/blog-templates/index.html` | 1 | 8 (`/blog/` + 7 pagination pages) |
| **Total** | **39** | **135** |

So editing any shared block means touching **39 files to change 135 URLs**. The asymmetry
is the point: **the two blog templates are 5 % of the files but 73 % of the affected URLs.**
A sweep that covers `site/` and forgets `api/src/blog-templates/` leaves 98 of 135 public
pages — the majority of the site — showing the old value, while every page a developer is
likely to spot-check looks correct. That is the single highest-risk mistake available here,
and it is exactly what the CI guard below prevents.

### Drift: zero

Each shared region was extracted per file and hashed byte-exactly:

| Region | Present in | Byte-exact variants |
|---|---:|---|
| header top bar, CTA buttons, socials, header bottom, nav, logo wrapper, footer, GTM noscript | 39 | **1 each** |
| font preconnects, favicon block, GTM script | 40–41 | 1 + the stripped shells only |
| tail scripts | 39 | 1 + `site/index.html` (extra slider script — intentional) |

A separate sweep for lines present in *most but not all* pages — the shape drift takes —
returned **4 candidates, all legitimate structural differences**: three absent from
`blog-templates/post.html` because its head is templated, and `gl-hero-image` absent from
the four page types that have no hero.

Contact-detail counts reconcile exactly with the existing documentation:
`wa.me/+27113531111` → 78 (2 × 39); `tel:0119747472` → 79 (2 × 39, plus the third instance
in `site/contact/index.html`); `GTM-MPPHRHH` → one per file.

### The OG scaffolding is consistent — and consistently empty

The meta/OG block has **one structure across all 39 pages** (the same 12 tags in the same
order), so there is no drift. But auditing the *values* rather than the markup turns up a
real defect:

| Tag | Populated | Empty |
|---|---:|---:|
| `og:title`, `og:url`, `twitter:card`, `twitter:title` | 39 | 0 |
| `og:description`, `twitter:description` | 36 | 3 |
| **`og:image`** | **1** | **38** |
| `og:locale`, `og:type`, `og:site_name`, `twitter:site` | 0 | **39** |

Combined with the blog finding — `og_image` is empty on all 90 stored posts — this means
**essentially the whole site renders an empty `og:image`**: 38 of 39 static pages and 90 of
90 blog posts. Every link shared to WhatsApp, LinkedIn or Facebook falls back to whatever
the platform can scrape, which for these pages is usually nothing.

For a business whose value is organic search and referral traffic, that is worth more than
the duplication question this workstream was asked about. It is also cheap: the scaffolding
is already present and uniform, so this is a value-population exercise, not a markup change.
`featured_image` is the obvious source for posts and is already available in `render.js`.
`og:locale` (`en_ZA`), `og:type` (`website`/`article`) and `og:site_name` (`BAC Logistics`)
are constants.

**One correction to the docs:** `docs/shared-header-duplication.md` records
`Mobile: +27 83 375 5906` in `privacy-policy.html:804` as a known inconsistency. That was
fixed in commit `571cd6d`; the old number no longer appears anywhere under `site/`. The
doc is stale on that point.

### Verdict

**The prior recommendation to leave it alone stands, and is better supported now than when
it was written.** The argument for a build step was drift risk. Drift is zero across 39
files and every shared region — the sweep discipline in `docs/shared-header-duplication.md`
is demonstrably working. A build step would end the plain-files/no-build property, change
the workflow, and produce a 39-file diff against a live site to solve a problem that has
not occurred.

Client-side injection remains rejected for the reason already recorded: it puts the primary
CTAs and phone number behind JavaScript on a site whose value is organic search.

### Recommendation — costed

| Change | Effort | Effect |
|---|---|---|
| `scripts/check-chrome.mjs` — assert every shared region is byte-identical across all 39 files; one CI step | ~2 h, ~80 lines | Converts "drift is possible" into "drift cannot merge", with no build step and no change to how the site is served. Fails the PR that forgets `api/src/blog-templates/` — the 5 %-of-files / 73 %-of-URLs trap. |
| **Populate `og:image` and the four always-empty OG tags** | ~2 h | 128 of 135 public URLs currently render an empty `og:image`. Highest business value in this workstream, and it is filling in existing markup rather than changing it. |
| Update `docs/shared-header-duplication.md` — drop the now-fixed privacy-policy inconsistency | ~10 min | Keeps the runbook trustworthy. |

That guard buys the entire benefit the build step was proposed for, at a fraction of the risk.

---

## Workstream 3 — the `/couch/uploads/…` path

### Full inventory

| Where | References | Detail |
|---|---:|---|
| Tracked repo files (excl. `docs/`) | **202** | across 42 files; incl. 1 test fixture |
| Blob Storage post JSON | **96** | 90 × `featured_image` (one per post) + 6 inside `json_ld` |
| **Total** | **298** | **157 distinct paths** |

| On disk | |
|---|---:|
| `site/couch/` | 156 files, **104.33 MB** (95 % of `site/`) |
| Referenced somewhere | **156 — all of them** |
| Never referenced | 0 |

**Two corrections to the brief's assumptions:**

1. **Post bodies contain zero `/couch/uploads` references.** Every stored reference is in
   `featured_image` or `json_ld`. Data migration would be 90 single-field edits plus 6
   JSON-LD strings — materially simpler than a body-HTML rewrite.
2. **Blog images do not live in Blob Storage today.** The `blog` container holds only
   `posts/` (90 blobs, 0.94 MB); the `uploads/` and `documents/` prefixes are empty. Every
   blog post's featured image is served from the static deploy at `/couch/uploads/…`.
   The count is 90 posts, not ~99.

The one reference that resolves to nothing — `/couch/uploads/image/blog/x.png` — is a test
fixture in `api/test/blog-render.test.js:9`, not a live 404.

### The blocking finding

Verified directly on staging (probe route added, tested, reverted in `2f96015`; the config
is now byte-identical to its pre-investigation state):

```
GET /redirect-probe/image/blog/foo.png
→ 302  Location: /redirect-target/*
```

**Azure SWA emits the destination `*` literally.** A wildcard redirect cannot carry the
captured path. So there is no one-line rule that keeps 157 existing image URLs — indexed by
Google Images and potentially hotlinked — working after a rename. The alternatives are 157
explicit redirect routes, a Function catching `/couch/uploads/*`, or keeping the files at
both paths (which doubles the artifact and defeats the purpose).

### Verdict

**Don't rename.** The benefit is cosmetic: `/couch/` is an internal path string. It carries
no CouchCMS branding, appears in no user-visible copy, and the prose references and
generator comment — the parts a visitor or a journalist could actually read — have already
been removed. Against that: 298 reference edits spanning the repo *and* live Blob data, a
redirect strategy with no cheap implementation, risk to indexed image URLs, and a rollback
that means re-editing 90 live blobs.

### If you want it done anyway — the costed path

The Blob-migration option is the better of the two, because it addresses the name *and*
removes 95 % of the deploy artifact. It is not free:

| Step | Note |
|---|---|
| Rename 5 colliding basenames | `air-freight.jpg`, `aog.jpg`, `bonded-warehousing.jpg`, `road-freight.jpg`, `sea-freight.jpg` each exist in both `image/home/` and `image/services/` with **different content** (e.g. 10 KB thumbnail vs 130 KB full-size), and `/blog/media/<file>` accepts flat filenames only |
| Upload 156 files to `uploads/` | Container and store code already exist |
| Extend `routeBlogPath` for one subdirectory level | Or accept the flattening |
| Rewrite `featured_image` at render time in `render.js` | **Avoids migrating the 90 stored blobs entirely** — a 3-line change instead of a data migration, and trivially reversible |
| Update 202 repo references | Standard sweep; assert `git diff --shortstat` per `tasks/lessons.md` |
| Add a Function for `/couch/uploads/*` → 301 | The only way to preserve old URLs, given the wildcard finding |
| Staging soak + `scripts/verify-site.mjs` | Before any PR to `main` |

Estimate **1–2 days** including verification. Rollback is clean up to the point the repo
references change; after that it is a revert plus a redeploy.

Note what this does *and does not* buy. It removes 104 MB from the deploy — but deploys
already complete in 70–85 s and app size has no demonstrated effect on serving. It puts
every image on a 1-year immutable cache — but **Workstream 1's recommendation 2 achieves
exactly that cache benefit in 30 minutes, with none of this risk.** Take the cache headers
first; then judge whether the remaining benefit still justifies the work.

---

## Appendix — method

- Latency probes: `curl.exe` with `-w '%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer},%{time_total}'`,
  sequential at 2–4 s and concurrent via `--parallel --parallel-max 12` against a
  23-URL config file built from the live home page.
- Baseline network shape (South Africa → West Europe): DNS ~19 ms, TCP connect ~190 ms,
  TLS complete ~385 ms, TTFB ~650 ms. Roughly 250 ms of that is server-side. A sub-second
  TTFB is structural for this region, not a fault.
- Telemetry: `az monitor app-insights query` against `bac-swa-debug`, and
  `az monitor log-analytics query` against `bac-debug-logs` (the App Insights component is
  workspace-based; the workspace holds substantially more history than the component API
  surfaces — `AppRequests` 1,751 rows vs 15 via the component query).
- Duplication and drift: per-file region extraction with byte-exact and
  whitespace-normalised hashing, plus a line-frequency sweep across all 39 full-shell pages.
- Deploy timeline: `gh run list`, correlated against Functions host restarts in `AppTraces`.

### Side observations, not acted on

- The Functions host logs `azure.functions.webjobs.storage: Unhealthy — Unable to create
  client for AzureWebJobsStorage` every 30 s. `AzureWebJobsStorage` is not among the SWA
  app settings; managed Functions on Static Web Apps do not provide one. Functions execute
  correctly and return 200, so this appears to be a benign platform artifact rather than a
  misconfiguration — but it is noise that would mask a real storage fault, and worth
  confirming with Azure support if you ever open a ticket.
- 4 × `TaskCanceledException` on `Functions.blog` between 2026-07-24 and 2026-07-25,
  matching the two 499s — blob reads that were cancelled. Low volume; noted, not chased.
