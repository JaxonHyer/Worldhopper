/**
 * Tunables: one schema, three consumers — the tuning panel, the URL
 * (`?fog=0.004&seed=emberdark`) and localStorage.
 *
 * The owner tunes feel through the panel and pastes the generated config link
 * back to the agent; the agent never has to guess at numbers. Everything here
 * is pure so it can be unit-tested without a browser.
 *
 * Precedence: URL > localStorage > defaults. Out-of-range or malformed values
 * fall back to the next source, never NaN.
 */

import { DEFAULT_MAP_ID, getMap, listVariants } from './maps/index.js';
import { hashSeed } from './rng.js';

export const SETTINGS_STORAGE_KEY = 'worldhopper.settings.v1';

/**
 * Panel sections, in the order they are shown. Eighteen sliders in one column
 * is a wall on a phone; the groups are also the honest answer to "which of
 * these are about walking, and which about looking?".
 */
export const SETTING_GROUPS = Object.freeze([
  { id: 'world', label: 'world' },
  { id: 'player', label: 'the player' },
  { id: 'realm', label: 'the realm' },
  { id: 'camera', label: 'camera & looking' },
  { id: 'movement', label: 'walking & jumping' },
  { id: 'combat', label: 'combat & encounters' },
  { id: 'future', label: 'later milestones' },
]);

/**
 * kind: 'int' | 'float' | 'enum'
 * phase: which milestone makes the control live (panel shows later ones disabled)
 */
