/**
 * Enemies (WP-3.2) — the state machine, the roaming spawn director, and the
 * fairness contract measured over a whole run rather than one swing.
 *
 * The most important test in this file is `the fairness contract holds over a
 * whole run`. It simulates a player wandering a world full of enemies and
 * asserts that **every damage event in the log is preceded by that source's
 * telegraph**, and that no enemy's wind-up is shorter than the contract's
 * floor. "Genius AI" is not testable; that rule is, and the roadmap asks for
 * exactly this assertion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENEMY_STATES,
  ENEMY_TYPES,
  FAIRNESS,
  activeCap,
  chooseType,
  createEnemy,
  createSpawner,
  enemyStateCounts,
  findSpawnPoint,
  listEnemyTypeIds,
  nearestEnemy,
  playerFacingDot,
  resolveWindup,
  stepEnemies,
  stepSpawner,
  strikeDamage,
} from '../../src/core/enemy.js';
import { EVENTS, hasTelegraphFor } from '../../src/core/combat.js';
import { createWorldState, entityHash, scaleFenceStatus, stepWorld } from '../../src/core/world-state.js';
import { getMap } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';
import { createRng } from '../../src/core/rng.js';

const TEST_RANGE = 'blank-basin';
const settings = defaultSettings();

function world(seed = 4242, mapId = TEST_RANGE) {
  return createWorldState({ map: getMap(mapId), seed });
}

function context(state, overrides = {}) {
  return {
    map: getMap(state.mapId),
    seed: state.seed,
    obstacles: state.obstacles,
    settings: { ...settings, ...overrides },
  };
}

/**
 * Step the world for `seconds`, feeding it a wandering intent from a seeded
 * stream.
 *
 * Tethered to a point: an untethered random walk drifts out of the pack's leash
 * and the "run" stops containing encounters, which would make the fairness test
 * below assert something about nothing. Deterministic, so a run that trips the
 * contract trips it every time.
 */
function wander(state, seconds, seed = 7, { tether = { x: 0, z: 0 }, radius = 22, onTick = null } = {}) {
  const rng = createRng(seed);
  const ctx = context(state);
  let held = { x: 0, y: 0 };
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    onTick?.(i);
    if (i % 45 === 0) {
      const { x, z } = state.player.position;
      const away = Math.hypot(x - tether.x, z - tether.z);
      if (away > radius) {
        // Walk back in, so the run stays an encounter rather than a hike.
        held = { x: Math.sign(tether.x - x) || 1, y: Math.sign(tether.z - z) || 1 };
      } else {
        held = { x: Math.round(rng.range(-1, 1)), y: Math.round(rng.range(-1, 1)) };
      }
    }
    // A dead player is respawned by the frame loop, which does not exist here,
    // so put them back on their feet and let the run continue.
    if (state.combat.dead) {
      state.combat.dead = false;
      state.combat.health = state.combat.maxHealth;
      state.combat.invuln = 1.2;
    }
    stepWorld(state, 1 / 60, { move: held, jump: false, sprint: false, attack: false }, ctx);
  }
  return state;
}

/**
 * Step the whole world with the player standing still.
 *
 * `stepWorld`, not `stepEnemies`: events are stamped with `state.tick`, and only
 * `stepWorld` advances it. Stepping the machine on its own would give every
 * event the same tick and make "the telegraph came first" unanswerable.
 */
function tick(state, frames = 1, ctx = context(state)) {
  for (let i = 0; i < frames; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 0 }, jump: false, sprint: false, attack: false }, ctx);
  }
  return state;
}

// --- what a world is allowed to contain ---------------------------------------

