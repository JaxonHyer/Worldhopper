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
import { APP, REALMS, SIM } from './core/config.js';
import { createFixedClock } from './core/clock.js';
import { createFrameStats } from './core/frame-stats.js';
import { createWorldState, respawn, setRealm, stepWorld, toggleRealm } from './core/world-state.js';
import { COMBAT, setHearts } from './core/combat.js';
// The Perpendicularity's rule lives in the core, where it can be tested without
// a browser: this file only decides *when* to ask it (M2).
import { gateStatus, gateStep } from './core/gate.js';
import { buildSnapshot } from './core/snapshot.js';
import { createCameraState, resolveCamera } from './core/camera.js';
import { getMap, getVariant, hasMap, DEFAULT_MAP_ID } from './core/maps/index.js';
import {
  SETTING_BY_KEY,
  clearStoredSettings,
  coerceSetting,
  defaultSettings,
  loadSettings,
  parseFlag,
  parseSettings,
  saveSettings,
  setPaletteOptions,
} from './core/settings.js';
import { createView } from './render/renderer.js';
import { createWorldView } from './render/world-view.js';
import { createInput } from './platform/input.js';
import { createDebugOverlay } from './ui/debug-overlay.js';
import { createFade } from './ui/fade.js';
import { createTuningPanel } from './ui/tuning-panel.js';
import { createCredits } from './ui/credits.js';
import { createDock } from './ui/dock.js';
import { HINTS, createHud } from './ui/hud.js';
import { createHealthHud } from './ui/health.js';
import { createDialog } from './ui/dialog.js';
import { createDialogueMachine, loadNpc } from './content/npcs.js';
import { nearestInteractableNpc } from './render/npc-view.js';

const canvas = document.getElementById('game');
const uiMount = document.getElementById('ui');

try {
  bootstrap();
} catch (error) {
  reportStartFailure(error);
  throw error;
}

