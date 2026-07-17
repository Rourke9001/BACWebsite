# BAC-13 — Dynamic blog with Couch-style admin (design)

**Date:** 2026-07-17
**Status:** Approved by Rourke (brainstorming session 2026-07-17)
**Ticket:** BAC-13 (P4.1) — content/news workflow

## Decision summary

The blog leaves the static mirror and becomes **dynamic**, served by the existing
`api/` Azure Functions app, reading content from **Azure Blob Storage**. Publishing
requires **zero redeploys** — matching the old CouchCMS experience where saving a
post makes it live immediately. A custom Couch-style admin UI at `/admin/`, protected
by SWA built-in Entra ID auth, lets non-technical authors (Ideation, via
`developer@baclogistics.co.za`) publish posts through a familiar form.

This supersedes the July draft (markdown-in-git + build-step regeneration + Sveltia).
Pivot driver: Rourke wants no redeploy for content, ever — a burst of 5 posts must
not trigger builds. The rejected alternatives and their reasons:

- **Rebuild-on-publish pipeline** (July draft): every post (or burst) triggers a CI
  build + deploy. Rejected by user: no redeploys for content.
- **Sveltia/Decap git-backed CMS**: requires authors to log in with a GitHub
  account. Rejected by user: wants Couch-style username+password login.
- **Fully custom username/password auth**: we'd own an internet-facing auth system
  (hashing, sessions, lockouts). Rejected: SWA built-in Entra auth gives the same
  experience with zero custom auth code.
- **Hosted CMS (Contentful/Sanity etc.)**: new vendor + cost. Rejected in July
  ("bare bones"), still rejected.

## Architecture

### Public blog (read path)

- `staticwebapp.config.json` routes `/blog/*` to a new HTTP Function in the existing
  `api/` app. Every other page in `site/` stays static, untouched.
- The Function reads post JSON from a blob container, renders HTML through templates
  lifted from the current blog markup (DESIGN.md is the visual reference), and
  preserves **every existing URL**: `/blog/`, `/blog/pg/N/`, `/blog/<slug>/`,
  `/blog/<folder>/<slug>/`, plus any folder-listing pages that exist in the mirror
  (inventory during implementation; replicate only what exists).
- **Caching:** per-instance in-memory cache, TTL ~60s, lazy refresh;
  `Cache-Control: public, max-age=60` for edge/browser reuse. Publish-to-live
  ≤ ~2 min worst case. A burst of posts is picked up in one refresh.
- **Failure behavior:** blob read failure → serve stale cache, retry next request.
  No cache at all (cold start during outage) → branded 503 for blog routes only;
  static site unaffected. Cold start after idle costs a second or two — acceptable.

### Storage

- One Azure Storage account, container `blog`. Posts as JSON blobs
  (`posts/<slug>.json`), images under `uploads/`. **Blob versioning enabled** —
  every save keeps prior versions (Couch-parity rollback for author mistakes).
- Connection string in SWA app settings (same pattern as `GRAPH_*` secrets).
- Cost: cents/month at this traffic.
- Existing ~155 `/couch/uploads/` images already mirrored in `site/` stay where
  they are; migrated posts keep referencing them. New uploads go to blob.

### Post schema (mirrors the Couch admin form)

`title`, `name` (slug, auto from title, editable), `folder` (Road Freight /
Customs Clearing / Mining Transport / Liquor Transport / none), `date`, `author`,
`featured_image` + `alt`, `body` (rich-text HTML), `tags`, `meta_title`,
`meta_description`, `canonical_url`, `robots`, `json_ld`, `youtube_id`,
`unpublished` (soft-delete flag). GTM/canonical/og carry over per page.

### Admin (write path)

- **Auth:** SWA built-in Entra ID. Route rules: `/admin/*` and `/api/admin/*`
  require role `blog_author`, granted via SWA invitation to
  `developer@baclogistics.co.za` (and rourke@ for testing). Zero custom auth code.
  MFA is governed by tenant policy (security defaults → Authenticator app
  registration), not by anything in this design; recommendation is to keep MFA on
  since the account can publish to the public site.
- **Admin UI:** static `/admin/` page, styled per DESIGN.md, replicating the Couch
  form: title, slug, folder dropdown, featured image upload + alt, author,
  rich-text body (self-hosted lightweight editor, no CDN deps), tags, SEO fields,
  optional YouTube ID — plus a post list view (edit / unpublish), covering
  corrections to old posts.
- **Admin API:** Functions endpoints — list/get/save/delete post, upload image.
  Each verifies the `blog_author` role from `x-ms-client-principal` before acting
  (API locked down independently of the page).
- Publish-on-save, no draft/preview workflow in v1 — parity with Couch today.
  Drafts are a possible follow-up ticket if Ideation asks.

## Migration (~95 existing posts)

- One-off Node script (zero-dep style, like `mirror.mjs`): parse each static post
  page in `site/blog/`, extract schema fields (folder from subdirectory), keep the
  **body as its existing HTML** (the editor saves HTML anyway — no
  HTML→markdown→HTML loss; the July "convert to markdown" decision was an artifact
  of the git-based design), write one JSON blob per post.
- **Acceptance gate (red-then-green):** diff each Function-rendered post against
  its original static page (title, body text, meta tags, images) before deleting
  anything from `site/`.

## Sitemap

`sitemap.xml` becomes a sitemap **index** → `sitemap-static.xml` (static, in
`site/`) + `sitemap-blog.xml` (served by the Function, generated live from blob).
robots.txt unchanged.

## Repo invariants (updated in this ticket)

- Delete ~95 post pages + `/blog/pg/*` from `site/` after the diff gate passes.
- `verify-site.mjs`: static pages stay filesystem-enumerated; blog URLs enumerated
  from the live blob-backed index and checked over HTTP.
- README: mirror framing, page counts, blog architecture, local preview
  (`python -m http.server` for static; `swa start` for full blog preview).
- DESIGN.md: note that blog templates live in `api/`.

## Governance

Content never touches the code pipeline: publishing writes to blob, triggers no
build, no commit, no PR. The repo's "changes reach main only via PR" rule is
untouched and applies to all code, including this ticket's own changes.

## Testing

- Extend the existing `api/` node:test suite (zero new deps): rendering from
  fixture posts (post/index/pagination/sitemap), role enforcement (no principal /
  wrong role → 401/403), save/upload validation, cache behavior incl. serve-stale.
- Migration diff gate (above) for old content.
- Post-deploy `verify-site.mjs` run against staging.
- One real E2E publish through `/admin/` as `developer@` before Done (same
  live-proof standard as BAC-9/10).

## Delivery order (each step leaves the site working)

1. Storage account + container + app settings (config only).
2. Public blog Function + migration script; verify rendered-vs-static diff on a PR
   preview while the static blog still serves.
3. Cutover PR: `/blog/*` route → Function, delete static blog pages, sitemap
   split, `verify-site.mjs` + README/DESIGN updates — staging-verified.
4. Admin UI + admin API + Entra role invitation; live E2E publish test.
5. Author guide ("log in at /admin/, fill the form, Save, live in ~a minute",
   with screenshots) + Jira closeout.

Steps 1–3 ship value even if 4 slips (publish via script until the UI lands).
