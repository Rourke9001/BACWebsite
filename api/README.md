# api/

Azure Functions (Node.js v4 model) for the site: the contact/service form handler
and the dynamic blog (public rendering + role-guarded admin API).

## POST /api/contact-form

Replaces the old `/inc/form/action.php`. Handles both `contact_form` and
`service_form` submissions and emails them via Microsoft Graph.

Anti-spam (thresholds match the old handler): honeypot (`company_website` must be
empty), min-fill-time gate (3s, needs a live `form_ts`), rate limiting (5 per
IP+form per 5 min), disposable-domain blocklist, link-density cap (5 links in
message), idempotency (duplicate submits within 3 min pretend success).

Response contract (same as the old handler): JSON when the caller sends
`Accept: application/json` or `X-Requested-With: XMLHttpRequest`; otherwise a
303 redirect — success to `/information/thank-you.html?status=ok&rid=…`,
failure to `/?status=error&rid=…`.

## Blog

`/blog/*`, `/sitemap-blog.xml`, and `/documents/*` are rendered on request from
post JSON + media in the `blog` Blob Storage container (~60s cache, serve-stale
on storage failure) — publishing needs no deploy. The admin API at
`/api/blog-admin/*` (CRUD + uploads) backs the `/admin/` UI and re-checks the
`blog_author` role on every request. Page templates are in `src/blog-templates/`.

**The `admin/` route prefix is reserved by the Azure Functions host.** Any HTTP
function routed under `admin/…` errors at startup — invisibly: the deploy
succeeds, requests get empty 404s, and only an Application Insights startup
trace names the cause. That's why the admin API lives at `/api/blog-admin/*`;
never route a function under `/api/admin/…`.

## App settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `stub` | `stub` logs instead of sending; production runs `graph` |
| `CONTACT_RECIPIENT` | `info@baclogistics.co.za` | Where submissions are delivered |
| `CONTACT_FROM` | `donotreply@baclogistics.co.za` | Sender — must be a real tenant mailbox (the Graph app sends *as* it) |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | — | Graph credentials, required when `EMAIL_PROVIDER=graph` |
| `BLOG_STORAGE_CONNECTION` | — | Connection string for the blog Blob Storage account |

Secrets live in SWA application settings / `local.settings.json`, never in git.
See the root README's Operations section for the secret-rollover runbook.

## Structure & tests

`src/functions/*.js` are thin HTTP adapters; the logic lives in `src/lib/` with
no Azure dependencies, so tests run with plain Node:

```
cd api && npm test
```

Notes:

- Rate-limit/idempotency stores are in-memory per Function instance — fine at
  this traffic level.
- `func start` (local Functions host) needs Node 20/22 — Core Tools rejects
  Node 24 (exits immediately).
- Tests exercise `src/lib/` only; the function files themselves are never
  imported by tests, so `require()`-ing each `src/functions/*.js` is a cheap
  smoke for registration-time errors (it won't catch host-side route
  validation, e.g. the reserved `admin/` prefix above).
