/**
 * The player's body: **boxy and pixelated**, in ordinary clothes.
 *
 * Two notes from the owner (2026-10-15) shape everything here:
 *  - "the character should have a pixelated appearance like Minecraft" — so the
 *    figure wears tiny textures (an 8×8 face, an 8×12 shirt, 4×12 sleeves and
 *    trouser legs) sampled with nearest-neighbour filtering. The pixels are *real*
 *    pixels: an 8×8 face on a 0.4 m head is 5 cm per pixel, about a dozen screen
 *    pixels wide at the default camera distance, so the texture reads as blocks
 *    rather than as a smear. The art itself is data (src/core/pixel-art.js).
 *  - "more generic clothes" — a plain shirt, plain trousers, boots. No coat
 *    trim, no badges, no pack. Ten boxes: head, torso, two arms, two hands, two
 *    legs, two boots.
 *
 * Still no skeleton and no IK (§7): limbs are boxes hanging from a shoulder or
 * hip pivot, animated by rotating them. Enemies (M3) and NPCs (M5) follow this
 * recipe. Everything is generated in code, because assets must be original (§9).
 *
 * Animation rules the owner asked for: *less quick at high walk speeds*. The
 * frequency is capped by the sim (`settings.strideRate`), so at the default
 * 7.9 m/s the legs swing at 2 cycles/second instead of 4.9; the *amplitude*
 * grows with speed instead, which is what makes a sprint read as a sprint.
 * Easing is per second, not per frame, so the legs do not speed up on a phone
 * with a 120 Hz screen.
 */

import * as THREE from 'three';
import { characterSkin, isTexture, normalizeVariant } from '../core/pixel-art.js';
import { wrapAngle } from '../core/math.js';

export const AVATAR = Object.freeze({
  legHeight: 0.8,
  legWidth: 0.2,
  legDepth: 0.22,
  legGap: 0.115, // half-distance between the leg pivots
  bootHeight: 0.14,
  torsoHeight: 0.62,
  torsoWidth: 0.46,
  torsoDepth: 0.26,
  armWidth: 0.15,
  armHeight: 0.52,
  armDepth: 0.17,
  armGap: 0.305, // half-distance between the shoulder pivots
  handHeight: 0.14,
  headSize: 0.4,
  /** limb swing at full amplitude (rad); the sim scales this by speed */
  swing: 0.72,
  /** swing while airborne (rad): a fixed pose reads better in the air */
  airSwing: 0.3,
  /** arms lift this far when airborne (rad) */
  airArms: 0.5,
  /** per-second easing rates (frame-rate independent) */
  easePose: 9,
  easeAir: 11,
  /** how fast the body swings round to face the way it is walking */
  easeFacing: 14,
  /** below this speed the body keeps the facing it had (m/s) */
  facingMinSpeed: 0.25,
  /** the girl model has slimmer arms, like the classic slim skin */
  slimArmWidth: 0.12,
});

/**
 * Which way the body faces, given the way it is moving.
 *
 * Minecraft-style: the *body* turns to face the direction of travel while the
 * camera stays put, which is also the answer to the owner's "because of camera
 * position I cannot see the face" — walk backwards and the character turns to
 * face the camera.
 *
 * Pure and frame-rate independent (per-second easing), so it is asserted in
 * Node rather than eyeballed. Returns the new facing, in radians.
 */
export function nextFacing(current, velocity, dt, options = {}) {
  const { minSpeed = AVATAR.facingMinSpeed, rate = AVATAR.easeFacing } = options;
  if (!Array.isArray(current) && !Number.isFinite(current)) return 0;
  const vx = Number.isFinite(velocity?.x) ? velocity.x : 0;
  const vz = Number.isFinite(velocity?.z) ? velocity.z : 0;
  if (Math.hypot(vx, vz) < minSpeed) return current;
  // Yaw 0 looks down -Z, so the facing that matches a velocity points the same
  // way the player is travelling.
  const target = Math.atan2(-vx, -vz);
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const step = Math.min(Math.max(dt, 0), 0.25);
  return wrapAngle(current + delta * (1 - Math.exp(-rate * step)));
}

/** Turn one authored texture into something the GPU can sample, crisply. */
function toTexture(art, cache) {
  const existing = cache.get(art.name);
  if (existing) return existing;
  const texture = new THREE.DataTexture(art.data, art.width, art.height, THREE.RGBAFormat);
  texture.name = art.name;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Hard-edged pixels, always: nearest magnification is what makes it read as
  // pixel art. Minification still mip-maps, or distant faces would shimmer.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  cache.set(art.name, texture);
  return texture;
}

