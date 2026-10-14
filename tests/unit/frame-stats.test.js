import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStats } from '../../src/core/frame-stats.js';

test('fps is null until there is enough evidence', () => {
  const stats = createFrameStats();
  assert.equal(stats.fps(), null);
  stats.sample(1 / 60);
  assert.equal(stats.fps(), null);
});

test('fps and mean frame time reflect the samples', () => {
  const stats = createFrameStats({ windowSeconds: 1 });
  for (let i = 0; i < 60; i++) stats.sample(1 / 60);
  const fps = stats.fps();
  assert.ok(Math.abs(fps - 60) < 1.5, `expected ~60fps, got ${fps}`);
  assert.ok(Math.abs(stats.meanMs() - 1000 / 60) < 1.0);
});

test('long frames are counted and the window slides', () => {
  const stats = createFrameStats({ windowSeconds: 1, longFrameMs: 50 });
  stats.sample(0.2); // 200 ms spike
  assert.equal(stats.longFrames, 1);
  assert.ok(stats.worstMs() >= 200);
  for (let i = 0; i < 200; i++) stats.sample(1 / 60);
  assert.equal(stats.longFrames, 0, 'spike should have slid out of the window');
  assert.ok(stats.worstMs() < 50);
});
