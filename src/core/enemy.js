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
import { PLAYER } from './config.js';
import { normalizeSeed, rngStep } from './rng.js';
import { terrainHeight } from './terrain.js';
import { EVENTS, FAIRNESS, damagePlayer, emitEvent } from './combat.js';

export { FAIRNESS };

// --- frame geometry: ONE source, read by the rig AND by collision ------------

/**
 * How a chain-shell frame overlaps its neighbours — and how far each section
 * sits behind the one ahead. Part of the frame spec, not the sim: the number
 * only decides how armoured the chain looks and where each hull ring sits.
 */
const CHAIN_STEP = 0.92;
const CHAIN_TAPER_WIDTH = 0.45;
const CHAIN_TAPER_HEIGHT = 0.25;
const CHAIN_TAPER_DEPTH = 0.22;

/**
 * The geometry of an archetype's body, as data.
 *
 * "Derived, never authored twice" (the same rule `buildObstacles` already
 * keeps for rocks): the renderer in `render/enemy-view.js` reads this to place
 * its boxes, and `collectEnemyObstacles` reads it to place the hull rings a
 * player cannot walk through. Two half-measures would drift apart and the
 * world would get walkable walls or invisible walls — the owner asked for the
 * Chasmfiend's collision to cover its whole body BECAUSE the head-only hull
 * had drifted one size too small (2026-10-18, "collision covers its whole
 * body... otherwise this is a pass").
 *
 * @returns either a per-segment spec for a chain `frame` or a one-ring hull
 *   centred on the creature's position for anything else.
 */
export function enemyFrameSpec(type) {
  const dims = type?.dims ?? {};
  if (Number.isInteger(dims.segments) && dims.segments > 0) {
    const count = dims.segments;
    const legHeight = dims.legHeight ?? type.height * 0.42;
    const legWidth = dims.legWidth ?? 0.5;
    const last = Math.max(1, count - 1);
    return {
      segmented: true,
      segments: Array.from({ length: count }, (_, j) => {
        const t = j / last;
        const width = dims.width * (1 - t * CHAIN_TAPER_WIDTH);
        const height = dims.height * (1 - t * CHAIN_TAPER_HEIGHT);
        const depth = dims.depth * (1 - t * CHAIN_TAPER_DEPTH);
        return {
          /** metres behind the creature's position along its local +Z (trailing). */
          along: j * dims.depth * CHAIN_STEP,
          width,
          height,
          depth,
          /** Hull ring: the body half-width plus a leg pad, tapering with the shell. */
          colliderRadius: width / 2 + legWidth * 0.5 + 0.05,
          /** Hull height above the ground under that ring. */
          colliderTop: legHeight + height,
        };
      }),
    };
  }
  return {
    segmented: false,
    segments: [
      {
        along: 0,
        width: 0,
        height: 0,
        depth: 0,
        /** A solid, single hull for everything else — whole body, one ring. */
        colliderRadius: type.radius ?? 0.55,
        colliderTop: type.height * 0.75,
      },
    ],
  };
}

/**
 * The player's-collidable footprint of every live enemy, as obstacle rings in
 * world space. Follows the sim's own positions and yaws exactly — a ring per
 * chain section when the frame is segmented, one ring per creature otherwise.
 * Dying enemies drop their hull with the body.
 */
export function collectEnemyObstacles(state, context) {
  const obstacles = [];
  if (!state?.enemies || !context?.map) return obstacles;
  for (const enemy of state.enemies) {
    if (enemy.dying || enemy.dead) continue;
    const type = ENEMY_TYPES[enemy.typeId];
    if (!type) continue;
    const frame = enemyFrameSpec(type);
    const sin = Math.sin(enemy.yaw ?? 0);
    const cos = Math.cos(enemy.yaw ?? 0);
    for (let j = 0; j < frame.segments.length; j++) {
      const seg = frame.segments[j];
      // Local +Z rotated by yaw is (sin, cos): the trail direction, matching
      // exactly how the rig lays its chain behind the creature's facing.
      obstacles.push({
        id: `${enemy.id}-hull-${String(j).padStart(2, '0')}`,
        x: enemy.position.x + sin * seg.along,
        z: enemy.position.z + cos * seg.along,
        radius: seg.colliderRadius,
        topY: enemy.position.y + seg.colliderTop,
      });
    }
  }
  return obstacles;
}

