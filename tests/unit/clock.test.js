import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixedClock } from '../../src/core/clock.js';

test('exact step deltas produce exactly one tick each with no drift', () => {
  const clock = createFixedClock({ stepHz: 60 });
  for (let i = 0; i < 600; i++) assert.equal(clock.advance(1 / 60), 1);
  const stats = clock.stats();
  assert.equal(stats.tick, 600);
  assert.ok(Math.abs(stats.simTime - 10) < 1e-9, `sim time drifted: ${stats.simTime}`);
  assert.ok(stats.leftover < 1e-9, `leftover should be ~0: ${stats.leftover}`);
  assert.equal(stats.droppedSubsteps, 0);
});

test('a long frame is capped and the backlog is dropped, never simulated', () => {
  const clock = createFixedClock({ stepHz: 60, maxSubsteps: 5, maxFrameDelta: 0.25 });
  const steps = clock.advance(1.0); // way over the clamp
  assert.equal(steps, 5, 'must never run more than maxSubsteps in one frame');
  const stats = clock.stats();
  assert.equal(stats.clampedFrames, 1);
  assert.equal(stats.tick, 5);
  assert.ok(stats.droppedSubsteps > 0, 'backlog must be counted as dropped');
  // the sim must not run ahead of wall clock, nor lag forever
  assert.ok(Math.abs(stats.simTime + stats.leftover + stats.droppedSubsteps / 60 - 0.25) < 1e-9);
});

test('sub-step frames accumulate instead of ticking', () => {
  const clock = createFixedClock({ stepHz: 60 });
  assert.equal(clock.advance(1 / 120), 0);
  assert.equal(clock.advance(1 / 120), 1);
  assert.equal(clock.stats().tick, 1);
});

test('bad deltas cannot corrupt the sim', () => {
  const clock = createFixedClock({ stepHz: 60 });
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, undefined, 'nope']) {
    assert.equal(clock.advance(bad), 0, `dt=${String(bad)} should not tick`);
  }
  const before = clock.stats().tick;
  assert.equal(clock.advance(1 / 60), 1);
  assert.equal(clock.stats().tick, before + 1);
});

test('identical frame sequences produce identical stats (reproducibility)', () => {
  const run = () => {
    const clock = createFixedClock({ stepHz: 60 });
    const pattern = [0.016, 0.021, 0.014, 0.3, 0.05, 0.0166, 0.0166, 0.4];
    for (let i = 0; i < 50; i++) clock.advance(pattern[i % pattern.length]);
    return clock.stats();
  };
  assert.deepEqual(run(), run());
});

test('rejects nonsense configuration', () => {
  assert.throws(() => createFixedClock({ stepHz: 0 }));
  assert.throws(() => createFixedClock({ maxSubsteps: 0 }));
});
