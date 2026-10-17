/**
 * Dialog UI — a text box with a nameplate and 2–4 choices, phone-first.
 *
 * ROADMAP: "text box with 2–4 choices. Dialogue is data (JSON files) — the
 * owner edits copy without code. No voice, no lip sync." One clear tap
 * affordance, not a keyboard-only binding (the owner plays on a phone).
 *
 * The dialog takes over the screen with a bottom-anchored card: name, a line
 * of dialogue, and buttons for each choice. Tapping a choice advances the
 * state machine (from src/content/npcs.js). When the node has no choices the
 * dialog ends with a "continue" button.
 *
 * The dialog does not read from or mutate world state directly — it receives
 * the machine via `open()` and calls back when closed. The caller (main.js)
 * decides when to open it (proximity prompt, tap/key press) and what to do
 * when it closes.
 */

export function createDialog({ mount }) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'dialog__card';

  const nameEl = document.createElement('div');
  nameEl.className = 'dialog__name';

  const titleEl = document.createElement('div');
  titleEl.className = 'dialog__title';

  const textEl = document.createElement('p');
  textEl.className = 'dialog__text';

  const choicesEl = document.createElement('div');
  choicesEl.className = 'dialog__choices';

  card.append(nameEl, titleEl, textEl, choicesEl);
  overlay.appendChild(card);
  mount.appendChild(overlay);

  let machine = null;
  let onCloseCb = null;

  function render() {
    if (!machine) {
      overlay.hidden = true;
      return;
    }
    const node = machine.currentNode;
    overlay.hidden = false;
    nameEl.textContent = machine.npcName;
    titleEl.textContent = '';
    textEl.textContent = node.text;

    choicesEl.innerHTML = '';
    const choices = node.choices?.length ? node.choices : [{ text: 'Continue', _end: true }];
    choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dialog__choice';
      button.textContent = choice.text;
      // Real, large touch targets (≥44px) so this works on a phone thumb.
      button.style.minHeight = '44px';
      button.addEventListener('click', () => {
        if (choice._end) {
          close();
          return;
        }
        machine.choose(index);
        render();
      });
      choicesEl.appendChild(button);
    });
    // Focus the first button so keyboard/Enter closes it, but only after the
    // DOM has the button.
    const first = choicesEl.querySelector('button');
    if (first) {
      // Don't steal focus on the very next tick if the tap that opened us is
      // still in flight; a short delay keeps the phone from double-firing.
      setTimeout(() => first.focus(), 30);
    }
  }

  function close() {
    machine = null;
    onCloseCb?.();
    onCloseCb = null;
    overlay.hidden = true;
  }

  /** Close on Escape for keyboard players, without swallowing keys the rest of
   *  the game wants. Only fires while the dialog is visible. */
  function onKeyDown(event) {
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  // Bind once at construction: the listener is cheap (checks `hidden` first).
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
  }

  return {
    element: overlay,
    get visible() {
      return !overlay.hidden;
    },
    get activeNpcId() {
      return machine?.npcId ?? null;
    },
    get activeNodeId() {
      return machine?.currentNodeId ?? null;
    },
    /**
     * Open the dialog with a `createDialogueMachine` instance from
     * src/content/npcs.js. The machine is reset (so speaking to the same NPC
     * a second time starts from the greeting) unless `resume` is true.
     */
    open(dialogueMachine, { onClose = null, resume = false } = {}) {
      machine = dialogueMachine;
      if (!resume) machine.reset();
      onCloseCb = onClose;
      render();
    },
    close,
    dispose() {
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
    },
  };
}
