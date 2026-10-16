/**
 * Pure dialogue-data validation and traversal. No DOM, clock, RNG or renderer:
 * identical NPC JSON always produces identical words and choices.
 */

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_CHOICES = 2;
const MAX_CHOICES = 4;
const MAX_MAP_COORDINATE = 4000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireId(value, path) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${path} must be a lower-case id using letters, numbers and hyphens`);
  }
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be non-empty text`);
  }
}

/**
 * Validate one NPC definition loaded from its JSON file.
 *
 * The spawn is map-local and fixed; world-state integration derives its Y
 * coordinate from the seeded terrain. Dialogue choices are a closed graph:
 * every destination must exist, and `null` means the conversation closes.
 *
 * @param {unknown} definition
 * @returns {object} the validated definition, unchanged
 */
export function validateNpcDefinition(definition) {
  if (!isRecord(definition)) throw new Error('NPC definition must be an object');
  requireId(definition.id, 'NPC id');
  requireId(definition.entityId, `NPC ${definition.id} entityId`);
  requireId(definition.mapId, `NPC ${definition.id} mapId`);
  requireText(definition.name, `NPC ${definition.id} name`);

  if (!isRecord(definition.spawn)) throw new Error(`NPC ${definition.id} spawn must be an object`);
  for (const coordinate of ['x', 'z', 'rotationY']) {
    if (!Number.isFinite(definition.spawn[coordinate])) {
      throw new Error(`NPC ${definition.id} spawn.${coordinate} must be finite`);
    }
  }
  if (Math.abs(definition.spawn.x) > MAX_MAP_COORDINATE || Math.abs(definition.spawn.z) > MAX_MAP_COORDINATE) {
    throw new Error(`NPC ${definition.id} spawn is outside the pocket-scale map fence`);
  }
  if (!Number.isFinite(definition.interactionRadius) || definition.interactionRadius <= 0 || definition.interactionRadius > 10) {
    throw new Error(`NPC ${definition.id} interactionRadius must be greater than 0 and at most 10 metres`);
  }

  requireId(definition.startNode, `NPC ${definition.id} startNode`);
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    throw new Error(`NPC ${definition.id} nodes must be a non-empty array`);
  }

  const nodes = new Map();
  for (const [index, node] of definition.nodes.entries()) {
    const path = `NPC ${definition.id} nodes[${index}]`;
    if (!isRecord(node)) throw new Error(`${path} must be an object`);
    requireId(node.id, `${path}.id`);
    requireText(node.text, `${path}.text`);
    if (nodes.has(node.id)) throw new Error(`NPC ${definition.id} has duplicate node id "${node.id}"`);
    if (!Array.isArray(node.choices) || node.choices.length < MIN_CHOICES || node.choices.length > MAX_CHOICES) {
      throw new Error(`${path}.choices must contain ${MIN_CHOICES}–${MAX_CHOICES} choices`);
    }

    const choiceIds = new Set();
    for (const [choiceIndex, choice] of node.choices.entries()) {
      const choicePath = `${path}.choices[${choiceIndex}]`;
      if (!isRecord(choice)) throw new Error(`${choicePath} must be an object`);
      requireId(choice.id, `${choicePath}.id`);
      requireText(choice.label, `${choicePath}.label`);
      if (choiceIds.has(choice.id)) throw new Error(`${path} has duplicate choice id "${choice.id}"`);
      choiceIds.add(choice.id);
      if (choice.next !== null) requireId(choice.next, `${choicePath}.next`);
    }
    nodes.set(node.id, node);
  }

  if (!nodes.has(definition.startNode)) {
    throw new Error(`NPC ${definition.id} startNode "${definition.startNode}" does not exist`);
  }
  for (const node of nodes.values()) {
    for (const choice of node.choices) {
      if (choice.next !== null && !nodes.has(choice.next)) {
        throw new Error(`NPC ${definition.id} choice "${choice.id}" points to missing node "${choice.next}"`);
      }
    }
  }

  return definition;
}

/** Start at the authored node; this session is UI state, not world state. */
export function startDialogue(definition) {
  validateNpcDefinition(definition);
  return Object.freeze({ dialogueId: definition.id, nodeId: definition.startNode });
}

/** Resolve a session's current line, rejecting stale or malformed sessions. */
export function currentDialogueNode(definition, session) {
  if (!session || session.dialogueId !== definition.id) {
    throw new Error(`Dialogue session does not belong to NPC "${definition.id}"`);
  }
  const node = definition.nodes.find((candidate) => candidate.id === session.nodeId);
  if (!node) throw new Error(`NPC ${definition.id} has no node "${session.nodeId}"`);
  return node;
}

/**
 * Choose one authored option. Returns the next immutable UI session, or null
 * when the choice ends the conversation. A bad choice is a data/UI bug and is
 * rejected loudly rather than silently choosing different copy.
 */
export function chooseDialogueChoice(definition, session, choiceId) {
  const node = currentDialogueNode(definition, session);
  const choice = node.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error(`NPC ${definition.id} node "${node.id}" has no choice "${choiceId}"`);
  if (choice.next === null) return null;
  return Object.freeze({ dialogueId: definition.id, nodeId: choice.next });
}
