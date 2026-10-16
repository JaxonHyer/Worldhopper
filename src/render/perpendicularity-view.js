/**
 * The Perpendicularity, drawn.
 *
 * The pool lies *on* the terrain rather than floating over it: its mesh is a
 * radial grid whose vertices sample `terrainHeight`, so it follows a slope the
 * way a pool of liquid would and never z-fights the ground it is part of (the
 * faces sit 3 cm proud of the surface — the M0 fence's "no coplanar surfaces").
 *
 * Three cheap pieces, no textures, no shaders of our own:
 *   - a dark shore slightly wider than the pool, so its edge reads on any ground;
 *   - the pool itself, an unlit surface with a slow pulse (it is the one thing
 *     on the map that is lit from inside);
 *   - a faint column of light, `AdditiveBlending`, so the gate can be found
 *     through fog — the pool is a place, and a place you cannot find is not a
 *     place.
 */

import * as THREE from 'three';
import { terrainHeight } from '../core/world-state.js';

/** Metres the geometry sits above the sampled terrain. */
const LIFT = 0.03;
const SHORE_WIDTH = 0.7;
const SEGMENTS = 40;
const RINGS = 5;
/** how far the light column reaches (m) and how faint it is */
const COLUMN_HEIGHT = 26;
const COLUMN_OPACITY = 0.07;
/** the pool's pulse, in cycles per second */
const PULSE_HZ = 0.16;

/**
 * A disc that conforms to the terrain: rings of vertices, all sampled from the
 * height field, triangulated as a fan-free ring mesh.
 */
