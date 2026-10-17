/**
 * The health read-out: hearts, the red vignette, and the death card.
 *
 * Three rules from the brief shape it:
 *
 *  - **No damage numbers.** Hearts, and nothing else. A number floating off an
 *    enemy would make this a grind, which the scope fence refuses outright.
 *  - **A hit is felt, once.** The vignette is driven by `combat.hurt`, which the
 *    sim decays; the invulnerability window means it cannot strobe.
 *  - **Death is a readable event, not a cost.** One card, one line, then the
 *    fade covers the walk back to the beacon. Nothing is lost.
 *
 * Like every other piece of chrome this owns no game logic: it reads the
 * snapshot the frame loop hands it and draws.
 */

const MAX_HEART_SLOTS = 5;

export function createHealthHud({ mount }) {
  const root = document.createElement('div');
  root.className = 'health';

  const hearts = document.createElement('div');
  hearts.className = 'health__hearts';
  hearts.setAttribute('role', 'img');

  const slots = [];
  for (let i = 0; i < MAX_HEART_SLOTS; i++) {
    const slot = document.createElement('span');
    slot.className = 'health__heart';
    slot.setAttribute('aria-hidden', 'true');
    hearts.appendChild(slot);
    slots.push(slot);
  }

  // The vignette is a separate element because it covers the whole screen and
  // must sit *under* the touch controls: a red border you cannot tap through is
  // a bug you discover on a phone.
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  vignette.setAttribute('aria-hidden', 'true');

  const card = document.createElement('div');
  card.className = 'death-card';
  card.setAttribute('role', 'status');
  card.hidden = true;
  card.innerHTML = '<p class="death-card__title">You fell</p><p class="death-card__line">back to the beacon, nothing lost</p>';

  root.append(hearts);
  mount.appendChild(root);
  // The vignette and the card are siblings of the HUD, not children of it: the
  // HUD has `pointer-events: none` on every child, and the card must not
  // inherit a z-order that puts it under the fade.
  mount.appendChild(vignette);
  mount.appendChild(card);

  let shownHealth = -1;
  let shownMax = -1;

  return {
    element: root,
    vignette,
    card,
    get visible() {
      return !root.hidden;
    },
    /**
     * Draw the hearts.
     *
     * `health` may be fractional for one frame while a beacon is healing, so a
     * heart counts as lit if it is even partly filled.
     */
    setHealth(health, max) {
      const total = Number.isFinite(max) ? Math.max(1, Math.round(max)) : 4;
      const current = Number.isFinite(health) ? health : 0;
      if (total === shownMax && Math.ceil(current) === shownHealth) {
        root.setAttribute('aria-label', `${Math.ceil(current)} of ${total} hearts`);
        return;
      }
      shownMax = total;
      shownHealth = Math.ceil(current);
      slots.forEach((slot, i) => {
        slot.hidden = i >= total;
        slot.classList.toggle('is-empty', i >= Math.ceil(current));
      });
      root.classList.toggle('is-low', Math.ceil(current) === 1);
      root.setAttribute('aria-label', `${Math.ceil(current)} of ${total} hearts`);
    },
    /** The red edge, 0..1, straight from the sim's own decay. */
    setHurt(amount) {
      const value = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
      vignette.style.opacity = value.toFixed(3);
      vignette.classList.toggle('is-active', value > 0.01);
    },
    /** One card, on the edge. The fade that follows is the frame loop's job. */
    setDead(dead) {
      card.hidden = !dead;
      root.classList.toggle('is-dead', Boolean(dead));
    },
    dispose() {
      root.remove();
      vignette.remove();
      card.remove();
    },
  };
}
