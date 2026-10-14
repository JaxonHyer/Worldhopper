import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAD_SYSTEM, MAPS, SKIN_FORMS, getMap, getVariant, listVariants, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';

const hex = /^#([0-9a-f]{6})$/i;

test('every map declares the data the renderer and the fog pipeline need', () => {
  for (const map of Object.values(MAPS)) {
    assert.ok(map.id && map.label, 'map needs an id and label');
    assert.ok(map.ground.size > 0 && map.ground.segments > 0);
    assert.ok(map.landmarks.length >= 1, 'art direction rule: one landmark silhouette per map');
    assert.ok(map.variants.length >= 2, 'taste calls need options to pick between');
    assert.ok(map.propPolicy.count >= 0);
    assert.equal(typeof map.cognitiveSkin, 'object');
  }
});

test('palettes are well-formed and complete', () => {
  for (const map of Object.values(MAPS)) {
    for (const variant of map.variants) {
      for (const [name, value] of [
        ['sky.horizon', variant.sky.horizon],
        ['sky.zenith', variant.sky.zenith],
        ['sky.haze', variant.sky.haze],
        ['fog.color', variant.fog.color],
        ['ground.low', variant.ground.low],
        ['ground.high', variant.ground.high],
        ['ground.accent', variant.ground.accent],
        ['props.rock', variant.props.rock],
        ['props.landmark', variant.props.landmark],
        ['sun.color', variant.sun.color],
      ]) {
        assert.match(value, hex, `${map.id}/${variant.id}: ${name} must be #rrggbb`);
      }
      assert.ok(variant.fog.density > 0 && variant.fog.density <= 0.05, `${variant.id}: fog density out of sane range`);
      assert.equal(
        variant.sky.horizon.toLowerCase(),
        variant.fog.color.toLowerCase(),
        `${map.id}/${variant.id}: horizon and fog colours must match or the horizon seams`,
      );
      const dir = variant.sun.direction;
      assert.ok(Math.hypot(dir.x, dir.y, dir.z) > 0.5, 'sun direction must be a usable vector');
    }
  }
});

test('cognitiveSkin is per-map data and only Roshar may ask for beads', () => {
  for (const map of Object.values(MAPS)) {
    const skin = map.cognitiveSkin;
    assert.ok(SKIN_FORMS.objectForm.includes(skin.objectForm), `${map.id}: unknown objectForm`);
    assert.ok(SKIN_FORMS.livingForm.includes(skin.livingForm), `${map.id}: unknown livingForm`);
    assert.ok(SKIN_FORMS.waterForm.includes(skin.waterForm), `${map.id}: unknown waterForm`);
    assert.ok(SKIN_FORMS.landForm.includes(skin.landForm), `${map.id}: unknown landForm`);
    assert.ok(SKIN_FORMS.lightSource.includes(skin.light.source), `${map.id}: unknown light source`);
    assert.equal(typeof skin.light.dayNightCycle, 'boolean');
    if (skin.objectForm === 'glass-beads') {
      assert.equal(map.system, BEAD_SYSTEM, `${map.id} asked for beads but is not in the Rosharan system`);
    }
  }
});

test('the M0 map is explicitly non-canon and dims nothing', () => {
  const map = getMap(DEFAULT_MAP_ID);
  assert.equal(map.status, 'placeholder');
  assert.equal(map.system, 'unassigned');
  assert.equal(map.cognitiveSkin.objectForm, 'unassigned');
});

test('variants can be looked up and fall back safely', () => {
  const ids = listVariants(DEFAULT_MAP_ID);
  assert.deepEqual(ids, ['ashen-basin', 'mist-sea', 'cold-ridge']);
  assert.equal(getVariant(DEFAULT_MAP_ID, 'mist-sea').id, 'mist-sea');
  assert.equal(getVariant(DEFAULT_MAP_ID, 'does-not-exist').id, ids[0]);
  assert.throws(() => getMap('not-a-map'));
});
