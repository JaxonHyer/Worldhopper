/**
 * Hops (WP-4.3, stub): travelling from one world to another through a
 * Perpendicularity.
 *
 * The canon's own shape transcribed (ROADMAP.md § Canon anchors):
 *
 *  - "Canon supports travel-by-foot between worlds: cognition warps space, so
 *    the distance between worlds is heavily contracted in the realm. Perpen-
 *    dicularities (formed by long Shard presence) are the gates between
 *    realms/worlds."
 *  - And the architectural rule that follows: "travel between [maps] is a
 *    scene swap behind a transition."
 *
 * So a hop in this game is exactly three things, no more and no less:
 *
 *   1.  Stand inside a Perpendicularity — not near it, inside it.
 *   2.  Remain in the Cognitive Realm — travel is staged there; the physical
 *       side of a gate is for swimming between realms, never for leaving a
 *       world.
 *   3.  Choose the world's own authored link (`hopLinks`) and the game swaps
 *       the whole map behind a white-out. You arrive at the target gate,
 *       still in the lens — the mirror image of how a realm shift lands you
 *       standing in the pool.
 *
 * Pure logic only: no DOM, no three.js, no runtime fetches. The frame loop
 * owns the prompt and the white-out; this file owns when a hop is legal at
 * all — which is the part a test must be able to prove in Node.
 */

import { MAPS } from './maps/index.js';
import { gateStatus } from './gate.js';
import { REALMS } from './config.js';

/**
 * Every hop link a map declares, resolved against the registry.
 *
 * A link is authored as `{ id, target, label }` under the map's `hopLinks`.
 * The anchor of a hop is canonically the map's Perpendicularity — links do
 * not carry positions, because the pool IS the place, and a second gate
 * would be a second place, which is M4's own word for it ("the puzzle").
 * Unknown or malformed targets are filtered out rather than crashing boot:
 * a mistyped row degrades to "this gate goes nowhere", never to a black
 * screen.
 */
export function collectHopLinks(map) {
  const list = Array.isArray(map?.hopLinks) ? map.hopLinks : [];
  return list
    .filter((link) => link && typeof link.target === 'string')
    .filter((link) => Object.prototype.hasOwnProperty.call(MAPS, link.target))
    .map((link) => ({
      id: String(link.id ?? `hop-${link.target}`),
      target: link.target,
      label: typeof link.label === 'string' && link.label.trim() !== '' ? link.label : MAPS[link.target].label ?? link.target,
    }));
}

/**
 * What the player may hop to FROM HERE, right now.
 *
 * The three-leg rule above, as a predicate over world state:
 *
 * @returns {[{id, target, label}]} usually a single link (one link per map
 *   for this stub); empty when a hop is not legal at all.
 */
export function availableHops(state, context) {
  const map = context?.map;
  if (!state?.player || !map) return [];
  // Travel is staged in the Cognitive Realm — never from the physical side.
  if (state.realm !== REALMS.cognitive) return [];
  // Inside the Perpendicularity, per canon: the gate, not the shore.
  const insidePool = gateStatus(state.player.position, map.perpendicularity);
  if (!insidePool.inside) return [];
  return collectHopLinks(map);
}

/** The label the prompt carries ("Hop to the Quiet Basin"). */
export function hopPromptText(link) {
  return `Hop to ${link.label}`;
}

/**
 * Where you land after a hop: at the target gate.
 *
 * The answer is *inside* the pool, for the same reason a realm shift lands
 * you standing in the water: it is the honest, canon-shaped arrival, and it
 * guarantees the destination gate is never spawning you into terrain (the
 * pool is the one region the map promises is walkable).
 */
export function landingSpot(targetMap) {
  const gate = targetMap.perpendicularity;
  if (!gate) return { x: 0, z: 0 };
  return { x: gate.position.x, z: gate.position.z };
}