test('every map declares at most three archetypes, and one of them cannot be fought', () => {
  for (const mapId of ['blank-basin', 'roshar']) {
    const policy = getMap(mapId).enemyPolicy;
    assert.ok(policy, `${mapId} has no enemy policy`);
    assert.ok(policy.types.length <= FAIRNESS.maxArchetypes, `${mapId} declares too many archetypes`);
    for (const typeId of policy.types) assert.ok(ENEMY_TYPES[typeId], `${mapId} names an unknown archetype: ${typeId}`);
    // The anglerfish rule: at least one thing per world is dread without a
    // health bar, and the only answer to it is your feet.
    const unkillable = policy.types.filter((id) => ENEMY_TYPES[id].fightable === false);
    assert.ok(unkillable.length >= 1, `${mapId} has nothing that cannot be fought`);
  }
});

test('an unkillable archetype is slower than a walking player, so escape is real', () => {
  for (const typeId of listEnemyTypeIds()) {
    const type = ENEMY_TYPES[typeId];
    if (type.fightable) continue;
    assert.ok(
      type.huntSpeed * 2 < settings.walkSpeed,
      `${typeId} hunts at ${type.huntSpeed} m/s against a ${settings.walkSpeed} m/s walk — you could not outrun it`,
    );
  }
});

test('the world opens inhabited, so nobody lands in an empty one', () => {
  for (const mapId of ['blank-basin', 'roshar']) {
    const state = world(4242, mapId);
    const policy = getMap(mapId).enemyPolicy;
    // The opening cast is the procedural ring pack plus any authored placements
    // (the owner's pool-side Chasmfiend on Roshar).
    const expected = Math.max(0, policy.initial ?? 0) + (policy.placements?.length ?? 0);
    assert.equal(state.enemies.length, expected, `${mapId} should open with its initial pack`);
    for (const enemy of state.enemies) {
      assert.equal(enemy.state, ENEMY_STATES.idle);
      assert.ok(Number.isFinite(enemy.position.y), `${enemy.id} is not on the ground`);
    }
  }
});

test('the Perpendicularity has its Chasmfiend when the game loads, and it sleeps until you choose', () => {
  // The owner's testing ask (2026-10-17): "have one spawn at this
  // Perpendicularity when the game loads," while the wandering pack stops
  // making them often. The pack-weight side lives in the rarity test below;
  // this side is the guaranteed placement.
  const state = world(4242, 'roshar');
  const gate = getMap('roshar').perpendicularity;
  const poolChasmia = state.enemies.filter((e) => e.typeId === 'storm-warden');
  assert.ok(poolChasmia.length >= 1, 'a Chasmfiend waits by the gate');
  const fiend = poolChasmia[0];
  const fromGate = Math.hypot(fiend.home.x - gate.position.x, fiend.home.z - gate.position.z);
  assert.ok(fromGate < gate.radius + 4, `its home belongs to the gate (${fromGate.toFixed(1)} m)`);
  assert.equal(fiend.aggroRange, 5, 'a tight sleeping circle, so a swim is never punished');

  // A player walking to the pool and through it is not jumped by the ambience:
  // the full spawn-walk passes outside the override and it stays idle.
  const ctx = context(state);
  for (let i = 0; i < 60 * 8; i++) {
    stepWorld(state, 1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: false, attack: false }, ctx);
  }
  assert.equal(fiend.state, ENEMY_STATES.idle, `the walk to the pool never woke it (${fiend.state})`);
  assert.equal(state.combat.hitsTaken, 0);
  // ...but deliberate approach is honoured, exactly as the owner will test it.
  assert.ok(
    Math.hypot(state.player.position.x - fiend.position.x, state.player.position.z - fiend.position.z) >
      fiend.aggroRange,
    'and the test really never got closer than its circle (otherwise this guard proves nothing)',
  );
});

test('Chasmfiends are RARE in the director’s draws now (the owner, 2026-10-17)', () => {
  // Sampling chooseType over a long seeded horizon: the weight change [3,1] -> [9,1]
  // was the request ("decrease their likelihood of spawning in the monster
  // spawner"), and the numbers only count if a test keeps someone honest.
  const state = world(4242, 'roshar');
  const ctx = context(state);
  let fiends = 0;
  let whitespines = 0;
  for (let i = 0; i < 4000; i++) {
    const pick = chooseType(state, ctx);
    if (pick === 'storm-warden') fiends++;
    else if (pick === 'crag-lurker') whitespines++;
  }
  const fraction = fiends / (fiends + whitespines);
  assert.ok(fraction < 0.2, `Chasmfiends are ${(fraction * 100).toFixed(1)}% of draws — not rare`);
  assert.ok(fraction > 0.01, 'and they do still happen');
});

