# ARCHITECTURE.md

Practical map of this repo. For the deploy/DNS/secrets story see `README.md`; for visual
tokens and component patterns see `DESIGN.md`. This file is about *where things go*.

## Top-level folders

| Folder | What it's for |
|---|---|
| `site/` | The deployed static site (Azure SWA `app_location`) — every public page, its CSS/JS, and `/media/` images. |
| `api/` | Azure Functions (`api_location`) — contact form handler and the dynamic blog (public render + `/admin/`-facing admin API). |
| `partials/` | Shared chrome (header, footer, `<head>` blocks, GTM) expanded into pages by `scripts/build-chrome.mjs`. Edit here, not in pages. |
| `data/` | `site.json` — the values (phone, WhatsApp, socials, GTM id) that fill `${name}` tokens in `partials/`. Edit here, not in partials. |
| `scripts/` | Build/verify/maintenance tooling: chrome expansion, site crawl verification, blog backup, one-off image migration scripts. |
| `docs/` | Operational runbooks and dated investigation briefs. |
| `tasks/` | `todo.md` (current plan) and `lessons.md` (patterns learned from past corrections). |
| `backups/` | Git-ignored. Local output of `scripts/backup-blog.mjs` — a copy of production blob data. |
| `archive/` | Git-ignored. Old-site backup with credentials/PII. Never committed. |
| `.github/` | CI workflows. |

## Where new things go

**A new static page** → `site/<section>/<page-name>.html`, kebab-case, e.g.
`site/services/warehousing-audits.html`. A section landing page is `index.html` inside its
own folder (`site/about/index.html` → `/about/`), matching how the URL path works — don't
put a landing page's content directly in a flat file at the parent level.

**A new service/video-hub/information page** → drop the `.html` file straight into
`site/services/`, `site/video-hub/`, or `site/information/` (flat, no per-page subfolder) —
e.g. `site/services/bonded-storage-audits.html`. Copy the chrome markers
(`<!-- @chrome:name -->` … `<!-- @end:name -->`) from a sibling page rather than
hand-writing the header/footer, then run `npm run build:chrome`.

**A new blog page template** (rare — the blog has exactly two: list and post) →
`api/src/blog-templates/`, rendered server-side by `render.js`. These are also
chrome targets (see `scripts/build-chrome.mjs --list`).

**A reusable content block / component** → there's no component file format here. Reuse an
existing CSS pattern in `site/inc/css/main.css` (cards, `.gl-image-and-text`, `.gl-cta`,
etc. — see `DESIGN.md` § Component patterns) and copy the markup directly into the page.
Only add new CSS to `main.css` if nothing existing fits.

**Shared chrome** (header, footer, nav, `<head>` includes) → edit the matching file in
`partials/` (e.g. `partials/header-bottom.html`), then `npm run build:chrome` to expand it
into all 39 chrome-bearing files. Never hand-edit the generated region in a page.

**A site-wide value** (phone, WhatsApp number, a social link, GTM id) → `data/site.json`,
then `npm run build:chrome`. Never hardcode it in a partial or a page.

**A new image** → `site/media/<section>/<name>.<ext>`, mirroring the page section it
belongs to (`site/media/services/`, `site/media/about/`, …). Use kebab-case. Files over
500 KB get re-encoded to `.webp` by `scripts/reencode-images.py` — don't hand-convert.

**Stylesheet/script changes** → there is exactly one of each: `site/inc/css/main.css` and
`site/inc/js/main.js`. No per-page or per-component CSS/JS files exist; add to these
directly rather than creating a new file.

**A new Azure Function (route)** → `api/src/functions/<name>.js` (the HTTP-triggered
entry point) with its logic in `api/src/lib/` — blog-specific logic goes in
`api/src/lib/blog/<concern>.js` (e.g. `auth.js`, `store.js`, `render.js`), one file per
concern, singular lowercase name, no hyphens. Add a matching test in `api/test/`.

## Naming conventions in use

- **Pages and URL folders**: kebab-case, lowercase (`bonded-warehousing-services.html`,
  `cross-border-local-transport.html`).
- **Section landing pages**: `index.html` inside a folder named for the URL segment
  (`about/`, `contact/`, `services/`, `video-hub/`).
- **Partials**: kebab-case, named for what they render (`header-top.html`,
  `contact-phone-link.html`).
- **`api/src/functions/`**: kebab-case, one file per route (`contact-form.js`,
  `admin-blog.js`).
- **`api/src/lib/blog/`**: single lowercase word per concern, no hyphens (`auth.js`,
  `cache.js`, `handler.js`).
- **Root-relative paths only** for internal links/assets (`/about/`, `/inc/css/main.css`) —
  never hand-write an absolute internal URL (see `DESIGN.md`).
- **Generated files are committed on purpose** (chrome-expanded pages, `site/media/`) —
  don't add a `.gitignore` entry for something under `site/` without checking `README.md`
  first.

## Inconsistent — pick one

- **Image filename case**: most of `site/media/` is kebab-case
  (`cross-border-local-transport.webp`), but a few files use snake_case
  (`about_us.webp`, `video_hub.webp`). Not flagged as broken anywhere, but new images
  should probably follow whichever you pick — recommend kebab-case since it's the
  majority and matches the page-naming convention.
- **Downloadable docs in `site/files/`** use human-readable names with spaces and mixed
  case (`Blank Export Clearing Instructions.xlsx`), unlike every other path in the repo
  which is lowercase/kebab-case. This may be deliberate (matching the document's real
  title for a user-facing download), but it's the one place the naming convention breaks —
  worth deciding explicitly if you add another downloadable doc.
- **Two pages skip the shared chrome entirely**: `site/404.html` and `site/admin/index.html`
  don't carry `@chrome:` markers and aren't touched by `npm run build:chrome`. That may be
  intentional (both are special-cased pages outside normal nav), but it means "every page
  uses the shared header/footer" isn't quite true — confirm before assuming a new page can
  skip the chrome too.
