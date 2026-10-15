/**
 * The player: walking, looking, jumping and colliding with the world.
 *
 * Pure simulation — no DOM, no three.js — so every rule here is asserted in
 * Node (tests/unit/player.test.js) instead of being felt out on a device.
 * The renderer only reads `player`, and the camera is derived from it, so there
 * is exactly one source of truth (§2).
 *
 * Collision model (M1): a vertical capsule of radius PLAYER.radius against the
 * heightfield plus cylinder obstacles (rocks, the landmark plinth). No physics
 * engine (§4): a heightfield walker does not need one, and this is testable
 * headlessly, which a physics engine is not.
 */

import { PITCH_LIMIT, clamp, wrapAngle } from './math.js';
import { applyLook } from './look.js';
import { normalizeMove } from './stick.js';
import { CAMERA, PLAYER } from './config.js';
import { terrainHeight } from './terrain.js';

export { PLAYER };

/** Ring of directions sampled around the capsule's base. */
const RING = [
  [1, 0],
  [0.5, 0.8660254],
  [-0.5, 0.8660254],
  [-1, 0],
  [-0.5, -0.8660254],
  [0.5, -0.8660254],
];

/**
 * Ground support under a capsule's footprint.
 *
 * @returns {{groundY: number, blocked: boolean, blockedBy: object|null}}
 *   groundY: how high the ground is under the widest part of the capsule
 *   blocked: the capsule is pressed into the side of an obstacle
 */
export function sampleSupport({ map, seed, obstacles, x, z, feetY }) {
  let groundY = terrainHeight(map, seed, x, z);
  for (const [dx, dz] of RING) {
    const height = terrainHeight(map, seed, x + dx * PLAYER.radius, z + dz * PLAYER.radius);
    if (height > groundY) groundY = height;
  }

  let blocked = false;
  let blockedBy = null;
  if (obstacles) {
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i];
      const distance = Math.hypot(x - obstacle.x, z - obstacle.z);
      if (distance > obstacle.radius + PLAYER.radius) continue;
      // Standing on top of it, or stepping down past its rim: not a wall.
      if (feetY >= obstacle.topY - 0.06) {
        if (distance < obstacle.radius && obstacle.topY > groundY) groundY = obstacle.topY;
        continue;
      }
      blocked = true;
      blockedBy = obstacle;
      break;
    }
  }
  return { groundY, blocked, blockedBy };
}

