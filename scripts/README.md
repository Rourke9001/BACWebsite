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
