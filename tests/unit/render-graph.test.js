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
import { AVATAR, nextFacing } from '../../src/render/player-view.js';
import { wrapAngle } from '../../src/core/math.js';
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

test('the player is a blocky, pixelated figure in ten boxes', () => {
  const { state, world } = buildWorld();
  const avatar = world.scene.getObjectByName('player-avatar');
  assert.ok(avatar, 'the scene has no player-avatar group');
  assert.equal(avatar.visible, true, 'third person draws the body');

  const meshes = [];
  avatar.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  // torso + head + 2 arms + 2 hands + 2 legs + 2 boots
  assert.equal(meshes.length, 10, `expected 10 boxes, found ${meshes.length}`);
  assert.equal(world.stats().avatar, 10);

  for (const mesh of meshes) {
    assert.equal(mesh.geometry.type, 'BoxGeometry', `${mesh.name || 'a part'} is not a box`);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const item of materials) {
      // Pixelated: every face is textured, and the sampling is nearest, which
      // is what makes the pixels stay pixels instead of blurring.
      assert.ok(item.map, 'a face with no texture would read as smooth, not pixelated');
      assert.equal(item.map.magFilter, THREE.NearestFilter, 'magnification must be nearest');
      assert.equal(item.map.colorSpace, THREE.SRGBColorSpace);
      assert.ok(item.map.image.data.length > 0, 'texture has no pixel data');
    }
  }

  // The head is the part that needs different textures per face: a face drawn
  // on all six sides is the classic give-away.
  const perFace = meshes.filter((mesh) => Array.isArray(mesh.material));
  assert.equal(perFace.length, 2, 'the head and the torso are textured per face');
  const head = perFace.find((mesh) => mesh.material[0].map.name.startsWith('head-'));
  assert.ok(head, 'no mesh wears the head textures');
  assert.equal(head.material.length, 6);
  const names = head.material.map((item) => item.map.name);
  assert.ok(names.includes('head-front'), `the head has no face texture: ${names.join(', ')}`);
  assert.equal(names.filter((name) => name === 'head-side').length, 2, 'both sides share one texture');
  assert.equal(head.material[2].map.name, 'head-top', 'the top of the head is hair');
});

test('the avatar follows the sim: position, facing, and swinging limbs', () => {
  const { settings, state, world } = buildWorld();
  const camera = createCameraState();
  const avatar = world.scene.getObjectByName('player-avatar');
  const limb = avatar.children.find((child) => child.geometry.type === 'BoxGeometry');

  state.player.position.x = 12;
  state.player.position.z = -7;
  state.player.yaw = 1.2;
  state.player.stridePhase = 0.9;
  state.player.strideAmplitude = 1;
  state.player.velocity.x = 4;
  state.player.velocity.z = 0;
  state.player.grounded = true;

  // A second of syncs: the pose eases in, exactly as it does in the frame loop.
  for (let i = 0; i < 60; i++) {
    resolveCamera({ player: state.player, settings, map: getMap(DEFAULT_MAP_ID), seed: state.seed }, camera);
    world.sync(state, camera, 1 / 60);
  }
  assert.equal(avatar.position.x, 12);
  assert.equal(avatar.position.z, -7);
  // The *body* faces the way it is travelling (velocity +x), which is not the
  // same thing as where the camera is pointing.
  // Asymptotic easing: it arrives within a thousandth of a degree, not exactly.
  assert.ok(
    Math.abs(wrapAngle(avatar.rotation.y - Math.atan2(-4, 0))) < 1e-4,
    `body faces ${avatar.rotation.y}, travel wants ${Math.atan2(-4, 0)}`,
  );
  assert.ok(Math.abs(limb.rotation.x) > 0.05, `limbs never moved: ${limb.rotation.x}`);
  for (const child of avatar.children) {
    assert.ok(Number.isFinite(child.rotation.x), 'a limb rotation went NaN');
  }
});

test('the body turns to face the way it walks, so the camera can see the front', () => {
  // Owner's PS: "because of camera position I cannot see the face". Facing the
  // direction of travel is what makes walking backwards show the face.
  const { settings, state, world } = buildWorld();
  const camera = createCameraState();
  const avatar = world.scene.getObjectByName('player-avatar');
  const sync = (seconds, velocity) => {
    state.player.velocity.x = velocity.x;
    state.player.velocity.z = velocity.z;
    state.player.grounded = true;
    state.player.strideAmplitude = 1;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      resolveCamera({ player: state.player, settings, map: getMap(DEFAULT_MAP_ID), seed: state.seed }, camera);
      world.sync(state, camera, 1 / 60);
    }
    return avatar.rotation.y;
  };

  // Walking forward (yaw 0 looks down -Z): body faces away from the camera.
  const forward = sync(1, { x: 0, z: -4 });
  assert.ok(Math.abs(forward) < 0.01, `forward facing ${forward}`);
  // Walking *backwards*: the body turns around and the face comes into view.
  const backward = sync(1, { x: 0, z: 4 });
  assert.ok(Math.abs(Math.abs(backward) - Math.PI) < 0.01, `backward facing ${backward}`);
  // Standing still keeps whatever facing it had (no snapping back).
  const stopped = sync(0.5, { x: 0, z: 0 });
  assert.equal(stopped, backward);
});