test('turning encounters off turns them off', () => {
  const state = world(4242, TEST_RANGE, );
  state.enemies.length = 0;
  const ctx = context(state, { maxEnemies: 0 });
  assert.equal(activeCap(state, ctx), 0);
  for (let i = 0; i < 60 * 30; i++) stepSpawner(state, ctx, 1 / 60);
  assert.equal(state.enemies.length, 0, 'the owner can switch encounters off entirely');
});

// --- the machine ---------------------------------------------------------------

test('the machine runs idle -> alert -> hunt -> attack, in that order', () => {
  const state = world();
  // Put one enemy next to the player so the run does not depend on a wander
  // happening to pass by.
  const enemy = state.enemies[0];
  enemy.position.x = state.player.position.x + 6;
  enemy.position.z = state.player.position.z;
  enemy.home.x = enemy.position.x;
  enemy.home.z = enemy.position.z;

  const seen = [];
  const record = () => {
    if (seen[seen.length - 1] !== enemy.state) seen.push(enemy.state);
  };
  record();
  for (let i = 0; i < 60 * 6; i++) {
    tick(state, 1);
    record();
  }

  assert.equal(seen[0], ENEMY_STATES.idle);
  assert.ok(seen.includes(ENEMY_STATES.alert), `never alerted: ${seen.join(' -> ')}`);
  assert.ok(seen.includes(ENEMY_STATES.attack), `never attacked: ${seen.join(' -> ')}`);
  assert.ok(
    seen.indexOf(ENEMY_STATES.alert) < seen.indexOf(ENEMY_STATES.hunt),
    'it must notice you before it chases you',
  );
  assert.ok(
    seen.indexOf(ENEMY_STATES.hunt) < seen.indexOf(ENEMY_STATES.attack),
    'it must reach you before it swings',
  );
});

test('an enemy announces itself before it can hurt you, and by at least the contract’s wind-up', () => {
  const state = world();
  const enemy = state.enemies[0];
  enemy.position.x = state.player.position.x + 4;
  enemy.position.z = state.player.position.z;
  enemy.home.x = enemy.position.x;
  enemy.home.z = enemy.position.z;

  tick(state, 60 * 8);

  const alert = state.events.find((e) => e.kind === EVENTS.alert && e.by === enemy.id);
  const telegraph = state.events.find((e) => e.kind === EVENTS.telegraph && e.by === enemy.id);
  const damage = state.events.find((e) => e.kind === EVENTS.damage && e.to === 'player');

  assert.ok(alert, 'the approach cue fired');
  assert.ok(telegraph, 'the wind-up fired');
  assert.ok(alert.tick <= telegraph.tick, 'noticed you, then wound up — never the other way round');
  assert.ok(telegraph.windup >= FAIRNESS.minWindup, `wind-up was ${telegraph.windup}s`);
  assert.ok(damage, 'and it did eventually land, so this test is not asserting about nothing');
  assert.ok(telegraph.tick < damage.tick, 'the telegraph precedes the damage');
  // ...by the length it claimed, in sim time, not just in log order.
  assert.ok(
    (damage.tick - telegraph.tick) / 60 >= FAIRNESS.minWindup - 1 / 60,
    `only ${(damage.tick - telegraph.tick) / 60}s of sim time between the tell and the hit`,
  );
});

