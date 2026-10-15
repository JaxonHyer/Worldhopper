import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMove, stickKnob, stickVector } from '../../src/core/stick.js';

const R = 60;

test('no movement means no intent', () => {
  for (const [dx, dy] of [[0, 0], [1, 1], [4, -3], [9, 0]]) {
    const vector = stickVector(dx, dy, { radius: R, deadzone: 0.16 });
    assert.equal(vector.x, 0, `(${dx}, ${dy}) should be inside the dead zone`);
    assert.equal(vector.y, 0);
    assert.equal(vector.active, false);
  }
});

test('up on the screen is forward', () => {
  const up = stickVector(0, -R, { radius: R });
  assert.ok(up.y > 0.99, `forward should be positive y, got ${up.y}`);
  assert.equal(Math.abs(up.x) < 1e-9, true);

  const down = stickVector(0, R, { radius: R });
  assert.ok(down.y < -0.99, 'pulling down walks backwards');

  const right = stickVector(R, 0, { radius: R });
  assert.ok(right.x > 0.99, 'right on the screen is right in the world');
});

test('magnitude grows with travel and saturates at the ring', () => {
  const half = stickVector(0, -R / 2, { radius: R });
  const full = stickVector(0, -R, { radius: R });
  const beyond = stickVector(0, -R * 4, { radius: R });
  assert.ok(half.magnitude > 0.3 && half.magnitude < 0.7, `half deflection gave ${half.magnitude}`);
  assert.ok(Math.abs(full.magnitude - 1) < 1e-9);
  assert.ok(Math.abs(beyond.magnitude - 1) < 1e-9, 'a long drag clamps to one');
  assert.ok(Math.abs(beyond.y - 1) < 1e-9, 'and keeps its direction');
});

test('the dead zone is rescaled, not truncated', () => {
  // Just past the dead zone must be a small but useful amount, and the range
  // from the dead zone to the ring must stretch to 0..1.
  const justPast = stickVector(0, -R * 0.2, { radius: R, deadzone: 0.16 });
  assert.ok(justPast.magnitude > 0.01 && justPast.magnitude < 0.1, `got ${justPast.magnitude}`);
  const atRing = stickVector(0, -R, { radius: R, deadzone: 0.16 });
  assert.ok(Math.abs(atRing.magnitude - 1) < 1e-9);
});

test('diagonals never exceed full speed', () => {
  const vector = stickVector(R * 0.8, -R * 0.8, { radius: R });
  assert.ok(Math.hypot(vector.x, vector.y) <= 1 + 1e-9, 'the stick is a circle, not a square');
});

test('junk input cannot produce NaN', () => {
  for (const [dx, dy, radius] of [
    [Number.NaN, 0, R],
    [0, Number.NaN, R],
    [10, 10, 0],
    [10, 10, -5],
    [10, 10, Number.NaN],
  ]) {
    const vector = stickVector(dx, dy, { radius });
    assert.ok(Number.isFinite(vector.x) && Number.isFinite(vector.y), `NaN from ${dx},${dy},${radius}`);
  }
});

test('the knob stays inside the ring', () => {
  assert.deepEqual(stickKnob(10, -10, R), { x: 10, y: -10, clamped: false });
  const clamped = stickKnob(0, -R * 3, R);
  assert.ok(clamped.clamped);
  assert.ok(Math.abs(clamped.y + R) < 1e-9);
  assert.ok(Number.isFinite(stickKnob(Number.NaN, 0, R).x));
});

test('keyboard-style input is normalised so diagonals are not faster', () => {
  assert.deepEqual(normalizeMove(0, 1), { x: 0, y: 1, magnitude: 1 });
  const diagonal = normalizeMove(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  const partial = normalizeMove(0.4, 0.3);
  assert.equal(partial.magnitude, 0.5, 'input inside the circle is left alone');
});