export const SETTING_DEFS = Object.freeze([
  {
    key: 'seed',
    group: 'world',
    param: 'seed',
    kind: 'int',
    label: 'World seed',
    help: 'Rebuilds the whole map. Paste a seed back to the agent to reproduce a run.',
    min: 1,
    max: 2147483646,
    step: 1,
    allowHash: true,
    default: 1607255203,
    phase: 'm0',
  },
  {
    key: 'palette',
    group: 'world',
    param: 'palette',
    kind: 'enum',
    label: 'Palette variant',
    help: 'A taste call: same geometry, different atmosphere.',
    // Derived from the world the game opens on, because a palette name is
    // per-world data. `setPaletteOptions` re-points both of these when the
    // player is somewhere else — but the table has to be self-consistent on its
    // own, before any boot code runs (a unit test checks exactly that).
    values: listVariants(DEFAULT_MAP_ID),
    default: defaultPaletteOf(DEFAULT_MAP_ID),
    phase: 'm0',
  },
  {
    key: 'fog',
    group: 'world',
    param: 'fog',
    kind: 'float',
    label: 'Fog density',
    help: 'How far you can see. Lower = clearer.',
    min: 0,
    max: 0.012,
    step: 0.0001,
    decimals: 4,
    default: 0.0026,
    phase: 'm0',
  },
  {
    key: 'sun',
    group: 'world',
    param: 'sun',
    kind: 'float',
    label: 'Sun intensity',
    min: 0,
    max: 3,
    step: 0.05,
    decimals: 2,
    default: 2.4,
    phase: 'm0',
  },
  {
    key: 'ambient',
    group: 'world',
    param: 'ambient',
    kind: 'float',
    label: 'Ambient light',
    min: 0,
    max: 2,
    step: 0.05,
    decimals: 2,
    default: 1.25,
    phase: 'm0',
  },
  {
    key: 'fov',
    group: 'world',
    param: 'fov',
    kind: 'float',
    label: 'Field of view',
    min: 50,
    max: 100,
    step: 1,
    decimals: 0,
    default: 81,
    phase: 'm0',
  },
  {
    key: 'look',
    group: 'camera',
    param: 'look',
    kind: 'float',
    label: 'Look sensitivity (drag)',
    help: 'Drag-to-look on a phone, or with the mouse when capture is off.',
    min: 0.2,
    max: 4,
    step: 0.05,
    decimals: 2,
    default: 3.7,
    phase: 'm0',
  },
  {
    key: 'lookMouse',
    group: 'camera',
    param: 'mouselook',
    kind: 'float',
    label: 'Mouse look (captured)',
    help: 'Desktop only: sensitivity once the mouse is captured (click the world, Esc releases).',
    min: 0.2,
    max: 4,
    step: 0.05,
    decimals: 2,
    default: 3.45,
    phase: 'm1',
  },
  {
    key: 'captureMouse',
    group: 'camera',
    param: 'capture',
    kind: 'enum',
    values: ['on', 'off'],
    label: 'Mouse capture (click to lock)',
    help: 'Desktop only. on = click the world to capture the mouse, Esc releases. off = drag to look, as on a phone.',
    default: 'on',
    phase: 'm1',
  },
  // --- M1: the camera and how walking feels. All of it applies immediately. ---
  {
    key: 'view',
    group: 'camera',
    param: 'view',
    kind: 'enum',
    values: ['third', 'first'],
    label: 'Camera',
    help: 'third = over the shoulder, watching your character. first = through their eyes.',
    default: 'third',
    phase: 'm1',
  },
  {
    key: 'camDistance',
    group: 'camera',
    param: 'camdist',
    kind: 'float',
    label: 'Camera distance (m)',
    help: 'Third person only: how far the camera sits behind the player.',
    min: 1.2,
    max: 8,
    step: 0.1,
    decimals: 1,
    default: 4.2,
    phase: 'm1',
  },
  {
    key: 'walkSpeed',
    group: 'movement',
    param: 'walk',
    kind: 'float',
    label: 'Walk speed (m/s)',
    help: 'Top speed on flat ground.',
    min: 1,
    max: 14,
    step: 0.1,
    decimals: 1,
    default: 7.9,
    phase: 'm1',
  },
  {
    key: 'jumpHeight',
    group: 'movement',
    param: 'jump',
    kind: 'float',
    label: 'Jump height (m)',
    help: 'Peak height of a jump from flat ground.',
    min: 0.3,
    max: 4,
    step: 0.1,
    decimals: 1,
    default: 2.4,
    phase: 'm1',
  },
  {
    key: 'gravity',
    group: 'movement',
    param: 'gravity',
    kind: 'float',
    label: 'Gravity (m/s²)',
    help: 'Lower feels floatier; jump height stays what you set it to.',
    min: 4,
    max: 40,
    step: 0.5,
    decimals: 1,
    default: 30.5,
    phase: 'm1',
  },
  {
    key: 'accel',
    group: 'movement',
    param: 'accel',
    kind: 'float',
    label: 'Acceleration (m/s²)',
    help: 'How hard you speed up and stop. High = twitchy, low = ice.',
    min: 4,
    max: 140,
    step: 1,
    decimals: 0,
    default: 59,
    phase: 'm1',
  },
  {
    key: 'realmFade',
    group: 'realm',
    param: 'fadems',
    kind: 'float',
    label: 'Realm transition (ms)',
    help: 'How long the fade to black lasts when you shift realms at the Perpendicularity. 0 is an instant cut.',
    min: 0,
    max: 2000,
    step: 50,
    decimals: 0,
    default: 420,
    phase: 'm2',
  },
  {
    key: 'realmZoom',
    group: 'realm',
    param: 'realmzoom',
    kind: 'float',
    label: 'Cognitive lens height (m)',
    help: 'How much of the world the Cognitive lens shows, top to bottom. Smaller is closer in.',
    min: 16,
    max: 140,
    step: 1,
    decimals: 0,
    default: 46,
    phase: 'm2',
  },
  {
    key: 'girlPlayer',
    group: 'player',
    param: 'girl',
    kind: 'bool',
    label: 'Girl player character',
    help: 'The alternate player model: long hair, slimmer arms, different clothes. Off = the boy model.',
    default: false,
    phase: 'm1',
  },
  {
    key: 'sprint',
    group: 'movement',
    param: 'sprint',
    kind: 'float',
    label: 'Sprint multiplier (×)',
    help: 'How much faster sprinting is than walking. Hold Shift on a desktop; the sprint button on a phone.',
    min: 1,
    max: 3,
    step: 0.05,
    decimals: 2,
    // The owner's number (2026-10-15): "make the default sprint multiplier
    // 2.20" — a sprint should read as a sprint, not as a brisk walk.
    default: 2.2,
    phase: 'm1',
  },
  {
    key: 'strideRate',
    group: 'movement',
    param: 'striderate',
    kind: 'float',
    label: 'Animation speed cap (cycles/s)',
    help: 'How fast arms and legs may swing, however fast you walk. Lower = calmer.',
    min: 0.6,
    max: 6,
    step: 0.05,
    decimals: 2,
    default: 2,
    phase: 'm1',
  },
  {
    key: 'viewBob',
    group: 'movement',
    param: 'bob',
    kind: 'float',
    label: 'View bob (m)',
    help: 'Walking head movement. 0 disables it entirely.',
    min: 0,
    max: 0.2,
    step: 0.005,
    decimals: 3,
    default: 0.005,
    phase: 'm1',
  },
  // --- combat (WP-3.1 / WP-3.2) -------------------------------------------
  // Every one of these is a *feel* number, and the roadmap is blunt about who
  // owns them: "Combat timing is the deepest feel sink in the project — it is
  // tuned by the owner, never guessed by an agent." So they are all here, all
  // live, and all pasteable back as a config link.
  //
  // Two of them have floors that are not taste. `enemyWindup` cannot go below
  // 0.4 s and `maxEnemies` cannot go above 6, because those are the fairness
  // contract's numbers and a slider that could break them would let the owner
  // build an unfair game by accident.
  {
    key: 'hearts',
    group: 'combat',
    param: 'hearts',
    kind: 'int',
    label: 'Hearts',
    help: 'How much health you carry. Healing happens at beacons. No damage numbers, ever.',
    min: 3,
    max: 5,
    step: 1,
    default: 4,
    phase: 'm3',
  },
  {
    key: 'punchDamage',
    group: 'combat',
    param: 'punchdmg',
    kind: 'int',
    label: 'Punch damage (hearts)',
    help: 'How much of an enemy\u2019s health one punch takes.',
    min: 1,
    max: 3,
    step: 1,
    default: 1,
    phase: 'm3',
  },
  {
    key: 'punchCooldown',
    group: 'combat',
    param: 'punchcd',
    kind: 'float',
    label: 'Punch cooldown (s)',
    help: 'How soon you may swing again. Lower is faster, and easier to spam.',
    min: 0.2,
    max: 1.5,
    step: 0.02,
    decimals: 2,
    default: 0.42,
    phase: 'm3',
  },
  {
    key: 'enemyDamage',
    group: 'combat',
    param: 'enemydmg',
    kind: 'float',
    label: 'Enemy damage (×)',
    help: 'Multiplies what an enemy\u2019s strike costs you. 1 is the archetype\u2019s own number.',
    min: 0.5,
    max: 3,
    step: 0.25,
    decimals: 2,
    default: 1,
    phase: 'm3',
  },
  {
    key: 'enemyWindup',
    group: 'combat',
    param: 'windup',
    kind: 'float',
    label: 'Enemy wind-up (s)',
    help:
      'How long an enemy telegraphs before its attack lands. Cannot go under 0.4 s — that floor is the fairness contract.',
    min: 0.4,
    max: 2,
    step: 0.05,
    decimals: 2,
    default: 0.55,
    phase: 'm3',
  },
  {
    key: 'enemySpeed',
    group: 'combat',
    param: 'enemyspeed',
    kind: 'float',
    label: 'Enemy speed (×)',
    help: 'Multiplies how fast enemies walk and hunt. 1 is the archetype\u2019s own pace.',
    min: 0.4,
    max: 2,
    step: 0.05,
    decimals: 2,
    default: 1,
    phase: 'm3',
  },
  {
    key: 'enemyAggro',
    group: 'combat',
    param: 'aggro',
    kind: 'float',
    label: 'Aggro range (m)',
    help: 'How close you have to be before an enemy notices you. Each one also has a leash from its home.',
    min: 4,
    max: 40,
    step: 1,
    decimals: 0,
    default: 16,
    phase: 'm3',
  },
  {
    key: 'maxEnemies',
    group: 'combat',
    param: 'enemies',
    kind: 'int',
    label: 'Enemies alive at once',
    help: 'The roaming spawn director\u2019s ceiling. 0 turns encounters off. The hard limit is 6.',
    min: 0,
    max: 6,
    step: 1,
    default: 4,
    phase: 'm3',
  },
  // --- declared now, wired later: the panel renders these disabled so the
  // owner can see where the feel controls will live. Nothing here is active.
  { key: 'swapWindow', group: 'future', param: 'swap', kind: 'float', label: 'Attunement swap window (s)', min: 0, max: 2, step: 0.05, decimals: 2, default: 0.45, phase: 'm6', live: false },
]);

