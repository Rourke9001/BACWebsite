# docs/

Operational runbooks:

- **blog-author-guide.md** — how to write and publish a news post via `/admin/`.
- **shared-header-duplication.md** — why the header phone/WhatsApp numbers are copied into
  39 files, and the verified recipe for changing one. Read before editing any header value.
- **bactrans-domain-entanglement.md** — `bactrans.co.za` and `baclogistics.co.za` share one
  Microsoft 365 tenant, and `bactrans` is its *primary* domain with DNS delegated to
  Microsoft rather than domains.co.za. Read before touching `bactrans.co.za` DNS or
  standing up its Azure Static Web App.
- **investigation-brief-shared-components.md** — open brief (paste as a prompt): intermittent
  502s on static assets, a full duplication/drift audit, and the `/couch/uploads/` asset path.
