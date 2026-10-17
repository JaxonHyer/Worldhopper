/**
 * NPC dialog end-to-end tests (WP-3.4).
 *
 * Two people: the wanderer on the test range (blank-basin) and Kurin on
 * Roshar. Both maps are *named* here, because the game opens on Roshar — a
 * test that means the test range has to say so, or it hunts for a wanderer on
 * the wrong world the day the default moves.
 *
 * Every walk is measured in **distance**, not seconds. The owner's walk speed
 * is 7.9 m/s, so a 1.6 s walk covers 12.6 m — past the 10.6 m pool edge, into
 * the gate, and out of the physical realm where the prompt is suppressed by
 * design. Distance is sim state and identical on every machine. The sim is
 * driven with step() so wall-clock frame rate cannot race the assertions.
 */

import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, pauseSim, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

/** Walk (holding `keys`) until the player is within `radius` of `target`. */
async function walkToward(page, keys, target, { radius = 2.5, step = 0.05, maxSteps = 80 } = {}) {
  for (const key of keys) await page.keyboard.down(key);
  let snap = await readDebug(page);
  for (let i = 0; i < maxSteps; i++) {
    const distance = Math.hypot(snap.player.x - target.x, snap.player.z - target.z);
    if (distance <= radius) break;
    snap = await stepSim(page, step);
  }
  for (const key of keys) await page.keyboard.up(key);
  return snap;
}

/**
 * Which thumb controls the Talk prompt covers, as boxes. The owner plays on a
 * phone: a prompt sitting on the jump button is a real bug, not a detail.
 */
async function promptOverlapsControls(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlaps = (a, b) =>
      Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
    const prompt = box('.interact-prompt');
    const jump = box('.touch-jump');
    const sprint = box('.touch-sprint');
    return {
      hasJump: Boolean(jump),
      hasSprint: Boolean(sprint),
      jump: overlaps(prompt, jump),
      sprint: overlaps(prompt, sprint),
    };
  });
}

test('the wanderer stands by spawn and opens a dialog', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?map=blank-basin&seed=4242');
  expect(debug.mapId).toBe('blank-basin');
  expect(debug.dialog.open).toBe(false);

  // The wanderer is at (4.5, -8) — forward and to the right, which is W + D.
  debug = await walkToward(page, ['KeyW', 'KeyD'], { x: 4.5, z: -8 });
  expect(debug.realm, 'the walk must stop short of the pool').toBe('physical');
  expect(Math.hypot(debug.player.x - 4.5, debug.player.z + 8), 'inside the 3 m talk radius').toBeLessThanOrEqual(2.6);

  const prompt = page.locator('.interact-prompt');
  await expect(prompt).toBeVisible();

  if (isMobile) {
    // The owner's path: a thumb, not an F key.
    const boxes = await promptOverlapsControls(page);
    expect(boxes.hasJump && boxes.hasSprint, 'the phone thumb controls are on screen').toBe(true);
    expect(boxes.jump, 'the Talk prompt must not sit under the jump button').toBe(false);
    expect(boxes.sprint, 'the Talk prompt must not sit under the sprint button').toBe(false);
    await saveShot(page, 'npc-prompt', testInfo);
    await prompt.tap();
  } else {
    await saveShot(page, 'npc-prompt', testInfo);
    await page.keyboard.press('KeyF');
  }

  await expect.poll(async () => (await readDebug(page)).dialog.open).toBe(true);
  debug = await readDebug(page);
  expect(debug.dialog.npcId).toBe('basin-wanderer');
  expect(debug.dialog.node).toBe('greeting');

  await expect(page.locator('.dialog__card')).toContainText('A fellow traveller');
  await expect(page.locator('.dialog__name')).toContainText('Wanderer');
  await saveShot(page, 'npc-dialog', testInfo);

  // A conversation holds the world still: unpause the frame loop, hold W, and
  // nothing may move. This is the real clock, not step(), because the pause is
  // a frame-loop rule — if it is broken, even a slow machine moves the player.
  await pauseSim(page, false);
  const still = await readDebug(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  const during = await readDebug(page);
  const drifted = Math.hypot(during.player.x - still.player.x, during.player.z - still.player.z);
  expect(drifted, 'the player must not walk while the dialog is open').toBeLessThan(0.05);
  await pauseSim(page, true);

  // Pick the first choice: "Where am I?" -> place.
  const buttons = page.locator('.dialog__choice');
  expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  await buttons.first().click();
  await expect.poll(async () => (await readDebug(page)).dialog.node).toBe('place');

  // Walk to the end: a node with no choices shows the generated Continue.
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.dialog').isVisible())) break;
    await page.locator('.dialog__choice').last().click();
    await page.waitForTimeout(40);
  }
  await expect.poll(async () => (await readDebug(page)).dialog.open).toBe(false);

  // And the world moves again. Walking backwards (S) keeps us away from the
  // pool, so this cannot accidentally change the realm.
  await pauseSim(page, false);
  const before = await readDebug(page);
  await page.keyboard.down('KeyS');
  await expect
    .poll(async () => (await readDebug(page)).player.z, { timeout: 10_000 })
    .toBeGreaterThan(before.player.z + 0.4);
  await page.keyboard.up('KeyS');
  await pauseSim(page, true);

  watch.assertClean();
});

