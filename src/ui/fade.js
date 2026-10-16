/**
 * A fade to black — the transition beat for a realm shift (owner's ask,
 * 2026-10-15: *"make a Perpendicularity by spawn with a fade to black
 * transition"*).
 *
 * It is deliberately dumb: it owns one element, one promise and no game logic.
 * `play()` fades the screen out, runs whatever it is handed **while the screen
 * is black**, and fades back in — which is the only moment a realm may change,
 * so the player never watches the world change underneath them.
 *
 * Timing is wall clock (a transition is a *feeling*, not a simulation step) and
 * the durations are passed in, so a reduced-motion session gets a short beat
 * instead of a long one.
 */

const BLACK_HOLD_MS = 140;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFade({ mount, fadeMs: initialFadeMs = 420, holdMs: initialHoldMs = BLACK_HOLD_MS } = {}) {
  const element = document.createElement('div');
  element.className = 'fade';
  element.setAttribute('aria-hidden', 'true');
  element.style.setProperty('--fade-ms', `${fadeMs}ms`);
  mount.appendChild(element);

  let fadeMs = Number.isFinite(initialFadeMs) ? Math.max(0, initialFadeMs) : 420;
  let holdMs = Number.isFinite(initialHoldMs) ? Math.max(0, initialHoldMs) : BLACK_HOLD_MS;
  let active = false;
  /** How many fades have run — the debug snapshot's proof that the beat happened. */
  let count = 0;

  return {
    element,
    get active() {
      return active;
    },
    get count() {
      return count;
    },
    /** The transition length is a *feel* number, so it is a live setting. */
    setDuration(next, hold) {
      if (Number.isFinite(next)) fadeMs = Math.max(0, next);
      if (Number.isFinite(hold)) holdMs = Math.max(0, hold);
      element.style.setProperty('--fade-ms', `${fadeMs}ms`);
      return fadeMs;
    },
    /**
     * Fade out, run `atBlack`, fade in.
     *
     * A second call while one is in flight is refused (returns false) rather
     * than queued: two shifts inside one black frame would cancel out, and the
     * player would see a flicker and no change.
     *
     * @param {() => void} [atBlack] runs exactly once, with the screen covered
     * @returns {Promise<boolean>} whether the transition ran
     */
    async play(atBlack) {
      if (active) return false;
      active = true;
      count++;
      element.classList.add('is-active');
      await wait(fadeMs);
      try {
        atBlack?.();
      } finally {
        await wait(holdMs);
        element.classList.remove('is-active');
        await wait(fadeMs);
        active = false;
      }
      return true;
    },
  };
}
