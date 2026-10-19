/**
 * Debug overlay (AGENT_PROMPT.md §8): FPS, distance from origin (the scale
 * fence canary), realm, seed, entity count — plus frame-spike counters so we
 * can spot frame-loop problems without a GPU.
 *
 * Throttled to 4 refreshes/second: DOM writes every frame would itself become
 * a frame-loop cost.
 */

const REFRESH_MS = 250;

export function createDebugOverlay({ mount, onRefresh, now = () => performance.now() }) {
  const root = document.createElement('div');
  root.className = 'panel debug-overlay';
  root.hidden = true;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'off');

  const title = document.createElement('div');
  title.className = 'panel__title';
  title.textContent = 'debug';
  root.appendChild(title);

  const list = document.createElement('dl');
  list.className = 'debug-overlay__rows';
  root.appendChild(list);

  const rows = new Map();
  const hint = document.createElement('p');
  hint.className = 'panel__hint';
  hint.textContent = '` toggles · p tuning panel · c credits';
  root.appendChild(hint);

  mount.appendChild(root);

  let lastRefresh = 0;

  function setRow(key, label) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = '…';
    list.append(dt, dd);
    rows.set(key, { dt, dd });
    return dd;
  }

  // Fixed rows (stable layout = readable, and no reflow churn per update).
  setRow('fps', 'fps / frame');
  setRow('player', 'player');
  setRow('input', 'input');
  setRow('tick', 'tick / sim time');
  setRow('realm', 'realm / map');
  setRow('seed', 'seed / palette');
  setRow('origin', 'distance from origin');
  setRow('entities', 'entities');
  setRow('combat', 'hearts / enemies');
  setRow('insights', 'insights');
  setRow('render', 'draw calls / tris');
  setRow('gpu', 'gl / gpu');
  setRow('settings', 'config');

  function refresh(snapshot) {
    const stamp = now();
    if (stamp - lastRefresh < REFRESH_MS) return;
    lastRefresh = stamp;

    const fps = snapshot.fps == null ? '—' : snapshot.fps.toFixed(0);
    set('fps', `${fps} fps · ${snapshot.frameMs.toFixed(1)} ms (worst ${snapshot.worstFrameMs.toFixed(1)})`);
    const player = snapshot.player;
    set(
      'player',
      `${player.x.toFixed(1)}, ${player.y.toFixed(2)}, ${player.z.toFixed(1)}\n` +
        `${player.speed.toFixed(2)} m/s · vy ${player.vy.toFixed(1)} · ${player.grounded ? 'grounded' : 'airborne'}` +
        `${snapshot.paused ? ' · PAUSED' : ''}`,
    );
    const input = snapshot.input;
    set(
      'input',
      `${input.mode}${input.looking ? ' · looking' : ''}${input.heldKeys ? ` · ${input.heldKeys} key(s)` : ''}` +
        `${input.sprint ? ' · SPRINT' : ''}` +
        `${input.capture && input.capture !== 'unknown' ? ` · mouse ${input.capture}` : ''}` +
        `${input.stick ? `\nstick ${input.stick.x.toFixed(2)}, ${input.stick.y.toFixed(2)} (${input.stick.magnitude.toFixed(2)})` : ''}`,
    );
    set('tick', `${snapshot.tick} · ${snapshot.simTime.toFixed(2)} s`);
    set('realm', `${snapshot.realm} · ${snapshot.mapId}`);
    set('seed', `${snapshot.seed} · ${snapshot.palette}`);
    set('origin', `${snapshot.scaleFence.worst.toFixed(1)} m (limit ${snapshot.scaleFence.limit})`);
    rows.get('origin').dd.classList.toggle('is-warn', snapshot.scaleFence.warn);
    set('entities', `${snapshot.entityCount} (hash ${snapshot.entityHash})`);
    // The lens-interaction layer in one line: which memory-flames are lit, and
    // whether the basin's causeway is complete. Dim when there is none to do.
    if (snapshot.insights && snapshot.insights.total > 0) {
      rows.get('insights').dd.hidden = false;
      rows.get('insights').dt.hidden = false;
      set(
        'insights',
        `${snapshot.insights.lit}/${snapshot.insights.total} lit` +
          (snapshot.insights.causeway ? ' · CAUSEWAY COMPLETE' : '') +
          (snapshot.realm === 'cognitive' && snapshot.insights.lit < snapshot.insights.total ? ' — walk through the small flames' : ''),
      );
    } else {
      rows.get('insights').dd.hidden = true;
      rows.get('insights').dt.hidden = true;
    }
    // The encounter layer in one line: what you have left, what is out there,
    // and what it is doing. The state tally is the AI's own answer, so a machine
    // that is stuck in one state is visible here before it is visible in play.
    const combat = snapshot.combat;
    set(
      'combat',
      combat
        ? `${'♥'.repeat(Math.max(0, Math.ceil(combat.health)))}${'·'.repeat(Math.max(0, combat.maxHealth - Math.ceil(combat.health)))}` +
            ` ${Math.ceil(combat.health)}/${combat.maxHealth} · ${combat.enemies} alive` +
            `${combat.dead ? ' · DEAD' : ''} · ${Object.entries(combat.states ?? {})
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k}:${n}`)
              .join(' ') || 'idle'}`
        : '—',
    );
    set('render', `${snapshot.drawCalls} calls · ${snapshot.triangles} tris`);
    set(
      'gpu',
      `${String(snapshot.gl.version).replace('WebGL ', 'gl').replace(' (OpenGL ES 3.0 Chromium)', '')}\n${snapshot.gl.gpu}`,
    );
    set('settings', snapshot.settingsHint);
    onRefresh?.(snapshot);
  }

  function set(key, text) {
    const row = rows.get(key);
    if (row && row.dd.textContent !== text) row.dd.textContent = text;
  }

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
    refresh,
  };
  return api;
}
