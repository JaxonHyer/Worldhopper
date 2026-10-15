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
  /** metres per full view-bob cycle */
  strideLength: 1.6,
});

/** Simulation loop. Fixed timestep so runs are reproducible from a seed. */
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
