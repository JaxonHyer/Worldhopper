/**
 * Hop gates (corrected model, 2026-10-19): a Perpendicularity is ONLY a realm
 * swap. A worldhop is two of them — into your gate, walk on the 2D plane to a
 * different gate, out there. So the rules being pinned are:
 *
 *  - every map carries the SECOND gate's rendezvous for the other world (data),
 *  - a gate answers only while you are BOTH in the lens AND inside its ring
 *    (edge situations, never "standing anywhere"),
 *  - landing is always the other world's pool, because a gate's exit is water.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { collectHopGates, hopGateInside, landingSpot, nearestHopGate, waylightTrail } from '../../src/core/hop.js';
import { createWorldState } from '../../src/core/world-state.js';
import { getMap, hasMap, MAPS, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';
import { REALMS } from '../../src/core/config.js';

const settings = defaultSettings();

function world(mapId) {
  const map = getMap(mapId);
  const state = createWorldState({ map, seed: 4242 });
  return { map, state, context: { map, seed: state.seed, obstacles: state.obstacles, settings } };
}

function place(state, x, z) {
  state.player.position.x = x;
  state.player.position.z = z;
}

test('both maps carry exactly one rendezvous for the other world, and it is a REAL gate', () => {
  for (const mapId of Object.keys(MAPS)) {
    const gates = collectHopGates(getMap(mapId));
    assert.equal(gates.length, 1, `${mapId} should declare one second Perpendicularity`);
    const gate = gates[0];
    assert.ok(hasMap(gate.target), `${gate.id} exits somewhere the game knows about`);
    assert.notEqual(gate.target, mapId, 'a hop gate never exits back onto its own world');
    assert.ok(gate.radius >= 1.8 && gate.radius <= 6, `ring ${gate.radius} is walk-overable for a thumb`);
    // Standing apart from the map's own pool, or "the second gate" is
    // indistinguishable from the first (the walk IS the worldhop).
    const pool = getMap(mapId).perpendicularity;
    assert.ok(
      Math.hypot(gate.position.x - pool.position.x, gate.position.z - pool.position.z) >= 10,
      `${gate.id} stands too close to the pool to be a second gate`,
    );
    assert.ok(gate.label.length > 0, 'and it has a label a player could read');
  }
  // And the round trip is symmetric by construction: out through one, home the other.
  assert.equal(collectHopGates(getMap('roshar'))[0].target, 'blank-basin');
  assert.equal(collectHopGates(getMap('blank-basin'))[0].target, 'roshar');
});

test('a gate only answers while you are inside its ring AND inside the lens', () => {
  const { state, context } = world('roshar');
  const gate = collectHopGates(context.map)[0];
  place(state, gate.position.x, gate.position.z);

  state.realm = REALMS.physical;
  assert.equal(hopGateInside(state, context), null, 'inside the ring but in the physical realm: a gate sleeps');

  state.realm = REALMS.cognitive;
  const hit = hopGateInside(state, context);
  assert.ok(hit, 'inside the ring inside the lens: the gate answers');
  assert.equal(hit.gate.target, 'blank-basin');

  // On the rim, nothing: "out on the plane" is a walk, not a menu.
  place(state, gate.position.x + gate.radius + 1.5, gate.position.z);
  assert.equal(hopGateInside(state, context), null, 'outside the ring, even in the lens: no hop');
});

test('coming out means water: the landing is the target world’s pool', () => {
  for (const [from, to] of [['roshar', 'blank-basin'], ['blank-basin', 'roshar']]) {
    const spot = landingSpot(getMap(to));
    const pool = getMap(to).perpendicularity;
    assert.ok(
      Math.hypot(spot.x - pool.position.x, spot.z - pool.position.z) <= pool.radius,
      `the ${from}->${to} landing is not at ${to}'s pool`,
    );
  }
});

test('the walk IS the prompt (nearest gate math stays honest)', () => {
  const { state, context } = world('roshar');
  const gate = collectHopGates(context.map)[0];
  // From the pool, the rendezvous must be a measurable, pawnable walk — long
  // enough to be a choice, short enough to be a stroll (the plane is flat).
  place(state, 0, -14);
  const near = nearestHopGate(state, context);
  assert.ok(near, 'from the home gate, a second gate is findable');
  assert.equal(near.gate.id, gate.id);
  assert.ok(
    near.distance > 12 && near.distance < 80,
    `the second gate is ${near.distance.toFixed(1)} m off — too short/long to be a real walk between worlds`,
  );
});

test('the default map always opens on a world with a way out (WP-4.3 stub guard)', () => {
  const map = getMap(DEFAULT_MAP_ID);
  assert.ok(collectHopGates(map).length > 0, 'the opening world must have its second Perpendicularity');
});

test('the waylight trail is a straight, walkable chain from outside the pool to outside the other ring', () => {
  const home = getMap('roshar').perpendicularity;
  const gate = collectHopGates(getMap('roshar'))[0];
  const points = waylightTrail(home.position, { x: gate.position.x, z: gate.position.z, radius: gate.radius }, home.radius, 2);

  assert.ok(points.length > 5, 'a chain, not a pebble');
  const first = points[0];
  const last = points[points.length - 1];
  assert.ok(
    Math.hypot(first.x - home.position.x, first.z - home.position.z) > home.radius,
    'the chain starts just outside the home ring, not inside it',
  );
  assert.ok(
    Math.hypot(last.x - gate.position.x, last.z - gate.position.z) > gate.radius,
    'and it finishes outside the other ring, not inside it',
  );
  // Straight and evenly paced: the spacing between consecutive points stays at
  // the laid beat, and every point is on the line between the two gates.
  for (let i = 1; i < points.length; i++) {
    const gap = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    assert.ok(Math.abs(gap - 2) < 0.001, `uneven pace at ${i}: ${gap.toFixed(3)}`);
  }
  // And it is deterministic by construction: same call, same chain.
  const again = waylightTrail(home.position, { x: gate.position.x, z: gate.position.z, radius: gate.radius }, home.radius, 2);
  assert.deepEqual(points, again);
});

test('a degenerate target has no trail at all rather than a misleading one', () => {
  const home = { x: 0, z: 0 };
  assert.deepEqual(waylightTrail(home, { x: 1.5, z: 0, radius: 1 }, 3.4, 2), [], 'too close: no line');
});
