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

## Detecting line endings: `grep -c $'\r$'` lies — use `xxd`

This repo's files are **LF**, including `site/`. A check of the form

```bash
crlf=$(grep -c $'\r$' "$f"); total=$(wc -l < "$f")   # WRONG
```

reported `crlf == total` for every file — i.e. "100% CRLF" — on files with no CR in them
at all. The `$'\r'` gets eaten before grep sees it and the pattern collapses to `$`, which
matches every line. The failure mode is the worst kind: it returns a confident, plausible,
uniform answer.

Settle it on raw bytes instead, and never on a line-ending question you are about to build
on:

```bash
head -c 40 file.html | xxd     # look for 0d0a (CRLF) vs bare 0a (LF)
```

Related: `.gitattributes` pinned only `site/** -text`. With `core.autocrlf=true`, everything
*outside* that pin — `api/src/blog-templates/`, and any new build inputs — gets CRLF working
copies of LF blobs on a Windows checkout, so a generator writing LF makes every file read as
fully changed. If a tool writes bytes into a tracked file, pin that path.

## Don't use `git checkout --` to undo a mutation inside a test

Reverting a file to `HEAD` mid-test doesn't restore "the state before my mutation" — it
restores the state before *the whole working session*. In the chrome migration this silently
stripped one file's markers, dropping it out of the expander's target set, so the next run
reported 38 files instead of 39 and the number looked like a tool bug rather than a test bug.

Undo a mutation with its inverse, or rebuild the pipeline from a known commit. Reserve
`git checkout --` for deliberate resets you have decided on, not for cleanup.

## Validate everything before writing anything

The first version of `build-chrome.mjs` expanded, wrote each file, and *then* reported
problems — so a retired phone number got written into all 39 files before the error appeared.
For any tool that fans one input out across many files, collect the full output in memory,
run every assertion, and only then write. Prove it with a test that asserts zero files
changed on a failing run; "it printed an error" is not the same as "it didn't do the damage".

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

## "The pixels are identical" does not prove an image edit was lossless

Stripping metadata from the site's images, the obvious check is to decode before and after
and compare the raw samples:

```python
if Image.open(before).tobytes() != Image.open(after).tobytes():   # NOT SUFFICIENT
```

It passes on an edit that visibly changes the image. `tobytes()` returns the decoded
*samples*; it says nothing about how those samples are meant to be *interpreted*. Drop a
JPEG's APP2 segment and you have removed the ICC colour profile — every sample identical,
every colour potentially shifted on a wide-gamut display. Drop APP14 and you have removed
Adobe's colour-transform flag.

The first version of `scripts/reencode-images.py` dropped APP1–APP15 wholesale and its
pixel check passed on all 93 files. It would have silently discarded 43 colour profiles.

Strip by naming what goes, never by naming a range that sweeps up what stays — APP1
(EXIF/XMP), APP13 (Photoshop) and COM for JPEG; `tEXt`/`zTXt`/`iTXt` for PNG — and assert
the things a sample comparison cannot see:

```python
before.info.get('icc_profile') == after.info.get('icc_profile')
before.size == after.size and before.mode == after.mode
```

The general form: when you verify a transformation, check the *interpretation* metadata as
well as the payload. A byte-for-byte payload match is a weaker claim than it appears.

## Derive file sets by reference source, not by directory or basename

`site/couch/uploads/` holds two intermixed sets — 69 images referenced by repo HTML and 87
referenced only by `featured_image`/`json_ld` in blob post JSON. **The folder does not
separate them**: blog images live in both `image/` and `image/blog/`.

Deduplicating by *basename* also silently merges distinct files — five basenames
(`air-freight.jpg`, `aog.jpg`, `bonded-warehousing.jpg`, `road-freight.jpg`,
`sea-freight.jpg`) exist in two directories each. A basename-keyed derivation returned
64 + 87 = 151 and looked plausible against a real folder; the correct path-keyed
derivation returns 69 + 87 = 156.

Key on the full path, and split on *who points at the file*. Then check the arithmetic
adds up to the file count you can see on disk before building anything on it.

## An extension change is only safe where the references are sweepable

Stage 4 was briefed as "re-encode the 95 oversized images". 72 of them could not be
touched: `render.js:55,109` emits `post.featured_image` verbatim, so a blog image's URL
comes from post JSON in Blob Storage. Renaming the file in the repo would have 404'd all
90 posts, and no repo-side sweep could have prevented it because the references are not in
the repo.

Before any rename, ask where the references actually live — not how many there are. Repo
references are sweepable and provable in the same commit. References in a database, a blob
store, or anything else outside the diff are a different and much larger change, and they
usually belong in whichever stage is already rewriting that data.

## A uniform-looking block is not necessarily chrome — check the markers

The Stage 5 handoff said the OG/Twitter tags were "a `partials/` + `data/site.json` edit,
chrome is single-sourced". The block *is* byte-uniform in shape across all 39 files, which
is what made that plausible. It is not chrome: it sits between `@end:head-css` and
`@chrome:head-meta`, and five of its tags (`og:title`, `og:description`, `og:url`,
`twitter:title`, `twitter:description`) hold per-page values. Planning it as a partial edit
would have produced 39 identical share cards.

"Uniform across files" and "single-sourced" are different claims. Before planning around
either, run `sed -n '/@chrome:/,/@end:/p'` — or just look at the markers — and split the
region into what genuinely never varies and what only *looks* like it doesn't.

## Assert before writing, and the assertion finds other people's bugs too

`tasks/lessons.md` already says validate-everything-then-write. Worth recording what that
bought the second time: the Stage 5 migration asserted "no `content=""` survives in the OG
block" and refused to write **any** of the 39 files. The cause was not the migration — it
was two `/video-hub/` pages shipping an empty `<meta name="description">`, and pulling that
thread found 12 more carrying the literal placeholder `Meta description for video` in three
tags each. A pre-existing content defect, live in production, that nothing in the brief or
four investigation documents had noticed.

A write-then-report tool would have written 39 files and printed a warning nobody read.
Assertions that stop the run are how unrelated defects surface — so make them about the
*desired end state*, not just about your own transformation.

## CSS: an author `display` rule silently defeats the `hidden` attribute

`[hidden] { display: none }` lives in the **UA stylesheet**, so *any* author-stylesheet
`display` declaration on the same element beats it regardless of specificity. This is how
`/admin/` shipped an empty success banner on every load: `.adm-banner { display: flex }`
made the `hidden` attribute inert. When a class sets `display` on an element that JS
toggles via `.hidden`, pair it with an explicit `.thing[hidden] { display: none }`.
