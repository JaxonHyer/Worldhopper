/**
 * Builds the Physical-Realm view of a map from world state.
 *
 * Rules honoured here (AGENT_PROMPT.md §5, §6):
 *  - pocket scale: everything inside ~1.2 km of the origin, fog does the rest;
 *  - flat shading, one palette, one landmark silhouette;
 *  - geometry never doubles as state: this module only *reads* world state.
 *
 * The Cognitive-Realm lens (M2) will reuse the same scene graph via its own
 * camera + material pass; nothing here should ever fork the state.
 */

import * as THREE from 'three';
import { hash2 } from '../core/noise.js';
import { terrainHeight } from '../core/world-state.js';
import { createSky } from './sky.js';

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

  /** entity id -> Object3D, so state changes can be mirrored without a rebuild. */
  const entityObjects = new Map();
  const disposables = [ground.geometry, ...rockMaterials, ...Object.values(landmarkMaterials)];

  for (const entity of state.entities) {
    const object = entity.kind === 'landmark' ? buildLandmark(entity, map, landmarkMaterials) : buildRock(entity, rockMaterials);
    if (!object) continue;
    object.name = entity.id;
    object.userData.entityId = entity.id;
    group.add(object);
    entityObjects.set(entity.id, object);
  }

  return {
    scene,
    group,
    entityObjects,
    /** Mirror state -> scene. Called once per rendered frame, allocates nothing. */
    sync(currentState) {
      sky.follow(currentState.observer.position);
      for (const entity of currentState.entities) {
        const object = entityObjects.get(entity.id);
        if (!object) continue;
        if (object.userData.dynamic) {
          object.position.set(entity.position.x, entity.position.y, entity.position.z);
        }
      }
    },
    applySettings(next, nextVariant) {
      scene.fog.color.set(nextVariant.fog.color);
      scene.fog.density = next.fog;
      hemi.intensity = next.ambient;
      sun.intensity = next.sun;
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
        landmarkMaterials.stone.color.set(nextVariant.props.landmark);
        landmarkMaterials.base.color.set(nextVariant.props.landmark).multiplyScalar(0.82);
        rockMaterials.forEach((material, tint) => {
          const color = new THREE.Color(nextVariant.props.rock);
          material.color.copy(tint === 0 ? color.clone().multiplyScalar(0.86) : tint === 1 ? color : color.clone().multiplyScalar(1.14));
        });
      }
    },
    stats() {
      return { meshes: group.children.length, entityCount: entityObjects.size };
    },
    dispose() {
      for (const item of disposables) item.dispose?.();
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
  applyGroundColors(faceted, variant);

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(faceted, material);
  mesh.name = 'ground';

  return {
    mesh,
    geometry: faceted,
    setColors(nextVariant) {
      applyGroundColors(faceted, nextVariant);
      faceted.attributes.color.needsUpdate = true;
    },
  };
}

/** One flat colour per triangle: two-tone ground + occasional dark facets. */
function applyGroundColors(geometry, variant) {
  const position = geometry.attributes.position;
  const low = new THREE.Color(variant.ground.low);
  const high = new THREE.Color(variant.ground.high);
  const accent = new THREE.Color(variant.ground.accent);
  const triangles = position.count / 3;

  if (!geometry.attributes.color) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
  }
  const colors = geometry.attributes.color;
  const scratch = new THREE.Color();

  for (let t = 0; t < triangles; t++) {
    const i0 = t * 3;
    const cx = (position.getX(i0) + position.getX(i0 + 1) + position.getX(i0 + 2)) / 3;
    const cy = (position.getY(i0) + position.getY(i0 + 1) + position.getY(i0 + 2)) / 3;
    const cz = (position.getZ(i0) + position.getZ(i0 + 1) + position.getZ(i0 + 2)) / 3;

    const heightMix = Math.min(1, Math.max(0, (cy + 1.2) / 3.2));
    scratch.copy(low).lerp(high, heightMix);

    // Stable per-facet jitter: same seed => same facets.
    const grain = hash2(Math.round(cx * 0.5), Math.round(cz * 0.5), 7717);
    scratch.multiplyScalar(0.94 + grain * 0.12);
    if (grain > 0.82) scratch.lerp(accent, 0.55);

    for (let v = 0; v < 3; v++) colors.setXYZ(i0 + v, scratch.r, scratch.g, scratch.b);
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

  // Wide broken plinth so the spire looks planted, not dropped.
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(definition.baseRadius * 1.55, definition.baseRadius * 1.9, definition.height * 0.11, 7, 1),
    materials.base,
  );
  plinth.position.y = definition.height * 0.05;
  object.add(plinth);

  const shardCount = definition.shards;
  for (let i = 0; i < shardCount; i++) {
    const ratio = i / (shardCount - 1 || 1);
    const angle = ratio * Math.PI * 2 + 0.4;
    const spread = definition.spread * (0.4 + ratio * 0.6);
    const height = definition.height * (0.34 + hash2(i, seed, 991) * 0.4);
    const radius = definition.baseRadius * (0.2 + hash2(i, seed + 7, 313) * 0.16);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5, 1), materials.stone);
    shard.position.set(Math.cos(angle) * spread, definition.height * 0.08 + height / 2, Math.sin(angle) * spread);
    shard.rotation.y = hash2(i, seed + 3, 557) * Math.PI;
    shard.rotation.z = (hash2(i, seed + 11, 733) - 0.5) * 0.16;
    object.add(shard);
  }

  // The needle itself: the silhouette the whole map is built around (§6).
  const needle = new THREE.Mesh(
    new THREE.ConeGeometry(definition.baseRadius * 0.34, definition.height, 6, 1),
    materials.stone,
  );
  needle.position.y = definition.height * 0.5 + definition.height * 0.06;
  needle.rotation.y = 0.35;
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
