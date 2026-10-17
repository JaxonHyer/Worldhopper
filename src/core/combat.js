/**
 * Combat: hearts, the punch, and the one rule the whole encounter layer is
 * graded on — **a telegraph event precedes every damage event.**
 *
 * Pure simulation, no DOM, no three.js, so the fairness contract is asserted in
 * Node (`tests/unit/combat.test.js`) rather than felt out on a phone. The
 * renderer reads `state.combat` and `player.attack` and draws the result; it
 * never decides a hit.
 *
 * Rules this file enforces, from ROADMAP.md § Encounters and § Health & death:
 *  - Hearts 3–5, tunable. **No damage numbers.**
 *  - Hit → knockback + ~1 s invulnerability + a red vignette. No hit-stun chains.
 *  - Death → fade to black → respawn at the last beacon. **No item loss.**
 *  - Healing happens at beacons.
 *  - Health is a consequence layer, never progression: nothing here awards
 *    anything, levels anything, or drops anything.
 */

import { clamp } from './math.js';
import { terrainHeight } from './terrain.js';

/**
 * The event vocabulary. Every combat fact the game knows is one of these, and
 * the log is the evidence channel: the fairness tests read it, the overlay
 * shows the last few, and the debug snapshot carries it out of the browser.
 */
export const EVENTS = Object.freeze({
  /** An attack has been *wound up*. Nothing has been hurt yet. */
  telegraph: 'telegraph',
  /** Something was hurt. Must be preceded by that source's telegraph. */
  damage: 'damage',
  /** The player swung. */
  punch: 'punch',
  /** A punch connected with something that cannot be hurt. */
  immune: 'immune',
  /** The player ran out of hearts. */
  death: 'death',
  /** An enemy was finished off. A different word, so a log reads unambiguously. */
  defeat: 'defeat',
  /** An enemy noticed the player — the approach cue, before anything is wound up. */
  alert: 'alert',
  /** An enemy gave up and went home. Disengaging always works; this proves it did. */
  disengage: 'disengage',
  /** The spawn director put one in the world. */
  spawn: 'spawn',
  /** The player is back at their beacon. */
  respawn: 'respawn',
  /** A beacon was touched: the respawn point moved and the player healed. */
  beacon: 'beacon',

});

/**
 * How many events the state keeps.
 *
 * Long enough that a telegraph and the damage it covers are never split across
 * the boundary: the pair is about 35 ticks apart and a busy encounter writes
 * perhaps eight events in that span, so 128 holds a dozen pairs with room to
 * spare. The *snapshot* ships only the tail of it — see `combatOf` — so the
 * payload stays small while a unit test can still read a whole run.
 */
export const EVENT_LOG_MAX = 128;

/**
 * Structural combat numbers — the shape of a punch.
 *
 * The *feel* numbers (how hard, how often) are settings; these are the ones
 * that make the swing a swing. Reach and cone are generous on purpose: on a
 * phone the player is aiming with a thumb and a stick, and a punch that needs
 * pixel-accurate facing reads as broken rather than as demanding.
 */
export const ATTACK = Object.freeze({
  /** seconds the arm pulls back — the punch's own telegraph */
  windup: 0.09,
  /** seconds the fist is out and can connect */
  active: 0.11,
  /** seconds of follow-through before the next swing may start */
  recover: 0.16,
  /** metres the fist reaches from the player's centre */
  reach: 2.4,
  /** half-angle of the swing's arc, radians (~49°) */
  halfAngle: 0.85,
  /** m/s imparted to whatever is hit, away from the player */
  knockback: 5.4,
  /** m/s the player is pushed back by an enemy's strike */
  playerKnockback: 6.2,
});

export const COMBAT = Object.freeze({
  /** metres from a beacon's centre that counts as "at the beacon" */
  beaconRadius: 3,
  /** seconds of invulnerability after a respawn, so you cannot be spawn-killed */
  respawnInvuln: 2.2,
  /** seconds the death card holds before the fade covers the respawn */
  respawnHold: 1.1,
  /** seconds of standing at a beacon per heart restored */
  healInterval: 0.6,
});

/**
 * The fairness contract's numbers, in one place, because they are the contract.
 *
 * `minWindup` is a floor the tuning panel cannot go below: a slider the owner
 * can drag to 0.1 s would let them build an unfair game by accident, and the
 * roadmap calls this one binding.
 */
