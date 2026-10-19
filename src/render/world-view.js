/**
 * Builds the Physical-Realm view of a map from world state.
 *
 * Rules honoured here (AGENT_PROMPT.md §5, §6):
 *  - pocket scale: everything inside ~1.2 km of the origin, fog does the rest;
 *  - flat shading, one palette, one landmark silhouette;
 *  - geometry never doubles as state: this module only *reads* world state.
 *
 * The Cognitive-Realm lens (M2) reuses this same scene graph — same objects,
 * same coordinates — and this module is also where the *policy* of a realm
 * shift lives: which furniture is drawn, what the sky is made of, what the
 * water is. The manifestation itself belongs to the world's `cognitiveSkin`
 * (see render/cognitive-view.js); the choice of when it applies is made once,
 * here, and nowhere else. Nothing in this file ever forks the state.
 */

import * as THREE from 'three';
import { hash2 } from '../core/noise.js';
import { facetNoise, groundFacetColor, groundPalette } from '../core/terrain-color.js';
import { terrainHeight } from '../core/world-state.js';
import { createSky } from './sky.js';
import { createPlayerAvatar } from './player-view.js';
import { createPerpendicularityView } from './perpendicularity-view.js';
import { createCognitiveView } from './cognitive-view.js';
import { createNpcView } from './npc-view.js';
import { createEnemyView } from './enemy-view.js';
import { resolveCognitiveSkin } from '../core/skin.js';

