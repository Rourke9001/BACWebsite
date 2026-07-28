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

- **move-static-images.py** — Stage 6b, one-shot. Swept the references after
  `git mv site/couch/uploads/image site/media` retired the CouchCMS-inherited folder.
  No dependencies. Kept as the record of *which* references moved and why the rest didn't.

  ```
  python scripts/move-static-images.py     # run once, after the git mv
  ```

  The repo held 355 `/couch/uploads/` strings in code, config and live docs. 310 pointed
  at one of the 69 files being moved; **45 pointed at nothing on disk and had to survive
  untouched** — 23 redirect *route keys* (the legacy URLs being redirected *from*), 13
  fixtures and comments in `blog-render.test.js` that stand in for what the 90 live posts
  still store in Blob Storage, 4 regexes matching stored blob values, and 5 prose mentions.

  So the discriminator is neither the directory nor the syntax: **an occurrence is rewritten
  if and only if its URL resolves to a file being moved.** Every one of the 45 is then
  excluded by construction rather than by a skip list that could rot. Two cases a
  directory rule gets wrong: `image/blog/news.webp` is a *static* asset inside a `blog/`
  folder and moves, while the 23 redirect *targets* sit in the same file as the 23
  protected route keys and must move — leaving them would turn each 301 into a 404.

  `docs/` and `tasks/` are excluded as dated records; rewriting a URL inside a document
  that reports what was measured on a given day would falsify it.
