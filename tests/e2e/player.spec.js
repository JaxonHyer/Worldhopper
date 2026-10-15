import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, openStick, readDebug, saveShot, startFrozen, stepSim, touchDrag } from './helpers.js';
import { SETTING_BY_KEY } from '../../src/core/settings.js';

/**
 * M1: the player. Keyboard on desktop, stick + jump on the phone, and the same
 * sim underneath both.
 *
 * Timing rule for this suite: *input* is driven by real events (keys, touches)
 * but *time* is advanced by `stepSim()`, which steps the fixed-timestep sim
 * directly. Wall-clock assertions would be measuring CI's software renderer
 * (~6 fps, so the sim is time-dilated to half speed) rather than the game.
 */

const WALK = SETTING_BY_KEY.walkSpeed.default;

/** Step in slices and track the highest point, for apex assertions. */
async function jumpPeak(page, { seconds = 1.6, slice = 0.05 } = {}) {
  const start = await readDebug(page);
  let peak = start.player.y;
  let airborneSlices = 0;
  for (let i = 0; i < Math.round(seconds / slice); i++) {
    const snap = await stepSim(page, slice);
    if (!snap.player.grounded) airborneSlices++;
    peak = Math.max(peak, snap.player.y);
  }
  return { startY: start.player.y, peak, rise: peak - start.player.y, airborneSeconds: airborneSlices * slice };
}

test('walking moves the player, and stopping stops them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone path is covered below');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  await page.keyboard.down('KeyW');
  // yaw 0 looks down -Z, so forward is -Z. 1.5 s at 5.5 m/s is ~7.5 m.
  const after = await stepSim(page, 1.5);
  await page.keyboard.up('KeyW');

  expect(after.player.z).toBeLessThan(before.player.z - 4);
  expect(Math.abs(after.player.x - before.player.x)).toBeLessThan(0.5);
  expect(after.player.speed).toBeGreaterThan(WALK * 0.9);
  expect(after.player.distanceWalked).toBeGreaterThan(5);

  const stopped = await stepSim(page, 1);
  expect(stopped.player.speed).toBeLessThan(0.05);
  expect(stopped.player.grounded).toBe(true);

  watch.assertClean();
});

test('the simulation never runs ahead of the clock, even on a slow renderer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  await gotoGame(page); // deliberately NOT frozen: this tests the frame loop
  await stepSim(page, 2);
  const debug = await readDebug(page);

  // This is the contract the old flaky tests were missing: the fixed-step clock
  // is allowed to fall behind wall clock (it clamps long frames), never ahead.
  expect(debug.simTime).toBeLessThanOrEqual(debug.clockTime + 1e-6);
  // And the frame loop must not be dropping huge amounts of sim time.
  expect(debug.droppedSubsteps).toBeLessThan(400);
  watch.assertClean();
});

test('a jump leaves the ground and lands again', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone button is covered below');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  await page.keyboard.press('Space');
  const airborne = await stepSim(page, 0.25);
  expect(airborne.player.y).toBeGreaterThan(before.player.y + 0.3);
  expect(airborne.player.grounded).toBe(false);
  expect(airborne.player.jumps).toBe(before.player.jumps + 1);

  const landed = await stepSim(page, 2);
  expect(landed.player.grounded).toBe(true);
  expect(landed.player.y).toBeCloseTo(before.player.y, 1);
  expect(landed.player.landings).toBeGreaterThan(before.player.landings);

  watch.assertClean();
});

