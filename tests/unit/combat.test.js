/**
 * Combat (WP-3.1) — hearts, the punch, death, and the fairness contract.
 *
 * Everything here runs in Node with no browser, which is the point: the
 * contract's central claim is "a telegraph event precedes every damage event",
 * and a claim like that is worth nothing unless a machine checks it on every
 * commit. Feel is the owner's; ordering is not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK,
  ATTACK_PHASES,
  COMBAT,
  EVENTS,
  FAIRNESS,
  clampHearts,
  createAttack,
  createCombat,
  damagePlayer,
  hasTelegraphFor,
  punchTargets,
  respawnPlayer,
  setHearts,
  stepAttack,
  stepCombat,
} from '../../src/core/combat.js';
import { createWorldState, stepWorld } from '../../src/core/world-state.js';
import { getMap } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';

const TEST_RANGE = 'blank-basin';
const map = getMap(TEST_RANGE);
const settings = defaultSettings();

function world(seed = 4242, mapId = TEST_RANGE) {
  return createWorldState({ map: getMap(mapId), seed });
}

function context(state, overrides = {}) {
  return { map: getMap(state.mapId), seed: state.seed, obstacles: state.obstacles, settings: { ...settings, ...overrides } };
}

/** A stand-in enemy, so the punch can be tested without the state machine. */
function dummy(x, z, extra = {}) {
  return {
    id: 'enemy-test',
    typeId: 'crag-lurker',
    fightable: true,
    health: 2,
    radius: 0.55,
    position: { x, y: 0, z },
    knockback: { x: 0, z: 0 },
    hitFlash: 0,
    recoil: 0,
    dying: false,
    ...extra,
  };
}

// --- hearts ------------------------------------------------------------------

test('hearts are clamped to the roadmap’s 3–5, whatever arrives', () => {
  assert.equal(clampHearts(4), 4);
  assert.equal(clampHearts(1), 3, 'below the floor');
  assert.equal(clampHearts(99), 5, 'above the ceiling');
  assert.equal(clampHearts(NaN), 4, 'junk falls back, never NaN');
  assert.equal(clampHearts(undefined), 4);
});

test('the hearts slider is live, and lowering it cannot kill you', () => {
  const state = world();
  assert.equal(state.combat.maxHealth, 4);
  assert.equal(setHearts(state, 5), 5);
  assert.equal(state.combat.maxHealth, 5);
  assert.equal(state.combat.health, 5, 'growing the bar gives you the new heart');

  state.combat.health = 2;
  assert.equal(setHearts(state, 3), 3);
  assert.equal(state.combat.health, 2, 'clamped down, not killed');
  assert.equal(state.combat.dead, false);
  assert.equal(setHearts(state, 99), 5, 'the slider cannot exceed the ceiling either');
});

// --- damage, and the rule against chaining -----------------------------------

test('a hit costs a heart, shoves you away from it, and opens a window', () => {
  const state = world();
  const before = state.combat.health;
  const hit = damagePlayer(state, { amount: 1, by: 'enemy-001', from: { x: 0, z: -3 } });

  assert.equal(hit, true);
  assert.equal(state.combat.health, before - 1);
  assert.equal(state.combat.hitsTaken, 1);
  assert.equal(state.combat.invuln, FAIRNESS.invulnAfterHit);
  assert.equal(state.combat.hurt, 1, 'the vignette is driven by the sim, not the renderer');
  // The attacker was at -Z, so the shove is toward +Z.
  assert.ok(state.player.velocity.z > 0, `knocked away from the hit, got vz=${state.player.velocity.z}`);
});

test('the invulnerability window is what stops a hit-stun chain', () => {
  const state = world();
  assert.equal(damagePlayer(state, { amount: 1, by: 'a' }), true);
  // Three more swings land inside the window. None of them may count: two
  // enemies standing together would otherwise stun-lock the player, and the
  // roadmap forbids chains outright.
  assert.equal(damagePlayer(state, { amount: 1, by: 'b' }), false);
  assert.equal(damagePlayer(state, { amount: 1, by: 'c' }), false);
  assert.equal(state.combat.health, state.combat.maxHealth - 1, 'only the first hit counted');

  // Let the window pass and the next one lands.
  for (let i = 0; i < 80; i++) stepCombat(state, context(state), 1 / 60);
  assert.equal(state.combat.invuln, 0);
  assert.equal(damagePlayer(state, { amount: 1, by: 'd' }), true);
  assert.equal(state.combat.health, state.combat.maxHealth - 2);
});

test('running out of hearts kills you, and the log says so', () => {
  const state = world();
  state.combat.health = 1;
  damagePlayer(state, { amount: 1, by: 'enemy-001' });
  assert.equal(state.combat.health, 0);
  assert.equal(state.combat.dead, true);
  assert.equal(state.combat.deaths, 1);
  assert.ok(state.events.some((e) => e.kind === EVENTS.death), 'a death is an event, not a guess');
  // A corpse takes no further damage.
  assert.equal(damagePlayer(state, { amount: 1, by: 'enemy-001' }), false);
});