/** How far an enemy's hull extends from its anchor, for spawn clearance. */
export function footprintExtent(type) {
  return enemyFrameSpec(type).segments.reduce((m, seg) => Math.max(m, seg.along + seg.colliderRadius), 0);
}

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
    name: 'Whitespine',
    /** Stable map-policy id; species, look, and gameplay are our interpretation. */
    fightable: true,
    /** The owner (2026-10-18): "like 10 punches worth" — a real fight, not a two-tap. */
    health: 10,
    /** metres — body radius, used for reach, avoidance and spawning */
    radius: 0.58,
    /**
     * metres — how tall the rig is.
     *
     * The owner (2026-10-17): "Whitespines are quadrupeds with white spines;
     * their backs are about as high as the player's head." The rig puts the
     * back at `height - headSize*0.85`, so 2.1 m lands the back at ~1.68 m
     * against the player's 1.70 m eye line — exactly the measure given.
     */
    height: 2.1,
    legs: 4,
    arms: 0,
    /** m/s */
    roamSpeed: 1.5,
    huntSpeed: 3.5,
    /** metres — close enough to swing */
    attackRange: 2.25,
    /**
     * A snappier tell than the others'. Never below the fairness floor:
     * `resolveWindup()` applies FAIRNESS.minWindup AFTER this scale and the
     * owner's slider, so the contract holds no matter what gets tuned.
     */
    windupScale: 0.8,
    /** seconds between swings once it is on you — the owner asked for a faster cadence */
    attackCooldown: 1.1,
    /** seconds it holds, facing you, before it commits — quicker to commit (owner, 2026-10-18) */
    alertTime: 0.3,
    /** metres — how far from home it wanders on its own */
    roamRadius: 13,
    /** how hard its strike is, in hearts */
    damage: 1,
    colors: {
      body: '#584840',
      limb: '#403631',
      head: '#e4ded3',
      eye: '#f4e7b0',
      /** the namesake: white plates along the back, so the spine reads from behind */
      spines: '#f7f2e6',
      /** one tell: an amber wind-up ring */
      tell: '#ffb03a',
    },
    /** A slimmer hunter's frame than the default quadruped proportions. */
    dims: { bodyWidth: 0.95, bodyDepth: 1.05 },
    /** AI-baked creature skin (see core/enemy-skins.js); null fields stay flat. */
    texture: { body: 'whitespine-body', head: 'whitespine-head' },
  },

  'storm-warden': {
    id: 'storm-warden',
    name: 'Chasmfiend',
    /** Cannot be fought at all — only avoided; a game rule, not a canon claim. */
    fightable: false,
    health: 0,
    /**
     * metres — the owner's measure (2026-10-17): "Chasmfiends are like a 14 or
     * more legged creature and they are GIANT: they are unbelievably big."
     * Six and a half metres of shell-backed crustacean, four times the
     * player's height — and the spawner makes them rare enough that the size
     * stays an event, not a traffic jam.
     */
    radius: 2.2,
    /**
     * The owner (2026-10-18): "longer, less wide and shorter — a LOT longer.
     * A cross between a centipede and a crab." The giant's mass moved out of
     * height (6.5 m of wall) and into length: a low armoured chain of
     * segments, fourteen legs rippling down both rows, crab pincers at the
     * head that raise before it strikes. Vertical measure only — the length
     * lives in `dims.segments`.
     */
    height: 2.6,
    legs: 14,
    arms: 0,
    roamSpeed: 0.8,
    /** slower than the player's 7.9 m/s walk: it is a landmark you escape, not a duel */
    huntSpeed: 2.6,
    /** long reach for a long body: its strike is felt from a step further out */
    attackRange: 4.2,
    /** an unmistakable, slow tell: you are meant to watch the street hush */
    windupScale: 2.0,
    attackCooldown: 3.4,
    alertTime: 1.2,
    roamRadius: 10,
    damage: 1,
    colors: {
      body: '#6d6a5c',
      limb: '#484b42',
      head: '#a39a7c',
      eye: '#f5e8c4',
      tell: '#78dce8',
    },
    /**
     * The segmented frame: 6 chain sections behind the head, ~11 m of shell —
     * the rig builds `segments` instead of one body box when this is present.
     */
    dims: { segments: 6, width: 2.6, depth: 1.9, height: 1.3, legHeight: 1.1, legWidth: 0.5, headSize: 0.65, pincers: true },
    /**
     * The Inquisitor rule, shipped generically for the one archetype it can
     * never spoil: facing this thing mid-windup breaks its strike off. Where a
     * killable enemy would become spongy (a phone player could deny every
     * attack forever and farm it), the unkillable giant gives the player a
     * real line of defence that is not a weapon: *stand your ground and look
     * at it*. That is also the assertion WP-3.5 was waiting on (issue #21).
     */
    flinchWhenFaced: true,
    texture: { body: 'chasm-fiend-shell', head: 'chasm-fiend-shell', limb: 'chasm-fiend-limb' },
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
export function createEnemy({ typeId, id, x, z, map, seed, windup, homeSeed = 0, home = null, aggroRange = null, rotationY = 0, roamRadius = null, guardFacing = null }) {
  const type = ENEMY_TYPES[typeId];
  if (!type) throw new Error(`unknown enemy type: ${typeId}`);
  const homeX = Number.isFinite(home?.x) ? home.x : Number.isFinite(x) ? x : 0;
  const homeZ = Number.isFinite(home?.z) ? home.z : Number.isFinite(z) ? z : 0;
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
    yaw: Number.isFinite(rotationY) ? rotationY : 0,
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
    /**
     * An authored per-placement aggro override (see enemyPolicy.placements).
     * Null means "read the owner's slider"; a number means this one enemy
     * guards a smaller circle — the pool-side Chasmfiend sleeps until you
     * choose to walk up and see it, which is what keeps the gate's own
     * tests (and a fresh player) from being jumped by the ambience.
     */
    aggroRange,
    /**
     * An authored per-placement wander cap (metres). Null means the archetype's
     * own roam radius. The pool-side Chasmfiend shuffles beside the water
     * instead of taking walkabouts across the gate's walking lane — the hull
     * is real now, and a sleeping guardian that strays onto the lane is a
     * wall where a swim used to be (CI run 39182532718 caught exactly that).
     */
    roamRadius,
    /**
     * The direction this enemy sleeps facing, in radians — or null. While it's
     * not engaged (idle / disengaging) its yaw is pinned here, which for the
     * pool-side Chasmfiend means the ~11 m tail always trails due south, off
     * the gate's walking lane: a tight wander cap alone was not enough, because
     * the giant can swing its own tail across the lane without ever taking a
     * step (CI run 39182532718). While engaged it faces you, as it should,
     * and when you leave its circle it settles back to its post.
     */
    guardFacing,
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
  const aggro = Number.isFinite(enemy.aggroRange) ? enemy.aggroRange : aggroRange(settings);
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
      // The Inquisitor rule, as a per-archetype flag (see ENEMY_TYPES): stand
      // your ground and *look* at it, and the strike breaks off. Only ever
      // enabled where it cannot make a fight spongy — the unkillable ones.
      // Distance guard: at arm's length it is too late to be impressed.
      if (
        type.flinchWhenFaced &&
        !state.combat?.dead &&
        distance > 1.2 &&
        playerFacingDot(state.player, enemy) >= FLINCH_CONE
      ) {
        const cooldown = type.attackCooldown * 0.5;
        enemy.state = ENEMY_STATES.alert;
        enemy.timer = Math.max(0.4, type.alertTime * 0.8);
        enemy.cooldown = cooldown;
        enemy.tell = 0;
        emitEvent(state, { kind: EVENTS.flinch, by: enemy.id, type: enemy.typeId, distance: round2(distance) });
        break;
      }
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

  // A sleeping guardian holds its post-facing, tail pinned off the lane;
  // engagement unlocks facing normally, disengagement settles it home.
  if (Number.isFinite(enemy.guardFacing) && (enemy.state === ENEMY_STATES.idle || enemy.state === ENEMY_STATES.disengage)) {
    enemy.yaw = enemy.guardFacing;
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

/**
 * The arc of "is the player looking at me", as a dot product of the player's
 * look direction against the vector to the enemy. cos(53 deg): generous, so a
 * phone player does not need pixel-perfect aiming to stand their ground.
 */
export const FLINCH_CONE = 0.6;

export function playerFacingDot(player, enemy) {
  const dx = enemy.position.x - player.position.x;
  const dz = enemy.position.z - player.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.0001) return 1;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  return (dx / distance) * fx + (dz / distance) * fz;
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
  // A placement may gift a tighter circle than the archetype's own — the
  // sleeping Chasmfiend shuffles by the water rather than crossing the lane.
  const roamRadius = Number.isFinite(enemy.roamRadius) ? enemy.roamRadius : type.roamRadius;
  const angle = draw() * Math.PI * 2;
  const radius = roamRadius * (0.25 + draw() * 0.75);
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
  if (cap > 0) {
    /**
     * Authored placements first: concrete spots the map wants guaranteed at
     * load (the owner's pool-side Chasmfiend). They are design, not luck, so
     * they are placed deterministically and do not touch the RNG stream — a
     * world with placements replays exactly, and the ring spawns after them
     * are unaffected by how many there were.
     */
    for (const placement of policy.placements ?? []) {
      if (!ENEMY_TYPES[placement.typeId]) continue;
      spawnEnemy(state, context, { x: placement.x, z: placement.z }, placement.typeId, placement);
    }
    // ...then the procedural ring pack, capped as before.
    const wanted = Math.min(cap - state.enemies.length, Math.max(0, policy.initial ?? 0));
    const origin = state.player.position;
    for (let i = 0; i < wanted; i++) {
      const spot = findSpawnPoint(state, context, origin.x, origin.z);
      if (!spot) break;
      spawnEnemy(state, context, spot, chooseType(state, context));
    }
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

/** Pick an archetype, weighted, from the map's own list. Exported so the rarity is testable. */
export function chooseType(state, context) {
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
    // Not on top of another enemy: a giant already standing somewhere is a
    // landmark — and now "standing" means its WHOLE footprint, head to tail,
    // not a circle on its head.
    let onAnother = false;
    for (const other of state.enemies) {
      const otherType = ENEMY_TYPES[other.typeId];
      const extent = otherType ? footprintExtent(otherType) : (other.radius ?? 1) + 3;
      if (Math.hypot(other.position.x - x, other.position.z - z) < extent + 2) {
        onAnother = true;
        break;
      }
    }
    if (onAnother) continue;
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

function spawnEnemy(state, context, spot, typeId, placement = null) {
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
    home: placement?.home ?? null,
    aggroRange: Number.isFinite(placement?.aggroRange) ? placement.aggroRange : null,
    rotationY: Number.isFinite(placement?.rotationY) ? placement.rotationY : 0,
    roamRadius: Number.isFinite(placement?.roamRadius) ? placement.roamRadius : null,
    guardFacing: Number.isFinite(placement?.guardFacing) ? placement.guardFacing : null,
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
/**
 * Keep the player OUT of a hull that moved onto them.
 *
 * Refusal alone is enough for rocks — they never move into the player. A hull
 * ring can slide over a player mid-chase, and then refusal (which only checks
 * NEW positions) traps them inside its volume forever: a perma-trap exactly
 * under the one creature big enough to hide it. So after the machine moves the
 * world, overlap is resolved the only fair way — out to the nearest rim, or
 * along their own velocity if they are dead-centre. Standing ON a body is not
 * pushed: a 2.4 m shell you can stand on is a feature, not a trap.
 */
export function resolveEnemyOverlap(state, context) {
  const player = state?.player;
  if (!player) return state;
  const rings = collectEnemyObstacles(state, context);
  for (const ring of rings) {
    const dx = player.position.x - ring.x;
    const dz = player.position.z - ring.z;
    const distance = Math.hypot(dx, dz);
    const minDistance = ring.radius + PLAYER.radius;
    if (distance >= minDistance) continue;
    if (Number.isFinite(player.position.y) && player.position.y >= ring.topY - 0.06) continue;
    if (distance < 0.0001) {
      const vx = player.velocity.x;
      const vz = player.velocity.z;
      const n = Math.hypot(vx, vz);
      if (n > 0.0001) {
        player.position.x = ring.x + (vx / n) * minDistance;
        player.position.z = ring.z + (vz / n) * minDistance;
      } else {
        player.position.x = ring.x + minDistance;
      }
    } else {
      const push = minDistance - distance;
      player.position.x += (dx / distance) * push;
      player.position.z += (dz / distance) * push;
    }
  }
  return state;
}

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

  // Trim to the cap, farthest first.
  //
  // Spawning under the cap is not enough: the ceiling has to *hold*, and there
  // are two ways to be over it that no spawn check can see. A map can declare a
  // bigger `initial` than the owner's slider allows, and the owner can drag
  // "Enemies alive at once" down mid-session — which has to mean something the
  // next time they look up. Taking the farthest is the least visible choice: the
  // ones you can see stay.
  while (state.enemies.length > cap) {
    let worst = -1;
    let worstDistance = -1;
    for (let i = 0; i < state.enemies.length; i++) {
      const enemy = state.enemies[i];
      const distance = Math.hypot(enemy.position.x - player.position.x, enemy.position.z - player.position.z);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst < 0) break;
    state.enemies.splice(worst, 1);
    state.spawner.culled += 1;
  }

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
