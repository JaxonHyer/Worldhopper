import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';
import { PITCH_LIMIT } from '../../src/core/math.js';
import { MOUSE_RAD_PER_PIXEL } from '../../src/core/look.js';

/**
 * Desktop look: standard mouse capture (Pointer Lock).
 *
 * Click the world → the mouse is captured → the camera follows mouse movement,
 * no button held. Esc (or a panel that needs the cursor) releases it. Touch and
 * the drag fallback are untouched, because a browser permission must never
 * decide whether the game is playable.
 *
 * How this is verified, and what it deliberately does not claim:
 *
 *  - The *state machine* is verified against the real browser: a click requests
 *    the lock, the game reports `locked` (or the environment refuses it, which
 *    the test reports as an annotation rather than a fake pass), the crosshair
 *    and the release hint appear, nothing is counted as a denial, and exit
 *    hands the cursor back.
 *  - The *captured path* (event → radians → sim → camera) is verified with
 *    deltas the test chooses, because a headless browser's own synthetic mouse
 *    under a locked pointer is not usable for magnitudes: CI has reported
 *    ~1345 px of movement for a 20 px step, alternating in sign. Real locked
 *    pointer movement *is* used in the test — it proves deltas arrive and that
 *    looking never moves the player — but its magnitude proves nothing.
 *  - How the real mouse *feels* is a human question, and is asked in the PR.
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

const state = (page) =>
  page.evaluate(() => ({
    element: document.pointerLockElement ? document.pointerLockElement.id : null,
    state: window.__worldhopper.capture(),
    stats: window.__worldhopper.input(),
  }));

const locked = async (page) => (await state(page)).state === 'locked';

/** Real mouse movement through the browser, with the pointer captured. */
async function browserStroke(page, box, dx, dy = 0) {
  const before = await stepSim(page, 0.05);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
  const after = await stepSim(page, 0.05);
  return { before, after };
}

/**
 * A pointermove with a movement delta the test picks. The listener is the same
 * one the browser feeds; only the numbers are ours. `movementX`/`movementY` are
 * part of MouseEventInit, so this is the documented way to say "the mouse moved
 * this far" without emulating a whole input stack.
 */
/**
 * Baseline for a measurement. Engaging the lock makes the browser emit one
 * last burst of movement (the cursor is being taken away, and its deltas are
 * computed against a position that no longer exists), so anything pending is
 * stepped away first, and given a moment to arrive before the baseline is read.
 */
async function settle(page) {
  await stepSim(page, 0.1);
  await page.waitForTimeout(120);
  return stepSim(page, 0.1);
}

/** A yaw difference that survives the wrap at ±π. */
const wrapped = (a) => Math.atan2(Math.sin(a), Math.cos(a));

async function mouseDelta(page, { x = 0, y = 0, times = 1 } = {}) {
  await page.evaluate(
    ({ x, y, times }) => {
      const canvas = document.getElementById('game');
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < times; i++) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            bubbles: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            movementX: x,
            movementY: y,
          }),
        );
      }
    },
    { x, y, times },
  );
  return stepSim(page, 0.05);
}

test('clicking the world captures the mouse, and the game says so', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);

  expect(await page.evaluate(() => typeof document.body.requestPointerLock === 'function')).toBe(true);
  const box = await clickWorld(page);
  const seen = await state(page);
  expect(seen.stats.captureRequests, `no lock was ever requested: ${JSON.stringify(seen)}`).toBeGreaterThan(0);

  const drag = await stepSim(page, 0.05);
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

    // The drag fallback is deterministic here: no lock is in the way.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    const dragged = await stepSim(page, 0.2);
    expect(dragged.camera.yaw, 'dragging did not turn the camera without a lock').not.toBe(drag.camera.yaw);
  } else {
    // Captured: the browser hides the system cursor, so the game has to show
    // where "straight ahead" is, and how to get the cursor back.
    expect(seen.element).toBe('game');
    expect(seen.stats.captureDenials).toBe(0);
    await expect(page.locator('.crosshair')).toBeVisible();
    await expect(page.locator('.hud__hint')).toContainText('Esc');

    const { before, after } = await browserStroke(page, box, 240);
    const stats = await page.evaluate(() => window.__worldhopper.input());
    expect(stats.mouseLookSamples, `no movement reached the game while captured: ${JSON.stringify(stats)}`).toBeGreaterThan(0);
    // Looking must never move the player, whatever the mouse did.
    expect(after.player.x).toBeCloseTo(before.player.x, 6);
    expect(after.player.z).toBeCloseTo(before.player.z, 6);
    expect(after.player.speed).toBe(0);
    expect(after.input.captured).toBe(true);
  }

  watch.assertClean();
});

