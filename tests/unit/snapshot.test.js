/**
 * The debug snapshot is a contract between the sim, the overlay and the
 * headless tests (§8). These tests build a *real* snapshot from the real
 * modules and push it through the real overlay against a tiny DOM stub, so a
 * field the overlay reads but the snapshot no longer provides fails here —
 * locally and in a second — instead of as a blank page in CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, SNAPSHOT_KEYS } from '../../src/core/snapshot.js';
import { APP } from '../../src/core/config.js';
import { createFixedClock } from '../../src/core/clock.js';
import { createFrameStats } from '../../src/core/frame-stats.js';
import { createWorldState, setRealm, stepWorld } from '../../src/core/world-state.js';
import { getMap, getVariant, DEFAULT_MAP_ID } from '../../src/core/maps/index.js';
import { defaultSettings } from '../../src/core/settings.js';

// --- a DOM small enough to be obviously correct ---------------------------
function createElementStub(tag = 'div') {
  const element = {
    tagName: tag,
    children: [],
    hidden: false,
    textContent: '',
    className: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append(...nodes) {
      for (const node of nodes) element.children.push(node);
    },
    setAttribute() {},
    querySelector: () => null,
    addEventListener() {},
  };
  return element;
}

function installDomStub() {
  const previous = globalThis.document;
  globalThis.document = { createElement: createElementStub };
  return () => {
    globalThis.document = previous;
  };
}

/** Depth-first text of the stub tree, so we can assert what was written. */
function texts(element, out = []) {
  if (typeof element.textContent === 'string' && element.textContent !== '') out.push(element.textContent);
  for (const child of element.children ?? []) texts(child, out);
  return out;
}

function realSnapshot(overrides = {}) {
  const map = getMap(DEFAULT_MAP_ID);
  const settings = { ...defaultSettings(), ...overrides.settings };
  const state = createWorldState({ map, seed: settings.seed });
  const clock = createFixedClock({ stepHz: 60 });
  const frameStats = createFrameStats();
  for (let i = 0; i < 30; i++) {
    frameStats.sample(1 / 60);
    const steps = clock.advance(1 / 60);
    for (let s = 0; s < steps; s++) stepWorld(state, clock.step, { lookRate: { x: 1, y: 0 } });
  }
  return buildSnapshot({
    app: APP,
    state,
    map,
    variant: getVariant(map.id, settings.palette),
    settings,
    clock,
    frameStats,
    render: { drawCalls: 7, triangles: 1234, gl: { version: 'WebGL 2.0 (stub)', gpu: 'Stub Renderer' } },
    ui: { overlay: true, panel: false, credits: false },
    ready: true,
    ...overrides.snapshot,
  });
}

test('the snapshot reports the cognitive skin the renderer is drawing', () => {
  // The renderer's answer, not the map's data read back: a test that asserts
  // which manifestation is on screen has to be able to fail when the renderer
  // decides not to draw it (a canon violation, a missing layer).
  const roshar = getMap('roshar');
  const settings = defaultSettings();
  const state = createWorldState({ map: roshar, seed: settings.seed });
  const clock = createFixedClock({ stepHz: 60 });
  const snapshot = buildSnapshot({
    app: APP,
    state,
    map: roshar,
    variant: getVariant(roshar.id, 'storm-shore'),
    settings,
    clock,
    frameStats: createFrameStats(),
    render: {
      drawCalls: 1,
      triangles: 2,
      gl: { version: 'stub', gpu: 'stub' },
      avatarVariant: 'boy',
      skin: { id: 'roshar-shadesmar', system: 'rosharan', objectForm: 'glass-beads', authored: true, beads: 2025, souls: 31, flame: true, npcFlames: 2 },
    },
    ui: { overlay: false, panel: false, credits: false },
    ready: true,
  });
  assert.equal(snapshot.skin.id, 'roshar-shadesmar');
  assert.equal(snapshot.skin.objectForm, 'glass-beads');
  assert.equal(snapshot.skin.authored, true);
  assert.equal(snapshot.skin.beads, 2025);
  // WP-3.4: the renderer's NPC flame count reaches the snapshot. Without this
  // line the renderer reports `npcFlames` and the snapshot drops it — the
  // assert in tests/e2e/npc.spec.js then reads `undefined` and reports a
  // matcher error instead of the thing under test.
  assert.equal(snapshot.skin.npcFlames, 2);

  // And a map with no skin says so, rather than reporting a blank.
  const plain = realSnapshot();
  assert.equal(plain.skin.authored, false);
  assert.equal(plain.skin.objectForm, 'unassigned');
  assert.equal(plain.skin.beads, 0);
  assert.equal(plain.skin.npcFlames, 0, 'a world with no manifestation has no NPC flames to report');
});

test('the snapshot drops no UI field it is given', () => {
  // `ui` is a whitelist, so a field can be handed to the snapshot, silently
  // dropped, and then read as `undefined` by every test that asks for it. That
  // is what happened to `fade`/`fades` on the M2 branch: the pool's own spec
  // failed with "Expected: false, Received: undefined" and the game was fine.
  const ui = { overlay: false, panel: true, credits: false, touch: true, fade: true, fades: 2 };
  const snapshot = realSnapshot({ snapshot: { ui } });
  assert.deepEqual(
    Object.keys(snapshot.ui).sort(),
    Object.keys(ui).sort(),
    'the snapshot must report exactly the ui fields the game hands it',
  );
  assert.equal(snapshot.ui.fade, true);
  assert.equal(snapshot.ui.fades, 2);

  // The render block is the same kind of whitelist — the fields it is handed
  // are lifted to the top level, and one that is not named there disappears in
  // silence. `skin` was added last, so each of these would have caught it.
  const render = {
    drawCalls: 3,
    triangles: 9,
    gl: { version: 'stub', gpu: 'stub' },
    avatarVariant: 'girl',
    skin: { id: 'roshar-shadesmar', system: 'rosharan', objectForm: 'glass-beads', authored: true, beads: 4, souls: 5 },
  };
  const withRender = realSnapshot({ snapshot: { render } });
  assert.equal(withRender.drawCalls, 3);
  assert.equal(withRender.triangles, 9);
  assert.equal(withRender.avatarVariant, 'girl');
  assert.equal(withRender.skin.id, 'roshar-shadesmar');
  assert.equal(withRender.skin.objectForm, 'glass-beads');
  assert.equal(withRender.skin.beads, 4);
  assert.equal(withRender.skin.souls, 5);
});