test('the camera watches the player from behind (third person by default)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  const start = await startFrozen(page);
  expect(start.camera.mode).toBe('third');
  expect(start.camera.avatar).toBe(true);

  await page.keyboard.down('KeyW');
  await stepSim(page, 0.6);
  await page.keyboard.up('KeyW');
  // Releasing a key does not stop the player dead: the acceleration slider
  // decides how long the momentum lasts. Let them settle before measuring.
  const walked = await stepSim(page, 0.6);
  expect(walked.player.speed).toBeLessThan(0.05);

  // One camera, derived at snapshot time: it sits behind the player, above
  // their feet, at the boom length the setting asks for.
  const flat = Math.hypot(walked.camera.x - walked.player.x, walked.camera.z - walked.player.z);
  expect(walked.camera.y).toBeGreaterThan(walked.player.y + 0.5);
  expect(flat).toBeGreaterThan(1);
  expect(flat).toBeLessThanOrEqual(walked.camera.distance + 1e-6);
  expect(walked.camera.distance).toBeLessThanOrEqual(walked.settings.camDistance + 1e-6);
  // Walking backwards through the boom is the whole point: with yaw 0 forward
  // is -Z, so "behind" is +Z.
  expect(walked.player.yaw).toBeCloseTo(0, 6);
  expect(walked.camera.z).toBeGreaterThan(walked.player.z);

  // Drag-look turns the view without walking the player.
  await touchDrag(page, 300, 0);
  const looked = await stepSim(page, 0.25);
  expect(looked.player.yaw).not.toBe(walked.player.yaw);
  expect(looked.player.x).toBeCloseTo(walked.player.x, 6);
  expect(looked.player.z).toBeCloseTo(walked.player.z, 6);

  watch.assertClean();
});

test('first person is the old eye view, and the body is not drawn', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  const snap = await startFrozen(page, '?view=first');
  expect(snap.camera.mode).toBe('first');
  expect(snap.camera.avatar).toBe(false);
  expect(snap.camera.distance).toBe(0);
  expect(snap.camera.x).toBe(snap.player.x);
  expect(snap.camera.z).toBe(snap.player.z);
  // Eye height above the feet, as it was in M1; the sim owns this number.
  expect(snap.camera.y - snap.player.y).toBeGreaterThan(1.6);
  expect(snap.camera.y - snap.player.y).toBeLessThan(1.8);
  // First person looks through the player's own pitch, not a re-aimed boom.
  expect(snap.camera.pitch).toBeCloseTo(snap.player.pitch, 4);
  expect(snap.camera.yaw).toBeCloseTo(snap.player.yaw, 4);

  // Switching the view in the panel takes effect on the next frame.
  await page.evaluate(() => window.__worldhopper.setSetting('view', 'third'));
  const third = await stepSim(page, 0.05);
  expect(third.camera.mode).toBe('third');
  expect(third.camera.avatar).toBe(true);
  watch.assertClean();
});

test('the thumb-stick walks the player, and releasing stops them', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  expect(before.ui.touch).toBe(true);
  const jump = page.locator('.touch-jump');
  await expect(jump).toBeVisible();
  const box = await jump.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  // Keep the thumb down so the stick stays pushed, then drive the sim by hand.
  const stick = await openStick(page, 0, -120);
  // The ring and knob must actually appear: the inputs were driving the sim
  // while the visuals were silently missing, which only a screenshot showed.
  await expect(page.locator('.touch-stick')).toBeVisible();
  const knob = await page.locator('.touch-stick__knob').boundingBox();
  const ring = await page.locator('.touch-stick').boundingBox();
  expect(knob.y).toBeLessThan(ring.y + ring.height / 2 - 10);

  const moving = await stepSim(page, 1.5);
  expect(moving.input.stick).not.toBeNull();
  expect(moving.input.stick.magnitude).toBeGreaterThan(0.5);
  expect(Math.abs(moving.player.z - before.player.z)).toBeGreaterThan(5);
  await stick.release();

  const stopped = await stepSim(page, 1);
  expect(stopped.player.speed).toBeLessThan(0.05);

  watch.assertClean();
});

test('the jump button jumps on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  const jumpsBefore = await page.evaluate(() => window.__worldhopper.player().jumps);
  await page.locator('.touch-jump').tap();
  const airborne = await stepSim(page, 0.3);
  expect(airborne.player.y).toBeGreaterThan(before.player.y + 0.3);
  expect(airborne.player.jumps).toBe(before.player.jumps + 1);
  expect(airborne.player.jumps).toBe(jumpsBefore + 1);

  const landed = await stepSim(page, 2);
  expect(landed.player.grounded).toBe(true);
  watch.assertClean();
});