export const FAIRNESS = Object.freeze({
  /** seconds — minimum telegraph before any enemy attack may land */
  minWindup: 0.4,
  /** seconds — invulnerability window after the player is hit */
  invulnAfterHit: 1,
  /** the most enemies alive at once, anywhere, ever */
  maxActive: 6,
  /** archetypes per world */
  maxArchetypes: 3,
});

// --- the event log ----------------------------------------------------------

/**
 * Append one combat event. The log is a bounded array in world state: bounded
 * so a long session cannot grow it without limit, and in state (not in the UI)
 * because a headless test has to read it with no browser.
 */
export function emitEvent(state, event) {
  if (!state || !Array.isArray(state.events)) return event;
  const record = { tick: state.tick ?? 0, ...event };
  state.events.push(record);
  while (state.events.length > EVENT_LOG_MAX) state.events.shift();
  return record;
}

/**
 * Was `by`'s most recent telegraph in time to cover this damage?
 *
 * This is the predicate the fairness tests run over a whole log, exposed so the
 * game and its tests ask the *same* question rather than two similar ones.
 */
export function hasTelegraphFor(events, by, tick) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== EVENTS.telegraph || event.by !== by) continue;
    if (event.tick <= tick) return event;
  }
  return null;
}

// --- the player's health ----------------------------------------------------

export function createCombat({ map, seed, hearts = 4, spawn = null } = {}) {
  const maxHealth = clampHearts(hearts);
  const point = spawn ?? map?.spawn ?? { x: 0, z: 0 };
  const beacons = Array.isArray(map?.beacons) ? map.beacons : [];
  const first = beacons[0] ?? { id: 'spawn', label: 'where you landed', position: { x: point.x, z: point.z } };
  return {
    health: maxHealth,
    maxHealth,
    /** seconds of invulnerability left (a hit, or a fresh respawn) */
    invuln: 0,
    /** 0..1, decays; drives the red vignette */
    hurt: 0,
    dead: false,
    deaths: 0,
    hitsTaken: 0,
    hitsLanded: 0,
    swings: 0,
    /** the point a death sends you back to */
    beacon: {
      id: first.id,
      label: first.label ?? first.id,
      x: first.position?.x ?? 0,
      z: first.position?.z ?? 0,
      y: terrainHeight(map, seed, first.position?.x ?? 0, first.position?.z ?? 0),
    },
    /** beacons touched, so a test can prove the checkpoint moved */
    beaconsTouched: 0,
  };
}

/**
 * Change how many hearts the player carries, live.
 *
 * A slider has to move the health bar the moment it is dragged, and lowering it
 * must not kill you: the bar clamps down and the *maximum* moves with it.
 */
export function setHearts(state, hearts) {
  const combat = state?.combat;
  if (!combat) return 0;
  const max = clampHearts(hearts);
  const wasMax = combat.maxHealth;
  combat.maxHealth = max;
  combat.health = Math.min(combat.health, max);
  // Growing the bar gives you the new heart rather than leaving a gap: the
  // owner is tuning, not being punished for trying a bigger number.
  if (max > wasMax) combat.health += max - wasMax;
  return max;
}

export function clampHearts(hearts) {
  const value = Number.isFinite(hearts) ? Math.round(hearts) : 4;
  return clamp(value, 3, 5);
}

/**
 * Hurt the player.
 *
 * Returns false when the hit is refused — dead already, or still inside the
 * invulnerability window. That window is the anti-chain rule: without it two
 * enemies standing together would stun-lock the player, and the roadmap forbids
 * hit-stun chains outright.
 */
export function damagePlayer(state, { amount = 1, by = 'unknown', from = null } = {}) {
  const combat = state?.combat;
  if (!combat || combat.dead || combat.invuln > 0) return false;
  const damage = Math.max(1, Math.round(amount));
  combat.health = Math.max(0, combat.health - damage);
  combat.invuln = FAIRNESS.invulnAfterHit;
  combat.hurt = 1;
  combat.hitsTaken += 1;
  emitEvent(state, { kind: EVENTS.damage, to: 'player', by, amount: damage });

  // Knockback, away from whatever landed it. Velocity, not position: the
  // player's own collision pass moves them, so a shove can never push someone
  // through a rock.
  const player = state.player;
  if (player && from) {
    const dx = player.position.x - from.x;
    const dz = player.position.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    player.velocity.x += (dx / length) * ATTACK.playerKnockback;
    player.velocity.z += (dz / length) * ATTACK.playerKnockback;
  }

  if (combat.health <= 0) {
    combat.dead = true;
    combat.deaths += 1;
    player.velocity.x = 0;
    player.velocity.z = 0;
    emitEvent(state, { kind: EVENTS.death });
  }
  return true;
}

