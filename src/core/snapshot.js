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

import { causewayComplete, countEntities, entityHash, scaleFenceStatus } from './world-state.js';
import { collectInsights } from './insights.js';
import { enemyStateCounts } from './enemy.js';

/** How many combat events the snapshot carries out of the browser. */
export const EVENT_LOG_TAIL = 24;
import { describeSettings } from './settings.js';
import { horizontalSpeed } from './player.js';
import { createCameraState, resolveCamera } from './camera.js';

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
  'dialog',
  'combat',
  'insights',
  'hops',
  'skin',
  'settings',
  'settingsHint',
  // Which of the two player characters is on screen: 'boy' or 'girl'.
  'avatarVariant',
]);

const cameraScratch = createCameraState();

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
  dialog: dialogParam,
  hops: hopsParam,
  input,
  paused,
  ready,
}) {
  const scale = scaleFenceStatus(state);
  const stats = clock.stats();
  const player = state.player;
  // The camera is resolved here, from the player in *this* snapshot. Passing in
  // the frame loop's camera looked equivalent and was not: a debug step() moves
  // the player without waiting for a rendered frame, so the snapshot reported a
  // camera that belonged to the previous position. Derived, never borrowed.
  // (The scratch object is reused: the values are copied out below.)
  // The realm comes from the state, not from the frame loop: a snapshot is a
  // description of the world, and it must not be able to disagree with it about
  // which lens is in use (the same lesson as aimHeight in M1).
  const view = resolveCamera(
    { player, settings, map, seed: state.seed, obstacles: state.obstacles, realm: state.realm },
    cameraScratch,
  );
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
      /** 'perspective' or 'orthographic' — which camera drew this frame */
      projection: view.projection ?? 'perspective',
      /** visible height of the Cognitive lens in metres (0 in the physical realm) */
      span: round(view.span ?? 0, 2),
      /** metres above the feet the boom is aimed at (the point it looks at) */
      aimHeight: round(view.targetHeight, 3),
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
      sprinting: Boolean(player.sprinting),
      // The look state belongs to the player (the camera is derived from it).
      yaw: round(player.yaw, 4),
      pitch: round(player.pitch, 4),
      stridePhase: round(player.stridePhase ?? 0, 3),
      strideAmplitude: round(player.strideAmplitude ?? 0, 3),
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
          sprint: Boolean(input.sprint),
        }
      : {
          mode: 'unknown',
          capture: 'unknown',
          captured: false,
          stick: null,
          looking: false,
          heldKeys: 0,
          sprint: false,
        },
    distanceFromOrigin: round(scale.distance, 3),
    scaleFence: { worst: round(scale.worst, 2), limit: scale.limit, warn: scale.warn },
    entityCount: countEntities(state),
    entityHash: entityHash(state),
    fogDensity: settings.fog,
    drawCalls: render.drawCalls,
    triangles: render.triangles,
    gl: { version: render.gl.version, gpu: render.gl.gpu },
    // This object is the whitelist half of the contract, and a field the caller
    // passes but this line does not name disappears in silence — which is how
    // `fade` and `fades` went missing while everything else about the fade
    // still looked fine (M2, 2026-10-16). A unit test now fails if a field is
    // added on one side and not the other.
    ui: {
      overlay: ui.overlay,
      panel: ui.panel,
      credits: ui.credits,
      touch: Boolean(ui.touch),
      fade: Boolean(ui.fade),
      fades: Number.isFinite(ui.fades) ? ui.fades : 0,
    },
    settings: { ...settings },
    settingsHint: describeSettings(settings),
    dialog: dialogParam
      ? {
          open: Boolean(dialogParam.open),
          npcId: dialogParam.npcId ?? null,
          node: dialogParam.node ?? null,
        }
      : { open: false, npcId: null, node: null },
    avatarVariant: render.avatarVariant === 'girl' ? 'girl' : 'boy',
    /**
     * Combat, as its own top-level key rather than a corner of `ui`.
     *
     * `ui` is a whitelist, and a field added there without a matching line here
     * disappears without a sound — that trap has already cost two CI runs. A
     * top-level key is also what the fairness tests want: they read the event
     * log, and the log is the contract's evidence.
     */
    combat: combatOf(state),
    /**
     * The lens-interaction layer (M2's leftovers landing now): which of the
     * map's memory-flames are lit, and whether the causeway in the physical
     * pool is complete. Top-level, not under `ui` — the whitelist trap has
     * already been the bug three times (see DECISIONS.md).
     */
    insights: insightsOf(state, map),
    /**
     * The hop layer (WP-4.3): which links are legal FROM HERE right now
     * (computed by the frame loop, never re-derived), and how many the
     * session has taken. Same top-level rule as `insights`: not under `ui`.
     */
    hops: hopsOf(hopsParam),
    // The cognitive manifestation the renderer is actually drawing, if any. A
    // map with no authored skin reports `unassigned` and draws no layer.
    skin: {
      id: render.skin?.id ?? map.cognitiveSkin?.id ?? map.id,
      system: render.skin?.system ?? map.system ?? 'unassigned',
      objectForm: render.skin?.objectForm ?? 'unassigned',
      authored: Boolean(render.skin?.authored),
      beads: Number.isFinite(render.skin?.beads) ? render.skin.beads : 0,
      souls: Number.isFinite(render.skin?.souls) ? render.skin.souls : 0,
      // How many NPC flames the cognitive layer drew (WP-3.4). Mapped here
      // because this object is a whitelist: a field the renderer starts
      // reporting and this block does not is invisible to every test that reads
      // the snapshot — which is exactly how the NPC flame assertion came back
      // `undefined` in CI run 38931025849 instead of failing on the renderer.
      npcFlames: Number.isFinite(render.skin?.npcFlames) ? render.skin.npcFlames : 0,
      // How many enemy flames the cognitive layer drew. Named here for the same
      // reason as every line above it: this object is a whitelist, and a field
      // the renderer reports and this block does not reads back as `undefined`.
      // That is exactly how the NPC flame count went missing in CI run
      // 38931025849 — and how the enemy flame count went missing in 39063603462,
      // which is the third time this exact line has been the bug.
      enemyFlames: Number.isFinite(render.skin?.enemyFlames) ? render.skin.enemyFlames : 0,
    },
  };
}

