/**
 * NPC dialogue data loader.
 *
 * Dialogues are JSON files in src/content/npcs/, imported statically so a
 * static build ships them all and there are no runtime network requests
 * (AGENT_PROMPT.md §3 — no external requests at runtime).
 *
 * One file per NPC (OWNERSHIP.md: dialogue data lives in the content lane, and
 * the owner edits copy without touching code). Each file declares the NPC's
 * id, display name, palette (the art-side skin), the start node, and a map of
 * dialog nodes. Each node has a speaker, a line of text, and up to four choices.
 * An empty choices list means the node ends the conversation.
 *
 * The same dialogue data is consumed by the sim (entity placement), the
 * renderer (which palette to draw the figure in) and the dialog UI (what to
 * show). That is what keeps the NPC as one source of truth.
 */

import peaksGuide from './npcs/peaks-guide.json' with { type: 'json' };
import basinWanderer from './npcs/basin-wanderer.json' with { type: 'json' };

const NPC_DATA = Object.freeze({
  [peaksGuide.id]: peaksGuide,
  [basinWanderer.id]: basinWanderer,
});

/**
 * Load one NPC's dialogue data by id. Throws if the id is unknown so a typo in
 * a map's NPC list fails the build instead of silently vanishing.
 */
export function loadNpc(id) {
  const data = NPC_DATA[id];
  if (!data) throw new Error(`loadNpc: unknown npc id "${id}"`);
  return data;
}

/** Every NPC id the game knows about — for listing/validation. */
export function listNpcIds() {
  return Object.keys(NPC_DATA);
}

/**
 * Validate one dialogue document: every choice's `next` points to a real node,
 * the start node exists, and no node has more than four choices (ROADMAP:
 * "text box with 2–4 choices").
 *
 * Pure, no DOM, no three.js — run headless in Node as a unit test.
 */
export function validateDialogue(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    errors.push('dialogue must be an object');
    return errors;
  }
  if (typeof data.id !== 'string' || !data.id) errors.push('dialogue.id must be a non-empty string');
  if (typeof data.name !== 'string' || !data.name) errors.push('dialogue.name must be a non-empty string');
  if (typeof data.start !== 'string' || !data.start) errors.push('dialogue.start must name a node');
  if (!data.nodes || typeof data.nodes !== 'object') {
    errors.push('dialogue.nodes must be an object');
    return errors;
  }
  if (!data.nodes[data.start]) errors.push(`start node "${data.start}" does not exist`);
  for (const [nodeId, node] of Object.entries(data.nodes)) {
    if (!node || typeof node !== 'object') {
      errors.push(`node "${nodeId}" must be an object`);
      continue;
    }
    if (typeof node.text !== 'string' || !node.text) errors.push(`node "${nodeId}" missing text`);
    if (typeof node.speaker !== 'string' || !node.speaker) errors.push(`node "${nodeId}" missing speaker`);
    if (!Array.isArray(node.choices)) {
      errors.push(`node "${nodeId}".choices must be an array`);
      continue;
    }
    if (node.choices.length > 4) errors.push(`node "${nodeId}" has ${node.choices.length} choices (max 4)`);
    for (const [i, choice] of node.choices.entries()) {
      if (!choice || typeof choice !== 'object') {
        errors.push(`node "${nodeId}" choice ${i} must be an object`);
        continue;
      }
      if (typeof choice.text !== 'string' || !choice.text) {
        errors.push(`node "${nodeId}" choice ${i} missing text`);
      }
      if (typeof choice.next !== 'string' || !choice.next) {
        errors.push(`node "${nodeId}" choice ${i} missing next`);
      } else if (!data.nodes[choice.next]) {
        errors.push(`node "${nodeId}" choice "${choice.text}" points to missing node "${choice.next}"`);
      }
    }
  }
  // Reachability: every node is reachable from start (good hygiene, not fatal —
  // a branch the player cannot hit is still data we may want to keep).
  const seen = new Set();
  const queue = [data.start];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id) || !data.nodes[id]) continue;
    seen.add(id);
    for (const choice of data.nodes[id].choices ?? []) {
      if (choice?.next && !seen.has(choice.next)) queue.push(choice.next);
    }
  }
  for (const nodeId of Object.keys(data.nodes)) {
    if (!seen.has(nodeId)) errors.push(`node "${nodeId}" is unreachable from "${data.start}"`);
  }
  return errors;
}

/**
 * The dialog state machine for one open conversation. Pure — runs headless,
 * given the npc data and the current node id. The UI drives it; the sim never
 * advances it on its own because dialogue is a player action, not a tick.
 */
export function createDialogueMachine(npcData) {
  const errors = validateDialogue(npcData);
  if (errors.length > 0) throw new Error(`invalid dialogue for "${npcData.id}": ${errors.join('; ')}`);
  let current = npcData.start;
  return {
    npcId: npcData.id,
    npcName: npcData.name,
    get currentNode() {
      return npcData.nodes[current];
    },
    get currentNodeId() {
      return current;
    },
    /** Move to a choice's target node. Returns false if the choice index is out of range. */
    choose(index) {
      const node = npcData.nodes[current];
      const choice = node.choices?.[index];
      if (!choice) return false;
      current = choice.next;
      return true;
    },
    /** True when the current node has no outgoing choices (end of conversation). */
    isAtEnd() {
      return !npcData.nodes[current].choices?.length;
    },
    /** Reset to the start, so the NPC can be spoken to again. */
    reset() {
      current = npcData.start;
    },
  };
}
