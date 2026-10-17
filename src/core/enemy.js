/**
 * Enemies (ROADMAP WP-3.2): one shared state machine, box-part archetypes, and
 * the procedural roaming spawn director.
 *
 * Three rules shape this file, all of them from the brief rather than taste:
 *
 *  1. **One state machine, shared by every archetype.** `idle → alert → hunt →
 *     attack → disengage`. An archetype is *data* that plugs into it — speeds,
 *     ranges, wind-up — never its own behaviour. WP-3.3 adds archetypes by
 *     adding rows to `ENEMY_TYPES`, not by writing a second machine.
 *  2. **Everything is deterministic.** No `Math.random`, no wall clock: the
 *     spawn director advances one uint32 of RNG state held in world state, so a
 *     seed plus an input sequence rebuilds the same encounter exactly.
 *  3. **Escape always works.** Every enemy has an aggro range and a leash from
 *     its home, and `disengage` walks it home ignoring the player. There is no
 *     state in which an enemy keeps chasing indefinitely.
 *
 * Enemies are *living actors*, like the player, so they live in `state.enemies`
 * and not in `state.entities`. `state.entities` is the map's authored furniture
 * — static, seeded once, and its hash is the map's reproducibility fingerprint.
 * An actor that comes and go is a different kind of thing; the player has
 * always been kept out of the entity list for exactly this reason.
 */

import { clamp } from './math.js';
import { normalizeSeed, rngStep } from './rng.js';
import { terrainHeight } from './terrain.js';
import { EVENTS, FAIRNESS, damagePlayer, emitEvent } from './combat.js';

export { FAIRNESS };

/** The one machine. Every archetype runs this and nothing else. */
export const ENEMY_STATES = Object.freeze({
  /** wandering a procedural route around its home, ignoring the player */
  idle: 'idle',
  /** it has seen you: turns to face, holds, then commits */
  alert: 'alert',
  /** closing the distance */
  hunt: 'hunt',
  /** wound up and about to land it — the telegraph is this state */
  attack: 'attack',
  /** walking home, ignoring the player; entered on leash, or when you run */
  disengage: 'disengage',
  /** finished off: sinks and is removed */
  dying: 'dying',
});

/**
 * Archetype data.
 *
 * `fightable: false` is the anglerfish rule — "at least one enemy per world
 * cannot be fought at all, only avoided." A punch against the warden recoils
 * and does nothing else; there is no health bar on it and no way to remove it
 * except to leave.
 *
 * The names and silhouettes here are **project interpretation**, not canon:
 * Roshar's real creatures are WP-3.3, which the owner designs. These two exist
 * so the framework has something honest to run on and so the fairness contract
 * has a testable subject. Flagged in DECISIONS.md.
 */
export const ENEMY_TYPES = Object.freeze({
  'crag-lurker': {
    id: 'crag-lurker',
    name: 'Crag lurker',
    /** a thing you can fight: two punches */
    fightable: true,
    health: 2,
    /** metres — body radius, used for reach, avoidance and spawning */
    radius: 0.55,
    /** metres — how tall the rig is; the nameplate and flames read this */
    height: 1.05,
    /** box parts: four stubby legs, a hunched body, a low head */
    legs: 4,
    arms: 0,
    /** m/s */
    roamSpeed: 1.5,
    huntSpeed: 3.5,
    /** metres — close enough to swing */
    attackRange: 2.3,
    /** multiplier on the owner's wind-up slider (a slow, readable tell) */
    windupScale: 1,
    /** seconds between swings once it is on you */
    attackCooldown: 1.7,
    /** seconds it holds, facing you, before it commits */
    alertTime: 0.45,
    /** metres — how far from home it wanders on its own */
    roamRadius: 13,
    /** how hard its strike is, in hearts */
    damage: 1,
    colors: {
      body: '#4f5f4a',
      limb: '#39463a',
      head: '#6f8263',
      eye: '#f4e7b0',
      /** the tell: what the wind-up turns it into */
      tell: '#ffb03a',
    },
  },
  'storm-warden': {
    id: 'storm-warden',
    name: 'Storm warden',
    /** cannot be fought at all — only avoided */
    fightable: false,
    health: 0,
    radius: 0.5,
    height: 2.1,
    legs: 2,
    arms: 2,
    roamSpeed: 0.95,
    /** slower than the player's 7.9 m/s walk, so running away always works */
    huntSpeed: 2.6,
    attackRange: 2.7,
    /** a longer, unmistakable wind-up: you are meant to see this one coming */
    windupScale: 1.6,
    attackCooldown: 2.6,
    alertTime: 0.8,
    roamRadius: 18,
    damage: 1,
    colors: {
      body: '#8ba3b6',
      limb: '#5b7183',
      head: '#cfe3f2',
      eye: '#ffffff',
      tell: '#7fe3ff',
    },
  },
});