test('Kurin the peaks-guide is present on Roshar and talks', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  await startFrozen(page, '?map=roshar&seed=4242');
  let debug = await readDebug(page);
  expect(debug.mapId).toBe('roshar');
  expect(debug.dialog.open).toBe(false);

  // Kurin is at (-5, -8): forward and to the left, which is W + A. The path's
  // closest approach is ~2.1 m, inside the 3 m radius, and it never enters the
  // pool (the shore stays ~10 m away on that line).
  debug = await walkToward(page, ['KeyW', 'KeyA'], { x: -5, z: -8 });
  expect(debug.realm, 'Kurin stands on Roshar, not across the beads').toBe('physical');

  const prompt = page.locator('.interact-prompt');
  await expect(prompt).toBeVisible();
  if (isMobile) await prompt.tap();
  else await page.keyboard.press('KeyF');

  await expect.poll(async () => (await readDebug(page)).dialog.open).toBe(true);
  debug = await readDebug(page);
  expect(debug.dialog.npcId).toBe('peaks-guide');
  expect(debug.dialog.node).toBe('greeting');
  await expect(page.locator('.dialog__name')).toContainText('Kurin');
  await expect(page.locator('.dialog__card')).toContainText('You stand at the peaks');

  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.dialog').isVisible())) break;
    await page.locator('.dialog__choice').last().click();
    await page.waitForTimeout(40);
  }
  await expect.poll(async () => (await readDebug(page)).dialog.open).toBe(false);

  watch.assertClean();
});

test('no prompt appears when the player is far from any NPC', async ({ page }) => {
  const watch = attachWatch(page);
  await startFrozen(page, '?map=blank-basin');
  // At spawn the player is 9.2 m from the wanderer, beyond the 3 m radius, and
  // walking backwards only makes it further.
  await page.keyboard.down('KeyS');
  await stepSim(page, 1.0);
  await page.keyboard.up('KeyS');

  await expect(page.locator('.interact-prompt')).toBeHidden();
  expect((await readDebug(page)).dialog.open).toBe(false);

  watch.assertClean();
});

test('NPCs are visible as flames in the Cognitive Realm on Roshar', async ({ page }, testInfo) => {
  const watch = attachWatch(page);
  await gotoGame(page, '?map=roshar&seed=4242');
  // The gate itself is covered by realm.spec.js and skin.spec.js; this test is
  // about the manifestation, so the harness sets the realm directly.
  await page.evaluate(() => window.__worldhopper.realm('cognitive'));
  await expect.poll(async () => (await readDebug(page)).realm).toBe('cognitive');

  const debug = await readDebug(page);
  expect(debug.skin.authored, 'Roshar’s cognitive skin is on screen').toBe(true);
  expect(debug.skin.npcFlames, 'a living person is a flame, and the count reaches the snapshot').toBeGreaterThanOrEqual(1);
  await saveShot(page, 'npc-flames', testInfo);

  watch.assertClean();
});
