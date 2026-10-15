import { test, expect } from '@playwright/test';
import { attachWatch, dragLook, gotoGame, readDebug, saveShot, startFrozen, stepSim, touchDrag } from './helpers.js';
import { PITCH_LIMIT } from '../../src/core/math.js';
import { SETTING_BY_KEY } from '../../src/core/settings.js';

/**
 * Scripted input: drag/keys move the camera, panel changes reach the sim AND
 * the URL/localStorage, and a tuned config can be pasted back (§8).
 */

test('pointer/touch drag looks around without moving the player', async ({ page, isMobile }) => {
  const watch = attachWatch(page);
  // Desktop capture is its own suite (mouse-look.spec.js): here the drag maths
  // is the subject, so the mouse path is pinned with the capture switch off.
  // That is also the honest way to test it — with capture on, a press turns the
  // very same gesture into mouselook.
  await gotoGame(page, isMobile ? '' : '?capture=off');

  const before = await readDebug(page);
  const inputBefore = await page.evaluate(() => window.__worldhopper.input());
  if (isMobile) await touchDrag(page, 260, 0);
  else await dragLook(page, 260, 0);
  await page.waitForTimeout(250);
  const after = await readDebug(page);
  const inputAfter = await page.evaluate(() => window.__worldhopper.input());

  // If a drag does nothing, name the stage that broke instead of guessing:
  // pointerdown never landed / moves never arrived / events arrived but the
  // sim never consumed them.
  expect(inputAfter.pointersDown, `pointerdown never reached the canvas: ${JSON.stringify(inputAfter)}`).toBeGreaterThan(
    inputBefore.pointersDown,
  );
  expect(inputAfter.pointersMoved, `pointermove never reached the canvas: ${JSON.stringify(inputAfter)}`).toBeGreaterThan(
    inputBefore.pointersMoved,
  );
  const radians = inputAfter.lookRadians - inputBefore.lookRadians;
  expect(radians, `drag deltas were zero: ${JSON.stringify(inputAfter)}`).toBeGreaterThan(0.2);
  if (!isMobile) {
    // Capture was switched off, so the drag path must have carried the gesture.
    expect(inputAfter.captureRequests, 'capture was requested although it is off').toBe(inputBefore.captureRequests);
    expect(inputAfter.mouseLookSamples).toBe(inputBefore.mouseLookSamples);
  }

  expect(after.camera.yaw).not.toBe(before.camera.yaw);
  expect(Math.abs(after.camera.yaw - before.camera.yaw)).toBeGreaterThan(0.2);
  // The sim's own angle and the input layer's measured radians must agree.
  expect(Math.abs(Math.abs(after.camera.yaw - before.camera.yaw) - radians)).toBeLessThan(0.05);
  // M0 has no locomotion: the eye must not have travelled.
  expect(after.camera.x).toBeCloseTo(before.camera.x, 6);
  expect(after.camera.y).toBeCloseTo(before.camera.y, 6);
  expect(after.camera.z).toBeCloseTo(before.camera.z, 6);

  watch.assertClean();
});

test('arrow keys walk exactly like WASD, and pitch stays clamped when looking', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no keyboard on the phone project');
  const watch = attachWatch(page);
  // Capture off, so a drag is a drag here: the captured path has its own suite.
  await startFrozen(page, '?capture=off');
  // Each scripted input event is a round trip that queues behind a rendered
  // frame, and CI renders with SwiftShader on two cores. The assertions below
  // are about the sim, not about how fast the machine answers.
  test.setTimeout(120_000);
  const settings = (await readDebug(page)).settings;

  // Two short laps, the first of which proves the ground is clear, so a rock
  // cannot quietly explain a difference between the two keys. Driven by the
  // sim's own clock: how fast the machine renders has no say.
  const lap = async (key) => {
    const before = await stepSim(page, 0.05);
    await page.keyboard.down(key);
    const during = await stepSim(page, 0.4);
    await page.keyboard.up(key);
    await stepSim(page, 0.4); // come to rest
    return { speed: during.player.speed, walked: before.player.z - during.player.z };
  };

  const wasd = await lap('KeyW');
  const arrows = await lap('ArrowUp');
  expect(wasd.speed).toBeCloseTo(settings.walkSpeed, 1);
  expect(wasd.walked).toBeGreaterThan(1);
  expect(arrows.walked).toBeGreaterThan(1);
  expect(Math.abs(arrows.speed - wasd.speed), 'arrow keys must drive the sim exactly like WASD').toBeLessThan(0.01);

  // Looking far up and far down must stop at the clamp, never flip over. Big
  // drags in one step each: the sweep needs distance, not smoothness.
  const dragPitch = async (dy, times) => {
    for (let i = 0; i < times; i++) {
      await dragLook(page, 0, dy, 1);
      await stepSim(page, 0.05);
    }
    return (await readDebug(page)).camera.pitch;
  };
  expect(await dragPitch(-400, 2)).toBeCloseTo(PITCH_LIMIT, 2);
  expect(await dragPitch(400, 3)).toBeCloseTo(-PITCH_LIMIT, 2);
  expect((await readDebug(page)).player.grounded).toBe(true);

  await page.keyboard.press('r');
  const reset = await stepSim(page, 0.05);
  expect(reset.camera.yaw).toBeCloseTo(0, 3);
  expect(reset.camera.pitch).toBeCloseTo(-0.04, 3);
  watch.assertClean();
});

