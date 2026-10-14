/**
 * Entry point: wires settings, world state, the renderer, the sim loop and the
 * dev UI together.
 *
 * M0 scope: a blank (non-interactive) world with a sky, a faceted ground, a
 * landmark silhouette and fog — plus the harness the whole project is graded
 * on (debug overlay, tuning panel, `window.__debug()`).
 */

import './style.css';
import { APP, SIM } from './core/config.js';
import { createFixedClock } from './core/clock.js';
import { createFrameStats } from './core/frame-stats.js';
import { createWorldState, stepWorld } from './core/world-state.js';
import { buildSnapshot } from './core/snapshot.js';
import { getMap, getVariant, DEFAULT_MAP_ID } from './core/maps/index.js';
import {
  parseSettings,
  coerceSetting,
  SETTING_BY_KEY,
  defaultSettings,
  saveSettings,
  loadSettings,
  clearStoredSettings,
  describeSettings,
  parseFlag,
} from './core/settings.js';
import { createView } from './render/renderer.js';
import { createWorldView } from './render/world-view.js';
import { createInput } from './platform/input.js';
import { createDebugOverlay } from './ui/debug-overlay.js';
import { createTuningPanel } from './ui/tuning-panel.js';
import { createCredits } from './ui/credits.js';
import { createDock } from './ui/dock.js';

const canvas = document.getElementById('game');
const uiMount = document.getElementById('ui');

bootstrap();

