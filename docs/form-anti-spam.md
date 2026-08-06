# Contact form anti-spam

Design and runbook for the layered anti-spam on `/api/contact-form`. The same
design is deployed in the sibling `BACTransportWebsite` repo — `api/src/lib/spam.js`
is kept byte-identical between the two, so changes here must be ported there.

## Why this exists

From late July 2026 both sites' forms were hit by a form-blaster (first seen from
`80.94.95.173`, a Bulgarian bulletproof-hosting range). Representative payload:

```
Name: Robertgot
Email: nhoehn02@gmail.com
Phone: 83461666195
Company: google
Subject: Hallo    write about your   price for reseller
Message: Hi, I wanted to know your price.
```

Every gate that existed at the time passed it:

| Gate | Why it did not fire |
| --- | --- |
| Honeypot (`company_website`) | Bot skips `display:none` inputs — trivially detectable |
| Min fill time (3 s) | `form_ts` is a **frozen literal in the static HTML**, only refreshed by `main.js`. A bot posting directly sends the stale value, so `now - form_ts` is large and the "too fast" test passes |
| Rate limit (5 / 5 min / IP) | In-memory `Map` per Function instance. SWA Consumption cold-starts and scales out, so the window resets constantly |
| Blocked domains | The sender was `@gmail.com` — legitimate |
| Link count | Zero links in the body |
| Duplicate hash | Body differed each time |

Nothing in the stack forced the client to prove it was a browser. That is the gap
Turnstile closes; the rest of this document fixes the gates that were already
supposed to be doing a job.

## The layers

Ordered as they execute in `api/src/lib/handler.js`.

### 1. Cloudflare Turnstile (the hard gate)

Free, unlimited, no Google dependency, and no cookie banner implications for POPIA.

**Client** — `site/inc/js/main.js`, `initTurnstile()`. Injected rather than written
into markup: there is no build step, and the form appears on 14 pages per repo.
The function finds every `form[action="/api/contact-form"]`, inserts a
`.cf-turnstile` container above the actions row, and loads `api.js` async.

- `data-action` = the form's `form_id`, so a token minted on one form cannot be
  replayed against another.
- `data-refresh-expired="auto"` — tokens expire 300 s after generation; without
  this a slow filler is rejected on submit.
- `data-appearance="interaction-only"` — invisible unless the visitor is actually
  challenged.

**Trade-off accepted:** visitors with JavaScript disabled cannot submit. `main.js`
already had to stamp `form_ts` for a clean submit, so this is not a new dependency.
The forms carry a `<noscript>` block pointing at the phone number and email address.

**Server** — `api/src/lib/turnstile.js`. POSTs to
`https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`,
`response`, `remoteip` and `idempotency_key` (the request id, so a retry is safe).
A submission is accepted only when all three hold:

- `success` is true;
- `action` equals the submitted `form_id`;
- `hostname` is in the allowlist.

**Failure policy** — deliberate, and the most important decision in this document:

| Condition | Behaviour |
| --- | --- |
| Token missing, invalid, expired, or replayed | **Reject** |
| `action` or `hostname` mismatch | **Reject** |
| siteverify unreachable / 5xx / network error | **Allow**, log loudly, prefix the mail subject `[UNVERIFIED]` |
| `TURNSTILE_SECRET` unset | **Skip the check**, log a warning on every submission |

Failing open on a Cloudflare outage is intentional: for a logistics business,
silently dropping real enquiries costs more than a handful of spam mails, and the
`[UNVERIFIED]` prefix makes the degraded window obvious in the inbox. Failing open
on a missing secret is what allows this code to reach `develop` before the keys
exist, instead of bricking every form the moment it merges — the warning log is
the compensating control.

### 2. Form timestamp bounds

`filledTooFast()` only ever rejected submissions that were *too fast*, which is why
the stale frozen literal sailed through. The gate now rejects when the timestamp is:

- newer than `MIN_FILL_SECONDS` (3 s) — scripted instant submit; or
- older than `MAX_FORM_AGE_SEC` (12 h) — the build-time literal, i.e. `main.js`
  never ran; or
- missing or unparseable.

This alone catches "posted without executing our JavaScript", which is the
signature of the traffic that prompted the work. Twelve hours is generous enough
for a genuinely long-lived open tab. Note the literal in the HTML only ever gets
*older*, since there is no build step to refresh it — the check is self-correcting.

### 3. Durable rate limiting

`api/src/lib/rate-store.js`, backed by Azure Table Storage on the **existing**
storage account via the **existing** `BLOG_STORAGE_CONNECTION` setting. No new
Azure resource, no new secret, no new cost line.

