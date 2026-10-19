/**
 * Enemy rendering: box-part rigs, procedural animation, and one tell each.
 *
 * The tier is fixed by the brief — "Minecraft or below": body, head, limbs,
 * flat colours or baked pixel skins, **procedural animation only**. No skeletal
 * rigs, no IK, no facial animation. Jank is the aesthetic; readability is the
 * requirement. Limb count is data, not a rule: the budget in the brief is the
 * *design default*, and the owner's 14-legged Chasmfiend (2026-10-17) is the
 * sanctioned exception — the row says how many, this file says how they move.
 * Fanned pairs along the body for shells, corner pairs for quadrupeds, and —
 * from the owner's 2026-10-18 note — a segmented frame for "a cross between a
 * centipede and a crab": a chain of armoured boxes that tapers toward the
 * tail, crab pincers up front that RAISE as the wind-up tightens, and a
 * travelling undulation down the chain instead of leg pairs on a blob.
 *
 * Every motion is a rotation of a box around a pivot, driven by numbers the
 * sim already owns:
 *
 *   walk        `stridePhase`  -> legs ripple / the chain undulates, body bobs
 *   the tell    `tell` (0..1)  -> lean-back, and for the giant: pincers up
 *   recoil      `recoil`       -> knocked backwards, squashed
 *   hit-flash   `hitFlash`     -> the body flashes toward white
 *   dying       `deathTimer`   -> sinks and shrinks
 *
 * The tell is the fairness contract made visible. An enemy cannot damage you
 * without a wind-up of at least 0.4 s, and this is the half of that rule you
 * can see: a ring opens on the ground and the body answers. If the cue is not
 * legible on a phone, the encounter is not fair, which is why it is drawn at
 * the feet (always in frame in third person) and scaled to the body — and why
 * the giant's cue is *claws in the air*.
 */

import * as THREE from 'three';
import { ENEMY_STATES, ENEMY_TYPES, enemyFrameSpec } from '../core/enemy.js';
import { enemySkin } from '../core/enemy-skins.js';

/** How far the body leans back at full wind-up, radians. */
const TELL_LEAN = 0.42;
/** How far it throws itself forward at the strike, metres. */
const TELL_LUNGE = 0.55;
/** The aggro mark's size, metres. Small, above the head, unmissable in motion. */
const MARK_SIZE = 0.24;
const scratchColor = new THREE.Color();
const whiteColor = new THREE.Color('#ffffff');
// SEGMENT_STEP lives in core/enemy.js's frame spec now; kept name for the leg
// fan, whose rhythm is animation rather than frame geometry.

/** Build one nearest-filtered DataTexture from a baked pixel-art skin row. */
function toTexture(art, cache) {
  const existing = cache.get(art.name);
  if (existing) return existing;
  const texture = new THREE.DataTexture(art.data, art.width, art.height, THREE.RGBAFormat);
  texture.name = art.name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  cache.set(art.name, texture);
  return texture;
}

