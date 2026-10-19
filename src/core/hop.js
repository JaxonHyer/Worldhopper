/**
 * Hop gates (corrected, 2026-10-19): worldhopping is TWO Perpendicularities,
 * not a scene swap where you stand.
 *
 * The owner's correction, and it is also the canon:
 *
 *   - A Perpendicularity does ONLY one thing: swap physical <-> cognitive. It
 *     is never a "go to another planet" button. (WP-4.3's first stub had a Hop
 *     prompt inside the pool doing the swap — that conflated the two, and the
 *     owner called it out.)
 *   - The Cognitive Realm has no worlds in it. Travelling means: go INTO one
 *     Perpendicularity (on your world), WALK to a DIFFERENT Perpendicularity
 *     on the 2D cognitive plane, and come OUT there (on the other world).
 *
 * So this module owns the one question a hop gate answers:
 *
 *   "Is the player, in the Cognitive Realm, standing inside a gate that is
 *    NOT this map's pool — and if so, which world does it exit to?"
 *
 * Data lives on the map as `hopGates: [{ id, target, position, radius,
 * label }]`, one row per rendezvous this side's cognitive realm carries for
 * the other world's gate. The gate you walk into chooses your *destination*;
 * fading and swapping are the frame loop's machinery, exactly the same fade
 * the realm shift already uses. Pure rules only: no DOM, no three.js, and
 * every deny is observable so a test can prove walking there works.
 */

import { MAPS, getMap } from './maps/index.js';
import { gateStatus } from './gate.js';
import { REALMS } from './config.js';

/**
 * The hop gates a map declares, validated.
 *
 * Unknown targets are *filtered out*, not fatal: a mistyped row degrades to
 * "this rendezvous goes nowhere", never to a black screen (the same rule the
 * skin canon guard uses: bad data is quiet in play, loud in tests).
 */
export function collectHopGates(map) {
  const list = Array.isArray(map?.hopGates) ? map.hopGates : [];
  return list
    .filter((gate) => gate && typeof gate.target === 'string')
    .filter((gate) => Object.prototype.hasOwnProperty.call(MAPS, gate.target))
    .map((gate) => ({
      id: String(gate.id ?? `hop-${gate.target}`),
      target: gate.target,
      position: {
        x: Number.isFinite(gate.position?.x) ? gate.position.x : 0,
        z: Number.isFinite(gate.position?.z) ? gate.position.z : 0,
      },
      radius: Number.isFinite(gate.radius) ? Math.max(1, gate.radius) : 3.4,
      label: typeof gate.label === 'string' && gate.label.trim() !== '' ? gate.label : (getMap(gate.target).label ?? gate.target),
    }));
}

/**
 * The hop gate the player is inside, if any — cognitive realm only.
 *
 * The `inside` and `armed` shape is the edge trigger: standing in the
 * rendezvous is legal ONCE after stepping in; stepping out re-arms it. The
 * frame loop mirrors the pool's `gateStep` with this.
 *
 * @returns {null | { gate: object, inside: boolean }}
 */
export function hopGateInside(state, context) {
  if (!state?.player || !context?.map) return null;
  if (state.realm !== REALMS.cognitive) return null;
  for (const gate of collectHopGates(context.map)) {
    const inside = gateStatus(state.player.position, gate).inside;
    if (inside) return { gate, inside: true };
  }
  return null;
}

/** The nearest hop gate to the player (for the debug snapshot / overlay). */
export function nearestHopGate(state, context) {
  if (!state?.player || !context?.map) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const gate of collectHopGates(context.map)) {
    const distance = Math.hypot(state.player.position.x - gate.position.x, state.player.position.z - gate.position.z);
    if (distance < bestDistance) {
      best = gate;
      bestDistance = distance;
    }
  }
  return best ? { gate: best, distance: bestDistance } : null;
}

/**
 * Where you land on the target world after the hop: its pool.
 *
 * Coming out of a Perpendicularity always leaves you standing in front of the
 * water you just used — the same rule every flip has obeyed since M2.
 */
export function landingSpot(targetMap) {
  const gate = targetMap.perpendicularity;
  if (!gate) return { x: 0, z: 0 };
  return { x: gate.position.x, z: gate.position.z };
}
