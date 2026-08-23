#!/usr/bin/env node
/**
 * Regenerates the FAQPage JSON-LD on site/about/index.html from the accordion
 * markup on that same page, so the structured data always matches what a reader
 * sees. Run after editing the FAQ copy; `--check` fails instead of writing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildFaqSchema } = require(path.join(ROOT, 'api/src/lib/faq-schema.js'));

const PAGE = path.join(ROOT, 'site', 'about', 'index.html');
const BLOCK_RE = /<!-- @faq-schema[\s\S]*?<!-- @end:faq-schema -->\n/;
const check = process.argv.includes('--check');

const html = await readFile(PAGE, 'utf8');
const schema = buildFaqSchema(html);
if (!schema) {
  console.error('✗ no FAQ accordion found on site/about/index.html');
  process.exit(1);
}

const block = '<!-- @faq-schema: derived from the accordion below; regenerate with '
  + 'npm run build:faq-schema -->\n<script type="application/ld+json">\n'
  + `${JSON.stringify(schema, null, 2)}\n</script>\n<!-- @end:faq-schema -->\n`;

if (!BLOCK_RE.test(html)) {
  console.error('✗ FAQ schema block markers missing from site/about/index.html');
  process.exit(1);
}

const next = html.replace(BLOCK_RE, block);
if (next === html) {
  console.log(`✓ FAQPage schema matches the accordion (${schema.mainEntity.length} questions)`);
  process.exit(0);
}
if (check) {
  console.error('✗ FAQPage schema is stale — run `npm run build:faq-schema`');
  process.exit(1);
}
await writeFile(PAGE, next);
console.log(`✓ FAQPage schema rewritten (${schema.mainEntity.length} questions)`);
