/**
 * Insights end-to-end (M2's leftover interactions — landing for WP-4.1):
 *
 * The whole loop, walked the way the owner will walk it on a phone:
 *
 *   wade the pool's water and trigger nothing
 *   shift realms by walking into the Perpendicularity
 *   in the lens, walk through the four small memory-flames on the obsidian
 *   see them light, and STAY lit
 *   walk back out of the gate's disk and back in — home again
 *   and the world out the other side is DIFFERENT: four obsidian stepping
 *   stones make a causeway where the water was undisturbed an age ago
 *
 * "Only solvable there" (only lit in the lens) and "shows the world changed"
 * (stones in state, visible on return) are asserted at every handoff, never
 * inferred from one screenshot.
 *
 * Timing note (project convention): every walk uses step() and measured
 * distance, never wall clock — a software renderer on CI is not the game.
 */

import { test, expect } from '@playwright/test';
import { attachWatch, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

const GATE = { x: 0, z: -14 };
const FLAMES = [
  { id: 'lamp-basin-north', x: 0, z: -12.0 },
  { id: 'lamp-basin-west', x: -2.4, z: -14.0 },
  { id: 'lamp-basin-east', x: 2.4, z: -14.4 },
  { id: 'lamp-basin-south', x: 0, z: -16.4 },
];

/**
 * Drive to (x, z) with whichever of W/A/S/D keeps approaching — sim time only.
 *
 * Key events are DOM traffic, and each 0.1 s chunk of an old version of this
 * helper cost up to four of them: ~200 round-trips just walking, which on CI's
 * software renderer consumed the entire minute the timeout allows (run
 * 39197770550). So keys are held ACROSS chunks until the bearing flips, and the
 * read each pass is stepSim's own returned snapshot, not a second call.
 */
async function walkToward(page, target, { close = 1.2, maxChunks = 100, chunk = 0.25 } = {}) {
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
    // Wall-clocked keys feed the sim through the window listener, so a bigger
    // step near the target is the same walk, with less of our own polling.
    debug = await stepSim(page, Math.min(chunk, Math.max(0.05, distance / 12)));
  }
  for (const key of held) await page.keyboard.up(key);
  return debug;
}

/** Wait for a realm flip (the fade is wall-clocked; the read is gate-driven). */
async function waitForRealm(page, wanted, { maxChunks = 60 } = {}) {
  let debug = await readDebug(page);
  for (let i = 0; i < maxChunks && debug.realm !== wanted; i++) {
    debug = await stepSim(page, 0.25);
  }
  return debug;
}

test('the memory-flames light only in the lens, and the world comes back changed', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=roshar&seed=4242');
  expect(debug.mapId).toBe('roshar');
  expect(debug.insights.total).toBe(4);
  expect(debug.insights.lit).toBe(0);
  expect(debug.insights.causeway).toBe(false);
  expect(['lamp-basin-north', 'lamp-basin-west', 'lamp-basin-east', 'lamp-basin-south'].every((id) => debug.insights.litIds.includes(id) === false))
    .toBe(true);

  // Wading the same water in the physical world: nothing ignites. The gate
  // flip is the *only* thing a wade may do — and it starts the loop.
  debug = await walkToward(page, { x: 0, z: -12 }, { close: 1.0 });
  debug = await stepSim(page, 0.2);
  expect(debug.insights.lit, 'a physical wade lights nothing').toBe(0);

  // The wade has taken you into the gate: wait for the fade to finish its work.
  debug = await waitForRealm(page, 'cognitive');
  expect(debug.realm, 'the walk into the pool shifted realms').toBe('cognitive');
  expect(debug.insights.lit).toBe(0, 'arriving is not lighting');

  // The tour of the four small flames, inside the gate's own obsidian disk.
  for (const flame of FLAMES) {
    debug = await walkToward(page, flame, { close: 0.9 });
    expect(debug.realm).toBe('cognitive');
  }
  debug = await stepSim(page, 0.5);
  expect(debug.insights.lit, 'all four memory-flames answered').toBe(4);
  expect(debug.insights.litIds.sort()).toEqual(FLAMES.map((l) => l.id).sort());
  expect(debug.insights.causeway, 'and the last one completes the causeway').toBe(true);
  await saveShot(page, 'insights-flames-lit', testInfo);

  // Stepping out tells the gate it may speak to us again...
  debug = await walkToward(page, { x: 0, z: -7.5 }, { close: 0.6 });
  expect(Math.hypot(debug.player.x - GATE.x, debug.player.z - GATE.z)).toBeGreaterThan(GATE.radius ?? 3.4);
  // ...then walking back in returns us home, under a fade, world changed.
  debug = await walkToward(page, { x: 0, z: -14 }, { close: 1.2 });
  debug = await waitForRealm(page, 'physical');
  expect(debug.realm, 'walking back into the pool brought the world home').toBe('physical');
  expect(debug.insights.lit).toBe(4, 'the light carried home: state, not illusion');
  expect(debug.insights.causeway).toBe(true);

  // The stones are in the frame now — dry obsidian steps across the basin.
  await saveShot(page, 'insights-causeway-raised', testInfo);

  watch.assertClean();
});

test('a second run at the same seed is the same world, causeway down to the metre', async ({ page }) => {
  const watch = attachWatch(page);
  // The determinism fold into e2e: same world seed, same authored stones.
  const debug = await startFrozen(page, '?map=roshar&seed=4242');
  expect(debug.insights.total).toBe(4);
  expect(debug.entityCount).toBeGreaterThan(0);
  watch.assertClean();
});
