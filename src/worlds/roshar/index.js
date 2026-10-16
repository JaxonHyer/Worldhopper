/**
 * Roshar — the first authored world (ROADMAP.md § Planet template).
 *
 * What is authored here and what is not, stated plainly, because the difference
 * matters more than the file does:
 *
 *  - **Authored:** the world's identity and its `cognitiveSkin` — the canon
 *    table's Roshar row, transcribed: dark glass beads for objects, flames for
 *    living things, solid obsidian for water, a bead sea for land, and a black
 *    sky lit by one frail white sun that never moves. The palette, the landmark
 *    and the gate placement are the project's taste values.
 *  - **Not authored:** the terrain kit. This map uses the M0 rolling basin to
 *    keep the renderer, the fog pipeline and the harness honest until M5's
 *    terrain pass gives Roshar its own rock. Stated rather than hidden: nothing
 *    in this file claims the basin *is* Roshar.
 *
 * Placement is a design choice with a canon anchor: the map is a patch of the
 * peaks, above the pool. Roshar's Perpendicularity is canonically the pool at
 * the Horneater Peaks, so putting the player's first gate there means the gate
 * is the canon one rather than an invention. The pool's exact distance from the
 * spawn is ours (the owner asked for one "by spawn" in M2).
 *
 * Canon that is deliberately *not* modelled yet: Roshar's ~0.7 g gravity, crem,
 * rockbuds, highstorms. All are per-map or M5 work; inventing them here would
 * put numbers in the code that the roadmap wants designed with the owner.
 */

export const roshar = {
  id: 'roshar',
  label: 'Roshar',
  /** `authored` = a real world, unlike the M0 test range. */
  status: 'authored',
  system: 'rosharan',
  defaultSeed: 1607255203,
  blurb: 'Storm-scoured rock above the pool at the peaks. The first authored world.',

  ground: {
    size: 1600,
    segments: 144,
    amplitude: 9,
    frequency: 0.0055,
    octaves: 3,
    flatRadius: 14,
  },

  /** One silhouette, visible from most of the patch (planet template). */
  landmarks: [
    {
      id: 'spire-roshar-01',
      kind: 'spire',
      label: 'the Stormbreak Needle',
      position: { x: 190, y: 0, z: -395 },
      height: 168,
      baseRadius: 84,
      shards: 7,
      spread: 52,
    },
  ],

  /**
   * The gate. Same arrangement as the test range — a short walk ahead of the
   * spawn — so the two realms read identically to a player who has just landed.
   */
  perpendicularity: {
    id: 'perpendicularity-peaks',
    label: 'Perpendicularity',
    position: { x: 0, z: -14 },
    radius: 3.4,
    open: true,
  },

  propPolicy: {
    kind: 'rock',
    count: 30,
    innerRadius: 18,
    outerRadius: 300,
    minScale: 0.8,
    maxScale: 3.4,
    landmarkClearance: 130,
    perpendicularityClearance: 11,
  },

  /**
   * Roshar's Cognitive Realm — the canon table's first row.
   *
   * `objectForm: glass-beads` and `landForm: bead-sea` are the forms the canon
   * guard reserves for this system, which is why `system` must say `rosharan`.
   * Every colour here is a taste value and belongs to the owner's eye, not to
   * canon.
   */
  cognitiveSkin: {
    id: 'roshar-shadesmar',
    system: 'rosharan',
    objectForm: 'glass-beads',
    livingForm: 'flame',
    waterForm: 'solid-obsidian',
    landForm: 'bead-sea',
    light: {
      source: 'black-sky-frail-white-sun',
      dayNightCycle: false,
      sky: { horizon: '#05070d', zenith: '#000000', haze: '#0b1018' },
      // High and slightly off-axis, so the diagram has a light direction to
      // read without a shadow-casting sun in the frame. Fixed, forever.
      sun: { color: '#ffffff', direction: { x: 0.24, y: 0.94, z: 0.26 }, discSize: 0.99988, strength: 0.5, scale: 0.3 },
      ambient: { color: '#0a1420', scale: 0.42 },
    },
    // The bead sea fades into the sky, not into a haze: dark, and barely denser
    // than the physical fog, so the horizon is a place beads stop being drawn.
    fog: { color: '#04060b', densityScale: 1.05 },
    palette: {
      bead: '#0d1a23',
      beadHighlight: '#9fd0ff',
      soul: '#17272f',
      flame: '#cfeaff',
      flameCore: '#ffffff',
      obsidian: '#05070a',
      obsidianHighlight: '#8fb6d8',
    },
  },

  variants: [
    {
      id: 'storm-shore',
      label: 'A · Storm shore',
      summary: 'Crem-grey rock under a hazy sky, warm sun, the pool the only cool colour.',
      sky: { horizon: '#cdc4b2', zenith: '#2b2a34', haze: '#cdc4b2' },
      fog: { color: '#cdc4b2', density: 0.0024 },
      ground: { low: '#5d564a', high: '#847a6b', accent: '#453f36' },
      props: { rock: '#4b453a', landmark: '#332f28' },
      perpendicularity: { pool: '#a9e8dd', glow: '#f2fffb' },
      sun: { color: '#fff0d6', direction: { x: 0.70, y: 0.50, z: 0.44 }, discSize: 0.9996 },
    },
    {
      id: 'highstorm-light',
      label: 'B · Highstorm light',
      summary: 'Colder and closer: the haze takes the sky, the needle is a hard shape in it.',
      sky: { horizon: '#9fb0bd', zenith: '#141b26', haze: '#9fb0bd' },
      fog: { color: '#9fb0bd', density: 0.0038 },
      ground: { low: '#4f5459', high: '#6f7680', accent: '#3c4249' },
      props: { rock: '#414a52', landmark: '#232c36' },
      perpendicularity: { pool: '#8fdfe6', glow: '#dff7fd' },
      sun: { color: '#e6f0ff', direction: { x: 0.60, y: 0.56, z: 0.50 }, discSize: 0.9996 },
    },
  ],
};
