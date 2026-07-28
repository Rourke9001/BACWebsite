# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-28 — Digital Presence Audit: contact-detail corrections

Source: "BAC Logistics — Digital Presence Audit" (external, predates the Stage 1–6b work).
Every audit finding was re-verified against the repo before acting — most were already
fixed by that work and needed no change.

### Audit findings — verification results

- [x] **WhatsApp number wrong — REAL, fixed.** The audit reported three numbers; Stage 2's
      single-sourcing had already collapsed them to one, so the live state was *consistently
      wrong* rather than inconsistent: `+27113531111` on all 39 chrome-bearing pages.
      Corrected to `+27743531111` in `data/site.json`.
- [x] **LinkedIn points at the old company URL — REAL, fixed.** `social_linkedin` in
      `data/site.json` was still `broughton-amiss-consulting`; now `bac-logistics-sa`.
      Header only — the footer carries no social links, contrary to the audit's
      "header and footer".
- [x] **`gcz.co.za` download links — ALREADY FIXED, no action.** Zero occurrences anywhere
      in the repo. All 6 documents live at `site/files/` and all 6 references resolve
      exactly (URL-encoded names match the files on disk byte-for-byte).
      `verify:site` against production: **Files 6 ok, 0 fail.**
- [x] **5 P's image on About — ALREADY FIXED, no action.** Now `/media/about/5ps.png`,
      present in the repo and resolving live (inside the 322 passing refs).
- [x] **Homepage counters show "0" — NOT A DEFECT, no action.** `0` is the pre-JS
      placeholder. `site/inc/js/main.js:191` takes the `!isFinite` branch for the
      non-numeric targets `25+`, `24/7`, `100%` and writes the literal string immediately.
- [x] **Broughton's personal number `+27 83 375 5906` — ALREADY GONE.** Zero occurrences;
      `scripts/build-chrome.mjs` has hard-failed the build on it since Stage 2.

### What the change actually touched

- [x] `data/site.json` — two values (`whatsapp`, `social_linkedin`)
- [x] `scripts/build-chrome.mjs` — added the retired WhatsApp number and old LinkedIn slug
      to `RETIRED`, so neither can silently return
- [x] `site/information/privacy-policy.html` — **the guard earned its keep immediately.**
      The regenerate refused to write, reporting `+27 11 353 1111` as body text in the POPIA
      contact block at line 820, outside every chrome region. A chrome-only expander would
      have left it stale and nothing would have flagged it.
- [x] 39 generated files rewritten by `npm run build:chrome`

### Verification

- [x] `npm run check:chrome` — ✓ 39 files match `partials/` + `data/site.json`
- [x] `grep` for every retired value across `site/` + `api/` — **0 occurrences**
- [x] New values present at the expected multiplicity: 78 `wa.me/+27743531111`
      (39 files × 2 links: desktop CTA + mobile social) and 39 `company/bac-logistics-sa`
      (1 per file)
- [x] `npm run verify:site` against **production** (pre-merge baseline): 137 pages,
      101 redirects, 6 files, 322 refs, 136 social — **0 failures**
- [ ] `node scripts/verify-site.mjs <staging-url>` after the PR merges to `develop`
- [ ] Confirm the corrected WhatsApp link opens the right chat on a real handset —
      only the owner can do this

### Corroboration worth recording

The privacy policy labelled the number **"Mobile: +27 11 353 1111"**. `011` is a
Johannesburg landline prefix; `074` is a mobile prefix. The field name and the digits
contradicted each other, which is independent evidence — separate from the audit's
Facebook cross-check — that `74` was transposed to `11` at some point.

### Review

Two data values and one line of body text were wrong; everything else the audit raised had
already been fixed by the Stage 1–6b work and was confirmed clean rather than assumed.
The `RETIRED` list is the load-bearing part of this change: it converted "remember to also
check page bodies" into a build failure, and caught a real instance on the first run.

Deliberately **not** done: the `tel:` landline `0119747472` is unchanged — the audit did
not flag it, and it is consistent site-wide (39 pages plus the displayed
`+27 11 974 7472` on the contact and privacy pages). The Stage 7 README housekeeping
listed at the end of the previous task also remains outstanding.
