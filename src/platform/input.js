/**
 * Input: one intent stream from keyboard, mouse and touch.
 *
 * The player is the owner's phone, so touch is the primary path: a stick on
 * the left, look-drag anywhere on the right, and a jump button. Desktop gets
 * W/A/S/D (+ arrows), space and drag-look. Both produce the same intent object,
 * so the simulation has no idea which one is in use.
 *
 * Nothing here touches the sim: it only reports intent, which keeps input
 * scriptable for the headless tests (§8).
 */

import { normalizeMove, stickKnob, stickVector } from '../core/stick.js';

const RAD_PER_PIXEL = 0.0042; // drag -> radians (mouse and touch)
const KEY_LOOK_RATE = 1.9; // rad/s while an arrow-key alternative is held
const STICK_RADIUS = 62; // px of travel = full deflection
const LOOK_ZONE = 0.45; // right 55% of the screen is the look zone

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

export function createInput({ canvas, mount, onHotkey }) {
  const keys = new Set();
  const hotkeys = { overlay: '`', panel: 'p', credits: 'c', palette: 'v', resetView: 'r' };

  const counters = {
    pointersDown: 0,
    pointersMoved: 0,
    dragSamples: 0,
    dragRadians: 0,
    hotkeys: 0,
    stickSamples: 0,
    stickDistance: 0,
    jumps: 0,
    touchPointers: 0,
  };

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

  // --- visuals (owned by the HUD, positioned here) ------------------------
  const stickEl = mount?.querySelector?.('.touch-stick') ?? null;
  const knobEl = mount?.querySelector?.('.touch-stick__knob') ?? null;
  const jumpEl = mount?.querySelector?.('.touch-jump') ?? null;

  const pointerZone = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    return x > rect.width * LOOK_ZONE ? 'look' : 'move';
  };

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

    if (code === 'Space') {
      jumpQueued = true;
      counters.jumps++;
      if (!event.repeat) event.preventDefault();
      keys.add('Space');
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

  function onPointerDown(event) {
    if (event.button !== undefined && event.button > 0) return;
    if (event.target !== canvas) return;
    counters.pointersDown++;
    if (event.pointerType === 'mouse') {
      beginLook(event);
      return;
    }
    counters.touchPointers++;
    if (pointerZone(event) === 'move' && stickPointerId === null) beginStick(event);
    else if (lookPointerId === null) beginLook(event);
    canvas.setPointerCapture?.(event.pointerId);
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
      const raw = { x: dx, y: dy };
      if (knobEl) {
        const knob = stickKnob(raw.x, raw.y, STICK_RADIUS);
        knobEl.style.transform = `translate(-50%, -50%) translate(${knob.x}px, ${knob.y}px)`;
      }
      return;
    }
    if (event.pointerId === lookPointerId) {
      const dx = event.clientX - lookLastX;
      const dy = event.clientY - lookLastY;
      lookLastX = event.clientX;
      lookLastY = event.clientY;
      counters.pointersMoved++;
      if (dx !== 0 || dy !== 0) {
        counters.dragSamples++;
        counters.dragRadians += Math.abs(dx * RAD_PER_PIXEL) + Math.abs(dy * RAD_PER_PIXEL);
      }
      lookYaw += dx * RAD_PER_PIXEL;
      lookPitch += dy * RAD_PER_PIXEL;
    }
  }

  function onPointerUp(event) {
    if (event.pointerId === stickPointerId) endStick();
    if (event.pointerId === lookPointerId) {
      lookPointerId = null;
      canvas.classList.remove('is-dragging');
      canvas.releasePointerCapture?.(event.pointerId);
    }
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

    /** Movement intent for the next fixed step, in [-1, 1]. */
    move() {
      if (stickActive && stickMagnitude > 0) {
        return normalizeMove(stickX, stickY);
      }
      return keyboardMove();
    },

    /** Look intent: a one-shot drag impulse plus a held-key rate. */
    look({ consumeDrag = true } = {}) {
      const impulse = { yaw: lookYaw, pitch: lookPitch };
      if (consumeDrag) {
        lookYaw = 0;
        lookPitch = 0;
      }
      let rateX = 0;
      if (keys.has('KeyQ')) rateX -= KEY_LOOK_RATE;
      if (keys.has('KeyE')) rateX += KEY_LOOK_RATE;
      return { impulse, rate: rateX === 0 ? null : { x: rateX, y: 0 } };
    },

    /** Jump edge; consumes the press so one tap is one jump. */
    consumeJump() {
      const queued = jumpQueued;
      jumpQueued = false;
      return queued;
    },

    isDragging: () => lookPointerId !== null,
    stickState: () => ({ active: stickActive, x: stickX, y: stickY, magnitude: stickMagnitude }),
    touchMode: () => counters.touchPointers > 0,
    heldKeys: () => [...keys],
    stats: () => ({
      ...counters,
      looking: lookPointerId !== null,
      stickActive,
      heldKeys: keys.size,
    }),

    reset() {
      keys.clear();
      lookYaw = 0;
      lookPitch = 0;
      jumpQueued = false;
      endStick();
      lookPointerId = null;
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', () => {});
    },
  };
}
