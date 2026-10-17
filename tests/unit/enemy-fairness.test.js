/**
 * WP-3.5 — the two fairness assertions missing from Agent 1's framework.
 *
 * These tests belong in their own file: the existing enemy/combat tests are
 * Agent 1's evidence and are intentionally not edited here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState } from '../../src/core/world-state.js';
import { defaultSettings } from '../../src/core/settings.js';
import { getMap } from '../../src/core/maps/index.js';

const map = getMap('roshar');
const settings = defaultSettings();

function angularDistance(a, b) {
  let delta = Math.abs(a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return delta;
}

test('seeded Roshar spawn bearings tend to land outside the player’s view cone', () => {
  // The headless metric treats the configured FOV as the full yaw-plane cone.
  // It measures initial encounter bearings only; it does not claim that the
  // current spawner actively steers enemies using FOV or line of sight.
  const halfViewCone = (settings.fov * Math.PI) / 360;
  let outside = 0;
  let total = 0;

  // Multiple fixed headings keep the measurement tied to player yaw rather than
  // to one convenient direction. Every world and every spawn is seed-derived.
  for (let seed = 1; seed <= 1024; seed++) {
    const state = createWorldState({ map, seed, settings });
    state.player.yaw = ((seed % 32) / 32) * Math.PI * 2;

    for (const enemy of state.enemies) {
      const dx = enemy.position.x - state.player.position.x;
      const dz = enemy.position.z - state.player.position.z;
      // Player yaw 0 faces -Z, matching the camera/player convention.
      const bearing = Math.atan2(dx, -dz);
      const separation = angularDistance(bearing, state.player.yaw);
      if (separation > halfViewCone) outside++;
      total++;
    }
  }

  assert.equal(total, 1024 * map.enemyPolicy.initial, 'the sample includes each seeded opening encounter');
  const outsideRatio = outside / total;
  assert.ok(
    outsideRatio >= 0.7,
    `${outside}/${total} (${(outsideRatio * 100).toFixed(1)}%) initial bearings were outside the configured view cone; expected at least 70%`,
  );
});