export function createWorldView({ map, state, variant, settings }) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);

  const sky = createSky({ variant });
  scene.add(sky.mesh);

  const fogColor = new THREE.Color(variant.fog.color);
  scene.fog = new THREE.FogExp2(fogColor.getHex(), settings.fog);

  const hemi = new THREE.HemisphereLight(new THREE.Color(variant.sky.horizon), new THREE.Color(variant.ground.low), settings.ambient);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(variant.sun.color), settings.sun);
  const sunDir = new THREE.Vector3(variant.sun.direction.x, variant.sun.direction.y, variant.sun.direction.z).normalize();
  sun.position.copy(sunDir).multiplyScalar(500);
  scene.add(sun);

  const ground = buildGround({ map, seed: state.seed, variant });
  group.add(ground.mesh);

  // The Cognitive manifestation (M2): what this world looks like from inside
  // the other realm. Data-driven; a map with no authored skin draws nothing.
  const skin = resolveCognitiveSkin(map);
  const cognitive = createCognitiveView({ map, state, variant, settings });
  scene.add(cognitive.group);

  // The Perpendicularity (M2): map furniture, drawn from the map's own data —
  // never from state, so a realm shift cannot move it or hide it. It does
  // change *substance* with the realm: water inverts to stone.
  const pool = createPerpendicularityView({ map, seed: state.seed, variant, skin });
  group.add(pool.group);

  const landmarkMaterials = {
    stone: new THREE.MeshLambertMaterial({ color: new THREE.Color(variant.props.landmark), flatShading: true }),
    base: new THREE.MeshLambertMaterial({
      color: new THREE.Color(variant.props.landmark).multiplyScalar(0.82),
      flatShading: true,
    }),
  };
  const rockMaterials = [0, 1, 2].map((tint) => {
    const color = new THREE.Color(variant.props.rock);
    const shifted = tint === 0 ? color.clone().multiplyScalar(0.86) : tint === 1 ? color.clone() : color.clone().multiplyScalar(1.14);
    return new THREE.MeshLambertMaterial({ color: shifted, flatShading: true });
  });

  // The player's body. It is not an entity (the sim owns the player, not the
  // entity list) and it is never authored by the renderer: this only draws it.
  // `girlPlayer` picks the alternate model, and switching it swaps the figure
  // in place — no world rebuild, no reload.
  let avatarVariant = settings.girlPlayer ? 'girl' : 'boy';
  let avatar = createPlayerAvatar({ variant: avatarVariant });
  scene.add(avatar.group);

  /** Physical furniture hidden while the cognitive manifestation is drawn. */
  const physicalFurniture = [ground.mesh];
  /** entity id -> Object3D, so state changes can be mirrored without a rebuild. */
  const entityObjects = new Map();
  const disposables = [ground.geometry, ...rockMaterials, ...Object.values(landmarkMaterials)];

  /** NPC view objects — carry their own sync (idle bob, nameplate billboard). */
  const npcViews = new Map();
  const npcDisposables = [];

  /**
   * Enemy view objects.
   *
   * Unlike the furniture and the NPCs these come and go while you play, so the
   * map is reconciled against world state every frame: a view is built the
   * first time an id appears and disposed the moment it stops. That is the same
   * one-source-of-truth rule as everything else here — the renderer never
   * decides an enemy exists, it only draws the ones the sim says do.
   */
  const enemyViews = new Map();

  for (const entity of state.entities) {
    let object;
    let isNpc = false;
    if (entity.kind === 'landmark') {
      object = buildLandmark(entity, map, landmarkMaterials);
    } else if (entity.kind === 'npc') {
      // NPCs manage their own scene node (nameplate, billboard) and are
      // excluded from the generic entity-object map so they do not appear as
      // rocks/beads/landmarks in either realm. They are *added to the scene*
      // but not tracked in entityObjects, which is a map of static
      // non-living furniture.
      const npcView = createNpcView(entity);
      npcViews.set(entity.id, npcView);
      npcDisposables.push(npcView);
      object = npcView.group;
      isNpc = true;
    } else {
      object = buildRock(entity, rockMaterials);
    }
    if (!object) continue;
    object.name = entity.id;
    object.userData.entityId = entity.id;
    group.add(object);
    if (!isNpc) {
      entityObjects.set(entity.id, object);
      // A non-living object's cognitive aspect is its bead, not its geometry.
      physicalFurniture.push(object);
    }
  }

  /**
   * Reconcile the enemy views with the ones the sim says are alive.
   *
   * Building and disposing happens only on a spawn or a removal, so the steady
   * state costs one map lookup per enemy per frame and allocates nothing.
   */
  function syncEnemyViews(currentState, physical) {
    const enemies = currentState.enemies ?? [];
    for (const enemy of enemies) {
      let view = enemyViews.get(enemy.id);
      if (!view) {
        view = createEnemyView(enemy);
        enemyViews.set(enemy.id, view);
        group.add(view.group);
      }
      view.group.visible = physical;
    }
    if (enemyViews.size !== enemies.length) {
      for (const [id, view] of enemyViews) {
        if (enemies.some((enemy) => enemy.id === id)) continue;
        group.remove(view.group);
        view.dispose();
        enemyViews.delete(id);
      }
    }
  }

  /** Which look is on screen, so the switch happens on the edge, not per frame. */
  let realmLook = null;
  /**
   * Is the cognitive manifestation drawing?
   *
   * Kept here rather than read back from `cognitive.group.visible`: the realm is
   * world state — `state.realm` decides it, via the one call in `sync` — and a
   * settings change that arrives before the first frame still has to know which
   * realm it is applying its fog and sun to.
   */
  let cognitiveOn = false;

  /**
   * Apply one realm's look. Called on the edge (a shift, a settings change or a
   * palette change), never per frame: it moves colours and visibilities, and
   * doing that sixty times a second would be churn for no new pixels.
   */
  function applyRealmLook(cognitiveActive) {
    const wanted = cognitiveActive ? 'cognitive' : 'physical';
    if (wanted === realmLook) return;
    realmLook = wanted;

    // The sky: the world's own gradient, or the skin's black sky and one frail
    // fixed white sun.
    if (cognitiveActive) {
      sky.setBackdrop({
        horizon: skin.light.sky.horizon,
        zenith: skin.light.sky.zenith,
        haze: skin.light.sky.haze,
        sunColor: skin.light.sun.color,
        sunDir: skin.light.sun.direction,
        sunDisc: skin.light.sun.discSize,
        sunStrength: skin.light.sun.strength,
      });
      scene.fog.color.set(skin.fog.color);
      scene.fog.density = Math.max(0, settings.fog) * skin.fog.densityScale;
      hemi.color.set(skin.light.ambient.color);
      hemi.groundColor.set(skin.palette.obsidian);
      hemi.intensity = settings.ambient * skin.light.ambient.scale;
      sun.color.set(skin.light.sun.color);
      sunDir.set(skin.light.sun.direction.x, skin.light.sun.direction.y, skin.light.sun.direction.z).normalize();
      sun.position.copy(sunDir).multiplyScalar(500);
      sun.intensity = settings.sun * skin.light.sun.scale;
      // A bead sea does not have grass: the ground under the beads goes dark so
      // the gaps between them read as depth rather than as a lawn.
      ground.setTint('#0a0f16');
    } else {
      sky.setVariant(variant);
      scene.fog.color.set(variant.fog.color);
      scene.fog.density = Math.max(0, settings.fog);
      hemi.color.set(variant.sky.horizon);
      hemi.groundColor.set(variant.ground.low);
      hemi.intensity = settings.ambient;
      sun.color.set(variant.sun.color);
      sunDir.set(variant.sun.direction.x, variant.sun.direction.y, variant.sun.direction.z).normalize();
      sun.position.copy(sunDir).multiplyScalar(500);
      sun.intensity = settings.sun;
      ground.setTint('#ffffff');
    }
    pool.setRealm(wanted, skin);
  }

  return {
    scene,
    group,
    entityObjects,
    /** Mirror state -> scene. Called once per rendered frame, allocates nothing. */
    sync(currentState, camera = null, dt = 1 / 60) {
      // The sky follows the player's feet, not the eye: the bob is a camera
      // effect and must not make the skyline jitter against the world.
      sky.follow(currentState.player.position);

      // The realm decides what exists on screen. The cognitive view answers
      // whether its manifestation is drawing; everything physical takes the
      // opposite answer. Note what is *not* here: no entity is added, removed,
      // moved or hidden from the simulation by any of this.
      cognitiveOn = cognitive.sync(currentState);
      applyRealmLook(cognitiveOn);
      const physical = !cognitiveOn;
      avatar.group.visible = physical;
      for (const object of physicalFurniture) object.visible = physical;
      // NPCs are living, like the player: bodies hide in the cognitive realm
      // (a flame stands in for them; see cognitive-view.sync).
      for (const npcView of npcViews.values()) {
        npcView.group.visible = physical;
        npcView.setNameplateVisible(physical);
      }
      // Enemies are living too: their bodies hide and a flame stands in for them
      // (see cognitive-view's enemy flame pool).
      syncEnemyViews(currentState, physical);

      for (const entity of currentState.entities) {
        const object = entityObjects.get(entity.id);
        if (!object) continue;
        if (object.userData.dynamic) {
          object.position.set(entity.position.x, entity.position.y, entity.position.z);
        }
      }
      if (physical) {
        avatar.sync(currentState.player, camera, dt);
        // NPCs bob on the sim clock and their nameplates face the camera.
        for (const npcView of npcViews.values()) {
          const npcEntity = currentState.entities.find((e) => e.id === npcView.entityId);
          if (npcEntity) npcView.sync(npcEntity, camera, currentState.simTime, dt);
        }
        for (const enemy of currentState.enemies ?? []) {
          const enemyView = enemyViews.get(enemy.id);
          if (enemyView) enemyView.sync(enemy, dt);
        }
      }
      // The pool breathes on the sim clock, so a run looks the same on replay.
      pool.sync(currentState.simTime);
      // The causeway answers the lens interaction's state, one stone per flame.
      pool.syncInsights(currentState);
    },
    applySettings(next, nextVariant) {
      const wanted = next.girlPlayer ? 'girl' : 'boy';
      if (wanted !== avatarVariant) {
        avatarVariant = wanted;
        scene.remove(avatar.group);
        avatar.dispose();
        avatar = createPlayerAvatar({ variant: avatarVariant });
        scene.add(avatar.group);
      }
      settings = next;
      // A slider change may have moved fog, ambient or sun while the *other*
      // realm is on screen: re-run the realm look rather than letting the
      // physical values leak into the cognitive one.
      realmLook = null;
      applyRealmLook(cognitiveOn);
      if (nextVariant !== variant) {
        variant = nextVariant;
        sky.setVariant(nextVariant);
        scene.fog.color.set(nextVariant.fog.color);
        hemi.color.set(nextVariant.sky.horizon);
        hemi.groundColor.set(nextVariant.ground.low);
        sun.color.set(nextVariant.sun.color);
        sunDir.set(nextVariant.sun.direction.x, nextVariant.sun.direction.y, nextVariant.sun.direction.z).normalize();
        sun.position.copy(sunDir).multiplyScalar(500);
        ground.setColors(nextVariant);
        pool.setVariant(nextVariant);
        // The palette is the physical world's weather; the cognitive look comes
        // from the skin, so it is re-applied *after* the variant swap.
        realmLook = null;
        applyRealmLook(cognitiveOn);
        landmarkMaterials.stone.color.set(nextVariant.props.landmark);
        landmarkMaterials.base.color.set(nextVariant.props.landmark).multiplyScalar(0.82);
        rockMaterials.forEach((material, tint) => {
          const color = new THREE.Color(nextVariant.props.rock);
          material.color.copy(tint === 0 ? color.clone().multiplyScalar(0.86) : tint === 1 ? color : color.clone().multiplyScalar(1.14));
        });
      }
    },
    stats() {
      return {
        meshes: group.children.length,
        entityCount: entityObjects.size,
        npcCount: npcViews.size,
        enemyCount: enemyViews.size,
        avatar: avatar.stats().boxes,
        avatarTextures: avatar.stats().textures,
        avatarVariant,
        pool: pool.stats(),
        realmLook,
        skin: cognitive.stats(),
      };
    },
    dispose() {
      for (const item of disposables) item.dispose?.();
      for (const item of npcDisposables) item.dispose?.();
      for (const view of enemyViews.values()) view.dispose();
      enemyViews.clear();
      pool.dispose();
      cognitive.dispose();
      avatar.dispose();
      sky.dispose();
      scene.clear();
    },
  };
}

