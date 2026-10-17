/**
 * World state — the single source of truth for a map.
 *
 * Both realms (and every future lens) read *this* object; rendering never keeps
 * its own copy of the world (AGENT_PROMPT.md §2). It is plain data + pure
 * functions, so it runs and is asserted headlessly in Node with no browser.
 */

import { REALMS, FENCE } from './config.js';
import { createRng, normalizeSeed } from './rng.js';
import { clamp, distanceFromOrigin } from './math.js';
import { terrainHeight } from './terrain.js';
import { createPlayer, stepPlayer } from './player.js';
import { loadNpc } from '../content/npcs.js';
import { createAttack, createCombat, respawnPlayer, stepAttack, stepCombat } from './combat.js';
import { activeCap, createSpawner, placeInitialEnemies, stepEnemies, stepSpawner } from './enemy.js';

export { terrainHeight, clamp, distanceFromOrigin };
export const EYE_HEIGHT = 1.7;

/**
 * Place NPCs from the map's npcs list. An NPC is an entity in world state —
 * one source of truth, never a renderer-only object (ROADMAP M3, WP-3.4).
 * Dialogue data is loaded by id; position/rotation/yaw come from the map so
 * the author decides where each one stands.
 */
function placeNpcs(map, seed) {
  const list = Array.isArray(map.npcs) ? map.npcs : [];
  const npcs = [];
  for (const placement of list) {
    const data = loadNpc(placement.npcId);
    npcs.push({
      id: placement.id ?? `npc-${data.id}`,
      kind: 'npc',
      npcId: data.id,
      name: data.name,
      title: data.title ?? null,
      palette: data.palette ?? null,
      static: true,
      // Standing position: feet on the ground. An NPC faces whatever yaw the map
      // says (0 = facing -Z, i.e. the direction the player spawns looking).
      position: {
        x: placement.position?.x ?? 0,
        y: terrainHeight(map, seed, placement.position?.x ?? 0, placement.position?.z ?? 0),
        z: placement.position?.z ?? 0,
      },
      rotationY: placement.rotationY ?? 0,
      // Scale and bounding radius for interaction: same tier as the player.
      scale: { x: 1, y: 1, z: 1 },
      // Interaction radius in metres: how close the player must be for the
      // talk prompt to appear. Phone-tappable, not pixel-hunting.
      interactRadius: placement.interactRadius ?? 3.0,
    });
  }
  return npcs;
}

/** Where the beacons stand, so the scatter cannot bury a checkpoint in rock. */
function beaconsOf(map) {
  return Array.isArray(map.beacons) ? map.beacons : [];
}

