# scripts/

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