test('disengaging always works: run past the leash and it goes home', () => {
  const state = world();
  const enemy = state.enemies[0];
  // Home is where the leash is measured from, so put it at the player's feet
  // and then walk away: that is the situation the leash exists for.
  enemy.home.x = state.player.position.x;
  enemy.home.z = state.player.position.z;
  enemy.position.x = state.player.position.x + 3;
  enemy.position.z = state.player.position.z;

  // Get it committed, then leave. Far enough to break the leash (46 m), short of
  // the despawn ring (95 m) — past that the director removes it outright, which
  // is a different rule with its own test below.
  tick(state, 60);
  assert.notEqual(enemy.state, ENEMY_STATES.idle, 'it noticed you');
  assert.ok(state.events.some((e) => e.kind === EVENTS.alert && e.by === enemy.id));
  state.player.position.z += 60;
  // It finishes the swing it is already committed to — a wind-up is a promise,
  // and breaking it mid-air would read as a stutter — so give it one full
  // wind-up to notice you are gone.
  for (let i = 0; i < 60 * 3 && enemy.state !== ENEMY_STATES.disengage; i++) tick(state, 1);

  assert.equal(enemy.state, ENEMY_STATES.disengage, `it kept coming: ${enemy.state}`);
  assert.ok(state.events.some((e) => e.kind === EVENTS.disengage && e.by === enemy.id));

  // And it actually walks home rather than standing there pining. Once home it
  // goes back to wandering, which is the point of a *roaming* spawner — so the
  // claim is that it arrived, not that it is standing there when we look.
  let closestHome = Infinity;
  for (let i = 0; i < 60 * 30 && enemy.state !== ENEMY_STATES.idle; i++) {
    tick(state, 1);
    closestHome = Math.min(closestHome, Math.hypot(enemy.position.x - enemy.home.x, enemy.position.z - enemy.home.z));
  }
  assert.equal(enemy.state, ENEMY_STATES.idle, 'it went back to wandering its own patch');
  assert.ok(closestHome < 3, `the closest it got to home was ${closestHome.toFixed(1)} m`);
});

test('the owner’s ceiling holds, including when they drag it down mid-session', () => {
  // The bug this pins: `?enemies=1` opened a world with three in it, because the
  // opening pack was sized by a hard-coded default instead of the setting, and
  // nothing ever trimmed the surplus afterwards. A cap that only stops spawns is
  // not a cap.
  const small = world(4242);
  const smallCtx = context(small, { maxEnemies: 1 });
  assert.equal(small.enemies.length, getMap(TEST_RANGE).enemyPolicy.initial, 'a default world opens with its pack');
  stepSpawner(small, smallCtx, 1 / 60);
  assert.equal(small.enemies.length, 1, 'and a cap of one means one');

  const off = world(4242);
  stepSpawner(off, context(off, { maxEnemies: 0 }), 1 / 60);
  assert.equal(off.enemies.length, 0, 'encounters off means none, from the first step');

  // Farthest first, so the ones you can see are the ones that stay.
  const trimmed = world(4242);
  const kept = trimmed.enemies.reduce((best, e) =>
    Math.hypot(e.position.x, e.position.z) < Math.hypot(best.position.x, best.position.z) ? e : best,
  );
  stepSpawner(trimmed, context(trimmed, { maxEnemies: 1 }), 1 / 60);
  assert.deepEqual(trimmed.enemies.map((e) => e.id), [kept.id], 'the closest one is the one that stayed');
});

test('a world built with ?enemies=0 really is empty at boot', () => {
  const theMap = getMap(TEST_RANGE);
  const state = createWorldState({ map: theMap, seed: 4242, settings: { ...settings, maxEnemies: 0 } });
  assert.equal(state.enemies.length, 0, 'no opening pack when the owner asked for none');
  const normal = createWorldState({ map: theMap, seed: 4242, settings });
  assert.equal(normal.enemies.length, theMap.enemyPolicy.initial, 'and a default world is still inhabited');
});

test('the places you leave behind stop being populated', () => {
  const state = world(4242);
  const policy = getMap(TEST_RANGE).enemyPolicy;
  assert.ok(state.enemies.length > 0, 'it starts inhabited');
  // Walk somewhere far enough that the pack is behind you. This is the rule
  // that stops a long session from accumulating every enemy it ever made.
  state.player.position.x += policy.despawnRadius + 40;
  tick(state, 10);
  assert.equal(state.enemies.length, 0, 'everything you left behind is gone');
  assert.ok(state.spawner.culled > 0, 'and the count says so');
});

