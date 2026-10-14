/**
 * The debug snapshot — the single shape shared by three consumers:
 *   1. `window.__debug()` (the headless smoke test's contract, §8),
 *   2. the debug overlay,
 *   3. the progress reports.
 *
 * It lives in core/ (no DOM, no three.js) so a unit test can build a real
 * snapshot and feed it to the overlay, which is how a missing field gets caught
 * locally instead of in CI.
 */

import { countEntities, entityHash, scaleFenceStatus } from './world-state.js';
import { describeSettings } from './settings.js';

/** Every key the overlay and the tests are allowed to rely on. */
export const SNAPSHOT_KEYS = Object.freeze([
  'ready',
  'version',
  'milestone',
  'mapId',
  'mapLabel',
  'realm',
  'seed',
  'palette',
  'tick',
  'simTime',
  'droppedSubsteps',
  'fps',
  'frameMs',
  'worstFrameMs',
  'longFrames',
  'camera',
  'distanceFromOrigin',
  'scaleFence',
  'entityCount',
  'entityHash',
  'fogDensity',
  'drawCalls',
  'triangles',
  'gl',
  'ui',
  'settings',
  'settingsHint',
]);

export function buildSnapshot({
  app,
  state,
  map,
  variant,
  settings,
  clock,
  frameStats,
  render,
  ui,
  ready,
}) {
  const scale = scaleFenceStatus(state);
  const stats = clock.stats();
  return {
    ready: Boolean(ready),
    version: app.version,
    milestone: app.milestone,
    mapId: state.mapId,
    mapLabel: map.label,
    realm: state.realm,
    seed: state.seed,
    palette: variant.id,
    tick: stats.tick,
    simTime: round(stats.simTime, 3),
    droppedSubsteps: stats.droppedSubsteps,
    fps: frameStats.fps(),
    frameMs: round(frameStats.meanMs(), 2),
    worstFrameMs: round(frameStats.worstMs(), 2),
    longFrames: frameStats.longFrames,
    camera: {
      x: round(state.observer.position.x, 3),
      y: round(state.observer.position.y, 3),
      z: round(state.observer.position.z, 3),
      yaw: round(state.observer.yaw, 4),
      pitch: round(state.observer.pitch, 4),
    },
    distanceFromOrigin: round(scale.distance, 3),
    scaleFence: { worst: round(scale.worst, 2), limit: scale.limit, warn: scale.warn },
    entityCount: countEntities(state),
    entityHash: entityHash(state),
    fogDensity: settings.fog,
    drawCalls: render.drawCalls,
    triangles: render.triangles,
    gl: { version: render.gl.version, gpu: render.gl.gpu },
    ui: { overlay: ui.overlay, panel: ui.panel, credits: ui.credits },
    settings: { ...settings },
    settingsHint: describeSettings(settings),
  };
}

/** Keep the payload JSON-clean: no NaN, no -0, no long floats. */
function round(value, decimals) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}
