/**
 * The player's body: a **blocky** figure — axis-aligned boxes on a humanoid
 * silhouette, flat colours, four swinging limbs.
 *
 * The owner's art direction (2026-10-15): characters are blocky, Minecraft-
 * style — not merely low-poly. So this is deliberately built from boxes: no
 * bevels, no smooth shading, no imported model, no skeleton, no IK (§7 rules out
 * rigs; a box per limb is all this needs). Every future character — enemies at
 * M3, NPCs at M5 — follows the same recipe: a handful of boxes, flat colours,
 * animation by rotating those boxes.
 *
 * It is also why the figure is generated in code: assets must be original.
 *
 * Proportions are in metres and match the collision capsule: 1.86 m tall
 * (hair included), ~0.76 m across the shoulders. Limb boxes hang *down* from
 * their pivot, so a rotation about that pivot swings them from the shoulder or
 * the hip, the way a blocky character bends.
 */

import * as THREE from 'three';

export const AVATAR = Object.freeze({
  legHeight: 0.8,
  legWidth: 0.2,
  legDepth: 0.22,
  legGap: 0.115, // half-distance between the leg pivots
  bootHeight: 0.14,
  torsoHeight: 0.62,
  torsoWidth: 0.46,
  torsoDepth: 0.26,
  beltHeight: 0.12,
  armWidth: 0.15,
  armHeight: 0.52,
  armDepth: 0.17,
  armGap: 0.305, // half-distance between the shoulder pivots
  sleeveHeight: 0.18,
  handHeight: 0.14,
  headSize: 0.4,
  hairHeight: 0.1,
  /** limb swing at a full walk (rad) */
  swing: 0.62,
  /** swing while airborne (rad): a fixed pose reads better in the air */
  airSwing: 0.3,
  /** arms lift this far when airborne (rad) */
  airArms: 0.5,
});

/** Our own colours: a field-scholar's working clothes, nobody's licensed outfit. */
export const AVATAR_COLORS = Object.freeze({
  coat: 0x3c5a6e,
  trim: 0x9fb3b8,
  trousers: 0x38414b,
  boots: 0x241f1b,
  skin: 0xb98d68,
  hair: 0x2a231d,
  pack: 0x6b5836,
  eye: 0x1b1f24,
});

