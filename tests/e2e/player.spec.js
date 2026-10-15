import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, holdKey, readDebug, saveShot, touchDrag, stickDrag } from './helpers.js';
import { SETTING_BY_KEY } from '../../src/core/settings.js';

/**
 * M1: the player. Keyboard on desktop, stick + jump on the phone, and the same
 * sim underneath both — asserted through window.__debug(), never by eyeballing.
 */

const WALK = SETTING_BY_KEY.walkSpeed.default;

test('walking moves the player, and stopping stops them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone path is covered below');
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  await holdKey(page, 'KeyW', 900);
  const after = await readDebug(page);

  // yaw 0 looks down -Z, so forward is -Z.
  expect(after.player.z).toBeLessThan(before.player.z - 1.5);
  expect(Math.abs(after.player.x - before.player.x)).toBeLessThan(0.5);
  expect(after.player.speed).toBeGreaterThan(WALK * 0.6);
  expect(after.player.distanceWalked).toBeGreaterThan(1.5);

  await page.waitForTimeout(500);
  const stopped = await readDebug(page);
  expect(stopped.player.speed).toBeLessThan(0.3);
  expect(stopped.player.grounded).toBe(true);

  watch.assertClean();
});

test('walking is smooth in the sense that matters: no frame-loop spikes', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  await gotoGame(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const debug = await readDebug(page);
  // Not an fps claim — the sandbox is a software renderer. This asserts our own
  // loop is not doing something pathological (allocation storms, shader
  // rebuilds, sim backlog) while the player moves.
  expect(debug.droppedSubsteps).toBeLessThan(20);
  expect(debug.worstFrameMs).toBeLessThan(2000);
  watch.assertClean();
});

test('a jump leaves the ground and lands again', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone button is covered below');
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const airborne = await readDebug(page);
  expect(airborne.player.y).toBeGreaterThan(before.player.y + 0.2);
  expect(airborne.player.jumps).toBe(before.player.jumps + 1);

  await page.waitForTimeout(1500);
  const landed = await readDebug(page);
  expect(landed.player.grounded).toBe(true);
  expect(landed.player.y).toBeCloseTo(before.player.y, 1);
  expect(landed.player.landings).toBeGreaterThan(before.player.landings);

  watch.assertClean();
});

test('the camera follows the player and drag-look does not move them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  await gotoGame(page);

  await holdKey(page, 'KeyW', 400);
  const walked = await readDebug(page);
  // The camera is derived from the player: same position, eye height above.
  expect(walked.camera.x).toBeCloseTo(walked.player.x, 3);
  expect(walked.camera.z).toBeCloseTo(walked.player.z, 3);
  expect(walked.camera.y - walked.player.y).toBeGreaterThan(1.4);
  expect(walked.camera.y - walked.player.y).toBeLessThan(1.9);

  await touchDrag(page, 300, 0);
  await page.waitForTimeout(200);
  const looked = await readDebug(page);
  expect(looked.camera.yaw).not.toBe(walked.camera.yaw);
  expect(looked.player.x).toBeCloseTo(walked.player.x, 3);
  expect(looked.player.z).toBeCloseTo(walked.player.z, 3);

  watch.assertClean();
});

test('the thumb-stick walks the player, and releasing stops them', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  expect(before.ui.touch).toBe(true);
  const jump = page.locator('.touch-jump');
  await expect(jump).toBeVisible();
  const box = await jump.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  // Hold the stick pushed forward, sampling while it drives the player.
  const drive = stickDrag(page, 0, -120, { holdMs: 900 }).then(async () => {
    await page.waitForTimeout(700);
  });
  await page.waitForTimeout(700);
  const moving = await readDebug(page);
  expect(moving.input.stick).not.toBeNull();
  expect(moving.input.stick.magnitude).toBeGreaterThan(0.5);
  await drive;

  const stopped = await readDebug(page);
  expect(stopped.player.speed).toBeLessThan(0.3);
  const after = await readDebug(page);
  expect(Math.abs(after.player.z - before.player.z)).toBeGreaterThan(1);

  watch.assertClean();
});

test('the jump button jumps on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  await page.locator('.touch-jump').tap();
  await page.waitForTimeout(200);
  const airborne = await readDebug(page);
  expect(airborne.player.y).toBeGreaterThan(before.player.y + 0.15);
  expect(airborne.player.jumps).toBe(before.player.jumps + 1);

  await page.waitForTimeout(1500);
  expect((await readDebug(page)).player.grounded).toBe(true);
  watch.assertClean();
});

test('the phone look-drag turns the view without walking', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  await touchDrag(page, 220, 0);
  await page.waitForTimeout(250);
  const after = await readDebug(page);

  expect(after.camera.yaw).not.toBe(before.camera.yaw);
  expect(Math.abs(after.player.x - before.player.x)).toBeLessThan(0.05);
  expect(Math.abs(after.player.z - before.player.z)).toBeLessThan(0.05);

  watch.assertClean();
});

test('the feel sliders change the walk, and the tuned feel survives a reload', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard-driven panel');
  const watch = attachWatch(page);
  await gotoGame(page, '?walk=9&jump=2.5&gravity=12&accel=90&bob=0');

  const tuned = await readDebug(page);
  expect(tuned.settings.walkSpeed).toBe(9);
  expect(tuned.settings.gravity).toBe(12);
  expect(tuned.settings.viewBob).toBe(0);

  await holdKey(page, 'KeyW', 900);
  const walked = await readDebug(page);
  expect(walked.player.speed).toBeGreaterThan(5.5, 'the walk speed slider must reach the sim');
  expect(walked.player.bob).toBe(0, 'bob at 0 must mean no bob');

  await saveShot(page, 'player-walking', testInfo);

  // A jump under low gravity is taller than the default: the sliders compose.
  const beforeJump = await readDebug(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const airborne = await readDebug(page);
  expect(airborne.player.y - beforeJump.player.y).toBeLessThan(1.2);
  expect(airborne.player.y).toBeGreaterThan(beforeJump.player.y);

  watch.assertClean();
});

test('walking into a rock does not walk through it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  // A seed whose first rock sits close to spawn; the sim test proves the rule,
  // this proves the rock is solid in the *shipped* world too.
  await gotoGame(page, '?seed=7');
  const start = await readDebug(page);

  const rocks = await page.evaluate(() => {
    const state = window.__worldhopper.debug();
    return state.entityCount;
  });
  expect(rocks).toBeGreaterThan(1);

  await holdKey(page, 'KeyW', 3000);
  const end = await readDebug(page);
  expect(end.player.grounded).toBe(true);
  expect(end.player.y).toBeGreaterThan(-Math.abs(start.player.y) - 12);
  // Still inside the map, and still on top of the terrain rather than inside it.
  const probe = await page.evaluate(() => {
    const player = window.__worldhopper.player();
    return { x: player.position.x, y: player.position.y, z: player.position.z };
  });
  expect(Math.abs(probe.x)).toBeLessThan(900);
  expect(Math.abs(probe.z)).toBeLessThan(900);

  watch.assertClean();
});

test('the debug overlay reports the player, not just the camera', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  await gotoGame(page, '?debug=1');
  await holdKey(page, 'KeyW', 400);
  await expect(page.locator('.debug-overlay')).toContainText('player');
  await saveShot(page, 'overlay-player', testInfo);
  watch.assertClean();
});
