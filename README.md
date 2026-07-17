# BAC Logistics — Static Website (baclogistics.co.za)

Migration of [baclogistics.co.za](https://baclogistics.co.za) from a Linux/CouchCMS + MySQL
host to **Azure Static Web Apps** as a static rebuild. Plan and progress are tracked on the
[BAC Jira board](https://rourke9001.atlassian.net/browse/BAC-1) (phases P0–P7, BAC-1…BAC-17).

## Layout

| Path       | Purpose |
|------------|---------|
| `site/`    | The static site — deploy artifact for Azure SWA (`app_location`). The mirror of the live site lands here (BAC-6), preserving URL structure (`/about/`, `/services/*.html`, `/video-hub/`, `/files/`). `/blog/*` no longer lives here (BAC-13) — it's rewritten to the Function and served from Blob Storage. `staticwebapp.config.json` lives here too (BAC-7). |
| `api/`     | Azure Functions (`api_location`): the contact/service form handler (BAC-8/9, honeypot + rate limiting, sends via Microsoft 365 to `info@baclogistics.co.za`, no Integrately webhooks/third-party BCCs) and the dynamic blog (BAC-13): public rendering of `/blog/*` from the `blog` Blob Storage container plus the role-guarded admin API (`/api/blog-admin/*`) behind the `/admin/` UI. |
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

## Site inventory (post-cutover, BAC-13)

38 static pages in `site/` (home, about, contact, services index + 13 service pages,
video hub + ~16 videos, 2 information pages incl. privacy policy, 5 downloadable docs
in `/files/`) plus ~99 blog posts served dynamically from Blob Storage via the Function.

## Local preview

`site/` itself is plain files, no build step — but `/blog/*` is now dynamic (BAC-13),
so which server you run depends on what you need to check:

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
- **`main`** is protected: no direct pushes; changes arrive by PR from `develop`.
- Once the Azure Static Web App is connected (BAC-11), its GitHub Actions workflow
  deploys on every push to `main` — so **merging a PR is publishing**. Nothing else
  to do; the site updates ~1–2 minutes after merge.

## Publishing a blog post

The blog is dynamic (BAC-13): Azure Functions render `/blog`, `/blog/*`, and
`/sitemap-blog.xml` on request from post JSON + images stored in the `blog` Blob
Storage container — there's no HTML in `site/` to edit and no deploy in the loop.
Publishing happens through the `/admin/` Couch-style admin (Entra ID login,
`blog_author` role via SWA invitation): write the post, save, it's live within a
minute or two — see **[docs/blog-author-guide.md](docs/blog-author-guide.md)** for
the author walkthrough. The admin API lives at `/api/blog-admin/*` (the `admin/`
route prefix is reserved by the Functions host — see `tasks/lessons.md`). Post
pages, the listing, and pagination are all generated from the same blob data, so
nothing can drift out of sync the way the old copy-an-HTML-file flow could.

## Sensitive data — read before committing

Never commit: `archive/` (enforced via `.gitignore`), any `*.sql` dump, the old
`couch/config.php` (plaintext production DB password), or `inc/form/logs|uploads`
(form-submission PII). The mirror in `site/` is public content only.
