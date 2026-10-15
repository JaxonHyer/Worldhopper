import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

/**
 * Desktop look: standard mouse capture (Pointer Lock).
 *
 * Click the world → the mouse is captured → the camera follows mouse movement,
 * no button held. Esc (or a panel that needs the cursor) releases it. Touch and
 * the drag fallback are untouched and are asserted here too, because a browser
 * permission must never decide whether the game is playable.
 *
 * Whether *this* environment will hand out a pointer lock is not knowable up
 * front, so each test establishes the state first and then asserts the branch
 * that applies — and, when a branch cannot be exercised, says so in an
 * annotation instead of pretending it passed.
 */

async function clickWorld(page) {
  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page
    .waitForFunction(() => document.pointerLockElement !== null || window.__worldhopper.capture() === 'denied', null, {
      timeout: 5000,
    })
    .catch(() => {});
  return box;
}

async function captureState(page) {
  return page.evaluate(() => ({
    element: document.pointerLockElement ? document.pointerLockElement.id : null,
    state: window.__worldhopper.capture(),
    stats: window.__worldhopper.input(),
  }));
}

/** Move the mouse with the pointer captured and report what the game saw. */
async function stroke(page, box, dx, dy = 0) {
  const before = await stepSim(page, 0.05);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
  const after = await stepSim(page, 0.05);
  return { before, after, turn: Math.abs(after.camera.yaw - before.camera.yaw) };
}

test('clicking the world captures the mouse, and the game says so', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);

  expect(await page.evaluate(() => typeof document.body.requestPointerLock === 'function')).toBe(true);
  const box = await clickWorld(page);
  const seen = await captureState(page);

  expect(seen.stats.captureRequests, `no lock was ever requested: ${JSON.stringify(seen)}`).toBeGreaterThan(0);

  if (seen.state !== 'locked') {
    // A frame without the `pointer-lock` permission refuses; the game must fall
    // back rather than break, and must say what it is doing.
    testInfo.annotations.push({
      type: 'note',
      description: `Pointer lock refused here (state: ${seen.state}, reason: ${seen.stats.captureError}, fallbacks: ${seen.stats.captureFallbacks}); asserted the drag fallback and the hint instead.`,
    });
    expect(['denied', 'pending']).toContain(seen.state);
    await expect(page.locator('.hud__hint')).toContainText('drag to look');
    await expect(page.locator('.crosshair')).toBeHidden();
  } else {
    // Captured: the browser hides the system cursor, so the game has to show
    // where "straight ahead" is, and stop telling the player to click.
    expect(seen.element).toBe('game');
    expect(seen.stats.captureDenials).toBe(0);
    await expect(page.locator('.crosshair')).toBeVisible();
    await expect(page.locator('.hud__hint')).toBeHidden();
  }

  // Either way the world is playable with the mouse: dragging turns the camera.
  const drag = await stepSim(page, 0.05);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const dragged = await stepSim(page, 0.2);
  expect(dragged.camera.yaw, `dragging did not turn the camera: ${JSON.stringify(dragged.input)}`).not.toBe(
    drag.camera.yaw,
  );

  watch.assertClean();
});

