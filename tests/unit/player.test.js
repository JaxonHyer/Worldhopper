/**
 * The player sim, asserted headlessly.
 *
 * These tests are the reason there is no physics engine (§4): walking on a
 * heightfield is a handful of rules, and every one of them can be checked here
 * instead of being "felt" on a device.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER, eyePosition, horizontalSpeed, sampleSupport, stepPlayer } from '../../src/core/player.js';
import { CAMERA } from '../../src/core/config.js';
import { PITCH_LIMIT, wrapAngle } from '../../src/core/math.js';
import { createWorldState, buildObstacles, terrainHeight } from '../../src/core/world-state.js';
import { getMap, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';

const map = getMap(DEFAULT_MAP_ID);

/** A perfectly flat map, so gravity and jumps can be measured exactly. */
const flatMap = {
  ...map,
  id: 'unit-flat',
  ground: { ...map.ground, amplitude: 0, frequency: 0.006, flatRadius: 100000 },
  landmarks: [],
  propPolicy: { ...map.propPolicy, count: 0 },
};

function world(overrides = {}) {
  const settings = { ...defaultSettings(), ...overrides.settings };
  const state = createWorldState({ map: overrides.map ?? map, seed: overrides.seed ?? 4242 });
  const context = { map: overrides.map ?? map, seed: state.seed, obstacles: overrides.obstacles ?? state.obstacles, settings };
  return { state, context, settings, player: state.player };
}

/** Run n fixed steps with the same intent factory. */
function run(player, context, seconds, intentFor = () => ({ move: { x: 0, y: 0 } }), dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stepPlayer(player, intentFor(i), context, dt);
  return player;
}

const forward = () => ({ move: { x: 0, y: 1 } });
const idle = () => ({ move: { x: 0, y: 0 } });

test('the player spawns standing on the terrain, at the map origin', () => {
  const { player } = world();
  assert.equal(player.grounded, true);
  assert.equal(player.position.x, 0);
  assert.equal(player.position.z, 0);
  assert.equal(player.position.y, terrainHeight(map, 4242, 0, 0));
  const eye = eyePosition(player);
  assert.equal(eye.y, player.position.y + PLAYER.eyeHeight);
});

test('gravity pulls the player down at the configured rate', () => {
  const { player, context, settings } = world();
  player.position.y += 50; // drop them in from height
  player.grounded = false;
  const startVy = player.velocity.y;
  run(player, context, 0.5);
  const expected = Math.max(-PLAYER.maxFallSpeed, startVy - settings.gravity * 0.5);
  assert.ok(Math.abs(player.velocity.y - expected) < 0.2, `vy ${player.velocity.y} vs ${expected}`);
});

test('falling lands on the terrain and stops', () => {
  const { player, context } = world();
  const groundY = terrainHeight(map, 4242, 0, 0);
  player.position.y = groundY + 20;
  player.grounded = false;
  run(player, context, 4);
  assert.equal(player.grounded, true);
  assert.ok(Math.abs(player.position.y - groundY) < 0.01, `landed at ${player.position.y}, ground is ${groundY}`);
  assert.ok(Math.abs(player.velocity.y) < 0.001, 'vertical velocity must be zero when standing');
  assert.ok(player.landings >= 1, 'the landing should have been counted');
});

test('a jump reaches the configured height and comes back', () => {
  for (const jumpHeight of [0.8, 1.5, 3]) {
    const { player, context, settings } = world({ settings: { jumpHeight }, map: flatMap });
    settings.jumpHeight = jumpHeight;
    const startY = player.position.y;
    let peak = startY;
    for (let i = 0; i < 240; i++) {
      stepPlayer(player, i === 0 ? { move: { x: 0, y: 0 }, jump: true } : idle(), context, 1 / 60);
      peak = Math.max(peak, player.position.y);
    }
    const reached = peak - startY;
    // Symplectic Euler overshoots very slightly; anything inside 8% is a jump
    // that matches its slider.
    assert.ok(
      Math.abs(reached - jumpHeight) / jumpHeight < 0.08,
      `jumpHeight ${jumpHeight} produced ${reached.toFixed(3)}m`,
    );
    assert.equal(player.grounded, true, 'must land again');
    assert.equal(player.jumps, 1);
  }
});