/** Displaced, faceted ground plane with per-face colours (flat, low-poly). */
function buildGround({ map, seed, variant }) {
  const { size, segments } = map.ground;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute('uv');

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, terrainHeight(map, seed, x, z));
  }

  const faceted = geometry.toNonIndexed();
  geometry.dispose();
  faceted.computeVertexNormals();
  applyGroundColors(faceted, variant, map.ground.amplitude);

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(faceted, material);
  mesh.name = 'ground';

  return {
    mesh,
    geometry: faceted,
    /**
     * Tint the whole surface by multiplying the material colour.
     *
     * The terrain's colours are per-face vertex colours, so this is how the
     * ground is darkened under a bead sea (or restored) without rebuilding a
     * 20k-vertex geometry.
     */
    setTint(color) {
      material.color.set(color);
    },
    setColors(nextVariant) {
      applyGroundColors(faceted, nextVariant, map.ground.amplitude);
      faceted.attributes.color.needsUpdate = true;
    },
  };
}

/**
 * One flat colour per triangle, sampled from a smooth world-space colour field
 * (see core/terrain-color.js). The old version hashed quantised world
 * coordinates, which produced a visible grid aligned with the mesh.
 */
function applyGroundColors(geometry, variant, amplitude) {
  const position = geometry.attributes.position;
  const palette = groundPalette(variant);
  const triangles = position.count / 3;

  if (!geometry.attributes.color) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
  }
  const colors = geometry.attributes.color;
  const scratch = [0, 0, 0];

  for (let t = 0; t < triangles; t++) {
    const i0 = t * 3;
    const cx = (position.getX(i0) + position.getX(i0 + 1) + position.getX(i0 + 2)) / 3;
    const cy = (position.getY(i0) + position.getY(i0 + 1) + position.getY(i0 + 2)) / 3;
    const cz = (position.getZ(i0) + position.getZ(i0 + 1) + position.getZ(i0 + 2)) / 3;

    groundFacetColor({
      palette,
      x: cx,
      z: cz,
      height: cy,
      amplitude,
      facetHash: facetNoise(t),
      out: scratch,
    });

    for (let v = 0; v < 3; v++) colors.setXYZ(i0 + v, scratch[0], scratch[1], scratch[2]);
  }
  colors.needsUpdate = true;
}