export function listEnemyTypeIds() {
  return Object.keys(ENEMY_TYPES);
}

// --- construction -----------------------------------------------------------

/**
 * Build one enemy at a position.
 *
 * The entity is plain JSON-serialisable data — no closures, no three.js — so
 * world state stays describable, testable and comparable.
 */
export function createEnemy({ typeId, id, x, z, map, seed, windup, homeSeed = 0 }) {
  const type = ENEMY_TYPES[typeId];
  if (!type) throw new Error(`unknown enemy type: ${typeId}`);
  const homeX = Number.isFinite(x) ? x : 0;
  const homeZ = Number.isFinite(z) ? z : 0;
  return {
    id,
    kind: 'enemy',
    typeId: type.id,
    name: type.name,
    fightable: type.fightable,
    health: type.health,
    maxHealth: type.health,
    radius: type.radius,
    height: type.height,
    state: ENEMY_STATES.idle,
    /** seconds left in the current state's beat */
    timer: 0,
    /** seconds until it may swing again */
    cooldown: 0,
    /** the wind-up it is actually using, already floored by the contract */
    windup: resolveWindup(type, windup),
    /** where it belongs; the leash is measured from here */
    home: { x: homeX, z: homeZ },
    position: { x: homeX, y: terrainHeight(map, seed, homeX, homeZ), z: homeZ },
    velocity: { x: 0, y: 0, z: 0 },
    /** knockback impulse, decayed each step */
    knockback: { x: 0, z: 0 },
    yaw: 0,
    /** procedural wander target and the clock that picks the next one */
    roamTarget: { x: homeX, z: homeZ },
    roamTimer: 1 + (homeSeed % 7) * 0.35,
    /** seconds of hit-flash and recoil left; the rig animates off these */
    hitFlash: 0,
    recoil: 0,
    /** walk-cycle phase, so legs swing on the sim clock */
    stridePhase: (homeSeed % 13) * 0.4,
    /** 0..1, the wind-up's own progress — the tell's driver */
    tell: 0,
    /** death animation */
    dying: false,
    dead: false,
    deathTimer: 0,
    /** set by the director when it is time to take the entity out */
    remove: false,
    /** how long it has known about the player, for the fairness log */
    awareFor: 0,
  };
}

/**
 * The wind-up an archetype actually uses.
 *
 * The floor is the fairness contract's ≥0.4 s and it is applied *after* the
 * owner's slider and the archetype's own scale, so no combination of the two can
 * produce an unfair game. That is deliberate: the slider tunes feel, and this
 * line is what stops feel from becoming unfairness.
 */
export function resolveWindup(type, setting) {
  const wanted = Number.isFinite(setting) ? setting : 0.55;
  const scale = Number.isFinite(type?.windupScale) ? type.windupScale : 1;
  return Math.max(FAIRNESS.minWindup, clamp(wanted * scale, FAIRNESS.minWindup, 4));
}

// --- the machine ------------------------------------------------------------

function aggroRange(settings) {
  return Math.max(3, Number.isFinite(settings?.enemyAggro) ? settings.enemyAggro : 16);
}

function speedScale(settings) {
  const value = Number.isFinite(settings?.enemySpeed) ? settings.enemySpeed : 1;
  return clamp(value, 0.2, 3);
}

/**
 * Advance every enemy one fixed step, then take out the ones that are finished.
 *
 * Called from `stepWorld`, so it is inside the deterministic sim: same seed,
 * same inputs, same encounter.
 */
export function stepEnemies(state, context, dt) {
  const enemies = state.enemies;
  if (!Array.isArray(enemies) || !context?.map || !state.player) return state;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    stepEnemy(enemy, state, context, dt);
    if (enemy.remove) enemies.splice(i, 1);
  }
  return state;
}