test('you cannot jump in mid-air', () => {
  const { player, context } = world({ map: flatMap });
  stepPlayer(player, { move: { x: 0, y: 0 }, jump: true }, context, 1 / 60);
  const jumpsAfterFirst = player.jumps;
  for (let i = 0; i < 10; i++) {
    stepPlayer(player, { move: { x: 0, y: 0 }, jump: true }, context, 1 / 60);
  }
  assert.equal(player.jumps, jumpsAfterFirst, 'a second press in the air must be ignored');
});

test('coyote time forgives walking off an edge', () => {
  const { player, context } = world({ map: flatMap });
  // Simulate leaving the ground: launch gently upward, then let go.
  player.grounded = false;
  player.velocity.y = 0.1;
  player.coyote = PLAYER.coyoteTime;
  stepPlayer(player, { move: { x: 0, y: 0 }, jump: true }, context, 1 / 60);
  assert.equal(player.jumps, 1, 'a jump just after leaving the ground should still fire');
});

test('the jump buffer fires a press made just before landing', () => {
  const { player, context } = world({ map: flatMap });
  player.position.y += 1.2;
  player.grounded = false;
  let fired = 0;
  for (let i = 0; i < 120; i++) {
    // Press once, a few frames before touching down.
    const jump = i === 6;
    stepPlayer(player, { move: { x: 0, y: 0 }, jump }, context, 1 / 60);
    if (player.jumps > fired) fired = player.jumps;
  }
  assert.equal(fired, 1, 'the buffered press should produce exactly one jump');
});

test('walking reaches the configured speed and stops when released', () => {
  const { player, context, settings } = world({ map: flatMap });
  run(player, context, 2, forward);
  assert.ok(
    Math.abs(horizontalSpeed(player) - settings.walkSpeed) < 0.15,
    `settled at ${horizontalSpeed(player).toFixed(2)} m/s, expected ${settings.walkSpeed}`,
  );
  run(player, context, 1.5, idle);
  assert.ok(horizontalSpeed(player) < 0.05, 'the player must come to rest');
});

test('higher acceleration reaches speed sooner', () => {
  const slow = world({ map: flatMap, settings: { accel: 8 } });
  const quick = world({ map: flatMap, settings: { accel: 120 } });
  run(slow.player, slow.context, 0.5, forward);
  run(quick.player, quick.context, 0.5, forward);
  assert.ok(horizontalSpeed(quick.player) > horizontalSpeed(slow.player) + 1, 'acceleration slider must matter');
});

test('diagonal input is not faster than straight input', () => {
  const straight = world({ map: flatMap });
  const diagonal = world({ map: flatMap });
  run(straight.player, straight.context, 2, () => ({ move: { x: 0, y: 1 } }));
  run(diagonal.player, diagonal.context, 2, () => ({ move: { x: 1, y: 1 } }));
  assert.ok(
    Math.abs(horizontalSpeed(diagonal.player) - horizontalSpeed(straight.player)) < 0.15,
    'normalised diagonals must travel at the same speed',
  );
});

test('the player can never end a step below the ground', () => {
  const { player, context } = world();
  let lowestClearance = Infinity;
  for (let i = 0; i < 900; i++) {
    // Wandering input: turning constantly, jumping at random-ish intervals.
    const angle = i * 0.03;
    const intent = {
      move: { x: Math.sin(angle), y: Math.cos(angle * 0.7) },
      jump: i % 47 === 0,
    };
    stepPlayer(player, intent, context, 1 / 60);
    const support = sampleSupport({
      map: context.map,
      seed: context.seed,
      obstacles: context.obstacles,
      x: player.position.x,
      z: player.position.z,
      feetY: player.position.y,
    });
    lowestClearance = Math.min(lowestClearance, player.position.y - support.groundY);
  }
  assert.ok(lowestClearance > -0.02, `the player sank ${(-lowestClearance).toFixed(3)}m into the ground`);
});

test('rocks are solid: no walking through an obstacle', () => {
  const { player, context, settings } = world();
  // Put a rock right in front of the player and walk at it.
  context.obstacles = [{ id: 'test-rock', x: 0, z: -6, radius: 1.5, topY: terrainHeight(map, 4242, 0, -6) + 2.2 }];
  run(player, context, 4, forward);
  const distance = Math.hypot(player.position.x - 0, player.position.z + 6);
  assert.ok(distance >= 1.5 + PLAYER.radius - 0.05, `walked into the rock (distance ${distance.toFixed(2)})`);
  assert.ok(player.position.z > -6, 'the player should have stopped short of it');
  assert.ok(horizontalSpeed(player) >= 0, 'still alive');
  assert.ok(settings.walkSpeed > 0);
});

