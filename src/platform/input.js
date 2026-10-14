/**
 * Input: pointer-drag look (mouse + touch share one path), keyboard look, and
 * UI hotkeys. M0 has no player, so the only thing driven is the dev observer's
 * yaw/pitch — this is also the pipe the smoke test scripts against, and the
 * touch path M1's player will reuse.
 *
 * Nothing here touches the DOM tree beyond the canvas, and it exposes state
 * rather than calling the sim directly.
 */

const RAD_PER_PIXEL = 0.0042; // drag -> radians
const KEY_LOOK_RATE = 1.9; // rad/s while an arrow key is held

export function createInput({ canvas, onHotkey }) {
  const keys = new Set();
  /** one-shot drag deltas in radians, consumed once per rendered frame */
  let dragYaw = 0;
  let dragPitch = 0;
  let activePointerId = null;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;

  const hotkeys = {
    overlay: '`',
    panel: 'p',
    credits: 'c',
    palette: 'v',
    resetView: 'r',
  };

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    for (const [action, hotkey] of Object.entries(hotkeys)) {
      if (lower === hotkey.toLowerCase()) {
        onHotkey?.(action, event);
        if (action !== 'resetView') event.preventDefault();
        return;
      }
    }
    if (key.startsWith('Arrow') || key === ' ') keys.add(key);
    if (key.startsWith('Arrow')) event.preventDefault();
  }

  function onKeyUp(event) {
    keys.delete(event.key);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target !== canvas) return;
    activePointerId = event.pointerId;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('is-dragging');
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== activePointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    dragYaw += dx * RAD_PER_PIXEL;
    dragPitch += dy * RAD_PER_PIXEL;
  }

  function endPointer(event) {
    if (event && event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    canvas.releasePointerCapture?.(event?.pointerId);
    canvas.classList.remove('is-dragging');
  }

  function onBlur() {
    keys.clear();
    endPointer();
  }

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    hotkeys,
    isDragging: () => dragging,
    /** Accumulated drag since the last consume — already in radians. */
    consumeDrag() {
      const out = { yaw: dragYaw, pitch: dragPitch };
      dragYaw = 0;
      dragPitch = 0;
      return out;
    },
    /** Per-second look intent from held keys, in rad/s. */
    keyLook() {
      let x = 0;
      let y = 0;
      if (keys.has('ArrowLeft')) x -= 1;
      if (keys.has('ArrowRight')) x += 1;
      if (keys.has('ArrowUp')) y -= 1;
      if (keys.has('ArrowDown')) y += 1;
      return { x: x * KEY_LOOK_RATE, y: y * KEY_LOOK_RATE };
    },
    heldKeys: () => [...keys],
    reset() {
      keys.clear();
      dragYaw = 0;
      dragPitch = 0;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
