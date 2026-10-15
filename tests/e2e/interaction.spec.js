import { test, expect } from '@playwright/test';
import { attachWatch, dragLook, gotoGame, holdKey, readDebug, saveShot, touchDrag } from './helpers.js';
import { PITCH_LIMIT } from '../../src/core/math.js';
import { SETTING_BY_KEY } from '../../src/core/settings.js';

/**
 * Scripted input: drag/keys move the camera, panel changes reach the sim AND
 * the URL/localStorage, and a tuned config can be pasted back (§8).
 */

test('pointer/touch drag looks around without moving the player', async ({ page, isMobile }) => {
  const watch = attachWatch(page);
  await gotoGame(page);

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
  expect(inputAfter.dragRadians, `drag deltas were zero: ${JSON.stringify(inputAfter)}`).toBeGreaterThan(0.2);

  expect(after.camera.yaw).not.toBe(before.camera.yaw);
  expect(Math.abs(after.camera.yaw - before.camera.yaw)).toBeGreaterThan(0.2);
  // M0 has no locomotion: the eye must not have travelled.
  expect(after.camera.x).toBeCloseTo(before.camera.x, 6);
  expect(after.camera.y).toBeCloseTo(before.camera.y, 6);
  expect(after.camera.z).toBeCloseTo(before.camera.z, 6);

  watch.assertClean();
});

test('arrow keys look at a controlled rate and pitch stays clamped', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no keyboard on the phone project');
  const watch = attachWatch(page);
  await gotoGame(page);

  const before = await readDebug(page);
  await holdKey(page, 'ArrowLeft', 400);
  const afterLeft = await readDebug(page);
  expect(afterLeft.camera.yaw).toBeGreaterThan(before.camera.yaw);

  await holdKey(page, 'ArrowUp', 3000);
  const afterUp = await readDebug(page);
  // The clamp itself (PI/2 - 0.02), not a hand-picked number that sits below it.
  expect(Math.abs(afterUp.camera.pitch)).toBeLessThanOrEqual(PITCH_LIMIT + 1e-3);

  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  const afterReset = await readDebug(page);
  expect(afterReset.camera.yaw).toBeCloseTo(0, 3);
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