test('a rock can be stood on once you are above it', () => {
  const { player, context } = world({ map: flatMap });
  const groundY = player.position.y;
  context.obstacles = [{ id: 'test-rock', x: 0, z: 0, radius: 1.2, topY: groundY + 1 }];
  player.position.y = groundY + 2;
  player.grounded = false;
  run(player, context, 2, idle);
  assert.equal(player.grounded, true);
  assert.ok(Math.abs(player.position.y - (groundY + 1)) < 0.02, `stood at ${player.position.y}, rock top is ${groundY + 1}`);
});

test('small steps are climbed, tall ones block', () => {
  const { player, context } = world({ map: flatMap });
  const groundY = player.position.y;
  // A low ledge: inside the step height.
  context.obstacles = [{ id: 'ledge', x: 0, z: -3, radius: 3, topY: groundY + PLAYER.stepHeight - 0.05 }];
  run(player, context, 2, forward);
  assert.ok(player.position.z < -3 + 3 + PLAYER.radius, 'should have stepped up onto the ledge');

  // A wall: same shape, taller than a step.
  const blocked = world({ map: flatMap });
  blocked.context.obstacles = [{ id: 'wall', x: 0, z: -3, radius: 3, topY: groundY + PLAYER.stepHeight + 1.5 }];
  run(blocked.player, blocked.context, 3, forward);
  assert.ok(blocked.player.position.z > -0.4, `walked through the wall to z=${blocked.player.position.z}`);
});

test('the player is kept inside the map', () => {
  const { player, context } = world({ map: flatMap });
  player.position.x = map.ground.size / 2 + 5;
  player.position.z = -(map.ground.size / 2 + 5);
  stepPlayer(player, idle(), context, 1 / 60);
  const limit = map.ground.size / 2 - 2;
  assert.ok(player.position.x <= limit + 1e-6, `x escaped to ${player.position.x}`);
  assert.ok(player.position.z >= -limit - 1e-6, `z escaped to ${player.position.z}`);
});

test('the view owns the vertical look range (third person cannot stare at the sky)', () => {
  const lookUp = { lookRate: { x: 0, y: -100 } };
  const lookDown = { lookRate: { x: 0, y: 100 } };

  const third = world({ settings: { view: 'third' } });
  run(third.player, third.context, 10, () => lookUp);
  assert.ok(
    Math.abs(third.player.pitch - CAMERA.pitchMax) < 1e-6,
    `third person looked up to ${third.player.pitch}, expected ${CAMERA.pitchMax}`,
  );
  run(third.player, third.context, 10, () => lookDown);
  assert.ok(
    Math.abs(third.player.pitch - CAMERA.pitchMin) < 1e-6,
    `third person looked down to ${third.player.pitch}, expected ${CAMERA.pitchMin}`,
  );

  // First person keeps the full range it always had: further up, and to the
  // flip-over limit rather than stopping early.
  const first = world({ settings: { view: 'first' } });
  run(first.player, first.context, 10, () => lookUp);
  assert.ok(first.player.pitch > CAMERA.pitchMax, `first person was capped at ${first.player.pitch}`);
  assert.ok(Math.abs(first.player.pitch - PITCH_LIMIT) < 1e-6, `first person stopped at ${first.player.pitch}`);
});

test('the walk cycle keeps running with the bob turned off', () => {
  // The avatar's limbs are driven by stridePhase, so bob = 0 must not stop the
  // legs — that is the trap in tying both to one slider.
  const { player, context } = world({ settings: { viewBob: 0 } });
  const cycles = runAndCountStrides(player, context, 1, forward);
  assert.equal(player.bob, 0, 'bob 0 means no camera movement');
  assert.ok(cycles > 0.5, `the walk cycle barely moved: ${cycles} cycles`);
  assert.equal(player.stepCycle, player.stridePhase);
});

/** Steps for `seconds` and returns how many stride cycles the phase covered. */
function runAndCountStrides(player, context, seconds, intentFor, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  let cycles = 0;
  for (let i = 0; i < steps; i++) {
    const before = player.stridePhase;
    stepPlayer(player, intentFor(i), context, dt);
    cycles += Math.abs(wrapAngle(player.stridePhase - before)) / (2 * Math.PI);
  }
  return cycles;
}