function bootstrap() {
  const params = new URLSearchParams(location.search);
  const storage = safeStorage();
  // Which world, before the settings are parsed: the palette dropdown is
  // per-map data (`listVariants`), and a palette name only coerces if it is in
  // the list — so `?map=roshar&palette=highstorm-light` has to know the map
  // *first*, or the palette it names is rejected as unknown.
  const wantedMap = params.get('map')?.toLowerCase() ?? '';
  const mapId = hasMap(wantedMap) ? wantedMap : DEFAULT_MAP_ID;
  setPaletteOptions(mapId);
  const settings = parseSettings({ search: location.search, stored: loadSettings(storage) });
  const flags = {
    debug: parseFlag(params, 'debug'),
    dev: parseFlag(params, 'dev'),
    touch: parseFlag(params, 'touch'),
    /** start in the lens: `?realm=cognitive` (a start state, not a control) */
    cognitive: params.get('realm')?.toLowerCase() === 'cognitive',
  };

  // A URL flag rather than a setting, because a map is not a feel number: the
  // owner's tuned sliders and pinned defaults belong to the map they were tuned
  // on, and `?map=roshar` must not quietly rewrite them.
  const map = getMap(mapId);
  let variant = getVariant(map.id, settings.palette);
  let state = createWorldState({ map, seed: settings.seed });
  // The realm is a lens over the world, and `?realm=cognitive` is how a
  // screenshot or an automated run starts inside it without walking there.
  if (flags.cognitive) setRealm(state, REALMS.cognitive);

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
  // Hearts, the red vignette and the death card (WP-3.1). Built before `input`
  // for the same reason the HUD is: the punch button has to exist before input
  // looks for it, or it is a button nothing is wired to.
  const health = createHealthHud({ mount: uiMount });
  // The realm transition. Reduced motion gets a short beat instead of a long
  // one — the black frame is the one piece of the UI a photosensitivity setting
  // has to respect (M8 lists the option; it costs three lines to honour now).
  const reduceMotion =
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The transition is a feel number (a slider), except that a reduced-motion
  // session caps it: the black frame is the one piece of this UI that has to
  // respect that preference.
  const fadeDuration = () => {
    const wanted = Number.isFinite(settings.realmFade) ? Math.max(0, settings.realmFade) : 420;
    return reduceMotion ? Math.min(wanted, 120) : wanted;
  };
  const fade = createFade({ mount: uiMount, fadeMs: fadeDuration() });

  // NPC dialog UI + interaction prompt. The prompt is a DOM element that sits
  // at the bottom of the screen when the player is close enough to talk; it is
  // also a button on touch so the player can tap it (phone-first: one clear
  // tap affordance, not a keyboard-only binding).
  const dialog = createDialog({ mount: uiMount });
  const interactPrompt = document.createElement('button');
  interactPrompt.type = 'button';
  interactPrompt.className = 'interact-prompt';
  interactPrompt.hidden = true;
  interactPrompt.innerHTML = '<span>Talk</span><span class="interact-prompt__hint"><kbd>F</kbd> on desktop · tap on phone</span>';
  interactPrompt.addEventListener('click', () => {
    input.queueInteract();
  });
  uiMount.appendChild(interactPrompt);

  const input = createInput({
    canvas,
    onHotkey,
    onCaptureChange: (captured) => hud.setCaptured(captured),
    sensitivity: () => ({ drag: settings.look, mouse: settings.lookMouse }),
    captureEnabled: () => settings.captureMouse !== 'off',
    elements: {
      stick: hud.stick,
      knob: hud.knob,
      jump: hud.jump,
      sprint: hud.sprint,
      attack: hud.attack,
    },
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
    /**
     * The realm, for the harness and for the owner's troubleshooting. Not a
     * player control: in the game the only way to shift is to walk into the
     * Perpendicularity, which is why this is on `__worldhopper` and not on an
     * input binding.
     */
    realm: (id) => {
      if (id === undefined) return state.realm;
      return setRealm(state, id);
    },
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
      const attack = input.consumeAttack();
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
            attack: i === 0 ? attack : false,
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
  /**
   * Has the Perpendicularity got its "you may fire" flag?
   *
   * This one declaration is load-bearing: without it, `gateArmed = ...` inside
   * the frame loop is an assignment to an undeclared name, which is a
   * ReferenceError in a module — thrown on the *first frame*, so the loop never
   * reschedules, `ready` is never set, and every test in the suite times out
   * waiting for a game that stopped before it drew anything. It cost three CI
   * runs to find (2026-10-16), which is why the loop below now reports a crash
   * instead of going quiet.
   */
  let gateArmed = true;
  /**
   * When the player died, on the frame loop's clock — null while they are alive.
   * Declared, not assigned, for the same reason as `gateArmed` above: a name
   * first written inside the loop is a ReferenceError in a module, and that
   * kills the game before it draws a frame.
   */
  let deathAt = null;

  function runFrame(now) {
    const dtSeconds = Math.min((now - last) / 1000, SIM.maxFrameDelta);
    last = now;
    frameStats.sample(dtSeconds);

    // The Perpendicularity (M2): walking into the pool shifts the realm, with a
    // fade to black over the moment it happens. `gateStep` is edge-triggered, so
    // standing in the pool does not flap between realms and arriving in the pool
    // (which is where a shift leaves you) does not fire straight back.
    const gate = gateStatus(state.player.position, map.perpendicularity);
    const gateDecision = gateStep(gateArmed, gate.inside, fade.active);
    gateArmed = gateDecision.armed;
    if (gateDecision.fire) {
      fade.play(() => {
        hud.setRealm(toggleRealm(state));
      });
    }
    // The beat the fade is covering: the world holds still while the screen is
    // black, so nothing can happen to the player that they cannot see.
    const transitioning = fade.active;
    // Paused (debug only), mid-transition, or in a dialog: time stands still,
    // so the sim can be stepped by hand — and so nothing happens to the player
    // behind the fade or while a text box is up.
    const dialogOpen = dialog.visible;
    const steps = pausedSim || transitioning || dialogOpen ? 0 : clock.advance(dtSeconds);
    if (steps > 0) {
      const look = input.look();
      const move = input.move();
      const jump = input.consumeJump();
      const sprint = input.sprinting();
      // One edge per frame, whatever the substep count: holding the button down
      // is one swing, and the sim's cooldown decides when the next may start.
      const attack = input.consumeAttack();

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
            attack: i === 0 ? attack : false,
          },
          context,
        );
      }
    }

    // --- health, and the death beat (WP-3.1) -------------------------------
    // The sim owns the health; this only draws it. The vignette is driven by
    // `combat.hurt`, which the sim decays, so it cannot strobe and it cannot
    // outlive the invulnerability window it belongs to.
    health.setHealth(state.combat.health, state.combat.maxHealth);
    health.setHurt(state.combat.hurt);
    health.setDead(state.combat.dead);

    // Dying is a *beat*, not a teleport: the card holds long enough to read,
    // then the fade covers the walk back to the beacon. Like the realm shift,
    // the frame loop owns the timing, because a fade holds the sim still and a
    // sim-driven respawn timer would never reach zero inside its own fade.
    if (state.combat.dead && deathAt === null) deathAt = now;
    else if (!state.combat.dead) deathAt = null;
    if (deathAt !== null && !fade.active && now - deathAt >= COMBAT.respawnHold * 1000) {
      deathAt = null;
      fade.play(() => {
        respawn(state, context);
      });
    }

    // NPC interaction: find the nearest NPC within range, show the prompt, and
    // consume an interact press to open the dialog. Dialog is only allowed in
    // the physical realm (you talk to the body, not the flame) and when no
    // other transition is happening.
    const nearbyNpc = dialogOpen || transitioning || state.realm !== 'physical' ? null : nearestInteractableNpc(state);
    if (nearbyNpc && !dialogOpen) {
      interactPrompt.hidden = false;
    } else {
      interactPrompt.hidden = true;
    }
    if (input.consumeInteract() && nearbyNpc && !dialogOpen && !transitioning) {
      const npcData = loadNpc(nearbyNpc.npcId);
      const machine = createDialogueMachine(npcData);
      // Release mouse capture so the player can click the buttons (a captured
      // cursor hides the pointer and steals clicks from dialog choices).
      input.releaseCapture();
      dialog.open(machine);
    }
    // Consume any buffered interact while the dialog is open or nothing is in
    // range, so a press held while the prompt hides does not fire next frame.
    if (dialogOpen || !nearbyNpc) input.consumeInteract();

    // Touch controls appear the first time a finger does anything (or if the
    // device says it is coarse), and never on a plain desktop session.
    if (!touchSeen && input.touchMode()) {
      touchSeen = true;
      hud.setTouchControls(true);
    }

    view.setFov(settings.fov);
    view.resize();
    // The camera is derived from the player; the sim never reads it back.
    resolveCamera(
      { player: state.player, settings, map, seed: state.seed, obstacles: state.obstacles, realm: state.realm },
      camera,
    );
    const activeCamera = view.setProjection(camera.projection, camera.span);
    activeCamera.position.set(camera.x, camera.y, camera.z);
    activeCamera.rotation.set(camera.pitch, camera.yaw, 0);
    world.sync(state, camera, dtSeconds);
    view.render(world.scene);

    debugOverlay.refresh(snapshot());
    frames++;
    if (!debugApi.ready && frames >= 2) {
      debugApi.ready = true;
      document.documentElement.dataset.ready = 'true';
      document.title = `${APP.title} — ${map.label}`;
    }
  }

  /**
   * The frame loop, with a crash reporter around it.
   *
   * Anything thrown in here used to kill the loop silently: no `ready`, no
   * error the harness could read, just eighty tests timing out one at a time.
   * A failure in the first frames *is* the game failing to start, so it is
   * recorded in the same channel as a bootstrap failure — and the loop stops
   * rather than throwing once per frame.
   */
  function frame(now) {
    try {
      runFrame(now);
    } catch (error) {
      reportStartFailure(error);
      throw error;
    }
    requestAnimationFrame(frame);
  }

  hud.setTouchControls(coarse);
  hud.setRealm(state.realm);
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
      if (key === 'hearts') setHearts(state, value);
      if (key === 'seed') {
        state = createWorldState({ map, seed: value });
        // A new world is built from the map's own defaults, so the hearts the
        // owner chose have to be re-applied or a seed change silently resets
        // the health bar.
        setHearts(state, settings.hearts);
        rebuildWorld();
      } else if (key === 'palette') {
        variant = getVariant(map.id, value);
      }
      world.applySettings(settings, variant);
      if (key === 'realmFade') fade.setDuration(fadeDuration());
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
    setHearts(state, settings.hearts);
    rebuildWorld();
    world.applySettings(settings, variant);
    fade.setDuration(fadeDuration());
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
    // The world is a boot flag, and rebuilding this query from scratch would
    // silently drop it on the first settings change (which is at boot).
    if (map.id !== DEFAULT_MAP_ID) query.set('map', map.id);
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
        // Which cognitive manifestation is drawing (M2 skins) — the renderer's
        // own answer, for the same reason as the avatar's.
        skin: world.stats().skin,
        gl: view.contextInfo(),
      },
      ui: {
        overlay: debugOverlay.visible,
        panel: panel.visible,
        credits: credits.visible,
        touch: !hud.jump.hidden,
        fade: fade.active,
        fades: fade.count,
      },
      // Dialog state is reported as its own top-level key (see SNAPSHOT_KEYS)
      // rather than nested under `ui`, because `ui` is a whitelist and any
      // field added there silently disappears without a matching line in
      // core/snapshot.js — a trap that already cost two CI runs.
      dialog: {
        open: dialog.visible,
        npcId: dialog.activeNpcId,
        node: dialog.activeNodeId,
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

/**
 * Record a failure that stopped the game from starting, in the one place a
 * headless harness can read it, and tell the player too.
 *
 * A blank page with a stack trace in a console nobody opens is not a failure
 * mode; it is a mystery. This makes it a sentence.
 */
function reportStartFailure(error) {
  const message = `${error?.message ?? error}`;
  window.__worldhopper = { ready: false, bootError: message };
  showBanner(`Something broke: ${message}`);
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
