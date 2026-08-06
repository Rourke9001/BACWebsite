#!/usr/bin/env python3
"""Stage 6a — one-shot script that produced the WebP payload for the 87 blog images
moved to Blob Storage. Kept as the historical record of that migration's assertions;
see scripts/README.md for the full reasoning (image selection, size growth, ICC handling).

    python scripts/migrate-blog-images.py --check          # report, write nothing
    python scripts/migrate-blog-images.py --out <dir>      # encode into <dir>
"""

import argparse
import io
import json
import os
import re
import sys

try:
    from PIL import Image, ImageCms
except ImportError:
    sys.exit("Pillow is required:  python -m pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUALITY = 90
# A few sources are already compressed (~1 bpp); WebP faithfully spends more bytes
# reproducing their existing artifacts. Bounded per-file; MIN_SHRINK is the real guard.
MAX_GROWTH = 2.0
MIN_SHRINK = 0.50
COUCH_RE = re.compile(r"/couch/uploads/[A-Za-z0-9._/-]+")
# router.js:13 -- the flat /blog/media/ namespace.  Every produced name must match.
ROUTER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
ALLOWED_ICC = "sRGB IEC61966-2.1"
# Metadata that must not survive into the uploaded payload (see tasks/todo.md, Stage 4).
FORBIDDEN = (b"IdeationDT1", b"C:\\Users", b"xmpmeta", b"AdobeID")


def newest_backup():
    root = os.path.join(ROOT, "backups")
    if not os.path.isdir(root):
        return None
    dirs = sorted(d for d in os.listdir(root)
                  if d.startswith("blog-") and os.path.isdir(os.path.join(root, d, "posts")))
    return os.path.join(root, dirs[-1], "posts") if dirs else None


def collect(posts_dir):
    """The blog image set, keyed on the reference string exactly as stored."""
    refs, featured, jsonld, body = set(), 0, 0, 0
    names = sorted(f for f in os.listdir(posts_dir) if f.endswith(".json"))
    for n in names:
        with open(os.path.join(posts_dir, n), encoding="utf-8") as fh:
            post = json.load(fh)
        if post.get("featured_image"):
            refs.add(post["featured_image"])
            featured += 1
        if post.get("og_image"):
            refs.add(post["og_image"])
        for m in COUCH_RE.findall(post.get("json_ld") or ""):
            refs.add(m)
            jsonld += 1
        body += len(COUCH_RE.findall(post.get("body") or ""))
    return sorted(refs), len(names), featured, jsonld, body


def blob_name(ref):
    """The render-time map, in Python.  Must stay in step with mediaUrl() in render.js."""
    return os.path.splitext(os.path.basename(ref))[0] + ".webp"


def icc_description(profile):
    try:
        return ImageCms.getProfileDescription(
            ImageCms.ImageCmsProfile(io.BytesIO(profile))).strip()
    except Exception:
        return "unreadable"


def encode(path):
    """Encode to WebP q90, preserving dimensions and real transparency."""
    im = Image.open(path)
    profile = im.info.get("icc_profile")
    uses_alpha = (im.mode in ("RGBA", "LA", "PA")
                  and im.convert("RGBA").getchannel("A").getextrema()[0] < 255)
    src = im.convert("RGBA") if uses_alpha else im.convert("RGB")
    buf = io.BytesIO()
    src.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue(), im.size, uses_alpha, profile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    ap.add_argument("--out", help="directory to write the encoded WebPs into")
    ap.add_argument("--posts", help="post JSON directory (default: newest backups/blog-*/posts)")
    args = ap.parse_args()

    posts_dir = args.posts or newest_backup()
    if not posts_dir or not os.path.isdir(posts_dir):
        return fail("no post JSON directory -- run scripts/backup-blog.mjs first, or pass --posts")
    if not args.check and not args.out:
        return fail("pass --out <dir> to write, or --check to report")

    refs, n_posts, featured, jsonld, body = collect(posts_dir)
    print(f"posts: {n_posts}   featured_image refs: {featured}   json_ld refs: {jsonld}"
          f"   body refs: {body}")
    print(f"distinct blog image references: {len(refs)}")
    print(f"source: {os.path.relpath(posts_dir, ROOT).replace(os.sep, '/')}\n")

    # ---- phase 1: build and validate the whole plan in memory ------------------
    plan, errors = [], []
    stems, before_total, after_total = {}, 0, 0

    for ref in refs:
        rel = os.path.join("site", ref.lstrip("/").replace("/", os.sep))
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            errors.append(f"{ref}: referenced by a post but missing on disk")
            continue

        name = blob_name(ref)
        stems.setdefault(name, []).append(ref)
        if not ROUTER_RE.match(name):
            errors.append(f"{name}: does not match the /blog/media/ router regex")

        size = os.path.getsize(path)
        data, dims, alpha, profile = encode(path)

        if profile:
            desc = icc_description(profile)
            if desc != ALLOWED_ICC:
                errors.append(f"{ref}: ICC profile is {desc!r}, not {ALLOWED_ICC!r} -- "
                              f"dropping it would shift colour; see the module docstring")

        # Re-decode what we are about to write; never trust the encoder blindly.
        check = Image.open(io.BytesIO(data))
        if check.size != dims:
            errors.append(f"{ref}: encoded dimensions {check.size} != source {dims}")
        if alpha and check.mode != "RGBA":
            errors.append(f"{ref}: source has transparency, encoded mode is {check.mode}")
        if len(data) > size * MAX_GROWTH:
            errors.append(f"{ref}: WebP is {len(data) / size:.1f}x the source "
                          f"({len(data):,} vs {size:,}) -- past the growth bound")
        for token in FORBIDDEN:
            if token in data:
                errors.append(f"{ref}: encoded output still contains {token.decode()!r}")

        plan.append((ref, name, size, len(data), dims, alpha, bool(profile)))
        before_total += size
        after_total += len(data)

    for name, sources in sorted(stems.items()):
        if len(sources) > 1:
            errors.append(f"{name}: stem collision in the flat namespace -- {', '.join(sources)}")

    # The payload as a whole must shrink dramatically — this catches a misconfigured
    # encoder; the per-file bound above only catches one pathological image.
    if plan and after_total > before_total * MIN_SHRINK:
        errors.append(f"payload only shrank to {after_total / before_total:.0%} of source "
                      f"-- expected under {MIN_SHRINK:.0%}; check QUALITY")

    if errors:
        print("VALIDATION FAILED -- nothing written:")
        for e in errors:
            print("   ", e)
        return 1

    # ---- report ---------------------------------------------------------------
    for ref, name, osz, nsz, dims, alpha, had_icc in plan:
        pct = 100 - round(nsz * 100 / osz)
        tag = " (alpha)" if alpha else ""
        print(f"  {name:70} {osz:9,} -> {nsz:8,}  -{pct:2d}%{tag}")

    grew = [(ref, osz, nsz) for ref, _, osz, nsz, *_ in plan if nsz > osz]
    if grew:
        delta = sum(nsz - osz for _, osz, nsz in grew)
        print(f"\n{len(grew)} images are LARGER as WebP -- already-compressed sources, "
              f"see the docstring (+{delta:,} bytes total):")
        for ref, osz, nsz in grew:
            print(f"    {os.path.basename(ref):40} {osz:9,} -> {nsz:8,}  "
                  f"+{(nsz - osz) * 100 / osz:.0f}%")

    alpha_n = sum(1 for p in plan if p[5])
    icc_n = sum(1 for p in plan if p[6])
    print(f"\nimages    : {len(plan)}  ({alpha_n} with real transparency, "
          f"{icc_n} carried an sRGB ICC profile, dropped)")
    print(f"bytes     : {before_total:,} -> {after_total:,}"
          f"  (-{100 - round(after_total * 100 / before_total)}%)")
    print(f"namespace : {len(stems)} distinct blob names, 0 collisions, "
          f"all matching the router regex")

    if args.check:
        print("\n--check: nothing written.")
        return 0

    # ---- phase 2: everything validated, now write -----------------------------
    os.makedirs(args.out, exist_ok=True)
    existing = [f for f in os.listdir(args.out) if not f.startswith(".")]
    if existing:
        return fail(f"--out is not empty ({len(existing)} entries) -- refusing to mix payloads")

    for ref, name, *_ in plan:
        data, _, _, _ = encode(os.path.join(ROOT, "site", ref.lstrip("/").replace("/", os.sep)))
        with open(os.path.join(args.out, name), "wb") as fh:
            fh.write(data)

    written = sorted(f for f in os.listdir(args.out))
    if len(written) != len(plan):
        return fail(f"wrote {len(written)} files but planned {len(plan)}")
    print(f"\nwrote {len(written)} files to {args.out}")
    return 0


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
