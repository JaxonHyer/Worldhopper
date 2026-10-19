/**
 * Hops (WP-4.3, stub) — legal only inside a Perpendicularity, only while in
 * the Cognitive Realm, and only to a world that exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { availableHops, collectHopLinks, hopPromptText, landingSpot } from '../../src/core/hop.js';
import { createWorldState } from '../../src/core/world-state.js';
import { getMap, hasMap } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';
import { REALMS } from '../../src/core/config.js';

const settings = defaultSettings();

function world(mapId) {
  const map = getMap(mapId);
  const state = createWorldState({ map, seed: 4242 });
  return { map, state, context: { map, seed: state.seed, obstacles: state.obstacles, settings } };
}

function placeAtGate(state, gate, margin = 0) {
  state.player.position.x = gate.position.x;
  state.player.position.z = gate.position.z + margin;
}

test('both maps carry one authored link, to each other, and both targets exist', () => {
  const rosharLinks = collectHopLinks(getMap('roshar'));
  const basinLinks = collectHopLinks(getMap('blank-basin'));
  assert.equal(rosharLinks.length, 1);
  assert.equal(basinLinks.length, 1);
  assert.equal(rosharLinks[0].target, 'blank-basin');
  assert.equal(basinLinks[0].target, 'roshar');
  for (const link of [...rosharLinks, ...basinLinks]) {
    assert.ok(hasMap(link.target), `${link.id} targets a registered map`);
    assert.ok(link.label.length > 0, `${link.id} has a prompt-worthy label`);
  }
  // Stub door-closes-behind-you symmetry: A goes to B, and B goes back to A.
  assert.equal(basinLinks[0].target, getMap('roshar').id);
  assert.equal(rosharLinks[0].target, getMap('blank-basin').id);
});

test('a hop is legal ONLY while inside the gate AND inside the lens', () => {
  const { state, context } = world('roshar');
  const gate = context.map.perpendicularity;
  placeAtGate(state, gate);

  // Physical realm inside the pool: a swim, not a hop. It must be illegal.
  state.realm = REALMS.physical;
  assert.deepEqual(availableHops(state, context), [], 'physical + inside gate: no hop');

  // The lens, inside the gate: exactly the hop the canon describes.
  state.realm = REALMS.cognitive;
  assert.equal(availableHops(state, context).length, 1, 'cognitive + inside gate: hop legal');
  assert.equal(availableHops(state, context)[0].target, 'blank-basin');

  // Outside the gate's own disk, still in the lens: not at the gate = no hop.
  placeAtGate(state, gate, gate.radius + 2.5);
  assert.deepEqual(availableHops(state, context), [], 'cognitive + outside gate: no hop');

  // The gate back home follows the same rule, no special-casing per world.
  const home = world('blank-basin');
  const homeGate = home.context.map.perpendicularity;
  home.state.realm = REALMS.cognitive;
  placeAtGate(home.state, homeGate);
  assert.equal(availableHops(home.state, home.context)[0].target, 'roshar');
});

test('you land AT the target gate, inside its pool — never on unmapped terrain', () => {
  for (const id of ['roshar', 'blank-basin']) {
    const spot = landingSpot(getMap(id));
    const gate = getMap(id).perpendicularity;
    assert.ok(
      Math.hypot(spot.x - gate.position.x, spot.z - gate.position.z) <= gate.radius,
      `landing violates the gate on ${id}`,
    );
  }
});

test("'a hop needs no prompt you cannot read': the label says where it goes", () => {
  const links = collectHopLinks(getMap('roshar'));
  const text = hopPromptText(links[0]);
  assert.equal(text, 'Hop to the Quiet Basin');
  assert.ok(text.startsWith('Hop to'), 'a thumb reads the verb first');
});
