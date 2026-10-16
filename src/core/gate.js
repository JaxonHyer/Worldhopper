/**
 * The Perpendicularity: a pool where the two realms meet (M2, owner's ask
 * 2026-10-15).
 *
 * Canon (ROADMAP.md § Canon anchors) says a Perpendicularity is a place, not a
 * key press: it is "the gate between realms/worlds". The owner's instruction
 * matched: *"make a Perpendicularity by spawn with a fade to black transition
 * ... remove the realm swap button and key binding."* So the realm shift is now
 * something you **walk into**.
 *
 * Everything here is pure: a position in, a decision out. That is what lets the
 * rule be tested in Node — walking past the pool, standing in it, and arriving
 * inside it after a shift are all just numbers here, not a browser.
 */

/**
 * Where is the player relative to the gate?
 *
 * @param {{x:number,z:number}} position player position (metres, map space)
 * @param {{position:{x:number,z:number}, radius:number, open?:boolean}} gate
 * @returns {{inside:boolean, open:boolean, distance:number, radius:number}}
 */
export function gateStatus(position, gate) {
  if (!gate || !gate.position) {
    return { inside: false, open: false, distance: Infinity, radius: 0 };
  }
  const radius = Number.isFinite(gate.radius) ? Math.max(0.1, gate.radius) : 1;
  const x = Number.isFinite(position?.x) ? position.x : 0;
  const z = Number.isFinite(position?.z) ? position.z : 0;
  const dx = x - (Number.isFinite(gate.position.x) ? gate.position.x : 0);
  const dz = z - (Number.isFinite(gate.position.z) ? gate.position.z : 0);
  const distance = Math.hypot(dx, dz);
  const open = gate.open !== false;
  // A closed gate is never "inside": the pool you have not opened is scenery.
  return { inside: open && distance <= radius, open, distance, radius };
}

/**
 * The trigger, as an edge — never a level.
 *
 * Standing in the pool must not re-fire every frame, and arriving in the pool
 * (which is where a shift leaves you) must not fire straight back. So the gate
 * has to be *left* before it can fire again, and a transition already in flight
 * blocks everything: a fade with two shifts inside it would land you back where
 * you started.
 *
 * @param {boolean} armed did the gate have its "you may fire" flag
 * @param {boolean} inside is the player inside the pool right now
 * @param {boolean} busy is a transition already running
 * @returns {{armed:boolean, fire:boolean}} the next arming flag, and whether to fire
 */
export function gateStep(armed, inside, busy = false) {
  if (inside && armed && !busy) return { armed: false, fire: true };
  if (!inside) return { armed: true, fire: false };
  return { armed, fire: false };
}
