/**
 * Deterministic 2D value noise + fbm, seeded.
 *
 * Used for terrain undulation and prop scatter, so a map can be rebuilt
 * byte-for-byte from its seed. Only integer maths, multiply, add and divide
 * are used (see rng.js for why).
 */

function hashInt(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) + Math.imul(y | 0, 0x165667b1) + Math.imul(seed | 0, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) | 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) | 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Hash an integer lattice point -> [0, 1). */
export function hash2(x, y, seed = 0) {
  return hashInt(x, y, seed);
}

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth value noise in [0, 1) at continuous (x, y). */
export function valueNoise2(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const n00 = hashInt(x0, y0, seed);
  const n10 = hashInt(x0 + 1, y0, seed);
  const n01 = hashInt(x0, y0 + 1, seed);
  const n11 = hashInt(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fy);
}

/** Fractal brownian motion over valueNoise2, normalised to [0, 1]. */
export function fbm2(x, y, seed = 0, octaves = 3, lacunarity = 2, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
