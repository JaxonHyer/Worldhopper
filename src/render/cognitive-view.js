/**
 * The Cognitive manifestation — beads, flames, souls.
 *
 * This is the rendering half of `cognitiveSkin`: the lens (camera) and the world
 * state are already shared, and this module draws *what the world looks like
 * from inside the other realm*, from per-world data. Roshar's skin is the one
 * authored; a map with no authored skin draws nothing and the realm stays the
 * plain lens it was in M2 slice 1.
 *
 * Three rules it keeps:
 *
 *  - **Nothing here is state.** Beads are where the terrain is; a soul is where
 *    its object is; the flame is where the player is. The sim never learns that
 *    this file exists, so a realm shift cannot change a position, an entity or a
 *    collision — it changes *what the same thing looks like*.
 *  - **One source of variation: the world position.** A bead's size comes from a
 *    hash of its lattice cell, so it does not grow when the camera moves.
 *  - **The pulse is on the sim clock**, like the Perpendicularity's — a recorded
 *    run has to look the same twice.
 */

import * as THREE from 'three';
import { beadVariation, resolveCognitiveSkin } from '../core/skin.js';
import { terrainHeight } from '../core/world-state.js';
import { FAIRNESS } from '../core/enemy.js';

/** Metres between bead centres, tuned so neighbours touch without merging. */
const SEA_SPACING = 1.35;
/** Metres of bead sea carried around the player, in every direction. */
const SEA_RADIUS = 46;
const BEAD_MIN_RADIUS = 0.5;
const BEAD_MAX_RADIUS = 0.9;
/**
 * The window has to end somewhere, and a straight line of beads stopping in the
 * dark reads as a bug rather than as a horizon. Past this fraction of the
 * radius, a bead survives only if its own hash says so: a dithered edge, and a
 * function of the bead rather than of the frame, so it does not crawl.
 *
 * The band is deliberately outside the visible frame at the default lens span
 * (46 m), so the fade is only ever seen by someone zoomed right out.
 */
const SEA_FADE_FROM = 0.78;
/** A soul-bead is the cognitive aspect of an object, not a second object. */
const SOUL_MAX_RADIUS = 4.2;
/**
 * Eight faces, not twenty: at the lens's default span a bead is about 1.5% of
 * the screen height, and a sea of five thousand of them is 40k triangles
 * instead of 100k. The silhouette still reads as faceted glass.
 */
const BEAD_DETAIL = 0;
/** Enemies and NPCs will be living too; for now the only living thing is you. */
const FLAME_HEIGHT = 1.35;

