/**
 * The baked creature skins (core/enemy-skins.js) — the owner's AI-texture
 * experiment, as data. The renderer can only trust pixels that are the shape
 * they were baked to be, so the geometry of the data is the test here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENEMY_SKINS, enemySkin } from '../../src/core/enemy-skins.js';
import { ENEMY_TYPES } from '../../src/core/enemy.js';

test('every skin ships as dense RGBA pixel data, 32×32', () => {
  const names = Object.keys(ENEMY_SKINS);
  assert.equal(names.length, 4, 'shell, limb, body, head — the two boss materials each');
  for (const name of names) {
    const skin = ENEMY_SKINS[name];
    assert.equal(skin.width, 32, `${name} width`);
    assert.equal(skin.height, 32, `${name} height`);
    assert.equal(skin.data.length, 32 * 32 * 4, `${name}: one RGBA byte quadruplet per pixel`);
  }
});

test('a skin is not a flat wash — the AI art survived the bake', () => {
  for (const [name, skin] of Object.entries(ENEMY_SKINS)) {
    const colors = new Set();
    let alpha255 = 0;
    for (let i = 0; i < skin.data.length; i += 4) {
      colors.add((skin.data[i] << 16) | (skin.data[i + 1] << 8) | skin.data[i + 2]);
      if (skin.data[i + 3] === 255) alpha255++;
    }
    // Measured: 6–15 colours per skin — the intended flat-block palette.
    // The failure this guards is the bake eating the art down to a wash (1–2).
    assert.ok(colors.size >= 5, `${name} quantised to only ${colors.size} colours — the bake ate the art`);
    assert.ok(alpha255 >= 1024 * 0.95, `${name} is mostly opaque (a creature face, not a ghost)`);
  }
});

test('every archetype texture reference resolves to a real skin, with no orphans either way', () => {
  // Row side: names the rows name exist. (A typo here renders a flat box
  // instead of an error — exactly the kind of silent drop this keeps out.)
  for (const [id, type] of Object.entries(ENEMY_TYPES)) {
    for (const [part, skinName] of Object.entries(type.texture ?? {})) {
      const skin = enemySkin(skinName);
      assert.ok(skin, `${id}.texture.${part} names a skin that does not exist: ${skinName}`);
      assert.ok(['body', 'head', 'limb'].includes(part), `${id}.texture has an unknown part: ${part}`);
    }
  }
  // Skin side: nothing baked goes unused — the module is small and every row
  // of it is paid for at runtime.
  const used = new Set(
    Object.values(ENEMY_TYPES).flatMap((type) => Object.values(type.texture ?? {})),
  );
  for (const name of Object.keys(ENEMY_SKINS)) {
    assert.ok(used.has(name), `baked skin unused by any archetype row: ${name}`);
  }
});

test('enemySkin() is safe about junk', () => {
  assert.equal(enemySkin('nope'), null);
  assert.equal(enemySkin(undefined), null);
  assert.equal(enemySkin(''), null);
});
