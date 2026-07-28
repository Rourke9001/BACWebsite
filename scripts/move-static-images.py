#!/usr/bin/env python3
"""Stage 6b — move the 69 static images out of the CouchCMS-inherited folder.

    site/couch/uploads/image/<sub>/<file>   ->   site/media/<sub>/<file>
    /couch/uploads/image/<sub>/<file>       ->   /media/<sub>/<file>

The move itself is `git mv`; this script sweeps the references. Run it *after* the
`git mv`, so the 69 destination files exist and the resolution test below can be applied.

WHY THIS IS NOT A REGEX SWEEP
-----------------------------
`site/` holds two intermixed families of `/couch/uploads/` strings and a blind
substitution corrupts the second one:

  * 307 occurrences that point at one of the 69 files being moved. These must move.
  * 43 occurrences that point at nothing on disk, and must NOT be rewritten:
      - 23 redirect *route keys* in staticwebapp.config.json. They are legacy public
        URLs that deliberately do not exist — they are what is being redirected FROM.
      - 13 in api/test/blog-render.test.js. Ten are fixture inputs standing in for what
        the 90 live posts still store in Blob Storage; they are render.js mediaUrl()'s
        input, not references to repo files. Rewriting them guts the Stage 6a tests.
      - 2 prose mentions in render.js comments, 1 in site/admin/admin.js, and 4 regexes
        in the two image scripts that match *stored blob values*.

So the discriminator is not the directory, the extension, or the surrounding syntax —
it is whether the URL resolves to a file being moved. That is `tasks/lessons.md`'s
"derive file sets by reference source, not by directory or basename", applied literally:
every one of the 43 is excluded by construction rather than by a hand-kept skip list.

Two consequences worth naming, because a directory-based rule gets both wrong:
  * image/blog/news.webp is a STATIC asset that happens to live in a blog/ folder. It
    moves. Directory is not the discriminator.
  * The 23 redirect *targets* in the same file as the 23 protected route keys DO resolve,
    so they are swept. Leaving them would turn every one into a 301 into a 404.

BYTE EXACTNESS
--------------
`.gitattributes` pins these paths `-text`, which preserves committed bytes rather than
meaning "LF" (see tasks/lessons.md). The files this touches genuinely disagree:
staticwebapp.config.json is CRLF with no trailing newline; data/site.json is LF with one.
So endings are read per file from its own bytes and reproduced, never normalised.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD_DIR = "site/couch/uploads/image/"
NEW_DIR = "site/media/"
OLD_URL = "/couch/uploads/image/"
NEW_URL = "/media/"

# Dated records of what was measured on a day, not live documentation. Rewriting a URL
# inside them would falsify the record — docs/validation-2026-07-27.md genuinely cites a
# /couch/ path it measured on 2026-07-27. README.md and DESIGN.md are live and ARE swept.
HISTORICAL = ("docs/", "tasks/")

# Any /couch/uploads/... URL. Deliberately broad: we want to SEE all 350 occurrences and
# decide each one by resolution, rather than narrow the pattern and silently miss some.
REF = re.compile(rb"/couch/uploads/[^\"'\s)>\\`]*")


def tracked_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                         check=True).stdout
    return [line for line in out.splitlines() if line]


def is_binary(raw):
    return b"\0" in raw[:8000]


def main():
    files = tracked_files()

    # The 69 files, read from git after the move.
    moved = sorted(f for f in files if f.startswith(NEW_DIR))
    if not moved:
        sys.exit(f"no files under {NEW_DIR} — run `git mv {OLD_DIR.rstrip('/')} "
                 f"{NEW_DIR.rstrip('/')}` first")
    if any(f.startswith("site/couch/") for f in files):
        sys.exit("site/couch/ still has tracked files — the git mv is incomplete")

    # Map each OLD public URL to where that file now lives. Keyed by the pre-move URL,
    # because that is what the references in the tree still say.
    dest = {OLD_URL + f[len(NEW_DIR):]: NEW_URL + f[len(NEW_DIR):] for f in moved}
    print(f"{len(moved)} files under {NEW_DIR}")

    # ---- pass 1: decide every occurrence, write nothing -------------------------------
    edits = {}          # path -> (raw, new_raw, count)
    swept = kept = 0
    kept_detail = {}

    for f in files:
        if f.startswith(NEW_DIR) or f.startswith(HISTORICAL):
            continue
        raw = (ROOT / f).read_bytes()
        if is_binary(raw):
            continue
        if b"/couch/uploads/" not in raw:
            continue

        n_local = 0
        k_local = 0

        def sub(m):
            nonlocal n_local, k_local
            url = m.group().decode("utf-8", "replace")
            # A reference may carry a ?v= cache-buster (README documents that escape hatch).
            base, sep, query = url.partition("?")
            if base in dest:
                n_local += 1
                return (dest[base] + sep + query).encode()
            k_local += 1
            return m.group()

        new_raw = REF.sub(sub, raw)
        swept += n_local
        kept += k_local
        if k_local:
            kept_detail[f] = k_local
        if n_local:
            edits[f] = (raw, new_raw, n_local)

    # ---- assertions: the end state we want, not the transformation we happen to do ----
    problems = []

    # 310 = 307 in code/config + 3 in live docs (README.md's two cache-busting examples
    # and DESIGN.md's share-image fallback, both of which name a real URL).
    if swept != 310:
        problems.append(f"expected 310 sweepable references, found {swept}")
    if kept != 45:
        problems.append(f"expected 45 protected references, found {kept}")

    expected_protected = {
        "site/staticwebapp.config.json": 23,   # redirect route keys — the URLs being redirected FROM
        "api/test/blog-render.test.js": 13,    # mediaUrl() fixtures + prose
        "api/src/lib/blog/render.js": 2,       # prose in comments
        "scripts/migrate-blog-images.py": 2,   # regexes over stored blob values
        "scripts/reencode-images.py": 2,       # ditto
        "site/admin/admin.js": 1,              # prose in a comment
        "README.md": 1,                        # "/couch/uploads/…" — the value posts STORE
        "scripts/README.md": 1,                # "site/couch/uploads/" — prose, no leading /
    }
    if kept_detail != expected_protected:
        problems.append(f"protected set moved: {kept_detail} != {expected_protected}")

    # Line endings are compared against the COMMITTED BLOB, not the working copy. Comparing
    # the working copy to itself cannot fail, and would have missed the real defect here:
    # api/src/blog-templates/error.html was already CRLF on disk while its blob is LF (a
    # checkout that predates the .gitattributes pin). Reading those bytes and writing them
    # back flips 54 line endings — and because that path is pinned `-text`, git records the
    # flip faithfully instead of normalising it away. The pin means "trust the working copy",
    # so a stale working copy is a hazard rather than a thing the pin protects you from.
    for f, (raw, new_raw, _) in edits.items():
        blob = subprocess.run(["git", "show", f"HEAD:{f}"], cwd=ROOT,
                              capture_output=True).stdout
        base = blob if blob else raw
        if (b"\r\n" in base) != (b"\r\n" in new_raw):
            problems.append(f"{f}: line endings differ from the committed blob")
        if base.endswith(b"\n") != new_raw.endswith(b"\n"):
            problems.append(f"{f}: trailing newline differs from the committed blob")
        if base.count(b"\n") != new_raw.count(b"\n"):
            problems.append(f"{f}: line count changed")

    # Every destination a swept reference now names must exist on disk. The lookbehind
    # matters: /blog/media/<f> is Stage 6a's Blob Storage namespace, a different thing
    # that shares the substring and resolves to no repo file by design.
    moved_set = set(moved)
    for f, (_, new_raw, _) in edits.items():
        for m in re.finditer(rb"(?<!/blog)/media/[A-Za-z0-9._/-]+\.(?:png|jpe?g|gif|webp)", new_raw):
            p = "site" + m.group().decode()
            if p not in moved_set:
                problems.append(f"{f}: rewritten reference {m.group().decode()} resolves to nothing")

    if problems:
        print("\nREFUSING TO WRITE — nothing has been modified:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)

    # ---- pass 2: write -----------------------------------------------------------------
    for f, (_, new_raw, _) in sorted(edits.items()):
        (ROOT / f).write_bytes(new_raw)

    print(f"\nswept    {swept} references across {len(edits)} files")
    print(f"protected {kept} references across {len(kept_detail)} files:")
    for f, n in sorted(kept_detail.items()):
        print(f"    {n:3d}  {f}")


if __name__ == "__main__":
    main()
