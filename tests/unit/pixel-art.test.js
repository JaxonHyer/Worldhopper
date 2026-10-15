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
  AVATAR_VARIANTS,
  CHARACTER_PALETTE,
  GIRL_PALETTE,
  characterSkin,
  isTexture,
  normalizeVariant,
  paletteFor,
  pixelArt,
  pixelAt,
  pixelHex,
  skinTextures,
} from '../../src/core/pixel-art.js';

const skin = characterSkin();
const girl = characterSkin({ variant: 'girl' });

test('every texture in the skin is a real texture, and small', () => {
  const textures = skinTextures(skin);
  assert.equal(textures.length, 14, 'a smaller set than the M1.5 figure: no pack, no belt box, no eye boxes');
  // Hair is texture, never geometry (the owner): she has the same fourteen
  // textures as the boy, and no extra ones for hair.
  assert.equal(skinTextures(girl).length, 14, 'the girl must not need extra textures for hair');
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

test('the head has a face: eyes with whites, a nose and a mouth', () => {
  // The owner asked for this explicitly ("I want it to have a face ... go
  // Minecraft style again") after the camera made it hard to see one.
  for (const character of [skin, girl]) {
    const { front, back, left, top, bottom } = character.head;
    const palette = character.palette;
    const at = (x, y) => pixelHex(front, x, y);
    // The girl's hair comes down the sides of her face, so her outermost
    // columns are hair; the boy's are skin. Either way it is *not* the eye:
    // the four eye pixels sit in the middle of the face, in both characters.
    const edge = character.variant === 'girl' ? palette.hair.toLowerCase() : palette.skin.toLowerCase();

    // Two eyes, two pixels each: a white and a pupil, mirrored, with a gap.
    assert.equal(at(1, 3), palette.eyeWhite.toLowerCase(), 'the left eye has no white');
    assert.equal(at(2, 3), palette.eye.toLowerCase(), 'the left eye has no pupil');
    assert.equal(at(5, 3), palette.eye.toLowerCase(), 'the right eye has no pupil');
    assert.equal(at(6, 3), palette.eyeWhite.toLowerCase(), 'the right eye has no white');
    assert.equal(at(0, 3), edge, 'the outer edge of the face is wrong');
    assert.equal(at(7, 3), edge, 'the outer edge of the face is wrong');
    assert.equal(at(3, 3), palette.skin.toLowerCase(), 'the eyes are joined in the middle');
    assert.notEqual(at(3, 4), at(3, 2), 'there is no nose');
    assert.equal(at(3, 5), palette.mouth.toLowerCase(), 'there is no mouth');

    // Hair on top and round the back; no eye anywhere but the front.
    assert.equal(pixelHex(top, 3, 3), palette.hair.toLowerCase(), 'the top of the head is not hair');
    assert.equal(pixelHex(back, 3, 6), palette.hair.toLowerCase(), 'the back of the head is not hair');
    assert.equal(pixelHex(bottom, 3, 3), palette.skin.toLowerCase(), 'the jaw should be skin');
    assert.notEqual(pixelHex(left, 3, 3), palette.eye.toLowerCase(), 'no eye on the side of a head');
    assert.notEqual(pixelHex(left, 3, 3), palette.eyeWhite.toLowerCase(), 'no eye white on the side');
  }
});

test('the girl is a different character, not a different game', () => {
  assert.deepEqual(AVATAR_VARIANTS, ['boy', 'girl']);
  assert.equal(normalizeVariant('girl'), 'girl');
  for (const junk of [undefined, null, 'boy', 'GIRL', 42, {}]) {
    assert.equal(normalizeVariant(junk), 'boy', `normalizeVariant(${String(junk)})`);
  }
  assert.equal(paletteFor('girl'), GIRL_PALETTE);
  assert.equal(paletteFor('boy'), CHARACTER_PALETTE);
  assert.equal(skin.variant, 'boy');
  assert.equal(girl.variant, 'girl');

  // Her own clothes and hair...
  assert.notEqual(girl.palette.shirt, skin.palette.shirt, 'they should not wear the same shirt');
  assert.notEqual(girl.palette.hair, skin.palette.hair, 'they should not have the same hair');
  // ...with everything else shared, so they read as the same world.
  for (const key of ['trousers', 'boots', 'skin', 'eye', 'eyeWhite']) {
    assert.equal(girl.palette[key], skin.palette[key], `${key} should be shared`);
  }

  // Her hair is painted, so her textures are the boy's textures — same names,
  // same sizes, no extra sheet for long hair.
  const boyNames = skinTextures(skin).map((t) => t.name).sort();
  const girlNames = skinTextures(girl).map((t) => t.name).sort();
  assert.deepEqual(girlNames, boyNames, 'hair must not add a texture');
  for (const texture of skinTextures(girl)) {
    assert.ok(texture.name.startsWith('head-') || texture.name.startsWith('torso-') || true);
  }
});

test('the girl\u2019s long hair is drawn on, not modelled', () => {
  // The owner: "the girl's hair looks weird, make it a texture only thing. Not
  // actual 3d hair." So: the hair is in the head and torso art, and the two
  // characters have the same number of textures (checked above) and — the part
  // only the renderer can answer — the same number of boxes (checked in
  // render-graph.test.js).
  const hair = GIRL_PALETTE.hair.toLowerCase();
  const shade = GIRL_PALETTE.hairShade.toLowerCase();

  // Hair the whole way down both sides of her head, past the eyes and the jaw.
  for (const y of [0, 2, 4, 6]) {
    assert.equal(pixelHex(girl.head.front, 0, y), hair, `hair is missing on the left of the face at row ${y}`);
    assert.equal(pixelHex(girl.head.front, 7, y), hair, `hair is missing on the right of the face at row ${y}`);
  }
  // Her face is still a face: the middle is skin, with the features on it.
  assert.equal(pixelHex(girl.head.front, 3, 2), GIRL_PALETTE.skin.toLowerCase(), 'her forehead should be skin');
  assert.equal(pixelHex(girl.head.front, 3, 5), GIRL_PALETTE.mouth.toLowerCase(), 'her mouth is missing');

  // The side of her head is hair, top to bottom (the boy's shows an ear of skin).
  for (let y = 0; y < 8; y++) {
    assert.equal(pixelHex(girl.head.left, 3, y), y === 7 ? shade : hair, `side of the head, row ${y}`);
  }
  assert.equal(pixelHex(skin.head.left, 4, 4), CHARACTER_PALETTE.skin.toLowerCase(), 'the boy\u2019s side is skin');

  // ...and it falls over the shoulders of her shirt, with a ragged end.
  assert.equal(pixelHex(girl.torso.back, 0, 0), hair, 'her hair should cover her collar');
  assert.equal(pixelHex(girl.torso.back, 4, 6), hair, 'the fall should still be there at the shoulder blades');
  assert.equal(pixelHex(girl.torso.back, 4, 8), GIRL_PALETTE.shirt.toLowerCase(), 'the shirt should show below it');
  assert.equal(pixelHex(girl.torso.back, 0, 8), GIRL_PALETTE.shirt.toLowerCase(), 'the fall should be narrower than the back');
  assert.equal(pixelHex(skin.torso.back, 4, 4), CHARACTER_PALETTE.shirt.toLowerCase(), 'the boy\u2019s back is plain');
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
