# tasks/todo.md

Working plan for the current task (see CLAUDE.md — Task Management).
Reset when a task completes; keep no long-term history here.

## 2026-07-27 — WhatsApp number, admin banner, blog_author invites

- [x] Invite 6 Ideation Digital staff as `blog_author` on `baclogistics.co.za`
      (links generated 2026-07-27, expire 2026-08-03 — Rourke distributes)
- [x] WhatsApp number `+27 83 375 5906` → `+27 11 353 1111` (78 refs, 39 files;
      `site/` + `api/src/blog-templates/`). `tel:` and privacy-policy mobile left alone
      per instruction.
- [x] Fix empty success banner on `/admin/` first load — `.adm-banner[hidden]` rule
- [x] Document why the number lives in 78 places — `docs/shared-header-duplication.md`
- [x] Verify banner fix in-browser against the real `admin.css` (bug reproduced, fix proven)
- [ ] Merge to `develop` → confirm staging
- [ ] Open PR `develop` → `main` (Rourke merges = production deploy)

### Review

**WhatsApp number.** 78 occurrences across 39 files: 37 static pages × 2 plus both blog
templates × 2. Two per file because the top bar renders the contact strip twice — desktop
pills (`#glht-cta-btns`) and the mobile icon row (`#glht-socials`). `api/src/blog-templates/`
was included deliberately; missing it would have left the blog header on the old number
while the rest of the site moved. Verified the diff is exactly 78 insertions / 78 deletions
and that every changed line contains `wa.me`, which also rules out line-ending damage
(`site/** -text` makes that a real risk).

Scoped out on instruction: `tel:0119747472` (79 refs) and `Mobile: +27 83 375 5906` in
`privacy-policy.html:804`. The privacy-policy line is now the only place the old number
survives — recorded in the doc as a known state, not an oversight.

**Admin banner.** Root cause was a CSS cascade defect, not a JS one: `admin.css:12` set
`.adm-banner { display: flex }`, and an author-stylesheet `display` declaration outranks the
UA stylesheet's `[hidden] { display: none }` regardless of specificity. So the `hidden`
attribute on `#adm-banner` was inert and an empty 51px green bar rendered on every load.
Fix is one rule, `.adm-banner[hidden] { display: none; }`.

Proven rather than assumed: loaded the real `admin.css` in Chrome and measured computed
style for the exact banner markup. Without the rule → `display: flex`, height 51px (bug
reproduced). With it → `display: none`, height 0. Then walked the full lifecycle —
initial `hidden` → `showBanner()` shows it → the no-link (unpublished) variant keeps
`#adm-banner-link` hidden → `hideBanner()` hides it again. All four states correct, so the
fix does not regress the publish confirmation it was guarding.

Checked the other `hidden` elements in `admin/index.html` for the same defect
(`#adm-edit-view`, `#adm-docs-view`, `#adm-featured-preview`, `#adm-delete`,
`#adm-body-file`, `#adm-doc-file`, `#adm-banner-link`) — none has a competing `display`
rule, so `.adm-banner` was the only instance. No broader `[hidden]` reset needed.

**Deploy path.** No new branching model required — the existing one already covers this.
`develop` → staging on push, PR `develop` → `main` for production. `main` is protected
(`enforce_admins: true`), so a PR is mandatory; direct push is not an option.
