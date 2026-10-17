/**
 * NPC body rendering: blocky, pixelated figures in the repo's existing
 * pixel-art style (ROADMAP M3, WP-3.4).
 *
 * Same rules as the player view (player-view.js) — Minecraft-tier, no
 * skeletons, no IK, no lip sync, no voices (§7 refuses all four). An NPC
 * is an idle figure: it stands where placed and bobs gently, which is what
 * the roadmap allows ("no animation beyond an idle bob"). The player's walk
 * cycle is intentionally not reused here — NPCs don't walk; they stand and
 * talk.
 *
 * Art is data (src/core/pixel-art.js), generated at load so no image files
 * are shipped (§9: original assets only). Each NPC carries its own palette
 * from the JSON dialogue file, which is how two figures look like different
 * people without new geometry.
 */

import * as THREE from 'three';
import { characterSkin, isTexture } from '../core/pixel-art.js';

const NPC = Object.freeze({
  legHeight: 0.72,
  legWidth: 0.2,
  legDepth: 0.22,
  bootHeight: 0.13,
  torsoHeight: 0.58,
  torsoWidth: 0.46,
  torsoDepth: 0.28,
  armWidth: 0.15,
  armHeight: 0.5,
  armDepth: 0.17,
  armGap: 0.305,
  handHeight: 0.13,
  headSize: 0.4,
  /** How tall the nameplate floats above the head, in metres. */
  nameplateHeight: 0.55,
  /** Idle bob amplitude and rate (m, Hz). */
  bobAmplitude: 0.035,
  bobRate: 1.6,
  /** Arms hang slightly out from the body. */
  restArmAngle: 0.08,
});

/** Build one DataTexture from a pixel-art result, cached by name. */
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

/**
 * Build a nameplate sprite. A canvas texture with the NPC's name, billboarded
 * so it always faces the camera. Cheap enough that one per NPC is fine (≤2
 * NPCs per map, per ROADMAP), and it is what makes a figure readable as a
 * person you can talk to rather than another rock.
 *
 * In headless unit tests (Node, no DOM) this returns null so construction
 * does not throw; the scene-graph tests don't assert nameplates.
 */
function createNameplate(name) {
  const text = String(name ?? '');
  if (!text) return null;
  if (typeof document === 'undefined') return null;
  const { texture, aspect } = makeTextTexture(text, '#dfe7ec', '18px monospace');
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.userData.canvasAspect = aspect;
  sprite.name = 'npc-nameplate';
  return sprite;
}

function makeTextTexture(text, color, font) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const metrics = measure.measureText(text);
  const padding = 8;
  const width = Math.ceil(metrics.width) + padding * 2;
  const height = 28;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

/**
 * Build one NPC mesh from its entity data.
 *
 * The returned object owns its own geometry/material/texture cache and exposes
 * `sync()` to follow the sim (idle bob, nameplate facing the camera).
 */
