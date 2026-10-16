/**
 * Frame timing stats for the debug overlay.
 *
 * Purely diagnostic: this tracks frame-loop *spikes* (allocations, shader
 * compiles, GC pauses) so we can spot them without a GPU. It is not a
 * benchmark — sandbox/CI numbers are meaningless (AGENT_PROMPT.md §8).
 */

export function createFrameStats({ windowSeconds = 10, longFrameMs = 50 } = {}) {
  const samples = [];
  let total = 0;
  let longFrames = 0;
  let longFramesTotal = 0;

  return {
    sample(dtSeconds) {
      const ms = Math.max(0, dtSeconds * 1000);
      samples.push({ t: dtSeconds, ms });
      total += dtSeconds;
      if (ms > longFrameMs) {
        longFrames++;
        longFramesTotal++;
      }
      while (samples.length > 0 && total - samples[0].t > windowSeconds) {
        const leaving = samples.shift();
        total -= leaving.t;
        if (leaving.ms > longFrameMs) longFrames--;
      }
    },
    /** Frames per second over the rolling window (null until 2 samples). */
    fps() {
      if (samples.length < 2) return null;
      return samples.length / total;
    },
    meanMs() {
      if (samples.length === 0) return 0;
      return samples.reduce((acc, s) => acc + s.ms, 0) / samples.length;
    },
    worstMs() {
      let worst = 0;
      for (const s of samples) if (s.ms > worst) worst = s.ms;
      return worst;
    },
    /** spikes inside the rolling window */
    get longFrames() {
      return longFrames;
    },
    /** spikes since the page loaded */
    get longFramesTotal() {
      return longFramesTotal;
    },
    threshold: longFrameMs,
    sampleCount: () => samples.length,
    reset() {
      samples.length = 0;
      total = 0;
      longFrames = 0;
      longFramesTotal = 0;
    },
  };
}
