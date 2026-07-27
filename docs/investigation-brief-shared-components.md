# Investigation brief — intermittent 502s, shared components, and the legacy asset path

Hand this to a fresh session. It is written to be pasted as a prompt; everything below the
line is the brief itself. Findings gathered 2026-07-27 are included so the investigation
starts from evidence rather than from scratch.

---

## Prompt

You are investigating three related problems on **baclogistics.co.za** — a static site on Azure
Static Web Apps (`app_location: site`, `api_location: api`, resource group
`rg-baclogistics-web`, Standard SKU, West Europe). Read `README.md`, `DESIGN.md` and
`CLAUDE.md` first. **Investigate and report — do not change production behaviour until the
findings are reviewed.** Produce a written report with a recommendation and a costed plan
per workstream; open a PR only for changes explicitly approved after that report.

### Workstream 1 — intermittent 502 Bad Gateway on static assets (highest priority)

A user hit `502 Bad Gateway` on `GET https://baclogistics.co.za/inc/css/main.css`
(remote address `9.163.40.246:443`, the SWA `stableInboundIP`). This is the site's only
stylesheet — when it 502s the page renders unstyled, so this is a visible production defect.

**Evidence already gathered (2026-07-27):**

- The 502 did **not** reproduce across 12 sequential requests — all returned `200` with a
  correct 38,944-byte body. It is intermittent, not a hard failure.
- Latency is wildly bimodal on that same asset. Ten of twelve requests were ~0.7–1.6 s;
  three were **13.4 s, 10.1 s and 20.1 s**. A 20-second stall on a 38 KB static file is the
  strongest lead here — a 502 is the expected outcome when such a stall exceeds the edge's
  origin timeout.
- Response headers show `Cache-Control: public, must-revalidate, max-age=30`. Thirty
  seconds, with `must-revalidate`, on an immutable stylesheet. Every visitor re-validates
  constantly, so origin hit rate is far higher than it needs to be.
- `site/` is **111 MB**, of which `site/couch/` is **105 MB (94%)** across 156 files.

**Lines of enquiry, in the order I would take them:**

1. Confirm and characterise the stall. Hammer `/inc/css/main.css` and a few other static
   assets over a sustained period, recording status and `time_total`. Establish whether
   502s correlate with the latency spikes, whether they cluster by time of day, and whether
   they affect the apex, `www`, and the `*.azurestaticapps.net` hostname equally.
2. Check Application Insights (`bac-swa-debug`) for the corresponding window. Note the
   known trap recorded in `api/README.md`: Functions host problems can be invisible in
   deploy logs and visible only in App Insights.
3. Determine whether the Functions host is implicated at all. `/inc/css/*` should be served
   as pure static content with no route in `staticwebapp.config.json` matching it — verify
   that is actually true in the deployed config, and that the `404` `responseOverrides`
   rewrite is not dragging static misses through the Function.
4. Test the app-size hypothesis. 111 MB is large for SWA, and the 105 MB of legacy images
   in `site/couch/` is deployed on every push even though it never changes. Establish
   whether app size affects cold-start or content-distribution latency on Standard SKU, and
   whether moving those images to Blob Storage (they are already served from Blob for the
   blog) would materially help. Note the interaction with Workstream 3.
5. Evaluate cache headers as mitigation. Fingerprinted or versioned assets could carry a
   long `max-age` via `globalHeaders` or route headers in `staticwebapp.config.json`, which
   cuts origin revalidation dramatically. Be careful: `main.css` is referenced by a bare
   path from all 39 pages, so a long TTL without a cache-busting strategy makes future CSS
   changes slow to propagate. Propose the versioning approach alongside the TTL.

Deliverable: root cause if you can establish one, or the top two hypotheses ranked with the
evidence for each; plus the smallest change that measurably reduces 502 frequency.

### Workstream 2 — shared components and duplication