test('facing a flagged archetype mid-windup breaks its strike off — the Inquisitor rule (issue #21)', () => {
  const state = world(4242, 'roshar');
  const fiend = state.enemies.find((e) => e.typeId === 'storm-warden');
  assert.ok(fiend, 'the pool Chasmfiend is here');
  // Put it on top of the player and let it commit to the strike.
  fiend.position.x = state.player.position.x + 2.4;
  fiend.position.z = state.player.position.z;
  fiend.home.x = fiend.position.x;
  fiend.home.z = fiend.position.z;
  tick(state, 1);
  for (let i = 0; i < 60 * 6 && fiend.state !== ENEMY_STATES.attack; i++) tick(state, 1);
  assert.equal(fiend.state, ENEMY_STATES.attack, 'it wound up, so this test is not asserting about nothing');

  // Stand your ground and LOOK at it.
  const dx = fiend.position.x - state.player.position.x;
  const dz = fiend.position.z - state.player.position.z;
  state.player.yaw = Math.atan2(-dx, -dz);
  const before = state.events.filter((e) => e.kind === EVENTS.damage && e.by === fiend.id).length;
  tick(state, 2);

  assert.ok(state.events.some((e) => e.kind === EVENTS.flinch && e.by === fiend.id), 'a flinch was logged');
  assert.notEqual(fiend.state, ENEMY_STATES.attack, `the strike broke off (${fiend.state})`);
  const after = state.events.filter((e) => e.kind === EVENTS.damage && e.by === fiend.id).length;
  assert.equal(after, before, 'and no damage arrived');
  assert.ok(fiend.tell < 0.2, 'its tell reset with the strike');
});

test('an unflagged archetype does NOT flinch when faced, however hard you stare', () => {
  const state = world(4242, 'roshar');
  const spine = state.enemies.find((e) => e.typeId === 'crag-lurker');
  assert.ok(spine, 'a Whitespine is out there');
  spine.position.x = state.player.position.x + 1.8;
  spine.position.z = state.player.position.z;
  spine.home.x = spine.position.x;
  spine.home.z = spine.position.z;
  for (let i = 0; i < 60 * 4 && spine.state !== ENEMY_STATES.attack; i++) tick(state, 1);
  assert.equal(spine.state, ENEMY_STATES.attack);

  const dx = spine.position.x - state.player.position.x;
  const dz = spine.position.z - state.player.position.z;
  state.player.yaw = Math.atan2(-dx, -dz);
  tick(state, 60 * (spine.windup + 0.2));
  assert.ok(
    !state.events.some((e) => e.kind === EVENTS.flinch && e.by === spine.id),
    'no flag: facing it means nothing. That asymmetry is the design.',
  );
});

test('playerFacingDot reads the look direction, whatever way the world is', () => {
  // Straight ahead: equal to one. Behind: minus one. Matches the punch cone's math.
  const player = { position: { x: 0, z: 0 }, yaw: 0 };
  assert.ok(playerFacingDot(player, { position: { x: 0, z: -5 } }) > 0.99);
  assert.ok(playerFacingDot(player, { position: { x: 0, z: 5 } }) < -0.99);
  player.yaw = Math.PI / 2;
  assert.ok(playerFacingDot(player, { position: { x: -5, z: 0 } }) > 0.99);
});

test('a dead player is not hunted', () => {
  const state = world();
  const enemy = state.enemies[0];
  enemy.position.x = state.player.position.x + 3;
  enemy.position.z = state.player.position.z;
  tick(state, 60);
  assert.notEqual(enemy.state, ENEMY_STATES.idle, 'it was coming for you');

  state.combat.dead = true;
  tick(state, 1);
  assert.equal(enemy.state, ENEMY_STATES.disengage, 'a corpse is not worth hunting');
});

