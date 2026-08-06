#!/usr/bin/env python3
"""Stage 6b — one-shot script that swept references after `git mv site/couch/uploads/image
site/media` retired the CouchCMS folder. Kept as the record of which references moved and
why the rest didn't; see scripts/README.md for the full reasoning and the numbers.

    site/couch/uploads/image/<sub>/<file>   ->   site/media/<sub>/<file>
    /couch/uploads/image/<sub>/<file>       ->   /media/<sub>/<file>
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

# Dated records of what was measured on a day — rewriting a URL inside them would falsify
# the record. README.md and DESIGN.md are live docs, not dated records, and ARE swept.
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

    # Compared against the COMMITTED BLOB, not the working copy — a working-copy-to-itself
    # comparison can't fail, and would have missed a real stale checkout. See scripts/README.md.
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

    # Every destination a swept reference now names must exist on disk — the lookbehind
    # excludes /blog/media/<f>, Stage 6a's Blob namespace, which shares the substring only.
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
