import test from 'node:test';
import assert from 'node:assert/strict';
import { fbm2, hash2, valueNoise2 } from '../../src/core/noise.js';

test('hash2 is deterministic, integer-driven and bounded', () => {
  assert.equal(hash2(3, 4, 11), hash2(3, 4, 11));
  assert.notEqual(hash2(3, 4, 11), hash2(4, 3, 11));
  for (let x = -20; x < 20; x++) {
    for (let y = -20; y < 20; y++) {
      const value = hash2(x, y, 5);
      assert.ok(value >= 0 && value < 1, `hash2(${x}, ${y}) = ${value}`);
    }
  }
});

test('value noise is continuous: neighbouring samples stay close', () => {
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const x = i * 0.037;
    const a = valueNoise2(x, 1.5, 3);
    const b = valueNoise2(x + 0.01, 1.5, 3);
    worst = Math.max(worst, Math.abs(a - b));
  }
  assert.ok(worst < 0.05, `noise jumped by ${worst} over a 0.01 step`);
});

test('value noise is deterministic per seed and normalised', () => {
  for (let i = 0; i < 300; i++) {
    const value = valueNoise2(i * 0.13, i * 0.07, 17);
    assert.ok(value >= 0 && value <= 1, `value out of [0,1]: ${value}`);
    assert.equal(value, valueNoise2(i * 0.13, i * 0.07, 17));
  }
});

test('fbm stays in range and responds to the seed', () => {
  const samplesA = [];
  const samplesB = [];
  for (let i = 0; i < 128; i++) {
    const a = fbm2(i * 0.05, i * 0.03, 1, 3);
    const b = fbm2(i * 0.05, i * 0.03, 2, 3);
    assert.ok(a >= 0 && a <= 1, `fbm out of [0,1]: ${a}`);
    samplesA.push(a);
    samplesB.push(b);
  }
  assert.notDeepEqual(samplesA, samplesB);
});