// --- beacons and respawn ------------------------------------------------------

test('a beacon moves the checkpoint and fills the bar', () => {
  const state = world();
  assert.equal(state.combat.beacon.id, 'beacon-basin-post', 'the spawn is a beacon, so a fresh run has one');
  state.combat.health = 1;
  const marker = map.beacons.find((b) => b.id === 'beacon-basin-marker');
  state.player.position.x = marker.position.x;
  state.player.position.z = marker.position.z;

  stepCombat(state, context(state), 1 / 60);

  assert.equal(state.combat.beacon.id, 'beacon-basin-marker');
  assert.equal(state.combat.health, state.combat.maxHealth, 'healing happens at beacons');
  assert.equal(state.combat.beaconsTouched, 1);
  assert.ok(state.events.some((e) => e.kind === EVENTS.beacon && e.at === 'beacon-basin-marker'));

  // Standing on it afterwards is not a second heal, and not a shield: a shrine
  // you cannot be hurt next to is an invulnerability field, not a checkpoint.
  state.combat.health = 1;
  for (let i = 0; i < 600; i++) stepCombat(state, context(state), 1 / 60);
  assert.equal(state.combat.health, 1, 'ten seconds on the beacon did not top you up');
  assert.equal(state.combat.beaconsTouched, 1, 'and it did not re-trigger');
});

test('death sends you back to the last beacon, whole, with nothing lost', () => {
  const state = world();
  const marker = map.beacons.find((b) => b.id === 'beacon-basin-marker');
  state.player.position.x = marker.position.x;
  state.player.position.z = marker.position.z;
  stepCombat(state, context(state), 1 / 60);

  // Walk off and die somewhere else entirely.
  state.player.position.x = 60;
  state.player.position.z = -40;
  state.combat.health = 0;
  state.combat.dead = true;
  respawnPlayer(state, context(state));

  assert.equal(state.combat.dead, false);
  assert.equal(state.combat.health, state.combat.maxHealth);
  assert.ok(Math.hypot(state.player.position.x - marker.position.x, state.player.position.z - marker.position.z) < 0.001);
  assert.equal(state.combat.invuln, COMBAT.respawnInvuln, 'grace, so you cannot be killed on the pad');
  assert.ok(state.events.some((e) => e.kind === EVENTS.respawn));
  // No item loss is the absence of anything to lose: there is no inventory,
  // no level and no counter in this state that a death could have moved.
  // The respawn is not a second death: the counter moved once, when it happened.
  assert.equal(state.combat.deaths, 0);
});

// --- the punch ----------------------------------------------------------------

test('a punch reaches what is in front of it and nothing behind or beside it', () => {
  const player = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const ahead = dummy(0, -2);
  const behind = dummy(0, 2);
  const beside = dummy(2.1, 0);
  const far = dummy(0, -9);

  const hits = punchTargets(player, [ahead, behind, beside, far]);
  assert.deepEqual(hits.map((e) => e.id), ['enemy-test']);

  // Turn around and the one behind is the one in front.
  player.yaw = Math.PI;
  assert.equal(punchTargets(player, [ahead, behind])[0], behind);
});

test('the swing’s arc is a cone, not a straight line', () => {
  const player = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  // 40° off-axis is inside a 49° half-angle; 70° is not.
  const inArc = dummy(Math.sin(0.7) * 2, -Math.cos(0.7) * 2);
  const outArc = dummy(Math.sin(1.22) * 2, -Math.cos(1.22) * 2);
  const hits = punchTargets(player, [inArc, outArc]);
  assert.deepEqual(hits, [inArc]);
});

test('one tap is one swing, and the cooldown gates the next', () => {
  const state = world();
  const player = state.player;
  player.position.x = 0;
  player.position.z = 0;
  // Plenty of health, so this measures the *rate* of swings and not a death.
  const target = dummy(0, -1.6, { health: 50, maxHealth: 50 });
  state.enemies.push(target);
  const hold = (frames) => {
    for (let i = 0; i < frames; i++) stepAttack(player, 1 / 60, true, state.enemies, state, settings);
  };

  stepAttack(player, 1 / 60, true, state.enemies, state, settings);
  assert.equal(player.attack.phase, ATTACK_PHASES.windup);
  assert.equal(state.combat.swings, 1);

  hold(20); // 0.35 s — still inside the 0.42 s cooldown
  assert.equal(state.combat.swings, 1, 'holding the button is one swing, not a machine gun');
  assert.equal(state.combat.hitsLanded, 1, 'and the fist connected exactly once');

  hold(10); // 0.52 s — the cooldown has passed and the next swing is under way
  assert.equal(state.combat.swings, 2);

  // Over a longer hold the count can never outrun the cooldown. That is the
  // entire job of the number, so it is asserted as a rate rather than as a
  // hand-counted snapshot that would have to be edited every time it is tuned.
  hold(60);
  const seconds = 91 / 60;
  const most = Math.floor(seconds / settings.punchCooldown) + 1;
  assert.ok(
    state.combat.swings <= most,
    `swung ${state.combat.swings} times in ${seconds.toFixed(2)} s; the cooldown allows ${most}`,
  );
  assert.equal(state.combat.hitsLanded, state.combat.swings, 'every swing that reached it connected once');
});

