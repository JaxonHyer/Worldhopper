/**
 * Tests for the NPC dialogue framework (WP-3.4).
 *
 * Validates that dialogue JSON is well-formed, the state machine advances
 * correctly, choices lead to the right nodes, and the end-of-conversation
 * state is detectable. Pure logic, headless in Node.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogueMachine, listNpcIds, loadNpc, validateDialogue } from '../../src/content/npcs.js';

test('every shipped NPC dialogue is valid (no missing nodes, ≤4 choices, reachable)', () => {
  for (const id of listNpcIds()) {
    const data = loadNpc(id);
    const errors = validateDialogue(data);
    assert.deepEqual(errors, [], `${id} had validation errors: ${errors.join('; ')}`);
  }
});

test('validateDialogue catches common mistakes', () => {
  const bad = {
    id: 'bad',
    name: 'Broken',
    start: 'hello',
    nodes: {
      hello: { speaker: 'X', text: 'hi', choices: [{ text: 'go', next: 'missing' }] },
      many: {
        speaker: 'X',
        text: 'too many',
        choices: [
          { text: '1', next: 'hello' },
          { text: '2', next: 'hello' },
          { text: '3', next: 'hello' },
          { text: '4', next: 'hello' },
          { text: '5', next: 'hello' },
        ],
      },
      unreachable: { speaker: 'X', text: 'lonely', choices: [] },
    },
  };
  const errors = validateDialogue(bad);
  assert.ok(errors.some((e) => e.includes('missing')), 'must flag a missing target');
  assert.ok(errors.some((e) => e.includes('5 choices')), 'must flag >4 choices');
  assert.ok(errors.some((e) => e.includes('unreachable')), 'must flag unreachable nodes');
});

test('a dialogue machine starts at the start node and steps through choices', () => {
  const data = loadNpc('peaks-guide');
  const m = createDialogueMachine(data);
  assert.equal(m.npcName, 'Kurin');
  assert.equal(m.currentNodeId, 'greeting');
  assert.equal(m.currentNode.speaker, 'Kurin');
  assert.ok(m.currentNode.choices.length >= 2, 'the greeting has choices');
  assert.equal(m.isAtEnd(), false);

  // "Tell me about this pool." -> pool node (first choice).
  assert.equal(m.choose(0), true);
  assert.equal(m.currentNodeId, 'pool');

  // "What about when it closes?" -> gate (first choice of pool).
  m.choose(0);
  assert.equal(m.currentNodeId, 'gate');

  // reset() goes back to start.
  m.reset();
  assert.equal(m.currentNodeId, 'greeting');
});

test('a node with no choices is an end node', () => {
  const data = loadNpc('peaks-guide');
  const m = createDialogueMachine(data);
  // Walk to farewell: greeting[3] -> farewell (which has empty choices).
  m.choose(3);
  assert.equal(m.currentNodeId, 'farewell');
  assert.equal(m.isAtEnd(), true);
  assert.equal(m.choose(0), false, 'choosing past the end must not advance');
});

test('choose() refuses an out-of-range index', () => {
  const m = createDialogueMachine(loadNpc('basin-wanderer'));
  assert.equal(m.choose(99), false);
  assert.equal(m.choose(-1), false);
  assert.equal(m.currentNodeId, 'greeting', 'must stay on the same node');
});

test('the wanderer dialogue also validates and walks', () => {
  const m = createDialogueMachine(loadNpc('basin-wanderer'));
  assert.equal(m.npcName, 'Wanderer');
  // greeting[0] "Where am I?" -> place
  m.choose(0);
  assert.equal(m.currentNodeId, 'place');
  // place[0] -> spire
  m.choose(0);
  assert.equal(m.currentNodeId, 'spire');
});
