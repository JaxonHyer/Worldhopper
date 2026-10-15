/**
 * The camera, asserted headlessly.
 *
 * The owner asked for third person (2026-10-15), which turns the camera from a
 * copy of the player's eye into its own little system: a boom that has to find a
 * place in the world without ending up inside a hill. That is exactly the sort
 * of thing to check here rather than by squinting at a phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA } from '../../src/core/config.js';
import { PLAYER, eyePosition } from '../../src/core/player.js';
import { createCameraState, normalizeView, resolveCamera, VIEW } from '../../src/core/camera.js';
import { getMap, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { terrainHeight } from '../../src/core/world-state.js';

const map = getMap(DEFAULT_MAP_ID);

/** A perfectly flat world, so distances can be measured exactly. */
const flatMap = {
  ...map,
  id: 'unit-flat',
  ground: { ...map.ground, amplitude: 0, frequency: 0.006, flatRadius: 100000 },
  landmarks: [],
  propPolicy: { ...map.propPolicy, count: 0 },
};

const SEED = 4242;

function makePlayer(overrides = {}) {
  return {
    position: { x: 0, y: 0, z: 0, ...(overrides.position ?? {}) },
    velocity: { x: 0, y: 0, z: 0, ...(overrides.velocity ?? {}) },
    yaw: 0,
    pitch: 0,
    bob: 0,
    grounded: true,
    ...overrides,
    // keep the nested objects the caller built, whatever the spread order
    ...(overrides.position ? { position: overrides.position } : {}),
    ...(overrides.velocity ? { velocity: overrides.velocity } : {}),
  };
}

const resolve = (overrides = {}) =>
  resolveCamera({
    player: makePlayer(overrides.player),
    settings: { view: 'third', camDistance: CAMERA.distance, ...overrides.settings },
    map: 'map' in overrides ? overrides.map : flatMap,
    seed: SEED,
    obstacles: overrides.obstacles ?? [],
  });

test('third person puts the camera behind the player, looking at them', () => {
  const player = makePlayer({ yaw: 0, pitch: 0 });
  const camera = resolve({ player });
  assert.equal(camera.mode, VIEW.third);
  // Yaw 0 looks down -Z, so "behind" is +Z.
  assert.ok(camera.z > player.position.z, `camera should be behind the player: z ${camera.z}`);
  assert.equal(camera.x, player.position.x);
  assert.ok(Math.abs(camera.distance - CAMERA.distance) < 1e-9);
  assert.equal(camera.clipped, false);
  assert.equal(camera.avatarVisible, true);
  // Level view: the camera and the point it aims at are at the same height.
  assert.ok(Math.abs(camera.y - (player.position.y + CAMERA.targetHeight)) < 1e-9);
  assert.ok(Math.abs(camera.pitch) < 1e-9);
});

test('the camera orbits with yaw and stays exactly the boom length away', () => {
  for (const yaw of [0, 0.4, Math.PI / 2, -2.2, Math.PI]) {
    const player = makePlayer({ yaw, pitch: -0.3 });
    const camera = resolve({ player });
    assert.ok(
      Math.abs(camera.distance - CAMERA.distance) < 1e-6,
      `yaw ${yaw}: distance ${camera.distance}`,
    );
    // It must sit on the *opposite* side of the player from where they look.
    const forwardX = -Math.sin(yaw) * Math.cos(-0.3);
    const forwardZ = -Math.cos(yaw) * Math.cos(-0.3);
    const toCameraX = camera.x - player.position.x;
    const toCameraZ = camera.z - player.position.z;
    assert.ok(forwardX * toCameraX + forwardZ * toCameraZ < 0, `yaw ${yaw}: camera in front of the player`);
  }
});

test('the distance setting is what the boom uses, clamped to the slider', () => {
  assert.ok(Math.abs(resolve({ settings: { camDistance: 6 } }).distance - 6) < 1e-6);
  assert.ok(Math.abs(resolve({ settings: { camDistance: 99 } }).distance - CAMERA.maxDistance) < 1e-6);
  assert.ok(Math.abs(resolve({ settings: { camDistance: 0 } }).distance - CAMERA.minDistance) < 1e-6);
  // Junk must not produce a NaN boom (a NaN camera renders nothing at all).
  const junk = resolve({ settings: { camDistance: Number.NaN } });
  assert.ok(Number.isFinite(junk.distance) && junk.distance > 0);
});

test('first person is the player’s eye, and the body is not drawn', () => {
  const player = makePlayer({ position: { x: 3, y: 12, z: -4 }, yaw: 0.7, pitch: 0.2, bob: 0.03 });
  const camera = resolve({ player, settings: { view: 'first' } });
  const eye = eyePosition(player);
  assert.equal(camera.mode, VIEW.first);
  assert.equal(camera.x, eye.x);
  assert.equal(camera.y, eye.y);
  assert.equal(camera.z, eye.z);
  assert.equal(camera.pitch, player.pitch);
  assert.equal(camera.distance, 0);
  assert.equal(camera.clipped, false);
  assert.equal(camera.avatarVisible, false);
});

test('the view switch falls back to third person for junk input', () => {
  assert.equal(normalizeView('first'), VIEW.first);
  for (const junk of [undefined, null, '', 'FIRST', 'second', 42, {}]) {
    assert.equal(normalizeView(junk), VIEW.third, `normalizeView(${String(junk)})`);
  }
});

