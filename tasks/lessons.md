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

## `git grep '/pattern'` silently matches nothing on Windows

Measuring Stage 6b's blast radius, this returned nothing at all:

```bash
git grep -l '/couch/uploads/'     # 0 files, exit 1 — and there are 61
```

Git Bash is MSYS2, which rewrites arguments that look like POSIX paths into Windows paths
before `git.exe` sees them. A leading `/` is enough to trigger it, so git searches for a
mangled pattern like `C:/Program Files/Git/couch/uploads/`. **Exit 1 and no output is
exactly what a genuine "no matches" looks like** — there is no error, no warning, and the
answer is plausible if you half-expect the references to be gone already.

Drop the leading slash, or suppress the conversion explicitly:

```bash
MSYS2_ARG_CONV_EXCL='*' git grep -l '/couch/uploads/'   # 61 files
```

`grep -r` is unaffected — it is not an MSYS-aware binary receiving the pattern as a path —
so `grep -r` finding 351 while `git grep` finds 0 is this bug, not a `.gitignore` subtlety.

The general form: on Windows, a tool that reports **zero** is making a claim you should
confirm the same way you would confirm a surprising non-zero one. For a stage that is
entirely a reference sweep, this was the difference between 310 references and none.

## Compare line endings against the committed blob, not the working copy

The `-text` lesson below says to read the bytes of the specific file and reproduce them.
Stage 6b did exactly that and still flipped 54 line endings, because it read the bytes
from the *working copy*:

```python
if (b'\r\n' in raw) != (b'\r\n' in new_raw):   # cannot fail — both come from disk
```

`api/src/blog-templates/error.html` was already CRLF on disk while its blob is LF — a
checkout that predates the `.gitattributes` pin, which converts on checkout but never
re-normalises a file already sitting in the tree. Read-modify-write then rewrites every
line, and because that path is pinned `-text`, **git records the flip faithfully rather
than normalising it away.** The pin means "trust the working copy bytes", so a stale
working copy is a hazard the pin *preserves* rather than one it protects you from.

The tell is that it hides among false alarms: seven other files showed CRLF working copies
too, and every one was harmless because they are unpinned and git normalised them to LF on
`git add`. Only the pinned file's change was real. So `git status`/`git diff` on the
worktree cannot answer this — inspect what is actually staged:

```bash
git show ":$f" | ...   # the blob being committed
git show "HEAD:$f"     # the blob it replaces
```

Assert `new_raw` against `git show HEAD:<file>`, and check the arithmetic per file: a
one-reference edit that reports `1 insertion(+), 1 deletion(-)` is right; the same edit
reporting 94 changed lines is the whole file being rewritten.

## Detecting line endings: `grep -c $'\r$'` lies — use `xxd`

A check of the form

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

**The same trap has a second door, and Stage 4 walked through it.** `Image.save()` does
**not** write `icc_profile` unless you pass it explicitly — so a *re-encode* drops the
profile even though the careful *strip* path above was fixed to preserve it. Stage 4's 23
WebP outputs carry zero profiles and 20 of their 23 sources had one. Nobody noticed,
because the strip path had a test and the encode path had none.

It turned out harmless, but only for a reason that had to be **measured, not assumed**:
every ICC profile in this repo is plain `sRGB IEC61966-2.1`, which is exactly what a
browser assumes for an untagged image. Check before you either panic or shrug:

```python
ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(profile)))
```

And note *why* this needs a guard rather than a check: a lossy re-encode changes every
sample, so the `tobytes()` comparison that protects the lossless path cannot be applied at
all. When you can't verify the output, constrain the input — both image scripts now refuse
any non-sRGB profile instead of silently dropping it.

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

## A rename verified *inside* the repo is still unverified *outside* it

Stage 4 re-encoded 23 static images to WebP and swept every repo reference in the same
commit. Its verification was sound and internally complete: no dangling references, diff
arithmetic exact, tests green. It shipped to `develop` and nobody noticed a problem —
because there wasn't one *in the repo*.

Outside the repo, those 23 URLs were live on production and at least 5 were indexed by
Google Images. Merging `develop` into `main` would have 404'd them. The defect was
invisible to every check we ran because every check we ran pointed inward.