export const SETTING_BY_KEY = Object.freeze(
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);

export function defaultSettings() {
  const out = {};
  for (const def of SETTING_DEFS) out[def.key] = def.default;
  return out;
}

/** Human-readable one-line summary of a boolean setting, for reports. */
export function describeBoolean(key, settings) {
  const def = SETTING_BY_KEY[key];
  if (!def || def.kind !== 'bool') return `${key}=?`;
  return `${def.param}=${settings[key] ? 1 : 0}`;
}

/** Coerce one raw value against its def. Returns undefined when unusable. */
const TRUE_WORDS = new Set(['1', 'true', 'on', 'yes', 'y', 'girl', 'enabled']);
const FALSE_WORDS = new Set(['0', 'false', 'off', 'no', 'n', 'boy', 'disabled']);

/** Booleans are read the way a person would write them in a URL. */
export function coerceBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim().toLowerCase();
  if (text === '') return undefined;
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  // Anything else (a typo, junk) falls through to the next source, rather than
  // being read as "off" and silently changing a player's character.
  return undefined;
}

export function coerceSetting(def, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (def.kind === 'bool') return coerceBoolean(raw);
  if (def.kind === 'enum') {
    const value = String(raw);
    return def.values.includes(value) ? value : undefined;
  }
  const asText = typeof raw === 'number' ? '' : String(raw).trim();
  let num = typeof raw === 'number' ? raw : Number(asText);
  if (!Number.isFinite(num) && def.allowHash && asText.length > 0) {
    // `?seed=emberdark` is legal: words hash into the same seed space.
    num = hashSeed(asText) % (def.max - def.min + 1) + def.min;
  }
  if (!Number.isFinite(num)) return undefined;
  const clamped = Math.min(def.max, Math.max(def.min, num));
  if (def.kind === 'int') return Math.round(clamped);
  const rounded = def.decimals === undefined ? clamped : Number(clamped.toFixed(def.decimals));
  return Number.isFinite(rounded) ? rounded : undefined;
}

