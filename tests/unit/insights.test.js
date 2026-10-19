/**
 * Insights (M2's leftover interactions, landing now for WP-4.1's puzzle):
 *
 *  - "One interaction only solvable there": a memory-flame can only be lit in
 *    the Cognitive Realm. Physically walking through the same spot lights
 *    nothing — asserted, not implied.
 *  - "Shifting back shows the world changed (state, not illusion)": each lit
 *    flame raises one authored stepping stone in the physical world, and the
 *    fourth completes the causeway. Both halves come from world state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectInsights,
  hasCauseway,
  insightsInitialState,
  isLit,
  litCount,
  raisedStones,
  stepInsights,
} from '../../src/core/insights.js';
import { createWorldState, stepWorld } from '../../src/core/world-state.js';
import { getMap } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';
import { REALMS } from '../../src/core/config.js';

const settings = defaultSettings();
const ROSHAR = 'roshar';
const TEST_RANGE = 'blank-basin';

function world(mapId = ROSHAR, seed = 4242) {
  return createWorldState({ map: getMap(mapId), seed });
}

function context(state) {
  return { map: getMap(state.mapId), seed: state.seed, obstacles: state.obstacles, settings };
}

function walkTo(state, ctx, x, z, seconds = 30) {
  // Straight-line walk at an authored point — deterministic and human enough.
  for (let i = 0; i < seconds * 60; i++) {
    const dx = x - state.player.position.x;
    const dz = z - state.player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.2) break;
    stepWorld(state, 1 / 60, { move: { x: Math.sign(dx), y: -Math.sign(dz) }, jump: false, sprint: false, attack: false }, ctx);
  }
  return state;
}

test('Roshar authors four memory-flames on its pool, the test range none', () => {
  const roshar = collectInsights(getMap(ROSHAR));
  assert.equal(roshar.length, 4);
  const ids = roshar.map((l) => l.id);
  assert.equal(new Set(ids).size, 4, 'ids are unique');
  for (const insight of roshar) {
    const gate = getMap(ROSHAR).perpendicularity;
    assert.ok(
      Math.hypot(insight.x - gate.position.x, insight.z - gate.position.z) <= gate.radius,
      `${insight.id} stands on the pool's obsidian, so you must step into the shallow's own circle`,
    );
    assert.ok(insight.stone, `${insight.id} names the physical stone its light pays for`);
    assert.ok(Number.isFinite(insight.radius) && insight.radius >= 0.8, 'phone-tappable radius');
  }
  assert.equal(collectInsights(getMap(TEST_RANGE)).length, 0, 'the test range has no canon, so no memory-flames');
});

test('a world starts with every memory-flame unlit, in state, JSON-serialisable', () => {
  const state = world(ROSHAR);
  const initial = insightsInitialState(getMap(ROSHAR));
  assert.deepEqual(state.insights, initial);
  assert.equal(Object.values(state.insights).every((v) => v === false), true);
  assert.equal(hasCauseway(state, context(state)), false);
  // World state stays describable: never a closure, never a Map.
  assert.equal(JSON.stringify(state.insights), JSON.stringify(initial));
  assert.equal(litCount(state, getMap(ROSHAR)), 0);
});

test('the interaction is ONLY solvable in the Cognitive Realm', () => {
  const state = world(ROSHAR);
  const ctx = context(state);
  const flame = collectInsights(getMap(ROSHAR))[0];

  // Wading the pool in the physical world, dead centre of the flame — nothing.
  state.player.position.x = flame.x;
  state.player.position.z = flame.z;
  stepInsights(state, 1 / 60, ctx);
  assert.equal(isLit(state, flame.id), false, 'physical overlap lights nothing');

  // The same spot, one realm over: lit, instantly.
  state.realm = REALMS.cognitive;
  stepInsights(state, 1 / 60, ctx);
  assert.equal(isLit(state, flame.id), true, 'cognitive overlap lights it');
  assert.equal(litCount(state, getMap(ROSHAR)), 1);

  // And relighting is a no-op: the flame does not flicker, and stepping out
  // does not extinguish it — state, not illusion.
  stepInsights(state, 1 / 60, ctx);
  state.realm = REALMS.physical;
  stepInsights(state, 1 / 60, ctx);
  assert.equal(isLit(state, flame.id), true);
});

test('lighting a flame works through the full deterministic sim too', () => {
  const state = world(ROSHAR);
  const ctx = context(state);
  const flame = collectInsights(getMap(ROSHAR))[0];
  state.realm = REALMS.cognitive;
  walkTo(state, ctx, flame.x, flame.z);
  assert.equal(isLit(state, flame.id), true, 'walked through it in the lens and it lit');
});

test('every lit flame raises one authored stone, in order — then the causeway', () => {
  const state = world(ROSHAR);
  const ctx = context(state);
  const list = collectInsights(getMap(ROSHAR));

  for (let i = 0; i < list.length; i++) {
    state.insights[list[i].id] = true; // as if walked to and lit in the lens
    const stones = raisedStones(state, ctx);
    assert.equal(stones.length, i + 1, `after ${i + 1} lit flame(s), ${i + 1} stone(s)`);
    assert.equal(stones[i].id, `${list[i].id}-stone`);
    assert.ok(Number.isFinite(stones[i].y), `stone ${i} sits on the basin's bed, not in the sky`);
    assert.equal(hasCauseway(state, ctx), i === list.length - 1, `causeway complete only on the last flame`);
  }
  assert.equal(hasCauseway(state, ctx), true);
});

test('the test range stays interaction-free end to end', () => {
  const state = world(TEST_RANGE);
  state.realm = REALMS.cognitive;
  state.player.position.x = 1;
  state.player.position.z = -13;
  stepInsights(state, 1 / 60, context(state));
  assert.equal(litCount(state, getMap(TEST_RANGE)), 0);
  assert.equal(raisedStones(state, context(state)).length, 0);
  assert.equal(hasCauseway(state, context(state)), false, 'no authored flames means no causeway is *claimable*');
});

test('one stone cannot be lit twice by two runs through it', () => {
  const state = world(ROSHAR);
  const ctx = context(state);
  const flame = collectInsights(getMap(ROSHAR))[0];
  state.realm = REALMS.cognitive;
  state.player.position.x = flame.x;
  state.player.position.z = flame.z;
  stepInsights(state, 1 / 60, ctx);
  stepInsights(state, 1 / 60, ctx);
  assert.equal(litCount(state, getMap(ROSHAR)), 1, 'idempotent: one flame, one light');
});

test('the causeway is a predicate, not a count: partial authorship cannot fake one', () => {
  // hasCauseway must require every flame *with* its stone. A map whose flames
  // named no stones produces nothing raised and no causeway, loudly.
  const fake = { map: { cognitiveSkin: { insights: [{ id: 'x', x: 0, z: 0 }, { id: 'y', x: 1, z: 1, stone: { x: 1, z: 1 } }] } }, seed: 4242 };
  const state = { insights: { x: true, y: true } };
  assert.equal(hasCauseway(state, fake), false);
  const complete = { map: { cognitiveSkin: { insights: [{ id: 'y', x: 1, z: 1, stone: { x: 1, z: 1 } }] } }, seed: 4242 };
  assert.equal(hasCauseway({ insights: { y: true } }, complete), true);
});
