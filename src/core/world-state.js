/**
 * World state — the single source of truth for a map.
 *
 * Both realms (and every future lens) read *this* object; rendering never keeps
 * its own copy of the world (AGENT_PROMPT.md §2). It is plain data + pure
 * functions, so it runs and is asserted headlessly in Node with no browser.
 */

import { REALMS, FENCE } from './config.js';
import { createRng, normalizeSeed } from './rng.js';
import { fbm2 } from './noise.js';
import { clamp, distanceFromOrigin } from './math.js';
import { applyLook } from './look.js';

/** Metres above the surface the observer's eye sits at (M1 player starts here). */
export const EYE_HEIGHT = 1.7;

export { clamp, distanceFromOrigin };

/** Terrain height at a world position (metres). Deterministic per seed. */
export function terrainHeight(map, seed, x, z) {
  const g = map.ground;
  const raw = fbm2(x * g.frequency, z * g.frequency, normalizeSeed(seed), g.octaves);
  const centred = (raw - 0.5) * 2; // [-1, 1]
  const dist = Math.hypot(x, z);
  // Flatten the spawn apron so the first thing the player sees is not a fold.
  const blend = dist >= g.flatRadius ? 1 : Math.max(0, dist / g.flatRadius - 0.15);
  const height = centred * g.amplitude * blend;
  return height === 0 ? 0 : height; // normalise -0 so state comparisons stay clean
}

function placeProps(map, seed) {
  const rng = createRng(seed ^ 0x5bf03635);
  const policy = map.propPolicy;
  const landmark = map.landmarks[0];
  const props = [];
  for (let i = 0; i < policy.count; i++) {
    let placed = null;
    for (let attempt = 0; attempt < 12 && !placed; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const radius = policy.innerRadius + rng.next() * (policy.outerRadius - policy.innerRadius);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const tooCloseToLandmark =
        landmark && Math.hypot(x - landmark.position.x, z - landmark.position.z) < policy.landmarkClearance;
      if (tooCloseToLandmark) continue;
      const scale = policy.minScale + rng.next() * (policy.maxScale - policy.minScale);
      placed = {
        id: `${policy.kind}-${String(i + 1).padStart(2, '0')}`,
        kind: policy.kind,
        static: true,
        position: { x, y: terrainHeight(map, seed, x, z), z },
        rotationY: rng.next() * Math.PI * 2,
        scale: { x: scale, y: scale * (0.6 + rng.next() * 0.55), z: scale * (0.75 + rng.next() * 0.5) },
        tint: rng.int(0, 2),
      };
    }
    if (placed) props.push(placed);
  }
  return props;
}

/**
 * Build a map's state from its seed. Called on load and on every seed change;
 * never mutated by rendering.
 */
export function createWorldState({ map, seed, environment = { seed: 0, time: 0 } }) {
  if (!map) throw new Error('createWorldState: map is required');
  const normalized = normalizeSeed(seed ?? map.defaultSeed);
  const entities = [];

  for (const landmark of map.landmarks) {
    entities.push({
      id: landmark.id,
      kind: 'landmark',
      label: landmark.label,
      static: true,
      position: {
        x: landmark.position.x,
        y: terrainHeight(map, normalized, landmark.position.x, landmark.position.z),
        z: landmark.position.z,
      },
      height: landmark.height,
      baseRadius: landmark.baseRadius,
    });
  }
  entities.push(...placeProps(map, normalized));

  return {
    mapId: map.id,
    seed: normalized,
    realm: REALMS.physical,
    tick: 0,
    simTime: 0,
    environment: { ...environment },
    entities,
    observer: {
      // Eyes at the origin apron, facing the landmark (-Z) so the very first
      // frame already shows the world's silhouette.
      position: { x: 0, y: terrainHeight(map, normalized, 0, 0) + EYE_HEIGHT, z: 0 },
      yaw: 0,
      pitch: -0.04,
    },
  };
}

/**
 * Advance the simulation one *fixed* step. Same input => same state, which is
 * what makes seeded runs reproducible.
 */
export function stepWorld(state, dt, input = null) {
  state.tick += 1;
  state.simTime += dt;
  if (input) {
    applyLook(state.observer, input, dt, {
      sensitivity: input.sensitivity ?? 1,
      invertY: input.invertY ?? false,
    });
  }
  return state;
}

/** The scale-fence canary (AGENT_PROMPT.md §8). */
export function scaleFenceStatus(state) {
  const distance = distanceFromOrigin(state.observer.position);
  const maxEntityDistance = state.entities.reduce(
    (acc, e) => Math.max(acc, Math.hypot(e.position.x, e.position.z)),
    0,
  );
  const worst = Math.max(distance, maxEntityDistance);
  return {
    distance,
    maxEntityDistance,
    worst,
    warn: worst > FENCE.originWarnDistance,
    limit: FENCE.originWarnDistance,
  };
}

/**
 * Cheap deterministic fingerprint of the world's contents. Same seed => same
 * hash, so the smoke test can prove reproducibility without pixel diffing.
 */
export function entityHash(state) {
  let h = 0x811c9dc5;
  const mix = (value) => {
    h ^= value & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  for (const entity of state.entities) {
    for (const char of entity.id) mix(char.charCodeAt(0));
    mix(Math.round(entity.position.x * 1000));
    mix(Math.round(entity.position.z * 1000));
    mix(Math.round((entity.scale?.x ?? entity.height ?? 1) * 1000));
  }
  return h >>> 0;
}

export function countEntities(state, kind) {
  if (!kind) return state.entities.length;
  return state.entities.reduce((acc, e) => acc + (e.kind === kind ? 1 : 0), 0);
}

export function findEntity(state, id) {
  return state.entities.find((e) => e.id === id) ?? null;
}