function stepEnemy(enemy, state, context, dt) {
  const type = ENEMY_TYPES[enemy.typeId];
  if (!type) {
    enemy.remove = true;
    return;
  }
  const player = state.player;
  const settings = context.settings ?? {};
  const toPlayerX = player.position.x - enemy.position.x;
  const toPlayerZ = player.position.z - enemy.position.z;
  const distance = Math.hypot(toPlayerX, toPlayerZ);
  const homeDistance = Math.hypot(enemy.position.x - enemy.home.x, enemy.position.z - enemy.home.z);
  const leash = Number.isFinite(context.map.enemyPolicy?.leashRange)
    ? context.map.enemyPolicy.leashRange
    : 48;
  const aggro = aggroRange(settings);
  const speed = speedScale(settings);

  // Timers that run in every state.
  enemy.cooldown = Math.max(0, enemy.cooldown - dt);
  enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
  enemy.recoil = Math.max(0, enemy.recoil - dt * 2.4);

  // --- dying: sink, then go ----------------------------------------------
  if (enemy.dying || enemy.state === ENEMY_STATES.dying) {
    enemy.dying = true;
    enemy.state = ENEMY_STATES.dying;
    enemy.deathTimer -= dt;
    enemy.tell = Math.max(0, enemy.tell - dt * 2);
    applyKnockback(enemy, dt);
    if (enemy.deathTimer <= 0) enemy.remove = true;
    return;
  }

  // You cannot be hunted while you are dead: everyone loses interest at once.
  if (state.combat?.dead) {
    if (enemy.state !== ENEMY_STATES.disengage) {
      enemy.state = ENEMY_STATES.disengage;
      enemy.tell = 0;
    }
  }

  switch (enemy.state) {
    case ENEMY_STATES.idle: {
      enemy.tell = Math.max(0, enemy.tell - dt * 3);
      enemy.awareFor = 0;
      enemy.roamTimer -= dt;
      if (enemy.roamTimer <= 0) {
        pickRoamTarget(enemy, state, type);
      }
      const walk = walkToward(enemy, enemy.roamTarget, type.roamSpeed * speed, context, dt);
      enemy.stridePhase += dt * walk * 3.4;
      faceToward(enemy, enemy.roamTarget.x, enemy.roamTarget.z, dt);
      // It only notices you inside its own range. `alert` is the approach cue:
      // an enemy that can hurt you has always announced itself first.
      if (!state.combat?.dead && distance <= aggro) {
        enemy.state = ENEMY_STATES.alert;
        enemy.timer = type.alertTime;
        emitEvent(state, { kind: EVENTS.alert, by: enemy.id, type: enemy.typeId, distance: round2(distance) });
      }
      break;
    }

    case ENEMY_STATES.alert: {
      enemy.awareFor += dt;
      // Turning to face you and holding is the whole of this state: no damage,
      // no closing. It exists so a swing is never the first thing that happens.
      faceToward(enemy, player.position.x, player.position.z, dt * 2.2);
      enemy.tell = Math.min(0.35, enemy.tell + dt * 0.6);
      enemy.timer -= dt;
      if (distance > aggro * 1.5) {
        toDisengage(enemy, state);
        break;
      }
      if (enemy.timer <= 0) {
        enemy.state = ENEMY_STATES.hunt;
        enemy.timer = 0;
      }
      break;
    }

    case ENEMY_STATES.hunt: {
      enemy.awareFor += dt;
      const walk = walkToward(enemy, player.position, type.huntSpeed * speed, context, dt);
      enemy.stridePhase += dt * walk * 4.2;
      faceToward(enemy, player.position.x, player.position.z, dt * 3);
      enemy.tell = Math.max(0, enemy.tell - dt * 2);
      // Leash: far enough from home and it goes back, whatever you do. This is
      // the rule that makes escape always work.
      if (homeDistance > leash || distance > aggro * 1.9 || state.combat?.dead) {
        toDisengage(enemy, state);
        break;
      }
      if (distance <= type.attackRange && enemy.cooldown <= 0) {
        // Recomputed at the moment of commitment, so the wind-up slider is live:
        // dragging it changes the next tell, and the contract's floor is applied
        // every time rather than only at spawn.
        enemy.windup = resolveWindup(type, settings.enemyWindup);
        enemy.state = ENEMY_STATES.attack;
        enemy.timer = enemy.windup;
        // THE telegraph. Everything that can hurt you is announced here, at
        // least `FAIRNESS.minWindup` seconds before it lands.
        emitEvent(state, {
          kind: EVENTS.telegraph,
          by: enemy.id,
          type: enemy.typeId,
          windup: round2(enemy.windup),
          distance: round2(distance),
          awareFor: round2(enemy.awareFor),
        });
      }
      break;
    }

    case ENEMY_STATES.attack: {
      enemy.awareFor += dt;
      enemy.timer -= dt;
      // The tell is the wind-up's own progress: 0 when it starts, 1 at the
      // moment of the strike. The rig reads it and leans back, then throws
      // itself forward — the one cue per archetype the roadmap asks for.
      enemy.tell = clamp(1 - enemy.timer / Math.max(0.001, enemy.windup), 0, 1);
      // It commits: it does not track you around corners during the wind-up,
      // which is what makes stepping sideways a real answer.
      if (enemy.timer <= 0) {
        const strikeRange = type.attackRange * 1.2;
        if (distance <= strikeRange && !state.combat?.dead) {
          damagePlayer(state, {
            amount: strikeDamage(type, settings),
            by: enemy.id,
            from: { x: enemy.position.x, z: enemy.position.z },
          });
        }
        enemy.cooldown = type.attackCooldown;
        enemy.state = ENEMY_STATES.hunt;
        enemy.timer = 0;
        enemy.recoil = 0.6;
      }
      break;
    }

    case ENEMY_STATES.disengage: {
      enemy.tell = Math.max(0, enemy.tell - dt * 3);
      enemy.awareFor = 0;
      const walk = walkToward(enemy, enemy.home, type.roamSpeed * speed * 1.25, context, dt);
      enemy.stridePhase += dt * walk * 3.4;
      faceToward(enemy, enemy.home.x, enemy.home.z, dt * 2);
      if (homeDistance < 2) {
        enemy.state = ENEMY_STATES.idle;
        enemy.roamTimer = 0.4;
        pickRoamTarget(enemy, state, type);
      }
      break;
    }

    default:
      enemy.state = ENEMY_STATES.idle;
  }

  applyKnockback(enemy, dt);
}