function bootstrap() {
  const params = new URLSearchParams(location.search);
  const storage = safeStorage();
  const settings = parseSettings({ search: location.search, stored: loadSettings(storage) });
  const flags = {
    debug: parseFlag(params, 'debug'),
    dev: parseFlag(params, 'dev'),
  };

  const map = getMap(DEFAULT_MAP_ID);
  let variant = getVariant(map.id, settings.palette);
  let state = createWorldState({ map, seed: settings.seed });

  const view = createView({
    canvas,
    settings,
    onContextLost: (event) => {
      event.preventDefault();
      showBanner('WebGL context lost — the browser took the canvas away. Reload to continue.');
    },
  });
  view.resize();

  let world = createWorldView({ map, state, variant, settings });
  world.applySettings(settings, variant);

  const clock = createFixedClock({ stepHz: SIM.fixedStepHz, maxSubsteps: SIM.maxSubsteps, maxFrameDelta: SIM.maxFrameDelta });
  const frameStats = createFrameStats();
  const input = createInput({ canvas, onHotkey });

  const debugOverlay = createDebugOverlay({ mount: uiMount });
  const panel = createTuningPanel({
    mount: uiMount,
    settings,
    // Quiet while a range input is dragged: replacing the URL on every pixel
    // would both churn history and drop the tool's own ?debug/?dev flags.
    onChange: (key, raw, options) => applySetting(key, raw, options),
    onReset: resetSettings,
    onRerollSeed: () => applySetting('seed', Math.floor(Math.random() * 2147483646) + 1),
  });
  const credits = createCredits({ mount: uiMount, settings, map, variant });
  const dock = createDock({
    mount: uiMount,
    onCredits: () => credits.toggle(),
    onPanel: () => panel.toggle(),
    onOverlay: () => debugOverlay.toggle(),
    onPalette: () => cyclePalette(),
  });
  dock.setDevVisible(flags.dev);
  if (flags.debug) debugOverlay.show();

  // Expose the debug surface the headless smoke test asserts against (§8).
  const debugApi = {
    ready: false,
    version: APP.version,
    milestone: APP.milestone,
    debug: () => snapshot(),
    settings: () => ({ ...settings }),
    describe: () => describeSettings(settings),
    setSetting: (key, raw) => applySetting(key, raw),
    /** Input counters, so a dead drag reports which stage went missing. */
    input: () => input.stats(),
    ui: {
      showOverlay: (visible) => (visible ? debugOverlay.show() : debugOverlay.hide()),
      showPanel: (visible) => (visible ? panel.show() : panel.hide()),
      showCredits: (visible) => (visible ? credits.show() : credits.hide()),
      configUrl: () => panel.configValue,
    },
  };
  // eslint-disable-next-line no-underscore-dangle
  window.__debug = debugApi.debug;
  window.__worldhopper = debugApi;

  syncUrl();
  window.addEventListener('resize', () => view.resize());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) input.reset();
  });

  // --- sim loop -----------------------------------------------------------
  let last = performance.now();
  let frames = 0;

  function frame(now) {
    const dtSeconds = Math.min((now - last) / 1000, SIM.maxFrameDelta);
    last = now;
    frameStats.sample(dtSeconds);

    const steps = clock.advance(dtSeconds);
    const lookRate = input.keyLook();
    const drag = steps > 0 ? input.consumeDrag() : { yaw: 0, pitch: 0 };

    for (let i = 0; i < steps; i++) {
      stepWorld(state, clock.step, {
        lookRate,
        lookImpulse: i === 0 ? drag : null,
        sensitivity: settings.look,
      });
    }

    view.setFov(settings.fov);
    view.resize();
    view.camera.position.set(state.observer.position.x, state.observer.position.y, state.observer.position.z);
    view.camera.rotation.set(state.observer.pitch, state.observer.yaw, 0);
    world.sync(state);
    view.render(world.scene);

    debugOverlay.refresh(snapshot());
    frames++;
    if (!debugApi.ready && frames >= 2) {
      debugApi.ready = true;
      document.documentElement.dataset.ready = 'true';
      document.title = `${APP.title} — ${map.label}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- settings plumbing --------------------------------------------------
  /**
   * Apply one tunable.
   *
   * `persist: false` is used while a slider is being dragged: the world follows
   * the value live, but localStorage and the URL wait for the gesture to end,
   * so history is not churned and the tool's own ?debug/?dev flags survive.
   */
  function applySetting(key, raw, { persist = true } = {}) {
    const def = SETTING_BY_KEY[key];
    if (!def) return undefined;
    const value = coerceSetting(def, raw);
    if (value === undefined) return undefined;
    const changed = settings[key] !== value;
    settings[key] = value;

    if (changed) {
      if (key === 'seed') {
        state = createWorldState({ map, seed: value });
        rebuildWorld();
      } else if (key === 'palette') {
        variant = getVariant(map.id, value);
      }
      world.applySettings(settings, variant);
    }
    if (persist) {
      saveSettings(storage, settings);
      syncUrl();
      panel.sync(settings);
    }
    return value;
  }

  function resetSettings() {
    const defaults = defaultSettings();
    clearStoredSettings(storage);
    Object.assign(settings, defaults);
    variant = getVariant(map.id, settings.palette);
    state = createWorldState({ map, seed: settings.seed });
    rebuildWorld();
    world.applySettings(settings, variant);
    panel.sync(settings);
    syncUrl();
  }

  function cyclePalette() {
    const ids = map.variants.map((v) => v.id);
    const next = ids[(ids.indexOf(settings.palette) + 1) % ids.length];
    applySetting('palette', next);
  }

  function rebuildWorld() {
    world.dispose();
    world = createWorldView({ map, state, variant, settings });
  }

  function syncUrl() {
    const query = new URLSearchParams();
    // Rebuilt from scratch each time; the boot flags are re-added below so a
    // ?dev=1 session stays a ?dev=1 session.
    for (const [key, def] of Object.entries(SETTING_BY_KEY)) {
      if (settings[key] !== def.default) query.set(def.param, String(settings[key]));
    }
    if (flags.debug) query.set('debug', '1');
    if (flags.dev) query.set('dev', '1');
    const search = query.toString();
    try {
      history.replaceState(null, '', search ? `?${search}` : location.pathname);
    } catch {
      /* history is unavailable in some sandboxes — harmless */
    }
    panel.refreshConfigUrl();
  }

  function onHotkey(action) {
    if (action === 'overlay') debugOverlay.toggle();
    else if (action === 'panel') panel.toggle();
    else if (action === 'credits') credits.toggle();
    else if (action === 'palette') cyclePalette();
    else if (action === 'resetView') {
      state.observer.yaw = 0;
      state.observer.pitch = -0.04;
    }
  }

  /** The one shape shared by window.__debug(), the overlay and the reports. */
  function snapshot() {
    const info = view.info();
    return buildSnapshot({
      app: APP,
      state,
      map,
      variant,
      settings,
      clock,
      frameStats,
      render: { ...info, gl: view.contextInfo() },
      ui: {
        overlay: debugOverlay.visible,
        panel: panel.visible,
        credits: credits.visible,
      },
      ready: debugApi.ready,
    });
  }
}

// --- helpers --------------------------------------------------------------

function safeStorage() {
  try {
    const probe = '__worldhopper_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function showBanner(message) {
  let banner = document.querySelector('.banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('role', 'alert');
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.hidden = false;
}

window.addEventListener('error', (event) => {
  const message = event?.message ?? 'unknown error';
  if (message.includes('Script error')) return;
  showBanner(`Something broke: ${message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  showBanner(`Something broke: ${event?.reason?.message ?? event.reason}`);
});
