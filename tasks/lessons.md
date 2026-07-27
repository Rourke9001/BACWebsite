# Lessons

Patterns learned from corrections in this repo (see CLAUDE.md — Self-Improvement
Loop). Durable operational facts belong in the relevant README, not here.

## Shell: this repo is driven from two different shells

The Bash tool is Git Bash (POSIX sh); the PowerShell tool is Windows PowerShell 5.1.
Their multi-line string syntax is not interchangeable. A PowerShell here-string
(`@'…'@`) passed to `git commit -m` **through the Bash tool** does not fail loudly —
bash reads `@'…'@` as concatenated quoted strings, so the commit succeeds with `@` as
its subject line and `'@` trailing the body.

Use a bash heredoc for multi-line commit messages in the Bash tool:

```bash
git commit -F - <<'MSG'
Subject line

Body.
MSG
```

Then check with `git log -1 --format='%s'` before pushing. A malformed subject is
cheap to fix while unpushed and permanent afterwards.

## Verifying edits to `site/` — `--shortstat` is the line-ending canary

`.gitattributes` pins `site/** -text` so mirrored content stays byte-exact. Any tool
that rewrites line endings will therefore show *every line of every file* as changed,
which is invisible in a 39-file diff summary. After a bulk edit, assert the arithmetic:

```bash
git diff --shortstat   # expect exactly (occurrences per file × files)
git diff -U0 | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vc 'TOKEN'   # want 0
```

If the insert count matches what you intended to change and no changed line lacks the
token, only the intended substrings moved.

## `/admin/*` is role-gated — an unauthenticated curl proves nothing

`staticwebapp.config.json` guards `/admin*` with `allowedRoles: [blog_author]`, and the
401 override redirects to Entra login. So `curl .../admin/admin.css` returns a **302 with
an empty body**, and a `grep` against it reports "not found" for a file that deployed
perfectly. Do not read that as a failed deploy. Verify admin assets through an
authenticated browser session instead.

Related: staging and preview share **production** app settings. Loading `/admin/` there
to look is fine; saving, publishing, or deleting touches live blog data.

## Duplicated header markup is the norm in `site/`, not an anomaly

Contact details are baked into all 39 page files (2× per page) plus the two blog
templates — there is no shared include, because `site/` has no build step and SWA static
hosting has no server-side includes. Before changing any header value, read
`docs/shared-header-duplication.md`, and always sweep `api/src/blog-templates/` in the
same commit or the blog header silently diverges from the rest of the site.

## Page weight: count what the browser fetches, not what the markup declares

A tag scan of `<link>`/`<script>`/`<img>` under-counts a page. `site/index.html` also pulls
`background.jpg` from a `url()` inside an inline `<style>`, `favicon.ico` by convention with no
`<link>`, and two font-awesome `.woff2` files via `@font-face` in `all.min.css` — 350 KB across
four resources that no markup attribute names. A "23 resources" figure derived from tags is
wrong by at least three fetches.

When measuring page weight, either drive a real browser or walk CSS `url()` and `@font-face`
transitively. When *checking* someone's figure, reconcile to within a few percent before calling
it unreproducible — a total that looks ~15 % short is usually a missed resource class, not a bad
number.

## CSS: an author `display` rule silently defeats the `hidden` attribute

`[hidden] { display: none }` lives in the **UA stylesheet**, so *any* author-stylesheet
`display` declaration on the same element beats it regardless of specificity. This is how
`/admin/` shipped an empty success banner on every load: `.adm-banner { display: flex }`
made the `hidden` attribute inert. When a class sets `display` on an element that JS
toggles via `.hidden`, pair it with an explicit `.thing[hidden] { display: none }`.