test('the wind-up slider is live and can never go under the contract’s floor', () => {
  for (const slider of [0, 0.05, 0.1, 0.4, 0.55, 2, 99, NaN, undefined]) {
    for (const typeId of listEnemyTypeIds()) {
      const windup = resolveWindup(ENEMY_TYPES[typeId], slider);
      assert.ok(
        windup >= FAIRNESS.minWindup,
        `${typeId} with the slider at ${String(slider)} wound up for ${windup}s`,
      );
      assert.ok(windup <= 8, 'and not so long that it is a joke');
    }
  }
});

test('the owner’s damage multiplier moves what a strike costs, within one heart and five', () => {
  const type = ENEMY_TYPES['crag-lurker'];
  assert.equal(strikeDamage(type, { enemyDamage: 1 }), 1);
  assert.equal(strikeDamage(type, { enemyDamage: 3 }), 3);
  assert.equal(strikeDamage(type, { enemyDamage: 0 }), 1, 'a slider at zero cannot make an enemy harmless by accident');
  assert.equal(strikeDamage(type, {}), 1, 'a missing setting falls back');
});

// --- the contract, over a whole run --------------------------------------------

test('the fairness contract holds over a whole run', () => {
  const state = world(4242);
  // Pull the pack in so the run actually contains encounters; a test that
  // asserts "no damage was ever untelegraphed" about a run with no damage in it
  // is not a test.
  const pack = { x: state.player.position.x, z: state.player.position.z };
  for (const enemy of state.enemies) {
    enemy.home.x = pack.x + 6;
    enemy.home.z = pack.z + 6;
    enemy.position.x = enemy.home.x;
    enemy.position.z = enemy.home.z;
    // A guaranteed encounter, not a hoped-for one: the contract being measured
    // here is the log's ORDERING, not encounter pacing — so the pack is put
    // into its hunting state and the wanders stay close, and the test's claims
    // stop depending on how many times in 75 s a random walk happens to be hit.
    enemy.state = ENEMY_STATES.hunt;
    enemy.cooldown = 0;
  }
  // And keep feeding the fight: every two sim-seconds one hunter is set at
  // the player's shoulder, on purpose. A 7.9 m/s random walk outruns most
  // wind-ups (which is GOOD news for real players, and USELESS for this
  // test) — the contract being measured is the log's ordering, not pacing,
  // so the encounter is engineered instead of hoped for.
  wander(state, 75, 11, {
    tether: pack,
    radius: 10,
    onTick: (i) => {
      if (i % 120 !== 0) return;
      const hunter = state.enemies.find((e) => !e.dying);
      if (!hunter) return;
      hunter.position.x = state.player.position.x + 1.2;
      hunter.position.z = state.player.position.z;
      hunter.state = ENEMY_STATES.hunt;
      hunter.cooldown = 0;
    },
  });

  const damages = state.events.filter((e) => e.kind === EVENTS.damage);
  assert.ok(damages.length >= 3, `expected a real encounter; the log has ${damages.length} damage events`);

  for (const event of damages) {
    const telegraph = hasTelegraphFor(state.events, event.by, event.tick);
    assert.ok(
      telegraph,
      `damage at tick ${event.tick} from ${event.by} had no telegraph before it — the contract is broken`,
    );
    if (event.to === 'player') {
      assert.ok(
        telegraph.windup >= FAIRNESS.minWindup,
        `a hit on the player was telegraphed for only ${telegraph.windup}s`,
      );
    }
  }

  // And no enemy ever swung twice off one wind-up.
  const telegraphs = state.events.filter((e) => e.kind === EVENTS.telegraph && e.by !== 'player');
  assert.ok(telegraphs.length >= damages.filter((d) => d.to === 'player').length, 'one wind-up, one swing');
});