function buildLandmark(entity, map, materials) {
  const definition = map.landmarks.find((l) => l.id === entity.id);
  if (!definition) return null;
  const seed = entity.id.charCodeAt(entity.id.length - 1) + definition.height;
  const object = new THREE.Group();
  object.position.set(entity.position.x, entity.position.y, entity.position.z);
  object.userData.dynamic = false;

  // Low broken plinth so the spire looks planted, not dropped.
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(definition.baseRadius * 1.05, definition.baseRadius * 1.45, definition.height * 0.07, 6, 1),
    materials.base,
  );
  plinth.position.y = definition.height * 0.035;
  object.add(plinth);

  // Companion shards: thin and leaning outward, never taller than half the
  // needle. Wider cones here read as a pile of traffic cones, not a spire.
  const shardCount = definition.shards;
  for (let i = 0; i < shardCount; i++) {
    const ratio = i / (shardCount - 1 || 1);
    const angle = ratio * Math.PI * 2 + 0.4 + hash2(i, seed + 23, 401) * 0.4;
    const spread = definition.spread * (0.35 + hash2(i, seed + 5, 199) * 0.8);
    const shaft = definition.height * (0.22 + hash2(i, seed, 991) * 0.26);
    const radius = definition.baseRadius * (0.06 + hash2(i, seed + 7, 313) * 0.07);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(radius, shaft, 5, 1), materials.stone);
    const lean = 0.05 + hash2(i, seed + 11, 733) * 0.12;
    shard.position.set(Math.cos(angle) * spread, definition.height * 0.05 + shaft / 2, Math.sin(angle) * spread);
    shard.rotation.y = hash2(i, seed + 3, 557) * Math.PI;
    // Tilt away from the centre so the group stays a cluster, not a picket line.
    shard.rotation.z = -Math.cos(angle) * lean;
    shard.rotation.x = Math.sin(angle) * lean;
    object.add(shard);
  }

  // The needle itself: the silhouette the whole map is built around (§6).
  const needle = new THREE.Mesh(
    new THREE.ConeGeometry(definition.baseRadius * 0.3, definition.height, 6, 1),
    materials.stone,
  );
  needle.position.y = definition.height * 0.5 + definition.height * 0.03;
  needle.rotation.y = 0.35;
  needle.rotation.z = 0.012;
  object.add(needle);

  return object;
}

function buildRock(entity, materials) {
  const geometry = ROCK_GEOMETRY;
  const mesh = new THREE.Mesh(geometry, materials[entity.tint] ?? materials[1]);
  mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
  mesh.rotation.set(0, entity.rotationY, 0);
  mesh.scale.set(entity.scale.x, entity.scale.y, entity.scale.z);
  // Sink a little so scattered rocks read as embedded, not floating.
  mesh.position.y -= entity.scale.y * 0.25;
  mesh.userData.dynamic = false;
  return mesh;
}

/** Shared 12-vertex icosahedron: one geometry, many chunky rocks. */
const ROCK_GEOMETRY = new THREE.IcosahedronGeometry(1, 0);
