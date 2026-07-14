# BAC Logistics — Static Website (baclogistics.co.za)

Migration of [baclogistics.co.za](https://baclogistics.co.za) from a Linux/CouchCMS + MySQL
host to **Azure Static Web Apps** as a static rebuild. Plan and progress are tracked on the
[BAC Jira board](https://rourke9001.atlassian.net/browse/BAC-1) (phases P0–P7, BAC-1…BAC-17).

## Layout

| Path       | Purpose |
|------------|---------|
| `site/`    | The static site — deploy artifact for Azure SWA (`app_location`). The mirror of the live site lands here (BAC-6), preserving URL structure (`/about/`, `/services/*.html`, `/blog/`, `/video-hub/`, `/files/`). `staticwebapp.config.json` lives here too (BAC-7). |
| `api/`     | Azure Functions — the contact/service form handler (BAC-8/9): honeypot + rate limiting, sends via Microsoft 365 to `info@baclogistics.co.za`. No Integrately webhooks, no third-party BCCs. |
| `scripts/` | Mirror/crawl and rebuild tooling (BAC-6, BAC-13). |
| `docs/`    | Runbooks: news-publishing how-to (BAC-13), cutover checklist (BAC-16). |
| `archive/` | **Git-ignored, never committed.** Local copy of the old-site backup (CouchCMS source + SQL dump). Contains credentials and form-submission PII. The authoritative backup lives outside this folder. |

## Scope decisions (confirmed 2026-07-14)

- **Static rebuild, not lift-and-shift.** The live site is brochure + blog + video hub + docs; the only server-side feature carried over is the contact form (kept, though enquiries mostly arrive via a separate internal process).
- **E-commerce is dropped.** The old codebase contains an unlaunched cart/checkout/PayFast build; it was never live and is not migrated.
- **Integrately webhooks retired.** The old form handler forwarded to Integrately; the new handler emails via M365 only.
- **Old-provider references removed.** No agency BCCs; `gridlink.css`/`gridlink.js` renamed during post-mirror cleanup.
- **No database on Azure.** The static site needs none. The SQL dump is an offline archive only; a final dump is taken at decommission (BAC-17) and stored privately outside git.
- **DNS/email:** DNS stays at domains.co.za; only the two web records repoint at cutover. Email is on Microsoft 365 and must not be touched. Analytics: GTM-MPPHRHH.

## Site inventory (from live sitemap, 2026-07-14)

~135 URLs: home, about, contact, services index + 13 service pages, blog index + ~95 posts,
video hub + ~16 videos, 2 information pages (incl. privacy policy), 5 downloadable docs in `/files/`.

## Sensitive data — read before committing

Never commit: `archive/` (enforced via `.gitignore`), any `*.sql` dump, the old
`couch/config.php` (plaintext production DB password), or `inc/form/logs|uploads`
(form-submission PII). The mirror in `site/` is public content only.
