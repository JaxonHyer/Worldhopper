/**
 * Virtual-stick maths, kept out of the DOM so it can be asserted headlessly.
 *
 * Screen deltas in, movement intent out. Convention: up on the screen is
 * forward (positive y), which is what every thumb expects.
 */

/**
 * @param {number} dx horizontal drag from the stick's origin, in pixels (right = +)
 * @param {number} dy vertical drag from the stick's origin, in pixels (down = +)
 * @param {object} [options]
 * @param {number} [options.radius] pixels of travel that mean "full deflection"
 * @param {number} [options.deadzone] fraction of radius ignored at the centre
 * @returns {{x: number, y: number, magnitude: number, active: boolean}}
 *   x/y in [-1, 1], magnitude in [0, 1]; a dead zone yields zeros, and a long
 *   drag is clamped to the unit circle rather than squaring the diagonal.
 */
export function stickVector(dx, dy, { radius = 64, deadzone = 0.16 } = {}) {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 64;
  const screenX = Number.isFinite(dx) ? dx : 0;
  const screenY = Number.isFinite(dy) ? dy : 0;

  const distance = Math.hypot(screenX, screenY);
  if (distance === 0) return { x: 0, y: 0, magnitude: 0, active: false };

  const clamped = Math.min(1, distance / safeRadius);
  const dead = Math.min(0.9, Math.max(0, Number.isFinite(deadzone) ? deadzone : 0));
  if (clamped <= dead) return { x: 0, y: 0, magnitude: 0, active: false };

  // Rescale so the dead zone does not eat the first slice of the range: the
  // player gets full deflection at the ring, not 16% of the way past it.
  const magnitude = (clamped - dead) / (1 - dead);
  const directionX = screenX / distance;
  const directionY = screenY / distance;

  return {
    x: directionX * magnitude,
    // Screen down is +y, movement forward is -y.
    y: -directionY * magnitude,
    magnitude,
    active: true,
  };
}

/** Where the knob is drawn, in pixels — inside the ring, never past it. */
export function stickKnob(dx, dy, radius) {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 64;
  const distance = Math.hypot(dx || 0, dy || 0);
  if (distance <= safeRadius || distance === 0) {
    return { x: dx || 0, y: dy || 0, clamped: false };
  }
  const scale = safeRadius / distance;
  return { x: (dx || 0) * scale, y: (dy || 0) * scale, clamped: true };
}

/** Clamp move intent to the unit circle so diagonals are not faster. */
export function normalizeMove(x, y) {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(safeX, safeY);
  if (length <= 1) return { x: safeX, y: safeY, magnitude: length };
  return { x: safeX / length, y: safeY / length, magnitude: 1 };
}
