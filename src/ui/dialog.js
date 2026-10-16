/**
 * Tap-first NPC dialogue surface. It reads NPC entities from world state; it
 * never creates, moves or stores a second copy of an NPC in the renderer.
 */

import './dialog.css';
import { chooseDialogueChoice, currentDialogueNode, startDialogue } from '../content/dialogue.js';
import { findNearbyNpc, getNpcDefinition } from '../content/npcs.js';

export function createDialog({ mount, onOpenChange = null }) {
  if (!mount?.appendChild) throw new Error('createDialog: mount element is required');

  const root = document.createElement('div');
  root.className = 'npc-dialog';

  const prompt = document.createElement('button');
  prompt.type = 'button';
  prompt.className = 'npc-dialog__prompt';
  prompt.hidden = true;

  const panel = document.createElement('section');
  panel.className = 'npc-dialog__panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'npc-dialog-title');
  panel.setAttribute('tabindex', '-1');

  const card = document.createElement('div');
  card.className = 'npc-dialog__card';
  const header = document.createElement('header');
  header.className = 'npc-dialog__header';
  const title = document.createElement('h2');
  title.className = 'npc-dialog__nameplate';
  title.id = 'npc-dialog-title';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'npc-dialog__close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close conversation');
  const line = document.createElement('p');
  line.className = 'npc-dialog__line';
  line.setAttribute('aria-live', 'polite');
  const choices = document.createElement('div');
  choices.className = 'npc-dialog__choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Dialogue choices');

  header.append(title, closeButton);
  card.append(header, line, choices);
  panel.appendChild(card);
  root.append(prompt, panel);
  mount.appendChild(root);

  let nearest = null;
  let lastState = null;
  let currentDefinition = null;
  let session = null;

  function renderNode() {
    if (!currentDefinition || !session) return;
    const node = currentDialogueNode(currentDefinition, session);
    title.textContent = currentDefinition.name;
    line.textContent = node.text;
    choices.replaceChildren();
    for (const choice of node.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'npc-dialog__choice';
      button.textContent = choice.label;
      button.dataset.choiceId = choice.id;
      button.addEventListener('click', () => {
        const nextSession = chooseDialogueChoice(currentDefinition, session, choice.id);
        if (nextSession === null) {
          close();
          return;
        }
        session = nextSession;
        renderNode();
      });
      choices.appendChild(button);
    }
  }

  function setOpen(next, definition = currentDefinition) {
    const wasOpen = !panel.hidden;
    panel.hidden = !next;
    prompt.hidden = next || nearest === null;
    if (wasOpen !== next) onOpenChange?.(next, definition);
  }

  function open(dialogueId = nearest?.dialogueId) {
    if (session || typeof dialogueId !== 'string') return false;
    const definition = getNpcDefinition(dialogueId);
    if (!definition) return false;
    currentDefinition = definition;
    session = startDialogue(definition);
    renderNode();
    setOpen(true);
    panel.focus();
    return true;
  }

  function close({ restoreFocus = true } = {}) {
    if (!session) return false;
    const closingDefinition = currentDefinition;
    session = null;
    currentDefinition = null;
    setOpen(false, closingDefinition);
    if (lastState) sync(lastState);
    if (restoreFocus && !prompt.hidden) prompt.focus();
    return true;
  }

  prompt.addEventListener('click', () => {
    if (nearest) open(nearest.dialogueId);
  });
  closeButton.addEventListener('click', () => close());

  function sync(state) {
    lastState = state ?? null;
    if (session) {
      const stillPresent = state?.entities?.some(
        (entity) => entity?.kind === 'npc' && entity.id === currentDefinition.entityId,
      );
      if (!stillPresent) close({ restoreFocus: false });
      return nearest;
    }

    nearest = state?.player?.position
      ? findNearbyNpc(state.player.position, state.entities)
      : null;
    prompt.hidden = nearest === null;
    if (nearest) {
      prompt.textContent = `Talk to ${nearest.name}`;
      prompt.setAttribute('aria-label', `Talk to ${nearest.name}`);
      prompt.dataset.npcId = nearest.entityId;
    } else {
      prompt.textContent = '';
      prompt.removeAttribute('aria-label');
      delete prompt.dataset.npcId;
    }
    return nearest;
  }

  return {
    element: root,
    prompt,
    panel,
    sync,
    open,
    close,
    get active() {
      return session !== null;
    },
    get nearestNpcId() {
      return nearest?.entityId ?? null;
    },
    dispose() {
      close({ restoreFocus: false });
      root.remove();
    },
  };
}
