# Why one phone number lives in 78 places

Written 2026-07-27, after the WhatsApp number change (`+27 83 375 5906` → `+27 11 353 1111`)
touched 39 files. This explains why a one-number edit is a 39-file sweep, what else has the
same shape, and what we would have to change to fix it.

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

The old site was CouchCMS: one PHP template with the header in a single include, stamped out
server-side on every request. The migration to Azure Static Web Apps was a deliberate
**static rebuild, not a lift-and-shift** (see README, *Scope decisions*), and the export
flattened that template — each page got its own baked copy of the header markup.

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

### Known inconsistency

`privacy-policy.html:804` still reads `Mobile: +27 83 375 5906`. That was scoped out of the
2026-07-27 change on purpose — the instruction was "just the WhatsApp numbers." It is recorded
here so it is a known state rather than a surprise. Decide separately whether the privacy
policy's stated contact number should track the WhatsApp number, the landline, or neither.

## Changing a header value safely

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

## Should we fix it?

Not urgently, and not as a side quest. The honest trade-off:

**Leave it.** Header changes are rare (this is the first since migration), and the sweep is a
reliable three-command recipe with a verifiable diff. The cost is real but small and bounded.

**Build-step templating** (e.g. render `site/` from a layout + per-page content at deploy
time). This is the correct fix, and it removes the whole class of problem. But it ends the
"plain files, no build" property that makes local preview and byte-exactness trivial, changes
the GitHub Actions workflow, and touches all 39 pages in one commit — a large diff to review
against a live site for a problem that currently costs one sweep a year.

**Client-side injection** (a script that writes the header into every page). Rejected: it puts
the primary CTAs and phone number behind JavaScript, which is bad for SEO on a site whose
value is search traffic, and it would flash-render the top bar.

Recommendation: leave it, and keep this document current. If a second or third header change
lands within a year, that is the signal to reconsider the build step — and at that point the
right move is to template the header alone, not the whole page.