/**
 * Put the player back at their beacon, whole.
 *
 * No item loss, no penalty beyond position — that is the roadmap's rule, and it
 * is why this function has nothing in it but a position, a health bar and a
 * moment of grace.
 */
export function respawnPlayer(state, context) {
  const combat = state.combat;
  const beacon = combat.beacon;
  const player = state.player;
  player.position.x = beacon.x;
  player.position.z = beacon.z;
  player.position.y = terrainHeight(context.map, context.seed, beacon.x, beacon.z);
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.yaw = 0;
  player.pitch = -0.04;
  player.grounded = true;
  combat.health = combat.maxHealth;
  combat.invuln = COMBAT.respawnInvuln;
  combat.hurt = 0;
  combat.dead = false;
  // Everyone loses interest: you did not die to be hunted off the respawn pad.
  for (const enemy of state.enemies ?? []) enemy.state = 'disengage';
  emitEvent(state, { kind: EVENTS.respawn, at: beacon.id });
  return combat;
}

/**
 * Per-step bookkeeping: the invulnerability window, the vignette, and beacons.
 * Called from `stepWorld`, so it is part of the deterministic sim.
 */
export function stepCombat(state, context, dt) {
  const combat = state.combat;
  if (!combat) return state;
  combat.invuln = Math.max(0, combat.invuln - dt);
  // The vignette eases out over about a second rather than snapping off.
  combat.hurt = Math.max(0, combat.hurt - dt * 1.6);

  if (context?.map) {
    const beacons = Array.isArray(context.map.beacons) ? context.map.beacons : [];
    const player = state.player;
    for (const beacon of beacons) {
      const dx = player.position.x - (beacon.position?.x ?? 0);
      const dz = player.position.z - (beacon.position?.z ?? 0);
      if (Math.hypot(dx, dz) > COMBAT.beaconRadius) continue;
      // Already yours: nothing to do. Healing happens when a beacon *becomes*
      // yours, not continuously while you stand on it — a shrine you cannot be
      // hurt next to is not a checkpoint, it is an invulnerability field, and
      // the encounter layer is supposed to be a consequence.
      if (combat.beacon.id === beacon.id) continue;
      combat.beacon = {
        id: beacon.id,
        label: beacon.label ?? beacon.id,
        x: beacon.position?.x ?? 0,
        z: beacon.position?.z ?? 0,
        y: terrainHeight(context.map, context.seed, beacon.position?.x ?? 0, beacon.position?.z ?? 0),
      };
      combat.beaconsTouched += 1;
      combat.health = combat.maxHealth;
      emitEvent(state, { kind: EVENTS.beacon, at: beacon.id, healed: true });
    }
  }
  return state;
}

// --- the punch --------------------------------------------------------------

export const ATTACK_PHASES = Object.freeze({
  idle: 'idle',
  windup: 'windup',
  active: 'active',
  recover: 'recover',
});

export function createAttack() {
  return {
    phase: ATTACK_PHASES.idle,
    /** seconds left in the current phase */
    timer: 0,
    /** seconds until another swing may start */
    cooldown: 0,
    /** 0..1, read by the avatar to swing the arm */
    swing: 0,
    /** has this swing's damage already been resolved? one swing, one answer */
    resolved: false,
  };
}

/** The forward unit vector for a yaw, matching the player's own convention. */
export function forwardVector(yaw, out = { x: 0, z: 0 }) {
  out.x = -Math.sin(yaw);
  out.z = -Math.cos(yaw);
  return out;
}

/**
 * Everything a swing at this yaw and position would connect with.
 *
 * Pure geometry, so the reach and the arc are testable without a browser and
 * without an enemy ever having to exist.
 */
export function punchTargets({ position, yaw }, enemies, { reach = ATTACK.reach, halfAngle = ATTACK.halfAngle } = {}) {
  const forward = forwardVector(yaw);
  const cosLimit = Math.cos(halfAngle);
  const hits = [];
  for (const enemy of enemies ?? []) {
    if (enemy.dying || enemy.dead) continue;
    const dx = enemy.position.x - position.x;
    const dz = enemy.position.z - position.z;
    const distance = Math.hypot(dx, dz);
    // Reach is measured to the enemy's *body*, not its centre: a big thing
    // standing close is hit, which is what a player expects.
    if (distance > reach + (enemy.radius ?? 0)) continue;
    if (distance > 0.0001 && (dx / distance) * forward.x + (dz / distance) * forward.z < cosLimit) continue;
    hits.push(enemy);
  }
  return hits;
}

