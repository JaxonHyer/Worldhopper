/**
 * Fixed-timestep simulation clock.
 *
 * The renderer may run at any rate; the simulation always advances in exact
 * `1 / stepHz` ticks. Same seed + same input frames => same state, which is
 * what makes `?seed=` runs reproducible for the owner and for tests.
 *
 * If a frame is so long that the backlog exceeds `maxSubsteps`, the extra
 * steps are *dropped* (and counted) instead of simulated — a spiral of death
 * would otherwise make a slow device simulate faster than real time.
 */

import { SIM } from './config.js';

export function createFixedClock({ stepHz = SIM.fixedStepHz, maxSubsteps = SIM.maxSubsteps, maxFrameDelta = SIM.maxFrameDelta } = {}) {
  if (!(stepHz > 0)) throw new Error('clock: stepHz must be > 0');
  if (!(maxSubsteps >= 1)) throw new Error('clock: maxSubsteps must be >= 1');

  const step = 1 / stepHz;
  let tick = 0;
  let simTime = 0;
  let leftover = 0;
  let frames = 0;
  let droppedSubsteps = 0;
  let clampedFrames = 0;
  let longestFrame = 0;

  return {
    step,
    maxSubsteps,

    /**
     * @param {number} dtSeconds wall-clock delta since the previous frame
     * @returns {number} how many fixed steps were simulated
     */
    advance(dtSeconds) {
      frames++;
      let dt = dtSeconds;
      if (!Number.isFinite(dt) || dt < 0) {
        // Never let a bad delta (NaN from a paused tab, a clock jump, ...)
        // corrupt the sim. Long frames are clamped, not simulated.
        dt = 0;
        clampedFrames++;
      } else if (dt > maxFrameDelta) {
        dt = maxFrameDelta;
        clampedFrames++;
      }
      if (dt > longestFrame) longestFrame = dt;

      leftover += dt;
      let steps = 0;
      while (leftover >= step && steps < maxSubsteps) {
        leftover -= step;
        steps++;
      }
      if (leftover >= step) {
        const dropped = Math.floor(leftover / step);
        droppedSubsteps += dropped;
        leftover -= dropped * step;
      }
      tick += steps;
      simTime += steps * step;
      return steps;
    },

    /** Snapshot for the debug overlay and for tests. */
    stats() {
      return { step, tick, simTime, leftover, frames, droppedSubsteps, clampedFrames, longestFrame };
    },
  };
}