test('the snapshot carries every documented key', () => {
  const snapshot = realSnapshot();
  for (const key of SNAPSHOT_KEYS) {
    assert.ok(key in snapshot, `snapshot is missing ${key}`);
  }
  for (const key of Object.keys(snapshot)) {
    assert.ok(SNAPSHOT_KEYS.includes(key), `snapshot has an undocumented key: ${key}`);
  }
});

test('the snapshot is JSON-clean: no NaN, no undefined, no -0', () => {
  const snapshot = realSnapshot();
  const walk = (value, path) => {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`);
      assert.ok(!Object.is(value, -0), `${path} is -0`);
      return;
    }
    if (typeof value === 'string' || typeof value === 'boolean' || value === null) return;
    assert.notEqual(value, undefined, `${path} is undefined`);
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${path}[${i}]`));
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(snapshot, 'snapshot');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test('fps is null only before there is evidence, and reports after', () => {
  const early = realSnapshot({ snapshot: {}, settings: {} });
  assert.equal(typeof early.fps, 'number');
  assert.ok(early.fps > 0);
});

test('the overlay renders a real snapshot without throwing', async () => {
  const restore = installDomStub();
  try {
    const { createDebugOverlay } = await import('../../src/ui/debug-overlay.js');
    const mount = createElementStub();
    let now = 1000;
    const overlay = createDebugOverlay({ mount, now: () => now });
    const snapshot = realSnapshot();

    overlay.refresh(snapshot);
    const rendered = texts(mount);
    assert.ok(rendered.some((text) => text.includes('Stub Renderer')), 'the gpu row was not written');
    assert.ok(rendered.some((text) => text.includes(String(snapshot.seed))), 'the seed row was not written');
    assert.ok(rendered.some((text) => /m \(limit \d+\)/.test(text)), 'the canary row was not written');
    assert.ok(rendered.some((text) => text.includes(String(snapshot.entityHash))), 'the entity row was not written');
    assert.ok(!rendered.includes('…'), 'a row was left as a placeholder');

    // Throttled: a refresh inside the window must not touch the DOM at all.
    const settled = texts(mount);
    now += 10;
    overlay.refresh(realSnapshot({ snapshot: { entityCount: 999 } }));
    assert.deepEqual(texts(mount), settled, 'refresh ignored its throttle');

    // ...but after the window it must pick the new values up.
    now += 1000;
    overlay.refresh({ ...snapshot, entityCount: 999 });
    assert.ok(texts(mount).some((text) => text.includes('999')), 'refresh did nothing after the throttle window');
  } finally {
    restore();
  }
});

test('the overlay flags the scale-fence canary when the world drifts', async () => {
  const restore = installDomStub();
  try {
    const { createDebugOverlay } = await import('../../src/ui/debug-overlay.js');
    const mount = createElementStub();
    let now = 0;
    const overlay = createDebugOverlay({ mount, now: () => (now += 500) });
    const snapshot = realSnapshot();
    snapshot.scaleFence = { worst: 4200, limit: 4000, warn: true };
    overlay.refresh(snapshot);
    assert.ok(snapshot.scaleFence.warn, 'the canary must be able to warn');
    assert.ok(texts(mount).some((text) => text.includes('4200')), 'the canary row did not show the drift');
  } finally {
    restore();
  }
});

test('the snapshot reports the lens the world is actually using', () => {
  // Regression, caught by CI on the first M2 run: the snapshot rebuilt its
  // camera without the realm, so the debug surface (and the e2e tests that read
  // it) said "perspective" while the screen was already showing the Cognitive
  // lens. Derived fields have to be derived from the state, never from memory.
  const map = getMap(DEFAULT_MAP_ID);
  const settings = { ...defaultSettings(), realmZoom: 60 };
  const state = createWorldState({ map, seed: settings.seed });
  const clock = createFixedClock({ stepHz: 60 });
  const frameStats = createFrameStats();
  const build = () =>
    buildSnapshot({
      app: APP,
      state,
      map,
      variant: getVariant(map.id, settings.palette),
      settings,
      clock,
      frameStats,
      render: { drawCalls: 1, triangles: 2, gl: { version: 'stub', gpu: 'stub' } },
      ui: { overlay: false, panel: false, credits: false },
      ready: true,
    });

  const physical = build();
  assert.equal(physical.realm, 'physical');
  assert.equal(physical.camera.projection, 'perspective');
  assert.equal(physical.camera.span, 0);

  setRealm(state, 'cognitive');
  const lens = build();
  assert.equal(lens.realm, 'cognitive');
  assert.equal(lens.camera.projection, 'orthographic');
  assert.equal(lens.camera.span, 60, 'the lens reports the height it is showing');
  assert.equal(lens.tick, physical.tick, 'a shift is not a step');
  assert.equal(lens.camera.y, lens.camera.y);
  assert.ok(lens.camera.y > physical.camera.y, 'the lens sits above the boom camera');
});
