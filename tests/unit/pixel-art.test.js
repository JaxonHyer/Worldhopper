/**
 * The character's pixel art, asserted as data.
 *
 * The owner asked for a "pixelated appearance like Minecraft" (2026-10-15), and
 * pixel art is the one kind of art that can be checked without eyes: the pixels
 * are numbers here. These tests are what stop a texture becoming a smear (wrong
 * filtering), a face appearing on the back of the head, or a typo in the art
 * turning into a silent magenta square on someone's phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_PALETTE,
  characterSkin,
  isTexture,
  pixelArt,
  pixelAt,
  pixelHex,
  skinTextures,
} from '../../src/core/pixel-art.js';

const skin = characterSkin();

test('every texture in the skin is a real texture, and small', () => {
  const textures = skinTextures(skin);
  assert.equal(textures.length, 14, 'a smaller set than the M1.5 figure: no pack, no belt box, no eye boxes');
  for (const texture of textures) {
    assert.ok(texture.width >= 4 && texture.width <= 8, `${texture.name} is ${texture.width} wide`);
    assert.ok(texture.height >= 4 && texture.height <= 12, `${texture.name} is ${texture.height} tall`);
    assert.equal(texture.data.length, texture.width * texture.height * 4, `${texture.name} has the wrong byte count`);
  }
  // Two faces share one texture object (the sides of the head, the sides of the
  // torso), so the same art is never uploaded twice.
  assert.equal(skin.head.left, skin.head.right);
  assert.equal(skinTextures(skin).filter((t) => t.name === 'head-side').length, 1);
});

test('every pixel is opaque and comes from the palette', () => {
  const allowed = new Set(
    Object.values(CHARACTER_PALETTE).map((hex) => hex.toLowerCase()),
  );
  for (const texture of skinTextures(skin)) {
    for (let y = 0; y < texture.height; y++) {
      for (let x = 0; x < texture.width; x++) {
        const [r, g, b, a] = pixelAt(texture, x, y);
        assert.equal(a, 255, `${texture.name} (${x},${y}) is transparent`);
        const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
        assert.ok(allowed.has(hex), `${texture.name} (${x},${y}) is ${hex}, which is not in the palette`);
      }
    }
  }
});

test('the head has one face, and hair everywhere else', () => {
  const { front, back, left, top, bottom } = skin.head;
  const hair = CHARACTER_PALETTE.hair.toLowerCase();
  const eye = CHARACTER_PALETTE.eye.toLowerCase();

  // Two eyes, two pixels each, in the upper half, with a gap between them.
  const eyePixels = [];
  for (let y = 0; y < front.height; y++) {
    for (let x = 0; x < front.width; x++) if (pixelHex(front, x, y) === eye) eyePixels.push([x, y]);
  }
  assert.equal(eyePixels.length, 4, `expected four eye pixels, found ${eyePixels.length}`);
  assert.ok(eyePixels.every(([, y]) => y < front.height / 2), 'the eyes belong in the upper half of the face');
  assert.ok(eyePixels.some(([x]) => x <= 2) && eyePixels.some(([x]) => x >= 5), 'the eyes are not on both sides');

  // Hair on top and round the back; skin below the fringe at the front.
  assert.equal(pixelHex(top, 3, 3), hair, 'the top of the head is not hair');
  assert.equal(pixelHex(back, 3, 6), hair, 'the back of the head is not hair');
  assert.equal(pixelHex(bottom, 3, 3), CHARACTER_PALETTE.skin.toLowerCase(), 'the jaw should be skin');
  assert.equal(pixelHex(front, 2, 6), CHARACTER_PALETTE.skin.toLowerCase(), 'the chin is skin');
  assert.equal(pixelHex(front, 3, 6), CHARACTER_PALETTE.mouth.toLowerCase(), 'there should be a mouth');
  assert.notEqual(pixelHex(left, 3, 6), eye, 'no eye on the side of a head');
});

test('the clothes are plain: a collar, buttons, a hem and a belt', () => {
  const shade = CHARACTER_PALETTE.shirtShade.toLowerCase();
  const dark = CHARACTER_PALETTE.shirtDark.toLowerCase();
  assert.equal(pixelHex(skin.torso.front, 0, 0), shade, 'no collar');
  assert.equal(pixelHex(skin.torso.front, 4, 4), dark, 'no button line');
  assert.equal(pixelHex(skin.torso.front, 4, 11), shade, 'no hem');
  assert.equal(pixelHex(skin.torso.back, 4, 4), CHARACTER_PALETTE.shirt.toLowerCase(), 'the back should be plain');
  // Trousers have a belt at the top; boots have a sole.
  assert.equal(pixelHex(skin.leg, 0, 0), CHARACTER_PALETTE.belt.toLowerCase());
  assert.equal(pixelHex(skin.leg, 0, 6), CHARACTER_PALETTE.trousers.toLowerCase());
  assert.equal(pixelHex(skin.boot, 0, 3), CHARACTER_PALETTE.bootsShade.toLowerCase());
  assert.equal(pixelHex(skin.boot, 0, 0), CHARACTER_PALETTE.boots.toLowerCase());
});

test('rows are authored top-down, data is stored bottom-up for the GPU', () => {
  const art = pixelArt(['AB', 'BA'], { A: '#ff0000', B: '#0000ff' }, { name: 'test' });
  // Read as a person wrote it...
  assert.equal(pixelHex(art, 0, 0), '#ff0000');
  assert.equal(pixelHex(art, 1, 0), '#0000ff');
  assert.equal(pixelHex(art, 0, 1), '#0000ff');
  // ...while the raw buffer starts with the bottom row, so the renderer never
  // has to rely on flipY (a silently upside-down face only shows up on someone
  // else's device).
  assert.deepEqual([...art.data.slice(0, 4)], [0, 0, 255, 255], 'first bytes should be B, the bottom-left pixel');
  assert.deepEqual([...art.data.slice(4, 8)], [255, 0, 0, 255]);
});

test('bad art fails loudly, at build time, not on a phone', () => {
  assert.throws(() => pixelArt([], { A: '#ffffff' }), /at least one row/);
  assert.throws(() => pixelArt(['A', 'AB'], { A: '#ffffff', B: '#ffffff' }), /row 1 is 2 cells, expected 1/);
  assert.throws(() => pixelArt(['A'], {}), /not in the palette/);
  assert.throws(() => pixelArt(['Z'], { A: '#ffffff' }), /"Z", which is not in the palette/);
  assert.throws(() => pixelArt(['A'], { A: 'red' }), /not a #rrggbb colour/);
});

test('isTexture tells a texture apart from a palette of strings', () => {
  assert.equal(isTexture(skin.arm), true);
  assert.equal(isTexture(CHARACTER_PALETTE), false);
  assert.equal(isTexture(skin.head), false, 'a face set is not a texture');
  assert.equal(isTexture(null), false);
});

test('the palette is a character’s worth of ordinary clothes', () => {
  const keys = Object.keys(CHARACTER_PALETTE);
  for (const needed of ['shirt', 'trousers', 'boots', 'skin', 'hair', 'eye']) {
    assert.ok(keys.includes(needed), `the palette has no ${needed}`);
  }
  // Nothing ceremonial left over from the M1.5 "scholar" figure.
  for (const gone of ['coat', 'coatTrim', 'pack']) {
    assert.ok(!keys.includes(gone), `the palette still has ${gone}`);
  }
});