function placeProps(map, seed) {
  const rng = createRng(seed ^ 0x5bf03635);
  const policy = map.propPolicy;
  const landmark = map.landmarks[0];
  const beacons = beaconsOf(map);
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
      const gate = map.perpendicularity;
      const tooCloseToGate =
        gate &&
        Math.hypot(x - gate.position.x, z - gate.position.z) <
          (policy.perpendicularityClearance ?? gate.radius + 6);
      if (tooCloseToGate) continue;
      // A beacon you cannot stand at because a rock is on it is not a beacon.
      const tooCloseToBeacon = beacons.some(
        (beacon) => Math.hypot(x - (beacon.position?.x ?? 0), z - (beacon.position?.z ?? 0)) < (beacon.clearance ?? 7),
      );
      if (tooCloseToBeacon) continue;
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
 * Collision shapes derived from the entities: upright cylinders.
 *
 * Derived, never authored twice — the renderer builds its meshes from the same
 * entities, so a rock can never be visible in one place and solid in another.
 */
export function buildObstacles(entities) {
  const obstacles = [];
  for (const entity of entities) {
    if (entity.kind === 'rock') {
      obstacles.push({
        id: entity.id,
        x: entity.position.x,
        z: entity.position.z,
        radius: Math.max(entity.scale.x, entity.scale.z) * 0.85,
        // Rocks are sunk a quarter of their height, so their top sits here.
        topY: entity.position.y + entity.scale.y * 0.72,
      });
    } else if (entity.kind === 'landmark') {
      obstacles.push({
        id: entity.id,
        x: entity.position.x,
        z: entity.position.z,
        radius: entity.baseRadius * 1.45,
        topY: entity.position.y + entity.height * 0.07,
      });
    }
  }
  return obstacles;
}

/**
 * Build a map's state from its seed. Called on load and on every seed change;
 * never mutated by rendering.
 */
export function createWorldState({ map, seed, settings = null, environment = { seed: 0, time: 0 } }) {
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
  entities.push(...placeNpcs(map, normalized));

  const obstacles = buildObstacles(entities);
  // The opening pack is sized by the owner's *own* ceiling, so `?enemies=0` at
  // boot really is an empty world. The settings object is passed in rather than
  // read from a global because the sim never reaches for one.
  const context = { map, seed: normalized, obstacles, settings: settings ?? { maxEnemies: 4 } };

  const state = {
    mapId: map.id,
    seed: normalized,
    realm: REALMS.physical,
    tick: 0,
    simTime: 0,
    environment: { ...environment },
    entities,
    obstacles,
    player: createPlayer({ map, seed: normalized, look: { yaw: 0, pitch: -0.04 } }),
    /**
     * Living actors. Kept out of `entities` on purpose: that list is the map's
     * authored furniture and its hash is the map's reproducibility fingerprint,
     * while these come and go as you play. The player has never been an entity
     * for exactly the same reason.
     */
    enemies: [],
    /** Hearts, the beacon, and the combat event log (WP-3.1). */
    combat: createCombat({ map, seed: normalized, hearts: map.hearts ?? 4 }),
    /** The combat log: the fairness contract's evidence channel. */
    events: [],
    /** The roaming spawn director's own state (WP-3.2). */
    spawner: createSpawner(normalized),
  };
  // The world is inhabited from the first frame: the director tops the
  // population up as you explore, but nobody lands in an empty world.
  placeInitialEnemies(state, context);
  return state;
}

/**
 * Shift realms (M2). This is the game's core verb and it is deliberately
 * *not* a simulation step: the realm changes what the world is drawn as, never
 * what it is (AGENT_PROMPT.md §2 — "if you ever find yourself maintaining two
 * versions of the world, stop"). The sim never reads `state.realm`, so a
 * switch cannot alter positions, tick or the entity list, and a replay stays
 * reproducible whatever the player does with the lens.
 */
export function setRealm(state, realm) {
  state.realm = realm === REALMS.cognitive ? REALMS.cognitive : REALMS.physical;
  return state.realm;
}

/** The one-key form of the same thing: physical <-> cognitive. */
export function toggleRealm(state) {
  return setRealm(state, state.realm === REALMS.cognitive ? REALMS.physical : REALMS.cognitive);
}

/**
 * Advance the simulation one *fixed* step. Same input => same state, which is
 * what makes seeded runs reproducible.
 */
/**
 * Advance the simulation one *fixed* step. Same input => same state, which is
 * what makes seeded runs reproducible.
 *
 * Order inside a step is part of the contract: the player moves first, so an
 * enemy's strike is resolved against where you actually are this tick; then
 * your own swing; then the enemies; then the director, which only ever adds or
 * removes at the end. `context` is optional because a unit test may want to
 * advance the clock with nothing in the world to react to it.
 */
export function stepWorld(state, dt, intent = null, context = null) {
  state.tick += 1;
  state.simTime += dt;
  if (intent && context) {
    // A dead player is a body, not an input reader: the frame loop owns the
    // respawn beat (see respawnPlayer), and nothing may walk around meanwhile.
    if (!state.combat?.dead) stepPlayer(state.player, intent, context, dt);
    stepAttack(
      state.player,
      dt,
      Boolean(intent.attack) && !state.combat?.dead,
      state.enemies,
      state,
      context.settings,
    );
    stepCombat(state, context, dt);
    stepEnemies(state, context, dt);
    stepSpawner(state, context, dt);
  }
  return state;
}

/**
 * The death beat, for the frame loop to call while the screen is black.
 *
 * Deliberately *not* inside `stepWorld`: a respawn is covered by a fade, and a
 * fade holds the sim still, so a sim-driven timer would never reach zero. The
 * gate's realm shift works the same way, for the same reason.
 */
export function respawn(state, context) {
  return respawnPlayer(state, context);
}

/** How many enemies the world will hold at once, for the HUD and the reports. */
export function enemyCap(state, context) {
  return activeCap(state, context);
}

/** Exposed so a test can build an attack without importing combat.js directly. */
export { createAttack };

/** The scale-fence canary (AGENT_PROMPT.md §8). */
export function scaleFenceStatus(state) {
  const distance = distanceFromOrigin(state.player.position);
  const maxEntityDistance = state.entities.reduce(
    (acc, e) => Math.max(acc, Math.hypot(e.position.x, e.position.z)),
    0,
  );
  // Roaming enemies are world contents too: an actor that wandered out past the
  // fence is exactly the drift the canary exists to catch.
  const maxEnemyDistance = (state.enemies ?? []).reduce(
    (acc, e) => Math.max(acc, Math.hypot(e.position.x, e.position.z)),
    0,
  );
  const worst = Math.max(distance, maxEntityDistance, maxEnemyDistance);
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

/** Live actors. Reported separately from `entityCount` because they are not furniture. */
export function countEnemies(state) {
  return state.enemies?.length ?? 0;
}

export function findEntity(state, id) {
  return state.entities.find((e) => e.id === id) ?? null;
}

/** Any live actor by id, for the tests and the overlay. */
export function findEnemy(state, id) {
  return state.enemies?.find((e) => e.id === id) ?? null;
}
