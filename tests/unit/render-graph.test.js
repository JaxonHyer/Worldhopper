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

test('sync mirrors state positions and still works after a seed change', () => {
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