function toDisengage(enemy, state) {
  if (enemy.state === ENEMY_STATES.disengage) return;
  enemy.state = ENEMY_STATES.disengage;
  enemy.tell = 0;
  emitEvent(state, { kind: EVENTS.disengage, by: enemy.id, type: enemy.typeId });
}

/**
 * What a strike costs, in hearts.
 *
 * The archetype owns the base and the owner owns the multiplier, so WP-3.3 can
 * give two archetypes different threats without either of them being able to
 * ignore the tuning panel.
 */
export function strikeDamage(type, settings) {
  const base = Number.isFinite(type?.damage) ? type.damage : 1;
  const scale = Number.isFinite(settings?.enemyDamage) ? settings.enemyDamage : 1;
  return clamp(Math.round(base * scale), 1, 5);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Pick the next procedural wander waypoint, inside the enemy's own radius. */
function pickRoamTarget(enemy, state, type) {
  const draw = () => {
    const stepped = rngStep(state.spawner.rng);
    state.spawner.rng = stepped.state;
    return stepped.value;
  };
  const angle = draw() * Math.PI * 2;
  const radius = type.roamRadius * (0.25 + draw() * 0.75);
  enemy.roamTarget.x = enemy.home.x + Math.cos(angle) * radius;
  enemy.roamTarget.z = enemy.home.z + Math.sin(angle) * radius;
  enemy.roamTimer = 2.5 + draw() * 4;
}

/** Move one step toward a point, sliding around obstacles. Returns speed. */
function walkToward(enemy, target, speed, context, dt) {
  const dx = target.x - enemy.position.x;
  const dz = target.z - enemy.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.12 || speed <= 0) return 0;
  const step = Math.min(distance, speed * dt);
  const nx = enemy.position.x + (dx / distance) * step;
  const nz = enemy.position.z + (dz / distance) * step;
  const limit = context.map.ground.size / 2 - 2;
  if (!isBlocked(nx, nz, enemy, context)) {
    enemy.position.x = nx;
    enemy.position.z = nz;
  } else if (!isBlocked(nx, enemy.position.z, enemy, context)) {
    enemy.position.x = nx;
  } else if (!isBlocked(enemy.position.x, nz, enemy, context)) {
    enemy.position.z = nz;
  }
  enemy.position.x = clamp(enemy.position.x, -limit, limit);
  enemy.position.z = clamp(enemy.position.z, -limit, limit);
  enemy.position.y = terrainHeight(context.map, context.seed, enemy.position.x, enemy.position.z);
  return step / Math.max(1e-6, dt);
}

/** An enemy may stand on a rock; it may not walk through one. */
function isBlocked(x, z, enemy, context) {
  const obstacles = context.obstacles;
  if (!obstacles) return false;
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i];
    const distance = Math.hypot(x - obstacle.x, z - obstacle.z);
    if (distance > obstacle.radius + enemy.radius) continue;
    if (distance < obstacle.radius && enemy.position.y >= obstacle.topY - 0.06) continue;
    return true;
  }
  return false;
}