export function createPlayer({ map, seed, spawn = map.spawn ?? { x: 0, z: 0 }, look = { yaw: 0, pitch: -0.04 } }) {
  const feet = terrainHeight(map, seed, spawn.x, spawn.z);
  return {
    position: { x: spawn.x, y: feet, z: spawn.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: look.yaw,
    pitch: look.pitch,
    grounded: true,
    coyote: PLAYER.coyoteTime,
    jumpBuffer: 0,
    /** metres walked, wrapped: drives the view bob *and* the avatar's limbs */
    stridePhase: 0,
    bobPhase: 0,
    bob: 0,
    stepCycle: 0,
    jumps: 0,
    landings: 0,
    distanceWalked: 0,
  };
}

/**
 * Eye position the camera should sit at (feet + eye height + view bob).
 * NaN-safe: a camera with a NaN position renders nothing at all, and this is
 * the one place the eye is defined, so the guard belongs here.
 */
export function eyePosition(player, out = { x: 0, y: 0, z: 0 }) {
  const position = player?.position;
  const feet = Number.isFinite(position?.y) ? position.y : 0;
  out.x = Number.isFinite(position?.x) ? position.x : 0;
  out.y = feet + PLAYER.eyeHeight + (Number.isFinite(player?.bob) ? player.bob : 0);
  out.z = Number.isFinite(position?.z) ? position.z : 0;
  return out;
}

export function horizontalSpeed(player) {
  return Math.hypot(player.velocity.x, player.velocity.z);
}

function approach(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function moveToward(player, dx, dz, context, dt) {
  const { map, seed, obstacles } = context;
  const start = { x: player.position.x, z: player.position.z };
  const targetX = start.x + dx;
  const targetZ = start.z + dz;

  const accept = (x, z) => {
    const support = sampleSupport({ map, seed, obstacles, x, z, feetY: player.position.y });
    const rise = support.groundY - player.position.y;
    // A step taller than the player's step height is a wall, not a bump.
    if (support.blocked || rise > PLAYER.stepHeight) return null;
    return { x, z, support };
  };

  // Full move first, then slide along each axis: cheap, stable, and it makes
  // "walk into a wall and keep going sideways" work without any solver.
  const attempts = [
    [targetX, targetZ],
    [targetX, start.z],
    [start.x, targetZ],
  ];
  for (const [x, z] of attempts) {
    const result = accept(x, z);
    if (!result) continue;
    player.distanceWalked += Math.hypot(x - start.x, z - start.z);
    player.position.x = x;
    player.position.z = z;
    return;
  }
  // Fully cornered: stay put, but let the velocity keep trying so the player
  // slides as soon as the direction changes.
}

/**
 * Advance the player one fixed step.
 *
 * @param {object} player
 * @param {object} intent {move:{x,y}, jump:boolean, lookImpulse?, lookRate?}
 * @param {object} context {map, seed, obstacles, settings}
 * @param {number} dt seconds (always the fixed step)
 */
export function stepPlayer(player, intent, context, dt) {
  const { settings } = context;
  const walkSpeed = Math.max(0, settings.walkSpeed);
  // Vertical look range, by view. Third person cannot look as far up as first
  // person — the boom would swing down through the floor — so the range is
  // narrower there, and the sim owns that rule rather than the renderer.
  const pitchMin = settings.view === 'first' ? -PITCH_LIMIT : CAMERA.pitchMin;
  const pitchMax = settings.view === 'first' ? PITCH_LIMIT : CAMERA.pitchMax;
  const gravity = Math.max(0, settings.gravity);
  const accelGround = Math.max(0, settings.accel);
  const move = intent?.move ?? { x: 0, y: 0 };

  // --- look (mouse/drag impulse + held look keys) --------------------------
  // The input layer has already applied the matching sensitivity slider (mouse
  // and drag are different devices), so the sim only clamps and wraps here.
  applyLook(player, { lookImpulse: intent?.lookImpulse ?? null, lookRate: intent?.lookRate ?? null }, dt, {
    sensitivity: 1,
    invertY: settings.invertY ?? false,
    pitchMin,
    pitchMax,
  });

  // --- jump buffering ------------------------------------------------------
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
  if (intent?.jump) player.jumpBuffer = PLAYER.jumpBufferTime;
  if (player.grounded) player.coyote = PLAYER.coyoteTime;
  else player.coyote = Math.max(0, player.coyote - dt);

  // --- horizontal velocity -------------------------------------------------
  // The sim never trusts the caller to have normalised: (1,1) must not be
  // 1.41x walking speed just because some future input source forgot.
  const wish = normalizeMove(clamp(move.x, -1, 1), clamp(move.y, -1, 1));
  const wishX = wish.x * walkSpeed;
  const wishZ = wish.y * walkSpeed;
  const cos = Math.cos(player.yaw);
  const sin = Math.sin(player.yaw);
  // Yaw 0 looks down -Z; yaw +90° looks down -X.
  const targetX = wishX * cos - wishZ * sin;
  const targetZ = -wishX * sin - wishZ * cos;
  const accel = (player.grounded ? accelGround : accelGround * PLAYER.airControl) * dt;
  player.velocity.x = approach(player.velocity.x, targetX, accel);
  player.velocity.z = approach(player.velocity.z, targetZ, accel);

  // --- jump ---------------------------------------------------------------
  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.velocity.y = Math.sqrt(2 * gravity * Math.max(0, settings.jumpHeight));
    player.grounded = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
    player.jumps++;
  }

  // --- gravity + vertical integration -------------------------------------
  player.velocity.y = Math.max(-PLAYER.maxFallSpeed, player.velocity.y - gravity * dt);
  const previousY = player.position.y;

  // --- horizontal movement with collision ---------------------------------
  moveToward(player, player.velocity.x * dt, player.velocity.z * dt, context, dt);

  // --- vertical movement + landing ----------------------------------------
  player.position.y += player.velocity.y * dt;
  const support = sampleSupport({
    map: context.map,
    seed: context.seed,
    obstacles: context.obstacles,
    x: player.position.x,
    z: player.position.z,
    feetY: Math.max(player.position.y, previousY),
  });

  if (player.position.y <= support.groundY) {
    if (!player.grounded && player.velocity.y < -0.5) player.landings++;
    player.position.y = support.groundY;
    if (player.velocity.y < 0) player.velocity.y = 0;
    player.grounded = true;
  } else {
    // Walking downhill: stick to the ground instead of hopping off every bump.
    if (player.grounded && player.velocity.y <= 0 && support.groundY - player.position.y > -PLAYER.stepHeight) {
      player.position.y = support.groundY;
      player.velocity.y = 0;
    } else if (player.grounded && player.velocity.y <= 0 && support.groundY > player.position.y) {
      player.position.y = support.groundY;
      player.velocity.y = 0;
    } else {
      player.grounded = false;
    }
  }

  // --- living inside the map ----------------------------------------------
  const limit = context.map.ground.size / 2 - 2;
  player.position.x = clamp(player.position.x, -limit, limit);
  player.position.z = clamp(player.position.z, -limit, limit);

  // --- stride: the walk cycle, shared by the view bob and the avatar -------
  // The phase advances whenever the player is walking, *whatever the bob
  // slider says*: bob 0 means "stop moving my camera", not "stop moving your
  // legs" (the avatar's limbs are animated from this same phase).
  const speed = horizontalSpeed(player);
  if (player.grounded && speed > 0.15) {
    player.stridePhase = wrapAngle(player.stridePhase + (speed / PLAYER.strideLength) * 2 * Math.PI * dt);
  }
  player.bobPhase = player.stridePhase;
  player.stepCycle = player.stridePhase;

  // --- view bob (the owner's slider; 0 disables it) ------------------------
  const bobAmount = Math.max(0, settings.viewBob ?? 0);
  if (player.grounded && speed > 0.15 && bobAmount > 0) {
    const strength = clamp(speed / Math.max(0.001, walkSpeed), 0, 1);
    player.bob = Math.sin(player.stridePhase) * bobAmount * strength;
  } else {
    // Settle back to level rather than snapping: a hard cut reads as a jolt.
    player.bob *= Math.max(0, 1 - dt * 12);
    if (Math.abs(player.bob) < 1e-4) player.bob = 0;
  }

  return player;
}
