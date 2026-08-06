#!/usr/bin/env python3
"""Re-encodes oversized static images to WebP and strips metadata from the rest — kept as
two separate jobs since they carry different risk. See scripts/README.md for the full
breakdown, why blog images are excluded, and the validate-before-write discipline.

    python scripts/reencode-images.py --check     # report, write nothing
    python scripts/reencode-images.py             # do it
"""

import argparse
import io
import os
import re
import subprocess
import sys

try:
    from PIL import Image, ImageCms
except ImportError:
    sys.exit("Pillow is required:  python -m pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_ROOT = os.path.join("site", "couch", "uploads")
SEARCH_DIRS = ["site", "api"]
SIZE_THRESHOLD = 500 * 1024
QUALITY = 90
ALLOWED_ICC = "sRGB IEC61966-2.1"
REF_RE = re.compile(r"/couch/uploads/[A-Za-z0-9._/-]*")
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def run(*args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True).stdout


def tracked_text_files():
    """Repo HTML/CSS/JS that could carry an image reference."""
    out = run("git", "ls-files", "--", *SEARCH_DIRS)
    return [f for f in out.splitlines() if f.endswith((".html", ".css", ".js", ".json", ".xml"))]


def collect():
    """Derive both image sets from reference source, not directory — a blog and a
    static image can share a folder, so only who points at them tells them apart."""
    referenced = set()
    for f in tracked_text_files():
        with open(os.path.join(ROOT, f), "rb") as fh:
            for m in REF_RE.finditer(fh.read().decode("utf-8", "replace")):
                referenced.add(m.group(0))

    on_disk = []
    for dirpath, _, names in os.walk(os.path.join(ROOT, IMAGE_ROOT)):
        for n in names:
            if n.lower().endswith(IMAGE_EXTS):
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                on_disk.append((rel, "/" + rel[len("site/"):], os.path.getsize(full)))

    static, blog = [], []
    for rel, url, size in sorted(on_disk):
        (static if url in referenced else blog).append((rel, url, size))
    dangling = sorted(r for r in referenced if r not in {u for _, u, _ in on_disk})
    return static, blog, dangling


def strip_metadata(data, ext):
    """Removes embedded metadata without touching pixels, JPEG/PNG segment-by-segment.
    Deliberately keeps colour-profile segments (APP2/APP14/iCCP); see scripts/README.md for why."""
    if ext in (".jpg", ".jpeg"):
        if data[:2] != b"\xff\xd8":
            return data
        out, i = bytearray(data[:2]), 2
        while i < len(data) - 1:
            if data[i] != 0xFF:
                break
            marker = data[i + 1]
            if marker == 0xD8 or 0xD0 <= marker <= 0xD7 or marker == 0x01:
                out += data[i:i + 2]
                i += 2
                continue
            if marker == 0xDA:                       # start of scan -> rest is entropy data
                out += data[i:]
                break
            seglen = int.from_bytes(data[i + 2:i + 4], "big")
            drop = marker in (0xE1, 0xED, 0xFE)   # APP1, APP13, COM
            if not drop:
                out += data[i:i + 2 + seglen]
            i += 2 + seglen
        return bytes(out)

    if ext == ".png":
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            return data
        drop = {b"tEXt", b"zTXt", b"iTXt", b"tIME", b"eXIf"}
        out, i = bytearray(data[:8]), 8
        while i < len(data):
            length = int.from_bytes(data[i:i + 4], "big")
            ctype = data[i + 4:i + 8]
            nxt = i + 12 + length
            if ctype not in drop:
                out += data[i:nxt]
            if ctype == b"IEND":
                break
            i = nxt
        return bytes(out)

    return data


def icc_description(profile):
    try:
        return ImageCms.getProfileDescription(
            ImageCms.ImageCmsProfile(io.BytesIO(profile))).strip()
    except Exception:
        return "unreadable"


def encode_webp(path):
    """Re-encodes to WebP; returns the ICC description so the caller can guard it — Pillow
    drops icc_profile silently on save, safe only because this repo is all-sRGB. See
    scripts/README.md for why that doesn't generalise and why the caller refuses non-sRGB."""
    im = Image.open(path)
    profile = im.info.get("icc_profile")
    uses_alpha = (im.mode in ("RGBA", "LA", "PA")
                  and im.convert("RGBA").getchannel("A").getextrema()[0] < 255)
    src = im.convert("RGBA") if uses_alpha else im.convert("RGB")
    buf = io.BytesIO()
    src.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue(), src.size, uses_alpha, icc_description(profile) if profile else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    static, blog, dangling = collect()
    big = [s for s in static if s[2] > SIZE_THRESHOLD]

    print(f"static images (referenced by repo HTML): {len(static)}")
    print(f"blog images   (referenced by blob JSON): {len(blog)}  -- not re-encoded, see docstring")
    if dangling:
        print(f"references resolving to no file: {len(dangling)}  {', '.join(dangling)}")
    print(f"over {SIZE_THRESHOLD // 1024} KB and re-encodable: {len(big)}\n")

    # ---- phase 1: build the whole plan in memory ---------------------------
    renames, edits, errors = [], {}, []
    saved_before = saved_after = 0

    for rel, url, size in big:
        data, dims, alpha, icc = encode_webp(os.path.join(ROOT, rel))
        if icc and icc != ALLOWED_ICC:
            errors.append(f"{rel}: ICC profile is {icc!r}, not {ALLOWED_ICC!r} -- "
                          f"re-encoding would drop it and shift colour; see encode_webp()")
        new_rel = os.path.splitext(rel)[0] + ".webp"
        new_url = os.path.splitext(url)[0] + ".webp"
        if os.path.exists(os.path.join(ROOT, new_rel)):
            errors.append(f"target already exists: {new_rel}")
        # re-decode what we are about to write; never trust the encoder blindly
        check = Image.open(io.BytesIO(data))
        if check.size != dims:
            errors.append(f"{rel}: encoded dimensions {check.size} != source {dims}")
        if len(data) >= size:
            errors.append(f"{rel}: WebP is not smaller ({len(data):,} >= {size:,})")
        renames.append((rel, new_rel, url, new_url, size, len(data), alpha))
        saved_before += size
        saved_after += len(data)

    url_map = {old: new for _, _, old, new, _, _, _ in renames}

    for f in tracked_text_files():
        p = os.path.join(ROOT, f)
        with open(p, "rb") as fh:
            raw = fh.read()
        text = raw.decode("utf-8")
        new = REF_RE.sub(lambda m: url_map.get(m.group(0), m.group(0)), text)
        if new != text:
            hits = sum(text.count(o) for o in url_map)
            edits[f] = (raw, new.encode("utf-8"), hits)

    # metadata strip for everything not being re-encoded (filename preserved)
    strips = []
    for rel, _, _ in static + blog:
        if any(rel == old for old, *_ in renames):
            continue
        p = os.path.join(ROOT, rel)
        with open(p, "rb") as fh:
            raw = fh.read()
        out = strip_metadata(raw, os.path.splitext(rel)[1].lower())
        if len(out) < len(raw):
            before = Image.open(io.BytesIO(raw))
            after = Image.open(io.BytesIO(out))
            if before.tobytes() != after.tobytes():
                errors.append(f"{rel}: metadata strip altered pixels -- refusing")
            elif before.info.get("icc_profile") != after.info.get("icc_profile"):
                errors.append(f"{rel}: metadata strip dropped the ICC colour profile -- refusing")
            elif before.size != after.size or before.mode != after.mode:
                errors.append(f"{rel}: metadata strip changed size/mode -- refusing")
            else:
                strips.append((rel, raw, out))

    if errors:
        print("VALIDATION FAILED -- nothing written:")
        for e in errors:
            print("   ", e)
        return 1

    # ---- report ------------------------------------------------------------
    for old, new, ourl, nurl, osz, nsz, alpha in renames:
        pct = 100 - round(nsz * 100 / osz)
        tag = " (alpha)" if alpha else ""
        print(f"  {os.path.basename(old):58} {osz:9,} -> {nsz:8,}  -{pct:2d}%{tag}")

    ref_total = sum(h for _, _, h in edits.values())
    strip_bytes = sum(len(a) - len(b) for _, a, b in strips)
    # Re-running after Stage 4 finds nothing over the threshold, which is the healthy
    # steady state — not a reason to crash on a percentage of zero.
    pct = f"  (-{100 - round(saved_after * 100 / saved_before)}%)" if saved_before else ""
    print(f"\nre-encode : {len(renames)} files, {saved_before:,} -> {saved_after:,} bytes{pct}")
    print(f"references: {ref_total} occurrences across {len(edits)} files")
    print(f"metadata  : {len(strips)} files stripped losslessly, {strip_bytes:,} bytes removed")

    if args.check:
        print("\n--check: nothing written.")
        return 0

    # ---- phase 2: everything validated, now write --------------------------
    for old, new, *_ in renames:
        data, _, _, _ = encode_webp(os.path.join(ROOT, old))
        with open(os.path.join(ROOT, new), "wb") as fh:
            fh.write(data)
        os.remove(os.path.join(ROOT, old))
    for f, (_, new_bytes, _) in edits.items():
        with open(os.path.join(ROOT, f), "wb") as fh:
            fh.write(new_bytes)
    for rel, _, out in strips:
        with open(os.path.join(ROOT, rel), "wb") as fh:
            fh.write(out)

    print(f"\nwrote {len(renames)} images, {len(edits)} text files, {len(strips)} stripped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
