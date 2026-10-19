/**
 * Insights — the memory-flames and the causeway they raise (M2's two leftover
 * interactions, landing now so WP-4.1's puzzle has machinery to build on).
 *
 * What this is, stated plainly:
 *
 *  - **"One interaction only solvable there (reveal a route across the bead
 *    sea)."** In the Cognitive Realm, small memory-flames stand on the pool's
 *    obsidian rim. Walk through one — physical body through a living flame —
 *    and it flares, and it STAYS lit. They are invisible and inert in the
 *    physical realm: there is exactly one way to light them, and it is only
 *    on the far side of the Perpendicularity.
 *  - **"Shifting back shows the world changed (state, not illusion)."** Every
 *    lit flame lays one stepping stone in the physical pool — real rocks in
 *    the same world state, not a rendering trick. The fourth and final flame
 *    completes a dry causeway across the basin, the physical "route" the lens
 *    interaction just learned.
 *
 * Rules this keeps:
 *  - World state owns it. `state.insights` is a map of id -> boolean in the
 *    state, written only from this module, inside the deterministic sim.
 *  - Renderer never decides. `cognitive-view` draws the flames from the map's
 *    authored data, and the pool view draws stones from `state.insights`.
 *    Neither computes anything about whether an interaction happened.
 *  - Only solvable in the lens. `stepInsights` reads `state.realm` and does
 *    nothing at all outside the Cognitive Realm — an interaction in the
 *    physical world cannot accidentally fire one.
 *
 * The flames live on the map's `cognitiveSkin` (`insights` list), per the
 * project's rule "cognitiveSkin is per-world data, never global code": what
 * stands on Roshar's obsidian is Roshar's idea, not a framework default.
 * "Memory-flames learning a route" is **project interpretation**, flagged
 * over in DECISIONS.md — the books give us the flames for the living; this
 * series names no creature and promises no lore.
 */

import { terrainHeight } from './terrain.js';
import { REALMS } from './config.js';

/**
 * The authored memory-flames a map places.
 *
 * @returns {[{ id: string, x: number, z: number, radius: number,
 *   stone: { x: number, z: number } | null }]}
 */
export function collectInsights(map) {
  const skin = map?.cognitiveSkin;
  const list = Array.isArray(skin?.insights) ? skin.insights : [];
  return list
    .filter((entry) => entry && typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry) => ({
      id: entry.id,
      x: Number.isFinite(entry.x) ? entry.x : 0,
      z: Number.isFinite(entry.z) ? entry.z : 0,
      /** metres — how close the player must come to light it (phone-tappable) */
      radius: Number.isFinite(entry.radius) ? Math.max(0.5, entry.radius) : 1.6,
      /** where its stepping stone rises in the physical world, if any */
      stone: entry.stone && Number.isFinite(entry.stone.x) && Number.isFinite(entry.stone.z)
        ? { x: entry.stone.x, z: entry.stone.z }
        : null,
    }));
}

/**
 * The insights entries that begin a world: everything authored, all unlit.
 *
 * Called once from `createWorldState` so the shape is there before any step —
 * and so a debug snapshot can count them without the realm ever opening.
 */
export function insightsInitialState(map) {
  const out = {};
  for (const insight of collectInsights(map)) out[insight.id] = false;
  return out;
}

/**
 * Advance the insight layer one fixed step.
 *
 * Any of these may happen, in order:
 *  1. Outside the Cognitive Realm: nothing. The interaction is only solvable
 *     THERE — this gate is the whole "only solvable in the lens" contract.
 *  2. In the Cognitive Realm: every authored memory-flame the player is
 *     standing inside (and only while it is unlit) lights, once, forever.
 *
 * Nothing here allocates; nothing here renders; nothing here depends on the
 * wall clock. Same seed + same inputs ⇒ same lit set, always.
 */
export function stepInsights(state, dt, context) {
  if (!state || !context?.map || !state.insights) return state;
  if (state.realm !== REALMS.cognitive) return state;
  const player = state.player;
  if (!player) return state;
  for (const insight of collectInsights(context.map)) {
    if (state.insights[insight.id]) continue;
    const dx = player.position.x - insight.x;
    const dz = player.position.z - insight.z;
    if (Math.hypot(dx, dz) <= insight.radius) {
      state.insights[insight.id] = true;
    }
  }
  return state;
}

/** How the renderer reads a single flame's state, safely. */
export function isLit(state, id) {
  return Boolean(state?.insights?.[id]);
}

/** Count of lit memory-flames — one stepping stone apiece. */
export function litCount(state, map) {
  let count = 0;
  for (const insight of collectInsights(map)) {
    if (state?.insights?.[insight.id]) count++;
  }
  return count;
}

/**
 * The stones that should be risen in the physical world right now.
 *
 * One stone per lit flame, in authored order; the renderer derives meshes,
 * positions and heights from this (terrainHeight read, so they sit on the
 * basin's bottom, not float above it).
 */
export function raisedStones(state, context) {
  const stones = [];
  if (!context?.map) return stones;
  for (const insight of collectInsights(context.map)) {
    if (!state?.insights?.[insight.id] || !insight.stone) continue;
    stones.push({
      id: `${insight.id}-stone`,
      x: insight.stone.x,
      z: insight.stone.z,
      y: terrainHeight(context.map, context.seed, insight.stone.x, insight.stone.z),
    });
  }
  return stones;
}

/**
 * The causeway is complete when every flame is lit AND every authored stone
 * has risen. Written as a predicate rather than a count so the contract is
 * one question the game and its tests both ask.
 */
export function hasCauseway(state, context) {
  const list = collectInsights(context?.map);
  if (list.length === 0) return false;
  for (const insight of list) {
    if (!state?.insights?.[insight.id]) return false;
    if (!insight.stone) return false;
  }
  return true;
}
