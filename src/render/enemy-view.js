/**
 * Enemy rendering: box-part rigs, procedural animation, and one tell each.
 *
 * The tier is fixed by the brief — "Minecraft or below": body, head, 1–4 limbs,
 * flat colours, **procedural animation only**. No skeletal rigs, no IK, no
 * facial animation, no textures beyond flat. Jank is the aesthetic; readability
 * is the requirement. So every motion here is a rotation of a box around a
 * pivot, driven by numbers the sim already owns:
 *
 *   walk        `stridePhase`  -> legs swing, body bobs
 *   the tell    `tell` (0..1)  -> leans back, then throws itself at you
 *   recoil      `recoil`       -> knocked backwards, squashed
 *   hit-flash   `hitFlash`     -> the body flashes toward white
 *   dying       `deathTimer`   -> sinks and shrinks
 *
 * The tell is the fairness contract made visible. An enemy cannot damage you
 * without a wind-up of at least 0.4 s, and this is the half of that rule you
 * can see: a ring opens on the ground and the body leans back into it. If the
 * ring is not legible on a phone, the encounter is not fair, which is why it is
 * drawn at the feet (always in frame in third person) and in a colour no rock
 * in this game uses.
 */

import * as THREE from 'three';
import { ENEMY_STATES, ENEMY_TYPES } from '../core/enemy.js';

/** How far the body leans back at full wind-up, radians. */
const TELL_LEAN = 0.42;
/** How far it throws itself forward at the strike, metres. */
const TELL_LUNGE = 0.55;
/** The aggro mark's size, metres. Small, above the head, unmissable in motion. */
const MARK_SIZE = 0.24;

const scratchColor = new THREE.Color();
const whiteColor = new THREE.Color('#ffffff');

