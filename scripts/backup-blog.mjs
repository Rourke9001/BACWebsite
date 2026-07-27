#!/usr/bin/env node
/**
 * Back up the `blog` Blob Storage container to a timestamped local directory.
 * Zero dependencies — the Azure CLI supplies a short-lived SAS, everything else
 * is `fetch` and `node:crypto`.
 *
 * The post JSONs are the only data in this system that is not in git. The
 * storage account is Standard_LRS (three copies in one West Europe datacenter),
 * blob soft delete covers 30 days and container deletion is not protected at
 * all — see README.md, Operations → Blog content backup. This script is the
 * only thing standing between a container-level accident and total loss.
 *
 * Backs up every prefix in the container, not just posts/: after the image
 * split, uploads/ holds blog images that exist nowhere else either.
 *
 * Writes:
 *   <out>/<prefix>/<file>   every blob, byte-for-byte
 *   <out>/manifest.json     per-blob size, lastModified, etag and SHA-256
 *
 * The manifest is what makes a restore verifiable rather than hopeful: re-hash
 * the files and compare, and you know the backup is intact before you rely on it.
 *
 * Usage:
 *   node scripts/backup-blog.mjs [--out <dir>] [--prefix <p>] [--verify <dir>]
 *
 *   --out <dir>      destination root (default: ./backups)
 *   --prefix <p>     restrict to one prefix, e.g. posts/ (default: whole container)
 *   --verify <dir>   re-hash an existing backup against its manifest and exit
 *
 * Requires: az CLI, logged in (`az login`) with rights to read the account key.
 * Exit code 0 = backup complete and verified, 1 = something failed.
 */
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execAsync = promisify(exec);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const ACCOUNT = 'bacblogcontent';
const CONTAINER = 'blog';
const RESOURCE_GROUP = 'rg-baclogistics-web';
const SAS_MINUTES = 20;
const CONCURRENCY = 8;

// --- args ----------------------------------------------------------------

function parseArgs(argv) {
  const opts = { out: path.join(ROOT, 'backups'), prefix: '', verify: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--out' || flag === '--prefix' || flag === '--verify') {
      if (value === undefined) fail(`${flag} needs a value`);
      opts[flag.slice(2)] = value;
      i += 1;
    } else {
      fail(`unknown argument: ${flag}`);
    }
  }
  return opts;
}

function fail(msg) {
  console.error(`backup-blog: ${msg}`);
  process.exit(1);
}

// --- azure ---------------------------------------------------------------

/**
 * Mint a read+list SAS for the container. `--auth-mode key` makes the CLI fetch
 * the account key itself; we never print it and never persist it. The token is
 * short-lived by design — this script is run by hand, not on a schedule that
 * needs a long-lived credential.
 */
