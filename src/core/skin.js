/**
 * `cognitiveSkin` — what the Cognitive Realm *is* on a given world.
 *
 * The realm is code written once: the lens, the fade, the gate. What you see
 * through it is per-world data, because canon says so (ROADMAP.md § Canon
 * anchors): Shadesmar is Roshar's subastral and it is made of glass beads, while
 * Scadrial's is mist and glowing metal. A single global "cognitive look" would
 * be a canon error the moment a second world exists.
 *
 * So this module owns three things and nothing else:
 *
 *  1. **The vocabulary** (`SKIN_FORMS`) — the form names a skin may use.
 *  2. **The canon guard** — the one rule the roadmap spells out in bold:
 *     *"Beads exist only over the Rosharan system. Never put beads on
 *     Scadrial."* A map whose `system` is not `rosharan` cannot ask for them,
 *     and if it does, this says so instead of drawing them.
 *  3. **Resolution** — turning a map's raw skin data into the single object the
 *     renderer reads, with every optional block filled in, so no renderer ever
 *     reaches into map data to guess a default.
 *
 * It is pure data work with no renderer and no state, which is what lets the
 * canon rule be tested in Node rather than judged in a screenshot.
 */

import { hash2 } from './noise.js';

/** Allowed values for cognitiveSkin fields (AGENT_PROMPT.md §4). */
export const SKIN_FORMS = Object.freeze({
  objectForm: ['unassigned', 'glass-beads', 'misty-figures', 'painted-still'],
  livingForm: ['unassigned', 'flame', 'glow'],
  waterForm: ['unassigned', 'solid-obsidian', 'solid-dark-stone', 'liquid'],
  landForm: ['unassigned', 'bead-sea', 'misty-fluid', 'solid'],
  lightSource: ['unassigned', 'black-sky-frail-white-sun', 'drifting-mist-light'],
});

/** cognitiveSkin forms that are Rosharan-only, and the system that owns them. */
export const BEAD_SYSTEM = 'rosharan';
const BEAD_FORMS = Object.freeze([
  ['objectForm', 'glass-beads'],
  ['landForm', 'bead-sea'],
]);

/** The forms a skin must all name before it counts as authored. */
export const SKIN_FIELD_KEYS = Object.freeze(['objectForm', 'livingForm', 'waterForm', 'landForm']);

/**
 * The look of a world that has not authored one.
 *
 * Deliberately *not* a quiet fallback style: `unassigned` means "this map has
 * no cognitive look yet", and the renderer draws nothing for it. The test range
 * therefore behaves exactly as it did before skins existed — the lens, and the
 * same world underneath — which is the honest state for a map with no canon.
 */
export const UNAUTHORED_SKIN = Object.freeze({
  authored: false,
  system: 'unassigned',
  objectForm: 'unassigned',
  livingForm: 'unassigned',
  waterForm: 'unassigned',
  landForm: 'unassigned',
});

/**
 * Fill in the taste values a skin may leave out.
 *
 * These are *defaults for an authored skin*, never for an unauthored one: a
 * world that says "beads" but forgets a bead colour should still render.
 */
function lightDefaults(light = {}) {
  const sun = light.sun ?? {};
  return {
    source: light.source ?? 'unassigned',
    dayNightCycle: Boolean(light.dayNightCycle),
    sky: {
      horizon: light.sky?.horizon ?? '#060810',
      zenith: light.sky?.zenith ?? '#000000',
      haze: light.sky?.haze ?? '#0a1018',
    },
    // "A single frail white sun that never moves or sets": the direction is
    // fixed data, not an animation, and there is no day/night cycle to advance.
    sun: {
      color: sun.color ?? '#ffffff',
      direction: { x: sun.direction?.x ?? 0.22, y: sun.direction?.y ?? 0.93, z: sun.direction?.z ?? 0.29 },
      discSize: sun.discSize ?? 0.99988,
      strength: sun.strength ?? 0.5,
      scale: sun.scale ?? 0.35,
    },
    ambient: {
      color: light.ambient?.color ?? '#0b1420',
      scale: light.ambient?.scale ?? 0.4,
    },
  };
}

