/**
 * The veil and the waylights (owner, 2026-10-19) — two clarifications, proven
 * where they live:
 *
 *  1. "make a path between the two Perpendicularilities in the Cognitive
 *      Realm, a visually recognizable path" — the lens shows a laid chain from
 *      the pool's ring to the second gate's ring.
 *  2. "enemies cannot see the player while the player is in the Cognitive
 *      Realm" — a hunting enemy loses your trail the moment you step through.
 *
 * Information in the snapshot is the assertion; screenshots are for the owner.
 */

import { test, expect } from '@playwright/test';
import { attachWatch, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

const RENDEZVOUS = { x: -28, z: -6 };

async function walkToward(page, target, { close = 1.4, maxChunks = 120, chunk = 0.2 } = {}) {
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

async function waitFor(page, predicate, { max = 60 } = {}) {
  let debug = await readDebug(page);
  for (let i = 0; i < max && !predicate(debug); i++) {
    debug = await stepSim(page, 0.2);
  }
  return debug;
}

test('the lens shows a laid trail from the pool to the second gate, pebble by pebble', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=roshar&seed=4242');
  expect(debug.hops.count).toBe(0);

  await page.keyboard.down('KeyW');
  debug = await waitFor(page, (d) => d.realm === 'cognitive', { max: 40 });
  await page.keyboard.up('KeyW');
  expect(debug.realm).toBe('cognitive');
  expect(debug.skin.hopGates).toBe(1);
  expect(debug.skin.waylights, 'a laid chain, not a smear').toBeGreaterThan(5);

  // Walk the marker line west and catch the fire: exactly one hop.
  debug = await walkToward(page, RENDEZVOUS, { close: 1.4 });
  await saveShot(page, 'waylight-trail-the-walk', testInfo);
  debug = await waitFor(page, (d) => d.mapId === 'blank-basin', { max: 60 });
  expect(debug.mapId).toBe('blank-basin');
  expect(debug.hops.count).toBe(1);

  watch.assertClean();
});

test('a hunting enemy loses your trail the moment you step through the veil', async ({ page }, testInfo) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=blank-basin&seed=4242&aggro=40&enemies=1');
  expect(debug.combat.enemies).toBe(1);
  expect(debug.combat.roster[0].state).toBe('idle');

  // On this side of the veil it does what enemies do: it comes.
  let engaged = false;
  for (let i = 0; i < 40 && !engaged; i++) {
    debug = await stepSim(page, 0.25);
    engaged = ['alert', 'hunt', 'attack'].includes(debug.combat.roster[0].state);
  }
  expect(engaged, 'it engaged you first, so a later loss of trail is a real loss').toBe(true);

  // Realm switches through the veil (test convenience — the harness uses the debug
  // hook, not a control) and the world watches the trail die.
  await page.evaluate(() => window.__worldhopper.realm('cognitive'));
  debug = await waitFor(page, (d) => d.realm === 'cognitive', { max: 20 });
  expect(debug.realm).toBe('cognitive');
  debug = await stepSim(page, 3);
  expect(
    ['disengage', 'idle'].includes(debug.combat.roster[0].state),
    `the trail died (${debug.combat.roster[0].state})`,
  ).toBe(true);
  await saveShot(page, 'veil-lost-trail', testInfo);

  // Walking with it in the lens: it does not re-acquire you, and nothing hits.
  const hitsAtFlip = debug.combat.hitsTaken;
  debug = await walkToward(page, { x: -10, z: 6 }, { close: 2 });
  expect(debug.combat.hitsTaken, 'nothing struck across the veil').toBe(hitsAtFlip);
  expect(debug.combat.roster[0].state).not.toBe('attack');

  watch.assertClean();
});
