/**
 * Look maths, kept out of the DOM layer so it can be asserted headlessly.
 *
 * Two paths, deliberately with different base sensitivities:
 *  - `pixelsToLook` for a *captured* mouse (pointer lock): this is raw-ish
 *    FPS mouselook, where every pixel of mouse travel should turn an amount a
 *    player expects without any drag gesture;
 *  - `dragToLook` for finger/mouse *dragging*, where the cursor is visible and
 *    travels across the glass, so the same physical travel needs a slightly
 *    larger factor to feel equivalent.
 *
 * Both are scaled by the owner's sensitivity sliders in the tuning panel.
 */

import { clamp, wrapAngle, PITCH_LIMIT } from './math.js';

/** Radians per pixel for a captured mouse (pointer lock). */
export const MOUSE_RAD_PER_PIXEL = 0.0026;

/** Radians per pixel for dragging (touch finger, or mouse with the cursor free). */
export const DRAG_RAD_PER_PIXEL = 0.0042;

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Mouse travel -> look delta, in radians.
 * @returns {{yaw: number, pitch: number}} positive yaw turns right, positive pitch turns up
 */
export function pixelsToLook(dx, dy, { radPerPixel = MOUSE_RAD_PER_PIXEL } = {}) {
  const scale = Number.isFinite(radPerPixel) ? radPerPixel : MOUSE_RAD_PER_PIXEL;
  return {
    yaw: finiteOrZero(dx) * scale,
    pitch: finiteOrZero(dy) * scale,
  };
}

/** Drag travel -> look delta, in radians. */
export function dragToLook(dx, dy, { radPerPixel = DRAG_RAD_PER_PIXEL } = {}) {
  return pixelsToLook(dx, dy, { radPerPixel });
}

/**
 * The vertical range a look input is clamped to. The caller may narrow it
 * (third person cannot look as far up as first person: the boom would end up
 * under the floor), but it can never widen it past the flip-over limit, and
 * min/max given the wrong way round are swapped rather than trusted.
 */
export function pitchRange({ pitchMin, pitchMax } = {}) {
  const min = Number.isFinite(pitchMin) ? pitchMin : -PITCH_LIMIT;
  const max = Number.isFinite(pitchMax) ? pitchMax : PITCH_LIMIT;
  const low = clamp(min, -PITCH_LIMIT, PITCH_LIMIT);
  const high = clamp(max, -PITCH_LIMIT, PITCH_LIMIT);
  return low <= high ? { min: low, max: high } : { min: high, max: low };
}

/**
 * Apply a one-shot delta (radians) to an observer.
 * `sensitivity` is the player's slider; `invertY` flips the vertical axis;
 * `pitchMin`/`pitchMax` narrow the vertical range (see `pitchRange`).
 */
export function applyLookImpulse(observer, { yaw = 0, pitch = 0 } = {}, options = {}) {
  if (!observer) return observer;
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return observer;
  const { sensitivity = 1, invertY = false } = options;
  const range = pitchRange(options);
  observer.yaw = wrapAngle(observer.yaw - yaw * sensitivity);
  observer.pitch = clamp(observer.pitch - pitch * sensitivity * (invertY ? -1 : 1), range.min, range.max);
  return observer;
}

/** Apply a per-second rate (rad/s) — held keys, or an on-screen control. */
export function applyLookRate(observer, { x = 0, y = 0 } = {}, dt, options = {}) {
  if (!observer || !Number.isFinite(dt) || dt <= 0) return observer;
  return applyLookImpulse(observer, { yaw: x * dt, pitch: y * dt }, options);
}

/** Combined entry used by the sim tick. */
export function applyLook(observer, input, dt, options = {}) {
  if (!observer || !input) return observer;
  if (input.lookImpulse) applyLookImpulse(observer, input.lookImpulse, options);
  if (input.lookRate) applyLookRate(observer, input.lookRate, dt, options);
  return observer;
}

export { PITCH_LIMIT };
