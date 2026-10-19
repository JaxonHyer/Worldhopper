/**
 * Hops end-to-end (WP-4.3, stub): stand in a Perpendicularity while inside the
 * Cognitive Realm, and the gate's authored link becomes the one prompt slot.
 *
 * The round trip is what the stub really claims: out through the gate and home
 * again behind two fades. Travel is staged in the lens — arrival lands you at
 * the target pool, still there; dismounting back out is the same step-in dance
 * the realm shift already lets you do, and on a phone it is walking, never a
 * new button.
 *
 * Timing note (project convention): walks are sim time (step()), distances via
 * snapshot. Fades are wall-clocked, so realm/hop waits poll the actual flip.
 */

import { test, expect } from '@playwright/test';
import { attachWatch, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

const GATE = { x: 0, z: -14 };

/** Hold direction keys while stepping sim time, with a hard iteration cap. */
async function walkUntil(page, predicate, { step = 0.25, max = 60, dir = 1 } = {}) {
  const keys = [dir === 1 ? 'KeyW' : 'KeyS'];
  for (const k of keys) await page.keyboard.down(k);
  let debug = await stepSim(page, 0);
  for (let i = 0; i < max && !predicate(debug); i++) {
    debug = await stepSim(page, step);
  }
  for (const k of keys) await page.keyboard.up(k);
  return debug;
}

/** Poll until the snapshot satisfies the predicate (async flip, no stepping). */
async function waitFor(page, predicate, { max = 80 } = {}) {
  let debug = await readDebug(page);
  for (let i = 0; i < max && !predicate(debug); i++) {
    debug = await stepSim(page, 0.2);
  }
  return debug;
}

test('a hop at the Perpendicularity, staged in the lens, takes you to another world — and home', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=roshar&seed=4242');
  expect(debug.mapId).toBe('roshar');
  expect(debug.realm).toBe('physical');
  expect(debug.hops.count).toBe(0);

  // The door is not offered before you are at the gate: walking toward the
  // pool, the hop list stays empty right up to the rim.
  debug = await stepSim(page, 0);
  expect(debug.hops.available).toEqual([]);

  // Walk into the Perpendicularity — the usual fade flips you into the lens.
  await page.keyboard.down('KeyW');
  debug = await waitFor(page, (d) => d.realm === 'cognitive', { max: 40 });
  await page.keyboard.up('KeyW');
  expect(debug.realm).toBe('cognitive');
  expect(Math.hypot(debug.player.x - GATE.x, debug.player.z - GATE.z)).toBeLessThanOrEqual(3.4);

  // The one prompt slot now offers the world hop.
  debug = await stepSim(page, 0);
  expect(debug.hops.available.length).toBe(1);
  expect(debug.hops.available[0].target).toBe('blank-basin');
  expect(debug.hops.atGate).toBe(true);
  const prompt = page.locator('.interact-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt.locator('.interact-prompt__label')).toContainText('Hop to the Quiet Basin');
  await saveShot(page, 'hop-offered', testInfo);

  // Choose it. The white-out covers the scene swap; we land at the new gate.
  if (isMobile) await prompt.tap();
  else await page.keyboard.press('KeyF');
  debug = await waitFor(page, (d) => d.mapId === 'blank-basin', { max: 60 });
  expect(debug.mapId).toBe('blank-basin');
  expect(debug.realm, 'arrival is staged in the lens — you leave in the lens, you arrive in it').toBe('cognitive');
  expect(Math.hypot(debug.player.x - GATE.x, debug.player.z - GATE.z), 'you land at the target gate').toBeLessThanOrEqual(3.4);
  expect(debug.hops.count).toBe(1);
  expect(debug.hops.last).toBe('hop-peaks-basin');
  await saveShot(page, 'hop-arrived-basin', testInfo);

  // The door home opens the same way, and behind it is where you began.
  debug = await waitFor(page, (d) => d.hops.available.length === 1, { max: 30 });
  expect(debug.hops.available[0].target).toBe('roshar');
  await expect(prompt).toBeVisible();
  if (isMobile) await prompt.tap();
  else await page.keyboard.press('KeyF');
  debug = await waitFor(page, (d) => d.mapId === 'roshar', { max: 60 });
  expect(debug.mapId).toBe('roshar');
  expect(debug.realm).toBe('cognitive');
  expect(debug.hops.count).toBe(2);
  expect(debug.hops.last).toBe('hop-basin-peaks');
  await saveShot(page, 'hop-returned-roshar', testInfo);

  watch.assertClean();
});

test('walking out of the arrival gate re-arms the original gate dance, on the new world', async ({ page }) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=roshar&seed=4242');

  // One hop out, in the lens: arrive on the basin standing in its pool.
  await page.keyboard.down('KeyW');
  debug = await waitFor(page, (d) => d.realm === 'cognitive', { max: 40 });
  await page.keyboard.up('KeyW');
  const prompt = page.locator('.interact-prompt');
  await expect(prompt).toBeVisible();
  await page.keyboard.press('KeyF');
  debug = await waitFor(page, (d) => d.mapId === 'blank-basin', { max: 60 });

  // Walk out of the arrival pool — you are simply somewhere new, and its own
  // gate is now the thing it always was: enter it and you shift realms.
  debug = await walkUntil(page, (d) => Math.hypot(d.player.x - GATE.x, d.player.z - GATE.z) > 3.4, { max: 30, dir: -1 });
  expect(Math.hypot(debug.player.x - GATE.x, debug.player.z - GATE.z), 'the walk out really leaves the pool').toBeGreaterThan(3.4);
  expect(debug.realm).toBe('cognitive');
  await walkUntil(page, (d) => Math.hypot(d.player.x - GATE.x, d.player.z - GATE.z) <= 3.4, { max: 30, dir: 1 });
  debug = await waitFor(page, (d) => d.realm !== 'cognitive', { max: 40 });
  expect(debug.realm).toBe('physical', 'stepping back into the basin pool shifts to physical, as anywhere else');
  watch.assertClean();
});
