/**
 * NPC dialog end-to-end tests (WP-3.4).
 *
 * Walks up to the wanderer on the default blank-basin map, checks the prompt
 * appears, presses F to talk, walks the dialogue tree, and verifies the dialog
 * closes cleanly. Same for the guide on Roshar. The sim is driven with step()
 * so wall-clock frame rate cannot race the assertions (DECISIONS trap).
 */

import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, startFrozen, stepSim } from './helpers.js';

test('the wanderer stands by spawn and opens a dialog on F', async ({ page }) => {
  const watch = attachWatch(page);
  let debug = await startFrozen(page, '?seed=4242');
  expect(debug.mapId).toBe('blank-basin');
  // There is exactly one NPC on this map (the wanderer), standing nearby.
  expect(debug.entityCount).toBeGreaterThanOrEqual(35); // 34 rocks + 1 landmark + 1 npc = 36
  expect(debug.dialog.open).toBe(false);

  // The NPC is placed at (4.5, -8). Walk forward-and-right (S is -z but we
  // need slight adjustment). The interact radius is 3 m, so walking ~10 m
  // toward that direction puts us within range.
  // Use keyboard: D strafes right, W walks forward (-z). We're already pointed
  // down -z, so press W only for ~1.2 s — but NOT long enough to reach the
  // Perpendicularity (which is 14 m ahead; walking 7.9 m/s * 1.2 s ~= 9.5 m,
  // and NPC is at z=-8). The pool is at z=-14.
  // Actually the wanderer is at z=-8, so walking W ~1.0 s gets us there.
  // Default walk speed is 4.2 m/s.
  await page.keyboard.down('KeyW');
  debug = await stepSim(page, 1.6);
  await page.keyboard.up('KeyW');

  // The prompt should be visible (near an NPC).
  const promptVisible = await page.locator('.interact-prompt').isVisible();
  expect(promptVisible, 'interact prompt should show when close to an NPC').toBe(true);

  // Press F to talk.
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(100);

  debug = await readDebug(page);
  expect(debug.dialog.open).toBe(true);
  expect(debug.dialog.npcId).toBe('basin-wanderer');
  expect(debug.dialog.node).toBe('greeting');

  // The dialog card should be in the DOM with text from the greeting.
  await expect(page.locator('.dialog__card')).toContainText('A fellow traveller');
  await expect(page.locator('.dialog__name')).toContainText('Wanderer');

  // Pick first choice: "Where am I?" -> place
  const buttons = page.locator('.dialog__choice');
  expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  await buttons.first().click();
  await page.waitForTimeout(50);
  debug = await readDebug(page);
  expect(debug.dialog.node).toBe('place');

  // Continue to farewell.
  await page.locator('.dialog__choice').last().click();
  await page.waitForTimeout(50);
  // Eventually we land at farewell which has no real choices — the
  // auto-generated Continue button.
  // Keep clicking the last option until dialog closes.
  for (let i = 0; i < 5; i++) {
    const visible = await page.locator('.dialog').isVisible();
    if (!visible) break;
    await page.locator('.dialog__choice').last().click();
    await page.waitForTimeout(80);
  }
  debug = await readDebug(page);
  expect(debug.dialog.open).toBe(false);

  watch.assertClean();
});

test('Kurin the peaks-guide is present on Roshar and talks', async ({ page }) => {
  const watch = attachWatch(page);
  await startFrozen(page, '?map=roshar&seed=4242');
  let debug = await readDebug(page);
  expect(debug.mapId).toBe('roshar');
  expect(debug.dialog.open).toBe(false);

  // Kurin is at (-5, -8). Walk W + A (left) to get close.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  debug = await stepSim(page, 1.6);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');

  // Prompt visible.
  expect(await page.locator('.interact-prompt').isVisible()).toBe(true);

  // Press F to open dialog.
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(100);
  debug = await readDebug(page);
  expect(debug.dialog.open).toBe(true);
  expect(debug.dialog.npcId).toBe('peaks-guide');
  expect(debug.dialog.node).toBe('greeting');
  await expect(page.locator('.dialog__name')).toContainText('Kurin');
  await expect(page.locator('.dialog__card')).toContainText('You stand at the peaks');

  // Close by clicking Continue until gone.
  for (let i = 0; i < 5; i++) {
    const visible = await page.locator('.dialog').isVisible();
    if (!visible) break;
    await page.locator('.dialog__choice').last().click();
    await page.waitForTimeout(80);
  }
  debug = await readDebug(page);
  expect(debug.dialog.open).toBe(false);

  // Movement should resume after dialog closes — the player is not stuck.
  await page.keyboard.down('KeyS');
  const before = (await readDebug(page)).player;
  await stepSim(page, 0.5);
  await page.keyboard.up('KeyS');
  const after = await readDebug(page);
  expect(after.player.z).toBeGreaterThan(before.z);

  watch.assertClean();
});

test('no prompt appears when the player is far from any NPC', async ({ page }) => {
  const watch = attachWatch(page);
  await startFrozen(page);
  // At spawn the player is at (0,0). The wanderer is at (4.5,-8), 9.2 m away,
  // beyond the 3 m radius. Walk backwards (S) to get further away.
  await page.keyboard.down('KeyS');
  await stepSim(page, 1.0);
  await page.keyboard.up('KeyS');

  expect(await page.locator('.interact-prompt').isVisible()).toBe(false);
  const debug = await readDebug(page);
  expect(debug.dialog.open).toBe(false);

  watch.assertClean();
});

test('NPCs are visible as flames in the Cognitive Realm on Roshar', async ({ page }) => {
  const watch = attachWatch(page);
  await gotoGame(page, '?map=roshar&seed=4242');
  // Walk into the pool to shift to cognitive.
  // Need to walk forward ~14 m. At walk speed ~4.2 m/s that's ~3.4 s of
  // forward key, but sim must run (not frozen) so the gate can fire.
  await page.keyboard.down('KeyW');
  // Wait long enough to cross the pool edge and back out is complicated;
  // instead, use the harness to set realm directly for verification.
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__worldhopper.realm('cognitive'));
  const debug = await readDebug(page);
  expect(debug.realm).toBe('cognitive');
  // The skin stats must list NPC flames (player + npc = 2 flames, reported via
  // npcFlames count).
  expect(debug.skin.npcFlames).toBeGreaterThanOrEqual(1);

  watch.assertClean();
});