test('a rock behind the player shortens the boom, and the camera stays out of it', () => {
  // Directly behind the player at yaw 0 (+Z), which is where the boom goes.
  const obstacle = { id: 'rock-01', x: 0, z: 2.6, radius: 1.0, topY: 2.0 };
  const camera = resolve({ obstacles: [obstacle] });
  assert.ok(camera.distance < CAMERA.distance, `boom was not shortened: ${camera.distance}`);
  assert.equal(camera.clipped, true);
  const gap = Math.hypot(camera.x - obstacle.x, camera.z - obstacle.z);
  assert.ok(gap >= obstacle.radius, `camera ended up inside the rock (gap ${gap})`);
  assert.ok(Number.isFinite(camera.pitch));
});

test('the camera never ends up under the ground, whatever it is aimed at', () => {
  // A wall of terrain right behind the player, plus every pitch the player can
  // actually reach: the boom has to give way every time.
  const hill = { ...flatMap, ground: { ...flatMap.ground, amplitude: 26 } };
  for (const pitch of [CAMERA.pitchMin, -0.6, 0, 0.3, CAMERA.pitchMax]) {
    for (const yaw of [0, 1.1, 2.4, -3.0]) {
      const player = makePlayer({ yaw, pitch, position: { x: 40, y: 12, z: 40 } });
      const camera = resolve({ player, map: map.ground.amplitude === 0 ? map : hill, obstacles: [] });
      const groundHere = terrainHeight(hill, SEED, camera.x, camera.z);
      assert.ok(
        camera.y >= groundHere + CAMERA.clearance - 1e-6,
        `pitch ${pitch}, yaw ${yaw}: camera at ${camera.y.toFixed(2)}, ground ${groundHere.toFixed(2)}`,
      );
    }
  }
});

test('the camera is lifted, it re-aims at the player rather than looking past them', () => {
  const hill = { ...flatMap, ground: { ...flatMap.ground, amplitude: 26 } };
  const player = makePlayer({ yaw: 0, pitch: CAMERA.pitchMax, position: { x: -30, y: 9, z: -30 } });
  const camera = resolve({ player, map: hill });
  const targetY = player.position.y + CAMERA.targetHeight;
  const flat = Math.hypot(player.position.x - camera.x, player.position.z - camera.z);
  const aim = Math.atan2(targetY - camera.y, flat);
  assert.ok(
    Math.abs(camera.pitch - aim) < 1e-6,
    `camera pitch ${camera.pitch} does not point at the player (${aim})`,
  );
  // Looking up must not leave the camera somewhere absurd, either.
  assert.ok(camera.distance >= CAMERA.minDistance - 1e-6);
});

test('a very short boom hides the body, so the camera is never inside the head', () => {
  const buried = {
    ...flatMap,
    ground: { ...flatMap.ground, amplitude: 0, flatRadius: -1 }, // never flat: hills everywhere
  };
  const camera = resolve({ map: buried, player: makePlayer({ position: { x: 60, y: 0, z: 60 }, pitch: CAMERA.pitchMax }) });
  assert.equal(camera.avatarVisible, camera.distance > CAMERA.hideAvatarBelow);
  const hidden = resolve({ settings: { camDistance: CAMERA.minDistance } });
  assert.equal(hidden.avatarVisible, CAMERA.minDistance > CAMERA.hideAvatarBelow);
});

test('a camera state object is reused, never reallocated per frame', () => {
  const out = createCameraState();
  const first = resolveCamera(
    { player: makePlayer(), settings: { view: 'third', camDistance: 5 }, map: flatMap, seed: SEED },
    out,
  );
  assert.equal(first, out, 'resolveCamera must fill the object it was given');
  const x = first.x;
  first.positionButNotAKey = true; // prove it is the same object being written
  const second = resolveCamera(
    { player: makePlayer({ yaw: 1 }), settings: { view: 'third', camDistance: 5 }, map: flatMap, seed: SEED },
    out,
  );
  assert.equal(second, first);
  assert.notEqual(second.x, x);
  assert.equal(second.positionButNotAKey, true);
});

test('a broken player object cannot produce a NaN camera', () => {
  const broken = {
    position: { x: Number.NaN, y: 3, z: Number.NEGATIVE_INFINITY },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: Number.NaN,
    pitch: Number.NaN,
    bob: Number.NaN,
    grounded: true,
  };
  const camera = resolveCamera({ player: broken, settings: { view: 'third' }, map: flatMap, seed: SEED });
  for (const key of ['x', 'y', 'z', 'yaw', 'pitch', 'distance', 'targetHeight']) {
    assert.ok(Number.isFinite(camera[key]), `camera.${key} is ${camera[key]}`);
  }
  const eye = resolveCamera({ player: broken, settings: { view: 'first' }, map: flatMap, seed: SEED });
  for (const key of ['x', 'y', 'z', 'pitch']) {
    assert.ok(Number.isFinite(eye[key]), `first-person camera.${key} is ${eye[key]}`);
  }
});

test('the camera is derived, not stored: the player is never mutated', () => {
  const player = makePlayer({ yaw: 0.9, pitch: -0.5, bob: 0.02, position: { x: 5, y: 7, z: 9 } });
  const before = JSON.stringify(player);
  resolve({ player });
  assert.equal(JSON.stringify(player), before);
});

test('eye height is still what the first-person camera uses (the sim’s numbers stay put)', () => {
  const player = makePlayer({ bob: 0 });
  const camera = resolve({ player, settings: { view: 'first' } });
  assert.equal(camera.y, PLAYER.eyeHeight);
});
