#!/usr/bin/env node
/**
 * Backs up the `blog` Blob Storage container — the only production data not in git —
 * to a timestamped local dir + manifest.json. See scripts/README.md for flags and usage.
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

/** Mints a read+list SAS via `--auth-mode key` — the account key itself is never
 * printed or persisted, and the token is deliberately short-lived (hand-run script). */
async function containerSas() {
  const expiry = new Date(Date.now() + SAS_MINUTES * 60_000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Shells out because `az` is a .cmd on Windows and execFile refuses those directly —
  // safe here since every piece of this string is a module constant, never user input.
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

/** List Blobs REST call, following NextMarker — Azure caps a page at 5,000, and a
 * silent truncation risk isn't worth the four lines it takes to avoid it here. */
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