test('leg speed is capped, however fast the owner sets the walk speed', () => {
  // The complaint (owner, 2026-10-15): at their walk speed the animation was
  // "too quick / jittery". Speed over a fixed stride length would swing the legs
  // 7.9/1.6 = 4.9 times a second; the cap is what stops that.
  const settings = { walkSpeed: 7.9 };
  const capped = world({ settings });
  run(capped.player, capped.context, 3, forward); // reach top speed
  const topSpeed = horizontalSpeed(capped.player);
  assert.ok(Math.abs(topSpeed - 7.9) < 0.5, `did not reach top speed: ${topSpeed}`);
  const cycles = runAndCountStrides(capped.player, capped.context, 2, forward);
  const rate = cycles / 2;
  assert.ok(rate <= 2.05, `legs swung ${rate.toFixed(2)} times a second, cap is ${PLAYER.maxStrideRate}`);

  // A slow walk is *not* capped: the legs still follow the ground.
  const slow = world({ settings: { walkSpeed: 1.2 } });
  run(slow.player, slow.context, 3, forward);
  const slowRate = runAndCountStrides(slow.player, slow.context, 2, forward) / 2;
  assert.ok(Math.abs(slowRate - 1.2 / PLAYER.strideLength) < 0.1, `slow walk ran at ${slowRate.toFixed(2)} cycles/s`);

  // Raising the cap swings them faster again, so the slider is live.
  const quick = world({ settings: { ...settings, strideRate: 5 } });
  run(quick.player, quick.context, 3, forward);
  const quickRate = runAndCountStrides(quick.player, quick.context, 2, forward) / 2;
  assert.ok(quickRate > rate + 1, `raising the cap did nothing: ${quickRate.toFixed(2)} vs ${rate.toFixed(2)}`);
});

test('sprinting multiplies the walk speed, and only while there is a move', () => {
  // The sim owns what sprint *does*; the input layer only reports the intent
  // (a held shift, or the phone's toggle). At speed, the stride rate stays
  // capped — widening the swing is the animation's job (M1.6, owner-accepted).
  const walkSpeed = defaultSettings().walkSpeed;
  const sprintFactor = defaultSettings().sprint;
  assert.ok(sprintFactor > 1, 'the default sprint multiplier should actually be a sprint');

  const running = world();
  run(running.player, running.context, 3, () => ({ move: { x: 0, y: 1 }, sprint: true }));
  assert.equal(running.player.sprinting, true);
  const sprintSpeed = horizontalSpeed(running.player);
  assert.ok(
    Math.abs(sprintSpeed - walkSpeed * sprintFactor) < 0.2,
    `sprinting settled at ${sprintSpeed.toFixed(2)} m/s, expected ${(walkSpeed * sprintFactor).toFixed(2)}`,
  );

  // Holding sprint with no move input is not a sprint, and does not move you.
  const standing = world();
  run(standing.player, standing.context, 1, () => ({ move: { x: 0, y: 0 }, sprint: true }));
  assert.equal(standing.player.sprinting, false);
  assert.equal(horizontalSpeed(standing.player), 0);

  // No sprint intent, no sprint: the walk is untouched.
  const walking = world();
  run(walking.player, walking.context, 3, forward);
  assert.equal(walking.player.sprinting, false);
  assert.ok(Math.abs(horizontalSpeed(walking.player) - walkSpeed) < 0.15);

  // A multiplier of 1 is legal (the slider's floor) and means "no faster".
  const flat = world({ settings: { sprint: 1 } });
  run(flat.player, flat.context, 3, () => ({ move: { x: 0, y: 1 }, sprint: true }));
  assert.ok(Math.abs(horizontalSpeed(flat.player) - walkSpeed) < 0.15);

  // And a junk multiplier cannot make the player slower or NaN.
  const junk = world({ settings: { sprint: Number.NaN } });
  run(junk.player, junk.context, 2, () => ({ move: { x: 0, y: 1 }, sprint: true }));
  assert.ok(Number.isFinite(horizontalSpeed(junk.player)) && horizontalSpeed(junk.player) > walkSpeed * 0.9);
});

