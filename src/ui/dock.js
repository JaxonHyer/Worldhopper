/**
 * On-screen buttons: a phone has no backquote key. The ⓘ button is always
 * there (the fan-work notice must be reachable), the dev buttons appear with
 * `?dev=1`.
 */

export function createDock({ mount, onCredits, onPanel, onOverlay, onPalette }) {
  const root = document.createElement('div');
  root.className = 'dock';
  mount.appendChild(root);

  function button(label, title, handler, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `dock__button ${className}`.trim();
    element.textContent = label;
    element.title = title;
    element.setAttribute('aria-label', title);
    element.addEventListener('click', handler);
    root.appendChild(element);
    return element;
  }

  const credits = button('ⓘ', 'Credits and fan-work notice (c)', () => onCredits?.());

  const dev = document.createElement('div');
  dev.className = 'dock__dev';
  dev.hidden = true;
  root.appendChild(dev);

  function devButton(label, title, handler) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'dock__button dock__button--dev';
    element.textContent = label;
    element.title = title;
    element.setAttribute('aria-label', title);
    element.addEventListener('click', handler);
    dev.appendChild(element);
    return element;
  }

  const panel = devButton('⚙', 'Tuning panel (p)', () => onPanel?.());
  const overlay = devButton('▤', 'Debug overlay (`)', () => onOverlay?.());
  const palette = devButton('◐', 'Next palette variant (v)', () => onPalette?.());

  return {
    element: root,
    buttons: { credits, panel, overlay, palette },
    setDevVisible(visible) {
      dev.hidden = !visible;
    },
  };
}
