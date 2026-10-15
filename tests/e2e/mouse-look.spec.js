import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

/**
 * Desktop look: standard mouse capture (Pointer Lock).
 *
 * The environment decides which path this suite can verify, and it says so
 * rather than pretending: a browser context that refuses the lock (an embedded
 * frame without the `pointer-lock` permission, for instance) exercises the
 * fallback assertions instead, and the test records that in its annotations.
 * Either way the *game* has to be playable, and the visible state has to match
 * the input state.
 */

async function lockState(page) {
  return page.evaluate(() => ({
    element: document.pointerLockElement ? document.pointerLockElement.id : null,
    capture: window.__worldhopper.capture(),
    stats: window.__worldhopper.input(),
  }));
}

test('clicking the world captures the mouse, and then the camera follows it', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);

  // Pointer Lock must at least be available in this browser.
  expect(await page.evaluate(() => typeof document.body.requestPointerLock === 'function')).toBe(true);

  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // The lock is asynchronous (and can be refused), so wait for the outcome.
  await page
    .waitForFunction(() => document.pointerLockElement !== null || window.__worldhopper.capture() === 'denied', null, {
      timeout: 4000,
    })
    .catch(() => {});

  const locked = await lockState(page);
  const hint = await page.locator('.hud__hint').textContent();

  if (locked.capture !== 'locked') {
    // Environment refused the lock: the game must fall back, not break.
    testInfo.annotations.push({
      type: 'note',
      description: `Pointer lock unavailable here (state: ${locked.capture}, error: ${locked.stats.captureError ?? 'n/a'}); verified the drag fallback and the hint instead.`,
    });
    expect(['denied', 'pending']).toContain(locked.capture);
    expect(hint).toContain('drag to look');

    // Fallback: dragging with the button held still turns the camera.
    const before = await readDebug(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = await stepSim(page, 0.2);
    expect(after.camera.yaw).not.toBe(before.camera.yaw);
    watch.assertClean();
    return;
  }

  expect(locked.element).toBe('game');
  expect(locked.stats.captureRequests).toBeGreaterThan(0);
  expect(locked.stats.captureDenials).toBe(0);

  // The crosshair is the only thing telling the player where straight ahead is.
  await expect(page.locator('.crosshair')).toBeVisible();
  await expect(page.locator('.hud__hint')).toBeHidden();

  const before = await stepSim(page, 0.05);
  // No button held: just move the mouse.
  await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 2, { steps: 12 });
  const after = await stepSim(page, 0.05);

  expect(after.camera.yaw).not.toBe(before.camera.yaw);
  expect(Math.abs(after.camera.yaw - before.camera.yaw)).toBeGreaterThan(0.2);
  expect(after.input.captured).toBe(true);
  expect(after.input.capture).toBe('locked');

  // Mouselook turns the camera; it must never move the player.
  expect(after.player.x).toBeCloseTo(before.player.x, 6);
  expect(after.player.z).toBeCloseTo(before.player.z, 6);
  expect(after.player.speed).toBe(0);

  // Looking up and down is clamped, however far the mouse travels: sweep the
  // full height repeatedly (deltas accumulate under pointer lock).
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2, { steps: 4 });
  }
  const afterSweep = await stepSim(page, 0.05);
  expect(Math.abs(afterSweep.camera.pitch)).toBeLessThanOrEqual(Math.PI / 2);
  expect(Math.abs(afterSweep.camera.pitch)).toBeLessThan(1.6);

  // Movement still works while captured, and the mouse keeps looking.
  await page.keyboard.down('KeyW');
  const walked = await stepSim(page, 1);
  await page.keyboard.up('KeyW');
  expect(Math.abs(walked.player.z - after.player.z)).toBeGreaterThan(2);
  expect(walked.input.captured).toBe(true);

  await saveShot(page, 'mouse-look', testInfo);
  watch.assertClean();
});

test('releasing the mouse stops mouselook, and drag-look still works', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);

  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page
    .waitForFunction(() => document.pointerLockElement !== null || window.__worldhopper.capture() === 'denied', null, {
      timeout: 4000,
    })
    .catch(() => {});

  if ((await lockState(page)).capture !== 'locked') {
    test.info().annotations.push({ type: 'note', description: 'Pointer lock unavailable; nothing to release.' });
    watch.assertClean();
    return;
  }

  const captured = await stepSim(page, 0.05);
  expect(captured.input.captured).toBe(true);

  // Esc is the browser's own release gesture; exitPointerLock is what a UI
  // panel does when it needs the cursor back (the panel does this itself).
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null, null, { timeout: 2000 });

  const released = await stepSim(page, 0.2);
  expect(released.input.captured).toBe(false);
  expect(released.input.capture).toBe('unlocked');
  await expect(page.locator('.crosshair')).toBeHidden();

  // Free cursor: moving the mouse must NOT turn the camera any more...
  const beforeMove = await readDebug(page);
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 10 });
  const afterMove = await stepSim(page, 0.2);
  expect(afterMove.camera.yaw).toBe(beforeMove.camera.yaw);

  // ...but dragging still does (the fallback is always live).
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 500, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const afterDrag = await stepSim(page, 0.2);
  expect(afterDrag.camera.yaw).not.toBe(afterMove.camera.yaw);

  watch.assertClean();
});

test('the mouse-look sensitivity slider changes how far the camera turns', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page, '?mouselook=1');

  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page
    .waitForFunction(() => document.pointerLockElement !== null || window.__worldhopper.capture() === 'denied', null, {
      timeout: 4000,
    })
    .catch(() => {});

  if ((await lockState(page)).capture !== 'locked') {
    test.info().annotations.push({ type: 'note', description: 'Pointer lock unavailable; sensitivity path not exercised.' });
    // The snapshot must still agree with the URL, which is what the panel writes.
    expect((await readDebug(page)).settings.lookMouse).toBe(1);
    watch.assertClean();
    return;
  }

  // Pointer-lock deltas accumulate, so identical physical strokes are
  // comparable: measure one 200 px stroke, then repeat it at half the setting.
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const stroke = async () => {
    await page.mouse.move(centreX, centreY, { steps: 4 });
    const start = await stepSim(page, 0.05);
    await page.mouse.move(centreX + 200, centreY, { steps: 10 });
    const end = await stepSim(page, 0.05);
    return Math.abs(end.camera.yaw - start.camera.yaw);
  };

  const normalTurn = await stroke();
  expect(normalTurn).toBeGreaterThan(0.1);

  await page.evaluate(() => window.__worldhopper.setSetting('lookMouse', 0.5));
  expect((await readDebug(page)).settings.lookMouse).toBe(0.5);

  const halfTurn = await stroke();
  expect(halfTurn).toBeGreaterThan(0.02, 'the slider must not disable looking');
  expect(halfTurn / normalTurn).toBeGreaterThan(0.3);
  expect(halfTurn / normalTurn).toBeLessThan(0.7);

  watch.assertClean();
});

test('opening the tuning panel gives the cursor back', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await gotoGame(page);

  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page
    .waitForFunction(() => document.pointerLockElement !== null || window.__worldhopper.capture() === 'denied', null, {
      timeout: 4000,
    })
    .catch(() => {});

  const locked = (await lockState(page)).capture === 'locked';
  await page.keyboard.press('p');
  await page.waitForTimeout(200);

  // Sliders need a cursor: the panel must release the capture when it opens.
  if (locked) {
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  }
  await expect(page.locator('.tuning-panel')).toBeVisible();

  // And the panel is usable with the mouse immediately.
  const slider = page.locator('#setting-fog');
  await slider.click();
  await expect(slider).toBeFocused();

  watch.assertClean();
});