export function createEnemyView(entity) {
  const type = ENEMY_TYPES[entity.typeId];
  if (!type) throw new Error(`createEnemyView: unknown enemy type ${entity.typeId}`);

  const group = new THREE.Group();
  group.name = entity.id;
  group.userData.entityId = entity.id;
  group.userData.kind = 'enemy';

  const geometries = [];
  const materials = [];

  /** A box that hangs down from its own origin, so a pivot is a shoulder/hip. */
  const part = (width, height, depth, color, name) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, -height / 2, 0);
    geometries.push(geometry);
    const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: true });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  };

  // --- proportions, from the archetype --------------------------------------
  const height = type.height;
  const headSize = Math.min(0.5, height * 0.26);
  const legHeight = height * 0.42;
  const legWidth = Math.max(0.14, height * 0.13);
  const bodyHeight = height - legHeight - headSize * 0.85;
  const bodyWidth = type.legs >= 4 ? height * 0.62 : height * 0.34;
  const bodyDepth = type.legs >= 4 ? height * 0.44 : height * 0.26;
  const armHeight = bodyHeight * 0.9;

  const hipY = legHeight;
  const bodyTop = hipY + bodyHeight;

  // --- legs -----------------------------------------------------------------
  const legs = [];
  for (let i = 0; i < type.legs; i++) {
    const leg = part(legWidth, legHeight, legWidth, type.colors.limb, `enemy-leg-${i}`);
    // Four legs sit at the corners of the body; two sit under its centre line.
    const across = type.legs >= 4 ? (i % 2 === 0 ? -1 : 1) * bodyWidth * 0.32 : (i === 0 ? -1 : 1) * bodyWidth * 0.24;
    const along = type.legs >= 4 ? (i < 2 ? -1 : 1) * bodyDepth * 0.28 : 0;
    leg.position.set(across, hipY, along);
    group.add(leg);
    legs.push(leg);
  }

  // --- body -----------------------------------------------------------------
  const body = part(bodyWidth, bodyHeight, bodyDepth, type.colors.body, 'enemy-body');
  body.position.y = bodyTop;
  group.add(body);

  // A spine ridge on the four-legged one: it is what breaks the silhouette
  // against a rock at a distance, which is the whole job of a silhouette.
  if (type.legs >= 4) {
    for (let i = 0; i < 3; i++) {
      const spine = part(bodyWidth * 0.16, bodyHeight * 0.34, bodyDepth * 0.2, type.colors.head, 'enemy-spine');
      spine.position.set(0, bodyTop - bodyHeight * (0.25 + i * 0.28), -bodyDepth * 0.5);
      spine.rotation.x = -0.35;
      group.add(spine);
    }
  }

  // --- head -----------------------------------------------------------------
  const head = part(headSize, headSize, headSize, type.colors.head, 'enemy-head');
  head.position.set(0, bodyTop + headSize * 0.92, type.legs >= 4 ? -bodyDepth * 0.12 : 0);
  group.add(head);

  // Eyes: two small boxes on the front face. Flat colour, no texture, no
  // expression — but they are the fastest way to read "this has a front".
  const eyeGeometry = new THREE.BoxGeometry(headSize * 0.16, headSize * 0.16, headSize * 0.06);
  geometries.push(eyeGeometry);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(type.colors.eye) });
  materials.push(eyeMaterial);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * headSize * 0.2, head.position.y - headSize * 0.08, -headSize * 0.5);
    head.add(eye);
  }

  // --- arms (the two-legged one only) ---------------------------------------
  const arms = [];
  for (let i = 0; i < (type.arms ?? 0); i++) {
    const arm = part(bodyWidth * 0.24, armHeight, bodyWidth * 0.24, type.colors.limb, `enemy-arm-${i}`);
    arm.position.set((i === 0 ? -1 : 1) * bodyWidth * 0.6, bodyTop - bodyHeight * 0.1, 0);
    group.add(arm);
    arms.push(arm);
  }

  // --- the tell: a ring on the ground ---------------------------------------
  // At the feet rather than over the head because in third person the feet are
  // always in frame and the space above a creature is often sky. Offset 3 cm
  // off the terrain: the scale fence's minimum coplanar gap is 1 cm, and a ring
  // lying exactly on the ground z-fights with it.
  const ringGeometry = new THREE.RingGeometry(0.86, 1, 22);
  ringGeometry.rotateX(-Math.PI / 2);
  geometries.push(ringGeometry);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(type.colors.tell),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  materials.push(ringMaterial);
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.03;
  ring.visible = false;
  ring.renderOrder = 2;
  group.add(ring);

  // --- the aggro mark: "it has seen you" ------------------------------------
  // The approach cue, before anything is wound up. A flat diamond that fades in
  // on `alert` and out on `disengage`; cheap enough to leave in permanently.
  const markGeometry = new THREE.OctahedronGeometry(MARK_SIZE, 0);
  geometries.push(markGeometry);
  const markMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(type.colors.tell),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  materials.push(markMaterial);
  const mark = new THREE.Mesh(markGeometry, markMaterial);
  mark.position.y = bodyTop + headSize * 1.9;
  mark.visible = false;
  group.add(mark);

  // Start where the sim says it is.
  group.position.set(entity.position.x, entity.position.y, entity.position.z);
  group.rotation.y = entity.yaw ?? 0;

  // Eased values, in the closure, so sync() allocates nothing.
  let flash = 0;
  let lean = 0;
  let markOpacity = 0;

  return {
    group,
    ring,
    mark,
    entityId: entity.id,
    typeId: entity.typeId,
    /**
     * Follow the sim. Every number below is read from the entity; nothing here
     * decides whether a hit landed or whether the enemy is hunting.
     *
     * @param {object} enemy the live entity
     * @param {number} dt frame seconds, for the easing only
     */
    sync(enemy, dt = 1 / 60) {
      const ease = 1 - Math.exp(-dt * 12);

      // Death: sink and shrink, then the director removes the entity and the
      // world view disposes this.
      if (enemy.dying) {
        const progress = Math.max(0, Math.min(1, enemy.deathTimer / 0.6));
        group.position.set(enemy.position.x, enemy.position.y - (1 - progress) * height * 0.8, enemy.position.z);
        group.scale.setScalar(Math.max(0.01, progress));
        group.rotation.y = enemy.yaw + (1 - progress) * 0.8;
        ring.visible = false;
        mark.visible = false;
        return;
      }
      group.scale.setScalar(1);

      // --- the tell ---------------------------------------------------------
      // Lean back through the wind-up, then snap forward as it lands. `tell`
      // runs 0 -> 1 across the wind-up, so the last tenth of it is the strike.
      const wantedLean = enemy.tell > 0 ? -TELL_LEAN * Math.sin(Math.min(1, enemy.tell) * Math.PI * 0.92) : 0;
      lean += (wantedLean - lean) * ease;
      const lunge = enemy.tell > 0.86 ? (enemy.tell - 0.86) / 0.14 : 0;

      // --- walk -------------------------------------------------------------
      const stride = Math.sin(enemy.stridePhase * 2);
      const walking = enemy.state === ENEMY_STATES.hunt || enemy.state === ENEMY_STATES.idle || enemy.state === ENEMY_STATES.disengage;
      const bob = walking ? Math.abs(stride) * height * 0.035 : Math.sin(enemy.stridePhase * 0.6) * height * 0.012;
      const recoilPush = enemy.recoil * 0.16;

      group.position.set(
        enemy.position.x - Math.sin(enemy.yaw) * (lunge * TELL_LUNGE - recoilPush),
        enemy.position.y + bob - recoilPush * 0.3,
        enemy.position.z - Math.cos(enemy.yaw) * (lunge * TELL_LUNGE - recoilPush),
      );
      group.rotation.y = enemy.yaw;
      // The body leans; the group stays upright, so the feet never leave the
      // ground (a creature that tilts into the floor reads as broken).
      body.rotation.x = lean;
      head.rotation.x = lean * 0.6;
      for (const arm of arms) arm.rotation.x = -lean * 1.4;

      const swing = walking ? 0.5 : 0.08;
      legs.forEach((leg, i) => {
        const phase = enemy.stridePhase * 2 + (i % 2 === 0 ? 0 : Math.PI) + (i < 2 ? 0 : Math.PI * 0.5);
        leg.rotation.x = Math.sin(phase) * swing * (walking ? 1 : 0.25);
      });

      // --- recoil: squash, so a punch that connects is felt ------------------
      const squash = 1 - enemy.recoil * 0.12;
      body.scale.set(1 + enemy.recoil * 0.08, squash, 1 + enemy.recoil * 0.08);

      // --- hit-flash --------------------------------------------------------
      flash += ((enemy.hitFlash > 0 ? 1 : 0) - flash) * ease;
      for (const material of materials) {
        if (material === ringMaterial || material === markMaterial || material === eyeMaterial) continue;
        // Each material was created from its own colour, so the flash lerps
        // from a stored original rather than accumulating toward white.
        if (!material.userData.baseColor) material.userData.baseColor = material.color.clone();
        scratchColor.copy(material.userData.baseColor).lerp(whiteColor, flash * 0.75);
        material.color.copy(scratchColor);
      }

      // --- the ring and the mark --------------------------------------------
      const telling = enemy.tell > 0.02;
      ring.visible = telling;
      if (telling) {
        const grow = 0.55 + enemy.tell * 0.75;
        ring.scale.set(grow, 1, grow);
        ringMaterial.opacity = 0.25 + enemy.tell * 0.6;
        ring.rotation.y = enemy.stridePhase * 0.2;
      }
      const wantsMark = enemy.state === ENEMY_STATES.alert || enemy.state === ENEMY_STATES.hunt || enemy.state === ENEMY_STATES.attack;
      markOpacity += ((wantsMark ? 1 : 0) - markOpacity) * ease;
      mark.visible = markOpacity > 0.02;
      markMaterial.opacity = markOpacity * 0.85;
      mark.rotation.y += dt * 2.4;
      mark.position.y = bodyTop + headSize * 1.9 + Math.sin(enemy.stridePhase * 1.3) * 0.04;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
