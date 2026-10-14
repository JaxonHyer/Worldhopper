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

/** Allowed values for cognitiveSkin fields (see AGENT_PROMPT.md §4). */
export const SKIN_FORMS = Object.freeze({
  objectForm: ['unassigned', 'glass-beads', 'misty-figures', 'painted-still'],
  livingForm: ['unassigned', 'flame', 'glow'],
  waterForm: ['unassigned', 'solid-obsidian', 'solid-dark-stone', 'liquid'],
  landForm: ['unassigned', 'bead-sea', 'misty-fluid', 'solid'],
  lightSource: ['unassigned', 'black-sky-frail-white-sun', 'drifting-mist-light'],
});

/** cognitiveSkin.objectForm === 'glass-beads' requires this system (canon anchor). */
export const BEAD_SYSTEM = 'rosharan';

const blankBasin = {
  id: 'blank-basin',
  label: 'M0 Test Range',
  /** Not a canon world — a construction site. */
  status: 'placeholder',
  system: 'unassigned',
  defaultSeed: 20261014,
  /** Brief description shown in the debug overlay / credits. */
  blurb: 'A foggy basin built to test palette, fog and the harness. No canon attached.',

  ground: {
    /** metres, square. Kept far inside the scale fence (§5). */
    size: 2400,
    segments: 96,
    /** gentle rolling, ±amplitude metres */
    amplitude: 2.6,
    frequency: 0.0035,
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

  /** Seeded low-poly scatter — the only entities this map has in M0. */
  propPolicy: {
    kind: 'rock',
    count: 34,
    innerRadius: 16,
    outerRadius: 300,
    minScale: 0.7,
    maxScale: 3.6,
    /** keep the landmark's base clear so its silhouette stays readable */
    landmarkClearance: 120,
  },

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
      sky: { horizon: '#a7aeb0', zenith: '#232d38', haze: '#8c9296' },
      fog: { color: '#a7aeb0', density: 0.0021 },
      ground: { low: '#626d6a', high: '#7d8480', accent: '#4d5754' },
      props: { rock: '#4b5452', landmark: '#39434f' },
      sun: { color: '#fff0d2', direction: { x: 0.30, y: 0.58, z: -0.79 }, discSize: 0.9996 },
    },
    {
      id: 'mist-sea',
      label: 'B · Mist sea',
      summary: 'Bluer, denser, closer horizon — the world ends sooner.',
      sky: { horizon: '#8fa3b3', zenith: '#151d29', haze: '#7b8a97' },
      fog: { color: '#8fa3b3', density: 0.0034 },
      ground: { low: '#525c61', high: '#6b787f', accent: '#445055' },
      props: { rock: '#3f4a54', landmark: '#2c3a4b' },
      sun: { color: '#e8f0ff', direction: { x: 0.26, y: 0.50, z: -0.82 }, discSize: 0.9996 },
    },
    {
      id: 'cold-ridge',
      label: 'C · Cold ridge',
      summary: 'Clearest of the three: the needle reads hard against a dark sky.',
      sky: { horizon: '#c3cfd6', zenith: '#0d1420', haze: '#9fb0bb' },
      fog: { color: '#c3cfd6', density: 0.0011 },
      ground: { low: '#656f75', high: '#8b97a3', accent: '#525c63' },
      props: { rock: '#4e5b66', landmark: '#243040' },
      sun: { color: '#ffffff', direction: { x: 0.38, y: 0.46, z: -0.80 }, discSize: 0.9996 },
    },
  ],
};

export const MAPS = Object.freeze({ [blankBasin.id]: blankBasin });

export const DEFAULT_MAP_ID = blankBasin.id;

export function getMap(id) {
  const map = MAPS[id];
  if (!map) throw new Error(`unknown map id: ${id}`);
  return map;
}

export function listMapIds() {
  return Object.keys(MAPS);
}

export function listVariants(mapId) {
  return getMap(mapId).variants.map((v) => v.id);
}

export function getVariant(mapId, variantId) {
  const map = getMap(mapId);
  return map.variants.find((v) => v.id === variantId) ?? map.variants[0];
}