async function containerSas() {
  const expiry = new Date(Date.now() + SAS_MINUTES * 60_000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Runs through a shell because `az` is a .cmd on Windows and Node refuses to
  // execFile those directly. Every argument here is a module constant or an ISO
  // timestamp we generated — no script argument reaches this string.
  const cmd = `az storage container generate-sas --account-name ${ACCOUNT}`
    + ` --name ${CONTAINER} --permissions rl --expiry ${expiry}`
    + ' --auth-mode key -o tsv';
  try {
    const { stdout } = await execAsync(cmd, { maxBuffer: 1 << 20 });
    const sas = stdout.trim().replace(/^"|"$/g, '');
    if (!sas) throw new Error('empty SAS');
    return sas;
  } catch (err) {
    fail(`could not mint a SAS for ${ACCOUNT}/${CONTAINER}.\n`
      + `  Check: az login, and that you can read keys on ${RESOURCE_GROUP}.\n`
      + `  ${err.stderr || err.message}`);
  }
}

/**
 * List Blobs REST call, following NextMarker. Azure caps a page at 5,000; we
 * are far under that today, but paging is four lines and removes a silent
 * truncation risk from a backup script, which is the wrong place for one.
 */
async function listBlobs(sas, prefix) {
  const blobs = [];
  let marker = '';
  do {
    const url = new URL(`https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}`);
    url.search = sas;
    url.searchParams.set('restype', 'container');
    url.searchParams.set('comp', 'list');
    if (prefix) url.searchParams.set('prefix', prefix);
    if (marker) url.searchParams.set('marker', marker);

    const res = await fetch(url);
    if (!res.ok) fail(`list failed: ${res.status} ${res.statusText}`);
    const xml = await res.text();

    for (const [, block] of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
      blobs.push({
        name: tag(block, 'Name'),
        size: Number(tag(block, 'Content-Length')),
        lastModified: tag(block, 'Last-Modified'),
        etag: tag(block, 'Etag'),
      });
    }
    marker = tag(xml, 'NextMarker');
  } while (marker);
  return blobs.sort((a, b) => a.name.localeCompare(b.name));
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '';

// --- work ----------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

async function downloadBlob(blob, sas, outDir) {
  const url = new URL(`https://${ACCOUNT}.blob.core.windows.net/${CONTAINER}/${blob.name}`);
  url.search = sas;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${blob.name}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length !== blob.size) {
    throw new Error(`${blob.name}: expected ${blob.size} bytes, got ${buf.length}`);
  }

  const dest = path.join(outDir, blob.name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);

  return { ...blob, sha256: createHash('sha256').update(buf).digest('hex') };
}

async function backup(opts) {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
  const outDir = path.resolve(opts.out, `blog-${stamp}`);

  const sas = await containerSas();
  const blobs = await listBlobs(sas, opts.prefix);
  if (blobs.length === 0) fail(`no blobs found${opts.prefix ? ` under ${opts.prefix}` : ''}`);

  const byPrefix = blobs.reduce((acc, b) => {
    const p = b.name.includes('/') ? `${b.name.split('/')[0]}/` : '(root)';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byPrefix).map(([p, n]) => `${n} ${p}`).join(', ');
  console.log(`${blobs.length} blobs (${summary}) → ${outDir}`);

  const entries = await mapLimit(blobs, CONCURRENCY, (b) => downloadBlob(b, sas, outDir));
  const bytes = entries.reduce((n, e) => n + e.size, 0);

  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify({
    account: ACCOUNT,
    container: CONTAINER,
    prefix: opts.prefix || null,
    takenAt: startedAt.toISOString(),
    blobCount: entries.length,
    totalBytes: bytes,
    blobs: entries,
  }, null, 2)}\n`);

  console.log(`✓ ${entries.length} blobs, ${(bytes / 1e6).toFixed(2)} MB, manifest written`);
  console.log(`  verify later:  node scripts/backup-blog.mjs --verify ${path.relative(process.cwd(), outDir)}`);
  return outDir;
}

/** Re-hash a backup against its manifest. A backup nobody checks is a guess. */
async function verify(dir) {
  const root = path.resolve(dir);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  } catch {
    fail(`no readable manifest.json in ${root}`);
  }

  const problems = [];
  await mapLimit(manifest.blobs, CONCURRENCY, async (entry) => {
    const file = path.join(root, entry.name);
    try {
      const buf = await readFile(file);
      if (buf.length !== entry.size) {
        problems.push(`${entry.name}: size ${buf.length} ≠ manifest ${entry.size}`);
        return;
      }
      const sha = createHash('sha256').update(buf).digest('hex');
      if (sha !== entry.sha256) problems.push(`${entry.name}: SHA-256 mismatch`);
    } catch {
      problems.push(`${entry.name}: missing`);
    }
  });

  // A file present on disk but absent from the manifest is also a defect —
  // it means the backup and its record of itself disagree.
  const onDisk = await walk(root);
  const named = new Set(manifest.blobs.map((b) => path.join(root, b.name)));
  for (const file of onDisk) {
    if (file !== path.join(root, 'manifest.json') && !named.has(file)) {
      problems.push(`${path.relative(root, file)}: on disk but not in manifest`);
    }
  }

  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) in ${root}:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`✓ ${manifest.blobs.length} blobs verified against manifest (taken ${manifest.takenAt})`);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

// --- main ----------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
if (opts.verify) {
  await verify(opts.verify);
} else {
  const dir = await backup(opts);
  await verify(dir);
}
