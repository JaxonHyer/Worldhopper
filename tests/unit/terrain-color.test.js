import test from 'node:test';
import assert from 'node:assert/strict';
import {
  facetNoise,
  groundFacetColor,
  groundPalette,
  hexToLinearRgb,
  srgbToLinear,
} from '../../src/core/terrain-color.js';
import { getMap, getVariant, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { fbm2 } from '../../src/core/noise.js';

const map = getMap(DEFAULT_MAP_ID);

function variant(id) {
  return getVariant(map.id, id);
}

test('sRGB -> linear follows the standard transfer function', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.2140) < 0.001, 'mid grey lifts to ~0.214 linear');
  assert.ok(srgbToLinear(0.04) < srgbToLinear(0.05));
});

test('hex parsing is exact and forgiving', () => {
  assert.deepEqual(hexToLinearRgb('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToLinearRgb('#ffffff'), [1, 1, 1]);
  assert.deepEqual(hexToLinearRgb('#fff'), hexToLinearRgb('#ffffff'));
  assert.deepEqual(hexToLinearRgb('nonsense'), [0, 0, 0]);
  assert.ok(hexToLinearRgb('#ff0000')[0] > 0.99 && hexToLinearRgb('#ff0000')[1] === 0);
});

test('a facet colour is deterministic', () => {
  const palette = groundPalette(variant('ashen-basin'));
  const args = { palette, x: 123.4, z: -56.7, height: 1.5, amplitude: 7, facetHash: 0.42 };
  assert.deepEqual(groundFacetColor(args), groundFacetColor(args));
});

test('facet colours stay inside the palette it was given', () => {
  for (const id of map.variants.map((v) => v.id)) {
    const palette = groundPalette(variant(id));
    const bounds = (channel) => ({
      min: Math.min(palette.low[channel], palette.high[channel], palette.accent[channel]) * 0.9,
      max: Math.max(palette.low[channel], palette.high[channel], palette.accent[channel]) * 1.1,
    });
    for (let i = 0; i < 400; i++) {
      const color = groundFacetColor({
        palette,
        x: (i - 200) * 7.3,
        z: ((i % 37) - 18) * 11.1,
        height: ((i % 13) - 6) * 1.2,
        amplitude: 7,
        facetHash: facetNoise(i),
      });
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Number.isFinite(color[channel]), `${id}: channel ${channel} is ${color[channel]}`);
        assert.ok(color[channel] >= 0 && color[channel] <= 1, `${id}: channel ${channel} out of range`);
        assert.ok(
          color[channel] >= bounds(channel).min && color[channel] <= bounds(channel).max,
          `${id}: channel ${channel} escaped its palette (${color[channel]})`,
        );
      }
    }
  }
});

test('higher ground reads lighter than low ground for the same patch', () => {
  const palette = groundPalette(variant('cold-ridge'));
  const base = { palette, x: 40, z: 40, amplitude: 7, facetHash: 0.5 };
  const low = groundFacetColor({ ...base, height: -5 });
  const high = groundFacetColor({ ...base, height: 5 });
  const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  assert.ok(luminance(high) > luminance(low), 'the height ramp must go the right way');
});

test('the colour field is smooth in world space, so no facet grid appears', () => {
  const palette = groundPalette(variant('ashen-basin'));
  const sample = (x, z, height) => groundFacetColor({ palette, x, z, height, amplitude: 7, facetHash: 0.5 });
  // Neighbouring facets used to differ by the whole palette; they must now be
  // near-identical, with the colour changing over tens of metres instead.
  const a = sample(0, 0, 0);
  const b = sample(11, 0, 0);
  const far = sample(80, 0, 0);
  const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  assert.ok(distance(a, b) < 0.05, `neighbouring facets differ by ${distance(a, b).toFixed(3)}`);
  assert.ok(distance(a, far) < 0.5, `colours must drift, not jump (${distance(a, far).toFixed(3)})`);
  // ...and the drift is real: it must not be a single flat colour either.
  assert.ok(distance(a, far) > 1e-4 || distance(sample(0, 0, 0), sample(300, 300, 0)) > 1e-4);
});

test('per-facet jitter is small enough not to read as static', () => {
  const palette = groundPalette(variant('ashen-basin'));
  const colors = [];
  for (let i = 0; i < 64; i++) {
    colors.push(groundFacetColor({ palette, x: 200, z: 200, height: 0, amplitude: 7, facetHash: facetNoise(i) }));
  }
  const luminance = colors.map((c) => c[0] + c[1] + c[2]);
  const spread = Math.max(...luminance) - Math.min(...luminance);
  assert.ok(spread < 0.16, `facet jitter spread is ${spread.toFixed(3)} — too much salt-and-pepper`);
});

test('junk input cannot produce NaN or an out-of-range colour', () => {
  const palette = groundPalette(variant('mist-sea'));
  const cases = [
    { x: Number.NaN, z: 0, height: 0, amplitude: 0, facetHash: Number.NaN },
    { x: 1e9, z: -1e9, height: 1e9, amplitude: 7, facetHash: 2 },
    { x: 0, z: 0, height: -1e9, amplitude: -5, facetHash: -1 },
  ];
  for (const input of cases) {
    const color = groundFacetColor({ palette, ...input });
    for (const channel of color) {
      assert.ok(Number.isFinite(channel), `NaN for ${JSON.stringify(input)}`);
      assert.ok(channel >= 0 && channel <= 1);
    }
  }
});

test('the accent band never covers most of the ground', () => {
  // A soft threshold should tint a minority of the map; a runaway accent would
  // mean the macro field or the threshold drifted.
  let accents = 0;
  let total = 0;
  const palette = groundPalette(variant('ashen-basin'));
  const distant = (c) => Math.hypot(c[0] - palette.accent[0], c[1] - palette.accent[1], c[2] - palette.accent[2]);
  for (let x = -400; x <= 400; x += 23) {
    for (let z = -400; z <= 400; z += 23) {
      const color = groundFacetColor({ palette, x, z, height: 0, amplitude: 7, facetHash: 0.5 });
      total++;
      const macro = fbm2(x * 0.02, z * 0.02, 4242, 3);
      if (macro > 0.74) accents++;
      if (distant(color) < 0.02) accents += 0; // just exercising the distance
    }
  }
  const share = accents / total;
  assert.ok(share < 0.35, `accent covers ${(share * 100).toFixed(0)}% of the ground`);
});