/** Turn toward a point, a little at a time — a snap reads as a turret. */
function faceToward(enemy, x, z, rate) {
  const dx = x - enemy.position.x;
  const dz = z - enemy.position.z;
  if (Math.hypot(dx, dz) < 0.001) return;
  // The player's own convention: yaw 0 looks down -Z.
  const wanted = Math.atan2(-dx, -dz);
  let delta = wanted - enemy.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxTurn = Math.min(Math.abs(delta), Math.max(0, rate) * 4);
  enemy.yaw += Math.sign(delta) * maxTurn;
}

function applyKnockback(enemy, dt) {
  if (enemy.knockback.x === 0 && enemy.knockback.z === 0) return;
  enemy.position.x += enemy.knockback.x * dt;
  enemy.position.z += enemy.knockback.z * dt;
  const decay = Math.max(0, 1 - dt * 7);
  enemy.knockback.x *= decay;
  enemy.knockback.z *= decay;
  if (Math.abs(enemy.knockback.x) < 0.05) enemy.knockback.x = 0;
  if (Math.abs(enemy.knockback.z) < 0.05) enemy.knockback.z = 0;
}

// --- the procedural roaming spawn director ----------------------------------

/**
 * The director's own state.
 *
 * One uint32 of RNG plus three counters. That is all it needs, and keeping it
 * this small is what makes the whole encounter layer replayable from a seed.
 */
export function createSpawner(seed) {
  return { rng: normalizeSeed(seed ^ 0x5eed1a), count: 0, timer: 0, spawned: 0, culled: 0 };
}

/** Draw one [0,1) value from the director's stream and advance it. */
function draw(state) {
  const stepped = rngStep(state.spawner.rng);
  state.spawner.rng = stepped.state;
  return stepped.value;
}

function nextId(state) {
  state.spawner.count += 1;
  return `enemy-${String(state.spawner.count).padStart(3, '0')}`;
}

/**
 * Put the map's opening enemies in the world.
 *
 * Placed at creation rather than on a timer so a player who loads the game sees
 * the world is inhabited straight away, and so a headless test can assert on
 * enemies without first simulating eight seconds of nothing.
 */
export function placeInitialEnemies(state, context) {
  const policy = context.map.enemyPolicy;
  if (!policy || !state.spawner) return state;
  const cap = activeCap(state, context);
  const wanted = Math.min(cap, Math.max(0, policy.initial ?? 0));
  const origin = state.player.position;
  for (let i = 0; i < wanted; i++) {
    const spot = findSpawnPoint(state, context, origin.x, origin.z);
    if (!spot) break;
    spawnEnemy(state, context, spot, chooseType(state, context));
  }
  return state;
}

/** How many enemies may be alive at once: owner's slider, map policy, hard cap. */
export function activeCap(state, context) {
  const settings = context.settings ?? {};
  const fromSettings = Number.isFinite(settings.maxEnemies) ? settings.maxEnemies : 4;
  const fromPolicy = Number.isFinite(context.map.enemyPolicy?.maxActive)
    ? context.map.enemyPolicy.maxActive
    : FAIRNESS.maxActive;
  return clamp(Math.min(Math.round(fromSettings), Math.round(fromPolicy), FAIRNESS.maxActive), 0, FAIRNESS.maxActive);
}

