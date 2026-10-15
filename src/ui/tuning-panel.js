/**
 * Tuning panel (AGENT_PROMPT.md §8).
 *
 * The owner tunes feel here on real hardware; settings persist to
 * localStorage *and* are mirrored into the URL, so a tuned feel can be pasted
 * back to the agent as a config link. Controls for later milestones are shown
 * disabled so the shape of the panel is visible from M0.
 */

import { SETTING_DEFS, SETTING_GROUPS, buildConfigUrl, describeSettings, formatSettingValue } from '../core/settings.js';

export function createTuningPanel({ mount, settings, onChange, onReset, onRerollSeed }) {
  const root = document.createElement('div');
  root.className = 'panel tuning-panel';
  root.hidden = true;

  const header = document.createElement('div');
  header.className = 'panel__header';
  const title = document.createElement('div');
  title.className = 'panel__title';
  title.textContent = 'tuning';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel__close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close tuning panel');
  close.addEventListener('click', () => api.hide());
  header.append(title, close);
  root.appendChild(header);

  const rows = new Map();
  const controls = new Map();

  // Group headings: a scrollable column of eighteen controls needs signposts.
  const groupLabels = new Map(SETTING_GROUPS.map((group) => [group.id, group.label]));
  let lastGroup = null;

  for (const def of SETTING_DEFS) {
    const group = def.group ?? 'world';
    if (group !== lastGroup && groupLabels.has(group)) {
      const heading = document.createElement('div');
      heading.className = 'tuning-group';
      heading.textContent = groupLabels.get(group);
      root.appendChild(heading);
      lastGroup = group;
    }

    const row = document.createElement('div');
    row.className = 'tuning-row';
    if (def.live === false) row.classList.add('is-future');

    const label = document.createElement('label');
    label.className = 'tuning-row__label';
    label.textContent = def.label;
    if (def.live === false) {
      const tag = document.createElement('span');
      tag.className = 'tuning-row__tag';
      tag.textContent = def.phase.toUpperCase();
      label.appendChild(tag);
    }
    label.htmlFor = `setting-${def.key}`;
    row.appendChild(label);

    const value = document.createElement('output');
    value.className = 'tuning-row__value';

    let control;
    if (def.key === 'seed') {
      control = document.createElement('input');
      control.type = 'number';
      control.min = String(def.min);
      control.max = String(def.max);
      control.step = '1';
      control.id = `setting-${def.key}`;
      control.value = String(settings[def.key]);
      control.addEventListener('change', () => emit(def, control.value));
      const reroll = document.createElement('button');
      reroll.type = 'button';
      reroll.className = 'tuning-row__mini';
      reroll.textContent = 'reroll';
      reroll.title = 'Roll a new seed and rebuild the map';
      reroll.addEventListener('click', () => onRerollSeed?.());
      row.append(control, reroll, value);
      value.textContent = ''; // the field itself already shows the number
    } else if (def.kind === 'enum') {
      control = document.createElement('select');
      control.id = `setting-${def.key}`;
      for (const option of def.values) {
        const element = document.createElement('option');
        element.value = option;
        element.textContent = option;
        control.appendChild(element);
      }
      control.value = String(settings[def.key]);
      control.addEventListener('change', () => emit(def, control.value));
      row.append(control, value);
    } else {
      control = document.createElement('input');
      control.type = 'range';
      control.min = String(def.min);
      control.max = String(def.max);
      control.step = String(def.step);
      control.id = `setting-${def.key}`;
      control.value = String(settings[def.key]);
      // Live feedback while dragging (quiet), persisted when the gesture ends.
      control.addEventListener('input', () => emit(def, control.value, { persist: false }));
      control.addEventListener('change', () => emit(def, control.value, { persist: true }));
      row.append(control, value);
    }

    if (def.live === false) {
      control.disabled = true;
      control.title = `Wired in ${def.phase.toUpperCase()}`;
      value.textContent = '—';
    } else {
      value.textContent = formatSettingValue(def, settings[def.key]);
    }
    if (def.help) row.title = def.help;

    rows.set(def.key, row);
    controls.set(def.key, control);
    root.appendChild(row);
  }

  const footer = document.createElement('div');
  footer.className = 'tuning-footer';
  const config = document.createElement('input');
  config.type = 'text';
  config.readOnly = true;
  config.className = 'tuning-footer__config';
  config.setAttribute('aria-label', 'Config link');
  config.title = 'Copy this link back to the agent to reproduce a tuned feel';
  config.addEventListener('focus', () => config.select());

  const buttons = document.createElement('div');
  buttons.className = 'tuning-footer__buttons';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'copy link';
  copy.addEventListener('click', async () => {
    const url = config.value;
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = 'copied';
    } catch {
      config.select();
      copy.textContent = 'select+copy';
    }
    setTimeout(() => {
      copy.textContent = 'copy link';
    }, 1500);
  });
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'reset';
  reset.addEventListener('click', () => onReset?.());
  buttons.append(copy, reset);
  footer.append(config, buttons);

  const hint = document.createElement('p');
  hint.className = 'panel__hint';
  hint.textContent = 'changes save to this browser and to the URL';
  footer.appendChild(hint);

  root.appendChild(footer);
  mount.appendChild(root);

  function emit(def, raw, options = {}) {
    const applied = onChange?.(def.key, raw, options);
    if (applied !== undefined) {
      controls.get(def.key).value = String(applied);
      const row = rows.get(def.key);
      row.querySelector('.tuning-row__value').textContent = formatSettingValue(def, applied);
    }
  }

  const api = {
    element: root,
    get visible() {
      return !root.hidden;
    },
    show() {
      root.hidden = false;
      api.sync(settings);
    },
    hide() {
      root.hidden = true;
    },
    toggle(force) {
      const next = force ?? root.hidden;
      root.hidden = !next;
      return next;
    },
    /** Re-read values from the settings object (after reset / URL change). */
    sync(next) {
      settings = next;
      for (const def of SETTING_DEFS) {
        const control = controls.get(def.key);
        if (!control) continue;
        control.value = String(next[def.key]);
        const row = rows.get(def.key);
        const output = row.querySelector('.tuning-row__value');
        if (output) {
          // The seed row has no slider/value readout: the number is in the field.
          output.textContent = def.key === 'seed' || def.live === false ? '' : formatSettingValue(def, next[def.key]);
        }
      }
      config.value = buildConfigUrl(next);
    },
    get configValue() {
      return config.value;
    },
    refreshConfigUrl() {
      config.value = buildConfigUrl(settings);
    },
    describe() {
      return describeSettings(settings);
    },
  };

  api.sync(settings);
  return api;
}
