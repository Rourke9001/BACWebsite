# api/

Azure Functions (Node.js v4 model) for the static site.

## POST /api/contact-form (BAC-8)

Replaces the old `/inc/form/action.php`. Handles both `contact_form` and
`service_form` submissions and emails them to `info@baclogistics.co.za`.

Replicated anti-spam (thresholds match the old handler): honeypot
(`company_website` must be empty), min-fill-time gate (3s, needs a live
`form_ts`), rate limiting (5 per IP+form per 5 min), disposable-domain
blocklist, link-density cap (5 links in message), idempotency (duplicate
submits within 3 min pretend success). Dropped by design: Integrately
webhooks, the old-provider BCC, reCAPTCHA, file uploads.

Response contract (same as the old handler): JSON when the caller sends
`Accept: application/json` or `X-Requested-With: XMLHttpRequest`; otherwise a
303 redirect — success to `/information/thank-you.html?status=ok&rid=…`,
failure to `/?status=error&rid=…`.

## App settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `stub` | `stub` logs instead of sending; `smtp` / `graph` are implemented in BAC-9 |
| `CONTACT_RECIPIENT` | `info@baclogistics.co.za` | Override for testing (BAC-10) |
| `CONTACT_FROM` | `noreply@baclogistics.co.za` | Sender address |

Secrets (mail credentials) go in SWA application settings / `local.settings.json`, never in git.

## Structure & tests

`src/functions/contact-form.js` is a thin HTTP adapter; all logic lives in
`src/lib/` (`handler.js`, `spam.js`, `email.js`) with no Azure dependencies, so
tests run with plain Node:

```
cd api && npm test
```

Note: rate-limit/idempotency stores are in-memory per Function instance (the
old handler's file store was per-server, so parity is equivalent at this
traffic level).

## Still to wire (other tickets)

- BAC-9: real email send via M365 (SMTP AUTH or Graph) behind the
  `EMAIL_PROVIDER` interface in `src/lib/email.js`.
- BAC-10: repoint the 14 HTML form actions to `/api/contact-form` and set
  `form_ts` via JS at page load (the mirrored value is frozen, so the
  min-fill gate is a no-op until then), then 3 end-to-end test enquiries.
