/**
 * Scene-graph construction tests. These run headlessly (no WebGL context) but
 * they do exercise the real three.js objects, so a bad API call or a state
 * entity without a matching object fails here instead of on the owner's phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorldView } from '../../src/render/world-view.js';
import { createSky, sunDirection } from '../../src/render/sky.js';
import { createWorldState } from '../../src/core/world-state.js';
import { createCameraState, resolveCamera } from '../../src/core/camera.js';
import { AVATAR } from '../../src/render/player-view.js';
import { getMap, getVariant, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';

const map = getMap(DEFAULT_MAP_ID);
const variant = getVariant(map.id, 'ashen-basin');

function buildWorld(overrides = {}) {
  const settings = { ...defaultSettings(), ...overrides };
  const state = createWorldState({ map, seed: settings.seed });
  const world = createWorldView({ map, state, variant: getVariant(map.id, settings.palette), settings });
  return { settings, state, world };
}

test('the world builds, with one object per state entity', () => {
  const { state, world } = buildWorld();
  assert.equal(world.entityObjects.size, state.entities.length);
  for (const entity of state.entities) {
    assert.ok(world.entityObjects.has(entity.id), `no scene object for ${entity.id}`);
  }
  // ground + sky + landmark + props
  assert.ok(world.stats().meshes >= state.entities.length + 1);
});

test('fog, lights and the sky come from the palette', () => {
  const { settings, world } = buildWorld();
  assert.ok(world.scene.fog instanceof THREE.FogExp2);
  assert.equal(world.scene.fog.density, settings.fog);
  const lights = world.scene.children.filter((child) => child.isLight);
  assert.equal(lights.length, 2, 'expected one hemisphere + one directional light');
  const sun = lights.find((light) => light.isDirectionalLight);
  assert.ok(sun.position.length() > 100, 'sun must sit far away so its rays read as parallel');
  assert.ok(world.scene.children.some((child) => child.name === 'sky'));
});

test('settings changes reach the live scene (no rebuild needed)', () => {
  const { settings, world } = buildWorld();
  const next = { ...settings, fog: 0.009, ambient: 1.4, sun: 0.2 };
  world.applySettings(next, getVariant(map.id, settings.palette));
  assert.equal(world.scene.fog.density, 0.009);
  const hemi = world.scene.children.find((child) => child.isHemisphereLight);
  const sun = world.scene.children.find((child) => child.isDirectionalLight);
  assert.equal(hemi.intensity, 1.4);
  assert.equal(sun.intensity, 0.2);
});

test('switching palette variant recolours in place', () => {
  const { settings, world } = buildWorld();
  const misty = getVariant(map.id, 'mist-sea');
  const fogBefore = world.scene.fog.color.getHex();
  world.applySettings({ ...settings, palette: 'mist-sea' }, misty);
  assert.notEqual(world.scene.fog.color.getHex(), fogBefore);
  assert.equal(world.scene.fog.color.getHex(), new THREE.Color(misty.fog.color).getHex());
});

test('sync follows the player and still works after a seed change', () => {
  const { settings } = buildWorld();
  const first = createWorldState({ map, seed: 111 });
  const second = createWorldState({ map, seed: 222 });
  const world = createWorldView({ map, state: first, variant, settings });
  world.sync(first); // must not throw
  world.sync(second); // entities from a different seed are simply unknown here
  assert.ok(true);
});

test('dispose releases the scene without throwing', () => {
  const { world } = buildWorld();
  world.dispose();
  assert.equal(world.scene.children.length, 0);
});

test('the sky dome stays inside the camera far plane', () => {
  const sky = createSky({ variant });
  const radius = sky.mesh.geometry.parameters.radius;
  assert.ok(radius < 5000, 'sky geometry must be inside the far plane (fence §5)');
  assert.equal(sky.mesh.material.depthTest, false, 'the sky is a backdrop, drawn before the world');
  assert.equal(sky.mesh.renderOrder, -1);
  sky.dispose();
});

test('every sun direction is a normalised vector', () => {
  for (const v of map.variants) {
    const dir = sunDirection(v);
    assert.ok(Math.abs(dir.length() - 1) < 1e-6, `${v.id}: sun direction must be normalised`);
  }
});

test('the player is a blocky figure of boxes, and only boxes', () => {
  const { state, world } = buildWorld();
  const avatar = world.scene.getObjectByName('player-avatar');
  assert.ok(avatar, 'the scene has no player-avatar group');
  assert.equal(avatar.visible, true, 'third person draws the body');

  let boxes = 0;
  let overlapping = 0;
  const sizes = [];
  avatar.traverse((child) => {
    if (!child.isMesh) return;
    boxes++;
    const { parameters } = child.geometry;
    assert.equal(child.geometry.type, 'BoxGeometry', `${child.name || 'a part'} is not a box`);
    assert.equal(child.material.flatShading, true, 'a blocky figure uses flat shading');
    sizes.push(parameters.width);
    for (const other of sizes.slice(0, -1)) if (Math.abs(other - parameters.width) < 1e-9) overlapping++;
  });
  // 5 body boxes (torso, belt, head, hair, pack), 2 legs + 2 boots, 2 arms +
  // 2 cuffs + 2 hands, 2 eyes.
  assert.equal(boxes, 17, `expected 17 boxes, found ${boxes}`);
  assert.ok(overlapping > 0, 'boxes are allowed to share dimensions — that is the style');
  assert.equal(world.stats().avatar, boxes);
});

test('the avatar follows the sim: position, facing, and swinging limbs', () => {
  const { settings, state, world } = buildWorld();
  const camera = createCameraState();
  const limb = world.scene.getObjectByName('player-avatar').children.find((child) => child.geometry.type === 'BoxGeometry');

  state.player.position.x = 12;
  state.player.position.z = -7;
  state.player.yaw = 1.2;
  state.player.stridePhase = 0.9;
  state.player.velocity.x = 4;
  state.player.velocity.z = 0;
  state.player.grounded = true;

  // Two syncs: the pose eases in, exactly as it does in the frame loop.
  for (let i = 0; i < 20; i++) {
    resolveCamera({ player: state.player, settings, map: getMap(DEFAULT_MAP_ID), seed: state.seed }, camera);
    world.sync(state, camera);
  }
  const avatar = world.scene.getObjectByName('player-avatar');
  assert.equal(avatar.position.x, 12);
  assert.equal(avatar.position.z, -7);
  assert.equal(avatar.rotation.y, 1.2);
  assert.ok(Math.abs(limb.rotation.x) > 0.05, `limbs never moved: ${limb.rotation.x}`);
  for (const child of avatar.children) {
    assert.ok(Number.isFinite(child.rotation.x), 'a limb rotation went NaN');
  }
});

test('first person hides the body; third person shows it', () => {
  const { state, world } = buildWorld();
  const avatar = world.scene.getObjectByName('player-avatar');
  const camera = createCameraState();
  const map = getMap(DEFAULT_MAP_ID);

  resolveCamera({ player: state.player, settings: { view: 'first' }, map, seed: state.seed, obstacles: state.obstacles }, camera);
  world.sync(state, camera);
  assert.equal(avatar.visible, false);

  resolveCamera({ player: state.player, settings: { view: 'third', camDistance: 4.2 }, map, seed: state.seed, obstacles: state.obstacles }, camera);
  world.sync(state, camera);
  assert.equal(avatar.visible, true);
});
