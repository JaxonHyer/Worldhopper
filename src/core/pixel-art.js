/**
 * Pixel art, as data.
 *
 * The owner's art direction (2026-10-15): characters look **pixelated**, the way
 * a Minecraft skin does — small textures, hard edges, visible pixels, not a
 * smooth gradient. The honest way to get that is to actually author tiny
 * textures and sample them with nearest-neighbour filtering, which is what this
 * module produces: an 8×8 face, an 8×12 shirt, 4×12 sleeves and trouser legs.
 *
 * It lives in core/ (no DOM, no three.js) for two reasons:
 *  - the art is then *data*, so a unit test can assert "the trousers have a belt
 *    row" or "the face has exactly two eyes" instead of a human squinting at a
 *    screenshot;
 *  - it can be built into whatever the renderer needs (`THREE.DataTexture`) with
 *    no canvas, no image files and no network — every asset in this game is
 *    generated from code because assets must be original (§9).
 *
 * Rows are authored top-down, the way a person reads a sprite. `data` comes out
 * in the order WebGL wants it (bottom row first) so the renderer never has to
 * rely on `flipY` — a texture that is silently upside down is exactly the kind
 * of bug that only shows up on someone else's device. `pixelAt()` reads
 * top-down, so tests and the art agree.
 */

/**
 * Build one texture from rows of single-character cells.
 *
 * @param {string[]} rows top-down rows, each the same length
 * @param {Record<string, string>} palette char -> '#rrggbb'
 * @returns {{width:number,height:number,rows:string[],palette:object,data:Uint8Array}}
 */
