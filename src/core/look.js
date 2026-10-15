/**
 * Look maths, kept out of the DOM layer so it can be asserted headlessly.
 *
 * `rate` is rad/s intent (held keys or an on-screen stick);
 * `impulse` is a one-shot radians delta (pointer/touch drag).
 */

import { clamp, wrapAngle, PITCH_LIMIT } from './math.js';

export function applyLookImpulse(observer, { yaw = 0, pitch = 0 } = {}, { sensitivity = 1, invertY = false } = {}) {
  if (!observer) return observer;
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return observer;
  observer.yaw = wrapAngle(observer.yaw - yaw * sensitivity);
  observer.pitch = clamp(observer.pitch - pitch * sensitivity * (invertY ? -1 : 1), -PITCH_LIMIT, PITCH_LIMIT);
  return observer;
}

export function applyLookRate(observer, { x = 0, y = 0 } = {}, dt, { sensitivity = 1, invertY = false } = {}) {
  if (!observer || !Number.isFinite(dt) || dt <= 0) return observer;
  return applyLookImpulse(observer, { yaw: x * dt, pitch: y * dt }, { sensitivity, invertY });
}

/** Combined entry used by the sim tick. */
export function applyLook(observer, input, dt, options = {}) {
  if (!observer || !input) return observer;
  if (input.lookImpulse) applyLookImpulse(observer, input.lookImpulse, options);
  if (input.lookRate) applyLookRate(observer, input.lookRate, dt, options);
  return observer;
}

export { PITCH_LIMIT };
