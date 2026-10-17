import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAD_SYSTEM, MAPS, SKIN_FORMS, getMap, getVariant, listVariants, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { loadNpc } from '../../src/content/npcs.js';

const hex = /^#([0-9a-f]{6})$/i;

/** The construction site: named, because a test that says "the default map"
 * now means Roshar, and most of the rules below are about this one. */
const TEST_RANGE = 'blank-basin';

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
        ['perpendicularity.pool', variant.perpendicularity?.pool],
        ['perpendicularity.glow', variant.perpendicularity?.glow],
        ['sun.color', variant.sun.color],
      ]) {
        assert.match(value, hex, `${map.id}/${variant.id}: ${name} must be #rrggbb`);
      }
      assert.ok(variant.fog.density > 0 && variant.fog.density <= 0.05, `${variant.id}: fog density out of sane range`);
      for (const [name, value] of [
        ['sky.horizon', variant.sky.horizon],
        ['sky.haze', variant.sky.haze],
      ]) {
        assert.equal(
          value.toLowerCase(),
          variant.fog.color.toLowerCase(),
          `${map.id}/${variant.id}: ${name} and the fog colour must match or the horizon seams`,
        );
      }
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

test('every map declares its Perpendicularity (M2)', () => {
  for (const map of Object.values(MAPS)) {
    const gate = map.perpendicularity;
    assert.ok(gate, `${map.id} needs a Perpendicularity: it is how realms are shifted now`);
    assert.ok(gate.id && gate.label, 'the gate needs an id and a label');
    assert.ok(Number.isFinite(gate.position?.x) && Number.isFinite(gate.position?.z), 'the gate needs a position');
    assert.ok(gate.radius >= 1 && gate.radius <= 12, `${map.id}: a ${gate.radius} m pool is a lake or a puddle`);
    assert.equal(typeof gate.open, 'boolean', 'openness is a flag M4 turns into a puzzle');
    // The pool must be walkable-to from the spawn, and inside the map's ground.
    const half = map.ground.size / 2;
    assert.ok(Math.abs(gate.position.x) < half && Math.abs(gate.position.z) < half);
    assert.ok(
      Math.hypot(gate.position.x, gate.position.z) < 60,
      `${map.id}: the gate is ${gate.position.z} m from the spawn — M2 asks for one by spawn`,
    );
    assert.ok(map.propPolicy.perpendicularityClearance >= gate.radius, 'the shore must be kept clear');
  }
});

test('the M0 map is explicitly non-canon and dims nothing', () => {
  const map = getMap('blank-basin');
  assert.equal(map.status, 'placeholder');
  assert.equal(map.system, 'unassigned');
  assert.equal(map.cognitiveSkin.objectForm, 'unassigned');
});

test('the world the game opens on is a world with a realm to look at', () => {
  // M2, at the owner's request: the default used to be the test range, which
  // has no cognitive skin by design — so a player who just opened the game and
  // walked into the pool saw no change at all. The default world must be one
  // that has something to show.
  const map = getMap(DEFAULT_MAP_ID);
  assert.notEqual(map.status, 'placeholder', 'the opening world must not be the construction site');
  assert.ok(map.cognitiveSkin, 'the opening world needs a cognitiveSkin');
  assert.equal(map.cognitiveSkin.objectForm, 'glass-beads');
  // ...and its own declared palette must exist on it.
  assert.ok(map.variants.length >= 2, 'the opening world needs taste options');
  assert.ok(
    map.variants.some((variant) => variant.id === map.defaultPalette),
    'the opening world declares a default palette it does not have',
  );
});

test('every NPC a map places has a person behind it, and a place a player can reach', () => {
  // `placeNpcs()` throws on an id with no dialogue file, so a typo here is a
  // *boot crash*, not a red test — the same class of failure as an unknown map
  // id. The other rules keep an NPC interactable rather than decorative: a
  // figure standing in the pool can never be reached (the gate fires first),
  // and a talk radius a thumb cannot use is a figure you walk around.
  for (const map of Object.values(MAPS)) {
    const placed = new Set();
    for (const spawn of map.npcs ?? []) {
      assert.ok(spawn.id && !placed.has(spawn.id), `${map.id}: NPC placement ids are unique`);
      placed.add(spawn.id);

      assert.ok(Number.isFinite(spawn.position?.x) && Number.isFinite(spawn.position?.z), `${map.id}: ${spawn.id} has a place to stand`);
      assert.ok(spawn.interactRadius >= 2 && spawn.interactRadius <= 6, `${map.id}: ${spawn.id} has a talk radius that is neither a pixel-hunt nor a shout`);

      const pool = map.perpendicularity;
      const away = Math.hypot(spawn.position.x - pool.position.x, spawn.position.z - pool.position.z);
      assert.ok(away > pool.radius + 1, `${map.id}: ${spawn.id} must not stand in the pool`);

      let dialogue;
      assert.doesNotThrow(() => {
        dialogue = loadNpc(spawn.npcId);
      }, `${map.id}: ${spawn.id} names a dialogue file that does not exist`);
      assert.ok(dialogue.nodes?.[dialogue.start], `${map.id}: ${spawn.npcId} starts at a node that exists`);
    }
  }
});

test('variants can be looked up and fall back safely', () => {
  const ids = listVariants(TEST_RANGE);
  assert.deepEqual(ids, ['ashen-basin', 'mist-sea', 'cold-ridge']);
  assert.equal(getVariant(TEST_RANGE, 'mist-sea').id, 'mist-sea');
  assert.equal(getVariant(TEST_RANGE, 'does-not-exist').id, ids[0]);
  assert.throws(() => getMap('not-a-map'));
});
