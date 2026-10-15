#!/usr/bin/env node
/**
 * Static assertions on the built output — the GitHub Pages constraints from
 * AGENT_PROMPT.md §3, checked without a browser:
 *   - `.nojekyll` present (Pages must not run Jekyll)
 *   - relative asset paths only (one build works at the root, in a subfolder
 *     and on Pages)
 *   - every referenced local file exists
 *   - no external URLs (no CDNs, fonts, analytics)
 *   - a size budget, so a fat dependency cannot slip in unnoticed
 */

import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const SIZE_BUDGET_BYTES = 4 * 1024 * 1024;

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

// --- required files -------------------------------------------------------
check(fs.existsSync(path.join(DIST, '.nojekyll')), 'dist/.nojekyll is missing (GitHub Pages needs it)');
check(fs.existsSync(path.join(DIST, 'index.html')), 'dist/index.html is missing');

const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

// --- no absolute or external references ----------------------------------
const attrPattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
const referenced = [];
for (const match of indexHtml.matchAll(attrPattern)) referenced.push(match[1]);
check(referenced.length > 0, 'index.html references no assets at all — did the build run?');

for (const url of referenced) {
  if (/^(https?:)?\/\//i.test(url) || /^[a-z]+:\/\//i.test(url)) {
    fail(`index.html references an external URL: ${url}`);
    continue;
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    fail(`index.html uses an absolute path (breaks subfolder hosting): ${url}`);
    continue;
  }
  if (url.startsWith('#') || url.startsWith('data:')) continue;
  const clean = url.split('?')[0].split('#')[0];
  const target = path.join(DIST, clean.replace(/^\.\//, ''));
  check(fs.existsSync(target), `index.html references a missing file: ${url}`);
}

// Inline scripts must not reach out either.
check(!/https?:\/\/(?!github\.com)/i.test(indexHtml.replace(/<!--[\s\S]*?-->/g, '')), 'index.html contains an external http(s) URL');

// --- size budget ---------------------------------------------------------
function walk(dir) {
  let total = 0;
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = walk(full);
      total += nested.total;
      files.push(...nested.files);
    } else {
      const size = fs.statSync(full).size;
      total += size;
      files.push({ file: path.relative(DIST, full), size });
    }
  }
  return { total, files };
}

const { total, files } = walk(DIST);
const biggest = files.sort((a, b) => b.size - a.size).slice(0, 5);
notes.push(`dist: ${files.length} files, ${(total / 1024).toFixed(0)} KB`);
notes.push(`largest: ${biggest.map((f) => `${f.file} ${(f.size / 1024).toFixed(0)}KB`).join(', ')}`);
check(total <= SIZE_BUDGET_BYTES, `dist is ${(total / 1024 / 1024).toFixed(2)} MB, over the ${SIZE_BUDGET_BYTES / 1024 / 1024} MB budget`);

for (const note of notes) console.log(`  ${note}`);

if (failures.length > 0) {
  console.error('\ndist checks failed:');
  for (const message of failures) console.error(`  ✗ ${message}`);
  process.exit(1);
}
console.log('dist checks passed (nojekyll, relative paths, no external URLs, size budget)');