export function pixelArt(rows, palette, { name = 'texture' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${name}: needs at least one row`);
  const width = rows[0].length;
  if (width === 0) throw new Error(`${name}: rows cannot be empty`);
  for (const [index, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`${name}: row ${index} is ${row.length} cells, expected ${width}`);
    }
  }

  const colors = new Map();
  for (const [char, hex] of Object.entries(palette)) colors.set(char, parseColor(hex, name, char));

  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // GL wants the first row of memory at the bottom of the image.
    const target = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) {
      const char = rows[y][x];
      const rgba = colors.get(char);
      if (!rgba) throw new Error(`${name}: row ${y}, column ${x} uses "${char}", which is not in the palette`);
      const index = (target + x) * 4;
      data[index] = rgba[0];
      data[index + 1] = rgba[1];
      data[index + 2] = rgba[2];
      data[index + 3] = 255;
    }
  }

  return { name, width, height, rows: [...rows], palette, data };
}

function parseColor(hex, name, char) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) throw new Error(`${name}: palette "${char}" is not a #rrggbb colour (${hex})`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Read one pixel, top-down, as [r, g, b, a]. */
export function pixelAt(texture, x, y) {
  const row = texture.height - 1 - y;
  const index = (row * texture.width + x) * 4;
  return [texture.data[index], texture.data[index + 1], texture.data[index + 2], texture.data[index + 3]];
}

/** #rrggbb for a pixel, which is what a test wants to compare against. */
export function pixelHex(texture, x, y) {
  const [r, g, b] = pixelAt(texture, x, y);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The palette for people in this world: ordinary clothes, nothing ceremonial.
 * The owner asked for "more generic clothes" — so: a plain shirt, plain
 * trousers, boots, skin, hair. No coat trim, no badges, no pack.
 */
export const CHARACTER_PALETTE = Object.freeze({
  shirt: '#b9b3a2',
  shirtShade: '#a49e8d', // collar, hem, sleeve seam
  shirtDark: '#8f8a7b',
  trousers: '#525c68',
  trouserShade: '#434c57',
  belt: '#33383f',
  boots: '#4a3a2c',
  bootsShade: '#3a2d23',
  skin: '#c99b76',
  skinShade: '#b3865f',
  hair: '#3a2e26',
  eye: '#251f1c',
  mouth: '#8a5f4a',
});

/**
 * One character's skin, as named faces.
 *
 * Heads get a texture per face (a face drawn on all four sides is the classic
 * give-away); sleeves, legs and boots read fine with a single texture on every
 * face, because their patterns are horizontal bands.
 */
export function characterSkin(palette = CHARACTER_PALETTE) {
  const p = palette;

  const head = (rows, name) => pixelArt(rows, { H: p.hair, S: p.skin, E: p.eye, M: p.mouth, N: p.skinShade }, { name });
  // One object, not two identical ones: the renderer uploads it once.
  const sideOfHead = head(
    [
      'HHHHHHHH',
      'HHHHHHHH',
      'SSSSSSSS',
      'SSSSSSSS',
      'SSSSSSSS',
      'SSSSSSSS',
      'SSSSSSSS',
      'NNNNNNNN',
    ],
    'head-side',
  );

  return {
    head: {
      front: head(
        [
          'HHHHHHHH',
          'HHHHHHHH',
          'SSSSSSSS',
          'EESSSSEE',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSMMSSS',
          'NNNNNNNN',
        ],
        'head-front',
      ),
      back: head(
        [
          'HHHHHHHH',
          'HHHHHHHH',
          'HHHHHHHH',
          'HHHHHHHH',
          'HHHHSSHH',
          'HHHHSSHH',
          'HHHHSSHH',
          'NNNNNNNN',
        ],
        'head-back',
      ),
      // Both sides of the head are the same art: one texture, sampled twice.
      left: sideOfHead,
      right: sideOfHead,
      top: head(['HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH'], 'head-top'),
      bottom: head(
        ['SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS'],
        'head-bottom',
      ),
    },

    // A plain shirt: collar, buttons down the middle, a hem at the bottom.
    torso: {
      front: pixelArt(
        [
          'CCCCCCCC',
          'CSSSSSSC',
          'SSSBBSSS',
          'SSSBBSSS',
          'SSSBBSSS',
          'SSSBBSSS',
          'SSSBBSSS',
          'SSSBBSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'HHHHHHHH',
          'HHHHHHHH',
        ],
        { C: p.shirtShade, S: p.shirt, B: p.shirtDark, H: p.shirtShade },
        { name: 'torso-front' },
      ),
      back: pixelArt(
        [
          'CCCCCCCC',
          'CSSSSSSC',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'HHHHHHHH',
          'HHHHHHHH',
        ],
        { C: p.shirtShade, S: p.shirt, H: p.shirtShade },
        { name: 'torso-back' },
      ),
      side: pixelArt(
        [
          'CCCCCCCC',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'SSSSSSSS',
          'HHHHHHHH',
          'HHHHHHHH',
        ],
        { C: p.shirtShade, S: p.shirt, H: p.shirtShade },
        { name: 'torso-side' },
      ),
      top: pixelArt(['SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS'], { S: p.shirt }, { name: 'torso-top' }),
      bottom: pixelArt(['HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH'], { H: p.shirtShade }, { name: 'torso-bottom' }),
    },

    // Sleeves: shirt, with a darker seam where the cuff would be.
    arm: pixelArt(
      [
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'CCCC',
        'CCCC',
        'CCCC',
      ],
      { S: p.shirt, C: p.shirtShade },
      { name: 'arm' },
    ),

    // Hands: skin, one shade row where the wrist is.
    hand: pixelArt(['SSSS', 'SSSS', 'SSSS', 'NNNN'], { S: p.skin, N: p.skinShade }, { name: 'hand' }),

    // Trouser legs: a belt at the top, then cloth.
    leg: pixelArt(
      [
        'BBBB',
        'BBBB',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'SSSS',
        'CCCC',
        'CCCC',
      ],
      { B: p.belt, S: p.trousers, C: p.trouserShade },
      { name: 'leg' },
    ),

    // Boots: leather, with a sole.
    boot: pixelArt(['SSSS', 'SSSS', 'SSSS', 'CCCC'], { S: p.boots, C: p.bootsShade }, { name: 'boot' }),
  };
}

/** True for anything pixelArt() returned (and not, say, a palette of strings). */
export function isTexture(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray)
  );
}

/** Every texture in a skin, flattened — for tests and for disposal. */
export function skinTextures(skin) {
  const out = [];
  const seen = new Set();
  const visit = (value) => {
    if (isTexture(value)) {
      if (!seen.has(value.name)) {
        seen.add(value.name);
        out.push(value);
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) visit(child);
  };
  visit(skin);
  return out;
}
