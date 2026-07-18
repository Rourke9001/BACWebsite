# baclogistics.co.za — Domain Transfer & Cutover Gameplan

**Prepared 2026-07-18.** Self-contained: everything needed to take the domain from
Ideation's control to BAC's, and to point it at the new Azure site, without
referring back to any chat or session.

---

## Where things stand today

| Fact | Detail |
|---|---|
| New site | Live and fully verified on `https://ambitious-bush-084cda303.7.azurestaticapps.net` (Azure Static Web App **baclogistics**, resource group **rg-baclogistics-web**, subscription "Microsoft Partner Network") |
| Domain registrant | **Ideation** (per official ZARC WHOIS) — the agency legally holds the domain |
| Registrar | domains.co.za (Registrar "Domains", IANA 1645); domain unlocked, expires **2027-06-05** |
| DNS zone | Hosted on domains.co.za nameservers (`ns1-4.dns-ns.host` / `.zone`); site records point at the old host `41.76.104.35` |
| Email | Microsoft 365 — **MX/SPF/DKIM records must never be touched** |
| Azure side | Both hostnames (`baclogistics.co.za`, `www.baclogistics.co.za`) already registered on the Static Web App, waiting in "Validating" for two TXT records |
| Blog content | Migrated into BAC's Azure storage on **2026-07-17**. Anything Ideation publishes on the old CouchCMS site after that date is NOT on the new site |

**The three separate workstreams** (they can run in parallel; none blocks another):

1. **DNS access** — being able to edit records. Needed for everything below.
2. **Cutover** — pointing the URL at Azure. Needs only DNS access, not legal ownership.
3. **Ownership** — making BAC the legal registrant. Needs Ideation's sign-off; takes ~5 days; touches nothing technical.

---

## Step 1 — Send Ideation the request (Monday morning)

Copy, adjust names, and send:

> **Subject: baclogistics.co.za — domain handover & DNS records**
>
> Hi [contact],
>
> As you know we've rebuilt the BAC Logistics website in-house on Microsoft Azure and it's ready to go live. To finish this we need three things on the domain, which WHOIS shows is currently registered under Ideation's name at domains.co.za:
>
> **1. Two DNS TXT records added now** (these are invisible to visitors, don't affect the current site or email in any way, and just prove domain ownership to Microsoft so the SSL certificate can be issued before we switch anything):
>
> | Type | Host | Value |
> |---|---|---|
> | TXT | `_dnsauth` | `_tgucdvtkgy480cjbbugxk7n4z8zsxvr` |
> | TXT | `_dnsauth.www` | `_0yuqeb47r0mawlc8tglhd2yz288peer` |
>
> **2. Transfer of the domain into BAC's name.** Please ask domains.co.za to (a) run the registrant change of baclogistics.co.za from Ideation to BAC Logistics [full legal entity name + company reg. number], contact email [rourke@baclogistics.co.za or preferred company address], and (b) move the domain into a domains.co.za account belonging to BAC (we'll open one, or take over billing on the existing item — whatever their process prefers). Before anything changes, please send us a screenshot or export of the **full current DNS zone** (all records) so nothing can get lost.
>
> **3. A pause on publishing blog posts via the old CouchCMS admin.** The new site carries its own copy of the blog (migrated 17 July) — anything published on the old system after that date won't appear on the new site. Once we go live, blog publishing moves to the new admin at the same web address (/admin/) — [developer@baclogistics.co.za] already has an invitation and we'll re-send a fresh link after go-live. If anything was published after 17 July, please tell us which posts so we can carry them over.
>
> To be clear, nothing here ends our content arrangement — this is housekeeping so the company's own domain sits in the company's name. Items 1 and 3 take five minutes; item 2 is a standard registrar process (domains.co.za does the work, you just authorise it).
>
> Thanks,
> [name]

**Why this is a safe ask** (if Ideation queries it):
- The TXT records are additions at hostnames nothing else uses. The live site, email, and every existing record are untouched.
- The registrant change is the standard ZACR/ZARC ".co.za Registrant change process": registrar-mediated, ~5-day pending period, **does not modify DNS records, the website, or email**. .co.za has no EPP/auth codes; incoming .co.za transfers at domains.co.za are free.

---

## Step 2 — What happens at domains.co.za (no action needed beyond Step 1)

