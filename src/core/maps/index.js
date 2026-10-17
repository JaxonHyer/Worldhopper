import { roshar } from '../../worlds/roshar/index.js';

/**
 * Map registry — world data, no rendering code.
 *
 * Every map declares its own pocket-scale coordinates, its palette variants
 * and its `cognitiveSkin`. `cognitiveSkin` is *per-world data* and is never
 * inferred globally (AGENT_PROMPT.md §4): Roshar-style glass beads exist
 * only over the Rosharan system, so a map that is not in that system must
 * not ask for them (enforced by tests/unit/maps.test.js).
 *
 * M0 ships ONE map: a deliberately non-canonical test range used to build the
 * renderer, the fog/palette pipeline and the harness. The first authored
 * world replaces it in a later milestone; nothing here invents canon.
 */

// The skin vocabulary and the canon guard live in core/skin.js — one definition,
// re-exported here because a map's data is read next to the map registry.
export { SKIN_FORMS, BEAD_SYSTEM } from '../skin.js';

const blankBasin = {
  id: 'blank-basin',
  label: 'M0 Test Range',
  /** Not a canon world — a construction site. */
  status: 'placeholder',
  system: 'unassigned',
  defaultSeed: 20261014,
  /** Brief description shown in the debug overlay / credits. */
  blurb: 'A foggy basin built to test palette, fog and the harness. No canon attached.',
  /**
   * Which of this map's own palettes it opens on.
   *
   * A palette name is per-world data — "cold-ridge" means nothing on Roshar —
   * so the default belongs to the map rather than to the settings table. This is
   * the owner's pick from the three the basin shipped with, kept exactly.
   */
  defaultPalette: 'cold-ridge',

  ground: {
    /** metres, square. Kept far inside the scale fence (§5). */
    size: 1600,
    segments: 144,
    /** gentle rolling, ±amplitude metres */
    amplitude: 7,
    frequency: 0.006,
    octaves: 3,
    flatRadius: 12,
  },

  /** One landmark silhouette = the map's identity (AGENT_PROMPT.md §6). */
  landmarks: [
    {
      id: 'spire-01',
      kind: 'spire',
      label: 'the Grey Needle',
      position: { x: 0, y: 0, z: -430 },
      height: 150,
      baseRadius: 78,
      shards: 6,
      spread: 46,
    },
  ],

  /**
   * The Perpendicularity (M2): a pool where the two realms meet, a short walk
   * from where the player lands. Canon has these as gates between realms and
   * between worlds, so the realm shift is something you *walk into* rather than
   * a key press — the owner's instruction of 2026-10-15.
   *
   * `open` is the flag M4 turns into a puzzle ("find it, then open it"); M2
   * always opens it, but the gate already checks the flag so nothing has to be
   * rewritten to close it later.
   */
  perpendicularity: {
    id: 'perpendicularity-01',
    label: 'Perpendicularity',
    position: { x: 0, z: -14 },
    radius: 3.4,
    open: true,
  },

  /** Seeded low-poly scatter — the only entities this map has in M0. */
  propPolicy: {
    kind: 'rock',
    count: 34,
    innerRadius: 16,
    outerRadius: 280,
    minScale: 0.7,
    maxScale: 3.6,
    /** keep the landmark's base clear so its silhouette stays readable */
    landmarkClearance: 120,
    /** ...and keep the pool's shore clear, all the way to its approach */
    perpendicularityClearance: 11,
  },

  /**
   * Beacons (WP-3.1): where a death sends you, and where health comes back.
   *
   * The first in the list is where the player starts, so a fresh run always has
   * somewhere to come back to. They are checkpoints, not progression — nothing
   * here unlocks, and nothing is lost by dying except the walk.
   */
  beacons: [
    { id: 'beacon-basin-post', label: 'the Range Post', position: { x: 0, z: 0 } },
    { id: 'beacon-basin-marker', label: 'the Ridge Marker', position: { x: -26, z: 18 } },
  ],

  /**
   * The roaming spawn director's policy (WP-3.2).
   *
   * Enemies appear in a ring around the player rather than from authored spawn
   * points, so the world stays inhabited however far you walk; the numbers here
   * are the pocket, and the fairness contract's leash is what lets you leave.
   */
  enemyPolicy: {
    /** archetypes this world has. The warden cannot be fought, only avoided. */
    types: ['crag-lurker', 'storm-warden'],
    /** how often each appears: the unkillable one is the rarer of the two */
    weights: [3, 1],
    /** alive at load, so a player never lands in an empty world */
    initial: 3,
    /** the pocket's own ceiling; the owner's slider and a hard 6 sit above it */
    maxActive: 4,
    /** seconds between the director's attempts to top the population up */
    spawnInterval: 8,
    /** metres from the player: far enough that nothing appears on top of you */
    spawnMin: 24,
    spawnMax: 40,
    /** metres: past this, an enemy you left behind stops existing */
    despawnRadius: 95,
    /** metres from its home: past this it gives up and walks back */
    leashRange: 46,
  },

  /**
   * Dialog NPCs (WP-3.4). One wanderer near the spawn — proves the framework
   * works on both maps. The test range is non-canon (status: placeholder),
   * so this figure is also a placeholder, not a lore claim.
   */
  npcs: [
    {
      id: 'npc-wanderer-01',
      npcId: 'basin-wanderer',
      position: { x: 4.5, z: -8 },
      // Facing slightly toward the pool so the player sees the figure on approach.
      rotationY: 0.2,
      interactRadius: 3.0,
    },
  ],

  /**
   * Declared per-world appearance of the Cognitive Realm. Rendering of this
   * arrives in a later milestone; M0 only *stores* it so the shape is frozen
   * early and tests can guard it.
   */
  cognitiveSkin: {
    system: 'unassigned',
    objectForm: 'unassigned',
    livingForm: 'unassigned',
    waterForm: 'unassigned',
    landForm: 'unassigned',
    light: { source: 'unassigned', dayNightCycle: false },
  },

  /**
   * Palette variants: identical geometry, different atmosphere. Exposed live
   * (tuning panel + ?palette=) so the owner can pick a taste call on real
   * hardware instead of from a description.
   */
  variants: [
    {
      id: 'ashen-basin',
      label: 'A · Ashen basin',
      summary: 'Warm grey haze, low contrast, pale sun above the ridge.',
      sky: { horizon: '#a7aeb0', zenith: '#232d38', haze: '#a7aeb0' },
      fog: { color: '#a7aeb0', density: 0.0028 },
      ground: { low: '#626d6a', high: '#7d8480', accent: '#4d5754' },
      props: { rock: '#4b5452', landmark: '#39434f' },
      // A luminous pool: the one *warm* light in this palette's grey world.
      perpendicularity: { pool: '#9fded6', glow: '#e6fbf7' },
      sun: { color: '#fff0d2', direction: { x: 0.72, y: 0.52, z: 0.46 }, discSize: 0.9996 },
    },
    {
      id: 'mist-sea',
      label: 'B · Mist sea',
      summary: 'Bluer, denser, closer horizon — the world ends sooner.',
      sky: { horizon: '#8fa3b3', zenith: '#151d29', haze: '#8fa3b3' },
      fog: { color: '#8fa3b3', density: 0.0040 },
      ground: { low: '#525c61', high: '#6b787f', accent: '#445055' },
      props: { rock: '#3f4a54', landmark: '#2c3a4b' },
      perpendicularity: { pool: '#8ad9e8', glow: '#d9f4fb' },
      sun: { color: '#e8f0ff', direction: { x: 0.64, y: 0.58, z: 0.50 }, discSize: 0.9996 },
    },
    {
      id: 'cold-ridge',
      label: 'C · Cold ridge',
      summary: 'Clearest of the three: the needle reads hard against a dark sky.',
      sky: { horizon: '#c3cfd6', zenith: '#0d1420', haze: '#c3cfd6' },
      fog: { color: '#c3cfd6', density: 0.0016 },
      ground: { low: '#656f75', high: '#8b97a3', accent: '#525c63' },
      props: { rock: '#4e5b66', landmark: '#243040' },
      perpendicularity: { pool: '#a4e4ea', glow: '#eefcfd' },
      sun: { color: '#ffffff', direction: { x: 0.80, y: 0.44, z: 0.41 }, discSize: 0.9996 },
    },
  ],
};

