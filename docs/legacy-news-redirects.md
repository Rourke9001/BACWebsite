# Retired `/news/` URLs

## Why this exists

Three generations of URL have pointed at BAC Logistics articles:

| Era | Shape | Status |
| --- | --- | --- |
| pre-2021 (static + Couch) | `/news/<slug>.html` | retired — handled here |
| 2021–2026 (Couch) | `/blog/<slug>.html` | still the public shape |
| 2026– (Azure Functions) | `/blog/<slug>.html`, `/blog/<folder>/<slug>.html` | current |

The August 2026 digital-estate audit reported the whole legacy site as live and
indexed. That was wrong: `/about.html`, `/logistics.html`, `/air-freight.html` and
the rest already 301 correctly via `site/staticwebapp.config.json`. The one real
gap was `/news/`, where only a single article had a redirect and everything else
returned 404 to traffic Google is still sending.

## How it works

`site/staticwebapp.config.json` rewrites both `/news` and `/news/*` to `/api/blog`.
The blog Function reads the original path from `x-ms-original-url`, and
`api/src/lib/blog/router.js` classifies it as `{ kind: 'legacy' }`.
`api/src/lib/blog/handler.js` then resolves it and returns a 301.

Resolution rules, all covered by `api/test/blog-handler.test.js`:

- **Slug match, not path match.** Posts were reorganised into folders after these
  URLs were minted, so `/news/foo.html` finds `foo` wherever it now lives and
  redirects to its current canonical path.
- **Underscores normalise to hyphens.** The retired host's `.htaccess` carried
  per-article `choose_the_right_...` → `choose-the-right-...` rewrites. That host
  is gone, so the normalisation lives in the router instead.
- **Never 301 into a 404.** An unknown slug, an unpublished post, or an
  unrecognised folder redirects to `/blog/` rather than to a page that does not
  exist.
- **Degrades rather than fails.** If Blob Storage is unavailable the redirect
  still returns 301 to `/blog/`; a 503 on a years-old inbound link is worse than
  landing the reader on the blog index.

## Why not enumerate the slugs in the config

Azure Static Web Apps caps `staticwebapp.config.json` at 20 KB, asserted by
`api/test/staticwebapp-config.test.js`. Roughly 90 per-article redirects would not
fit alongside the 100+ media redirects already there. Two wildcard routes cost
about 120 bytes and stay correct as posts are renamed, added or retired — the
mapping is derived from live post data rather than frozen at deploy time.

Removing the old per-article `/news/bac-logistics-south-africa-...` redirect as
part of this change made the config *smaller*: 17,507 bytes, down from 18,175.

## Verifying after a deploy

    curl -sI https://baclogistics.co.za/news/choose-road-freight-provider.html
    # expect: 301 -> /blog/choose-road-freight-provider.html

    curl -sI https://baclogistics.co.za/news/deleted-long-ago.html
    # expect: 301 -> /blog/

Both need the Functions host, so they cannot be checked against
`python -m http.server`; use staging or a PR preview.
