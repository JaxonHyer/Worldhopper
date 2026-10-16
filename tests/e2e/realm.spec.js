import { test, expect } from '@playwright/test';
import { attachWatch, readDebug, saveShot, startFrozen, stepSim, gotoGame } from './helpers.js';

/**
 * M2: the realm shift, as a place rather than a key press.
 *
 * The owner's instruction (2026-10-15): "make a Perpendicularity by spawn with
 * a fade to black transition. Remove the realm swap button and key binding."
 * So these tests drive the *player* to the pool and check what a player would
 * see: a fade, then another realm, with the world unchanged underneath it.
 *
 * The pool is 14 m ahead of the spawn, and the walk happens through `stepSim()`
 * (input by key, time by hand), so nothing here depends on the renderer's speed.
 */

const POOL_Z = -14;

/**
 * The transition length is a *feel* number (`?fadems=`, default 420 ms), and a
 * full fade costs `2 x fade + hold` of real time. The tests below are about the
 * rule — walk in, shift realm, once per visit — so they run it at 120 ms and
 * leave the long beat to the screenshot test, which is the one judging it.
 */
const QUICK_FADE = '?fadems=120';

/**
 * Walk until a transition has run, holding `key` (W forward, S back).
 *
 * Detected by the *count* of fades rather than by catching `ui.fade` mid-flight:
 * a 1 s transition can start and finish between two polls, and a test that
 * races the thing it is measuring is a test that will flake on CI.
 *
 * The direction matters: a shift leaves you standing *in* the pool, so the way
 * to reach it again is back the way you came, not further on. Walking forward
 * from inside the pool only ever walks away from it.
 */
async function walkUntilFade(page, key = 'KeyW', { steps = 10 } = {}) {
  const before = await readDebug(page);
  await page.keyboard.down(key);
  let fades = before.ui.fades;
  for (let i = 0; i < steps && fades === before.ui.fades; i++) {
    const snap = await stepSim(page, 0.4);
    fades = snap.ui.fades;
  }
  await page.keyboard.up(key);
  return fades > before.ui.fades;
}

test('walking into the pool shifts the realm, behind a fade', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone is covered below');
  const watch = attachWatch(page);
  const before = await startFrozen(page, QUICK_FADE);
  expect(before.realm).toBe('physical');
  expect(before.camera.projection).toBe('perspective');
  expect(before.ui.fade).toBe(false);

  // Stand next to it first: the gate must not fire just because you are near.
  await page.keyboard.down('KeyW');
  await stepSim(page, 1.2); // ~9.5 m of the 14 m
  const approach = await readDebug(page);
  expect(approach.realm).toBe('physical');
  expect(approach.ui.fade).toBe(false);
  expect(Math.hypot(approach.player.x, approach.player.z - POOL_Z)).toBeGreaterThan(3.4);

  // Now step in.
  const ran = await walkUntilFade(page);
  expect(ran, 'the transition must run: a fade, not a cut').toBe(true);

  await expect
    .poll(async () => (await readDebug(page)).realm, { timeout: 10_000 })
    .toBe('cognitive');
  const shifted = await readDebug(page);

  // Same world: the lens is not a teleport, and the fade is not a simulation.
  expect(shifted.entityHash).toBe(before.entityHash);
  expect(shifted.camera.projection).toBe('orthographic');
  // The world held still during the beat (the sim does not step while black).
  const inside = await readDebug(page);
  expect(inside.tick).toBeGreaterThan(before.tick);
  // The HUD says where you are, and the fade has finished.
  await expect(page.locator('.hud__realm')).toBeVisible();
  await expect
    .poll(async () => (await readDebug(page)).ui.fade, { timeout: 10_000 })
    .toBe(false);

  // Walk on out of it, then turn round and come back: the gate re-arms when you
  // leave, and the second visit brings you home again.
  await page.keyboard.down('KeyW');
  await stepSim(page, 1.5);
  await page.keyboard.up('KeyW');
  const left = await readDebug(page);
  expect(
    Math.hypot(left.player.x, left.player.z - POOL_Z),
    'the walk out must actually leave the pool, or the return proves nothing',
  ).toBeGreaterThan(3.4);
  const cameHome = await walkUntilFade(page, 'KeyS');
  expect(cameHome, 'walking back into the pool must shift again').toBe(true);
  await expect
    .poll(async () => (await readDebug(page)).realm, { timeout: 10_000 })
    .toBe('physical');
  await expect(page.locator('.hud__realm')).toBeHidden();
  watch.assertClean();
});

test('the realm swap key and button are gone', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop half; the phone half is below');
  const watch = attachWatch(page);
  const before = await startFrozen(page, QUICK_FADE);

  // The old binding: F did this, and it must not any more.
  await page.keyboard.press('f');
  await page.keyboard.press('F');
  await stepSim(page, 0.5);
  const after = await readDebug(page);
  expect(after.realm).toBe('physical');
  expect(after.ui.fade).toBe(false);
  expect(after.tick).toBeGreaterThan(before.tick); // the sim ran; nothing shifted
  await expect(page.locator('.touch-realm')).toHaveCount(0);
  watch.assertClean();
});

test('the phone realm button is gone too, and the pool works by thumb', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  const before = await startFrozen(page, QUICK_FADE);
  expect(before.ui.touch).toBe(true);
  await expect(page.locator('.touch-realm')).toHaveCount(0);

  // The pool cannot be reached by keyboard here, but the walk is the walk:
  // pushing the stick forward is exactly the same intent as holding W.
  const box = await page.locator('#game').boundingBox();
  const client = await page.context().newCDPSession(page);
  const startX = Math.round(box.x + box.width * 0.25);
  const startY = Math.round(box.y + box.height * 0.72);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: Math.round(startY - (130 * i) / 6), id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  // By count, not by catching `ui.fade` mid-flight: a beat can start and finish
  // between two polls, and a test that races what it measures flakes.
  const fadesBefore = (await readDebug(page)).ui.fades;
  let sawFade = false;
  for (let i = 0; i < 10 && !sawFade; i++) sawFade = (await stepSim(page, 0.4)).ui.fades > fadesBefore;
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  expect(sawFade, 'the thumb-stick path must reach the pool too').toBe(true);
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 10_000 }).toBe('cognitive');
  watch.assertClean();
});

test('captures the pool, the fade, and both sides of it', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'the desktop camera is the one being judged here');
  const watch = attachWatch(page);
  test.setTimeout(120_000);

  // The pool from the spawn: the first thing the owner sees.
  await gotoGame(page, '?debug=0');
  await page.keyboard.down('KeyW');
  await stepSim(page, 1.1);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  await saveShot(page, 'pool-approach', testInfo);

  // Mid-fade: the transition itself. `?fadems=2000` makes the beat long enough
  // to photograph — and that param is the very slider the owner tunes the
  // transition with, not a test-only hook.
  await gotoGame(page, '?fadems=2000&debug=0');
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 10; i++) {
    const snap = await stepSim(page, 0.4);
    if (snap.ui.fade) break;
  }
  await page.keyboard.up('KeyW');
  await saveShot(page, 'pool-fade', testInfo);

  // ...and where you come out.
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 10_000 }).toBe('cognitive');
  await page.waitForTimeout(600);
  await saveShot(page, 'pool-arrival-cognitive', testInfo);

  // The pool seen from the lens: same place, same coordinates, other realm.
  await gotoGame(page, '?realm=cognitive&debug=0');
  await page.waitForTimeout(300);
  await saveShot(page, 'pool-in-lens', testInfo);
  watch.assertClean();
});