/**
 * Every world the game knows about. `blank-basin` stays the default while the
 * owner's pinned playtest config (`palette=cold-ridge` and friends) belongs to
 * it — Roshar is reachable with `?map=roshar` and becomes a candidate for the
 * default the moment the owner says so.
 */
export const MAPS = Object.freeze({ [blankBasin.id]: blankBasin, [roshar.id]: roshar });

/**
 * The world the game opens on.
 *
 * Roshar, since M2: it is the only map with a Cognitive Realm to look at
 * (the test range has no canon, so its subastral is empty by design), and a
 * player on a phone should not have to know a URL parameter to see the game's
 * own core verb. The test range is still `?map=blank-basin`.
 *
 * Flipping this back is one line. The feel numbers the owner tuned are
 * map-agnostic and unchanged; the palette default follows the map
 * (`defaultPalette`), because a palette name only means something on the world
 * that invented it.
 */
export const DEFAULT_MAP_ID = roshar.id;

export function getMap(id) {
  const map = MAPS[id];
  if (!map) throw new Error(`unknown map id: ${id}`);
  return map;
}

export function listMapIds() {
  return Object.keys(MAPS);
}

/** Is this a map id the game can load? Used by the `?map=` flag. */
export function hasMap(id) {
  return Object.prototype.hasOwnProperty.call(MAPS, id);
}

export function listVariants(mapId) {
  return getMap(mapId).variants.map((v) => v.id);
}

export function getVariant(mapId, variantId) {
  const map = getMap(mapId);
  return map.variants.find((v) => v.id === variantId) ?? map.variants[0];
}
