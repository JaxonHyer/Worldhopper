import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chooseDialogueChoice,
  currentDialogueNode,
  startDialogue,
  validateNpcDefinition,
} from '../../src/content/dialogue.js';
import { createNpcRegistry } from '../../src/content/npc-registry.js';

const definition = JSON.parse(readFileSync(new URL('../../src/content/npcs/roshar-surveyor.json', import.meta.url), 'utf8'));
const registry = createNpcRegistry([definition]);
const {
  NPC_DEFINITIONS,
  findNearbyNpc,
  getNpcDefinition,
  getNpcDefinitionsForMap,
  getNpcSpawnDefinitionsForMap,
} = registry;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

test('NPC JSON is valid, immutable and selected by map id', () => {
  assert.equal(NPC_DEFINITIONS.length, 1);
  assert.deepEqual(getNpcDefinitionsForMap('blank-basin'), []);
  assert.equal(getNpcDefinitionsForMap('roshar')[0].id, 'roshar-surveyor');
  assert.equal(getNpcDefinition('roshar-surveyor').name, 'Surveyor');
  assert.equal(getNpcDefinition('unknown'), null);
  assert.ok(Object.isFrozen(NPC_DEFINITIONS));
  assert.ok(Object.isFrozen(NPC_DEFINITIONS[0].nodes[0].choices));

  for (const npc of NPC_DEFINITIONS) {
    assert.equal(validateNpcDefinition(npc), npc);
    assert.ok(npc.nodes.every((node) => node.choices.length >= 2 && node.choices.length <= 4));
  }
});

test('map spawn records are stable and keep dialogue data out of world entities', () => {
  const first = getNpcSpawnDefinitionsForMap('roshar');
  const second = getNpcSpawnDefinitionsForMap('roshar');
  assert.deepEqual(first, second);
  assert.deepEqual(first[0], {
    id: 'npc-roshar-surveyor',
    kind: 'npc',
    dialogueId: 'roshar-surveyor',
    static: true,
    position: { x: 9, z: -4 },
    rotationY: 1.99,
  });
  assert.equal('nodes' in first[0], false);
  assert.equal(getNpcSpawnDefinitionsForMap('blank-basin').length, 0);
  assert.ok(Object.isFrozen(first[0].position));
  assert.throws(() => {
    first[0].position.x = 100;
  }, TypeError);
});

test('the talk prompt requires a nearby world-state entity and uses its position', () => {
  const [spawn] = getNpcSpawnDefinitionsForMap('roshar');
  const stateEntity = {
    ...spawn,
    position: { x: 4, y: 0.2, z: -5 },
  };
  const before = copy(stateEntity);
  const nearby = findNearbyNpc({ x: 7, z: -5 }, [stateEntity]);

  assert.deepEqual(nearby, {
    entityId: 'npc-roshar-surveyor',
    dialogueId: 'roshar-surveyor',
    name: 'Surveyor',
    distance: 3,
    distanceSquared: 9,
  });
  assert.deepEqual(stateEntity, before, 'proximity lookup must not mutate world state');
  assert.equal(findNearbyNpc({ x: 9, z: -4 }, []), null, 'a renderer-only object is not enough');
  assert.equal(findNearbyNpc({ x: 0, z: 0 }, [stateEntity]), null, 'out-of-range NPCs do not prompt');
  assert.equal(findNearbyNpc({ x: 7, z: -5 }, [{ ...stateEntity, dialogueId: 'missing' }]), null);
  assert.equal(findNearbyNpc({ x: Number.NaN, z: -5 }, [stateEntity]), null);
});

test('dialogue traversal is deterministic and uses only the authored JSON graph', () => {
  const npc = getNpcDefinition('roshar-surveyor');
  const first = startDialogue(npc);
  const replay = startDialogue(npc);
  assert.deepEqual(first, replay);
  assert.equal(currentDialogueNode(npc, first).text, npc.nodes[0].text);

  const next = chooseDialogueChoice(npc, first, 'crossing');
  assert.deepEqual(next, { dialogueId: npc.id, nodeId: 'crossing' });
  assert.equal(currentDialogueNode(npc, next).text, npc.nodes[1].text);
  assert.equal(chooseDialogueChoice(npc, next, 'leave'), null);
  assert.throws(() => chooseDialogueChoice(npc, first, 'not-a-choice'), /has no choice/);
  assert.throws(() => currentDialogueNode(npc, { dialogueId: 'other', nodeId: 'arrival' }), /does not belong/);
});

test('registry rejects duplicate dialogue and entity identities', () => {
  assert.throws(() => createNpcRegistry([copy(definition), copy(definition)]), /duplicate NPC dialogue id/);
  const duplicateEntity = copy(definition);
  duplicateEntity.id = 'another-dialogue';
  assert.throws(() => createNpcRegistry([copy(definition), duplicateEntity]), /duplicate NPC entity id/);
});

test('dialogue validation rejects malformed ids, choice counts and graph references', () => {
  const invalidId = copy(definition);
  invalidId.id = 'Roshar Surveyor';
  assert.throws(() => validateNpcDefinition(invalidId), /lower-case id/);

  const invalidChoices = copy(definition);
  invalidChoices.nodes[0].choices = [invalidChoices.nodes[0].choices[0]];
  assert.throws(() => validateNpcDefinition(invalidChoices), /choices must contain/);

  const brokenTarget = copy(definition);
  brokenTarget.nodes[0].choices[0].next = 'missing-node';
  assert.throws(() => validateNpcDefinition(brokenTarget), /points to missing node/);

  const duplicateNode = copy(definition);
  duplicateNode.nodes[1].id = duplicateNode.nodes[0].id;
  assert.throws(() => validateNpcDefinition(duplicateNode), /duplicate node id/);

  const outOfScale = copy(definition);
  outOfScale.spawn.x = 4001;
  assert.throws(() => validateNpcDefinition(outOfScale), /outside the pocket-scale map fence/);

  const nonFiniteSpawn = copy(definition);
  nonFiniteSpawn.spawn.z = Number.NaN;
  assert.throws(() => validateNpcDefinition(nonFiniteSpawn), /spawn.z must be finite/);
});