export function createPlayerAvatar({ variant = 'boy', skin = null } = {}) {
  const kind = normalizeVariant(variant);
  const art = skin ?? characterSkin({ variant: kind });
  const slim = kind === 'girl';
  const armWidth = slim ? AVATAR.slimArmWidth : AVATAR.armWidth;

  const group = new THREE.Group();
  group.name = 'player-avatar';
  group.userData.variant = kind;

  const geometries = [];
  const materials = [];
  const textures = new Map();

  const material = (art) => {
    const made = new THREE.MeshLambertMaterial({ map: toTexture(art, textures) });
    materials.push(made);
    return made;
  };

  /**
   * A box hanging *down* from its own origin, so a limb swings from the joint.
   * `faces` may be one texture for every face, or the six-face form
   * [right, left, top, bottom, back, front] — which is what gives the head a
   * face on the front and hair everywhere else.
   */
  const box = (width, height, depth, faces, name = '') => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, -height / 2, 0);
    geometries.push(geometry);
    const mesh = isTexture(faces)
      ? new THREE.Mesh(geometry, material(faces))
      : new THREE.Mesh(geometry, [
          material(faces.right),
          material(faces.left),
          material(faces.top),
          material(faces.bottom),
          material(faces.back),
          material(faces.front),
        ]);
    // Named so tests can ask the body about itself (and so a stray box is
    // findable in a debugger) rather than counting children and guessing.
    mesh.name = `${kind}-${name}`;
    return mesh;
  };

  const hipY = AVATAR.legHeight;
  const torsoTop = hipY + AVATAR.torsoHeight;
  const shoulderY = torsoTop - 0.04;

  // --- limbs (the parts that move) ---------------------------------------
  const leftLeg = box(AVATAR.legWidth, AVATAR.legHeight, AVATAR.legDepth, art.leg, 'left-leg');
  const rightLeg = box(AVATAR.legWidth, AVATAR.legHeight, AVATAR.legDepth, art.leg, 'right-leg');
  for (const [leg, side] of [
    [leftLeg, -1],
    [rightLeg, 1],
  ]) {
    leg.position.x = side * AVATAR.legGap;
    leg.position.y = hipY;
    const boot = box(AVATAR.legWidth * 1.14, AVATAR.bootHeight, AVATAR.legDepth * 1.35, art.boot, 'boot');
    boot.position.set(0, -AVATAR.legHeight + AVATAR.bootHeight, 0);
    leg.add(boot);
  }

  const leftArm = box(armWidth, AVATAR.armHeight, AVATAR.armDepth, art.arm, 'left-arm');
  const rightArm = box(armWidth, AVATAR.armHeight, AVATAR.armDepth, art.arm, 'right-arm');
  for (const [arm, side] of [
    [leftArm, -1],
    [rightArm, 1],
  ]) {
    arm.position.x = side * AVATAR.armGap;
    arm.position.y = shoulderY;
    const hand = box(armWidth * 0.95, AVATAR.handHeight, AVATAR.armDepth * 0.95, art.hand, 'hand');
    hand.position.set(0, -AVATAR.armHeight, 0);
    arm.add(hand);
  }

  // --- body ---------------------------------------------------------------
  const torso = box(
    AVATAR.torsoWidth,
    AVATAR.torsoHeight,
    AVATAR.torsoDepth,
    {
      right: art.torso.side,
      left: art.torso.side,
      top: art.torso.top,
      bottom: art.torso.bottom,
      back: art.torso.back,
      front: art.torso.front,
    },
    'torso',
  );
  torso.position.y = torsoTop;

  // The head is where per-face textures pay off: one face, hair on the other
  // five, so it is plain from behind and unmistakably a person from the front.
  const head = box(
    AVATAR.headSize,
    AVATAR.headSize,
    AVATAR.headSize,
    {
      right: art.head.right,
      left: art.head.left,
      top: art.head.top,
      bottom: art.head.bottom,
      back: art.head.back,
      front: art.head.front,
    },
    'head',
  );
  head.position.y = torsoTop + AVATAR.headSize;

  group.add(leftLeg, rightLeg, leftArm, rightArm, torso, head);

  // The girl's long hair is *painted*, not modelled — she is the same ten
  // boxes as the boy, and the difference lives in her head and torso textures
  // (hair down the sides, her hair over the shoulders of her shirt). The owner
  // asked for exactly that: "make it a texture only thing. Not actual 3d hair."

  // Eased pose state, kept in the closure so sync() allocates nothing.
  let walkBlend = 0;
  let airborne = 0;
  let facing = 0;

  const ease = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

  const api = {
    group,
    /**
     * Follow the sim. `camera.avatarVisible` hides the body in first person and
     * when the boom is too short to see past it. `dt` is the rendered frame
     * time, so the easing is the same speed on any device.
     */
    sync(player, camera, dt = 1 / 60) {
      const visible = camera ? Boolean(camera.avatarVisible) : true;
      group.visible = visible;
      if (!visible) return;

      const step = Math.min(dt, 0.25);
      group.position.set(player.position.x, player.position.y, player.position.z);
      // The body faces the way it walks; the camera is free to point elsewhere.
      facing = nextFacing(facing, player.velocity, step);
      group.rotation.y = facing;

      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      const moving = player.grounded && speed > 0.2;
      walkBlend = ease(walkBlend, moving ? 1 : 0, AVATAR.easePose, step);
      airborne = ease(airborne, player.grounded ? 0 : 1, AVATAR.easeAir, step);

      const phase = player.stridePhase ?? player.bobPhase ?? 0;
      // The sim decides how fast the phase runs (settings.strideRate) and how
      // far the limbs go (strideAmplitude, from speed); the view only turns
      // those two numbers into angles.
      const stride = Math.sin(phase) * AVATAR.swing * (player.strideAmplitude ?? 0) * walkBlend;
      const swing = stride * (1 - airborne) + AVATAR.airSwing * airborne * Math.sign(stride || 1);
      const armSwing = -swing * 0.85 - AVATAR.airArms * airborne;

      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = armSwing;
      rightArm.rotation.x = -armSwing;
    },
    /** What the figure is made of (the scene tests read this). */
    /** The direction the body is facing (rad) — the camera yaw is separate. */
    get facing() {
      return facing;
    },
    stats: () => ({
      boxes: geometries.length,
      meshes: group.children.length,
      textured: materials.filter((item) => item.map).length,
      textures: textures.size,
      variant: kind,
    }),
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const item of materials) item.dispose();
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
    },
  };

  // Start in the standing pose so the first frames are never a T-pose, facing
  // away from the camera (which is where the camera is looking).
  api.sync({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, grounded: true, stridePhase: 0 }, {
    avatarVisible: true,
  });
  return api;
}