- Key: `sha256(formId|ip)`, partitioned by form id.
- Threshold tightened to 3 per 10 minutes.
- The in-memory `Map` is retained as an L1 cache to avoid a table round-trip on
  every request.
- **Fails open** if the table is unreachable — the rate limiter is a
  defence-in-depth layer, not the thing standing between the site and the bots.

### 4. Content scoring

`score(fields)` in `spam.js` returns a weighted total over signals seen in the real
payloads: digit-only phone of 11+ characters with no `+`, company matching a
brand-squat list, non-Latin script in the body, known blast phrases, and
name/email dissonance. It rejects only above a threshold that requires at least
two strong signals to coincide.

The score is **logged on every submission**, including accepted ones, so the
threshold can be tuned against real traffic instead of guesswork. This is the only
arms-race component here; layers 1–3 are what actually stop the current traffic.

## Content Security Policy

`BACTransportWebsite/site/staticwebapp.config.json` sets `script-src 'self'`, which
blocks Turnstile **silently**. It needs `https://challenges.cloudflare.com` on both
`script-src` and `frame-src`. `BACWebsite` sets no CSP, so it needs no change —
if one is ever added, it must include those two directives.

## Runbook

### Cloudflare (once, covers both sites)

One widget serves both repos: the site key is public and ships in `main.js`, and
staging shares production's app settings, so the same secret applies everywhere.

Done on 2026-08-06. Widget **"BAC contact forms (logistics + transport)"** in the
`Developer@baclogistics.co.za` account, mode **Managed**, pre-clearance off (the
sites are not proxied through Cloudflare). Site key
`0x4AAAAAAEH1ojW5Bful-wg-` — public, and already in `main.js`.

The nine registered hostnames, 9 of the 10 a widget allows:

| | |
| --- | --- |
| `baclogistics.co.za` | `www.baclogistics.co.za` |
| `ambitious-bush-084cda303.7.azurestaticapps.net` | bare = BAC Logistics production |
| `ambitious-bush-084cda303-staging.7.azurestaticapps.net` | BAC Logistics staging |
| `bactrans.co.za` | `www.bactrans.co.za` |
| `black-bush-02d78cb03.7.azurestaticapps.net` | bare = BAC Transport production |
| `black-bush-02d78cb03-staging.7.azurestaticapps.net` | BAC Transport staging |
| `localhost` | local testing |

To recreate or roll it: Cloudflare dashboard → **Turnstile** → **Add widget**,
mode **Managed**, add the hostnames above, then put the site key in `main.js`
(both repos) and the secret in SWA app settings (below) — never in the repo.

### Which key goes where

The two keys have opposite handling, and conflating them is the easy mistake:

| Key | Where it lives | Why |
| --- | --- | --- |
| **Site key** | `main.js`, committed | Public by design — the browser must receive it to render the widget, so it is readable via view-source on every Turnstile site. It is domain-locked: the hostname allowlist above is what makes publishing it safe, and `turnstile.js` rejects a `hostname` mismatch independently. |
| **Secret key** | SWA app settings only | A real credential. Read as `process.env.TURNSTILE_SECRET`; it appears in no file in either repo. |

A `.env` file would not help the site key. There is no build step in this repo, so
nothing could inline it into `main.js` — and with a bundler the value would still
be served to the browser. It would look like a secret without being one.

### Azure app settings

```
az staticwebapp appsettings set \
  --name <swa-name> \
  --resource-group <rg> \
  --setting-names TURNSTILE_SECRET=<secret>
```

Set this on **both** Static Web Apps. Until it is set the forms still work, but
every message arrives subject-prefixed `[UNVERIFIED]` — the deliberate fail-open
state, not a broken one.

No cost: Turnstile is free and unlimited, and the rate-limit table reuses the
storage account the blog already pays for (a few cents a month at this volume).

### Known limitations

- **PR preview environments get dynamic hostnames** that cannot be pre-registered,
  so Turnstile hostname validation fails there. Test forms on **staging**, not on
  preview environments.
- Staging and preview share **production** app settings. A staging form submission
  sends a real email to the production recipient.

## Testing

`handleSubmission` stays pure: `verifyCaptcha` and `rateStore` are injected through
`deps`, matching the existing `deps.sender` pattern, so no test touches the network
or Azure. Covered in `api/test/`:

- token valid, invalid, expired, replayed, `action` mismatch, `hostname` mismatch;
- siteverify outage fails open and marks the mail `[UNVERIFIED]`;
- missing secret skips the check and warns;
- timestamps: too fast, too old, missing, unparseable, valid;
- rate limit rollover and fail-open on store error;
- scoring thresholds, including that a realistic legitimate enquiry scores clean.