export function createNpcView(entity) {
  // NPCs use the boy-shaped body (no long hair) but with their own palette
  // from the JSON. Short hair + custom clothes keeps each figure distinct
  // without inventing a second body rig.
  const skin = characterSkin({ variant: 'boy', palette: entity.palette ?? undefined });

  const group = new THREE.Group();
  group.name = entity.id;
  group.userData.entityId = entity.id;
  group.userData.kind = 'npc';

  const geometries = [];
  const materials = [];
  const textures = new Map();

  const materialFor = (art) => {
    const made = new THREE.MeshLambertMaterial({ map: toTexture(art, textures) });
    materials.push(made);
    return made;
  };

  /** A box hanging down from its own origin (same convention as player-view). */
  const box = (width, height, depth, faces, name = '') => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, -height / 2, 0);
    geometries.push(geometry);
    const mesh = isTexture(faces)
      ? new THREE.Mesh(geometry, materialFor(faces))
      : new THREE.Mesh(geometry, [
          materialFor(faces.right),
          materialFor(faces.left),
          materialFor(faces.top),
          materialFor(faces.bottom),
          materialFor(faces.back),
          materialFor(faces.front),
        ]);
    mesh.name = name;
    return mesh;
  };

  // Same ten-box shape the player uses, but posed standing (no walk cycle).
  const hipY = NPC.legHeight;
  const torsoTop = hipY + NPC.torsoHeight;
  const shoulderY = torsoTop - 0.04;

  const leftLeg = box(NPC.legWidth, NPC.legHeight, NPC.legDepth, skin.leg, 'npc-left-leg');
  const rightLeg = box(NPC.legWidth, NPC.legHeight, NPC.legDepth, skin.leg, 'npc-right-leg');
  for (const [leg, side] of [
    [leftLeg, -1],
    [rightLeg, 1],
  ]) {
    leg.position.x = side * 0.115;
    leg.position.y = hipY;
    const boot = box(NPC.legWidth * 1.14, NPC.bootHeight, NPC.legDepth * 1.35, skin.boot, 'npc-boot');
    boot.position.set(0, -NPC.legHeight + NPC.bootHeight, 0);
    leg.add(boot);
  }

  const leftArm = box(NPC.armWidth, NPC.armHeight, NPC.armDepth, skin.arm, 'npc-left-arm');
  const rightArm = box(NPC.armWidth, NPC.armHeight, NPC.armDepth, skin.arm, 'npc-right-arm');
  for (const [arm, side] of [
    [leftArm, -1],
    [rightArm, 1],
  ]) {
    arm.position.x = side * NPC.armGap;
    arm.position.y = shoulderY;
    arm.rotation.x = NPC.restArmAngle;
    const hand = box(NPC.armWidth * 0.95, NPC.handHeight, NPC.armDepth * 0.95, skin.hand, 'npc-hand');
    hand.position.set(0, -NPC.armHeight, 0);
    arm.add(hand);
  }

  const torso = box(
    NPC.torsoWidth,
    NPC.torsoHeight,
    NPC.torsoDepth,
    {
      right: skin.torso.side,
      left: skin.torso.side,
      top: skin.torso.top,
      bottom: skin.torso.bottom,
      back: skin.torso.back,
      front: skin.torso.front,
    },
    'npc-torso',
  );
  torso.position.y = torsoTop;

  const head = box(
    NPC.headSize,
    NPC.headSize,
    NPC.headSize,
    {
      right: skin.head.right,
      left: skin.head.left,
      top: skin.head.top,
      bottom: skin.head.bottom,
      back: skin.head.back,
      front: skin.head.front,
    },
    'npc-head',
  );
  head.position.y = torsoTop + NPC.headSize;

  group.add(leftLeg, rightLeg, leftArm, rightArm, torso, head);

  // Nameplate floats above the head, billboards to the camera each frame.
  const nameplate = createNameplate(entity.name);
  if (nameplate) {
    const worldHeight = 1.0;
    const aspect = nameplate.userData.canvasAspect ?? 4;
    nameplate.scale.set(worldHeight * aspect, worldHeight, 1);
    nameplate.position.y = torsoTop + NPC.headSize + NPC.nameplateHeight;
    nameplate.renderOrder = 999;
    group.add(nameplate);
  }

  // Start at the entity's authored position and facing.
  group.position.set(entity.position.x, entity.position.y, entity.position.z);
  group.rotation.y = entity.rotationY ?? 0;

  return {
    group,
    entityId: entity.id,
    nameplate,
    /**
     * Follow the sim. `dt` is frame time, so the idle bob eases the same on
     * any device. A THREE.Sprite (the nameplate) auto-billboards in both
     * perspective and orthographic projections, so no manual quaternion is
     * needed.
     */
    sync(entityState, _cameraState, simTime, dt = 1 / 60) {
      group.position.set(entityState.position.x, entityState.position.y, entityState.position.z);
      group.rotation.y = entityState.rotationY ?? 0;
      // Idle bob on the sim clock — deterministic, same bob on replay.
      const bob = Math.sin(simTime * NPC.bobRate * Math.PI * 2) * NPC.bobAmplitude;
      group.position.y = entityState.position.y + bob;
    },
    setNameplateVisible(visible) {
      if (nameplate) nameplate.visible = visible;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const item of materials) item.dispose();
      for (const texture of textures.values()) texture.dispose();
      if (nameplate) {
        nameplate.material.map?.dispose();
        nameplate.material.dispose();
      }
      group.clear();
    },
  };
}

/**
 * Pick the nearest NPC entity within its interaction radius. Returns null if
 * nothing is in range. Pure math, no DOM, no three.js — used by the dialog
 * prompt logic.
 */
export function nearestInteractableNpc(state) {
  const px = state.player.position.x;
  const pz = state.player.position.z;
  let best = null;
  let bestDistance = Infinity;
  for (const entity of state.entities) {
    if (entity.kind !== 'npc') continue;
    const radius = entity.interactRadius ?? 3.0;
    const dx = entity.position.x - px;
    const dz = entity.position.z - pz;
    const distance = Math.hypot(dx, dz);
    if (distance <= radius && distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}
