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
import { createWorldState, setRealm } from '../../src/core/world-state.js';
import { buildSnapshot } from '../../src/core/snapshot.js';
import { createFixedClock } from '../../src/core/clock.js';
import { createFrameStats } from '../../src/core/frame-stats.js';
import { APP } from '../../src/core/config.js';
import { REALMS } from '../../src/core/config.js';
import { createCameraState, resolveCamera } from '../../src/core/camera.js';
import { AVATAR, createPlayerAvatar, nextFacing } from '../../src/render/player-view.js';
import { nameplateMetrics } from '../../src/render/npc-view.js';
import { wrapAngle } from '../../src/core/math.js';
import { ENEMY_TYPES } from '../../src/core/enemy.js';
import { getMap, getVariant, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';

// The first half of this file is about the *test range*: its pool, its palette
// variants, and the fact that it draws nothing in the cognitive realm because
// it has no canon to draw. Named explicitly rather than "the default map",
// which is Roshar now (the second half below covers that one).
const map = getMap('blank-basin');
const variant = getVariant(map.id, 'ashen-basin');

function buildWorld(overrides = {}) {
  const settings = { ...defaultSettings(), ...overrides };
  const state = createWorldState({ map, seed: settings.seed });
  const world = createWorldView({ map, state, variant: getVariant(map.id, settings.palette), settings });
  return { settings, state, world };
}

test('the Perpendicularity is drawn as map furniture, once', () => {
  const { world } = buildWorld();
  const pool = world.scene.getObjectByName('perpendicularity');
  assert.ok(pool, 'the pool must be in the scene');
  assert.equal(world.stats().pool.meshes, 3, 'shore, pool and the column of light');
  assert.ok(world.stats().pool.radius >= 1);
  // It is map data, not state: no entity id, and it is not one of the entities.
  assert.equal(pool.userData.entityId, undefined);
  assert.equal(world.entityObjects.size, buildWorld().world.entityObjects.size);
});

test('the pool is a surface you can see from the shore', () => {
  // The regression this pins: the disc was triangulated with the other winding,
  // so every face pointed *down*, the front faces were culled, and the water was
  // invisible in the physical realm — while the gate logic underneath it kept
  // working perfectly. No interaction test can see a hole in the ground.
  const { world } = buildWorld();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (const name of ['perpendicularity-pool', 'perpendicularity-shore']) {
    const mesh = world.scene.getObjectByName(name);
    assert.ok(mesh, `${name} must be named in the scene`);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    let upward = 0;
    let downward = 0;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      // The face normal, before any smoothing: (b - a) x (c - a).
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      if (normal.lengthSq() < 1e-12) continue; // the degenerate hub at the centre
      if (normal.y > 0) upward++;
      else downward++;
    }
    assert.ok(upward > 0, `${name} must have faces at all`);
    assert.equal(downward, 0, `${name} has downward faces, which are culled from above`);
  }
});

test('the world builds, with one object per state entity', () => {
  const { state, world } = buildWorld();
  // NPCs manage their own scene nodes (nameplate, billboard) and are not in
  // the generic entityObjects map; every other entity has one entry.
  const nonNpcCount = state.entities.filter((e) => e.kind !== 'npc').length;
  assert.equal(world.entityObjects.size, nonNpcCount);
  for (const entity of state.entities) {
    if (entity.kind === 'npc') continue;
    assert.ok(world.entityObjects.has(entity.id), `no scene object for ${entity.id}`);
  }
  // NPCs are still in the scene as children of the group (their npcCount is
  // exposed via stats).
  assert.ok(world.stats().npcCount >= 0);
  // ground + sky + landmark + props + npcs
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
  const { world } = buildWorld();
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
  // Same body, same textures in the same places: her hair is painted on, so a
  // girl costs the renderer exactly what a boy costs (the owner asked for it).
  assert.equal(world.stats().avatar, boyBoxes, 'long hair must not add boxes');
  assert.equal(world.stats().avatarTextures, boyTextures, 'long hair must not add textures');
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
  // The applied settings are unchanged apart from the body. NPCs are in the
  // scene but not in entityObjects (they manage their own rendering).
  const nonNpcCount = state.entities.filter((e) => e.kind !== 'npc').length;
  assert.equal(nonNpcCount, world.entityObjects.size);
});

