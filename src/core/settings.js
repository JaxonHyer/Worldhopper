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

import { DEFAULT_MAP_ID, listVariants } from './maps/index.js';
import { hashSeed } from './rng.js';

export const SETTINGS_STORAGE_KEY = 'worldhopper.settings.v1';

/**
 * kind: 'int' | 'float' | 'enum'
 * phase: which milestone makes the control live (panel shows later ones disabled)
 */
export const SETTING_DEFS = Object.freeze([
  {
    key: 'seed',
    param: 'seed',
    kind: 'int',
    label: 'World seed',
    help: 'Rebuilds the whole map. Paste a seed back to the agent to reproduce a run.',
    min: 1,
    max: 2147483646,
    step: 1,
    allowHash: true,
    default: 20261014,
    phase: 'm0',
  },
  {
    key: 'palette',
    param: 'palette',
    kind: 'enum',
    label: 'Palette variant',
    help: 'A taste call: same geometry, different atmosphere.',
    values: listVariants(DEFAULT_MAP_ID),
    default: 'ashen-basin',
    phase: 'm0',
  },
  {
    key: 'fog',
    param: 'fog',
    kind: 'float',
    label: 'Fog density',
    help: 'How far you can see. Lower = clearer.',
    min: 0,
    max: 0.012,
    step: 0.0001,
    decimals: 4,
    default: 0.0028,
    phase: 'm0',
  },
  {
    key: 'sun',
    param: 'sun',
    kind: 'float',
    label: 'Sun intensity',
    min: 0,
    max: 3,
    step: 0.05,
    decimals: 2,
    default: 2.0,
    phase: 'm0',
  },
  {
    key: 'ambient',
    param: 'ambient',
    kind: 'float',
    label: 'Ambient light',
    min: 0,
    max: 2,
    step: 0.05,
    decimals: 2,
    default: 1.15,
    phase: 'm0',
  },
  {
    key: 'fov',
    param: 'fov',
    kind: 'float',
    label: 'Field of view',
    min: 50,
    max: 100,
    step: 1,
    decimals: 0,
    default: 72,
    phase: 'm0',
  },
  {
    key: 'look',
    param: 'look',
    kind: 'float',
    label: 'Look sensitivity',
    min: 0.2,
    max: 4,
    step: 0.05,
    decimals: 2,
    default: 1,
    phase: 'm0',
  },
  // --- M1: how walking feels. Everything here changes the sim immediately. ---
  {
    key: 'walkSpeed',
    param: 'walk',
    kind: 'float',
    label: 'Walk speed (m/s)',
    help: 'Top speed on flat ground.',
    min: 1,
    max: 14,
    step: 0.1,
    decimals: 1,
    default: 5.5,
    phase: 'm1',
  },
  {
    key: 'jumpHeight',
    param: 'jump',
    kind: 'float',
    label: 'Jump height (m)',
    help: 'Peak height of a jump from flat ground.',
    min: 0.3,
    max: 4,
    step: 0.1,
    decimals: 1,
    default: 1.5,
    phase: 'm1',
  },
  {
    key: 'gravity',
    param: 'gravity',
    kind: 'float',
    label: 'Gravity (m/s²)',
    help: 'Lower feels floatier; jump height stays what you set it to.',
    min: 4,
    max: 40,
    step: 0.5,
    decimals: 1,
    default: 18,
    phase: 'm1',
  },
  {
    key: 'accel',
    param: 'accel',
    kind: 'float',
    label: 'Acceleration (m/s²)',
    help: 'How hard you speed up and stop. High = twitchy, low = ice.',
    min: 4,
    max: 140,
    step: 1,
    decimals: 0,
    default: 45,
    phase: 'm1',
  },
  {
    key: 'viewBob',
    param: 'bob',
    kind: 'float',
    label: 'View bob (m)',
    help: 'Walking head movement. 0 disables it entirely.',
    min: 0,
    max: 0.2,
    step: 0.005,
    decimals: 3,
    default: 0.035,
    phase: 'm1',
  },
  // --- declared now, wired later: the panel renders these disabled so the
  // owner can see where the feel controls will live. Nothing here is active.
  { key: 'swapWindow', param: 'swap', kind: 'float', label: 'Attunement swap window (s)', min: 0, max: 2, step: 0.05, decimals: 2, default: 0.45, phase: 'm6', live: false },
]);

export const SETTING_BY_KEY = Object.freeze(
  Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d])),
);

export function defaultSettings() {
  const out = {};
  for (const def of SETTING_DEFS) out[def.key] = def.default;
  return out;
}

/** Coerce one raw value against its def. Returns undefined when unusable. */
export function coerceSetting(def, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
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
    params.set(def.param, def.kind === 'float' ? String(value) : String(value));
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
