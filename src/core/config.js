/**
 * Global app constants + the scale fence.
 *
 * The scale fence (AGENT_PROMPT.md §5) is enforced here as data so that
 * `tests/unit/scale-fence.test.js` can fail the build if anyone drifts.
 */

export const APP = Object.freeze({
  title: 'Worldhopper',
  subtitle: 'working title',
  version: '0.1.0',
  milestone: 'M0 · foundation',
  /** Required by AGENT_PROMPT.md §9: in-game + README notice. */
  notice:
    'Unofficial, non-commercial fan work. Not affiliated with, endorsed by, or sponsored by ' +
    'Brandon Sanderson or Dragonsteel Entertainment.',
});

/**
 * Load-bearing numbers from the scale fence. Tests assert these; do not
 * raise them without the owner saying yes (AGENT_PROMPT.md §5).
 */
export const FENCE = Object.freeze({
  /** metres — camera near plane must be >= this */
  cameraNearMin: 0.3,
  /** metres — camera far plane must be <= this */
  cameraFarMax: 5000,
  /** metres — a whole star system spans at most this much (when systems exist) */
  systemSpanMax: 8000,
  /** metres — debug overlay turns red past this distance from origin */
  originWarnDistance: 4000,
  /** metres — minimum offset for any surface laid on top of another (z-fighting) */
  minSurfaceOffset: 0.01,
  /** metres — fog must fully hide the world before the far plane */
  fogHideDistanceMax: 5000,
});

/**
 * The player. Metres, seconds. Feel numbers (speed, jump, gravity, view bob)
 * are settings the owner tunes; these are structural.
 */
export const PLAYER = Object.freeze({
  /** capsule radius (m) — also the ring used for ground sampling */
  radius: 0.35,
  /** camera height above the feet (m) */
  eyeHeight: 1.7,
  /** how tall a bump can be before it becomes a wall (m) */
  stepHeight: 0.45,
  /** terminal fall speed (m/s) */
  maxFallSpeed: 32,
  /** grace period for jumping just after walking off an edge (s) */
  coyoteTime: 0.12,
  /** grace period for pressing jump just before landing (s) */
  jumpBufferTime: 0.15,
  /** fraction of ground acceleration available in the air */
  airControl: 0.35,
  /** metres per full stride cycle (one swing of each leg) */
  strideLength: 1.6,
  /**
   * How fast the legs may swing, in cycles per second, when the player has not
   * tuned it. Speed would otherwise drive it without limit: at the default
   * 7.9 m/s and a 1.6 m stride that is 4.9 cycles/second, which reads as a
   * vibration rather than as running (the owner, 2026-10-15: "too quick /
   * jittery because of the walk speed"). A human sprints at about 1.5.
   */
  maxStrideRate: 2,
  /** how far above walk speed the limbs keep widening their swing */
  strideStretchMax: 1.35,
});

/**
 * Camera. The player is drawn in third person by default (the owner's call):
 * the boom sits behind the character and looks at a point at chest height.
 *
 * Structural numbers only — the view switch and the boom length are settings,
 * so the owner tunes them in the panel. The camera is *never* allowed under the
 * ground or inside a rock: it pulls in instead, and FENCE.cameraNearMin still
 * holds, so a short boom does not clip.
 */
export const CAMERA = Object.freeze({
  /** metres above the feet that the boom aims at (chest height, not the eyes) */
  targetHeight: 1.35,
  /** boom length when the setting is untouched (m) */
  distance: 4.2,
  /** shortest boom: closer than this and the camera is inside the head (m) */
  minDistance: 1.1,
  /** longest boom the slider allows (m) */
  maxDistance: 8,
  /** metres of clearance kept between the camera and whatever is behind it */
  clearance: 0.35,
  /** samples used to find the first obstruction along the boom (fixed cost) */
  samples: 8,
  /** below this boom length the avatar is hidden: the camera is inside it (m) */
  hideAvatarBelow: 1.0,
  /**
   * Third-person pitch range (rad). Looking *up* swings the boom down towards
   * the floor, so the upper bound is what keeps the camera out of the ground;
   * the lower bound (looking down) is where a shoulder camera is most useful.
   */
  pitchMin: -1.1,
  pitchMax: 0.6,
});

/**
 * Simulation loop. Fixed timestep so runs are reproducible from a seed. */
export const SIM = Object.freeze({
  fixedStepHz: 60,
  /** Max sim steps per rendered frame (spiral-of-death guard). */
  maxSubsteps: 5,
  /** Frame deltas longer than this are treated as tab-switches, not gameplay. */
  maxFrameDelta: 0.25,
});

/** Realm ids. Both realms read the *same* world state (AGENT_PROMPT.md §2). */
export const REALMS = Object.freeze({
  physical: 'physical',
  cognitive: 'cognitive',
});

/** Renderer budgets — frame-loop hygiene, not visual taste. */
export const RENDER = Object.freeze({
  maxPixelRatio: 2,
  /** Ground plane resolution cap (vertices ~ (n+1)^2). */
  groundMaxSegments: 192,
  /** A ground facet larger than this reads as an abstract slab, not terrain. */
  groundMaxFacetSize: 12,
});

export const FLAG_DEFAULTS = Object.freeze({
  debug: false,
  dev: false,
});