- **Registrant change**: Ideation requests it; domains.co.za verifies the current registrant authorises it (their support may ask both parties to confirm). Domain status shows `pendingUpdate` for 5 days, then the change applies. If domains.co.za asks BAC to open its own account first, do that at domains.co.za → Register/Sign up (free).
- **Account move**: their internal "move domain between accounts" process is support-mediated — whatever support quotes, it only changes which login manages the domain, nothing live.
- **Watch-out**: if support proposes anything that recreates the DNS zone, insist the zone export from Step 1 is replicated **exactly** (especially every MX, SPF/TXT, and DKIM/autodiscover CNAME record) before old records are removed.

---

## Step 3 — Validation & SSL (automatic once the TXT records exist)

Nothing to do — Azure polls DNS, validates, and issues free managed SSL certificates for both hostnames. Typically within an hour of the records propagating; allow up to a day.

**How to check** (either):
- Azure Portal → Static Web Apps → **baclogistics** → *Custom domains*: both rows should say **Ready** (not "Validating").
- Terminal: `az staticwebapp hostname list -n baclogistics -g rg-baclogistics-web -o table`

Do not proceed to Step 4 until both show Ready.

---

## Step 4 — Cutover day (the site goes live on baclogistics.co.za)

Best done in the morning of a quiet weekday. In the domains.co.za DNS panel:

| # | Action | Record |
|---|---|---|
| 1 | **Change** the `www` record | CNAME `www` → `ambitious-bush-084cda303.7.azurestaticapps.net` (delete/replace the old www A record if that's what exists) |
| 2 | **Change** the apex (blank/`@`) record | See apex options below |
| 3 | **Touch nothing else** | Every MX, SPF, DKIM, autodiscover, and unrelated record stays exactly as is |

**Apex (`baclogistics.co.za` without www) options, in order of preference:**
1. If the panel offers **ALIAS/ANAME**: point it at `ambitious-bush-084cda303.7.azurestaticapps.net`.
2. Otherwise, **A record** to the Static Web App's stable IP: Azure Portal → the Static Web App → *Overview* → **JSON View** → `stableInboundIP` (this value only appears once a custom domain is validated — read it on cutover day, don't reuse an old note).
3. Or **forward apex → www** if domains.co.za offers domain forwarding (then www is the working hostname).

Set TTLs to the panel's minimum (e.g. 300–3600s) so changes propagate quickly and rollback is fast.

**Verify after 15–60 minutes** (propagation can take longer — up to 72h for stragglers):
- `https://baclogistics.co.za` and `https://www.baclogistics.co.za` load the site with a valid padlock.
- Send a test email **to** an @baclogistics.co.za address and confirm it arrives (proves MX untouched).
- Submit the website contact form once; confirm it arrives at the usual mailbox.
- Old links still work: try `https://baclogistics.co.za/about.html` (should 301 to `/about/`).

**Rollback** (if anything is wrong): restore the two changed records to their previous values from the Step 1 zone export. That's the whole rollback — nothing else moved.

---

## Step 5 — After cutover

1. **Re-issue the blog admin invitations** — the existing ones are bound to the old azurestaticapps.net hostname and won't work on the custom domain. Azure Portal → Static Web Apps → baclogistics → *Role management* → **Invite**: provider *Microsoft Entra ID*, role `blog_author`, **domain: baclogistics.co.za**, for each of: `rourke9001@gmail.com`, `rourke@baclogistics.co.za`, `developer@baclogistics.co.za`. Send each person their new invite link (valid a limited time). CLI equivalent:
   `az staticwebapp users invite -n baclogistics -g rg-baclogistics-web --authentication-provider aad --user-details <email> --role blog_author --domain baclogistics.co.za --invitation-expiration-in-hours 168`
2. **Tell Ideation publishing has moved**: new address `https://baclogistics.co.za/admin/`, sign in with `developer@baclogistics.co.za` via the fresh invite link. The author guide is `docs/blog-author-guide.md` in the repo — send them a copy.
3. **Confirm the registrant change completed** (WHOIS at zarc.web.za/whois should eventually show BAC Logistics as Registrant Organization).
4. **Later (separate phase, no rush)**: cancel the old web hosting only — after confirming with the provider that cancelling hosting does not delete the domain registration or DNS zone (this is exactly why the domain must be in BAC's own account first). Take a final backup of the old server before it's switched off.

---

## Guardrails (the never-do list)

- Never delete or edit **MX, SPF (TXT at apex), DKIM, or autodiscover** records — email dies.
- Never change **nameservers** as part of this plan — everything here happens inside the existing domains.co.za zone.
- Never let a support process recreate the zone without the export from Step 1 in hand.
- The two `_dnsauth` TXT records can be deleted after both domains show **Ready** — or harmlessly left in place.