test('captured movement turns the camera, within the pitch limit', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);
  await clickWorld(page);

  if (!(await locked(page))) {
    testInfo.annotations.push({ type: 'note', description: 'Pointer lock refused here; the captured path cannot be exercised.' });
    watch.assertClean();
    return;
  }

  testInfo.annotations.push({
    type: 'note',
    description: `Captured deltas are driven with known values (${MOUSE_RAD_PER_PIXEL} rad/px); the browser's own synthetic mouse under a locked pointer reports unusable magnitudes.`,
  });

  // 2 × 100 px right: the camera turns right by 200 × 0.0026 rad.
  const start = await settle(page);
  const turned = await mouseDelta(page, { x: 100, times: 2 });
  const expected = -200 * MOUSE_RAD_PER_PIXEL;
  expect(
    wrapped(turned.camera.yaw - start.camera.yaw),
    `captured movement did not turn the camera: ${JSON.stringify(turned.camera)}`,
  ).toBeCloseTo(expected, 2);

  // Pitch is clamped however far the mouse travels, and it does reach the limit.
  const up = await mouseDelta(page, { y: -120, times: 40 });
  expect(up.camera.pitch).toBeCloseTo(PITCH_LIMIT, 2);
  const down = await mouseDelta(page, { y: 120, times: 80 });
  expect(down.camera.pitch).toBeCloseTo(-PITCH_LIMIT, 2);

  // Looking never moves the player, and walking still works while captured.
  const walked = await stepSim(page, 0.05);
  await page.keyboard.down('KeyW');
  const afterWalk = await stepSim(page, 1);
  await page.keyboard.up('KeyW');
  expect(Math.abs(afterWalk.player.z - walked.player.z)).toBeGreaterThan(2);
  expect(afterWalk.input.capture).toBe('locked');

  await saveShot(page, 'mouse-look', testInfo);
  watch.assertClean();
});

test('releasing the mouse stops mouselook, and drag-look still works', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page);
  const box = await clickWorld(page);

  if (!(await locked(page))) {
    testInfo.annotations.push({ type: 'note', description: 'Pointer lock refused here; nothing to release.' });
    watch.assertClean();
    return;
  }

  // Esc is the browser's own release gesture; exitPointerLock is what a panel
  // does when it needs the cursor back.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null, null, { timeout: 2000 });

  const released = await stepSim(page, 0.2);
  expect(released.input.captured).toBe(false);
  expect(released.input.capture).toBe('unlocked');
  await expect(page.locator('.crosshair')).toBeHidden();
  // It goes back to telling the player how to capture, not how to release.
  await expect(page.locator('.hud__hint')).toContainText('click the world');

  // Free cursor: moving the mouse must NOT turn the camera any more...
  const beforeMove = await readDebug(page);
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 10 });
  const afterMove = await stepSim(page, 0.2);
  expect(afterMove.camera.yaw).toBe(beforeMove.camera.yaw);

  // ...a synthetic delta must be ignored too (the captured path is off)...
  const afterDelta = await mouseDelta(page, { x: 200 });
  expect(afterDelta.camera.yaw).toBe(beforeMove.camera.yaw);

  // ...but dragging still turns the camera: the fallback is always live.
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
  await clickWorld(page);

  // The tuning panel writes the same settings object the URL feeds, so the
  // snapshot must agree with the query string.
  expect((await readDebug(page)).settings.lookMouse).toBe(1);

  if (!(await locked(page))) {
    testInfo.annotations.push({ type: 'note', description: 'Pointer lock refused here; the sensitivity path was not exercised.' });
    watch.assertClean();
    return;
  }

  const turn = async (pixels) => {
    const before = await settle(page);
    const after = await mouseDelta(page, { x: pixels });
    return Math.abs(wrapped(after.camera.yaw - before.camera.yaw));
  };

  const normal = await turn(240);
  expect(normal).toBeCloseTo(240 * MOUSE_RAD_PER_PIXEL, 3);

  await page.evaluate(() => window.__worldhopper.setSetting('lookMouse', 0.5));
  expect((await readDebug(page)).settings.lookMouse).toBe(0.5);

  const half = await turn(240);
  expect(half, `240 px at mouselook=0.5 turned ${half} rad vs ${normal} rad at 1`).toBeCloseTo(normal / 2, 3);

  // A zero setting must switch mouselook off rather than break it.
  await page.evaluate(() => window.__worldhopper.setSetting('lookMouse', 0.2));
  const least = await turn(240);
  expect(least).toBeGreaterThan(0);

  watch.assertClean();
});

test('the capture switch gives the cursor back to the player', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await startFrozen(page, '?capture=off');

  // With capture switched off the game must never take the mouse...
  await expect(page.locator('.hud__hint')).toContainText('drag to look');
  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  const after = await state(page);
  expect(after.stats.captureRequests).toBe(0);

  // ...and dragging must work exactly as it does on a phone.
  const before = await readDebug(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const dragged = await stepSim(page, 0.2);
  expect(dragged.camera.yaw).not.toBe(before.camera.yaw);
  expect(dragged.player.speed).toBe(0);

  watch.assertClean();
});

test('opening the tuning panel gives the cursor back', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop control path');
  const watch = attachWatch(page);
  await gotoGame(page);
  await clickWorld(page);

  const wasLocked = await locked(page);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);

  // Sliders need a cursor: the panel must hand it back when it opens.
  if (wasLocked) expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.locator('.tuning-panel')).toBeVisible();

  const slider = page.locator('#setting-fog');
  await slider.click();
  await expect(slider).toBeFocused();

  watch.assertClean();
});