test('the tuning panel drives the sim, the URL and localStorage', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard-driven; the phone project covers the dock instead');
  const watch = attachWatch(page);
  await gotoGame(page);

  await page.keyboard.press('p');
  await expect(page.locator('.tuning-panel')).toBeVisible();

  const start = await readDebug(page);
  const slider = page.locator('#setting-fog');
  await slider.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  // Let go: `change` fires on blur, which is when the value is persisted.
  await page.locator('.tuning-panel .panel__title').click();
  await page.waitForTimeout(250);

  const tuned = await readDebug(page);
  expect(tuned.fogDensity).toBeGreaterThan(start.fogDensity);
  expect(tuned.settings.fog).toBe(tuned.fogDensity);
  expect(page.url()).toContain(`fog=${tuned.fogDensity}`);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhopper.settings.v1')));
  expect(stored.fog).toBe(tuned.fogDensity);

  // The panel hands back a pasteable config link.
  const configUrl = await page.evaluate(() => window.__worldhopper.ui.configUrl());
  expect(configUrl).toContain(`fog=${tuned.fogDensity}`);
  expect(configUrl).toContain('seed=');

  await saveShot(page, 'tuning-panel', testInfo);

  // Persistence: a reload keeps the tuned feel, and the URL alone is enough.
  await page.reload();
  await page.waitForFunction(() => window.__worldhopper?.ready === true);
  const reloaded = await readDebug(page);
  expect(reloaded.fogDensity).toBe(tuned.fogDensity);

  await page.goto(`/?seed=${tuned.seed}&fog=${tuned.fogDensity}`);
  await page.waitForFunction(() => window.__worldhopper?.ready === true);
  const fromUrl = await readDebug(page);
  expect(fromUrl.fogDensity).toBe(tuned.fogDensity);
  expect(fromUrl.seed).toBe(tuned.seed);

  // Reset returns to defaults and clears the stored tuning.
  await page.goto('/');
  await page.waitForFunction(() => window.__worldhopper?.ready === true);
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'reset' }).click();
  await page.waitForTimeout(250);
  const reset = await readDebug(page);
  // The schema owns the default; a hard-coded number here would rot silently.
  expect(reset.fogDensity).toBe(SETTING_BY_KEY.fog.default);
  // Back at defaults: the stored tuning is cleared and the URL is bare again.
  expect(await page.evaluate(() => localStorage.getItem('worldhopper.settings.v1'))).toBeNull();
  expect(page.url()).not.toContain('fog=');

  watch.assertClean();
});

test('palette variants change the atmosphere and the picture', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  expect(before.palette).toBe('ashen-basin');
  const firstShot = await saveShot(page, `palette-${before.palette}`, testInfo);

  let expected;
  if (isMobile) {
    // The phone drives it from the dev dock: cycles to the next variant.
    await page.goto('/?dev=1');
    await page.waitForFunction(() => window.__worldhopper?.ready === true);
    await page.locator('.dock__button[aria-label*="palette"]').tap();
    expected = 'mist-sea';
  } else {
    await page.keyboard.press('p');
    await page.locator('#setting-palette').selectOption('cold-ridge');
    expected = 'cold-ridge';
  }
  await page.waitForTimeout(350);

  const after = await readDebug(page);
  expect(after.palette).toBe(expected);
  const secondShot = await saveShot(page, `palette-${after.palette}`, testInfo);

  const fs = await import('node:fs');
  expect(fs.readFileSync(firstShot).equals(fs.readFileSync(secondShot))).toBe(false);

  watch.assertClean();
});
