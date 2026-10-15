import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAG_RAD_PER_PIXEL,
  MOUSE_RAD_PER_PIXEL,
  applyLook,
  applyLookImpulse,
  applyLookRate,
  dragToLook,
  pixelsToLook,
} from '../../src/core/look.js';
import { PITCH_LIMIT } from '../../src/core/math.js';

test('mouse travel converts to radians with the captured-mouse factor', () => {
  const look = pixelsToLook(100, -50);
  assert.ok(Math.abs(look.yaw - 100 * MOUSE_RAD_PER_PIXEL) < 1e-12);
  assert.ok(Math.abs(look.pitch + 50 * MOUSE_RAD_PER_PIXEL) < 1e-12);
});

test('dragging uses its own factor, which is not the same as capture', () => {
  const drag = dragToLook(100, 0);
  const mouse = pixelsToLook(100, 0);
  assert.ok(drag.yaw > mouse.yaw, 'a finger travels across the glass, so it needs more radians per pixel');
  assert.ok(Math.abs(drag.yaw - 100 * DRAG_RAD_PER_PIXEL) < 1e-12);
});

test('both paths accept an explicit factor (the sensitivity sliders)', () => {
  assert.ok(Math.abs(pixelsToLook(100, 0, { radPerPixel: 0.01 }).yaw - 1) < 1e-12);
  assert.ok(Math.abs(dragToLook(100, 0, { radPerPixel: 0.01 }).yaw - 1) < 1e-12);
});

test('a sensitivity of zero means no movement at all', () => {
  const look = pixelsToLook(500, 500, { radPerPixel: 0 });
  assert.equal(look.yaw, 0);
  assert.equal(look.pitch, 0);
});

test('junk mouse input cannot produce NaN', () => {
  for (const [dx, dy, radPerPixel] of [
    [Number.NaN, 0, MOUSE_RAD_PER_PIXEL],
    [0, Number.NaN, MOUSE_RAD_PER_PIXEL],
    [100, 100, Number.NaN],
    [Infinity, -Infinity, 0.01],
    [undefined, undefined, undefined],
  ]) {
    const look = pixelsToLook(dx, dy, { radPerPixel });
    assert.ok(Number.isFinite(look.yaw) && Number.isFinite(look.pitch), `NaN from ${dx},${dy},${radPerPixel}`);
  }
});

test('moving the mouse right turns right, and up looks up', () => {
  const observer = { yaw: 0, pitch: 0 };
  // Screen down is +y, so a negative dy (mouse up) must raise the pitch.
  applyLookImpulse(observer, pixelsToLook(50, -50));
  assert.ok(observer.yaw < 0, 'yaw decreases when turning right (the camera basis flips it)');
  assert.ok(observer.pitch > 0, 'moving the mouse up looks up');
  assert.ok(Math.abs(observer.yaw) - Math.abs(observer.pitch) < 1e-12, 'equal travel, equal angle');
});

test('pitch is clamped no matter how far the mouse travels', () => {
  const observer = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 200; i++) applyLookImpulse(observer, pixelsToLook(0, -400));
  assert.ok(observer.pitch <= PITCH_LIMIT + 1e-12, `pitch escaped: ${observer.pitch}`);
  for (let i = 0; i < 400; i++) applyLookImpulse(observer, pixelsToLook(0, 400));
  assert.ok(observer.pitch >= -PITCH_LIMIT - 1e-12, `pitch escaped: ${observer.pitch}`);
});

test('yaw wraps instead of growing without bound', () => {
  const observer = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 500; i++) applyLookImpulse(observer, pixelsToLook(500, 0));
  assert.ok(observer.yaw > -Math.PI && observer.yaw <= Math.PI, `yaw not wrapped: ${observer.yaw}`);
});

test('invertY flips only the vertical axis', () => {
  const normal = { yaw: 0, pitch: 0 };
  const inverted = { yaw: 0, pitch: 0 };
  applyLookImpulse(normal, pixelsToLook(100, -100));
  applyLookImpulse(inverted, pixelsToLook(100, -100), { invertY: true });
  assert.equal(normal.yaw, inverted.yaw);
  assert.equal(normal.pitch, -inverted.pitch);
});

test('a rate (held keys) integrates over the step, an impulse does not', () => {
  const rate = { yaw: 0, pitch: 0 };
  applyLookRate(rate, { x: 1, y: 0 }, 0.5);
  assert.ok(Math.abs(rate.yaw + 0.5) < 1e-12, 'rate * dt, applied once');

  const impulse = { yaw: 0, pitch: 0 };
  applyLookRate(impulse, { x: 1, y: 0 }, 1 / 60);
  assert.ok(Math.abs(impulse.yaw) < 1 / 60 + 1e-12, 'a single frame of held input moves very little');
});

test('the combined entry ignores missing halves and bad deltas', () => {
  const observer = { yaw: 0.4, pitch: 0.2 };
  applyLook(observer, {}, 1 / 60);
  assert.deepEqual(observer, { yaw: 0.4, pitch: 0.2 });

  applyLook(observer, { lookImpulse: { yaw: Number.NaN, pitch: Number.NaN } }, 1 / 60);
  assert.deepEqual(observer, { yaw: 0.4, pitch: 0.2 }, 'NaN input must not move the camera');

  applyLook(observer, { lookRate: { x: 0, y: 2 } }, 0.25);
  assert.ok(Math.abs(observer.pitch + 0.5 - 0.2) < 1e-12, 'rate applies over dt');
});

test('a null observer is tolerated (defensive, never throws in a frame loop)', () => {
  assert.equal(applyLookImpulse(null, pixelsToLook(10, 10)), null);
  assert.equal(applyLookRate(undefined, { x: 1, y: 0 }, 1 / 60), undefined);
  assert.equal(applyLook(null, { lookRate: { x: 1, y: 0 } }, 1 / 60), null);
});
