/**
 * In-world HUD: the touch controls (stick + jump) and the control hint.
 *
 * The touch controls live in the DOM rather than in WebGL: they must stay
 * responsive on a phone, be reachable by a thumb, and scale with the device
 * pixel ratio without any extra work.
 */

const HINT_AUTO_HIDE_MS = 12000;

export function createHud({ mount, onJump, coarsePointer = false }) {
  const root = document.createElement('div');
  root.className = 'hud';
  root.hidden = false;

  // --- touch controls -----------------------------------------------------
  const stick = document.createElement('div');
  stick.className = 'touch-stick';
  stick.hidden = true;
  const knob = document.createElement('div');
  knob.className = 'touch-stick__knob';
  stick.appendChild(knob);

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'touch-jump';
  jump.textContent = 'jump';
  jump.setAttribute('aria-label', 'Jump');
  jump.hidden = !coarsePointer;
  jump.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    onJump?.();
  });

  const hint = document.createElement('p');
  hint.className = 'hud__hint';
  hint.textContent = coarsePointer
    ? 'left thumb: move · right thumb: look · tap jump'
    : 'W A S D move · space jump · drag to look';

  root.append(stick, jump, hint);
  mount.appendChild(root);

  let hideTimer = null;

  const api = {
    element: root,
    stick,
    knob,
    jump,
    get hintVisible() {
      return !hint.hidden;
    },
    setTouchControls(visible) {
      jump.hidden = !visible;
      root.classList.toggle('is-touch', visible);
      if (visible) api.hideHint();
    },
    hideHint() {
      hint.hidden = true;
    },
    scheduleHintHide() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => api.hideHint(), HINT_AUTO_HIDE_MS);
    },
    setHint(text) {
      hint.textContent = text;
      hint.hidden = false;
    },
    dispose() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      root.remove();
    },
  };
  return api;
}
