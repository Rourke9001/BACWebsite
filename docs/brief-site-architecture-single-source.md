# Brief — site architecture: one place to change a shared value

Hand this to a fresh session. Everything below the line is the brief.

**This brief supersedes Part 1 of `docs/brief-duplication-and-couch-removal.md`.**
That part recommended *keeping* the duplication and adding a CI guard to detect drift. The
owner has since stated a requirement that changes the decision (below). Part 2 of that
brief — removing `/couch/uploads/` — is unaffected and still stands.

---

## Prompt

You are designing an architecture change for **baclogistics.co.za** (static site on Azure
Static Web Apps, `app_location: site`, `api_location: api`, rg `rg-baclogistics-web`,
Standard SKU, West Europe). Read `README.md`, `DESIGN.md`, `CLAUDE.md`,
`tasks/lessons.md`, `docs/shared-header-duplication.md` and
`docs/investigation-findings-2026-07-27.md` first.

**Investigate and produce a recommendation with a costed plan. Do not implement until the
recommendation is reviewed.**

### The requirement

> "If I need to update a phone number, I want to do it in one place."

Take that as a firm requirement, not a preference to be cost-benefited away. Two prior
analyses (`docs/shared-header-duplication.md`, then
`docs/investigation-findings-2026-07-27.md`) both recommended leaving the duplication
alone. **Both were answering a different question** — "is drift likely enough to justify the
risk of changing this?" — and both concluded no, because measured drift is zero. Neither
weighed the owner's own editing experience, which is what is now being asked for. Do not
re-run that cost-benefit; it has been decided.

The broader ask is an architecture review through the lens of single responsibility and
single source of truth. Note that SOLID proper is a set of object-oriented design
principles and maps only loosely onto flat HTML — translate it honestly rather than forcing
it. The parts that do transfer: **one authoritative definition per concept**, **separation
of content from presentation**, and **no change that requires editing N places to stay
correct**. Say so plainly in the report if a principle does not apply.

### What you are starting from (established, do not re-measure)

- **39 chrome-bearing files**: 37 static pages in `site/` plus
  `api/src/blog-templates/{index,post}.html`. Three files are stripped shells with no
  chrome and are correctly excluded: `site/404.html`, `site/admin/index.html`,
  `api/src/blog-templates/error.html`.
- Those 39 source files sit behind **135 public URLs** — `post.html` renders 90 posts,
  `index.html` renders 8 index pages. The blog templates are **5 % of files but 73 % of URLs**.
- **~60 % of every page is shared chrome** (403 of 675 non-blank lines on a typical page);
  204 lines are identical across all 39.
- **Measured drift is zero.** Every shared region is byte-identical across all 39.
- A phone-number change today is a 39-file sweep: `tel:` appears 79 times, `wa.me` 78.
- `site/` is a **flattened static export** — the header was once a single include and was
  baked in when the site was exported. `.gitattributes` pins `site/** -text` for
  byte-exactness.

### Options — evaluate these, recommend one

**Do not re-propose client-side injection.** It was rejected on evidence: it puts the
primary CTAs and phone number behind JavaScript on a site whose value is organic search,
and it flashes the top bar on load. Any option that renders chrome client-side is out.

**Server-side includes are not available.** SWA static hosting has no `<!--#include-->`;
content is either a literal file or it comes from a Function.

That leaves three real candidates:

1. **Include-expander build step (smallest change that meets the requirement).** Keep
   `site/` as authored source, extract the chrome into partials, and expand them at deploy
   time into the flat artifact SWA serves. Roughly a 100-line script plus one CI step.
   Serving stays fully static, so the latency profile measured in the investigation is
   unchanged. Cost: `python -m http.server` is no longer a faithful preview unless the
   expander is run first — quantify how much that hurts and whether a one-command local
   build closes it.

2. **Full static site generator** (Eleventy or similar). More capable, more convention,
   larger dependency surface and a bigger migration. Probably more than this site needs —
   but evaluate rather than assume, and say why if you reject it.

3. **Function-rendered pages** — extend the pattern the blog already uses. `render.js` plus
   two templates already produces 98 server-rendered URLs with no duplication, so the
   codebase demonstrates this works. **Weigh the costs seriously before recommending it:**
   the investigation measured static assets at ~650 ms TTFB from South Africa versus blog
   Function responses at ~1.2 s cold / ~15 ms warm, so cold pages get *slower*; it moves 37
   currently-static pages behind the Functions host; and that host currently reports itself
   unhealthy every 30 s (`azure.functions.webjobs.storage`). Availability of the whole site
   would then depend on it.

A hybrid is legitimate — e.g. expander for `site/`, leaving the blog as it is — if you can
justify it.

### What the recommendation must cover

- Which option, and **why the rejected ones lose** on this site's specifics.
- What the single source of truth becomes for each shared value (phone, WhatsApp, socials,
  GTM ID, nav, footer), and **where someone edits it** to change a phone number.
- How `api/src/blog-templates/` shares that source. Today it is a separate copy — the
  5 %-of-files / 73 %-of-URLs trap. A solution that fixes `site/` and leaves the blog
  templates as a second copy has not solved the problem.
- Local preview story after the change, concretely.
- Migration plan and its diff size, with a rollback.
- CI changes.
- Whether the drift guard from the superseded brief is still worth building. (If chrome
  becomes single-source, a drift guard may be redundant — or may still be worth it for the
  boundary between `site/` and the blog templates. Argue it.)
- Effort estimate and a staged sequence — this does not have to land in one PR.

### Also in scope: a light `api/` review

The site is the pressing part, but the owner asked about architecture generally. `api/`
already separates cleanly — `src/functions/*.js` are thin HTTP adapters, logic lives in
`src/lib/` with no Azure dependencies, which is why tests run under plain Node. Review it
briefly and report only genuine findings; **do not manufacture refactors to fill the
section.** If it is sound, say it is sound. Two things worth a look:

- `src/lib/blog/` mixes storage access, routing, rendering and caching under one namespace —
  is the separation actually clean, or clean-looking?
- Contact-form logic in `src/lib/handler.js` and `src/lib/spam.js` — single responsibility?

### Interaction with the other open work

`docs/brief-duplication-and-couch-removal.md` Part 2 renames `/couch/uploads/` →
`/media/`. **The header and footer logos live at
`/couch/uploads/image/header/bac-all_hdlogo*.png`, inside the shared chrome.** So both
changes rewrite the same markup in all 39 files. Sequence them deliberately and say which
should land first — doing the chrome extraction first means the path rename becomes a
one-file edit instead of a 39-file sweep, which is an argument for ordering it that way.

### Ground rules

- `develop` is the working branch; `main` is protected and **only the owner merges**.
- Pushes to `develop` deploy staging. Don't rapid-fire pushes — two deploys 14 s apart
  raced during the investigation and one failed with *"No matching Static Web App
  environment was found."*
- `site/** -text` means any tool that rewrites line endings shows every line of every file
  as changed. After bulk edits assert `git diff --shortstat` matches
  (occurrences per file × files) before trusting the diff.
- Staging and preview environments share **production** app settings — an `/admin/` publish
  or form submission there touches live data.
- Ask before anything outward-facing other than pushing branches and opening PRs.
- Never touch MX, SPF, DKIM or autodiscover DNS at domains.co.za. Never commit anything
  under `archive/` or any `*.sql` file.
