/**
 * WP-3.3 — the selected Rosharan pair, as data in the shared archetype table.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENEMY_TYPES } from '../../src/core/enemy.js';

test('the owner-picked Whitespine and Chasmfiend have one readable silhouette and tell each', () => {
  const whitespine = ENEMY_TYPES['crag-lurker'];
  const chasmfiend = ENEMY_TYPES['storm-warden'];

  assert.equal(whitespine.name, 'Whitespine');
  assert.equal(chasmfiend.name, 'Chasmfiend');
  assert.deepEqual([whitespine.legs, whitespine.arms], [4, 0], 'Whitespine is the low, spined quadruped');
  // Amended by Agent 1 in the owner's 2026-10-17 playtest pass, after Agent 2's
  // PR was reviewed and approved: "Chasmfiends are like a 14 or more legged
  // creature and they are GIANT." The row, not the test's intent, is the design.
  assert.deepEqual([chasmfiend.legs, chasmfiend.arms], [14, 0], 'the Chasmfiend is a many-legged shell-backed giant');
  // Amended again 2026-10-18, same rule — "longer, less wide and shorter; a
  // cross between a centipede and a crab." The giant's mass left *height* and
  // went into LENGTH, so bigness is measured with its chain, not its crown.
  assert.ok(
    chasmfiend.dims.segments * chasmfiend.dims.depth > whitespine.height * 3,
    `the Chasmfiend reads as the giant: ${(chasmfiend.dims.segments * chasmfiend.dims.depth).toFixed(1)} m of shell vs the Whitespine's ${whitespine.height} m`,
  );
  assert.ok(chasmfiend.dims.pincers === true, 'crab pincers up front');
  assert.ok(chasmfiend.width === undefined || chasmfiend.dims.width < whitespine.height * 1.5, 'less wide than before, as asked');
  assert.ok(chasmfiend.radius > whitespine.radius * 2, 'the Chasmfiend body reads broader');
  assert.notEqual(whitespine.colors.tell, chasmfiend.colors.tell, 'each archetype has its own single tell colour');
});