/**
 * Advance the swing one fixed step, and resolve its hit on the way through.
 *
 * `wantAttack` is the input edge. The telegraph event is emitted when the arm
 * starts pulling back and the damage events when the fist is out, which is the
 * ordering the fairness tests check — for the player's own attack as well as
 * for an enemy's.
 */
export function stepAttack(player, dt, wantAttack, enemies, state, settings = {}) {
  const attack = player.attack ?? (player.attack = createAttack());
  attack.cooldown = Math.max(0, attack.cooldown - dt);
  const damage = Math.max(1, Math.round(Number.isFinite(settings.punchDamage) ? settings.punchDamage : 1));
  const cooldown = Math.max(0.1, Number.isFinite(settings.punchCooldown) ? settings.punchCooldown : 0.42);

  switch (attack.phase) {
    case ATTACK_PHASES.idle: {
      attack.swing = Math.max(0, attack.swing - dt * 8);
      if (wantAttack && attack.cooldown <= 0 && !state?.combat?.dead) {
        attack.phase = ATTACK_PHASES.windup;
        attack.timer = ATTACK.windup;
        attack.cooldown = cooldown;
        attack.resolved = false;
        state.combat.swings += 1;
        emitEvent(state, { kind: EVENTS.telegraph, by: 'player', type: 'punch', windup: ATTACK.windup });
        emitEvent(state, { kind: EVENTS.punch });
      }
      break;
    }
    case ATTACK_PHASES.windup: {
      attack.timer -= dt;
      attack.swing = clamp(1 - attack.timer / ATTACK.windup, 0, 1);
      if (attack.timer <= 0) {
        attack.phase = ATTACK_PHASES.active;
        attack.timer = ATTACK.active;
      }
      break;
    }
    case ATTACK_PHASES.active: {
      if (!attack.resolved) {
        attack.resolved = true;
        resolvePunch(player, enemies, state, damage);
      }
      attack.timer -= dt;
      attack.swing = 1;
      if (attack.timer <= 0) {
        attack.phase = ATTACK_PHASES.recover;
        attack.timer = ATTACK.recover;
      }
      break;
    }
    case ATTACK_PHASES.recover: {
      attack.timer -= dt;
      attack.swing = clamp(attack.timer / ATTACK.recover, 0, 1);
      if (attack.timer <= 0) {
        attack.phase = ATTACK_PHASES.idle;
        attack.timer = 0;
        attack.swing = 0;
      }
      break;
    }
    default:
      attack.phase = ATTACK_PHASES.idle;
      attack.timer = 0;
      attack.swing = 0;
  }
  return attack;
}

function resolvePunch(player, enemies, state, damage) {
  const hits = punchTargets(player, enemies);
  if (hits.length === 0) return;
  const forward = forwardVector(player.yaw);
  for (const enemy of hits) {
    // The anglerfish rule: at least one thing per world cannot be fought. A
    // punch against it does *something* — a recoil, a flash — and nothing else.
    if (!enemy.fightable) {
      enemy.recoil = 1;
      emitEvent(state, { kind: EVENTS.immune, by: 'player', to: enemy.id, type: enemy.typeId });
      continue;
    }
    enemy.health -= damage;
    enemy.recoil = 1;
    enemy.hitFlash = 0.35;
    const dx = enemy.position.x - player.position.x;
    const dz = enemy.position.z - player.position.z;
    const length = Math.hypot(dx, dz) || 1;
    enemy.knockback.x = (dx / length) * ATTACK.knockback;
    enemy.knockback.z = (dz / length) * ATTACK.knockback;
    state.combat.hitsLanded += 1;
    emitEvent(state, { kind: EVENTS.damage, to: enemy.id, by: 'player', amount: damage });
    if (enemy.health <= 0) {
      enemy.health = 0;
      enemy.dying = true;
      enemy.deathTimer = 0.6;
      emitEvent(state, { kind: EVENTS.defeat, of: enemy.id, type: enemy.typeId });
    }
  }
  // A punch that connects costs a little of your own momentum: it reads as
  // contact rather than as a lightsaber through paper. `forward` is used for
  // nothing else, so keep the push small.
  player.velocity.x -= forward.x * 0.35;
  player.velocity.z -= forward.z * 0.35;
}
