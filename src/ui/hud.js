/**
 * On-screen chrome: the touch controls (stick + jump), the mouse-capture
 * crosshair, and the control hint.
 *
 * The touch controls live in the DOM rather than in WebGL: they must stay
 * responsive on a phone, be reachable by a thumb, and scale with the device
 * pixel ratio without any extra work.
 */

const HINT_AUTO_HIDE_MS = 12000;

export const HINTS = Object.freeze({
  touch: 'left thumb: move · right thumb: look · tap jump · sprint to run',
  desktopUncaptured:
    'click the world to capture the mouse · Esc to release · W A S D move · shift run · space jump',
  desktopCaptured: 'mouse captured · Esc releases it · shift runs',
  desktopNoCapture: 'drag to look · W A S D move · shift run · space jump',
});

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

  // Sprint, bottom-left: a *toggle*, because the thumb that would hold it is
  // already on the stick. Desktop holds shift instead, so this is touch chrome
  // and is hidden the moment the touch controls are.
  const sprint = document.createElement('button');
  sprint.type = 'button';
  sprint.className = 'touch-sprint';
  sprint.textContent = 'sprint';
  sprint.setAttribute('aria-label', 'Sprint (tap to toggle)');
  sprint.setAttribute('aria-pressed', 'false');
  sprint.hidden = !coarsePointer;

  // --- mouse capture cue --------------------------------------------------
  // A small crosshair, shown only while the mouse is captured: with the system
  // cursor hidden there is otherwise no way to tell where "straight ahead" is.
  const crosshair = document.createElement('div');
  crosshair.className = 'crosshair';
  crosshair.hidden = true;
  crosshair.setAttribute('aria-hidden', 'true');
  crosshair.innerHTML = '<span></span><span></span>';

  const hint = document.createElement('p');
  hint.className = 'hud__hint';
  hint.textContent = coarsePointer ? HINTS.touch : HINTS.desktopUncaptured;

  root.append(stick, jump, sprint, crosshair, hint);
  mount.appendChild(root);

  let hideTimer = null;

  const api = {
    element: root,
    stick,
    knob,
    jump,
    sprint,
    crosshair,
    get hintVisible() {
      return !hint.hidden;
    },
    get hintText() {
      return hint.textContent;
    },
    setTouchControls(visible) {
      jump.hidden = !visible;
      sprint.hidden = !visible;
      root.classList.toggle('is-touch', visible);
      if (visible) api.hideHint();
    },
    setCaptured(captured) {
      root.classList.toggle('is-captured', captured);
      crosshair.hidden = !captured;
      // The cursor is gone: say how to get it back, then get out of the way.
      if (captured) api.setHint(HINTS.desktopCaptured);
      else api.setHint(coarsePointer ? HINTS.touch : HINTS.desktopUncaptured);
    },
    /** Tell the player what the mouse is doing, in one line. */
    setHint(text) {
      if (hint.textContent !== text) hint.textContent = text;
      hint.hidden = false;
      api.scheduleHintHide();
    },
    hideHint() {
      hint.hidden = true;
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = null;
    },
    scheduleHintHide() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => api.hideHint(), HINT_AUTO_HIDE_MS);
    },
    dispose() {
      if (hideTimer !== null) clearTimeout(hideTimer);
      root.remove();
    },
  };
  return api;
}
