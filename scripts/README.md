# scripts/

- **build-chrome.mjs** — expands the shared chrome (`partials/` + `data/site.json`) into
  the 39 files that carry it: the 37 static pages in `site/` and the 2 blog templates in
  `api/src/blog-templates/`. Replaces only the regions between `<!-- @chrome:name -->` and
  `<!-- @end:name -->`; every byte outside them is left alone. Zero dependencies.

  ```
  npm run build:chrome                     # expand in place
  npm run check:chrome                     # verify only, non-zero if stale (CI runs this)
  node scripts/build-chrome.mjs --list     # which regions, and how many files use each
  ```

  `--check` fails on a hand-edited generated region, a partial changed without a rebuild,
  an unknown or unused value token, an unbalanced marker, or a retired contact value
  reappearing anywhere in the 39 files. In write mode nothing is written unless every one
  of those passes first.

- **verify-site.mjs** — crawls a deployed copy of the site (staging, a PR preview,
  or production) and checks that every page loads, every same-site reference
  resolves, redirects and the 404 page behave, and the downloadable docs serve
  with the right content-type. Zero dependencies.

  ```
  node scripts/verify-site.mjs [base-url]   # default: https://baclogistics.co.za
  ```

- **backup-blog.mjs** — pulls the whole `blog` Blob Storage container to a timestamped
  local directory and writes a manifest with a SHA-256 per blob, then re-hashes what it
  just wrote. The blog posts are the only production data not in git — see
  [README.md → Operations → Blog content backup](../README.md#blog-content-backup) for
  when to run it and where to keep the output. Zero dependencies; needs `az login`.

  ```
  node scripts/backup-blog.mjs                    # → backups/blog-<timestamp>/
  node scripts/backup-blog.mjs --prefix posts/    # posts only, skip images
  node scripts/backup-blog.mjs --verify <dir>     # re-check an old backup
  ```

  `--verify` exits non-zero on a size mismatch, a hash mismatch, a missing file, or a
  file on disk that the manifest doesn't list. Run it before trusting a backup you're
  about to restore from.

- **reencode-images.py** — the one script here that isn't Node, because image encoding
  needs a real codec. Requires Pillow (`python -m pip install Pillow`). It is a
  maintenance tool, not part of the build or the deploy path.

  ```
  python scripts/reencode-images.py --check   # report, write nothing
  python scripts/reencode-images.py           # do it
  ```

  Two jobs, kept apart because they carry different risk:

  1. **Re-encode to WebP** (*changes the filename*). Static images over 500 KB become
     `.webp` at quality 90, and their references are swept in the same pass.
  2. **Strip embedded metadata** (*keeps the filename*). Every other image is rewritten
     with its metadata removed — losslessly, by dropping container segments, never by
     re-encoding. APP2/`iCCP` colour profiles and APP14 are deliberately **kept**:
     dropping those changes how identical pixels are displayed, which a decoded-pixel
     comparison would not catch.

  **It does not touch blog images, on purpose** — those moved to Blob Storage in Stage 6a
  (see `migrate-blog-images.py` below). The two sets are separated by **reference source,
  not directory**: blog and static images shared folders, so the folder told you nothing.

  Per `tasks/lessons.md`, every encode, reference edit and assertion runs against
  in-memory buffers first; a failing run writes nothing at all.

- **migrate-blog-images.py** — Stage 6a. Produced the WebP payload for the 87 blog images
  that moved from `site/couch/uploads/` into Blob Storage under `uploads/`, served at
  `/blog/media/<file>`. Requires Pillow. Kept because it documents and re-derives the
  migration, and because its assertions are the record of why the render-time map is safe.

  ```
  python scripts/migrate-blog-images.py --check       # report, write nothing
  python scripts/migrate-blog-images.py --out <dir>   # encode into <dir>
  ```

  It derives the image set from post JSON by **reference source** — a blog image is one
  referenced only by `featured_image` / `json_ld` in a post blob — and asserts the two
  invariants that let `render.js` map paths with a single rule instead of a lookup table:
  every basename is unique, and none collides once the extension becomes `.webp`.

  It encodes and uploads nothing to Azure itself. Uploading is a separate deliberate step:

  ```
  az storage blob upload-batch --account-name bacblogcontent --destination blog \
     --destination-path uploads --source <dir> --content-type image/webp \
     --auth-mode key --overwrite false
  ```

  `--auth-mode login` is denied on this account — no data-plane RBAC is assigned, so the
  CLI must fall back to the account key.
