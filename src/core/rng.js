/**
 * Seeded RNG — deterministic across runs and platforms.
 *
 * Only integer ops, multiply/add and one division are used, so every JS
 * engine produces the identical stream (no transcendentals: Math.sin/cos/pow
 * are not bit-stable across engines).
 */

/** FNV-1a over a string -> uint32. Lets `?seed=emberdark` and `?seed=42` both work. */
export function hashSeed(input) {
  const str = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Coerce anything into a valid uint32 seed. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.trunc(seed)) >>> 0;
  if (typeof seed === 'string') {
    const trimmed = seed.trim();
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Math.abs(Math.trunc(Number(trimmed))) >>> 0;
    return hashSeed(trimmed);
  }
  return hashSeed(seed ?? 0);
}

/** mulberry32 — small, fast, good enough, and reproducible. */
export function createRng(seed) {
  let a = normalizeSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** uniform [0, 1) */
    next,
    /** uniform [min, max) */
    range: (min, max) => min + (max - min) * next(),
    /** integer in [min, max] */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** uniform [min, max) — alias kept for readability at call sites */
    float: (min, max) => min + (max - min) * next(),
    /** true with probability p */
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** unit-ish point on the XZ plane */
    unitOnCircle: () => {
      const angle = next() * 6.283185307179586;
      return { x: Math.cos(angle), z: Math.sin(angle) };
    },
    /** current internal state, for debugging reproducibility */
    getState: () => a >>> 0,
  };
}
