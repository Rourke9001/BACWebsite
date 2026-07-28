# `bactrans.co.za` — how it is entangled with `baclogistics.co.za`

Written 2026-07-28, ahead of building a `bactrans.co.za` website on Azure Static Web Apps.
Everything here was measured from live DNS, the domains.co.za panel and `az`, not recalled.

**Read this before touching `bactrans.co.za` DNS.** The two domains share a Microsoft 365
tenant, and `bactrans.co.za` is the *primary* domain of that tenant — the more load-bearing
of the two, despite having no website.

---

## Current state of `bactrans.co.za`

**There is no website.** `http://bactrans.co.za/` returns `200` from `Apache/2` with the
title *"Domain registered on behalf of our client by domains.co.za"* — a registrar parking
page. **HTTPS does not respond at all** (no certificate). So there is nothing to preserve
and no redirect obligation: a green field.

| Record | Value |
|---|---|
| `A` (apex) | `169.239.219.58` — the parking page |
| `www` | `CNAME` → `bactrans.co.za` |
| `MX` | `bactrans-co-za.mail.protection.outlook.com` |
| `TXT` | `v=spf1 include:spf.protection.outlook.com -all` |
| `TXT` | `MS=ms39759652` |
| `TXT` | `mscid=Dy5xptPAbCcEFb96oHKZkbNA12s6mKcDZZ7bKacxBOtO3fBF8vAvfdWJa92ntzs5vHhTUzY7+s81uX9DqKppsg==` |
| `NS` | `ns1–ns4.bdm.microsoftonline.com` |

## The entanglement, precisely

### 1. Same Microsoft 365 tenant

Both domains carry the **identical** verification token:

```
baclogistics.co.za : MS=ms39759652
bactrans.co.za     : MS=ms39759652     <- same value
```

Identical `MS=` tokens mean both domains are verified into **one** Microsoft 365 tenant.
`bactrans.co.za` is the tenant's primary domain; `baclogistics.co.za` is an added domain.
Both also carry the same SPF record.

### 2. `baclogistics.co.za` mail is delivered via a `bactrans`-named endpoint

`baclogistics.co.za`'s `MX` points at **`bactrans-co-za.mail.protection.outlook.com`**.

**This looks worse than it is, and the distinction matters.** That hostname lives in
Microsoft's own `outlook.com` zone — it resolves to `52.101.68.8` / `52.101.68.15` and is
served by Microsoft's nameservers. It is **not** a record inside `bactrans.co.za`'s DNS.

> **Editing `bactrans.co.za`'s DNS records does not break `baclogistics.co.za` email.**
> The shared dependency is on the *tenant*, not on the *zone*.

What *would* affect it: removing `bactrans.co.za` from the M365 tenant, or changing the
tenant's primary-domain configuration.

### 3. `bactrans.co.za` DNS is delegated to Microsoft, not domains.co.za

This is the practical obstacle. The domain is **registered** at domains.co.za (same account
as `baclogistics.co.za`, both Active, Domain Protection on), but its nameservers are
`ns1–ns4.bdm.microsoftonline.com`.

So **its DNS records are not editable in the domains.co.za panel** where `baclogistics.co.za`
is managed. They live in the Microsoft 365 admin centre, under the domain's DNS management.

`baclogistics.co.za`, by contrast, is delegated to domains.co.za's Anycast
(`ns1–ns4.anycast-ns.com/.net`) and is fully editable in the panel.

---

## What next session has to decide

Azure SWA custom-domain validation needs DNS records on `bactrans.co.za`. Two routes:

### Option A — keep NS at Microsoft, add records in the M365 admin centre

- **Lower risk.** Nothing about the tenant's delegation changes; mail is untouched.
- Microsoft's DNS management does allow custom records, but is more restrictive than a
  normal panel — confirm it will accept the record types SWA needs before committing.

### Option B — move NS delegation to domains.co.za's Anycast

- **Higher risk, and it is the one to be careful about.** Moving delegation means
  **every existing record must be recreated by hand** in the new zone: `MX`, both SPF and
  `MS=` TXT records, `mscid`, and anything else present at the time.
- A single missed record breaks mail **for the M365 tenant's primary domain**.
- Upside: both domains then managed in one place, consistent with `baclogistics.co.za`.

**Recommendation: start with Option A.** Only fall back to B if Microsoft's DNS management
refuses a record SWA requires — and if so, snapshot the full zone first (`Resolve-DnsName`
for every type) and recreate it verbatim before repointing NS.

## Template — how `baclogistics.co.za` is wired

Copy this shape rather than inventing one.

| | |
|---|---|
| SWA resource | `baclogistics`, rg `rg-baclogistics-web` |
| SKU / region | Standard, West Europe |
| Default hostname | `ambitious-bush-084cda303.7.azurestaticapps.net` |
| Custom domains | `baclogistics.co.za` (Ready), `www.baclogistics.co.za` (Ready) |
| Repo / branch | `Rourke9001/BACWebsite`, `main` |

DNS that makes it work:

```
baclogistics.co.za        600  A      9.163.40.246
www.baclogistics.co.za    600  CNAME  ambitious-bush-084cda303.7.azurestaticapps.net
```

Apex uses an `A` record; the subdomain uses a `CNAME`. Azure SWA validates an apex domain
by TXT challenge, then serves it over the `A` record; subdomains validate via the `CNAME`
itself.

> `bactrans.co.za` will need its **own** Azure SWA resource — a SWA maps to one repo and
> branch, and this repo is `baclogistics`. Decide separately whether the new site lives in
> this repo or its own. Cost note: a second **Standard** SWA is a real monthly line item;
> **Free** tier may suffice for a brochure site but has no SLA, no custom auth and fewer
> custom domains. Confirm the tier with the owner before creating anything.

---

## Never touch

On **either** domain, these are email and tenant infrastructure:

- `MX`
- `TXT` starting `v=spf1`
- `TXT` starting `MS=` (M365 domain verification)
- `TXT` starting `mscid=` (tenant binding)
- `CNAME` `autodiscover` (present on `baclogistics.co.za` → `autodiscover.outlook.com`)
- `CNAME` `k2._domainkey` / `k3._domainkey` (DKIM → `dkim2/3.mcsv.net`)

Adding a new record alongside them is safe — the domains.co.za panel's *Add DNS Record*
form is separate from the record list, so additions cannot overwrite existing entries.
Verified in practice on 2026-07-28 when the Search Console TXT was added:
`baclogistics.co.za` went from 2 root TXT records to 3 with SPF and `MS=` byte-unchanged.

**Always verify against the authoritative nameservers, not the panel.** That same change
showed "DNS Records Updated Successfully" in the UI a full minute before the record was
actually being served by any of the four Anycast nodes.

```powershell
Resolve-DnsName baclogistics.co.za -Type TXT -Server ns1.anycast-ns.com
```

## Loose ends worth resolving while in here

- **`baclogistics.co.za` apex is an `A` record to `9.163.40.246`.** It works, but a static
  IP for an apex is fragile if Azure ever changes it. Already logged as a Stage 7 item;
  worth confirming it is a current, documented Azure SWA inbound address.
- **`www.bactrans.co.za` is a `CNAME` to the apex**, which currently means the parking page.
  It will need repointing as part of the SWA work.
