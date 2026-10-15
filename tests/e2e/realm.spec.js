import { test, expect } from '@playwright/test';
import { attachWatch, readDebug, saveShot, startFrozen, stepSim, gotoGame } from './helpers.js';

/**
 * M2: the realm switch — the game's core verb.
 *
 * Two things must hold every time, on both devices:
 *   1. the world does not change when the lens does (same state, same tick,
 *      same entity hash — §2: never two versions of the world), and
 *   2. the switch is instant, so the tests read it the way a player feels it:
 *      press, and it is already the other realm.
 */

const physical = { realm: 'physical', projection: 'perspective' };
const cognitive = { realm: 'cognitive', projection: 'orthographic' };

test('F shifts the realm, and the world does not change with it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone button is covered below');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  expect(before.realm).toBe(physical.realm);
  expect(before.camera.projection).toBe(physical.projection);

  await page.keyboard.press('f');
  await expect
    .poll(async () => (await readDebug(page)).realm, { timeout: 5_000 })
    .toBe(cognitive.realm);
  const shifted = await readDebug(page);

  expect(shifted.camera.projection).toBe(cognitive.projection);
  expect(shifted.camera.span).toBe(shifted.settings.realmZoom);
  // Same world: a lens is not a teleport.
  expect(shifted.tick).toBe(before.tick);
  expect(shifted.entityHash).toBe(before.entityHash);
  expect(shifted.entityCount).toBe(before.entityCount);
  expect(shifted.player.x).toBe(before.player.x);
  expect(shifted.player.z).toBe(before.player.z);
  expect(shifted.mapId).toBe(before.mapId);
  // The lens is above the player, looking down.
  expect(shifted.camera.y).toBeGreaterThan(shifted.player.y + 10);
  // And the HUD says which realm you are in.
  await expect(page.locator('.hud__realm')).toBeVisible();

  // Pressing it again is the way back, and it leaves the lens fields behind.
  await page.keyboard.press('f');
  await expect
    .poll(async () => (await readDebug(page)).realm, { timeout: 5_000 })
    .toBe(physical.realm);
  const back = await readDebug(page);
  expect(back.camera.projection).toBe(physical.projection);
  expect(back.camera.span).toBe(0);
  await expect(page.locator('.hud__realm')).toBeHidden();
  watch.assertClean();
});

test('the simulation is the same simulation in the lens', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  const start = await startFrozen(page);
  await page.keyboard.press('f');
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 5_000 }).toBe('cognitive');
  const beforeWalk = await readDebug(page);

  // Walking in the Cognitive realm moves the player exactly as it does in the
  // physical one: the realm is a rendering, not a different set of physics.
  await page.keyboard.down('KeyW');
  const walked = await stepSim(page, 1.5);
  await page.keyboard.up('KeyW');
  expect(Math.abs(walked.player.z - beforeWalk.player.z)).toBeGreaterThan(5);
  expect(walked.player.distanceWalked).toBeGreaterThan(beforeWalk.player.distanceWalked + 5);
  expect(walked.camera.projection).toBe('orthographic');
  // The camera follows: it is centred on the player, not left behind.
  expect(Math.abs(walked.camera.z - walked.player.z)).toBeLessThan(40);
  watch.assertClean();
});

test('the phone realm button shifts too, in one tap', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  expect(before.realm).toBe('physical');

  const button = page.locator('.touch-realm');
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  await button.tap();
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 5_000 }).toBe('cognitive');
  await expect(page.locator('.hud__realm')).toBeVisible();
  await button.tap();
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 5_000 }).toBe('physical');
  watch.assertClean();
});

test('captures both realms for the owner to compare', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'the desktop camera is the one being judged here');
  const watch = attachWatch(page);
  await gotoGame(page, '?debug=0');
  await saveShot(page, 'realm-physical', testInfo);
  await page.keyboard.press('f');
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 5_000 }).toBe('cognitive');
  await page.waitForTimeout(300);
  await saveShot(page, 'realm-cognitive', testInfo);
  watch.assertClean();
});
