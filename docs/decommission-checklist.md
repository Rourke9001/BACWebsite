# Old-host decommission checklist

The site, domain, and DNS are live on Azure / in BAC's own domains.co.za account
(since 23 July 2026), but the old CouchCMS/Linux host is still running behind the
scenes. Work through this list, then delete this file.

**Standing guardrail: never edit or delete the MX, SPF (apex TXT), DKIM, or
autodiscover records — email dies.**

## Watch period (~two weeks from 2026-07-23)

- [ ] Pages, blog posts, and downloads serve correctly (spot-check, or run
      `node scripts/verify-site.mjs`)
- [ ] Contact-form submissions arrive at the usual mailbox
- [ ] Blog publishing via `/admin/` works for the authors (invitations are bound
      per-hostname — authors need invites issued against `baclogistics.co.za`)

## After two clean weeks

- [ ] Raise the TTLs on the `www` and apex records back to default (they were
      lowered for cutover)
- [ ] Set an Azure budget alert on the subscription
- [ ] Take a final full backup of the old server (CouchCMS files + a final SQL
      dump). Store it privately **outside this repo** — never commit it
      (contains credentials and form-submission PII).
- [ ] Confirm with the old provider that cancelling hosting does **not** touch
      the domain registration or DNS zone (both stay at domains.co.za)
- [ ] Cancel the old CouchCMS/Linux hosting
- [ ] Diarise the domain renewal — baclogistics.co.za expires **2027-06-05**

## Optional tidy-up

- [ ] Delete the two `_dnsauth` TXT records at domains.co.za (harmless either way)
