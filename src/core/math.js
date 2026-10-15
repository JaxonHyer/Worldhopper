/** Small maths helpers shared by sim + input. Pure, no imports, no state. */

/** Pitch clamp keeps the view from flipping over at the poles. */
export const PITCH_LIMIT = Math.PI / 2 - 0.02;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function wrapAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distanceFromOrigin(position) {
  return Math.hypot(position.x, position.y, position.z);
}
