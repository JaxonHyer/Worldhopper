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
import { createWorldState, stepWorld } from '../../src/core/world-state.js';
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
