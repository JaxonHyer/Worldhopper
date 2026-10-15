import test from 'node:test';
import assert from 'node:assert/strict';
import { getMap, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import {
  countEntities,
  createWorldState,
  distanceFromOrigin,
  findEntity,
  scaleFenceStatus,
  stepWorld,
  terrainHeight,
} from '../../src/core/world-state.js';
import { eyePosition, PLAYER } from '../../src/core/player.js';
import { PITCH_LIMIT } from '../../src/core/math.js';
import { createFixedClock } from '../../src/core/clock.js';
import { defaultSettings } from '../../src/core/settings.js';

const map = getMap(DEFAULT_MAP_ID);

test('a seeded world rebuilds identically, every time', () => {
  const a = createWorldState({ map, seed: 4242 });
  const b = createWorldState({ map, seed: 4242 });
  assert.deepEqual(a, b);
  assert.equal(a.seed, 4242);
  assert.equal(a.realm, 'physical', 'a map starts in the Physical Realm');
  assert.equal(a.tick, 0);
});

test('a different seed makes a different world', () => {
  const a = createWorldState({ map, seed: 1 });
  const b = createWorldState({ map, seed: 2 });
  assert.notDeepEqual(
    a.entities.map((e) => [e.id, e.position.x, e.position.z]),
    b.entities.map((e) => [e.id, e.position.x, e.position.z]),
  );
});

test('the landmark is always placed, and props keep their distance from it', () => {
  for (const seed of [1, 7, 99, 123456, 20261014]) {
    const state = createWorldState({ map, seed });
    const landmark = findEntity(state, map.landmarks[0].id);
    assert.ok(landmark, 'landmark entity missing');
    assert.equal(landmark.kind, 'landmark');
    const props = state.entities.filter((e) => e.kind === 'rock');
    assert.ok(props.length > 0, 'no scenery props were placed');
    assert.ok(props.length <= map.propPolicy.count);
    for (const prop of props) {
      const distance = Math.hypot(prop.position.x - landmark.position.x, prop.position.z - landmark.position.z);
      assert.ok(
        distance >= map.propPolicy.landmarkClearance - 1e-9,
        `prop ${prop.id} sits inside the landmark clearance (${distance.toFixed(1)}m)`,
      );
      const fromOrigin = Math.hypot(prop.position.x, prop.position.z);
      assert.ok(fromOrigin >= map.propPolicy.innerRadius - 1e-9, `prop ${prop.id} spawned on the player's nose`);
      assert.ok(fromOrigin <= map.propPolicy.outerRadius + 1e-9);
    }
  }
});

test('the spawn apron is flat, and the player starts standing on it at eye height', () => {
  const state = createWorldState({ map, seed: 4242 });
  assert.equal(terrainHeight(map, 4242, 0, 0), 0);
  assert.equal(state.player.position.y, 0, 'the player spawns with their feet on the ground');
  assert.equal(state.player.grounded, true);
  const eye = eyePosition(state.player);
  assert.equal(eye.y, PLAYER.eyeHeight, 'the camera sits one eye height above the feet');
  assert.ok(Math.abs(terrainHeight(map, 4242, 300, 120)) <= map.ground.amplitude + 1e-9);
  assert.equal(countEntities(state), map.landmarks.length + state.entities.filter((e) => e.kind === 'rock').length);
});

test('every entity is inside the scale fence', () => {
  const state = createWorldState({ map, seed: 4242 });
  const status = scaleFenceStatus(state);
  assert.ok(status.worst < 4000, `entity drifted to ${status.worst}m from origin`);
  assert.equal(status.warn, false);
});

test('simulating the same input twice gives the same state', () => {
  const settings = defaultSettings();
  const run = () => {
    const state = createWorldState({ map, seed: 4242 });
    const context = { map, seed: state.seed, obstacles: state.obstacles, settings };
    const clock = createFixedClock({ stepHz: 60 });
    for (let frame = 0; frame < 120; frame++) {
      const steps = clock.advance(1 / 60);
      for (let i = 0; i < steps; i++) {
        stepWorld(
          state,
          clock.step,
          {
            move: { x: Math.sin(frame * 0.05), y: 1 },
            jump: frame === 40,
            lookRate: { x: 1.9, y: 0 },
            lookImpulse: i === 0 ? { yaw: 0.3, pitch: -0.1 } : null,
          },
          context,
        );
      }
    }
    return state;
  };
  assert.deepEqual(run(), run());
});

test('tick and sim time advance with the fixed step, not the frame rate', () => {
  const state = createWorldState({ map, seed: 4242 });
  const clock = createFixedClock({ stepHz: 60 });
  let steps = 0;
  for (const dt of [1 / 60, 1 / 30, 1 / 120, 0.2]) {
    const n = clock.advance(dt);
    for (let i = 0; i < n; i++) steps += stepWorld(state, clock.step) ? 1 : 0;
  }
  assert.equal(state.tick, steps);
  assert.ok(Math.abs(state.simTime - steps / 60) < 1e-9);
});

test('look input is clamped, wrapped and NaN-proof', () => {
  const state = createWorldState({ map, seed: 1 });
  const context = { map, seed: state.seed, obstacles: state.obstacles, settings: defaultSettings() };
  for (let i = 0; i < 600; i++) stepWorld(state, 1 / 60, { lookRate: { x: 0, y: 100 } }, context);
  assert.ok(state.player.pitch <= PITCH_LIMIT, 'pitch escaped its clamp');
  assert.ok(state.player.pitch >= -PITCH_LIMIT, 'pitch escaped its clamp (down)');

  for (let i = 0; i < 600; i++) stepWorld(state, 1 / 60, { lookRate: { x: 100, y: 0 } }, context);
  assert.ok(state.player.yaw > -Math.PI && state.player.yaw <= Math.PI, 'yaw must stay wrapped');

  const before = { ...state.player };
  stepWorld(state, 1 / 60, { move: { x: Number.NaN, y: Number.NaN }, lookRate: { x: Number.NaN, y: Number.NaN } }, context);
  assert.deepEqual({ ...state.player }, before, 'NaN input must not move the player');
});

test('distance from origin is measured on the position itself', () => {
  assert.equal(distanceFromOrigin({ x: 0, y: 0, z: 0 }), 0);
  assert.equal(distanceFromOrigin({ x: 3, y: 4, z: 0 }), 5);
});