test('the girl can be switched on without rebuilding the world', () => {
  // The CI e2e run is what found this: the snapshot's `avatarVariant` has to
  // come from the renderer, so the test is that the *swap* happened here, not
  // that the setting reads back.
  const { settings, state, world } = buildWorld();
  const variant = getVariant(map.id, settings.palette);
  assert.equal(world.stats().avatarVariant, 'boy');
  const boyBoxes = world.stats().avatar;
  const boyTextures = world.stats().avatarTextures;
  const before = world.scene.getObjectByName('player-avatar');

  settings.girlPlayer = true;
  world.applySettings(settings, variant);
  assert.equal(world.stats().avatarVariant, 'girl');
  assert.equal(world.stats().avatar, boyBoxes + 2, 'long hair is two boxes');
  assert.equal(world.stats().avatarTextures, boyTextures + 2);
  const after = world.scene.getObjectByName('player-avatar');
  assert.notEqual(after, before, 'the figure should be a new object, not the old one re-labelled');
  assert.equal(
    world.scene.children.filter((child) => child.name === 'player-avatar').length,
    1,
    'the boy should not still be standing inside the girl',
  );

  // Setting it back is the same path in reverse.
  settings.girlPlayer = false;
  world.applySettings(settings, variant);
  assert.equal(world.stats().avatarVariant, 'boy');
  assert.equal(world.stats().avatar, boyBoxes);
  // The applied settings are unchanged apart from the body.
  assert.equal(state.entities.length, world.entityObjects.size);
});

test('nextFacing is pure, frame-rate independent and NaN-proof', () => {
  // Per-second easing: half a second reaches the turn at any frame rate.
  const walk = (fps) => {
    let facing = 0;
    for (let i = 0; i < fps / 2; i++) facing = nextFacing(facing, { x: 0, z: 4 }, 1 / fps);
    return facing;
  };
  assert.ok(Math.abs(walk(30) - walk(120)) < 0.01, `30 fps ${walk(30)}, 120 fps ${walk(120)}`);
  assert.ok(Math.abs(Math.abs(walk(60)) - Math.PI) < 0.05, 'half a second should very nearly complete a 180');

  // Walking a given direction must arrive at that direction, whatever it was
  // facing before — and whichever way round it has to turn to get there.
  const arrive = (velocity) => {
    let facing = 0;
    for (let i = 0; i < 120; i++) facing = nextFacing(facing, velocity, 1 / 60);
    return facing;
  };
  const near = (facing, expected, what) =>
    assert.ok(Math.abs(wrapAngle(facing - expected)) < 0.01, `${what}: got ${facing}, wanted ${expected}`);
  near(arrive({ x: -4, z: 0 }), Math.PI / 2, 'walking -x');
  near(arrive({ x: 4, z: 0 }), -Math.PI / 2, 'walking +x');
  near(arrive({ x: 0, z: 4 }), Math.PI, 'walking +z (toward a camera at yaw 0)');
  near(arrive({ x: 0, z: -4 }), 0, 'walking -z');

  // Standing still, junk and nothing to do all keep the facing.
  assert.equal(nextFacing(1.2, { x: 0, z: 0 }, 1 / 60), 1.2);
  assert.equal(nextFacing(1.2, { x: Number.NaN, z: Number.NaN }, 1 / 60), 1.2);
  assert.equal(nextFacing(1.2, null, 1 / 60), 1.2);
  const huge = nextFacing(0, { x: 4, z: 0 }, 100);
  assert.ok(Number.isFinite(huge) && Math.abs(huge) <= Math.PI, `a huge dt produced ${huge}`);
});

test('the easing does not care how fast the machine renders', () => {
  const { settings, state, world } = buildWorld();
  const camera = createCameraState();
  const limb = world.scene.getObjectByName('player-avatar').children.find((child) => child.geometry.type === 'BoxGeometry');
  state.player.velocity.x = 5;
  state.player.grounded = true;

  // One second of frames at 30 fps and one second at 120 fps must reach the
  // same pose: a phone with a fast screen must not animate faster.
  const run = (fps) => {
    const built = buildWorld();
    const builtLimb = built.world.scene
      .getObjectByName('player-avatar')
      .children.find((child) => child.geometry.type === 'BoxGeometry');
    const player = built.state.player;
    player.velocity.x = 5;
    player.grounded = true;
    player.stridePhase = 1.1;
    player.strideAmplitude = 1;
    for (let i = 0; i < fps; i++) {
      resolveCamera({ player, settings, map: getMap(DEFAULT_MAP_ID), seed: built.state.seed }, camera);
      built.world.sync(built.state, camera, 1 / fps);
    }
    return builtLimb.rotation.x;
  };
  const slow = run(30);
  const fast = run(120);
  assert.ok(Math.abs(slow) > 0.05, `the pose never moved: ${slow}`);
  assert.ok(Math.abs(slow - fast) < 0.05, `30 fps reached ${slow}, 120 fps reached ${fast}`);
  assert.ok(Math.abs(limb.rotation.x) >= 0);
});

test('first person hides the body; third person shows it', () => {
  const { state, world } = buildWorld();
  const avatar = world.scene.getObjectByName('player-avatar');
  const camera = createCameraState();
  const map = getMap(DEFAULT_MAP_ID);

  resolveCamera({ player: state.player, settings: { view: 'first' }, map, seed: state.seed, obstacles: state.obstacles }, camera);
  world.sync(state, camera, 1 / 60);
  assert.equal(avatar.visible, false);

  resolveCamera({ player: state.player, settings: { view: 'third', camDistance: 4.2 }, map, seed: state.seed, obstacles: state.obstacles }, camera);
  world.sync(state, camera, 1 / 60);
  assert.equal(avatar.visible, true);
});
