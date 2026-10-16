/**
 * Input: one intent stream from keyboard, mouse and touch.
 *
 * Desktop look is standard mouse capture (Pointer Lock): click the world to
 * capture the mouse, then the camera follows mouse movement directly, with no
 * button held. Esc releases it. If capture is unavailable — an embedded frame
 * without the `pointer-lock` permission, an old browser, a device that refused
 * the request — the same mouse still works by dragging, and touch keeps working
 * exactly as before. The fallback exists because the *game* must never depend
 * on a browser permission to be playable.
 *
 * Nothing here touches the sim: it only reports intent, which keeps input
 * scriptable for the headless tests (§8).
 */

import { normalizeMove, stickKnob, stickVector } from '../core/stick.js';
import { DRAG_RAD_PER_PIXEL, MOUSE_RAD_PER_PIXEL, dragToLook, pixelsToLook } from '../core/look.js';

const KEY_LOOK_RATE = 1.9; // rad/s while a look key (Q/E) is held
// A refusal is only believed once no attempt could still land: requesting raw
// mouse input and falling back to a plain request produces two failure signals
// for one outcome, and neither says which attempt it belonged to.
const DENIAL_GRACE_MS = 250;
const STICK_RADIUS = 62; // px of travel = full deflection
const LOOK_ZONE = 0.45; // right 55% of the screen is the look zone (touch)

const MOVE_KEYS = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** Keys that act as "interact / talk" on desktop. */
const INTERACT_KEYS = new Set(['KeyF', 'Enter']);

/**
 * Pointer-lock state machine, so the whole feature is one small table.
 * unlocked -> (click) -> pending -> locked
 * pending  -> (pointerlockerror / rejected promise) -> denied
 * denied   -> (click) -> pending   (a later click may still succeed)
 */
export const CAPTURE = Object.freeze({
  unsupported: 'unsupported',
  unlocked: 'unlocked',
  pending: 'pending',
  locked: 'locked',
  denied: 'denied',
});