test('a run with the player swinging obeys the same rule, for the player too', () => {
  const state = world(4242);
  const ctx = context(state);
  const rng = createRng(3);
  const pack = { x: state.player.position.x, z: state.player.position.z };
  let held = { x: 0, y: 0 };
  for (let i = 0; i < 60 * 60; i++) {
    if (i % 40 === 0) {
      const { x, z } = state.player.position;
      held =
        Math.hypot(x - pack.x, z - pack.z) > 16
          ? { x: Math.sign(pack.x - x) || 1, y: Math.sign(pack.z - z) || 1 }
          : { x: Math.round(rng.range(-1, 1)), y: Math.round(rng.range(-1, 1)) };
    }
    if (state.combat.dead) {
      state.combat.dead = false;
      state.combat.health = state.combat.maxHealth;
      state.combat.invuln = 1.2;
    }
    stepWorld(state, 1 / 60, { move: held, jump: false, sprint: false, attack: i % 20 === 0 }, ctx);
  }

  for (const event of state.events.filter((e) => e.kind === EVENTS.damage)) {
    assert.ok(
      hasTelegraphFor(state.events, event.by, event.tick),
      `${event.by} damaged ${event.to} with no telegraph`,
    );
  }
  assert.ok(state.combat.swings > 5, 'the player really did swing');
});

// --- determinism ---------------------------------------------------------------

test('the same seed and the same inputs build the same encounter', () => {
  const run = () => {
    const state = world(1234);
    wander(state, 40, 5);
    return JSON.stringify({
      enemies: state.enemies.map((e) => [e.id, e.typeId, e.state, e.position.x, e.position.z, e.health]),
      spawned: state.spawner.spawned,
      culled: state.spawner.culled,
      rng: state.spawner.rng,
    });
  };
  assert.equal(run(), run(), 'the encounter layer is part of the reproducible sim');
});

test('a different seed is a different world, and a different wander is a different run', () => {
  const a = world(1234);
  wander(a, 30, 5);
  const b = world(1235);
  wander(b, 30, 5);
  const c = world(1234);
  wander(c, 30, 6);
  const fingerprint = (state) => JSON.stringify(state.enemies.map((e) => [e.id, e.typeId, e.position.x, e.position.z]));
  assert.notEqual(fingerprint(a), fingerprint(b), 'different seeds');
  assert.notEqual(fingerprint(a), fingerprint(c), 'different inputs, same seed');
});

test('enemies are actors, not furniture: the map’s fingerprint does not move when they do', () => {
  const state = world(4242);
  const before = entityHash(state);
  wander(state, 40, 9);
  assert.equal(entityHash(state), before, 'spawning and despawning must not rewrite the map');
  assert.ok(state.spawner.spawned + state.enemies.length > 0);
});

// --- the spawn director ---------------------------------------------------------

test('the director never exceeds the cap, however long you play', () => {
  const state = world(4242);
  const ctx = context(state, { maxEnemies: 3 });
  for (let i = 0; i < 60 * 180; i++) {
    // Keep walking so the despawn ring keeps moving and the director keeps trying.
    state.player.position.x = Math.sin(i / 240) * 60;
    state.player.position.z = Math.cos(i / 240) * 60;
    stepSpawner(state, ctx, 1 / 60);
  }
  assert.ok(state.enemies.length <= 3, `had ${state.enemies.length} alive with a cap of 3`);
  assert.ok(state.spawner.spawned > 3, 'and it really did keep spawning');
});

test('the hard ceiling of six holds even if a map and a slider both ask for more', () => {
  const state = world();
  const ctx = context(state, { maxEnemies: 99 });
  ctx.map = { ...ctx.map, enemyPolicy: { ...ctx.map.enemyPolicy, maxActive: 99 } };
  assert.equal(activeCap(state, ctx), FAIRNESS.maxActive);
});