test('the camera follows the mouse while captured, and the player does not move', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);
  await clickWorld(page);

  if ((await captureState(page)).state !== 'locked') {
    testInfo.annotations.push({ type: 'note', description: 'Pointer lock refused here; mouselook cannot be exercised.' });
    watch.assertClean();
    return;
  }

  const { before, after, turn } = await stroke(page, await page.locator('#game').boundingBox(), 240);
  const stats = after.input;

  if (stats.mouseLookSamples === 0) {
    // Nothing verifiable about the *movement* path here: a synthetic mouse with
    // a locked pointer reports neither movement deltas nor a moved cursor.
    testInfo.annotations.push({
      type: 'note',
      description: `Pointer locked, but this browser reports no mouse deltas under lock (samples ${stats.mouseLookSamples}, pixels ${stats.mouseLookPixels}); the capture state machine is verified, the mouselook feel needs a human.`,
    });
  } else {
    expect(stats.mouseLookPixels, `captured movement was not measured: ${JSON.stringify(stats)}`).toBeGreaterThan(100);
    expect(turn, `the camera did not follow the mouse: ${JSON.stringify(stats)}`).toBeGreaterThan(0.2);
    // Mouselook turns the camera; it must never move the player.
    expect(after.player.x).toBeCloseTo(before.player.x, 6);
    expect(after.player.z).toBeCloseTo(before.player.z, 6);
    expect(after.player.speed).toBe(0);

    // Looking up and down stays clamped, however far the mouse travels.
    for (let i = 0; i < 8; i++) {
      await stroke(page, await page.locator('#game').boundingBox(), 0, -300);
      await stroke(page, await page.locator('#game').boundingBox(), 0, 300);
    }
    const swept = await readDebug(page);
    expect(Math.abs(swept.camera.pitch)).toBeLessThan(1.6);
  }

  // Movement still works while captured, and mouselook stays live.
  const walked = await stepSim(page, 0.05);
  await page.keyboard.down('KeyW');
  const afterWalk = await stepSim(page, 1);
  await page.keyboard.up('KeyW');
  expect(Math.abs(afterWalk.player.z - walked.player.z)).toBeGreaterThan(2);
  expect(afterWalk.input.captured).toBe(true);

  await saveShot(page, 'mouse-look', testInfo);
  watch.assertClean();
});

test('releasing the mouse stops mouselook, and drag-look still works', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);
  const box = await clickWorld(page);

  if ((await captureState(page)).state !== 'locked') {
    testInfo.annotations.push({ type: 'note', description: 'Pointer lock refused here; nothing to release.' });
    watch.assertClean();
    return;
  }

  await stepSim(page, 0.05);
  expect((await readDebug(page)).input.captured).toBe(true);

  // Esc is the browser's own release gesture; exitPointerLock is what a panel
  // does when it needs the cursor back.
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

  // ...but dragging still does: the fallback is always live.
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 500, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const afterDrag = await stepSim(page, 0.2);
  expect(afterDrag.camera.yaw).not.toBe(afterMove.camera.yaw);

  watch.assertClean();
});

test('the mouse-look sensitivity slider changes how far the camera turns', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page, '?mouselook=1');
  const box = await clickWorld(page);

  // The snapshot must agree with the URL, whichever path the lock took: the
  // tuning panel and the query string are the same settings object.
  expect((await readDebug(page)).settings.lookMouse).toBe(1);

  const state = await captureState(page);
  if (state.state !== 'locked') {
    testInfo.annotations.push({ type: 'note', description: 'Pointer lock refused here; sensitivity path not exercised.' });
    watch.assertClean();
    return;
  }

  const normal = (await stroke(page, box, 240)).turn;
  if (normal === 0) {
    testInfo.annotations.push({
      type: 'note',
      description: 'Pointer locked, but this browser reports no mouse deltas under lock; the sensitivity scale is unit-tested instead.',
    });
    watch.assertClean();
    return;
  }

  await page.evaluate(() => window.__worldhopper.setSetting('lookMouse', 0.5));
  expect((await readDebug(page)).settings.lookMouse).toBe(0.5);

  const half = (await stroke(page, box, 240)).turn;
  expect(half).toBeGreaterThan(0, 'the slider must not disable looking');
  const ratio = half / normal;
  expect(ratio, `240 px at mouselook=0.5 turned ${half} rad vs ${normal} rad at 1`).toBeGreaterThan(0.3);
  expect(ratio).toBeLessThan(0.7);

  watch.assertClean();
});

test('opening the tuning panel gives the cursor back', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await gotoGame(page);
  await clickWorld(page);

  const locked = (await captureState(page)).state === 'locked';
  await page.keyboard.press('p');
  await page.waitForTimeout(250);

  // Sliders need a cursor: the panel must hand it back when it opens.
  if (locked) expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.locator('.tuning-panel')).toBeVisible();

  const slider = page.locator('#setting-fog');
  await slider.click();
  await expect(slider).toBeFocused();

  watch.assertClean();
});