function paletteDefaults(palette = {}) {
  return {
    bead: palette.bead ?? '#0e1a22',
    beadHighlight: palette.beadHighlight ?? '#9fd0ff',
    soul: palette.soul ?? '#16262f',
    flame: palette.flame ?? '#cfeaff',
    flameCore: palette.flameCore ?? '#ffffff',
    obsidian: palette.obsidian ?? '#05070a',
    obsidianHighlight: palette.obsidianHighlight ?? '#8fb6d8',
  };
}

/**
 * Resolve a map's cognitive skin into the object the renderer reads.
 *
 * Never throws and never falls back silently: an unusable skin resolves to
 * *unauthored* and reports why, so a canon mistake shows up as a test failure
 * and a missing layer rather than as beads on the wrong planet.
 *
 * @param {{ id?: string, system?: string, cognitiveSkin?: object }} map
 * @returns {{
 *   id: string, system: string, authored: boolean, violations: string[],
 *   objectForm: string, livingForm: string, waterForm: string, landForm: string,
 *   light: object, fog: { color: string, densityScale: number }, palette: object
 * }}
 */
export function resolveCognitiveSkin(map = {}) {
  const raw = map.cognitiveSkin ?? {};
  // The *map's* system is the system of record: the skin's own `system` field
  // is a copy, and a copy that agrees with itself is not a guard. A skin that
  // disagrees with its map is a data bug, and it says so.
  const system = map.system ?? raw.system ?? 'unassigned';
  const violations = [];
  if (raw.system && raw.system !== system) violations.push(`system:mismatch:${raw.system}:${system}`);

  const forms = {};
  for (const key of SKIN_FIELD_KEYS) {
    const value = raw[key] ?? 'unassigned';
    if (!SKIN_FORMS[key].includes(value)) violations.push(`${key}:unknown:${value}`);
    forms[key] = value;
  }

  // The canon guard, in one place: beads are a Rosharan manifestation.
  for (const [key, value] of BEAD_FORMS) {
    if (forms[key] === value && system !== BEAD_SYSTEM) violations.push(`${key}:not-rosharan:${system}`);
  }

  const authored = SKIN_FIELD_KEYS.every((key) => forms[key] !== 'unassigned') && violations.length === 0;

  return {
    id: raw.id ?? map.id ?? 'unknown',
    system,
    authored,
    violations,
    ...(authored ? forms : { objectForm: 'unassigned', livingForm: 'unassigned', waterForm: 'unassigned', landForm: 'unassigned' }),
    light: lightDefaults(raw.light ?? {}),
    fog: {
      color: raw.fog?.color ?? '#04060b',
      densityScale: Number.isFinite(raw.fog?.densityScale) ? Math.max(0.1, raw.fog.densityScale) : 1,
    },
    palette: paletteDefaults(raw.palette ?? {}),
  };
}

/**
 * One-line summary for the debug snapshot and the tests.
 *
 * Deliberately small: it is the *contract* between the renderer and anything
 * that needs to know which manifestation is on screen, so it must not grow a
 * field a test then depends on by accident.
 */
export function describeSkin(skin) {
  return {
    id: skin.id,
    system: skin.system,
    objectForm: skin.objectForm,
    authored: Boolean(skin.authored),
    violations: skin.violations.length,
  };
}

/**
 * Deterministic per-bead variation.
 *
 * Beads are a *sea*: thousands of them, and a lattice of identical spheres
 * reads as a mistake rather than as glass. The variation has to come from the
 * world position so that a bead does not change size when the camera moves —
 * which is why this is a hash of the lattice cell and not an RNG draw.
 */
export function beadVariation(cellX, cellZ, seed, { min = 0.45, max = 0.85 } = {}) {
  const size = hash2(cellX, cellZ, seed);
  const spin = hash2(cellZ, cellX, seed ^ 0x9e3779b9);
  const sway = hash2(cellX + 17, cellZ - 23, seed ^ 0x85ebca6b);
  const span = Math.max(0, max - min);
  return {
    radius: min + size * span,
    spin: spin * Math.PI * 2,
    // A bead's seat is not perfectly centred: a bead sea is poured, not stacked.
    offsetX: (sway - 0.5) * 0.6,
    offsetZ: (size - 0.5) * 0.6,
  };
}
