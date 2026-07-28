# Why one phone number used to live in 78 places

> **Resolved 2026-07-27.** The duplication described below is gone. The chrome is now
> expanded from `partials/` + `data/site.json` by `scripts/build-chrome.mjs`, and a CI
> check fails any PR whose generated files disagree with those sources. Changing a
> contact detail is one edit to `data/site.json` plus `npm run build:chrome` — see
> **README → Changing the header, footer, or a contact detail**.
>
> This document is kept because the *analysis* is still the reason the fix looks the way
> it does. Read the sections below as history, not as current instructions; the
> "Changing a header value safely" recipe in particular is **superseded** — do not sweep
> by hand any more.

Written 2026-07-27, after the WhatsApp number change (`+27 83 375 5906` → `+27 11 353 1111`)
touched 39 files. This explains why a one-number edit was a 39-file sweep, what else had the
same shape, and what we changed to fix it.

## The arithmetic

| Where | Files | Per file | Total |
|---|---:|---:|---:|
| `site/**/*.html` — static pages | 37 | 2 | 74 |
| `api/src/blog-templates/{index,post}.html` — blog | 2 | 2 | 4 |
| **Total** | **39** | | **78** |

Two per file because the top bar renders the contact strip twice, for two breakpoints:

- `#glht-cta-btns` — the desktop pill buttons (*Get A Quote* / *Phone Us* / *WhatsApp*),
  carrying `.gl-hide-on-mobile`
- `#glht-socials` — the mobile icon row, whose first three items carry `.gl-hide-on-desktop`

Both copies are always in the DOM; CSS decides which one is visible. So every page holds two
independent copies of the same `wa.me` href, and neither is derived from the other.

Two `site/` HTML files are correctly *not* in the count — `404.html` and `admin/index.html`
both use a stripped-down shell with no public header. The blog's `error.html` is the same.

The 39 source files are not the same as 39 affected URLs. `blog-templates/post.html` renders
every one of the ~99 blog posts, so the *served* number appears on roughly 140 pages — but it
is edited in one place. That is the whole point of the templates, and it is the pattern the
static pages lack.

## Why it is like this

`site/` is a **static export**. The pages were produced by flattening a server-rendered
template, so the header that was once a single include became a baked-in copy on every
page. That was a deliberate scope decision — a static rebuild, not a lift-and-shift (see
README, *Scope decisions*) — and it is why the duplication exists rather than being an
accident someone introduced later.

Nothing since has re-introduced a shared header, because two things would have to give:

1. **`site/` has no build step.** It is plain files served as-is; `python -m http.server`
   is a faithful preview precisely because nothing is compiled. There is no template pass in
   which an include could be expanded.
2. **Azure SWA static hosting has no server-side includes.** Unlike the old Apache/PHP host,
   there is no `<!--#include-->` or partial rendering for files served from `site/`. Content
   is either a literal file or it comes from a Function.

`.gitattributes` pins `site/** -text` to keep the mirrored content byte-exact, which is a
further hint that these files are treated as an export artifact rather than as hand-authored
source.

## What else has this shape

The contact strip is not the only duplicated thing, and the numbers differ, so don't assume a
single sweep catches everything:

| Value | Occurrences | Notes |
|---|---:|---|
| `wa.me/+27113531111` | 78 | header only, 2 per page |
| `tel:0119747472` | 79 | 2 per page in the header, **plus a third in `site/contact/index.html:582`** — a body content card, not header markup |
| `Mobile: +27 83 375 5906` | 1 | `site/information/privacy-policy.html:804`, prose. **Still the old number** — left as-is deliberately, see below |

The lesson from the `tel:` count: contact details live in page *content* as well as in the
copied header, and a `grep`-and-replace tuned to the header pattern will silently miss those.
Always count first and reconcile the count against `pages × 2` before replacing.

### Known inconsistency — closed

