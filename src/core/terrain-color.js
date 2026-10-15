/**
 * Per-facet ground colouring, in world space.
 *
 * Why this is its own module: the first version hashed *quantised* world
 * coordinates (`round(x * 0.5)`), so the noise repeated on a grid that lined up
 * with the mesh, and a hard accent threshold turned that grid into visible
 * seams. Colour maths is easy to get subtly wrong and shows up only in
 * screenshots, so it lives here as pure functions with unit tests.
 *
 * Values are linear-space RGB triples — three keeps colours in linear working
 * space and converts on output, so the renderer writes these straight into the
 * vertex colour buffer.
 */

import { fbm2, hash2 } from './noise.js';
import { clamp } from './math.js';

/** sRGB (0..1) -> linear. Standard IEC 61966-2-1 transfer. */
export function srgbToLinear(channel) {
  const c = clamp(channel, 0, 1);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** '#rrggbb' -> [r, g, b] in linear space. */
export function hexToLinearRgb(hex) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return [0, 0, 0];
  return [
    srgbToLinear(((int >> 16) & 0xff) / 255),
    srgbToLinear(((int >> 8) & 0xff) / 255),
    srgbToLinear((int & 0xff) / 255),
  ];
}

/** Palette (hex strings) -> linear triples, done once per variant, not per facet. */
export function groundPalette(variant) {
  return {
    low: hexToLinearRgb(variant.ground.low),
    high: hexToLinearRgb(variant.ground.high),
    accent: hexToLinearRgb(variant.ground.accent),
  };
}

const MACRO_FREQUENCY = 0.02; // ~50 m tonal drift: terrain-scale colour, not noise
const MACRO_SEED = 4242;
const MICRO_JITTER = 0.045; // ±4.5% per facet: enough to read as faceted, not as static
const ACCENT_START = 0.74; // soft threshold, never per-facet salt-and-pepper
const ACCENT_WEIGHT = 0.9;

/**
 * Colour of one ground facet.
 *
 * @param {object} options
 * @param {{low:number[],high:number[],accent:number[]}} options.palette from groundPalette()
 * @param {number} options.x facet centroid X (metres, world space)
 * @param {number} options.z facet centroid Z
 * @param {number} options.height facet centroid Y
 * @param {number} options.amplitude the map's terrain amplitude
 * @param {number} options.facetHash deterministic per-facet value in [0,1)
 * @param {number[]} [options.out] reuse an array to avoid per-facet allocation
 * @returns {number[]} linear rgb
 */
export function groundFacetColor({ palette, x, z, height, amplitude, facetHash, out }) {
  // A NaN anywhere in here would poison the colour buffer and blank the ground,
  // so hostile input degrades to "no displacement, mid ramp" instead.
  const worldX = finite(x, 0);
  const worldZ = finite(z, 0);
  const worldHeight = finite(height, 0);
  const worldAmplitude = Math.abs(finite(amplitude, 0));
  const macro = fbm2(worldX * MACRO_FREQUENCY, worldZ * MACRO_FREQUENCY, MACRO_SEED, 3);
  const span = Math.max(0.5, worldAmplitude * 2);
  const ramp = clamp((worldHeight + worldAmplitude) / span, 0, 1);

  // Height sets the base tone; the macro field tilts which end of the palette a
  // whole region sits at, so colour patches follow terrain, not the mesh grid.
  const mix = clamp(ramp * 0.72 + macro * 0.28, 0, 1);
  const low = palette.low;
  const high = palette.high;

  let r = low[0] + (high[0] - low[0]) * mix;
  let g = low[1] + (high[1] - low[1]) * mix;
  let b = low[2] + (high[2] - low[2]) * mix;

  const jitter = 1 + (clamp(finite(facetHash, 0.5), 0, 1) - 0.5) * MICRO_JITTER * 2;
  r *= jitter;
  g *= jitter;
  b *= jitter;

  if (macro > ACCENT_START) {
    const weight = clamp((macro - ACCENT_START) / (1 - ACCENT_START), 0, 1) * ACCENT_WEIGHT;
    const accent = palette.accent;
    r += (accent[0] - r) * weight;
    g += (accent[1] - g) * weight;
    b += (accent[2] - b) * weight;
  }

  const target = out ?? [0, 0, 0];
  target[0] = clamp(r, 0, 1);
  target[1] = clamp(g, 0, 1);
  target[2] = clamp(b, 0, 1);
  return target;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** Deterministic per-facet hash — indexed by facet, never by quantised position. */
export function facetNoise(facetIndex, seed = 0x9e3779b1) {
  return hash2(facetIndex & 0xffff, (facetIndex >>> 16) & 0xffff, seed);
}