function conformingDisc({ map, seed, radius, innerRadius = 0, lift = LIFT, center }) {
  const positions = [];
  const indices = [];
  const ringCount = RINGS + 1;
  for (let ring = 0; ring < ringCount; ring++) {
    const t = ring / (ringCount - 1);
    const r = innerRadius + (radius - innerRadius) * t;
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * r;
      const z = center.z + Math.sin(angle) * r;
      positions.push(x, terrainHeight(map, seed, x, z) + lift, z);
    }
  }
  for (let ring = 0; ring < ringCount - 1; ring++) {
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const next = (segment + 1) % SEGMENTS;
      const a = ring * SEGMENTS + segment;
      const b = ring * SEGMENTS + next;
      const c = (ring + 1) * SEGMENTS + segment;
      const d = (ring + 1) * SEGMENTS + next;
      // Wound so the faces point *up*. The rings run counter-clockwise in the
      // XZ plane seen from above, so the upward-facing triangle is
      // (inner, next, outer) — the other winding draws a pool you cannot see
      // from the shore (front faces culled, and the normals flip with them).
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPerpendicularityView({ map, seed, variant, skin = null }) {
  const gate = map.perpendicularity;
  const group = new THREE.Group();
  group.name = 'perpendicularity';
  if (!gate) {
    return {
      group,
      sync() {},
      setVariant() {},
      stats: () => ({ meshes: 0, radius: 0, visible: false }),
      dispose() {},
    };
  }
  const center = { x: gate.position.x, z: gate.position.z };
  const radius = Math.max(0.6, gate.radius);
  const colors = variant.perpendicularity ?? { pool: '#9fded6', glow: '#e6fbf7' };
  const palette = skin?.palette ?? { obsidian: '#05070a', obsidianHighlight: '#8fb6d8' };
  // The physical colours are kept, so leaving the realm restores the pool
  // exactly — the shift is a lens, not a one-way change.
  const physicalPool = new THREE.Color(colors.pool);
  /** The shore's physical colour, so a variant swap and a realm swap agree. */
  const shoreColor = () => shore.material.color.copy(physicalPool).multiplyScalar(0.34);

  const shoreGeometry = conformingDisc({ map, seed, radius: radius + SHORE_WIDTH, center, lift: LIFT * 0.5 });
  const shore = new THREE.Mesh(
    shoreGeometry,
    new THREE.MeshLambertMaterial({ color: new THREE.Color(colors.pool).multiplyScalar(0.34), flatShading: true }),
  );

  const poolGeometry = conformingDisc({ map, seed, radius, center });
  const poolMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.pool),
    transparent: true,
    opacity: 0.9,
    // Unlit on purpose: the pool is the one surface that does not need the sun.
  });
  const pool = new THREE.Mesh(poolGeometry, poolMaterial);

  /**
   * The same water, in the other realm.
   *
   * Canon: bodies of water invert to solid stone — obsidian on Roshar, dark
   * smoky stone on Scadrial. So the pool does not disappear when the realm
   * shifts; it *inverts*, and the gate's light (which canon says appears as a
   * glowing light in the subastral) stays to mark the place. Built once, swapped
   * on the shift: a realm change allocates nothing.
   */
  const obsidianMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color(palette.obsidian),
    // Obsidian is glass, but this is a *diagram*: a broad specular turns the
    // whole disc into a milky smear under the frails sun's near-vertical light
    // (seen in the first screenshots). A dim, tight highlight on flat facets
    // reads as polished black stone instead — facets you can count, which is
    // also the visual language the rest of the world is in.
    specular: new THREE.Color(palette.obsidianHighlight).multiplyScalar(0.35),
    shininess: 22,
    flatShading: true,
  });

  const columnGeometry = new THREE.CylinderGeometry(radius * 0.62, radius * 0.94, COLUMN_HEIGHT, SEGMENTS, 1, true);
  const columnMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.glow),
    transparent: true,
    opacity: COLUMN_OPACITY,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const column = new THREE.Mesh(columnGeometry, columnMaterial);
  column.position.set(
    center.x,
    terrainHeight(map, seed, center.x, center.z) + COLUMN_HEIGHT / 2 + LIFT,
    center.z,
  );

  // Named, because a test that checks the water is *visible from the shore*
  // has to be able to point at the right mesh.
  shore.name = 'perpendicularity-shore';
  pool.name = 'perpendicularity-pool';
  column.name = 'perpendicularity-column';

  group.add(shore, pool, column);

  const materials = [shore.material, poolMaterial, obsidianMaterial, columnMaterial];
  const geometries = [shoreGeometry, poolGeometry, columnGeometry];
  let pulseTime = 0;
  // Which material the pulse drives: the pool's own, or the inverted one.
  let pulseMaterial = poolMaterial;
  let inverted = false;
  const physicalGlow = new THREE.Color(colors.glow);

  return {
    group,
    /**
     * `time` is the *sim* clock, not wall clock: the pool's pulse is part of the
     * world's deterministic furniture, so a recorded run looks the same twice.
     */
    sync(time = 0) {
      pulseTime = Number.isFinite(time) ? time : pulseTime;
      const wave = Math.sin(pulseTime * Math.PI * 2 * PULSE_HZ);
      if (pulseMaterial === poolMaterial) poolMaterial.opacity = 0.82 + wave * 0.08;
      columnMaterial.opacity = (inverted ? COLUMN_OPACITY * 1.6 : COLUMN_OPACITY) + wave * 0.02;
      // The column turns slowly, so a still frame of it is never the same two
      // frames running — and it costs one number per frame.
      column.rotation.y = pulseTime * 0.03;
    },
    setVariant(next) {
      const nextColors = next.perpendicularity ?? colors;
      physicalPool.set(nextColors.pool);
      physicalGlow.set(nextColors.glow);
      if (!inverted) shore.material.color.set(nextColors.pool).multiplyScalar(0.34);
      if (!inverted) poolMaterial.color.copy(physicalPool);
      columnMaterial.color.copy(inverted ? new THREE.Color(palette.obsidianHighlight) : physicalGlow);
    },
    /**
     * Invert the water when the realm shifts, and put it back on the way home.
     *
     * @param {'physical'|'cognitive'} realm
     * @param {object|null} activeSkin resolved skin, when one is drawing
     */
    setRealm(realm, activeSkin = null) {
      const wanted = realm === 'cognitive' && activeSkin?.waterForm === 'solid-obsidian';
      if (wanted === inverted) return inverted;
      inverted = wanted;
      if (inverted) {
        pool.material = obsidianMaterial;
        pulseMaterial = obsidianMaterial;
        columnMaterial.color.set(palette.obsidianHighlight);
        // The shore is the water's rim: leaving it pale would ring the obsidian
        // in the physical palette's colour.
        shore.material.color.set(palette.obsidian).multiplyScalar(2.2);
      } else {
        pool.material = poolMaterial;
        pulseMaterial = poolMaterial;
        poolMaterial.color.copy(physicalPool);
        columnMaterial.color.copy(physicalGlow);
        shoreColor();
      }
      return inverted;
    },
    stats() {
      return { meshes: group.children.length, radius, visible: group.visible, gateId: gate.id, water: inverted ? 'solid-obsidian' : 'liquid' };
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
