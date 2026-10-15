/**
 * Where the camera goes — and nothing else. Pure maths, no DOM, no three.js,
 * so the whole thing is asserted in Node (tests/unit/camera.test.js).
 *
 * Two views, one source of truth:
 *   - **third** (the default): a boom of `settings.camDistance` metres behind
 *     the player, aimed at a point at chest height. It is shortened, never
 *     pushed through: the boom is marched outward and stops at the first
 *     sample that would sit in the ground or in a rock, and a final guard lifts
 *     it above the terrain wherever it ends up.
 *   - **first**: the eye, as before — feet + eye height + view bob.
 *
 * The camera is *derived* state: the sim never reads it, so a rendering change
 * can never alter the world (§2). Returning a mutable `out` object keeps the
 * frame loop allocation-free.
 */

import { CAMERA, PLAYER } from './config.js';
import { PITCH_LIMIT, clamp } from './math.js';
import { terrainHeight } from './terrain.js';
import { eyePosition } from './player.js';

/** The two views a player can pick between. */
export const VIEW = Object.freeze({ third: 'third', first: 'first' });

export function normalizeView(view) {
  return view === VIEW.first ? VIEW.first : VIEW.third;
}

export function createCameraState() {
  return {
    mode: VIEW.third,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    /** how long the boom ended up being (m); 0 in first person */
    distance: 0,
    /** true when something shortened the boom (or lifted the camera) */
    clipped: false,
    /** whether the player's body should be drawn at this distance */
    avatarVisible: true,
    /** metres above the feet that the boom aims at (first person: the eye) */
    targetHeight: PLAYER.eyeHeight,
  };
}

/**
 * Is this point clear of the world? The camera only needs to know whether it is
 * inside the ground or inside a rock — it does not collide, it just gives way.
 */
function isClear(x, y, z, { map, seed, obstacles, clearance }) {
  if (y < terrainHeight(map, seed, x, z) + clearance * 0.6) return false;
  if (!obstacles) return true;
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i];
    const reach = obstacle.radius + clearance * 0.5;
    if (y > obstacle.topY + clearance) continue;
    if (Math.hypot(x - obstacle.x, z - obstacle.z) < reach) return false;
  }
  return true;
}

/**
 * Resolve the camera for this frame.
 *
 * @param {object} args {player, settings, map, seed, obstacles}
 * @param {object} [out] reusable state (see createCameraState)
 */
export function resolveCamera({ player, settings, map = null, seed = 0, obstacles = null }, out = createCameraState()) {
  const mode = normalizeView(settings?.view);
  // Never let a NaN anywhere reach the renderer: a camera with a NaN position
  // renders nothing at all, which looks like the game crashing.
  const yaw = Number.isFinite(player.yaw) ? player.yaw : 0;
  const playerPitch = Number.isFinite(player.pitch) ? player.pitch : 0;
  const position = {
    x: Number.isFinite(player.position.x) ? player.position.x : 0,
    y: Number.isFinite(player.position.y) ? player.position.y : 0,
    z: Number.isFinite(player.position.z) ? player.position.z : 0,
  };
  const bob = Number.isFinite(player.bob) ? player.bob : 0;
  out.mode = mode;
  out.yaw = yaw;

  if (mode === VIEW.first) {
    const eye = eyePosition(player);
    out.x = eye.x;
    out.y = eye.y;
    out.z = eye.z;
    out.pitch = clamp(playerPitch, -PITCH_LIMIT, PITCH_LIMIT);
    out.distance = 0;
    out.clipped = false;
    out.avatarVisible = false;
    out.targetHeight = PLAYER.eyeHeight;
    return out;
  }

  const targetHeight = CAMERA.targetHeight + bob;
  const targetX = position.x;
  const targetY = position.y + targetHeight;
  const targetZ = position.z;

  const pitch = clamp(playerPitch, CAMERA.pitchMin, CAMERA.pitchMax);
  const cosPitch = Math.cos(pitch);
  // Yaw 0 looks down -Z. The boom goes the other way: behind the player.
  const fx = -Math.sin(yaw) * cosPitch;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cosPitch;

  const requested = Number.isFinite(settings?.camDistance) ? settings.camDistance : CAMERA.distance;
  const want = clamp(requested, CAMERA.minDistance, CAMERA.maxDistance);
  const context = { map, seed, obstacles, clearance: CAMERA.clearance };

  let boom = CAMERA.minDistance;
  if (map) {
    const step = (want - CAMERA.minDistance) / CAMERA.samples;
    for (let i = 1; i <= CAMERA.samples; i++) {
      const t = CAMERA.minDistance + step * i;
      if (!isClear(targetX - fx * t, targetY - fy * t, targetZ - fz * t, context)) break;
      boom = t;
    }
  } else {
    // No world to collide with (a unit test with a bare player): full length.
    boom = want;
  }

  out.x = targetX - fx * boom;
  out.y = targetY - fy * boom;
  out.z = targetZ - fz * boom;

  // Final guard: whatever the march decided, the camera is never under the
  // ground — a slope between two samples must not put it inside a hill.
  let lifted = false;
  if (map) {
    const floor = terrainHeight(map, seed, out.x, out.z) + CAMERA.clearance;
    if (out.y < floor) {
      out.y = floor;
      lifted = true;
    }
  }

  // Re-aim at the player, so lifting the camera does not push them off-centre.
  const flat = Math.hypot(targetX - out.x, targetZ - out.z);
  out.pitch = clamp(Math.atan2(targetY - out.y, Math.max(1e-4, flat)), -PITCH_LIMIT, PITCH_LIMIT);
  out.distance = Math.hypot(out.x - targetX, out.y - targetY, out.z - targetZ);
  out.clipped = lifted || boom < want - 1e-6;
  out.avatarVisible = out.distance > CAMERA.hideAvatarBelow;
  out.targetHeight = targetHeight;
  return out;
}