export function createCognitiveView({ map, state, variant, settings }) {
  const skin = resolveCognitiveSkin(map);
  const group = new THREE.Group();
  group.name = 'cognitive-skin';
  // Hidden until a sync says the realm is cognitive: this group is *the other
  // realm's furniture*, and a physical frame must not draw it — not even the
  // first one, and not even for a map that has no skin at all.
  group.visible = false;

  if (!skin.authored) {
    return {
      group,
      skin,
      /** No authored look: nothing to draw, nothing to hide. */
      sync: () => false,
      setVariant: () => {},
      stats: () => ({
        authored: false,
        skin: skin.id,
        objectForm: skin.objectForm,
        beads: 0,
        souls: 0,
        flame: false,
        npcFlames: 0,
        enemyFlames: 0,
        violations: skin.violations.length,
      }),
      dispose: () => {},
    };
  }

  const seed = state.seed;
  const palette = skin.palette;

  // --- the bead sea: the land itself ---------------------------------------
  const side = Math.ceil(SEA_RADIUS / SEA_SPACING) * 2 + 1;
  const beadCount = side * side;
  const beadGeometry = new THREE.OctahedronGeometry(1, BEAD_DETAIL);
  const beadMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color(palette.bead),
    specular: new THREE.Color(palette.beadHighlight),
    shininess: 44,
    flatShading: true,
  });
  const sea = new THREE.InstancedMesh(beadGeometry, beadMaterial, beadCount);
  sea.name = 'bead-sea';
  sea.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // The sea follows the player, so its bounding box is meaningless to three.
  sea.frustumCulled = false;
  group.add(sea);

  // Scratch objects: the layout runs whenever the player crosses a lattice
  // cell, and it must not allocate then (or ever).
  const dummy = new THREE.Object3D();
  let anchorX = Number.NaN;
  let anchorZ = Number.NaN;
  let laid = 0;
  let dropped = 0;
  const gate = map.perpendicularity ?? null;
  /** The gate keeps its water: a bead sea with beads sitting on the pool is not a gate. */
  const gateClearance = gate ? gate.radius + 1.1 : 0;

  /** Lay the sea down on the terrain, in a window around (cx, cz). */
  function drop(instance) {
    // Scale zero rather than a shorter mesh: the instance buffer is fixed, so a
    // dropped bead is one slot that costs nothing to draw.
    dummy.position.set(0, -1000, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    sea.setMatrixAt(instance, dummy.matrix);
  }

  function laySea(cx, cz) {
    anchorX = Math.floor(cx / SEA_SPACING) * SEA_SPACING;
    anchorZ = Math.floor(cz / SEA_SPACING) * SEA_SPACING;
    let i = 0;
    laid = 0;
    dropped = 0;
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const baseX = anchorX + (col - (side - 1) / 2) * SEA_SPACING;
        const baseZ = anchorZ + (row - (side - 1) / 2) * SEA_SPACING;
        const cellX = Math.round(baseX / SEA_SPACING);
        const cellZ = Math.round(baseZ / SEA_SPACING);
        const v = beadVariation(cellX, cellZ, seed, { min: BEAD_MIN_RADIUS, max: BEAD_MAX_RADIUS });
        const x = baseX + v.offsetX;
        const z = baseZ + v.offsetZ;

        // A bead only exists where the sea is: not in the gate's pool, and not
        // past the dithered edge of the window.
        const inGate = gate ? Math.hypot(x - gate.position.x, z - gate.position.z) < gateClearance : false;
        const fromAnchor = Math.hypot(x - cx, z - cz);
        const cut = inGate || (fromAnchor > SEA_RADIUS * SEA_FADE_FROM && v.exit < (fromAnchor - SEA_RADIUS * SEA_FADE_FROM) / (SEA_RADIUS * (1 - SEA_FADE_FROM)));
        if (cut) {
          drop(i++);
          dropped++;
          continue;
        }
        // Seated *in* the ground rather than on it: a sea, not a layer of marbles.
        const y = terrainHeight(map, seed, x, z) + v.radius * 0.52;
        dummy.position.set(x, y, z);
        dummy.rotation.set(v.spin * 0.35, v.spin, v.spin * 0.2);
        dummy.scale.setScalar(v.radius);
        dummy.updateMatrix();
        sea.setMatrixAt(i++, dummy.matrix);
        laid++;
      }
    }
    sea.instanceMatrix.needsUpdate = true;
  }

  // --- souls: every non-living object is a bead. NPCs are living (they have
  //     dialogue and a body), so their souls are flames, not beads — same as
  //     the player. Rocks and landmarks are non-living and become beads.
  const soulEntities = state.entities.filter((entity) => entity.kind !== 'player' && entity.kind !== 'npc');
  // NPCs get a flame each (≤2 per map, per ROADMAP, so this is cheap).
  const npcEntities = state.entities.filter((entity) => entity.kind === 'npc');
  const soulGeometry = new THREE.IcosahedronGeometry(1, 1);
  const soulMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color(palette.soul),
    specular: new THREE.Color(palette.beadHighlight),
    shininess: 70,
    flatShading: true,
  });
  const souls = new THREE.InstancedMesh(soulGeometry, soulMaterial, Math.max(1, soulEntities.length));
  souls.name = 'object-souls';
  group.add(souls);

  function soulRadius(entity) {
    if (entity.kind === 'landmark') {
      // The landmark's soul is one big bead, but the needle is 84 m wide: left
      // literal it would be a wall. Clamped to something a lens can hold.
      return THREE.MathUtils.clamp((entity.baseRadius ?? 40) * 0.3, 2.5, 10);
    }
    // An object's cognitive aspect is a bead; it must not out-scale the sea it
    // sits in, or it stops reading as the same world seen from elsewhere.
    return Math.min(SOUL_MAX_RADIUS, 1.5 * Math.max(entity.scale?.x ?? 1, entity.scale?.z ?? 1));
  }

  function laySouls() {
    soulEntities.forEach((entity, i) => {
      const radius = soulRadius(entity);
      dummy.position.set(entity.position.x, entity.position.y + radius * 0.65, entity.position.z);
      dummy.rotation.set(0.4 + i * 0.2, i * 0.7, 0.2);
      dummy.scale.setScalar(radius);
      dummy.updateMatrix();
      souls.setMatrixAt(i, dummy.matrix);
    });
    souls.instanceMatrix.needsUpdate = true;
  }

  // --- the flame: the only living thing on this patch is the player --------
  const flame = new THREE.Group();
  flame.name = 'cognitive-flame';
  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, FLAME_HEIGHT, 7, 1),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.flame),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  flameOuter.position.y = FLAME_HEIGHT * 0.5;
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.19, FLAME_HEIGHT * 0.62, 6, 1),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.flameCore),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  flameCore.position.y = FLAME_HEIGHT * 0.34;
  flame.add(flameOuter, flameCore);
  group.add(flame);

  // NPC flames: each gets its own pair of cones (same size and flicker as the
  // player's — a living thing is a flame in Shadesmar, regardless of who it
  // is). Kept as an array rather than an instanced mesh because the budget is
  // ≤2 NPCs per map (ROADMAP), and the array is easier to flicker per-instance.
  const npcFlames = npcEntities.map((npc, i) => {
    const g = new THREE.Group();
    g.name = `npc-flame-${npc.id}`;
    const outer = new THREE.Mesh(flameOuter.geometry, flameOuter.material.clone());
    outer.position.y = FLAME_HEIGHT * 0.5;
    const core = new THREE.Mesh(flameCore.geometry, flameCore.material.clone());
    core.position.y = FLAME_HEIGHT * 0.34;
    g.add(outer, core);
    g.userData.index = i;
    group.add(g);
    return { group: g, outer, core };
  });

  /**
   * Enemy flames, as a fixed pool.
   *
   * Enemies come and go while you play, and an InstancedMesh cannot be resized
   * without rebuilding it, so this is a pool sized by the fairness contract's
   * hard cap on live enemies: a slot is either an enemy or nothing. Nothing is
   * allocated during play.
   */
  const enemyFlames = [];
  for (let i = 0; i < FAIRNESS.maxActive; i++) {
    const g = new THREE.Group();
    g.name = `enemy-flame-${i}`;
    g.visible = false;
    const outer = new THREE.Mesh(flameOuter.geometry, flameOuter.material.clone());
    outer.position.y = FLAME_HEIGHT * 0.5;
    const core = new THREE.Mesh(flameCore.geometry, flameCore.material.clone());
    core.position.y = FLAME_HEIGHT * 0.34;
    g.add(outer, core);
    group.add(g);
    enemyFlames.push({ group: g, outer, core });
  }
  let enemyFlamesDrawn = 0;

  let active = false;
  const anySoulMoves = soulEntities.some((entity) => entity.dynamic);
  const materials = [beadMaterial, soulMaterial, flameOuter.material, flameCore.material];
  const geometries = [beadGeometry, soulGeometry, flameOuter.geometry, flameCore.geometry];

  // The first layout happens on the first sync, when there is a player to
  // centre it on.
  laySouls();

  return {
    group,
    skin,
    /**
     * Follow the realm and the player.
     *
     * @returns {boolean} whether the cognitive look is on screen now — the one
     * answer the world view needs to hide the physical furniture.
     */
    sync(currentState) {
      const wanted = currentState.realm === 'cognitive';
      if (wanted !== active) {
        active = wanted;
        group.visible = active;
        if (active && Number.isNaN(anchorX)) laySea(currentState.player.position.x, currentState.player.position.z);
      }
      if (!active) return false;

      const { x, z } = currentState.player.position;
      // Re-lay only on a lattice crossing: while walking this is ~4 times a
      // second, and between them the sea is static in world space.
      if (Math.abs(x - anchorX) > SEA_SPACING * 0.5 || Math.abs(z - anchorZ) > SEA_SPACING * 0.5) laySea(x, z);

      flame.position.set(x, currentState.player.position.y, z);
      // The flicker is the sim clock's, not the wall clock's.
      const t = currentState.simTime;
      const flicker = Math.sin(t * 9.1) * 0.06 + Math.sin(t * 21.7) * 0.03;
      flame.scale.set(1 + flicker, 1 - flicker * 1.4, 1 + flicker);
      flame.rotation.y = t * 0.6;
      flameCore.material.opacity = 0.72 + Math.sin(t * 13.3) * 0.12;

      // NPC flames: same flicker, offset by their index so they don't pulse in
      // lockstep with the player or each other.
      for (const npcFlame of npcFlames) {
        const npc = npcEntities[npcFlame.group.userData.index];
        if (!npc) continue;
        npcFlame.group.position.set(npc.position.x, npc.position.y, npc.position.z);
        const phase = t + npcFlame.group.userData.index * 1.3;
        const nf = Math.sin(phase * 8.7) * 0.05 + Math.sin(phase * 19.3) * 0.03;
        npcFlame.group.scale.set(1 + nf, 1 - nf * 1.3, 1 + nf);
        npcFlame.group.rotation.y = phase * 0.55;
        npcFlame.core.material.opacity = 0.7 + Math.sin(phase * 12.1) * 0.1;
      }

      // Enemy flames: same flicker, offset per slot so a pack does not pulse in
      // lockstep. A slot with no enemy behind it is hidden, not deleted.
      const liveEnemies = currentState.enemies ?? [];
      enemyFlamesDrawn = 0;
      for (let i = 0; i < enemyFlames.length; i++) {
        const slot = enemyFlames[i];
        const enemy = liveEnemies[i];
        if (!enemy) {
          slot.group.visible = false;
          continue;
        }
        slot.group.visible = true;
        enemyFlamesDrawn++;
        slot.group.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
        const phase = t + i * 1.7;
        const ef = Math.sin(phase * 8.3) * 0.05 + Math.sin(phase * 20.1) * 0.03;
        // A dying enemy's flame shrinks with it, so the realm agrees with the
        // physical one about whether the thing is still there.
        const scale = enemy.dying ? Math.max(0.05, enemy.deathTimer / 0.6) : 1;
        slot.group.scale.set((1 + ef) * scale, (1 - ef * 1.3) * scale, (1 + ef) * scale);
        slot.group.rotation.y = phase * 0.5;
        slot.core.material.opacity = 0.68 + Math.sin(phase * 11.7) * 0.1;
      }

      // Souls follow their objects. Every one is static on this map, so this
      // costs one boolean per frame — and it is the line that keeps a soul on
      // its object the day something in the entity list starts moving (M3).
      if (anySoulMoves) {
        for (let i = 0; i < soulEntities.length; i++) {
          const entity = soulEntities[i];
          const radius = soulRadius(entity);
          dummy.position.set(entity.position.x, entity.position.y + radius * 0.65, entity.position.z);
          dummy.rotation.set(0.4 + i * 0.2, i * 0.7, 0.2);
          dummy.scale.setScalar(radius);
          dummy.updateMatrix();
          souls.setMatrixAt(i, dummy.matrix);
        }
        souls.instanceMatrix.needsUpdate = true;
      }
      return true;
    },
    /**
     * A palette variant is the *physical* world's weather. The cognitive realm
     * is not weather — so the skin's own palette holds, and there is nothing to
     * do here. Kept as a method because world-view calls it on every change.
     */
    setVariant() {},
    stats() {
      return {
        authored: true,
        skin: skin.id,
        objectForm: skin.objectForm,
        livingForm: skin.livingForm,
        waterForm: skin.waterForm,
        landForm: skin.landForm,
        light: skin.light.source,
        beads: laid,
        seaDropped: dropped,
        seaSlots: beadCount,
        souls: soulEntities.length,
        flame: true,
        npcFlames: npcFlames.length,
        enemyFlames: enemyFlamesDrawn,
        violations: skin.violations.length,
      };
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const npcFlame of npcFlames) {
        npcFlame.outer.material.dispose();
        npcFlame.core.material.dispose();
      }
      for (const enemyFlame of enemyFlames) {
        enemyFlame.outer.material.dispose();
        enemyFlame.core.material.dispose();
      }
      group.clear();
    },
  };
}
