# Brief — shared-component guard + removing the `/couch/uploads/` path

Hand this to a fresh session. Everything below the line is the brief.
Findings it builds on are in **`docs/investigation-findings-2026-07-27.md`** (read it first) —
this brief assumes that investigation and does not repeat its evidence.

---

## Prompt

You are implementing two related changes on **baclogistics.co.za** (static site on Azure
Static Web Apps, `app_location: site`, `api_location: api`, rg `rg-baclogistics-web`).
Read `README.md`, `DESIGN.md`, `CLAUDE.md`, `tasks/lessons.md` and
`docs/investigation-findings-2026-07-27.md` first.

Both changes touch all 39 chrome-bearing HTML files. **Do them as two branches and two PRs,
in the order below** — the first builds the guard that makes the second safe.

### Context you must not re-litigate

- A **build step for `site/` was considered and rejected**, twice, on evidence. Measured
  drift across all 39 files is **zero**. Do not propose templating the site.
- **Client-side header injection was rejected** — it puts the primary CTAs and phone number
  behind JavaScript on a site whose value is organic search.
- The owner has **decided to remove the `/couch/` path**. The prior investigation
  recommended against it; that recommendation was heard and overruled. Implement it well
  rather than re-arguing it. Do carry forward the one real risk it identified (below).

### Part 1 — the drift guard (do this first)

Add `scripts/check-chrome.mjs` plus a CI step that fails a PR when the shared chrome
diverges across files.

What it must assert: for each shared region, every file that contains it contains a
**byte-identical** copy. Regions and their markers (all verified present):

| Region | Marker |
|---|---|
| Header top bar | `id="gl-header-top"` |
| CTA buttons | `id="glht-cta-btns"` |
| Socials + mobile CTAs | `id="glht-socials"` |
| Header bottom | `id="gl-header-bottom"` |
| Logo wrapper | `id="glhb-logo-wrapper"` |
| Nav | `id="glhb-nav"` |
| Footer | `id="gl-footer"` |
| GTM script | `<!-- Google Tag Manager -->` … `<!-- End Google Tag Manager -->` |
| GTM noscript | `<!-- Google Tag Manager (noscript) -->` … `<!-- End … -->` |
| Favicon/manifest | `<link rel="apple-touch-icon"` … `<link rel="manifest" …>` |
| Font preconnects | `<link rel="preconnect" href="https://fonts.googleapis.com">` … |

Scope: all tracked `site/**/*.html` **and** `api/src/blog-templates/{index,post}.html`.
Exclude the three stripped shells, which legitimately differ:
`site/404.html`, `site/admin/index.html`, `api/src/blog-templates/error.html`.

**Critical design constraint.** The guard must compare files **against each other**, not
against a frozen golden copy. Part 2 deliberately changes the chrome in all 39 files (the
header and footer logos are `/couch/uploads/image/header/bac-all_hdlogo*.png`, inside
`#glhb-logo-wrapper` and `#glf-logo-wrapper`). A consistency check still passes after a
correct sweep; a snapshot check would have to be regenerated and would prove nothing.

Why it is worth building: 39 source files sit behind **135 public URLs**, and the two blog
templates are 5 % of the files but **73 % of the URLs** (`post.html` renders 90 posts,
`index.html` renders 8 index pages). A sweep that forgets `api/src/blog-templates/` leaves
98 of 135 pages stale while every page a developer spot-checks looks right. That is the
failure mode this guard exists to catch.

Also in Part 1, two small items:

- **Populate the OG tags.** `og:image` is empty on 38 of 39 static pages and on all 90 blog
  posts — 128 of 135 public URLs have no social preview image. `og:locale`, `og:type`,
  `og:site_name` and `twitter:site` are empty on all 39. The markup already exists and is
  uniform, so this is value population, not a structural change. For posts,
  `featured_image` is the obvious source and is already in scope in `render.js`.
  Constants: `og:locale` = `en_ZA`, `og:site_name` = `BAC Logistics`, `og:type` =
  `website` for pages / `article` for posts.
- **Correct `docs/shared-header-duplication.md`.** It still lists
  `Mobile: +27 83 375 5906` in `privacy-policy.html` as a known inconsistency; that was
  fixed in `571cd6d` and the old number no longer appears anywhere under `site/`.

### Part 2 — remove `/couch/uploads/`

**Recommended approach: rename in place**, `site/couch/uploads/…` → `site/media/…`.

Rejected alternative, and why: moving the images into Blob Storage and serving them via
`/blog/media/<file>` would also strip 104 MB from the deploy artifact, but it needs five
filename collisions resolved, a router change to allow subdirectories, and it puts every
image behind a Function. The investigation established that **app size has no effect on
serving** — static assets never reach the Functions host — so the deploy-size benefit buys
nothing operationally. The naming goal is achieved more simply and with less risk by a
static rename.

Scope, measured 2026-07-27:

- **202 references** across 42 tracked repo files (excluding `docs/`)
- **96 references** in the 90 blog-post JSONs in Blob Storage — **90 in `featured_image`,
  6 inside `json_ld`. Post *bodies* contain none.**
- **157 distinct paths**, **156 files, 104.33 MB** on disk — every one of them referenced
- 5 basenames exist twice with **different content** (`air-freight.jpg`, `aog.jpg`,
  `bonded-warehousing.jpg`, `road-freight.jpg`, `sea-freight.jpg` in both `image/home/`
  and `image/services/`). A directory rename preserves them; do not flatten.

#### The redirect problem — read before designing anything

**Azure SWA wildcard redirects do not preserve the captured path.** Verified directly on
staging during the investigation:

```
GET /redirect-probe/image/blog/foo.png   →   302  Location: /redirect-target/*
```

The `*` is emitted literally. So `{"route": "/couch/uploads/*", "redirect": "/media/*"}`
**will not work** and must not be shipped on the assumption that it does.

The old hosting provider being decommissioned does **not** remove this problem. These
images have always been served by Azure from `site/couch/`; the path is just a string. What
is at stake is that **157 image URLs are indexed by Google Images and may be hotlinked
externally** — they break the moment the directory is renamed, decommission or not.

Use a **single catch-all Function**: route `/couch/uploads/*` to a small handler that reads
`x-ms-original-url` and returns a 301 to the same path under `/media/`. `api/src/functions/documents.js`
is the pattern to copy. Only legacy URLs pay for it; current references go straight to
static. Plan to retire it after ~6 months once Search Console shows the old URLs recrawled.

#### Bundle the cache headers here

Renaming the path is the natural moment to fix the caching the investigation flagged. Every
static asset currently serves `Cache-Control: public, must-revalidate, max-age=30` (the SWA
platform default — there is no `globalHeaders` block). In the same config change, add:

```jsonc
"globalHeaders" or per-route headers:
  /media/*                → public, max-age=31536000, immutable
  /inc/font-awesome/*     → public, max-age=31536000, immutable
  /inc/css/main.css, /inc/js/main.js → public, max-age=300     (drop must-revalidate)
```

**Verify on staging that route `headers` actually override the platform default** before
trusting it — push, `curl -I`, confirm. That is a cheap two-push test.

#### Sequence

1. `git mv site/couch/uploads site/media`; delete the now-empty `site/couch/`.
2. Sweep the 202 repo references. Count first, replace, then prove the diff.
3. Add the redirect Function + route; add the cache headers.
4. **Back up all 90 post JSONs locally before touching Blob** (`az storage blob
   download-batch --account-name bacblogcontent --auth-mode key -s blog -d <dir>
   --pattern "posts/*"`), then rewrite `featured_image` (90) and the `json_ld` strings (6).
5. Deploy to staging; run `scripts/verify-site.mjs`; check a sample of old URLs 301 and new
   URLs 200; confirm the drift guard from Part 1 still passes.
6. PR `develop` → `main`. **The owner merges.**

#### Highest-risk step

Step 4. **Staging and preview environments share production app settings**, so editing post
JSONs from any environment writes to **live production blog data**. There is no staging
copy of the blog. Back up first, verify the backup is complete (90 files), and make the
rewrite idempotent so a partial run can be re-run safely.

Consider whether a **render-time rewrite** in `render.js` (map a leading `/couch/uploads/`
to `/media/` when emitting `featured_image`) is preferable to migrating the stored JSON: it
is a three-line change, needs no write to production data, and is trivially reversible. The
cost is that the stored data keeps the old string, which only partially satisfies the goal.
Raise this trade-off with the owner rather than deciding it unilaterally.

### Verification standards (from `tasks/lessons.md` — these have bitten before)

- `.gitattributes` pins `site/** -text`. Any tool that rewrites line endings shows every
  line of every file as changed. After each bulk edit assert the arithmetic:
  ```bash
  git diff --shortstat          # expect exactly (occurrences per file × files)
  git diff -U0 | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vc 'TOKEN'   # want 0
  ```
- Use a bash heredoc for multi-line commit messages in the Bash tool; a PowerShell
  here-string passed through bash silently produces a malformed subject.
- `/admin/*` is role-gated — an unauthenticated `curl` returns an empty 302, not the file.
  That is not a failed deploy.
- Don't rapid-fire pushes to `develop`. Two deploys 14 s apart raced during the
  investigation and one failed with *"No matching Static Web App environment was found."*
  Let each staging deploy finish.

### Ground rules

- `develop` is the working branch; `main` is protected and **only the owner merges**.
- Ask before anything outward-facing other than pushing branches and opening PRs.
- Never touch MX, SPF, DKIM or autodiscover DNS at domains.co.za.
- Never commit anything under `archive/` or any `*.sql` file.
- There is an **open action** from the investigation: the temporary diagnostic setting
  `swa-http-logs-temp` on the SWA. Leave it until a 502 has been caught, then
  `az monitor diagnostic-settings delete --name swa-http-logs-temp --resource <swa-id>`.