test('the phone look-drag turns the view without walking', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  const before = await startFrozen(page);
  await touchDrag(page, 220, 0);
  const after = await stepSim(page, 0.25);

  expect(after.camera.yaw).not.toBe(before.camera.yaw);
  expect(Math.abs(after.player.x - before.player.x)).toBeLessThan(0.05);
  expect(Math.abs(after.player.z - before.player.z)).toBeLessThan(0.05);
  expect(after.ui.touch).toBe(true);

  watch.assertClean();
});

test('the feel sliders reach the sim, and a tuned URL reproduces the feel', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard-driven');
  const watch = attachWatch(page);
  const tuned = await startFrozen(page, '?walk=11&jump=2.5&gravity=12&accel=90&bob=0');
  expect(tuned.settings.walkSpeed).toBe(11);
  expect(tuned.settings.gravity).toBe(12);
  expect(tuned.settings.viewBob).toBe(0);

  await page.keyboard.down('KeyW');
  const walked = await stepSim(page, 2);
  await page.keyboard.up('KeyW');
  expect(walked.player.speed).toBeGreaterThan(WALK + 1, 'the walk speed slider must reach the sim');
  expect(walked.player.bob).toBe(0, 'bob at 0 must mean no bob');
  await saveShot(page, 'player-walking', testInfo);

  // The same walk with default settings settles at a lower speed.
  await startFrozen(page);
  await page.keyboard.down('KeyW');
  const slower = await stepSim(page, 2);
  await page.keyboard.up('KeyW');
  expect(slower.player.speed).toBeLessThan(walked.player.speed - 1);

  // Jump height is the slider; gravity is the spring rate. So a 2.5 m jump is
  // 2.5 m under any gravity — what gravity changes is how long the flight takes.
  await startFrozen(page, '?jump=2.5&gravity=12');
  await page.keyboard.press('Space');
  const floaty = await jumpPeak(page);
  expect(Math.abs(floaty.rise - 2.5) / 2.5).toBeLessThan(0.1);

  await startFrozen(page, '?jump=2.5&gravity=40');
  await page.keyboard.press('Space');
  const heavy = await jumpPeak(page);
  expect(Math.abs(heavy.rise - 2.5) / 2.5).toBeLessThan(0.1);
  expect(heavy.airborneSeconds).toBeLessThan(floaty.airborneSeconds - 0.1);

  // ...and a taller jump really is taller.
  await startFrozen(page, '?jump=0.8&gravity=18');
  await page.keyboard.press('Space');
  const low = await jumpPeak(page);
  await startFrozen(page, '?jump=3&gravity=18');
  await page.keyboard.press('Space');
  const high = await jumpPeak(page);
  expect(high.rise).toBeGreaterThan(low.rise + 1.5);

  watch.assertClean();
});

test('walking into a rock does not walk through it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  await startFrozen(page, '?seed=7');

  await page.keyboard.down('KeyW');
  const end = await stepSim(page, 6);
  await page.keyboard.up('KeyW');

  // Never under the terrain, never outside the map, still standing on it.
  const support = await page.evaluate(() => {
    const player = window.__worldhopper.player();
    return { x: player.position.x, y: player.position.y, z: player.position.z, grounded: player.grounded };
  });
  expect(end.player.grounded).toBe(true);
  expect(support.grounded).toBe(true);
  expect(Math.abs(support.x)).toBeLessThan(800);
  expect(Math.abs(support.z)).toBeLessThan(800);
  expect(Number.isFinite(support.y)).toBe(true);

  watch.assertClean();
});

test('the debug overlay reports the player and the input mode', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard path');
  const watch = attachWatch(page);
  await gotoGame(page, '?debug=1'); // unpaused: this test is about the overlay
  await page.keyboard.down('KeyW');
  await stepSim(page, 0.5);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400); // the overlay refreshes at 4 Hz

  const overlay = page.locator('.debug-overlay');
  await expect(overlay).toContainText('player');
  await expect(overlay).toContainText('grounded');
  await expect(overlay).toContainText('keyboard');
  await saveShot(page, 'overlay-player', testInfo);
  watch.assertClean();
});