function readSource(def, source) {
  if (!source) return undefined;
  if (!(def.key in source) && !(def.param in source)) return undefined;
  const raw = def.key in source ? source[def.key] : source[def.param];
  return coerceSetting(def, raw);
}

/**
 * Merge defaults <- stored <- URL.
 * @param {{ search?: string, stored?: object }} [input]
 */
/** A map's declared opening palette, with a safe fallback to its first. */
function defaultPaletteOf(mapId) {
  const map = getMap(mapId);
  const values = listVariants(map.id);
  return values.includes(map.defaultPalette) ? map.defaultPalette : values[0];
}

/**
 * Point the palette setting at a map's variants, and at that map's default.
 *
 * Called at boot with the map that is actually loaded, *before* the settings are
 * parsed, because both halves are per-world data: a palette name only means
 * something on the world that invented it. `cold-ridge` is the owner's pick on
 * the test range and stays exactly that; Roshar opens on its own palette.
 *
 * Everything that reads a default (parsing, serialising, the panel, reset)
 * goes through the def, so this one call keeps them all consistent.
 */
export function setPaletteOptions(mapId) {
  const map = getMap(mapId);
  const values = listVariants(map.id);
  SETTING_BY_KEY.palette.values = values;
  SETTING_BY_KEY.palette.default = defaultPaletteOf(map.id);
  return values;
}

export function parseSettings({ search = '', stored = null, urlParams = null } = {}) {
  const params = urlParams ?? new URLSearchParams(search ?? '');
  const urlObject = {};
  for (const def of SETTING_DEFS) {
    const raw = params.get(def.param);
    if (raw !== null) urlObject[def.key] = raw;
  }
  const out = {};
  for (const def of SETTING_DEFS) {
    const fromUrl = readSource(def, urlObject);
    const fromStore = readSource(def, stored);
    out[def.key] = fromUrl ?? fromStore ?? def.default;
  }
  return out;
}

/** Serialise settings to a query string, keeping only non-default values. */
export function serializeSettings(settings, { includeDefaults = false } = {}) {
  const params = new URLSearchParams();
  for (const def of SETTING_DEFS) {
    const value = settings[def.key];
    if (value === undefined) continue;
    if (!includeDefaults && value === def.default) continue;
    params.set(def.param, def.kind === 'bool' ? (value ? '1' : '0') : String(value));
  }
  const str = params.toString();
  return includeDefaults || str.length === 0 ? str : str;
}

/** Full config link the owner can copy and paste back to the agent. */
export function buildConfigUrl(settings, { baseUrl } = {}) {
  const base = baseUrl ?? (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://example.invalid/');
  const query = serializeSettings(settings, { includeDefaults: true });
  return `${base}?${query}`;
}

/** Human-readable one-line diff against defaults, for the panel + reports. */
export function describeSettings(settings) {
  const parts = [];
  for (const def of SETTING_DEFS) {
    if (settings[def.key] !== def.default) parts.push(`${def.param}=${settings[def.key]}`);
  }
  return parts.length > 0 ? parts.join(' ') : 'all defaults';
}

/** Persist the tunables that are live (never throws, storage can be blocked). */
export function saveSettings(storage, settings) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(serializeObject(settings)));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearStoredSettings(storage) {
  try {
    storage?.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function serializeObject(settings) {
  const out = {};
  for (const def of SETTING_DEFS) out[def.key] = settings[def.key];
  return out;
}

export function settingsEqual(a, b) {
  return SETTING_DEFS.every((def) => a[def.key] === b[def.key]);
}

export function formatSettingValue(def, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (def.kind === 'bool') return value ? 'on' : 'off';
  if (def.kind === 'enum') return String(value);
  if (def.kind === 'int') return String(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  if (def.decimals === 0) return String(Math.round(number));
  return number.toFixed(def.decimals ?? 2);
}

/** '1' -> true, '0'/'false' -> false, absent -> fallback. */
export function parseFlag(params, name, fallback = false) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = raw.toLowerCase();
  if (value === '' || value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}