export function createInput({ canvas, onHotkey, onCaptureChange, elements = {}, sensitivity, captureEnabled }) {
  /**
   * Sensitivity is a property of the *device*, so it is applied here, where we
   * know whether a delta came from a captured mouse, a drag, or a finger.
   */
  const sens = () => sensitivity?.() ?? { drag: 1, mouse: 1 };
  /** Capture is a preference, not a rule: a player may prefer dragging. */
  const captureWanted = () => (captureEnabled ? captureEnabled() !== false : true);
  const keys = new Set();
  const hotkeys = { overlay: '`', panel: 'p', credits: 'c', palette: 'v', resetView: 'r' };

  const counters = {
    pointersDown: 0,
    pointersMoved: 0,
    dragSamples: 0,
    lookRadians: 0,
    hotkeys: 0,
    stickSamples: 0,
    stickDistance: 0,
    jumps: 0,
    interact: 0,
    touchPointers: 0,
    captureRequests: 0,
    captureFallbacks: 0,
    captureDenials: 0,
    mouseLookSamples: 0,
    mouseLookPixels: 0,
    mouseLookFallbackSamples: 0,
    sprintToggles: 0,
  };

  const supported =
    typeof document !== 'undefined' &&
    typeof canvas?.requestPointerLock === 'function' &&
    'pointerLockElement' in document;

  let capture = supported ? CAPTURE.unlocked : CAPTURE.unsupported;
  let captureError = null;
  let attempt = null; // 'raw' | 'plain' | null — the lifecycle of one request
  let denialTimer = null; // see DENIAL_GRACE_MS
  let capturedX = null; // last cursor position while captured (see onPointerMove)
  let capturedY = null;

  // --- look ---------------------------------------------------------------
  let lookYaw = 0; // accumulated radians, consumed once per frame
  let lookPitch = 0;
  let lookPointerId = null;
  let lookLastX = 0;
  let lookLastY = 0;

  // --- stick --------------------------------------------------------------
  let stickPointerId = null;
  let stickOriginX = 0;
  let stickOriginY = 0;
  let stickX = 0;
  let stickY = 0;
  let stickMagnitude = 0;
  let stickActive = false;

  // --- jump ---------------------------------------------------------------
  let jumpQueued = false;
  // --- interact (talk to NPC, etc) ----------------------------------------
  let interactQueued = false;

  // --- sprint -------------------------------------------------------------
  // Two ways in, because the two devices want different things: a desktop holds
  // Shift (a modifier, so it is deliberately not consumed or preventDefault'ed),
  // and a phone taps a button that stays on — a thumb already driving the stick
  // has no finger left to hold with.
  let sprintToggled = false;

  // --- visuals (owned by the HUD, positioned here) ------------------------
  // Passed in, not queried: the HUD must exist first, and a query that returns
  // null here silently disables the jump button on the device it exists for.
  const stickEl = elements.stick ?? null;
  const knobEl = elements.knob ?? null;
  const jumpEl = elements.jump ?? null;
  const sprintEl = elements.sprint ?? null;

  const isCaptured = () => typeof document !== 'undefined' && document.pointerLockElement === canvas;

  const pointerZone = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return x > rect.width * LOOK_ZONE ? 'look' : 'move';
  };

  // --- mouse capture ------------------------------------------------------

  function setCapture(next, error = null) {
    if (capture === next && captureError === error) return;
    const wasCaptured = capture === CAPTURE.locked;
    capture = next;
    captureError = error;
    if (next !== CAPTURE.pending) attempt = null;
    if (next === CAPTURE.denied) counters.captureDenials++;
    const captured = next === CAPTURE.locked;
    if (captured) {
      if (denialTimer !== null) {
        clearTimeout(denialTimer);
        denialTimer = null;
      }
      // Resync on the first event: the cursor position before the lock says
      // nothing about movement during it.
      capturedX = null;
      capturedY = null;
      // A drag started by the same press that captured the mouse is over: the
      // cursor is frozen now, so only movement deltas make sense.
      if (lookPointerId !== null) {
        lookPointerId = null;
        canvas.classList.remove('is-dragging');
      }
    }
    canvas.classList.toggle('is-captured', captured);
    if (wasCaptured !== captured || next === CAPTURE.denied) onCaptureChange?.(captured, next, error);
  }

  function requestCapture() {
    if (!supported || !captureWanted() || isCaptured() || attempt !== null) return;
    counters.captureRequests++;
    setCapture(CAPTURE.pending);

    // Raw mouse input where the browser offers it: the camera then does not
    // inherit the operating system's pointer acceleration. Browsers that do not
    // support it reject the request, which is a *fallback*, not a failure.
    attempt = 'raw';
    try {
      const result = canvas.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof result.then === 'function') result.catch(() => fallbackOrFail('raw'));
    } catch {
      fallbackOrFail('raw');
    }
  }

  function requestCapturePlain() {
    attempt = 'plain';
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.then === 'function') result.catch(() => fail('plain'));
    } catch (error) {
      fail(String(error?.name ?? error));
    }
  }

  /**
   * A raw-input request that did not land: try a plain request once. Some
   * browsers report the failure through the promise, others only through the
   * `pointerlockerror` event, so both paths come here.
   */
  function fallbackOrFail(kind) {
    if (isCaptured()) return; // it worked after all
    if (kind === 'raw' && attempt === 'raw') {
      counters.captureFallbacks++;
      requestCapturePlain();
      return;
    }
    fail('denied');
  }

  function fail(reason) {
    if (isCaptured() || capture === CAPTURE.locked || denialTimer !== null) return;
    denialTimer = setTimeout(() => {
      denialTimer = null;
      if (isCaptured()) return; // a later attempt landed after all
      attempt = null;
      setCapture(CAPTURE.denied, reason);
    }, DENIAL_GRACE_MS);
  }

  /** Release capture (Esc does this too, but panels need it programmatically). */
  function releaseCapture() {
    if (!supported || !isCaptured()) return false;
    try {
      document.exitPointerLock();
    } catch {
      /* ignore: the lock is already gone */
    }
    return true;
  }

  if (supported) {
    document.addEventListener('pointerlockchange', () => {
      if (isCaptured()) {
        setCapture(CAPTURE.locked);
      } else if (capture === CAPTURE.locked) {
        setCapture(CAPTURE.unlocked);
      }
    });
    document.addEventListener('pointerlockerror', () => {
      if (isCaptured()) return;
      // Some browsers only report the failure as an event: treat it like the
      // rejected promise, so the plain request still gets its chance.
      fallbackOrFail(attempt ?? 'denied');
    });
  }

  // --- keyboard ------------------------------------------------------------

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Typing into a control (a tuning slider, a seed field) must not be eaten
    // by hotkeys or movement keys: the control owns the keyboard while focused.
    const target = event.target;
    if (target instanceof Element && target.closest('input, select, textarea, button, [contenteditable]')) return;
    const key = event.key;
    const code = event.code;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    for (const [action, hotkey] of Object.entries(hotkeys)) {
      if (lower === hotkey.toLowerCase()) {
        counters.hotkeys++;
        onHotkey?.(action, event);
        if (action !== 'resetView') event.preventDefault();
        return;
      }
    }

    // Shift is sprint: tracked as a held key, but never preventDefault'ed —
    // browsers own it for shortcuts (Shift+Tab, Shift+click) and eating it
    // would break more than it fixed.
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      keys.add('ShiftLeft');
      return;
    }
    if (code === 'Space') {
      jumpQueued = true;
      counters.jumps++;
      if (!event.repeat) event.preventDefault();
      keys.add('Space');
      return;
    }
    if (INTERACT_KEYS.has(code) && !event.repeat) {
      interactQueued = true;
      counters.interact = (counters.interact ?? 0) + 1;
      event.preventDefault();
      return;
    }
    if (code in MOVE_KEYS) {
      keys.add(code);
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
    keys.delete('Space');
  }

  // --- pointer -------------------------------------------------------------

  function beginLook(event) {
    lookPointerId = event.pointerId;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    canvas.classList.add('is-dragging');
  }

  function beginStick(event) {
    stickPointerId = event.pointerId;
    stickOriginX = event.clientX;
    stickOriginY = event.clientY;
    stickX = 0;
    stickY = 0;
    stickMagnitude = 0;
    stickActive = true;
    if (stickEl) {
      stickEl.hidden = false;
      stickEl.style.left = `${event.clientX}px`;
      stickEl.style.top = `${event.clientY}px`;
    }
    updateKnob();
  }

  function updateKnob() {
    if (!knobEl) return;
    const knob = stickKnob(stickX, stickY, STICK_RADIUS);
    knobEl.style.transform = `translate(-50%, -50%) translate(${knob.x}px, ${knob.y}px)`;
  }

  function endStick() {
    stickPointerId = null;
    stickActive = false;
    stickX = 0;
    stickY = 0;
    stickMagnitude = 0;
    if (stickEl) stickEl.hidden = true;
  }

  function accumulate(delta, pixels, kind) {
    const scale = kind === 'captured' ? sens().mouse : sens().drag;
    delta = { yaw: delta.yaw * scale, pitch: delta.pitch * scale };
    if (delta.yaw === 0 && delta.pitch === 0) return;
    lookYaw += delta.yaw;
    lookPitch += delta.pitch;
    counters.pointersMoved++;
    counters.dragSamples++;
    counters.lookRadians += Math.abs(delta.yaw) + Math.abs(delta.pitch);
    if (kind === 'mouse' || kind === 'captured') {
      counters.mouseLookSamples++;
      counters.mouseLookPixels += Math.abs(pixels.x) + Math.abs(pixels.y);
    }
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button > 0) return;
    if (event.target !== canvas) return;
    counters.pointersDown++;

    if (event.pointerType !== 'mouse') {
      counters.touchPointers++;
      if (pointerZone(event) === 'move' && stickPointerId === null) beginStick(event);
      else if (lookPointerId === null) beginLook(event);
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }

    // Mouse: capture the pointer so the camera follows the mouse from now on.
    // The drag fallback still starts, because the request may be refused (or
    // because capture is switched off in the tuning panel).
    if (!isCaptured() && captureWanted()) requestCapture();
    if (!isCaptured()) beginLook(event);
  }

  function onPointerMove(event) {
    if (event.pointerId === stickPointerId) {
      const dx = event.clientX - stickOriginX;
      const dy = event.clientY - stickOriginY;
      counters.stickSamples++;
      counters.stickDistance += Math.hypot(dx, dy);
      const vector = stickVector(dx, dy, { radius: STICK_RADIUS });
      stickX = vector.x;
      stickY = vector.y;
      stickMagnitude = vector.magnitude;
      if (knobEl) {
        const knob = stickKnob(dx, dy, STICK_RADIUS);
        knobEl.style.transform = `translate(-50%, -50%) translate(${knob.x}px, ${knob.y}px)`;
      }
      return;
    }

    // Captured mouse: the browser hands us raw movement, cursor frozen.
    if (isCaptured() && event.pointerType === 'mouse') {
      let dx = event.movementX ?? 0;
      let dy = event.movementY ?? 0;
      if (dx === 0 && dy === 0 && capturedX !== null) {
        // A locked pointer normally reports movement and freezes the cursor
        // position. When it reports neither — a browser or driver that cannot
        // supply raw deltas — fall back to how far the cursor moved instead of
        // freezing the camera.
        const movedX = event.clientX - capturedX;
        const movedY = event.clientY - capturedY;
        if (movedX !== 0 || movedY !== 0) {
          dx = movedX;
          dy = movedY;
          counters.mouseLookFallbackSamples++;
        }
      }
      capturedX = event.clientX;
      capturedY = event.clientY;
      accumulate(pixelsToLook(dx, dy, { radPerPixel: MOUSE_RAD_PER_PIXEL }), { x: dx, y: dy }, 'captured');
      return;
    }

    // Free cursor: drag to look (touch, or a mouse when capture was refused).
    if (event.pointerId === lookPointerId) {
      const dx = event.clientX - lookLastX;
      const dy = event.clientY - lookLastY;
      lookLastX = event.clientX;
      lookLastY = event.clientY;
      accumulate(dragToLook(dx, dy, { radPerPixel: DRAG_RAD_PER_PIXEL }), { x: dx, y: dy }, 'drag');
    }
  }

  function onPointerUp(event) {
    if (event.pointerId === stickPointerId) {
      endStick();
      return;
    }
    if (event.pointerId === lookPointerId) {
      lookPointerId = null;
      canvas.classList.remove('is-dragging');
      canvas.releasePointerCapture?.(event.pointerId);
    }
  }

  // The sprint button (phone): a toggle, so it can be tapped once and left on.
  sprintEl?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    setSprint(!sprintToggled);
  });

  function setSprint(on) {
    sprintToggled = Boolean(on);
    counters.sprintToggles++;
    sprintEl?.classList.toggle('is-on', sprintToggled);
    sprintEl?.setAttribute('aria-pressed', sprintToggled ? 'true' : 'false');
    return sprintToggled;
  }

  // The jump button: pointer events, so it works for a thumb and for a test.
  jumpEl?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    jumpQueued = true;
    counters.jumps++;
    jumpEl.classList.add('is-pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    jumpEl?.addEventListener(type, () => jumpEl.classList.remove('is-pressed'));
  }

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    keys.clear();
    endStick();
    lookPointerId = null;
  });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function keyboardMove() {
    let x = 0;
    let y = 0;
    for (const code of keys) {
      const vector = MOVE_KEYS[code];
      if (!vector) continue;
      x += vector[0];
      y += vector[1];
    }
    return normalizeMove(x, y);
  }

  return {
    hotkeys,
    CAPTURE,

    /** Movement intent for the next fixed step, in [-1, 1]. */
    move() {
      if (stickActive && stickMagnitude > 0) return normalizeMove(stickX, stickY);
      return keyboardMove();
    },

    /** Look intent: a one-shot impulse (mouse/drag) plus a held-key rate. */
    look({ consumeDrag = true } = {}) {
      const impulse = { yaw: lookYaw, pitch: lookPitch };
      if (consumeDrag) {
        lookYaw = 0;
        lookPitch = 0;
      }
      let rateX = 0;
      if (keys.has('KeyQ')) rateX -= KEY_LOOK_RATE;
      if (keys.has('KeyE')) rateX += KEY_LOOK_RATE;
      rateX *= sens().drag;
      return { impulse, rate: rateX === 0 ? null : { x: rateX, y: 0 } };
    },

    /**
     * Sprint: held Shift on a desktop, or the phone's toggle button. Reported
     * as intent — the sim owns what sprinting *does* to the walk speed.
     */
    sprinting: () => sprintToggled || keys.has('ShiftLeft') || keys.has('ShiftRight'),
    /** The phone button's state on its own, for tests and the overlay. */
    sprintToggled: () => sprintToggled,
    setSprint,

    /** Jump edge; consumes the press so one tap is one jump. */
    consumeJump() {
      const queued = jumpQueued;
      jumpQueued = false;
      return queued;
    },

    /** Interact edge (talk, activate); consumes the press. */
    consumeInteract() {
      const queued = interactQueued;
      interactQueued = false;
      return queued;
    },

    /** Queue interact from code (used by the on-screen prompt tap). */
    queueInteract() {
      interactQueued = true;
      counters.interact = (counters.interact ?? 0) + 1;
    },

    /** Whether capture is possible in this browser *and* wanted by the player. */
    canCapture: () => supported && captureWanted(),

    /** Ask the browser to capture the mouse (used by tests and by the HUD). */
    requestCapture,
    releaseCapture,
    captureState: () => capture,
    isCaptured,

    isDragging: () => lookPointerId !== null,
    stickState: () => ({ active: stickActive, x: stickX, y: stickY, magnitude: stickMagnitude }),
    touchMode: () => counters.touchPointers > 0,
    heldKeys: () => [...keys],
    stats: () => ({
      ...counters,
      looking: lookPointerId !== null,
      stickActive,
      heldKeys: keys.size,
      capture,
      captureError,
      captured: isCaptured(),
      sprinting: sprintToggled || keys.has('ShiftLeft') || keys.has('ShiftRight'),
      sprintToggled,
      interactQueued,
    }),

    reset() {
      keys.clear();
      lookYaw = 0;
      lookPitch = 0;
      jumpQueued = false;
      interactQueued = false;
      endStick();
      lookPointerId = null;
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
