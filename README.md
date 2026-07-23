# BAC Logistics — Static Website (baclogistics.co.za)

Static rebuild of [baclogistics.co.za](https://baclogistics.co.za), migrated from a
Linux/CouchCMS + MySQL host to **Azure Static Web Apps** (app `baclogistics`, resource
group `rg-baclogistics-web`). Live on the custom domain since 23 July 2026.

## Layout

| Path       | Purpose |
|------------|---------|
| `site/`    | The static site — deploy artifact for Azure SWA (`app_location`), preserving the old URL structure (`/about/`, `/services/*.html`, `/video-hub/`, `/files/`). `/blog/*` does not live here — those routes are rewritten to the Function and served from Blob Storage. `staticwebapp.config.json` lives here too. |
| `api/`     | Azure Functions (`api_location`): the contact/service form handler (honeypot + rate limiting, sends via Microsoft 365) and the dynamic blog — public rendering of `/blog/*` from the `blog` Blob Storage container plus the role-guarded admin API (`/api/blog-admin/*`) behind the `/admin/` UI. |
| `scripts/` | `verify-site.mjs` — crawls a deployed environment and checks every page, link, redirect, and download. |
| `docs/`    | Runbooks: blog author guide, old-host decommission checklist. |
| `archive/` | **Git-ignored, never committed.** Local copy of the old-site backup (CouchCMS source + SQL dump). Contains credentials and form-submission PII. The authoritative backup lives outside this folder. |

## What's on the site

38 static pages in `site/` (home, about, contact, services index + 13 service pages,
video hub + ~16 videos, 2 information pages incl. privacy policy, 5 downloadable docs
in `/files/`) plus ~99 blog posts served dynamically from Blob Storage
(storage account `bacblogcontent`, container `blog`).

## Scope decisions (confirmed 2026-07-14)

- **Static rebuild, not lift-and-shift.** The only server-side features are the contact
  form and the dynamic blog.
- **E-commerce is dropped.** The old codebase contains an unlaunched cart/checkout/PayFast
  build; it was never live and is not migrated.
- **Integrately webhooks retired.** The new form handler emails via Microsoft 365 only —
  no third-party forwarding or agency BCCs.
- **No database on Azure.** The SQL dump is an offline archive only.
- **DNS/email:** the domain and DNS zone live at domains.co.za in BAC's own account.
  Email is on Microsoft 365 and its records must never be touched (see Operations).

## Local preview

`site/` is plain files, no build step — but `/blog/*` is dynamic, so which server you
run depends on what you need to check:

```powershell
# Static pages only (no /blog/* — those routes 404 without the Function):
cd site
python -m http.server 8080     # then open http://localhost:8080

# Full site including the dynamic blog:
swa start site --api-location api
```

Don't open the HTML files directly from disk (`file://`) — links are root-relative
(`/about/`, `/inc/css/...`) and only resolve through a web server.

## Branching & deploys

- **`develop`** is the working branch (GitHub default) — commit day-to-day work here.
  Every push to `develop` deploys the **staging environment**:
  <https://ambitious-bush-084cda303-staging.7.azurestaticapps.net>
- **`main`** is protected: no direct pushes; changes arrive by PR from `develop`.
  Every push to `main` deploys **production** ([baclogistics.co.za](https://baclogistics.co.za);
  the bare `ambitious-bush-084cda303.7.azurestaticapps.net` hostname also serves
  production) — so **merging a PR is publishing**. The site updates ~1–2 minutes
  after merge. PRs to `main` get per-PR preview environments.
- Staging and preview environments share production app settings (blob storage,
  email) — an `/admin/` publish or form submission there touches production data.

## Publishing a blog post

The blog is dynamic: Azure Functions render `/blog`, `/blog/*`, and `/sitemap-blog.xml`
on request from post JSON + images in the `blog` Blob Storage container — there's no
HTML in `site/` to edit and no deploy in the loop. Publishing happens through the
`/admin/` Couch-style admin (Entra ID login, `blog_author` role via SWA invitation):
write the post, save, it's live within a minute or two — see
**[docs/blog-author-guide.md](docs/blog-author-guide.md)** for the author walkthrough.
The admin API lives at `/api/blog-admin/*` (the `admin/` route prefix is reserved by
the Functions host — see `api/README.md`).

Authors are invited per hostname: Azure Portal → the Static Web App → *Role management*
→ Invite (provider Entra ID, role `blog_author`, domain `baclogistics.co.za`), or:

```powershell
az staticwebapp users invite -n baclogistics -g rg-baclogistics-web `
  --authentication-provider aad --user-details <email> --role blog_author `
  --domain baclogistics.co.za --invitation-expiration-in-hours 168
```

Invitees don't need to be in the BAC tenant — any Microsoft account matching the
invited email works.

## Operations

### Domain & DNS (domains.co.za, BAC's account)

| Record | Value | Notes |
|---|---|---|
| apex `A` | `9.163.40.246` | The Static Web App's `stableInboundIP` |
| `www` `CNAME` | `ambitious-bush-084cda303.7.azurestaticapps.net` | The SWA default hostname |
| `_dnsauth` `TXT` | (validation token) | Azure custom-domain validation; harmless to keep |
| `MX`, `TXT` (SPF/`MS=`), `autodiscover` `CNAME` | Microsoft 365 | **Never edit or delete — email dies.** |

Nameservers stay on domains.co.za (`ns1-4.dns-ns.host/.zone`). Lesson from the 2026-07
account transfer: registrar processes can silently rebuild the zone — export the zone
before any registrar-side change, and re-verify these records after.

### Contact form

`POST /api/contact-form` sends mail via Microsoft Graph using an Entra app registration
(client ID `1d7da6a8-6ea2-4a27-8dcd-cbf59f13df75`). Configured entirely through SWA
application settings — no redeploy needed to change them:

| Setting | Value |
|---|---|
| `EMAIL_PROVIDER` | `graph` |
| `CONTACT_FROM` | `donotreply@baclogistics.co.za` |
| `CONTACT_RECIPIENT` | `info@baclogistics.co.za` (single address; use a shared mailbox/distribution list for multiple readers) |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | Graph credentials |

```powershell
# Change the recipient (takes effect within minutes):
az staticwebapp appsettings set -n baclogistics -g rg-baclogistics-web `
  --setting-names CONTACT_RECIPIENT=someone@baclogistics.co.za
```

### Graph client secret rollover — due before 2027-07-14

The app registration's client secret (`swa-contact-form`) **expires 2027-07-14**.
When it lapses, the contact form silently stops sending. Rotate before then:

```powershell
# 1. Issue a new secret (prints the new value once — copy it):
az ad app credential reset --id 1d7da6a8-6ea2-4a27-8dcd-cbf59f13df75 `
  --display-name swa-contact-form --years 2

# 2. Put it live:
az staticwebapp appsettings set -n baclogistics -g rg-baclogistics-web `
  --setting-names 'GRAPH_CLIENT_SECRET=<new value>'

# 3. Update the master copy in Key Vault:
az keyvault secret set --vault-name kv-baclogistics -n graph-client-secret --value '<new value>'
```

Then submit the contact form once and confirm it arrives.

### Secrets

Live secrets (blob storage connection string, Graph client secret) reside in the SWA
**application settings** — encrypted at rest, RBAC-protected. The Key Vault
`kv-baclogistics` holds master copies for record/rotation only: **Key Vault references
(`@Microsoft.KeyVault(...)`) do not work on Static Web Apps with managed functions**
(verified 2026-07-23 — settings fail to resolve and the API 500s), so don't wire them up.

## Sensitive data — read before committing

Never commit: `archive/` (enforced via `.gitignore`), any `*.sql` dump, the old
`couch/config.php` (plaintext production DB password), or `inc/form/logs|uploads`
(form-submission PII). `site/` is public content only.