/** Pick an archetype, weighted, from the map's own list. */
function chooseType(state, context) {
  const policy = context.map.enemyPolicy;
  const types = Array.isArray(policy.types) ? policy.types : [];
  const valid = types.filter((id) => ENEMY_TYPES[id]);
  if (valid.length === 0) return null;
  const weights = valid.map((id, i) => Math.max(0.01, policy.weights?.[i] ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = draw(state) * total;
  for (let i = 0; i < valid.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return valid[i];
  }
  return valid[valid.length - 1];
}

/**
 * Where the next enemy appears.
 *
 * A ring around the player, outside their immediate space and outside the fog
 * wall — close enough that it is a threat you can see coming, far enough that
 * nothing ever materialises on top of you. Rejected if it is in the
 * Perpendicularity, inside a rock, or standing on an NPC.
 */
export function findSpawnPoint(state, context, fromX, fromZ) {
  const policy = context.map.enemyPolicy ?? {};
  const min = Number.isFinite(policy.spawnMin) ? policy.spawnMin : 24;
  const max = Number.isFinite(policy.spawnMax) ? Math.max(min + 1, policy.spawnMax) : 40;
  const limit = context.map.ground.size / 2 - 6;
  const gate = context.map.perpendicularity ?? null;
  for (let attempt = 0; attempt < 14; attempt++) {
    const angle = draw(state) * Math.PI * 2;
    const radius = min + draw(state) * (max - min);
    const x = fromX + Math.cos(angle) * radius;
    const z = fromZ + Math.sin(angle) * radius;
    if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
    if (gate && Math.hypot(x - gate.position.x, z - gate.position.z) < gate.radius + 4) continue;
    if (Math.hypot(x - fromX, z - fromZ) < min * 0.85) continue;
    const probe = { position: { x, z }, radius: 1.2, y: 0 };
    if (isBlocked(x, z, probe, context)) continue;
    if (nearNpc(state, x, z, 5)) continue;
    return { x, z };
  }
  return null;
}

function nearNpc(state, x, z, clearance) {
  for (const entity of state.entities ?? []) {
    if (entity.kind !== 'npc') continue;
    if (Math.hypot(entity.position.x - x, entity.position.z - z) < clearance) return true;
  }
  return false;
}

function spawnEnemy(state, context, spot, typeId) {
  if (!typeId) return null;
  const enemy = createEnemy({
    typeId,
    id: nextId(state),
    x: spot.x,
    z: spot.z,
    map: context.map,
    seed: context.seed,
    windup: context.settings?.enemyWindup,
    homeSeed: state.spawner.count,
  });
  // A fresh wind-up is whatever the slider says *now*, floored by the contract.
  enemy.windup = resolveWindup(ENEMY_TYPES[typeId], context.settings?.enemyWindup);
  state.enemies.push(enemy);
  state.spawner.spawned += 1;
  emitEvent(state, {
    kind: EVENTS.spawn,
    by: enemy.id,
    type: typeId,
    x: round2(spot.x),
    z: round2(spot.z),
  });
  return enemy;
}

/**
 * Keep the world populated and empty the places the player has left behind.
 *
 * "Procedural roaming" is these two halves: where an enemy *appears* is drawn
 * from the seed, and what it does until it notices you is a procedural wander
 * around its own home (`pickRoamTarget`). Neither is scripted, and both are
 * reproducible.
 */
export function stepSpawner(state, context, dt) {
  const policy = context?.map?.enemyPolicy;
  if (!policy || !state.spawner) return state;

  // Cull the ones left far behind: a world that keeps every enemy it ever made
  // would grow without bound on a long walk, and an enemy 400 m away is not an
  // encounter, it is bookkeeping.
  const despawn = Number.isFinite(policy.despawnRadius) ? policy.despawnRadius : 95;
  const player = state.player;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    if (Math.hypot(enemy.position.x - player.position.x, enemy.position.z - player.position.z) > despawn) {
      state.enemies.splice(i, 1);
      state.spawner.culled += 1;
    }
  }

  const cap = activeCap(state, context);
  const interval = Math.max(1, Number.isFinite(policy.spawnInterval) ? policy.spawnInterval : 8);
  state.spawner.timer += dt;
  // A `while`, not an `if`: a long frame (or a debug step of several seconds)
  // still gets the spawns it was owed, so time cannot be cheated.
  while (state.spawner.timer >= interval) {
    state.spawner.timer -= interval;
    if (state.enemies.length >= cap) continue;
    const spot = findSpawnPoint(state, context, player.position.x, player.position.z);
    if (!spot) continue;
    spawnEnemy(state, context, spot, chooseType(state, context));
  }
  return state;
}

// --- queries the rest of the game needs -------------------------------------

/** The closest live enemy to the player, for the HUD and the tests. */
export function nearestEnemy(state) {
  const player = state.player;
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of state.enemies ?? []) {
    if (enemy.dying) continue;
    const distance = Math.hypot(enemy.position.x - player.position.x, enemy.position.z - player.position.z);
    if (distance < bestDistance) {
      best = enemy;
      bestDistance = distance;
    }
  }
  return best ? { enemy: best, distance: bestDistance } : null;
}

/** How many enemies are in each state — the overlay's one-line AI summary. */
export function enemyStateCounts(state) {
  const counts = {};
  for (const key of Object.values(ENEMY_STATES)) counts[key] = 0;
  for (const enemy of state.enemies ?? []) {
    counts[enemy.state] = (counts[enemy.state] ?? 0) + 1;
  }
  return counts;
}
