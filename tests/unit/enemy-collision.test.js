/**
 * Enemy hull collision (owner, 2026-10-18): "Make it so that the Chasmfiend's
 * collision covers its whole body. Otherwise this is a pass."
 *
 * Before this change an enemy's hull was the single ring from its radius — a
 * 2.2 m circle on the Chasmfiend's head, while nine metres of shell trailed
 * through the player's path. These tests pin: the hull covers the body's whole
 * footprint, it tracks the sim exactly, and it blocks the player like a rock
 * would — WITHOUT walling off the gate lane the realm suite walks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENEMY_TYPES,
  collectEnemyObstacles,
  enemyFrameSpec,
  findSpawnPoint,
  footprintExtent,
} from '../../src/core/enemy.js';
import { createWorldState, stepWorld } from '../../src/core/world-state.js';
import { getMap } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';

const TEST_RANGE = 'blank-basin';
const settings = defaultSettings();

function world(seed = 4242, mapId = TEST_RANGE) {
  return createWorldState({ map: getMap(mapId), seed });
}

function context(state, overrides = {}) {
  return {
    map: getMap(state.mapId),
    seed: state.seed,
    obstacles: state.obstacles,
    settings: { ...settings, ...overrides },
  };
}

function rosharanFiend() {
  const state = world(4242, 'roshar');
  const fiend = state.enemies.find((e) => e.typeId === 'storm-warden');
  return { state, fiend };
}

// --- the spec itself ---------------------------------------------------------

test('the frame spec for a chain is a ring per segment, tapering with the shell', () => {
  const spec = enemyFrameSpec(ENEMY_TYPES['storm-warden']);
  assert.equal(spec.segmented, true);
  assert.equal(spec.segments.length, ENEMY_TYPES['storm-warden'].dims.segments, 'one ring per chain section');
  // Whole-body coverage is the point: the tail anchor must sit metres behind
  // the head, not a handspan.
  const tail = spec.segments[spec.segments.length - 1];
  assert.ok(tail.along >= ENEMY_TYPES['storm-warden'].dims.depth * 3, `tail ring at ${tail.along.toFixed(1)} m behind the head`);
  // Ghost-tail check: radii taper toward the back, and the head is fattest.
  assert.ok(spec.segments[0].colliderRadius > spec.segments[spec.segments.length - 1].colliderRadius);
  // Every ring stands taller than the player jumps? No — but taller than a step.
  for (const seg of spec.segments) assert.ok(seg.colliderTop > 1, `hull top ${seg.colliderTop}`);
  assert.ok(footprintExtent(ENEMY_TYPES['storm-warden']) > 9, 'the footprint is giant, not a head-circle');
});

test('a non-chain enemy still has a whole-body hull — one ring at its position', () => {
  const spec = enemyFrameSpec(ENEMY_TYPES['crag-lurker']);
  assert.equal(spec.segmented, false);
  assert.equal(spec.segments.length, 1);
  assert.ok(spec.segments[0].colliderRadius >= 0.5);
});

// --- collection from live state ----------------------------------------------

test('colliders come from the sim and follow the hull line exactly', () => {
  const { state, fiend } = rosharanFiend();
  const obstacles = collectEnemyObstacles(state, context(state));
  const hull = obstacles.filter((o) => o.id.startsWith(fiend.id));

  assert.ok(hull.length >= 5, `a chain of rings, got ${hull.length}`);
  // The pool giant faces the spawn (yaw ~ π): the line trails AWAY, southward.
  for (const ring of hull) {
    assert.ok(ring.z <= fiend.position.z + 0.001, `ring ${ring.id} sits in front of the head`);
    assert.ok(Math.abs(ring.x - fiend.position.x) < 0.01, 'and the line stays behind it, not beside it');
  }
  // The head-to-tail span is measured in metres, matching the frame spec.
  const span = fiend.position.z - Math.min(...hull.map((o) => o.z));
  assert.ok(span > 6, `hull spans ${span.toFixed(1)} m behind the head`);

  // Turn the creature and the hull turns with it — no ghost walls behind.
  fiend.yaw = Math.PI / 2; // faces -X now, so the trail runs along +X
  const turned = collectEnemyObstacles(state, context(state)).filter((o) => o.id.startsWith(fiend.id));
  assert.ok(
    turned.every((o) => o.x >= fiend.position.x - 0.001),
    'after the turn the hull runs the new line, instantly',
  );
});

test('dying enemies drop their hull with the body', () => {
  const { state, fiend } = rosharanFiend();
  fiend.dying = true;
  const hull = collectEnemyObstacles(state, context(state)).filter((o) => o.id.startsWith(fiend.id));
  assert.equal(hull.length, 0, 'a falling body is no longer a wall');
});

// --- it actually blocks the player --------------------------------------------

test('a hull ring blocks like a rock — walking IN is refused, but you never end up inside', () => {
  const { state, fiend } = rosharanFiend();
  // March the player, on foot and head-on, down the chain spine, x = 5.5.
  state.player.position.x = fiend.position.x;
  state.player.position.z = fiend.position.z + 6;
  const ctx = context(state);
  for (let i = 0; i < 60 * 3; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: false, attack: false }, ctx);
  }
  const rings = collectEnemyObstacles(state, ctx).filter((o) => o.id.startsWith(fiend.id));
  const inside = rings.some((o) => {
    const d = Math.hypot(state.player.position.x - o.x, state.player.position.z - o.z);
    return d < o.radius + 0.3 && !(state.player.position.y >= o.topY - 0.06);
  });
  assert.ok(!inside, 'the player ended INSIDE the shell — walk-through, not rock');
});

test('a hull that slides over the player pushes them OUT of it, never traps them inside', () => {
  const { state, fiend } = rosharanFiend();
  const ctx = context(state);
  // Drop the player dead inside a mid-chain ring and give the sim one step.
  const midRing = collectEnemyObstacles(state, ctx).find((o) => o.id === `${fiend.id}-hull-03`);
  state.player.position.x = midRing.x;
  state.player.position.z = midRing.z;
  state.player.position.y = 0;
  state.player.velocity.x = 0;
  state.player.velocity.z = 0;
  stepWorld(state, 1 / 60, { move: { x: 0, y: 0 }, jump: false, sprint: false, attack: false }, ctx);
  const afterRings = collectEnemyObstacles(state, ctx).filter((o) => o.id.startsWith(fiend.id));
  const stillInside = afterRings.some((o) => {
    const d = Math.hypot(state.player.position.x - o.x, state.player.position.z - o.z);
    return d < o.radius + 0.34 && !(state.player.position.y >= o.topY - 0.06);
  });
  assert.ok(!stillInside, 'engulfed and LEFT inside a ring — the perma-trap the push-out exists for');
});
test('a clear lane beside the giant stays a clear lane — hull, not fog of wall', () => {
  const { state } = rosharanFiend();
  // Walk down the east side, x=9: clear of every ring (fattest is ~1.7 on x=5.5).
  state.player.position.x = 9;
  state.player.position.z = -12;
  const ctx = context(state);
  for (let i = 0; i < 60 * 5; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: false, attack: false }, ctx);
  }
  assert.ok(
    state.player.position.z < -25,
    `a parallel path must NOT be walled off — stopped at z=${state.player.position.z.toFixed(1)}`,
  );
});

test('the spawn walk to the Perpendicularity is untouched by the new walls (the whole point of the sleeping giant)', () => {
  const { state } = rosharanFiend();
  const ctx = context(state);
  for (let i = 0; i < 60 * 1.6; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: false, attack: false }, ctx);
  }
  assert.ok(state.player.position.z < -10.5, `the gate lane stays walkable (z=${state.player.position.z.toFixed(1)})`);
  assert.equal(state.combat.hitsTaken, 0);
});

test('the spawner never drops a new enemy inside an existing hull, head OR tail', () => {
  const { state } = rosharanFiend();
  const ctx = context(state);
  state.player.position.x = 5.5;
  state.player.position.z = -16; // stand right by the giant's lane for a long bake
  for (let i = 0; i < 300; i++) {
    const spot = findSpawnPoint(state, ctx, state.player.position.x, state.player.position.z);
    assert.ok(spot, 'a spot was found');
    for (const other of state.enemies) {
      const type = ENEMY_TYPES[other.typeId];
      const extent = type ? footprintExtent(type) : 3;
      assert.ok(
        Math.hypot(spot.x - other.position.x, spot.z - other.position.z) >= extent + 2,
        `spawned inside the footprint of ${other.typeId} (${Math.hypot(spot.x - other.position.x, spot.z - other.position.z).toFixed(1)} m)`,
      );
    }
  }
});

// --- the surrounding contracts did not move -----------------------------------

test('rocks and NPCs are exactly what they were (the hull is an addition, not a rewrite)', () => {
  const state = world(4242);
  // The static obstacles did not change shape or count from before the pass:
  assert.equal(state.obstacles.length, state.entities.filter((e) => e.kind === 'rock' || e.kind === 'landmark').length);
  // And the world stays reproducible end-to-end with collision in the loop.
  const a = world(4242);
  const b = world(4242);
  const ctxA = context(a);
  const ctxB = context(b);
  for (let i = 0; i < 60 * 2; i++) {
    stepWorld(a, 1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: false, attack: false }, ctxA);
    stepWorld(b, 1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: false, attack: false }, ctxB);
  }
  assert.deepEqual(a.player.position, b.player.position, 'collision is deterministic');
});

test('the real realm round-trip (the suite’s own path and seed) works on both maps again', () => {
  // CI run 39182532718: the roaming guardian swung its tail across the x=0
  // lane and the walk-out measured 2.08 m from pool centre (needs > 3.4).
  // Fixed authorship: the guardian holds its post facing, tail always due
  // south. Replay the suite's exact legs: step into the pool, walk out the far
  // side, walk back in through the middle.
  const walk = (state, ctx, seconds, dir = 1) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      stepWorld(state, 1 / 60, { move: { x: 0, y: dir }, jump: false, sprint: false, attack: false }, ctx);
    }
  };
  for (const mapId of ['roshar', 'blank-basin']) {
    const state = world(4242, mapId);
    const ctx = context(state);
    const poolZ = getMap(mapId).perpendicularity.position.z;
    const poolDist = () => Math.hypot(state.player.position.x, state.player.position.z - poolZ);
    // Entry: hold W until inside, same as the suite's own loop.
    for (let i = 0; i < 10 && poolDist() > 3.4; i++) walk(state, ctx, 0.4);
    assert.ok(poolDist() <= 3.4, `${mapId}: entry never reached the pool (${poolDist().toFixed(2)} m)`);
    // Out the far side, 1.5 s — the assertion CI run 39182532718 broke on.
    walk(state, ctx, 1.5);
    assert.ok(poolDist() > 3.4, `${mapId}: walk-out reached only ${poolDist().toFixed(2)} m`);
    // Home again: back in through the middle.
    walk(state, ctx, 1.5, -1);
    assert.ok(poolDist() <= 3.4, `${mapId}: re-entry did not return into the pool (${poolDist().toFixed(2)} m)`);
  }
});

test('the sleeping guardian’s hull NEVER crosses the walking lane while it is on guard', () => {
  // While idle or disengaging the yaw is pinned to guardFacing, so the ~11 m
  // chain trails due south from the post: the lane x=0 stays free however its
  // 2.5 m shuffle plays. Bake a minute of its service and check every frame.
  const { state, fiend } = rosharanFiend();
  const ctx = context(state);
  assert.ok(Number.isFinite(fiend.guardFacing), 'the placement declares a guard facing');
  for (let i = 0; i < 60 * 60; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 0 }, jump: false, sprint: false, attack: false }, ctx);
    if (fiend.state !== 'idle' && fiend.state !== 'disengage') break; // it saw you, by design; checked below
    const rings = collectEnemyObstacles(state, ctx).filter((o) => o.id.startsWith(fiend.id));
    const worstX = Math.min(...rings.map((o) => o.x - o.radius));
    assert.ok(
      worstX > 0.5,
      `ring reached the lane: ${worstX.toFixed(2)} m while in state ${fiend.state} (it is ${fiend.guardFacing === Math.PI ? 'pinned' : 'NOT PINNED'})`,
    );
    if (i > 60 * 40) break;
  }
});

test('engagement still wins the facing: wake it and it turns to you (guard anchor, not ghost chained)', () => {
  const { state, fiend } = rosharanFiend();
  const ctx = context(state);
  // Deliberate approach: step into its circle, standing where the lane meets it.
  state.player.position.x = fiend.position.x - 3;
  state.player.position.z = fiend.position.z;
  for (let i = 0; i < 60 * 3 && fiend.state === 'idle'; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 0 }, jump: false, sprint: false, attack: false }, ctx);
  }
  assert.notEqual(fiend.state, 'idle', 'it engaged, so guard-pin must not freeze its tracking');
  // ...and it may now turn (the pin does not hold while engaged).
  // When you leave the circle it settles home, and the pin returns.
  state.player.position.z -= 60;
  for (let i = 0; i < 60 * 10 && fiend.state !== 'idle'; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 0 }, jump: false, sprint: false, attack: false }, ctx);
  }
  assert.equal(fiend.state, 'idle');
  expectIdleYaw(fiend);
});

function expectIdleYaw(fiend) {
  assert.ok(
    Math.abs(((fiend.yaw - fiend.guardFacing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.05,
    `idle yaw ${fiend.yaw.toFixed(2)} should settle back to the guard-facing`,
  );
}