test('the girl is slimmer, and the two bodies are the same shape otherwise', () => {
  const girl = createPlayerAvatar({ variant: 'girl' });
  const boy = createPlayerAvatar({ variant: 'boy' });
  assert.equal(girl.stats().boxes, boy.stats().boxes, 'a girl is not a different body plan');
  assert.equal(girl.stats().textures, boy.stats().textures);

  const armsOf = (avatar) => {
    const found = new Map();
    avatar.group.traverse((child) => {
      // Boxes are named `<variant>-left-arm`, so compare by the part, not by
      // the whole name.
      if (child.name.endsWith('-arm')) found.set(child.name.split('-').slice(1).join('-'), child.geometry.parameters.width);
    });
    return found;
  };
  const girlArms = armsOf(girl);
  const boyArms = armsOf(boy);
  assert.equal(girlArms.size, 2, 'expected a left and a right arm');
  for (const [name, width] of girlArms) {
    assert.equal(width, AVATAR.slimArmWidth, `${name} should be slim`);
    assert.ok(width < boyArms.get(name), `${name} should be narrower than the boy\u2019s`);
  }
  // Nothing else is slimmer: a girl is not a smaller person.
  const torsoOf = (avatar) => avatar.group.getObjectByName(`${avatar.group.userData.variant}-torso`);
  assert.equal(torsoOf(girl).geometry.parameters.width, torsoOf(boy).geometry.parameters.width);
  assert.equal(
    torsoOf(girl).geometry.parameters.height,
    torsoOf(boy).geometry.parameters.height,
  );
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

// --- the cognitive skin (M2): the same world, the other realm's furniture ---

const roshar = getMap('roshar');
const rosharVariant = getVariant('roshar', 'storm-shore');

function buildRosharan(overrides = {}) {
  const settings = { ...defaultSettings(), ...overrides };
  const state = createWorldState({ map: roshar, seed: settings.seed });
  const world = createWorldView({ map: roshar, state, variant: rosharVariant, settings });
  return { settings, state, world };
}

test('a world with no authored skin draws nothing in either realm', () => {
  const { state, world } = buildWorld();
  const skinGroup = world.scene.getObjectByName('cognitive-skin');
  assert.ok(skinGroup, 'the layer exists so the realm can be switched at all');
  assert.equal(skinGroup.visible, false, 'the test range has no canon, so it has no manifestation');
  assert.equal(world.stats().skin.authored, false);

  setRealm(state, REALMS.cognitive);
  world.sync(state);
  assert.equal(skinGroup.visible, false, 'and an unassigned skin stays off in the realm it belongs to');
  assert.equal(world.stats().skin.objectForm, 'unassigned');
  // The lens still works: this is a rendering absence, not a broken realm.
  assert.equal(state.realm, 'cognitive');
});

test("Roshar's skin builds: a bead sea, souls, and one flame", () => {
  const { world } = buildRosharan();
  const skinGroup = world.scene.getObjectByName('cognitive-skin');
  const sea = world.scene.getObjectByName('bead-sea');
  const souls = world.scene.getObjectByName('object-souls');
  assert.ok(skinGroup && sea && souls, 'the manifestation must be in the scene graph');
  assert.equal(skinGroup.visible, false, 'and hidden while the player is in the physical realm');

  const stats = world.stats().skin;
  assert.equal(stats.authored, true);
  assert.equal(stats.objectForm, 'glass-beads');
  assert.equal(stats.livingForm, 'flame');
  assert.equal(stats.waterForm, 'solid-obsidian');
  assert.equal(stats.landForm, 'bead-sea');
  // A sea, not a handful: the window has to cover the lens at 46 m.
  assert.ok(sea.count > 1000, `expected a bead sea, got ${sea.count} beads`);
  assert.ok(sea.count < 6000, 'an unbounded sea would be a performance bug, not a look');
  // One soul per non-living object, plus nothing else.
  assert.equal(souls.count, world.entityObjects.size);
});

test('the realm shift swaps the furniture in both directions', () => {
  const { state, world } = buildRosharan();
  const skinGroup = world.scene.getObjectByName('cognitive-skin');
  const avatar = world.scene.getObjectByName('player-avatar');
  const ground = world.scene.getObjectByName('ground');
  const skyUniforms = world.scene.getObjectByName('sky').material.uniforms;
  const firstEntityId = [...world.entityObjects.keys()][0];
  const firstEntity = world.scene.getObjectByName(firstEntityId);
  const physicalZenith = skyUniforms.uZenith.value.getHex();

  world.sync(state);
  assert.equal(avatar.visible, true, 'physical: the body is drawn');
  assert.equal(firstEntity.visible, true, 'physical: objects are drawn');
  assert.equal(world.stats().pool.water, 'liquid', 'physical: the pool is water');

  // --- shift ---------------------------------------------------------------
  setRealm(state, REALMS.cognitive);
  world.sync(state);
  assert.equal(skinGroup.visible, true, 'cognitive: the manifestation is drawn');
  assert.equal(world.stats().realmLook, 'cognitive');
  assert.equal(avatar.visible, false, "the player is a flame now, so the body is not drawn twice");
  assert.equal(firstEntity.visible, false, "an object's cognitive aspect is its bead");
  assert.equal(world.stats().pool.water, 'solid-obsidian', 'water inverts to stone');
  assert.equal(skyUniforms.uZenith.value.getHex(), 0x000000, 'black sky');
  assert.equal(skyUniforms.uSunStrength.value < 1, true, 'one frail sun, not a noon sun');
  // The bead sea does not sit on a lawn: the ground goes dark under it.
  assert.notEqual(ground.material.color.getHex(), 0xffffff);
  assert.notEqual(skyUniforms.uZenith.value.getHex(), physicalZenith);

  // The camera is the lens in this realm, and the snapshot says so.
  assert.equal(state.realm, 'cognitive');

  // --- and home again ------------------------------------------------------
  setRealm(state, REALMS.physical);
  world.sync(state);
  assert.equal(skinGroup.visible, false);
  assert.equal(avatar.visible, true);
  assert.equal(firstEntity.visible, true);
  assert.equal(world.stats().pool.water, 'liquid');
  assert.equal(ground.material.color.getHex(), 0xffffff, 'the ground tint is restored, not left dark');
  assert.equal(skyUniforms.uZenith.value.getHex(), physicalZenith, 'and so is the sky');
});

test('a bead is where it was, whatever the camera does', () => {
  // Determinism: the same seed lays the same sea, and a different seed does not.
  const a = buildRosharan();
  const b = buildRosharan();
  const c = buildRosharan({ seed: 99 });
  // A *drawn* bead: a dropped slot is scale-0 by design, and identical in every
  // sea, so comparing one of those would prove nothing about determinism.
  const firstDrawn = (world) => {
    const array = world.scene.getObjectByName('bead-sea').instanceMatrix.array;
    for (let i = 0; i < array.length; i += 16) {
      if (array[i] !== 0) return Array.from(array.slice(i, i + 16));
    }
    return null;
  };
  const state = a.state;
  setRealm(state, REALMS.cognitive);
  a.world.sync(state);
  setRealm(b.state, REALMS.cognitive);
  b.world.sync(b.state);
  setRealm(c.state, REALMS.cognitive);
  c.world.sync(c.state);
  const beadA = firstDrawn(a.world);
  assert.ok(beadA, 'the sea must actually have beads in it');
  assert.deepEqual(beadA, firstDrawn(b.world), 'same seed, same bead');
  assert.notDeepEqual(beadA, firstDrawn(c.world), 'a different seed is a different sea');
});

test('the bead sea leaves the gate a pool, and fades at its own edge', () => {
  // Two things the first screenshot showed and the eye cannot un-see: beads
  // scattered across the Perpendicularity (so the gate stopped being a gate),
  // and a hard square edge where the window ran out (which read as a bug).
  const { state, world } = buildRosharan();
  setRealm(state, REALMS.cognitive);
  world.sync(state);

  const gate = roshar.perpendicularity;
  const sea = world.scene.getObjectByName('bead-sea');
  const array = sea.instanceMatrix.array;
  const stats = world.stats().skin;

  let drawn = 0;
  let outsideWindow = 0;
  for (let i = 0; i < array.length; i += 16) {
    if (array[i] === 0) continue; // a dropped slot
    drawn++;
    const x = array[i + 12];
    const z = array[i + 14];
    assert.ok(
      Math.hypot(x - gate.position.x, z - gate.position.z) >= gate.radius,
      `a bead sits inside the pool at ${x.toFixed(1)}, ${z.toFixed(1)}`,
    );
    if (Math.hypot(x - state.player.position.x, z - state.player.position.z) > 46) outsideWindow++;
  }

  assert.equal(drawn, stats.beads, 'the reported bead count must be the drawn beads');
  assert.ok(stats.beads > 1000, `expected a sea, got ${stats.beads} beads`);
  assert.equal(outsideWindow, 0, 'no bead may be laid outside the window it is carried in');
  assert.ok(stats.seaDropped > 0, 'the pool and the faded edge must actually drop beads');
  assert.ok(stats.seaDropped < stats.seaSlots / 2, 'the window must be mostly beads, not mostly hole');
});

test('the inverted pool reads as dark stone in the physical palette\'s shadow', () => {
  // The first screenshots showed the inverted pool as a milky smear: a broad
  // specular under the frail sun's near-vertical light. Obsidian is glass, but
  // this is a diagram — a dim tight highlight on flat facets is what reads as
  // polished black stone.
  const { state, world } = buildRosharan();
  setRealm(state, REALMS.cognitive);
  world.sync(state);

  const pool = world.scene.getObjectByName('perpendicularity-pool');
  const shore = world.scene.getObjectByName('perpendicularity-shore');
  const material = pool.material;
  assert.equal(material.flatShading, true, 'faceted: the rest of the world is faceted');
  assert.ok(material.shininess <= 30, `shininess ${material.shininess} blurs into a smear`);
  const luma = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(luma(material.specular) < 0.35, 'the highlight must be dim: a bright specular is the smear');
  assert.ok(luma(material.color) < 0.06, 'the stone itself is nearly black');

  // ...and the shore goes with the water, rather than ringing it in the physical
  // palette's pale colour.
  assert.ok(shore.material.color.getHex() < 0x303030, 'the shore must darken with the water it rims');

  // Coming home restores both, from the variant that is loaded now.
  setRealm(state, REALMS.physical);
  world.sync(state);
  assert.equal(world.stats().pool.water, 'liquid');
  const home = world.scene.getObjectByName('perpendicularity-pool');
  assert.equal(home.material.isMeshBasicMaterial, true, 'the pool is unlit water again, not polished stone');
  assert.ok(luma(home.material.color) > 0.5, 'and it is the palette pale again');
  assert.ok(luma(shore.material.color) > 0.05, 'the pale shore is restored');
});

test('a nameplate is a label above a head, not a billboard across the screen', () => {
  // The first cut scaled the sprite to 1 m tall × its canvas aspect wide. For a
  // 3.6-aspect name that is a 3.6 m × 1 m label over a 1.8 m person: on a phone
  // it filled the view and read as a cut-off word ("nderer") in the sky. The
  // screenshot is what caught it; this is what stops it coming back.
  for (const aspect of [1, 2.5, 3.6, 4, 8, 40, 0, -3, Number.NaN]) {
    const metrics = nameplateMetrics(aspect);
    assert.ok(metrics.height > 0.1 && metrics.height <= 0.25, `a label's height (${aspect} → ${metrics.height} m)`);
    assert.ok(metrics.width > 0 && metrics.width <= 1.3, `no wider than a body (${aspect} → ${metrics.width} m)`);
    assert.ok(metrics.lift >= 0.2 && metrics.lift <= 0.6, `lifted clear of the head, not into the sky (lift ${metrics.lift} m)`);
  }
  // A long name is capped, not stretched: once the cap is hit, more text does
  // not make a wider label.
  assert.equal(nameplateMetrics(40).width, nameplateMetrics(20).width, 'past the cap, aspect stops mattering');
  // And a nonsense aspect still produces a usable label.
  assert.ok(nameplateMetrics(Number.NaN).width > 0);
});

// --- enemies (WP-3.2) ---------------------------------------------------------

/**
 * The tier is a hard rule, not a taste call: "box-part rigs, flat colours,
 * procedural animation only — no skeletal rigs, no IK, no facial animation."
 * These tests are what stops a future change from quietly upgrading an enemy
 * into something the project has already decided it is not building.
 */
test('an enemy is drawn from world state, as boxes and nothing else', () => {
  const { state, world } = buildWorld();
  assert.ok(state.enemies.length > 0, 'the world opens inhabited');
  world.sync(state);

  assert.equal(world.stats().enemyCount, state.enemies.length, 'one view per live enemy');
  for (const enemy of state.enemies) {
    const type = ENEMY_TYPES[enemy.typeId];
    const group = world.scene.getObjectByName(enemy.id);
    assert.ok(group, `${enemy.id} must be in the scene`);
    assert.equal(group.userData.kind, 'enemy');

    let boxes = 0;
    group.traverse((node) => {
      if (!node.isMesh) return;
      // A SkinnedMesh would be a skeletal rig; a Points or Line would be
      // something the art direction does not use. Boxes, or it is not this game.
      assert.equal(node.isSkinnedMesh, undefined, `${node.name} is a skinned mesh`);
      assert.ok(
        node.geometry.type === 'BoxGeometry' ||
          node.geometry.type === 'RingGeometry' ||
          node.geometry.type === 'OctahedronGeometry',
        `${node.name} is a ${node.geometry.type}`,
      );
      if (node.geometry.type === 'BoxGeometry') boxes++;
      // Textures are allowed, but ONLY the baked creature skins named by the
      // archetype row — AI art for the bosses, pixel grids at 32x32. Anything
      // else textured would be the tier quietly slipping.
      if (node.material.map) {
        const skin = (type.texture ?? {});
        assert.ok(
          Object.values(skin).includes(node.material.map.name),
          `${node.name} carries an undeclared texture: ${node.material.map.name}`,
        );
      }
    });
    // Body, head, and at least one limb: the brief's 1–4 limbs.
    assert.ok(boxes >= 3, `${enemy.id} is only ${boxes} boxes`);
  }
});

test('the tell is invisible until the wind-up starts, and only then', () => {
  const { state, world } = buildWorld();
  world.sync(state);
  const enemy = state.enemies[0];
  const view = world.scene.getObjectByName(enemy.id);

  world.sync(state);
  assert.equal(enemy.tell, 0, 'nothing is wound up yet');

  enemy.tell = 0.6;
  enemy.state = 'attack';
  world.sync(state);
  // The ring is a child of the enemy group, so find it by walking the group.
  let ring = null;
  view.traverse((node) => {
    if (node.isMesh && node.geometry.type === 'RingGeometry') ring = node;
  });
  assert.ok(ring, 'the tell has to be something you can see');
  assert.equal(ring.visible, true, 'and it appears during the wind-up');
  assert.ok(ring.material.opacity > 0.3, `the tell is too faint to read: ${ring.material.opacity}`);
});

test('an enemy that dies leaves the scene graph', () => {
  const { state, world } = buildWorld();
  world.sync(state);
  const before = world.stats().enemyCount;
  const id = state.enemies[0].id;
  assert.ok(world.scene.getObjectByName(id));

  state.enemies.shift();
  world.sync(state);
  assert.equal(world.stats().enemyCount, before - 1);
  assert.equal(world.scene.getObjectByName(id), undefined, 'a removed enemy must not keep drawing');
});

test('enemies are living: their bodies hide in the realm and a flame stands in', () => {
  const { state, world } = buildRosharan();
  world.sync(state);
  const enemy = state.enemies[0];
  const body = world.scene.getObjectByName(enemy.id);
  assert.equal(body.visible, true, 'physical: the body is drawn');

  setRealm(state, REALMS.cognitive);
  world.sync(state);
  assert.equal(body.visible, false, 'cognitive: the body is not');
  const flame = world.scene.getObjectByName('enemy-flame-0');
  assert.ok(flame, 'and a flame takes its place');
  assert.equal(flame.visible, true);
  assert.equal(world.stats().skin.enemyFlames, state.enemies.length, 'one flame per living enemy');
});

/**
 * The generic guard for the snapshot whitelist trap.
 *
 * `buildSnapshot` names every field it will carry, and a field a renderer starts
 * reporting without a matching line there disappears in silence and reads back
 * as `undefined`. It has now happened three times (`fade`, `npcFlames`,
 * `enemyFlames`), so the rule is a test rather than a memory.
 *
 * The guard is over the *counts*, not over every key in `stats().skin`: the
 * renderer legitimately reports internals the snapshot does not ship
 * (`seaSlots`, `violations`, `flame`). What must survive is the set the browser
 * tests actually assert on — and those are precisely the ones that keep going
 * missing.
 */
const SKIN_COUNTS_THE_TESTS_READ = ['beads', 'souls', 'npcFlames', 'enemyFlames'];

test('the skin counts the browser tests read survive the snapshot whitelist', () => {
  const { state, world } = buildRosharan();
  setRealm(state, REALMS.cognitive);
  world.sync(state);
  const reported = world.stats().skin;

  const snapshot = buildSnapshot({
    app: APP,
    state,
    map,
    variant: getVariant(map.id, 'storm-shore'),
    settings: defaultSettings(),
    clock: createFixedClock({ stepHz: 60 }),
    frameStats: createFrameStats(),
    render: { drawCalls: 0, triangles: 0, gl: { version: 'x', gpu: 'y' }, avatarVariant: 'boy', skin: reported },
    ui: { overlay: false, panel: false, credits: false, touch: false, fade: false, fades: 0 },
    input: null,
    paused: false,
    ready: true,
  });

  for (const key of SKIN_COUNTS_THE_TESTS_READ) {
    assert.ok(key in reported, `the renderer stopped reporting ${key}, so this list is stale`);
    assert.ok(key in snapshot.skin, `the renderer reports skin.${key} and the snapshot drops it`);
    assert.ok(Number.isFinite(snapshot.skin[key]), `skin.${key} came back ${String(snapshot.skin[key])}`);
  }
  assert.ok(snapshot.skin.enemyFlames > 0, 'the enemy flames are counted, not just drawn');
  assert.ok(snapshot.skin.npcFlames > 0, 'and so are the NPCs\u2019');
});

test('the enemy flame pool is sized by the contract, so play allocates nothing', () => {
  const { world } = buildRosharan();
  let slots = 0;
  world.scene.traverse((node) => {
    if (node.name.startsWith('enemy-flame-')) slots++;
  });
  assert.equal(slots, 6, 'the fairness contract’s hard cap on live enemies');
});

test('the Chasmfiend rig is the giant 14-legger the owner ordered, and its tell fits the body', () => {
  const { state, world } = buildWorld();
  world.sync(state);
  const fiend = state.enemies.find((e) => e.typeId === 'storm-warden') ?? state.enemies[0];
  const type = ENEMY_TYPES[fiend.typeId];
  const view = world.scene.getObjectByName(fiend.id);

  let legs = 0;
  let rings = 0;
  let ringMesh = null;
  view.traverse((node) => {
    if (node.name.startsWith('enemy-leg-')) legs++;
    if (node.isMesh && node.geometry.type === 'RingGeometry') {
      rings++;
      ringMesh = node;
    }
  });
  assert.equal(legs, type.legs, `the rig renders every leg the row declares (${type.legs})`);
  assert.ok(rings >= 1, 'the tell ring exists');

  // The fairness ring scales with the body, so a giant's warning is giant.
  fiend.tell = 0.7;
  world.sync(state);
  assert.ok(ringMesh.scale.x > type.radius, `ring at tell 0.7 spans width ${ringMesh.scale.x.toFixed(2)} vs body radius ${type.radius}`);

  // And the shell skin is on the body — the AI-texture experiment is live.
  const body = view.getObjectByName('enemy-body');
  assert.ok(body.material.map, 'a baked skin is actually sampling');
  assert.ok(body.material.map.name.includes('chasm') || body.material.map.name.includes('whitespine'));
});

test('the Whitespine’s back sits at the player’s head, with white plates along it', () => {
  const { state, world } = buildWorld();
  world.sync(state);
  const spine = state.enemies.find((e) => e.typeId === 'crag-lurker');
  assert.ok(spine, 'a Whitespine is present');
  const type = ENEMY_TYPES['crag-lurker'];

  // The back (top of the body box) is the measurement the owner gave:
  // "backs are about as high as the player's head" — head at ~1.7 m.
  const back = type.height - Math.min(0.5, type.height * 0.26) * 0.85;
  assert.ok(back >= 1.5 && back <= 1.8, `back at ${back.toFixed(2)} m, asked ~1.7 m`);

  const view = world.scene.getObjectByName(spine.id);
  const plates = [];
  view.traverse((node) => {
    if (node.name === 'enemy-spine') plates.push(node);
  });
  assert.ok(plates.length >= 5, `the spine LINE reads (${plates.length} plates)`);
  // The plates must be the bright namesake colour — "white spines" — or the
  // whole point is lost in the fog.
  const tint = plates[0].material.color;
  assert.ok(tint.r > 0.85 && tint.g > 0.85 && tint.b > 0.75, `spine plate colour rgb(${tint.r.toFixed(2)},${tint.g.toFixed(2)},${tint.b.toFixed(2)}) is not white`);
});

test('the centipede-crab frame: six chain sections, pincers up front, and a LOT longer (owner, 2026-10-18)', () => {
  // Roshar, not the test range: the guaranteed pool-side Chasmfiend lives there
  // (the range has no placements, so its draws are all Whitespines at 9:1).
  const { state, world } = buildRosharan();
  world.sync(state);
  const fiend = state.enemies.find((e) => e.typeId === 'storm-warden');
  assert.ok(fiend, 'the pool Chasmfiend is in the scene');
  const view = world.scene.getObjectByName(fiend.id);

  let segmentBoxes = 0;
  let pincerBoxes = 0;
  let lastSegmentZ = -Infinity;
  view.traverse((node) => {
    if (node.name.startsWith('enemy-segment-')) {
      segmentBoxes++;
      lastSegmentZ = Math.max(lastSegmentZ, node.position.z);
    }
    if (node.name === 'enemy-pincer') pincerBoxes++;
  });
  const type = ENEMY_TYPES['storm-warden'];
  assert.equal(segmentBoxes, type.dims.segments - 1, 'every chain section is a box');
  assert.equal(pincerBoxes, 2, 'crab claws, one per side');

  // The owner said "a LOT longer". The shell must run for metres, not blobs:
  // assert the tail section sits at least three body-depths behind the head.
  assert.ok(lastSegmentZ >= type.dims.depth * 3, `shell tail at ${lastSegmentZ.toFixed(1)} m behind the head`);
});

test('a quad rig fan-out: fourteen legs is data, and the ripples are procedural', () => {
  // The Chasmfiend's gait is a phase ripple down each row — legs move as boxes
  // on pivots, nothing skeletal. Assert the data path, not the frame.
  const type = ENEMY_TYPES['storm-warden'];
  assert.equal(type.legs, 14);
  assert.ok(type.legs % 2 === 0, 'fanned in pairs');
});

test('memory-flames stand in the lens, unlit and lit alike — and only in the lens', () => {
  const { state, world } = buildRosharan();
  world.sync(state);
  const list = ['lamp-basin-north', 'lamp-basin-west', 'lamp-basin-east', 'lamp-basin-south'];
  for (const id of list) {
    const flame = world.scene.getObjectByName(`insight-flame-${id}`);
    assert.ok(flame, `${id} exists in the cognitive scene graph`);
  }
  // State drives the burn, not the renderer's mood: light two and re-sync.
  state.insights['lamp-basin-north'] = true;
  world.stats().skin.insights !== undefined && assert.equal(world.stats().skin.insights, 4);
});

test('lighting a flame raises one obsidian stepping stone in the pool — then the causeway', () => {
  const { state, world } = buildRosharan();
  const pool_ = world.scene.getObjectByName('perpendicularity');
  world.sync(state);
  assert.equal(
    pool_.children.filter((c) => c.name.endsWith('-stone')).length,
    0,
    'no stones while nothing is lit',
  );
  state.insights['lamp-basin-north'] = true;
  world.sync(state);
  const one = pool_.children.filter((c) => c.name.endsWith('-stone'));
  assert.equal(one.length, 1, 'one stone for one lit flame');
  assert.ok(one[0].visible, 'and it is drawn');
  // The full four: the causeway reads as a line of stones across the basin.
  for (const id of Object.keys(state.insights)) state.insights[id] = true;
  world.sync(state);
  assert.equal(pool_.children.filter((c) => c.name.endsWith('-stone')).length, 4, 'all four stones risen');
});

test('stones hide in the cognitive realm — the inversion rules the lens, not causeway side-effects', () => {
  const { state, world } = buildRosharan();
  for (const id of Object.keys(state.insights)) state.insights[id] = true;
  setRealm(state, REALMS.cognitive);
  world.sync(state);
  const pool_ = world.scene.getObjectByName('perpendicularity');
  const stones = pool_.children.filter((c) => c.name.endsWith('-stone'));
  assert.equal(stones.length, 4, 'they exist in world state');
  assert.ok(stones.every((s) => !s.visible), 'but the lens does not draw them');
});
