/**
 * In-game credits + the mandatory "unofficial fan work" notice
 * (AGENT_PROMPT.md §9). Reachable by key `c` or the ⓘ button, so it works on
 * a phone too.
 */

import { APP } from '../core/config.js';

export function createCredits({ mount, settings, map, variant }) {
  const root = document.createElement('div');
  root.className = 'credits';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Credits and notice');

  const card = document.createElement('div');
  card.className = 'credits__card';

  const heading = document.createElement('h2');
  heading.textContent = `${APP.title} — ${APP.subtitle}`;

  const version = document.createElement('p');
  version.className = 'credits__meta';
  version.textContent = `v${APP.version} · ${APP.milestone}`;

  const notice = document.createElement('p');
  notice.className = 'credits__notice';
  notice.textContent = APP.notice;

  const about = document.createElement('p');
  about.textContent =
    'A low-poly planet-exploration game: walk a small world, dip into the Cognitive Realm to see what the physical eye cannot, and open the Perpendicularity onward. Everything here is original work — no official art, text or maps.';

  const controls = document.createElement('dl');
  controls.className = 'credits__controls';
  const controlRows = [
    ['drag / arrow keys', 'look around (M0 has no player yet)'],
    ['`', 'debug overlay'],
    ['p', 'tuning panel'],
    ['v', 'cycle palette variant'],
    ['c', 'this panel'],
  ];
  for (const [key, what] of controlRows) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = what;
    controls.append(dt, dd);
  }

  const tech = document.createElement('p');
  tech.className = 'credits__meta';
  tech.textContent = 'Built with three.js. No external requests at runtime: no CDNs, no fonts, no analytics.';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'credits__close';
  close.textContent = 'close';

  card.append(heading, version, notice, about);
  const current = document.createElement('p');
  current.className = 'credits__meta';
  const skin = map.cognitiveSkin;
  current.textContent = `map: ${map.label} · palette: ${variant.label} · cognitive skin: ${skin.objectForm} (declared, not yet rendered)`;
  card.append(current, controls, tech, close);
  root.appendChild(card);
  mount.appendChild(root);

  const api = {
    element: root,
    get visible() {
      return !root.hidden;
    },
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    toggle(force) {
      const next = force ?? root.hidden;
      root.hidden = !next;
      return next;
    },
  };

  close.addEventListener('click', () => api.hide());
  return api;
}