/**
 * The combat block.
 *
 * The event log is included because it is the only place a headless test can
 * read the fairness contract from inside a real browser: every damage event has
 * to be preceded by its source's telegraph, and that is a statement about this
 * array. Bounded by `EVENT_LOG_MAX`, so a long session cannot grow the payload.
 */
function combatOf(state) {
  const combat = state.combat;
  if (!combat) return null;
  return {
    health: round(combat.health, 2),
    maxHealth: combat.maxHealth,
    invuln: round(combat.invuln, 2),
    hurt: round(combat.hurt, 3),
    dead: Boolean(combat.dead),
    deaths: combat.deaths,
    hitsTaken: combat.hitsTaken,
    hitsLanded: combat.hitsLanded,
    swings: combat.swings,
    beacon: combat.beacon?.id ?? null,
    beaconsTouched: combat.beaconsTouched,
    enemies: state.enemies?.length ?? 0,
    states: enemyStateCounts(state),
    /**
     * Who is out there, and where.
     *
     * Not just for tests: this is the row that answers "is that a rock or is
     * that a thing?" without reading the code, and it is what lets a headless
     * test walk up to a specific enemy instead of hoping one wanders past.
     * Bounded by the contract's cap, so the payload cannot grow.
     */
    roster: (state.enemies ?? []).slice(0, 6).map((enemy) => ({
      id: enemy.id,
      type: enemy.typeId,
      state: enemy.state,
      fightable: Boolean(enemy.fightable),
      x: round(enemy.position.x, 2),
      z: round(enemy.position.z, 2),
      health: enemy.health,
      tell: round(enemy.tell ?? 0, 2),
    })),
    spawned: state.spawner?.spawned ?? 0,
    culled: state.spawner?.culled ?? 0,
    attack: {
      phase: state.player?.attack?.phase ?? 'idle',
      cooldown: round(state.player?.attack?.cooldown ?? 0, 3),
      swing: round(state.player?.attack?.swing ?? 0, 3),
    },
    // The tail, not the whole log: the state keeps 128 so a unit test can read
    // a run, and the debug payload only needs the last handful.
    events: (state.events ?? []).slice(-EVENT_LOG_TAIL).map((event) => ({
      tick: event.tick,
      kind: event.kind,
      by: event.by ?? null,
      to: event.to ?? null,
      windup: Number.isFinite(event.windup) ? event.windup : null,
      amount: Number.isFinite(event.amount) ? event.amount : null,
    })),
  };
}

/** The memory-flames block: every authored flame, whether it's lit, and the causeway. */
function insightsOf(state, map) {
  const insights = state?.insights ?? {};
  const litIds = Object.keys(insights).filter((id) => insights[id]);
  return {
    total: Object.keys(insights).length,
    lit: litIds.length,
    litIds,
    authoredAcrossMap: collectInsights(map).length,
    causeway: causewayComplete(state, { map, seed: state?.seed }),
  };
}

function hopsOf(param) {
  if (!param) return { count: 0, last: null, available: [], atGate: false };
  return {
    count: Number.isFinite(param.count) ? param.count : 0,
    last: param.last ?? null,
    available: Array.isArray(param.available) ? param.available : [],
    atGate: Boolean(param.atGate),
  };
}

/** Keep the payload JSON-clean: no NaN, no -0, no long floats. */
function round(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}
