/**
 * Terrain sampling. Split out of world-state.js so the player sim can use it
 * without importing the whole world (and without an import cycle).
 */

import { normalizeSeed } from './rng.js';
import { fbm2 } from './noise.js';

/** Terrain height at a world position (metres). Deterministic per seed. */
export function terrainHeight(map, seed, x, z) {
  const g = map.ground;
  const raw = fbm2(x * g.frequency, z * g.frequency, normalizeSeed(seed), g.octaves);
  const centred = (raw - 0.5) * 2; // [-1, 1]
  const dist = Math.hypot(x, z);
  // Flatten the spawn apron so the first thing the player sees is not a fold.
  const blend = dist >= g.flatRadius ? 1 : Math.max(0, dist / g.flatRadius - 0.15);
  const height = centred * g.amplitude * blend;
  return height === 0 ? 0 : height; // normalise -0 so state comparisons stay clean
}

/** Gradient of the terrain, by central difference (metres of rise per metre). */
export function terrainSlope(map, seed, x, z, step = 0.75) {
  const dx = (terrainHeight(map, seed, x + step, z) - terrainHeight(map, seed, x - step, z)) / (2 * step);
  const dz = (terrainHeight(map, seed, x, z + step) - terrainHeight(map, seed, x, z - step)) / (2 * step);
  return { dx, dz, magnitude: Math.hypot(dx, dz) };
}