test('past the cap, extra speed widens the swing instead of quickening it', () => {
  const stir = (walkSpeed) => {
    const made = world({ settings: { walkSpeed } });
    run(made.player, made.context, 3, forward);
    return made.player.strideAmplitude;
  };
  const stroll = stir(1.5);
  const brisk = stir(3.2); // exactly the speed where the cap starts to bite
  const sprint = stir(7.9);
  assert.ok(stroll < brisk, `a stroll should swing less than a brisk walk: ${stroll} vs ${brisk}`);
  assert.ok(Math.abs(brisk - 1) < 0.05, `at the cap speed the swing should be full: ${brisk}`);
  assert.ok(sprint > brisk, `a sprint should widen the swing: ${sprint}`);
  assert.ok(sprint <= PLAYER.strideStretchMax + 1e-9, `swing is unbounded: ${sprint}`);

  // Standing still, the limbs are not asked to swing.
  const idlePlayer = world();
  run(idlePlayer.player, idlePlayer.context, 1, idle);
  assert.equal(idlePlayer.player.strideAmplitude, 0);
});

test('look input is clamped and NaN-proof', () => {
  const { player, context } = world();
  for (let i = 0; i < 300; i++) {
    stepPlayer(player, { move: { x: 0, y: 0 }, lookRate: { x: 0, y: 100 } }, context, 1 / 60);
  }
  assert.ok(player.pitch <= PLAYER.eyeHeight && player.pitch <= Math.PI / 2, 'pitch must be clamped');

  const before = JSON.stringify(player);
  stepPlayer(player, { move: { x: Number.NaN, y: Number.NaN }, lookImpulse: { yaw: Number.NaN, pitch: Number.NaN } }, context, 1 / 60);
  assert.equal(player.position.x, JSON.parse(before).position.x, 'NaN input must not move the player');
  assert.ok(Number.isFinite(player.position.y));
});

test('the same input produces the same state (determinism)', () => {
  const script = (i) => ({ move: { x: Math.sin(i * 0.11), y: Math.cos(i * 0.07) }, jump: i % 61 === 0 });
  const a = world();
  const b = world();
  run(a.player, a.context, 8, script);
  run(b.player, b.context, 8, script);
  assert.deepEqual(JSON.parse(JSON.stringify(a.player)), JSON.parse(JSON.stringify(b.player)));
});

test('different seeds put the player on different terrain', () => {
  const a = world({ seed: 11 });
  const b = world({ seed: 12 });
  run(a.player, a.context, 3, forward);
  run(b.player, b.context, 3, forward);
  assert.notEqual(a.player.position.y, b.player.position.y);
});

test('view bob follows the speed slider and stops in the air', () => {
  const bobbed = world({ map: flatMap, settings: { viewBob: 0.08 } });
  run(bobbed.player, bobbed.context, 1, forward);
  assert.ok(Math.abs(bobbed.player.bob) > 0.001, 'bob should be doing something while walking');

  const still = world({ map: flatMap, settings: { viewBob: 0 } });
  run(still.player, still.context, 1, forward);
  assert.equal(still.player.bob, 0, 'zero bob means no bob at all');

  const airborne = world({ map: flatMap, settings: { viewBob: 0.08 } });
  airborne.player.grounded = false;
  airborne.player.position.y += 5;
  stepPlayer(airborne.player, idle(), airborne.context, 1 / 60);
  assert.equal(airborne.player.bob, 0, 'the view must settle in the air');
});

test('the eye sits above the feet by the eye height, plus bob', () => {
  const { player } = world();
  player.bob = 0.05;
  const eye = eyePosition(player);
  assert.ok(Math.abs(eye.y - (player.position.y + PLAYER.eyeHeight + 0.05)) < 1e-9);
  assert.equal(eye.x, player.position.x);
});

test('the obstacle list is derived from the entities, not authored twice', () => {
  const state = createWorldState({ map, seed: 99 });
  const obstacles = buildObstacles(state.entities);
  assert.equal(obstacles.length, state.entities.length, 'every entity is solid');
  const rock = state.entities.find((e) => e.kind === 'rock');
  const shape = obstacles.find((o) => o.id === rock.id);
  assert.ok(shape.radius > 0 && shape.topY > rock.position.y, 'a rock must have a radius and a top');
  const landmark = obstacles.find((o) => o.id === state.entities[0].id);
  assert.ok(landmark.radius > 10, 'the landmark plinth is a big obstacle');
  assert.ok(landmark.topY > 5, 'and it is far taller than a step, so it is a wall');
});
