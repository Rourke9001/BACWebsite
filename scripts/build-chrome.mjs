#!/usr/bin/env node
/**
 * Expands partials/*.html + data/site.json into every file carrying <!-- @chrome:name -->
 * markers. See scripts/README.md for the mechanism, usage, and what --check catches.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARTIALS = path.join(ROOT, 'partials');
const DATA = path.join(ROOT, 'data', 'site.json');

const OPEN = (name) => `<!-- @chrome:${name} -->`;
const CLOSE = (name) => `<!-- @end:${name} -->`;
const MARKER_RE = /^[ \t]*<!-- @chrome:([a-z0-9-]+) -->[ \t]*$/;

/** Retired contact values that must not survive anywhere in output — catches page-body
 * copies a marker-keyed expander would otherwise miss. See docs/shared-header-duplication.md. */
const RETIRED = [
  '+27 83 375 5906', '+27833755906', 'wa.me/+27833755906', 'tel:0833755906',
  '+27 11 353 1111', '+27113531111', 'wa.me/+27113531111',
  'linkedin.com/company/broughton-amiss-consulting',
];

async function loadInputs() {
  const site = JSON.parse(await readFile(DATA, 'utf8'));
  const partials = new Map();
  for (const entry of await readdir(PARTIALS)) {
    if (!entry.endsWith('.html')) continue;
    partials.set(entry.replace(/\.html$/, ''), await readFile(path.join(PARTIALS, entry), 'utf8'));
  }
  return { site, partials };
}

/** Substitute ${name} from site.json. Unknown token = hard error, never a silent blank. */
function expand(body, site, name) {
  const missing = new Set();
  const out = body.replace(/\$\{([a-z0-9_]+)\}/g, (_, key) => {
    if (!(key in site)) { missing.add(key); return ''; }
    return site[key];
  });
  if (missing.size) {
    throw new Error(`partials/${name}.html references unknown value(s): ${[...missing].join(', ')}\n`
      + `  add them to data/site.json`);
  }
  return out;
}

/** Files are LF today; detect anyway so a CRLF checkout round-trips unchanged. */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

function applyTo(text, partials, site, file) {
  const eol = eolOf(text);
  const lines = text.split(/(?<=\n)/);
  const out = [];
  const used = [];

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].replace(/\r?\n$/, '').match(MARKER_RE);
    if (!m) { out.push(lines[i]); continue; }

    const name = m[1];
    if (!partials.has(name)) {
      throw new Error(`${file}:${i + 1} marks region "${name}" but partials/${name}.html does not exist`);
    }
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === CLOSE(name)) { end = j; break; }
      if (MARKER_RE.test(lines[j].replace(/\r?\n$/, ''))) {
        throw new Error(`${file}:${j + 1} opens a region while "${name}" is still open`);
      }
    }
    if (end === -1) throw new Error(`${file}:${i + 1} region "${name}" is never closed`);

    let body = expand(partials.get(name), site, name);
    if (eol === '\r\n') body = body.replace(/\r?\n/g, '\r\n');

    out.push(lines[i], body, lines[end]);
    used.push(name);
    i = end;
  }

  return { text: out.join(''), used };
}

async function targets() {
  const { execSync } = await import('node:child_process');
  const tracked = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const found = [];
  for (const f of tracked) {
    const text = await readFile(path.join(ROOT, f), 'utf8');
    if (text.includes('<!-- @chrome:')) found.push({ file: f, text });
  }
  return found;
}

async function main() {
  const check = process.argv.includes('--check');
  const list = process.argv.includes('--list');
  const { site, partials } = await loadInputs();
  const files = await targets();

  if (files.length === 0) throw new Error('no files carry chrome markers — nothing to do');

  const usage = new Map([...partials.keys()].map((n) => [n, 0]));
  const stale = [];
  const pending = [];

  // Expand and validate everything before writing anything. A retired value or a
  // bad token must stop the run, not get written to 39 files and reported after.
  for (const { file, text } of files) {
    const { text: next, used } = applyTo(text, partials, site, file);
    for (const n of used) usage.set(n, usage.get(n) + 1);

    for (const bad of RETIRED) {
      if (next.includes(bad)) stale.push(`${file}: contains retired value ${JSON.stringify(bad)}`);
    }
    if (next === text) continue;
    if (check) stale.push(`${file}: out of date — regenerate with \`node scripts/build-chrome.mjs\``);
    else pending.push({ file, next });
  }

  const unused = [...usage].filter(([, n]) => n === 0).map(([n]) => n);
  if (unused.length) stale.push(`unused partial(s): ${unused.join(', ')} — no file marks them`);

  if (list) {
    console.log(`${files.length} files carry chrome markers\n`);
    for (const [name, n] of usage) console.log(`  ${name.padEnd(20)} ${String(n).padStart(3)} files`);
    return;
  }

  if (stale.length) {
    console.error(`✗ ${stale.length} problem(s)${check ? '' : ' — nothing written'}:`);
    for (const s of stale.slice(0, 10)) console.error(`  ${s}`);
    if (stale.length > 10) console.error(`  … and ${stale.length - 10} more`);
    process.exit(1);
  }

  for (const { file, next } of pending) await writeFile(path.join(ROOT, file), next);

  console.log(check
    ? `✓ ${files.length} files match partials/ + data/site.json`
    : `✓ ${files.length} files checked, ${pending.length} rewritten`);
}

// Errors here are operator errors (bad value, unbalanced marker) that deserve a
// message, not a stack trace — a real bug still surfaces via --trace.
try {
  await main();
} catch (err) {
  if (process.argv.includes('--trace')) throw err;
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