`tasks/lessons.md` already says an extension change is only safe where the references are
sweepable. The missing half: **repo references are not the only references.** Search
engines, external links, and anything that bookmarked a URL all hold references you cannot
grep. Before deleting or renaming any publicly-reachable path, ask what the outside world
already points at — `site:` on Google Images and a probe of the live URL each take a
minute — and decide redirect-or-404 deliberately rather than by omission.

## `-text` in `.gitattributes` pins *bytes*, it does not mean "LF"

Every handoff in this repo has described `site/**`, `partials/**`, `data/**` and
`api/src/blog-templates/**` as "LF-pinned". That is a paraphrase, and it is wrong in a
way that bites. `-text` disables EOL conversion — it preserves whatever bytes are
committed. Most files under those paths happen to be LF, but four are not. Measured
2026-07-28 across all 47 tracked text files under `site/`; 43 are LF and these are not:

| File | Endings | Trailing newline |
|---|---|---|
| `site/staticwebapp.config.json` | 118 CRLF, 0 bare LF | **no** |
| `site/sitemap-static.xml` | 209 CRLF + **1 bare LF** (the blank line before `</urlset>`) | **no** |
| `site/admin/admin.js` | 344 CRLF | yes |
| `site/admin/index.html` | 146 CRLF | yes |

So it is not one exceptional file: `sitemap-static.xml` is *mixed*, and a generator that
writes uniform CRLF into it changes a byte just as surely as one that writes uniform LF.

A generator that asserts `b'\r' not in raw` therefore refuses to touch a perfectly
healthy file, and — worse — a generator that "normalises to LF" rewrites all 118 lines,
producing exactly the fully-changed diff the pin exists to prevent.

Don't assume the convention; read the bytes of the specific file and reproduce them:

```python
CRLF = b'\r\n' in raw
TRAILING_NEWLINE = raw.endswith(b'\n')
```

Then prove the serialiser is faithful *before* trusting it with modified content:

```python
if serialise(json.loads(raw)) != raw:
    sys.exit('serialiser is not byte-faithful on the unmodified file; aborting')
```

That round-trip check is what caught the missing trailing newline here — a 2-byte
difference that no line-level diff would have shown.

One more trap, met while re-deriving the table above: **a byte count is only as good as
the pipeline computing it.** Counting `0d` bytes across `git ls-files site/` flags **87
files** — because a `0d` inside a PNG or a `.woff2` is data, not a line ending. Filtering
to text files and then counting CRLF with `od | tr | paste | grep -o '0d 0a'` *still*
under-reported. Both answers looked authoritative. Filter to text files and count on the
raw buffer, never through a shell pipeline:

```python
d = open(f, 'rb').read()
d.count(b'\r\n'), d.count(b'\n') - d.count(b'\r\n'), d.endswith(b'\n')
```

## Assert the end state you want, not the transformation you happen to be doing

Stage 6a's encoder asserted "every WebP must be smaller than its source" and refused to
write anything. Five of the 87 were genuinely larger. The assertion was wrong, not the
encode: those five sources are already compressed to ~1 bpp, so WebP q90 spends more bytes
faithfully preserving artifacts they already had. Re-encoding them lower to satisfy the
rule would have stacked a second round of generation loss onto lossy inputs to save 157 KB,
on a payload that shrinks by 69 MB — and broken the uniform `.webp` namespace that lets
`render.js` map paths with one rule instead of a lookup table.

"Every file must shrink" is a claim about *my* transformation. The claim actually worth
guarding is about the result: the payload as a whole must shrink dramatically, and no
single file may blow up. Two bounds instead of one rule, plus a report line naming every
file that grew — so the outcome stays visible rather than quietly tolerated.

The tell: when an assertion fires, ask whether it caught a bug in the work or encoded an
assumption about the work. Relaxing it is right exactly when the end state is still the one
you wanted — and then it should be *replaced*, not deleted.

## CSS: an author `display` rule silently defeats the `hidden` attribute

`[hidden] { display: none }` lives in the **UA stylesheet**, so *any* author-stylesheet
`display` declaration on the same element beats it regardless of specificity. This is how
`/admin/` shipped an empty success banner on every load: `.adm-banner { display: flex }`
made the `hidden` attribute inert. When a class sets `display` on an element that JS
toggles via `.hidden`, pair it with an explicit `.thing[hidden] { display: none }`.
