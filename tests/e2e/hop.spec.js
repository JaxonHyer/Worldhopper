/**
 * Hops end-to-end (WP-4.3, corrected): a worldhop is two Perpendicularities.
 *
 *  - Into Roshar's pool (a plain realm swap — the gate is only ever that).
 *  - In the Cognitive Realm, WALK to a different, second gate standing on the
 *    plane (there are two droughts of light now; the menu is your feet).
 *  - Step into it: come OUT on another planet — physical side, at its pool.
 *  - The way home re-uses the same two gates in reverse. A stub door must
 *    close behind you and still be a door on the other side.
 *
 * Everything is sim time (step()) and the snapshot's truth; the screenshots
 * are evidence, never the assertion.
 */

import { test, expect } from '@playwright/test';
import { attachWatch, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

const HOME = { x: 0, z: -14 };
const ROSHAR_RENDEZVOUS = { x: -28, z: -6 };
const BASIN_RENDEZVOUS = { x: -26, z: -10 };

/** Hold keys toward a point one returned-snapshot per chunk, capped. */
async function walkToward(page, target, { close = 1.2, maxChunks = 120, chunk = 0.2 } = {}) {
  const held = new Set();
  const toggle = async (key, on) => {
    if (on && !held.has(key)) {
      await page.keyboard.down(key);
      held.add(key);
    } else if (!on && held.has(key)) {
      await page.keyboard.up(key);
      held.delete(key);
    }
  };
  let debug = await stepSim(page, 0);
  for (let i = 0; i < maxChunks; i++) {
    const dx = target.x - debug.player.x;
    const dz = target.z - debug.player.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= close) break;
    await toggle('KeyW', dz < -0.25);
    await toggle('KeyS', dz > 0.25);
    await toggle('KeyD', dx > 0.25);
    await toggle('KeyA', dx < -0.25);
    debug = await stepSim(page, Math.min(chunk, Math.max(0.05, distance / 12)));
  }
  for (const key of held) await page.keyboard.up(key);
  return debug;
}

/** Poll until the snapshot satisfies the predicate (fade-driven flips). */
async function waitFor(page, predicate, { max = 60 } = {}) {
  let debug = await readDebug(page);
  for (let i = 0; i < max && !predicate(debug); i++) {
    debug = await stepSim(page, 0.2);
  }
  return debug;
}

test('worldhop: into your own gate, walk to a different one on the plane, come out on another planet', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=roshar&seed=4242');
  expect(debug.mapId).toBe('roshar');
  expect(debug.realm).toBe('physical');
  expect(debug.hops.count).toBe(0);

  // 1. Into your own Perpendicularity. It does exactly and only a realm swap.
  await page.keyboard.down('KeyW');
  debug = await waitFor(page, (d) => d.realm === 'cognitive', { max: 40 });
  await page.keyboard.up('KeyW');
  expect(debug.realm).toBe('cognitive');
  expect(debug.mapId).toBe('roshar', 'the gate swapped realms, not worlds');
  expect(debug.hops.insideGate, 'your own pool is not a hop gate').toBe(null);
  expect(debug.hops.nearestGate?.id, 'a second gate is out there, at walking distance').toBe('hop-to-basin');
  await saveShot(page, 'hop-two-gates-in-lens', testInfo);

  // 2. Walk to it. The flat Cognitive plane, one comet-tail of light ahead.
  debug = await walkToward(page, ROSHAR_RENDEZVOUS, { close: 1.2 });
  debug = await waitFor(page, (d) => d.hops.insideGate !== null, { max: 20 });
  expect(debug.hops.insideGate.target).toBe('blank-basin');
  await saveShot(page, 'hop-at-the-second-gate', testInfo);

  // Standing in it: the fire is contact, not consent. Wait for the swap home.
  debug = await waitFor(page, (d) => d.mapId === 'blank-basin', { max: 60 });
  expect(debug.mapId).toBe('blank-basin');
  expect(debug.realm, 'you come OUT on another planet — physical side, always').toBe('physical');
  expect(Math.hypot(debug.player.x, debug.player.z - HOME.z), 'at the other world’s pool').toBeLessThanOrEqual(3.5);
  expect(debug.hops.count).toBe(1);
  expect(debug.hops.last).toBe('hop-to-basin');
  await saveShot(page, 'hop-come-out-on-the-basin', testInfo);

  // 3. Home again, the same two gates played in reverse.
  await stepSim(page, 0.1);
  debug = await walkToward(page, { x: 0, z: -20 }, { close: 0.6 }); // out of the water
  debug = await walkToward(page, { x: 0, z: -14 }, { close: 0.8 }); // back in: realm swap, basin side
  debug = await waitFor(page, (d) => d.realm === 'cognitive', { max: 40 });
  expect(debug.realm).toBe('cognitive');
  expect(debug.mapId).toBe('blank-basin');
  expect(debug.hops.nearestGate?.id).toBe('hop-to-roshar');

  debug = await walkToward(page, BASIN_RENDEZVOUS, { close: 1.2 });
  debug = await waitFor(page, (d) => d.mapId === 'roshar', { max: 60 });
  expect(debug.mapId).toBe('roshar');
  expect(debug.realm).toBe('physical');
  expect(debug.hops.count).toBe(2);
  expect(debug.hops.last).toBe('hop-to-roshar');
  await saveShot(page, 'hop-back-on-roshar', testInfo);

  watch.assertClean();
});

test('a second Perpendicularity is drawn for the player to walk toward, only on the far side', async ({ page }, testInfo) => {
  const watch = attachWatch(page);
  await startFrozen(page, '?map=roshar&seed=4242&realm=cognitive');
  // A boot flag start in the lens is a test convenience, not a travel mode:
  // the beads, two wells of light, and exactly the spotless plane the owner
  // described — "the cognitive realm is 2d and does not include outer space".
  const debug = await stepSim(page, 0.1);
  expect(debug.realm).toBe('cognitive');
  expect(debug.skin.hopGates, 'a rendezvous is drawn on the plane').toBeGreaterThanOrEqual(1);
  expect(debug.skin.beads).toBeGreaterThan(1000);
  watch.assertClean();
});