test('nothing spawns on top of the player, in the pool, or on an NPC', () => {
  const state = world(4242);
  const ctx = context(state);
  const policy = ctx.map.enemyPolicy;
  const gate = ctx.map.perpendicularity;
  const npc = state.entities.find((e) => e.kind === 'npc');

  for (let i = 0; i < 400; i++) {
    const spot = findSpawnPoint(state, ctx, state.player.position.x, state.player.position.z);
    assert.ok(spot, 'the director found somewhere to put one');
    const fromPlayer = Math.hypot(spot.x - state.player.position.x, spot.z - state.player.position.z);
    assert.ok(fromPlayer >= policy.spawnMin * 0.85, `spawned ${fromPlayer.toFixed(1)} m away`);
    assert.ok(
      Math.hypot(spot.x - gate.position.x, spot.z - gate.position.z) > gate.radius + 3,
      'spawned in the Perpendicularity',
    );
    if (npc) assert.ok(Math.hypot(spot.x - npc.position.x, spot.z - npc.position.z) >= 5, 'spawned on an NPC');
    // The player moves between attempts, so the ring has to follow them.
    state.player.position.x += 0.4;
  }
});

test('every enemy stays inside the scale fence', () => {
  const state = world(4242);
  wander(state, 60, 21);
  const status = scaleFenceStatus(state);
  assert.ok(status.worst < 4000, `something reached ${status.worst} m from the origin`);
  assert.equal(status.warn, false);
});

// --- small pure pieces -----------------------------------------------------------

test('createEnemy refuses an archetype that does not exist', () => {
  assert.throws(() => createEnemy({ typeId: 'nope', id: 'x', x: 0, z: 0, map: getMap(TEST_RANGE), seed: 1 }), /unknown enemy type/);
});

test('a fresh enemy is on the ground, at home, and idle', () => {
  const enemy = createEnemy({ typeId: 'storm-warden', id: 'enemy-9', x: 12, z: -7, map: getMap(TEST_RANGE), seed: 4242, windup: 0.55 });
  assert.equal(enemy.state, ENEMY_STATES.idle);
  assert.equal(enemy.fightable, false);
  assert.equal(enemy.position.x, 12);
  assert.ok(Number.isFinite(enemy.position.y));
  assert.equal(enemy.windup >= FAIRNESS.minWindup, true);
});

test('the spawner’s state is plain data, so world state stays JSON-clean', () => {
  const spawner = createSpawner(4242);
  assert.deepEqual(Object.keys(spawner).sort(), ['count', 'culled', 'rng', 'spawned', 'timer']);
  assert.equal(JSON.stringify(spawner), JSON.stringify({ rng: spawner.rng, count: 0, timer: 0, spawned: 0, culled: 0 }));
});

test('the state tally adds up to the number alive', () => {
  const state = world(4242);
  wander(state, 25, 13);
  const counts = enemyStateCounts(state);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, state.enemies.length);
  assert.ok(Object.keys(counts).every((key) => Object.values(ENEMY_STATES).includes(key)), 'no invented states');
});

test('nearestEnemy reports the closest live one', () => {
  const state = world(4242);
  const near = nearestEnemy(state);
  assert.ok(near, 'the world opens inhabited');
  const others = state.enemies.map((e) => Math.hypot(e.position.x, e.position.z));
  assert.ok(Math.min(...others) <= near.distance + 1e-9);
});

test('stepEnemies survives a world it has nothing to work with', () => {
  // Several existing tests advance the clock with no context at all, and a
  // helper that reaches for `context.map` unguarded turns those into crashes.
  const state = world(4242);
  assert.equal(stepEnemies(state, null, 1 / 60), state);
  assert.equal(stepEnemies(state, { map: null }, 1 / 60), state);
  const bare = { enemies: [], player: null };
  assert.equal(stepEnemies(bare, context(state), 1 / 60), bare);
});

test('an unknown archetype in the list is skipped, not fatal', () => {
  const state = world(4242);
  const ctx = context(state);
  ctx.map = { ...ctx.map, enemyPolicy: { ...ctx.map.enemyPolicy, types: ['nope', 'also-nope'] } };
  state.enemies.length = 0;
  for (let i = 0; i < 60 * 30; i++) stepSpawner(state, ctx, 1 / 60);
  assert.equal(state.enemies.length, 0, 'a bad row in the data cannot invent an enemy');
});