export function createEnemyView(entity) {
  const type = ENEMY_TYPES[entity.typeId];
  if (!type) throw new Error(`createEnemyView: unknown enemy type ${entity.typeId}`);

  const group = new THREE.Group();
  group.name = entity.id;
  group.userData.entityId = entity.id;
  group.userData.kind = 'enemy';

  const geometries = [];
  const materials = [];
  /** Material by purpose, so the hit-flash can lerp each from its own base. */
  const flashMaterials = [];
  const textureCache = new Map();

  const flatMaterial = (color) => {
    const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: true });
    materials.push(material);
    flashMaterials.push(material);
    return material;
  };

  /** A material whose map is a baked creature skin (AI art, pixel-crisp). */
  const skinMaterial = (skinName) => {
    const art = enemySkin(skinName);
    if (!art) return null;
    const material = new THREE.MeshLambertMaterial({ map: toTexture(art, textureCache) });
    materials.push(material);
    // Flashing a textured material lerps its base colour, leaving the map.
    flashMaterials.push(material);
    return material;
  };

  const materialFor = (skinName, flat) => skinMaterial(skinName) ?? flatMaterial(flat);

  /** A box that hangs down from its own origin, so a pivot is a shoulder/hip. */
  const part = (width, height, depth, skinName, flatColor, name) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, -height / 2, 0);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, materialFor(skinName, flatColor));
    mesh.name = name;
    return mesh;
  };

  // --- proportions, from the frame spec (shared with collision) -------------
  //
  // `enemyFrameSpec` is the ONE geometry source: the hull rings the player
  // bumps into are derived from the same numbers these boxes are placed with.
  // Meshes and walls cannot drift apart, which is the only way "its collision
  // covers its whole body" stays true when a row gets re-dimensioned.
  const dims = type.dims ?? {};
  const frame = enemyFrameSpec(type);
  const segmented = frame.segmented;
  const height = type.height;
  const headSize = dims.headSize ?? Math.min(0.5, height * 0.26);
  const legHeight = dims.legHeight ?? height * 0.42;
  const legWidth = dims.legWidth ?? Math.max(0.14, height * (type.legs > 4 ? 0.09 : 0.13));
  let bodyHeight, bodyWidth, bodyDepth;
  if (segmented) {
    bodyHeight = dims.height;
    bodyWidth = dims.width;
    bodyDepth = dims.depth;
  } else {
    bodyHeight = dims.bodyHeight ?? height - legHeight - headSize * 0.85;
    bodyWidth = dims.bodyWidth ?? (type.legs >= 4 ? height * 0.62 : height * 0.34);
    bodyDepth = dims.bodyDepth ?? (type.legs >= 4 ? height * 0.44 : height * 0.26);
  }
  const armHeight = bodyHeight * 0.9;

  const hipY = legHeight;
  /** The top of the shell: where the back rides, also the aggro mark's anchor. */
  const bodyTop = hipY + bodyHeight;

  const texture = type.texture ?? {};

  // --- legs -----------------------------------------------------------------
  const legs = [];
  const multi = type.legs > 4;
  if (segmented || multi) {
    // Fanned pairs along the sides — the crustacean layout. For a segmented
    // frame the pairs fan down the whole chain (a ripple per segment pair);
    // for a plain shell they fan across the blob.
    const pairs = Math.ceil(type.legs / 2);
    const spanZ = segmented ? dims.depth * 0.3 + dims.segments * dims.depth * 0.92 * 0.82 : bodyDepth * 0.76;
    const startZ = segmented ? dims.depth * 0.25 : -bodyDepth * 0.38;
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j < pairs && legs.length < type.legs; j++) {
        const leg = part(legWidth, legHeight, legWidth, texture.limb, type.colors.limb, `enemy-leg-${legs.length}`);
        const across = (side === 0 ? -1 : 1) * bodyWidth * (segmented ? 0.52 : 0.46);
        const along = pairs === 1 ? 0 : startZ + (j / (pairs - 1)) * spanZ;
        leg.position.set(across, hipY, along);
        leg.userData.rip = j * 0.9 + side * Math.PI;
        group.add(leg);
        legs.push(leg);
      }
    }
  } else {
    for (let i = 0; i < type.legs; i++) {
      const leg = part(legWidth, legHeight, legWidth, texture.limb, type.colors.limb, `enemy-leg-${i}`);
      const across = type.legs >= 4 ? (i % 2 === 0 ? -1 : 1) * bodyWidth * 0.32 : (i === 0 ? -1 : 1) * bodyWidth * 0.24;
      const along = type.legs >= 4 ? (i < 2 ? -1 : 1) * bodyDepth * 0.28 : 0;
      leg.position.set(across, hipY, along);
      leg.userData.rip = i % 2 === 0 ? 0 : Math.PI;
      group.add(leg);
      legs.push(leg);
    }
  }

  // --- body -----------------------------------------------------------------
  // A single hunch box, or the segmented chain. Segment 0 always answers to
  // the name 'enemy-body', so everything downstream (tests, spines, flash) has
  // one handle regardless of frame.
  const segments = [];
  const pincers = [];
  let body;
  if (segmented) {
    for (const [j, spec] of frame.segments.entries()) {
      const seg = part(
        spec.width,
        spec.height,
        spec.depth,
        texture.body,
        type.colors.body,
        j === 0 ? 'enemy-body' : `enemy-segment-${j}`,
      );
      seg.position.set(0, bodyTop - j * bodyHeight * 0.06, spec.along);
      group.add(seg);
      segments.push(seg);
    }
    body = segments[0];

    if (dims.pincers) {
      // Crab pincers: an arm segment hanging from the front corners plus a
      // claw block at its end, on a pivot, so "claws in the air" is the tell.
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * bodyWidth * 0.44, legHeight + bodyHeight * 0.5, -bodyDepth * 0.38);
        const arm = part(0.4, 1.5, 0.4, texture.limb, type.colors.limb, 'enemy-pincer-arm');
        arm.rotation.x = 0.5;
        pivot.add(arm);
        const clawGeometry = new THREE.BoxGeometry(0.85, 0.5, 1.9);
        clawGeometry.translate(0, 0, -0.7);
        geometries.push(clawGeometry);
        const claw = new THREE.Mesh(clawGeometry, materialFor(texture.body, type.colors.body));
        claw.name = 'enemy-pincer';
        claw.position.set(0, -1.15, -0.5);
        claw.rotation.y = side * -0.35;
        pivot.add(claw);
        pivot.rotation.y = side * 0.4;
        pivot.rotation.x = 0.25;
        group.add(pivot);
        pincers.push(pivot);
      }
    }
  } else {
    body = part(bodyWidth, bodyHeight, bodyDepth, texture.body, type.colors.body, 'enemy-body');
    body.position.y = bodyTop;
    group.add(body);
  }

  // --- spines ----------------------------------------------------------------
  // The Whitespine's namesake: flat plates along the back, bright against the
  // dark hide, tapering toward the tail so the spine-line reads from behind.
  // The default small ridge stays for any quadruped without its own colour.
  const spines = [];
  if (!segmented && type.colors.spines) {
    const count = 6;
    for (let i = 0; i < count; i++) {
      const taper = 1 - (i / count) * 0.55;
      const plate = part(bodyWidth * 0.14 * taper, bodyHeight * 0.5 * taper, bodyDepth * 0.06, null, type.colors.spines, 'enemy-spine');
      const along = bodyDepth * 0.34 - (i / (count - 1)) * bodyDepth * 0.68;
      plate.position.set(0, bodyTop - bodyHeight * 0.06, along);
      plate.rotation.x = 0.22 + (i / (count - 1)) * 0.1;
      group.add(plate);
      spines.push(plate);
    }
  } else if (!segmented && type.legs >= 4) {
    for (let i = 0; i < 3; i++) {
      const spine = part(bodyWidth * 0.16, bodyHeight * 0.34, bodyDepth * 0.2, null, type.colors.head, 'enemy-spine');
      spine.position.set(0, bodyTop - bodyHeight * (0.25 + i * 0.28), -bodyDepth * 0.5);
      spine.rotation.x = -0.35;
      group.add(spine);
      spines.push(spine);
    }
  }

  // --- head -----------------------------------------------------------------
  const head = part(headSize, headSize, headSize, texture.head, type.colors.head, 'enemy-head');
  if (segmented) {
    // A low, wide jaw under the shell's forward rim — crab, not crow.
    head.position.set(0, bodyTop - headSize * 0.2, -bodyDepth * 0.42);
  } else {
    head.position.set(0, bodyTop + headSize * 0.92, type.legs >= 4 ? -bodyDepth * 0.12 : 0);
  }
  group.add(head);

  // Eyes: two small boxes on the front face. Flat colour, no expression — but
  // they are the fastest way to read "this has a front".
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
    const arm = part(bodyWidth * 0.24, armHeight, bodyWidth * 0.24, null, type.colors.limb, `enemy-arm-${i}`);
    arm.position.set((i === 0 ? -1 : 1) * bodyWidth * 0.6, bodyTop - bodyHeight * 0.1, 0);
    group.add(arm);
    arms.push(arm);
  }

  // --- the tell: a ring on the ground ---------------------------------------
  // At the feet rather than over the head because in third person the feet are
  // always in frame and the space above a creature is often sky. Offset 3 cm
  // off the terrain: the scale fence's minimum coplanar gap is 1 cm, and a ring
  // lying exactly on the ground z-fights with it. The ring is unit-sized and
  // scaled to the body, so a giant's warning fits the giant it belongs to.
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
  const ringBase = Math.max(1, (entity.radius ?? 0.55) * 1.15 + 0.4);
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
      // runs 0 -> 1 across the wind-up: the giant reads it as claws-to-the-sky.
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
      if (segments.length > 0) {
        // The chain answers the tell staggered, head first, tail last — the
        // rearing you watch before a chasmfiend decides to land on you.
        for (let j = 0; j < segments.length; j++) {
          segments[j].rotation.x = lean * (0.8 - j * 0.11);
        }
        // And its gait is a slow undulation down the shell, not a bob.
        const undulation = walking ? 1 : 0.3;
        for (let j = 0; j < segments.length; j++) {
          segments[j].rotation.y = Math.sin(enemy.stridePhase * 2 + j * 0.7) * 0.045 * undulation;
        }
      } else {
        body.rotation.x = lean;
      }
      head.rotation.x = lean * 0.6;
      for (const arm of arms) arm.rotation.x = -lean * 1.4;
      // The tell you cannot miss: the pincers climb as `tell` closes on 1.
      for (const [i, pivot] of pincers.entries()) {
        pivot.rotation.x = 0.25 + enemy.tell * 1.35;
        pivot.rotation.y = (i === 0 ? -1 : 1) * (0.4 + enemy.tell * 0.5);
      }

      const swing = walking ? 0.5 : 0.08;
      legs.forEach((leg) => {
        // Fanned pairs ripple a beat behind the one ahead (the crustacean
        // gait); corner quads alternate like the old four-footer.
        const phase = enemy.stridePhase * 2 + leg.userData.rip;
        leg.rotation.x = Math.sin(phase) * swing * (walking ? 1 : 0.25);
      });

      // --- recoil: squash, so a punch that connects is felt ------------------
      const squash = 1 - enemy.recoil * 0.12;
      body.scale.set(1 + enemy.recoil * 0.08, squash, 1 + enemy.recoil * 0.08);

      // --- hit-flash --------------------------------------------------------
      flash += ((enemy.hitFlash > 0 ? 1 : 0) - flash) * ease;
      for (const material of flashMaterials) {
        // Each material lerps from its stored base colour toward white, so a
        // flash never accumulates (and a textured part flashes around its map).
        if (!material.userData.baseColor) material.userData.baseColor = material.color.clone();
        scratchColor.copy(material.userData.baseColor).lerp(whiteColor, flash * 0.75);
        material.color.copy(scratchColor);
      }

      // --- the ring and the mark --------------------------------------------
      const telling = enemy.tell > 0.02;
      ring.visible = telling;
      if (telling) {
        const grow = 0.55 + enemy.tell * 0.75;
        ring.scale.set(grow * ringBase, 1, grow * ringBase);
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
      for (const textureItem of textureCache.values()) textureItem.dispose();
      group.clear();
    },
    /** What the rig is made of (the scene tests read this). */
    stats: () => ({
      legs: legs.length,
      spines: spines.length,
      ringBase,
      bodyWidth,
      bodyDepth,
      bodyTop,
      segmented,
      segments: segments.length,
      pincers: pincers.length,
      /** metres of shell behind the head — the owner's "a LOT longer" measure. */
      chainLength: segments.length > 0 ? segments[segments.length - 1].position.z + bodyDepth / 2 : 0,
      textured: materials.filter((m) => m.map).length,
    }),
  };
}