test('the player’s own attack telegraphs before it damages', () => {
  const state = world();
  const target = dummy(0, -1.6);
  state.enemies.push(target);
  state.player.position.x = 0;
  state.player.position.z = 0;

  for (let i = 0; i < 24; i++) stepAttack(state.player, 1 / 60, i === 0, state.enemies, state, settings);

  const log = state.events;
  const telegraph = log.findIndex((e) => e.kind === EVENTS.telegraph && e.by === 'player');
  const damage = log.findIndex((e) => e.kind === EVENTS.damage && e.by === 'player');
  assert.ok(telegraph >= 0, 'a swing announces itself');
  assert.ok(damage > telegraph, 'and only then does it hurt anything');
});

test('two punches finish a lurker, and the log records the finish', () => {
  const state = world();
  const target = dummy(0, -1.6, { health: 2 });
  state.enemies.push(target);
  state.player.position.x = 0;
  state.player.position.z = 0;

  for (let i = 0; i < 200; i++) stepAttack(state.player, 1 / 60, i % 30 === 0, state.enemies, state, settings);

  assert.equal(target.health, 0);
  assert.equal(target.dying, true);
  assert.ok(state.events.some((e) => e.kind === EVENTS.defeat));
});

test('a punch against something that cannot be fought does nothing but recoil', () => {
  const state = world();
  const warden = dummy(0, -1.6, { id: 'enemy-warden', typeId: 'storm-warden', fightable: false, health: 0 });
  state.enemies.push(warden);
  state.player.position.x = 0;
  state.player.position.z = 0;

  for (let i = 0; i < 120; i++) stepAttack(state.player, 1 / 60, i % 30 === 0, state.enemies, state, settings);

  assert.equal(state.combat.hitsLanded, 0, 'no hit ever landed');
  assert.ok(warden.recoil > 0 || state.events.some((e) => e.kind === EVENTS.immune), 'but the player is told');
  assert.ok(state.events.some((e) => e.kind === EVENTS.immune), 'the anglerfish rule is in the log');
  assert.ok(
    !state.events.some((e) => e.kind === EVENTS.damage && e.to === 'enemy-warden'),
    'nothing that cannot be fought was damaged',
  );
});

// --- the contract itself ------------------------------------------------------

test('the fairness contract’s numbers are the ones the brief states', () => {
  assert.ok(FAIRNESS.minWindup >= 0.4, 'every attack telegraphs for at least 0.4 s');
  assert.ok(FAIRNESS.invulnAfterHit >= 0.9 && FAIRNESS.invulnAfterHit <= 1.2, 'about a second of grace');
  assert.equal(FAIRNESS.maxActive, 6, 'at most six enemies alive at once');
  assert.equal(FAIRNESS.maxArchetypes, 3, 'at most three archetypes per world');
  assert.ok(ATTACK.reach > 1.5, 'a thumb can aim a punch');
});

test('hasTelegraphFor finds the telegraph that covers a damage event, and nothing else', () => {
  const log = [
    { tick: 1, kind: EVENTS.telegraph, by: 'a' },
    { tick: 4, kind: EVENTS.telegraph, by: 'b' },
    { tick: 5, kind: EVENTS.damage, by: 'a', to: 'player' },
  ];
  assert.equal(hasTelegraphFor(log, 'a', 5).tick, 1);
  assert.equal(hasTelegraphFor(log, 'b', 3), null, 'b had not wound up yet at tick 3');
  assert.equal(hasTelegraphFor(log, 'c', 9), null);
});

test('createAttack starts idle and inert', () => {
  const attack = createAttack();
  assert.equal(attack.phase, ATTACK_PHASES.idle);
  assert.equal(attack.cooldown, 0);
  assert.equal(attack.swing, 0);
});

test('createCombat starts full, alive, and pointed at a real place', () => {
  const combat = createCombat({ map, seed: 4242, hearts: 4 });
  assert.equal(combat.health, 4);
  assert.equal(combat.maxHealth, 4);
  assert.equal(combat.dead, false);
  assert.ok(Number.isFinite(combat.beacon.y), 'the beacon is on the ground, not in the sky');
});

test('stepWorld never lets combat run without a context, so a bare clock stays bare', () => {
  // Several existing tests advance the clock with no context at all. Combat must
  // not reach for one and throw, or those tests become crashes.
  const state = world();
  const tickBefore = state.tick;
  stepWorld(state, 1 / 60, { move: { x: 0, y: 1 } });
  assert.equal(state.tick, tickBefore + 1);
  assert.equal(state.combat.health, state.combat.maxHealth);
  assert.equal(state.enemies.length >= 0, true);
});
