/**
 * The Perpendicularity (M2, owner's ask 2026-10-15).
 *
 * The realm shift stopped being a key press and became a *place*: a pool by
 * spawn that you walk into, with a fade to black over the moment it happens.
 * The geometry and the trigger are pure functions, so the things that would
 * actually annoy a player — a gate that fires every frame, one that fires twice
 * for one visit, one that bounces you back the instant you arrive — are all
 * asserted here instead of being discovered on a phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { gateStatus, gateStep } from '../../src/core/gate.js';
import { getMap, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { createWorldState, terrainHeight } from '../../src/core/world-state.js';

const map = getMap(DEFAULT_MAP_ID);
const gate = map.perpendicularity;

test('the pool is where the map says it is, and you can walk into it', () => {
  const { player } = createWorldState({ map, seed: 4242 });
  const atSpawn = gateStatus(player.position, gate);
  assert.equal(atSpawn.open, true, 'M2 always opens the pool');
  assert.equal(atSpawn.inside, false, 'the player must not spawn inside the gate');
  // Close enough to see the glow from where you land, far enough that a step
  // off the spawn does not shift you by accident.
  assert.ok(atSpawn.distance > gate.radius + 4, `spawn is ${atSpawn.distance} m from the pool`);
  assert.ok(atSpawn.distance < 40, `spawn is ${atSpawn.distance} m from the pool — too far to find`);

  // The centre is inside, the rim counts as inside, a step past it is not.
  assert.equal(gateStatus({ x: gate.position.x, z: gate.position.z }, gate).inside, true);
  assert.equal(gateStatus({ x: gate.position.x + gate.radius - 0.01, z: gate.position.z }, gate).inside, true);
  assert.equal(gateStatus({ x: gate.position.x + gate.radius + 0.01, z: gate.position.z }, gate).inside, false);
});

test('the gate never fires twice for one visit, and cannot bounce you back', () => {
  // Walk in: fires once...
  let armed = true;
  let fires = 0;
  for (let i = 0; i < 60; i++) {
    const decision = gateStep(armed, true, false);
    armed = decision.armed;
    if (decision.fire) fires++;
  }
  assert.equal(fires, 1, 'standing in the pool must not shift the realm every frame');

  // ...and it stays silent until you leave and come back.
  let reArmed = armed;
  for (let i = 0; i < 10; i++) reArmed = gateStep(reArmed, false, false).armed;
  assert.equal(reArmed, true, 'walking out of the pool must re-arm the gate');
  assert.equal(gateStep(reArmed, true, false).fire, true, 'walking back in must shift again');

  // Arriving inside the pool (which is where a shift leaves you) must be quiet
  // — the realm you arrive in is the one you asked for, not the one you left.
  const afterArrival = gateStep(false, true, false);
  assert.equal(afterArrival.fire, false);
  assert.equal(afterArrival.armed, false);
});

test('a transition in flight blocks the gate', () => {
  // Two shifts inside one black frame would land the player back where they
  // started, having watched a fade for nothing.
  const busy = gateStep(true, true, true);
  assert.equal(busy.fire, false);
  assert.equal(busy.armed, true, 'a refused fire must not consume the arming');
  assert.equal(gateStep(true, false, true).armed, true);
});

test('the gate is NaN-proof and a closed gate is scenery', () => {
  const nan = gateStep(true, gateStatus({ x: Number.NaN, z: Number.NaN }, gate).inside, false);
  assert.equal(nan.fire, false, 'a NaN position must not shift the realm');
  assert.equal(gateStatus(null, gate).inside, false);
  assert.equal(gateStatus({ x: 0, z: 0 }, null).inside, false);
  assert.equal(gateStatus({ x: 0, z: 0 }, { position: null }).inside, false);

  // `open: false` is the M4 puzzle flag, already honoured: a pool you have not
  // opened is not a gate.
  const closed = { ...gate, open: false };
  const centre = { x: gate.position.x, z: gate.position.z };
  assert.equal(gateStatus(centre, closed).inside, false);
  assert.equal(gateStatus(centre, closed).open, false);
});

test('the pool sits on the ground, and the map keeps its shore clear', () => {
  const state = createWorldState({ map, seed: 1607255203 });
  const groundY = terrainHeight(map, state.seed, gate.position.x, gate.position.z);
  // The gate's y is not authored: the pool conforms to the terrain it lies on,
  // so what matters is that the terrain there is sane and near the spawn height.
  assert.ok(Number.isFinite(groundY));

  for (const entity of state.entities) {
    if (entity.kind !== 'rock') continue;
    const distance = Math.hypot(entity.position.x - gate.position.x, entity.position.z - gate.position.z);
    assert.ok(
      distance > map.propPolicy.perpendicularityClearance,
      `${entity.id} is ${distance.toFixed(1)} m from the pool — the shore must stay clear`,
    );
  }
});