`site/` is a static export with no build step, so markup that was once a single include is
now copied into every page. `docs/shared-header-duplication.md` documents the case we
already know about: the contact strip in the top bar, 78 references across 39 files, 2 per
page because it renders separately for desktop (`#glht-cta-btns`) and mobile
(`#glht-socials`).

**Find the rest.** Audit all 39 pages in `site/` plus `api/src/blog-templates/{index,post}.html`
and report every block duplicated across most or all pages — at minimum the header, nav,
footer, social links, Google Tag Manager snippet, favicon/manifest block, font preconnects,
and the meta/OG scaffolding. For each, give: occurrences, files, whether copies have
**drifted** out of sync, and the blast radius of changing it.

Drift is the finding that matters most. Duplication is merely tedious; duplication where
copies disagree is a correctness bug. Two known examples to calibrate against: `tel:0119747472`
appears 79 times, not 78 like the WhatsApp link, because `site/contact/index.html:582` has a
third instance in body content that a header-tuned sweep would miss; and the two blog
templates are a separate copy that silently diverges from `site/` unless edited in the same
commit.

Then evaluate options for consolidation, and **be honest about whether it is worth it**. The
prior analysis in `docs/shared-header-duplication.md` recommended leaving it alone — a build
step ends the "plain files, no build" property that makes local preview and byte-exactness
trivial, for a problem that costs about one sweep a year. Argue for or against that
conclusion on the evidence you find; if drift is widespread, the calculus changes. Client-side
injection of the header was already rejected — it puts the primary CTAs and phone number
behind JavaScript on a site whose value is organic search — so do not re-propose it without
addressing that objection.

Constraint: `.gitattributes` pins `site/** -text` to keep content byte-exact. Any tool that
rewrites line endings will show every line of every file as changed. After a bulk edit,
assert `git diff --shortstat` matches (occurrences per file × files) before trusting the diff.

### Workstream 3 — the `/couch/uploads/…` asset path

The site's images are served from `/couch/uploads/…`, a path inherited from the previous
CMS. The owner wants no lingering references to the old system. The prose references have
been removed and the `<!-- Page generated by CouchCMS -->` comment has been stripped from
all 39 pages; **this path is what remains**, and it is not a find-and-replace.

Scope, measured 2026-07-27:

- **203 references** across 43 tracked files
- **105 MB / 156 files** on disk under `site/couch/`
- The path is also baked into the **~99 blog posts stored in Blob Storage** (container
  `blog`, account `bacblogcontent`) as `featured_image` and inline `<img>` values — see
  `api/test/blog-render.test.js:9`. Renaming requires migrating that stored JSON, not just
  the repo.
- Existing image URLs are indexed by Google Images and may be hotlinked externally.

Report on: the full reference inventory (repo + Blob Storage), a proposed target path, the
redirect strategy needed so existing URLs keep resolving, the data migration for the stored
posts, a rollback plan, and an honest verdict on whether the benefit justifies the risk.

Consider as a serious alternative: moving these images to Blob Storage entirely rather than
renaming them in place. That addresses the naming *and* removes 94% of the deploy artifact,
which may also serve Workstream 1. Cost it out.

### Ground rules

- `develop` is the working branch; `main` is protected and only the owner merges. Pushes to
  `develop` deploy staging; merging to `main` publishes to production.
- Staging and preview environments **share production app settings**. Publishing or deleting
  through `/admin/` on staging touches live blog data. Loading `/admin/` to look is fine.
- `/admin/*` is role-gated (`allowedRoles: [blog_author]`), so an unauthenticated `curl` of
  an admin asset returns an **empty 302**, not the file. That is not evidence of a failed
  deploy — verify admin assets through an authenticated browser session.
- Never touch the MX, SPF, DKIM or autodiscover DNS records at domains.co.za.
- Never commit anything under `archive/` or any `*.sql` file.
- Prove claims before making them. Measure, don't assume — the last CSS defect on this site
  looked like a JavaScript bug and was a cascade bug, and it was settled by reading computed
  styles in a browser rather than by reasoning about the code.
