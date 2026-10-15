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
import { horizontalSpeed } from './player.js';
import { resolveCamera } from './camera.js';

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
  'clockTime',
  'droppedSubsteps',
  'paused',
  'fps',
  'frameMs',
  'worstFrameMs',
  'longFrames',
  'camera',
  'player',
  'input',
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
  input,
  camera = null,
  paused,
  ready,
}) {
  const scale = scaleFenceStatus(state);
  const stats = clock.stats();
  const player = state.player;
  // The frame loop passes the camera it just resolved; anything else (a unit
  // test) gets it derived here, so the snapshot can never disagree with the
  // view the player is actually looking through.
  const view =
    camera ??
    resolveCamera({ player, settings, map, seed: state.seed, obstacles: state.obstacles }, undefined);
  return {
    ready: Boolean(ready),
    version: app.version,
    milestone: app.milestone,
    mapId: state.mapId,
    mapLabel: map.label,
    realm: state.realm,
    seed: state.seed,
    palette: variant.id,
    // The simulation owns these counters: the debug clock can advance them
    // without the renderer, which is how the headless tests drive the game.
    tick: state.tick,
    simTime: round(state.simTime, 3),
    // How much time the frame loop was allowed to simulate: simTime must never
    // overtake it, however slow the renderer is.
    clockTime: round(stats.simTime, 3),
    droppedSubsteps: stats.droppedSubsteps,
    paused: Boolean(paused),
    fps: frameStats.fps(),
    frameMs: round(frameStats.meanMs(), 2),
    worstFrameMs: round(frameStats.worstMs(), 2),
    longFrames: frameStats.longFrames,
    camera: {
      x: round(view.x, 3),
      y: round(view.y, 3),
      z: round(view.z, 3),
      yaw: round(view.yaw, 4),
      pitch: round(view.pitch, 4),
      mode: view.mode,
      distance: round(view.distance, 3),
      clipped: Boolean(view.clipped),
      avatar: Boolean(view.avatarVisible),
    },
    player: {
      x: round(player.position.x, 3),
      y: round(player.position.y, 3),
      z: round(player.position.z, 3),
      speed: round(horizontalSpeed(player), 3),
      vy: round(player.velocity.y, 3),
      grounded: player.grounded,
      // The look state belongs to the player (the camera is derived from it).
      yaw: round(player.yaw, 4),
      pitch: round(player.pitch, 4),
      stridePhase: round(player.stridePhase ?? 0, 3),
      bob: round(player.bob, 4),
      jumps: player.jumps,
      landings: player.landings,
      distanceWalked: round(player.distanceWalked, 2),
    },
    input: input
      ? {
          mode: input.mode,
          capture: input.capture,
          captured: input.captured,
          stick: input.stick,
          looking: input.looking,
          heldKeys: input.heldKeys,
        }
      : { mode: 'unknown', capture: 'unknown', captured: false, stick: null, looking: false, heldKeys: 0 },
    distanceFromOrigin: round(scale.distance, 3),
    scaleFence: { worst: round(scale.worst, 2), limit: scale.limit, warn: scale.warn },
    entityCount: countEntities(state),
    entityHash: entityHash(state),
    fogDensity: settings.fog,
    drawCalls: render.drawCalls,
    triangles: render.triangles,
    gl: { version: render.gl.version, gpu: render.gl.gpu },
    ui: { overlay: ui.overlay, panel: ui.panel, credits: ui.credits, touch: Boolean(ui.touch) },
    settings: { ...settings },
    settingsHint: describeSettings(settings),
  };
}

/** Keep the payload JSON-clean: no NaN, no -0, no long floats. */
function round(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}
