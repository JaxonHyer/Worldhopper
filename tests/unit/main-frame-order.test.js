/**
 * The frame loop reads after it declares — pinned because it cost a live PR.
 *
 * The 2026-10-19 hop-gate trigger was inserted two lines ABOVE
 * `const transitioning = fade.active;` inside `runFrame`: a temporal-dead-zone
 * that unit tests can never see (nothing here executes the browser frame loop)
 * and CI's headless Chrome caught instantly — every test reporting
 * "Cannot access 'Qe' before initialization" at boot; exactly the trap this
 * project's notes had already recorded twice for the frame loop.
 *
 * Importing src/main.js in Node would let the DOM blow up before the bug is
 * reached, and simulating the frame loop needs the browser. So the guard is
 * the cheap honest one: a source scan validating the one invariant the trap
 * broke — in the runFrame body, declarations come before their own uses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MAIN_JS = path.resolve(path.join(path.dirname(import.meta.url.replace('file://', '')), '../../src/main.js'));

function runFrameBody() {
  const source = fs.readFileSync(MAIN_JS, 'utf8');
  const start = source.indexOf('function runFrame(');
  const end = source.indexOf('function frame(');
  assert.ok(start > 0 && end > start, 'could not locate runFrame() in src/main.js — the guard needs updating');
  return source.slice(start, end);
}

test('in the frame loop, transitioning is declared before any read of it', () => {
  const body = runFrameBody();
  const declared = body.indexOf('const transitioning = fade.active');
  const reads = [...body.matchAll(/(!transitioning|transitioning\s*\|\|)|(\|\|\s*transitioning)/g)]
    .map((match) => match.index)
    .filter((i) => i >= 0)
    .filter((i) => i !== declared);
  assert.ok(declared > 0, '`const transitioning` must exist in the frame loop');
  for (const read of reads) {
    assert.ok(
      read > declared,
      'a read of `transitioning` in the frame loop sits before its declaration (the TDZ trap from the hop-gate foot-gun)',
    );
  }
});

test('in the frame loop, dialogOpen is declared before any read of it', () => {
  const body = runFrameBody();
  const declared = body.indexOf('const dialogOpen = dialog.visible');
  const reads = [...body.matchAll(/(dialogOpen)/g)]
    .map((match) => match.index)
    .filter((i) => i >= 0)
    .filter((i) => i !== declared)
    // the declaration itself also contains the bare identifier later in the line
    .filter((i) => i > declared + 10 || i < declared);
  assert.ok(declared > 0, '`const dialogOpen` must exist in the frame loop');
  for (const read of reads) {
    assert.ok(
      read > declared,
      'a read of `dialogOpen` in the frame loop sits before its declaration (same trap family)',
    );
  }
});
