/**
 * Entry point: wires settings, world state, the player, the renderer, the sim
 * loop and the dev UI together.
 *
 * M1 scope: you can walk a world — W/A/S/D or a thumb-stick, look with the
 * mouse or a drag, space or a button to jump, with capsule-vs-heightfield
 * collision, and every feel number live in the tuning panel. The camera is
 * derived from the player every frame (third person by default, `?view=first`
 * for the eye) and is never a second copy of the world.
 */

import './style.css';
import { APP, SIM, PLAYER } from './core/config.js';
import { createFixedClock } from './core/clock.js';
import { createFrameStats } from './core/frame-stats.js';
import { createWorldState, countEntities, entityHash, stepWorld } from './core/world-state.js';
import { buildSnapshot } from './core/snapshot.js';
import { createCameraState, resolveCamera } from './core/camera.js';
import { getMap, getVariant, DEFAULT_MAP_ID } from './core/maps/index.js';
import {
  parseSettings,
  coerceSetting,
  SETTING_BY_KEY,
  defaultSettings,
  saveSettings,
  loadSettings,
  clearStoredSettings,
  parseFlag,
} from './core/settings.js';
import { createView } from './render/renderer.js';
import { createWorldView } from './render/world-view.js';
import { createInput } from './platform/input.js';
import { createDebugOverlay } from './ui/debug-overlay.js';
import { createTuningPanel } from './ui/tuning-panel.js';
import { createCredits } from './ui/credits.js';
import { createDock } from './ui/dock.js';
import { HINTS, createHud } from './ui/hud.js';

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
    touch: parseFlag(params, 'touch'),
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
  // One camera object for the whole session: rebuild the *values* every frame,
  // never the object (nothing in the loop allocates).
  const camera = createCameraState();

  // The HUD owns the touch surfaces; input drives them. Build the HUD first —
  // it used to be the other way round, which left the jump button dead on a
  // phone because the element did not exist yet when input looked for it.
  const coarse = detectTouch(flags.touch);
  const hud = createHud({ mount: uiMount, coarsePointer: coarse, onJump: () => {} });
  const input = createInput({
    canvas,
    onHotkey,
    onCaptureChange: (captured) => hud.setCaptured(captured),
    sensitivity: () => ({ drag: settings.look, mouse: settings.lookMouse }),
    captureEnabled: () => settings.captureMouse !== 'off',
    elements: { stick: hud.stick, knob: hud.knob, jump: hud.jump, sprint: hud.sprint },
  });

  const debugOverlay = createDebugOverlay({ mount: uiMount });
  const panel = createTuningPanel({
    mount: uiMount,
    settings,
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
    describe: () => describeSettingsSafe(settings),
    setSetting: (key, raw) => applySetting(key, raw),
    /** Input counters, so a dead drag reports which stage went missing. */
    input: () => input.stats(),
    /** Mouse capture, for the desktop-look tests. */
    capture: () => input.captureState(),
    requestCapture: () => input.requestCapture(),
    releaseCapture: () => input.releaseCapture(),
    /**
     * Freeze/unfreeze the frame loop's simulation. The renderer keeps drawing,
     * but nothing advances the world, so a headless test can drive the sim
     * itself with step() and get the same answer on any machine.
     */
    pause: (paused = true) => {
      pausedSim = Boolean(paused);
      last = performance.now();
      return pausedSim;
    },
    /**
     * Advance the simulation by exactly `seconds` of fixed steps, using the
     * input state as it is right now (a held key, a pushed stick, a queued
     * jump). Returns a fresh snapshot. This is the deterministic clock the e2e
     * suite uses; it is inert during normal play.
     */
    step: (seconds = 0) => {
      const steps = Math.max(0, Math.min(3600, Math.round(seconds / clock.step)));
      clock.recordManualSteps(steps);
      const look = input.look();
      const move = input.move();
      const jump = input.consumeJump();
      const sprint = input.sprinting();
      for (let i = 0; i < steps; i++) {
        stepWorld(
          state,
          clock.step,
          {
            move,
            lookImpulse: i === 0 ? look.impulse : null,
            lookRate: look.rate,
            jump: i === 0 ? jump : false,
            sprint,
          },
          context,
        );
      }
      return snapshot();
    },
    player: () => ({ ...state.player, position: { ...state.player.position }, velocity: { ...state.player.velocity } }),
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

  // Context the fixed-step simulation needs, rebuilt whenever the map or the
  // settings change — the sim itself never reaches for globals.
  let context = { map, seed: state.seed, obstacles: state.obstacles, settings };
  const refreshContext = () => {
    context = { map, seed: state.seed, obstacles: state.obstacles, settings };
  };

  // --- sim loop -----------------------------------------------------------
  let last = performance.now();
  let frames = 0;
  let touchSeen = coarse;
  let pausedSim = false;

  function frame(now) {
    const dtSeconds = Math.min((now - last) / 1000, SIM.maxFrameDelta);
    last = now;
    frameStats.sample(dtSeconds);

    // Paused (debug only): time stands still, so the sim can be stepped by hand.
    const steps = pausedSim ? 0 : clock.advance(dtSeconds);
    if (steps > 0) {
      const look = input.look();
      const move = input.move();
      const jump = input.consumeJump();
      const sprint = input.sprinting();

      for (let i = 0; i < steps; i++) {
        stepWorld(
          state,
          clock.step,
          {
            move,
            // A drag is a one-shot: apply it on the first substep only, or a
            // fast flick would be multiplied by the number of substeps.
            lookImpulse: i === 0 ? look.impulse : null,
            lookRate: look.rate,
            jump: i === 0 ? jump : false,
            sprint,
          },
          context,
        );
      }
    }

    // Touch controls appear the first time a finger does anything (or if the
    // device says it is coarse), and never on a plain desktop session.
    if (!touchSeen && input.touchMode()) {
      touchSeen = true;
      hud.setTouchControls(true);
    }

    view.setFov(settings.fov);
    view.resize();
    // The camera is derived from the player; the sim never reads it back.
    resolveCamera({ player: state.player, settings, map, seed: state.seed, obstacles: state.obstacles }, camera);
    view.camera.position.set(camera.x, camera.y, camera.z);
    view.camera.rotation.set(camera.pitch, camera.yaw, 0);
    world.sync(state, camera, dtSeconds);
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

  hud.setTouchControls(coarse);
  // A button nobody can see must not still be sprinting: the phone toggle only
  // counts while its button exists.
  if (!coarse) input.setSprint(false);
  // Tell the owner what the mouse is doing: capture it, or drag instead.
  if (coarse) hud.setHint(HINTS.touch);
  else if (!input.canCapture()) hud.setHint(HINTS.desktopNoCapture);
  else hud.setHint(HINTS.desktopUncaptured);
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
      refreshContext();
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
    refreshContext();
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
    refreshContext();
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
    else if (action === 'panel') {
      // A captured mouse cannot click sliders: give the cursor back.
      if (panel.visible) panel.hide();
      else {
        input.releaseCapture();
        panel.show();
      }
    } else if (action === 'credits') {
      if (credits.visible) credits.hide();
      else {
        input.releaseCapture();
        credits.show();
      }
    } else if (action === 'palette') cyclePalette();
    else if (action === 'resetView') {
      state.player.yaw = 0;
      state.player.pitch = -0.04;
    }
  }

  /** The one shape shared by window.__debug(), the overlay and the reports. */
  function snapshot() {
    const info = view.info();
    const stick = input.stickState();
    return buildSnapshot({
      app: APP,
      state,
      map,
      variant,
      settings,
      clock,
      frameStats,
      render: {
        ...info,
        // The renderer's own answer to "which body is on screen", not the
        // setting read back: the test is that the swap happened.
        avatarVariant: world.stats().avatarVariant,
        gl: view.contextInfo(),
      },
      ui: {
        overlay: debugOverlay.visible,
        panel: panel.visible,
        credits: credits.visible,
        touch: !hud.jump.hidden,
      },
      paused: pausedSim,
      input: {
        mode: touchSeen ? 'touch' : 'keyboard',
        capture: input.captureState(),
        captured: input.isCaptured(),
        stick: stick.active ? { x: round(stick.x, 3), y: round(stick.y, 3), magnitude: round(stick.magnitude, 3) } : null,
        looking: input.isDragging(),
        heldKeys: input.heldKeys().length,
        sprint: input.sprinting(),
      },
      ready: debugApi.ready,
    });
  }
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function describeSettingsSafe(settings) {
  const parts = [];
  for (const [key, def] of Object.entries(SETTING_BY_KEY)) {
    if (settings[key] !== def.default) parts.push(`${def.param}=${settings[key]}`);
  }
  return parts.length > 0 ? parts.join(' ') : 'all defaults';
}

// --- helpers --------------------------------------------------------------

/** Touch-first detection: hardware capability, plus the ?touch=1 override. */
function detectTouch(force = false) {
  if (force) return true;
  if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0) return true;
  if (typeof matchMedia === 'function') {
    if (matchMedia('(pointer: coarse)').matches) return true;
    if (matchMedia('(hover: none)').matches) return true;
  }
  return false;
}

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