This section used to record that `privacy-policy.html:804` still read
`Mobile: +27 83 375 5906`. **It no longer does** — that was fixed in `571cd6d`, and a
tree-wide grep for both `83 375 5906` and `0833755906` now returns nothing.

The expander enforces it going forward: `scripts/build-chrome.mjs` carries a list of
retired values and refuses to write — or, in `--check`, fails the PR — if any of them
reappears anywhere in the 39 files. That covers page body content, not just chrome, which
is the gap a marker-keyed expander would otherwise leave.

## Changing a header value safely — SUPERSEDED

> Do not do this any more. It is `npm run build:chrome` now. The recipe is kept only
> because its step 3 is still how you check *any* bulk edit to `site/`.

```bash
# 1. Count first — know the number you expect to change.
grep -ro 'wa\.me/[^"]*' site api/src/blog-templates --include=*.html | sort | uniq -c

# 2. Replace across both trees. Do not forget api/src/blog-templates — the blog
#    header is a separate copy and will otherwise go stale against the rest of the site.
for f in $(grep -rl 'OLD' site api/src/blog-templates --include=*.html); do
  sed -i 's|OLD|NEW|g' "$f"
done

# 3. Prove the diff touched nothing else. Expect 2 × files, and every changed
#    line should contain the token you replaced.
git diff --shortstat
git diff -U0 | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vc 'TOKEN'   # want 0
```

Step 3 matters more than it looks: `site/** -text` means a tool that rewrites line endings
will show every line of every file as changed, and that is easy to miss in a 39-file diff.
`git diff --shortstat` reporting exactly `2 × files` insertions is the cheap proof that only
the intended substrings moved.

## What we did — and what the options were

The original recommendation here was **leave it**, on the grounds that header changes are
rare and the sweep is a reliable recipe. That was overtaken: the sweep itself is what
prompted the review, and the owner's requirement was explicit — *"if I need to update the
WhatsApp number, I want to change it in one place."*

**Chosen: partials + a data file + a build-time expander, output committed.**
`partials/` holds structure, `data/site.json` holds values, `scripts/build-chrome.mjs`
expands both into the 39 files in place, and CI fails any PR where the two disagree.

The key move that made this cheap was scoping it to the *chrome only*. The expander does
not render pages — it replaces marked regions and leaves every byte outside them alone. So
the "large diff to review against a live site" objection below evaporated: the migration
commit adds 704 inert HTML comments and changes **zero** bytes of served content, which was
verified by stripping the markers back out and comparing to the previous commit.

The alternatives, and why they lost:

**Full build-step templating** (render `site/` from a layout + per-page content). Solves a
bigger problem than exists. Drift was measured at zero across all 39 files and the site is
37 stable pages; a framework adds a dependency surface and a migration for no gain here. It
would also end the "plain files, no build" property — which the chosen approach keeps,
because the files on disk stay the real files.

**Client-side injection** (a script that writes the header into every page). Rejected: it
puts the primary CTAs and phone number behind JavaScript, which is bad for SEO on a site
whose value is search traffic, and it would flash-render the top bar.

**Server-side includes.** SWA static hosting has none.

**Function-rendered pages.** Moves 37 static pages behind the Functions host, makes
whole-site availability depend on it, and cold pages get slower (~650 ms static TTFB vs
~1.2 s cold Function, measured).

**A data file with no partials.** Meets the WhatsApp requirement but not nav or footer
structure, and needs a second mechanism for the blog templates. The scalar half of it
survives as `data/site.json`.

### The one thing worth keeping load-bearing

`api/src/blog-templates/{index,post}.html` are targets of the **same** expander as `site/`.
They are 2 of 39 files but carry 98 of 135 public URLs — `post.html` alone renders 90 posts.
A design that templated `site/` and left the blog on a separate mechanism would have fixed
5% of the files and 27% of the URLs while looking finished. The CI check covers both trees
for exactly this reason.