export function createPlayerAvatar({ colors = AVATAR_COLORS } = {}) {
  const group = new THREE.Group();
  group.name = 'player-avatar';

  const geometries = [];
  const materials = [];
  const materialFor = (color) => {
    const made = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: true });
    materials.push(made);
    return made;
  };

  /** A box hanging *down* from its own origin, so it can swing like a limb. */
  const box = (width, height, depth, color) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, -height / 2, 0);
    geometries.push(geometry);
    return new THREE.Mesh(geometry, materialFor(color));
  };

  const hipY = AVATAR.legHeight;
  const torsoTop = hipY + AVATAR.torsoHeight;
  const shoulderY = torsoTop - 0.04;
  const headTop = torsoTop + AVATAR.headSize;

  // --- limbs (the parts that move) ---------------------------------------
  const leftLeg = box(AVATAR.legWidth, AVATAR.legHeight, AVATAR.legDepth, colors.trousers);
  const rightLeg = box(AVATAR.legWidth, AVATAR.legHeight, AVATAR.legDepth, colors.trousers);
  for (const [leg, side] of [
    [leftLeg, -1],
    [rightLeg, 1],
  ]) {
    leg.position.x = side * AVATAR.legGap;
    leg.position.y = hipY;
    // The boot rides with its leg: a wider block over the last 14 cm.
    const boot = box(AVATAR.legWidth * 1.14, AVATAR.bootHeight, AVATAR.legDepth * 1.35, colors.boots);
    boot.position.set(0, -AVATAR.legHeight + AVATAR.bootHeight, 0);
    leg.add(boot);
  }

  const leftArm = box(AVATAR.armWidth, AVATAR.armHeight, AVATAR.armDepth, colors.coat);
  const rightArm = box(AVATAR.armWidth, AVATAR.armHeight, AVATAR.armDepth, colors.coat);
  for (const [arm, side] of [
    [leftArm, -1],
    [rightArm, 1],
  ]) {
    arm.position.x = side * AVATAR.armGap;
    arm.position.y = shoulderY;
    const cuff = box(AVATAR.armWidth * 1.1, AVATAR.sleeveHeight, AVATAR.armDepth * 1.05, colors.trim);
    cuff.position.set(0, -0.24, 0);
    const hand = box(AVATAR.armWidth * 0.95, AVATAR.handHeight, AVATAR.armDepth * 0.95, colors.skin);
    hand.position.set(0, -AVATAR.armHeight, 0);
    arm.add(cuff, hand);
  }

  // --- body (fixed boxes) -------------------------------------------------
  const torso = box(AVATAR.torsoWidth, AVATAR.torsoHeight, AVATAR.torsoDepth, colors.coat);
  torso.position.y = torsoTop;

  const belt = box(AVATAR.torsoWidth * 1.05, AVATAR.beltHeight, AVATAR.torsoDepth * 1.06, colors.trim);
  belt.position.y = hipY + AVATAR.beltHeight;

  const head = box(AVATAR.headSize, AVATAR.headSize, AVATAR.headSize, colors.skin);
  head.position.y = headTop;
  const hair = box(AVATAR.headSize * 1.05, AVATAR.hairHeight, AVATAR.headSize * 1.05, colors.hair);
  hair.position.y = headTop + AVATAR.hairHeight;
  const eyeSize = 0.07;
  for (const side of [-1, 1]) {
    const eye = box(eyeSize, eyeSize, 0.03, colors.eye);
    // Forward is -Z; the eyes sit a quarter of the way down the face.
    eye.position.set(side * 0.09, -AVATAR.headSize * 0.28, -(AVATAR.headSize / 2 + 0.015));
    head.add(eye);
  }

  // A field pack on the back: a scholar walks the world with one.
  const pack = box(0.24, 0.3, 0.12, colors.pack);
  pack.position.set(0, torsoTop - 0.06, AVATAR.torsoDepth / 2 + 0.06);

  group.add(leftLeg, rightLeg, leftArm, rightArm, torso, belt, head, hair, pack);

  // Eased whole-figure state, kept in the closure so sync() allocates nothing.
  let amplitude = 0;
  let airborne = 0;

  const api = {
    group,
    /**
     * Follow the sim. `camera.avatarVisible` hides the body in first person and
     * when the boom is too short to see past it.
     */
    sync(player, camera) {
      const visible = camera ? Boolean(camera.avatarVisible) : true;
      group.visible = visible;
      if (!visible) return;

      group.position.set(player.position.x, player.position.y, player.position.z);
      group.rotation.y = player.yaw;

      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      const moving = player.grounded && speed > 0.2;
      // Ease the poses into each other; a hard cut reads as a glitch.
      amplitude += ((moving ? 1 : 0) - amplitude) * 0.18;
      airborne += ((player.grounded ? 0 : 1) - airborne) * 0.22;

      const phase = player.stridePhase ?? player.bobPhase ?? 0;
      const stride = Math.sin(phase) * AVATAR.swing * amplitude;
      const swing = stride * (1 - airborne) + AVATAR.airSwing * airborne * Math.sign(stride || 1);
      const armSwing = -swing * 0.85 - AVATAR.airArms * airborne;

      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = armSwing;
      rightArm.rotation.x = -armSwing;
    },
    /** What the figure is made of (the scene tests read this). */
    stats: () => ({ boxes: geometries.length, meshes: group.children.length }),
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const item of materials) item.dispose();
    },
  };

  // Start in the standing pose so the first frames are never a T-pose.
  api.sync({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, grounded: true, stridePhase: 0 }, {
    avatarVisible: true,
  });
  return api;
}
