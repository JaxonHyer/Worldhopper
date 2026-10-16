/**
 * The fade to black — the one piece of M2's transition that is UI rather than
 * simulation, and until now the only shipped module with no test under it.
 *
 * The reason it matters: a throw inside `createFade` happens *while the game is
 * booting*, so the symptom is not a broken fade, it is a game that never starts.
 * That is exactly what a temporal-dead-zone reference in this file did — every
 * e2e test in the suite died waiting for a `ready` flag that could never be set,
 * and because the failure looked like slowness, the CI run was killed at its
 * timeout with nothing published to explain it.
 *
 * So this test drives the real module with a nine-line DOM stub. It is not a
 * browser; it is enough to prove the fade constructs, fades, refuses to overlap,
 * re-enters cleanly, and refuses to be poisoned by a hand-typed URL value.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFade } from '../../src/ui/fade.js';

/** The smallest DOM a fade can be built on. */
function stubDocument() {
  const makeElement = () => {
    const classes = new Set();
    return {
      className: '',
      style: {
        properties: {},
        setProperty(name, value) {
          this.properties[name] = String(value);
        },
      },
      setAttribute() {},
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    };
  };
  const mount = { children: [], appendChild(child) { this.children.push(child); } };
  return { mount, document: { createElement: makeElement } };
}

/** Run `createFade` with the stub installed, then take the stub back out. */
function withStub(fn) {
  const { mount, document: stub } = stubDocument();
  const realDocument = globalThis.document;
  globalThis.document = stub;
  try {
    return fn(mount);
  } finally {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
}

test('the fade constructs, and takes its length from the setting', () => {
  withStub((mount) => {
    const fade = createFade({ mount, fadeMs: 250 });
    // The regression: this line used to throw `fadeMs` before initialisation,
    // so the game never booted. Constructing it is the whole point of the test.
    assert.equal(mount.children.length, 1, 'the black panel must be mounted');
    assert.equal(mount.children[0].className, 'fade');
    assert.equal(mount.children[0].style.properties['--fade-ms'], '250ms');
    assert.equal(fade.active, false);
    assert.equal(fade.count, 0);
  });
});

test('a fade runs once, covers the switch, and clears itself', async () => {
  await withStub(async (mount) => {
    const fade = createFade({ mount, fadeMs: 5, holdMs: 1 });
    const element = mount.children[0];
    let switched = null;
    const ran = await fade.play(() => {
      switched = 'realm';
    });
    assert.equal(ran, true);
    assert.equal(switched, 'realm', 'the switch happens with the screen covered');
    assert.equal(fade.active, false, 'and the fade is over afterwards');
    assert.equal(fade.count, 1);
    assert.equal(element.classList.contains('is-active'), false, 'the black panel is off the screen');
  });
});

test('a second fade during one in flight is refused, not queued', async () => {
  await withStub(async (mount) => {
    const fade = createFade({ mount, fadeMs: 10, holdMs: 1 });
    const first = fade.play(() => {});
    assert.equal(fade.active, true);
    const second = await fade.play(() => {});
    assert.equal(second, false, 'two shifts inside one black frame would cancel out');
    assert.equal(fade.count, 1, 'the refused call must not count as a fade');
    assert.equal(await first, true);
    // ...and the fade is usable again, which is what walking in twice needs.
    assert.equal(await fade.play(() => {}), true);
    assert.equal(fade.count, 2);
  });
});

test('the duration is a live setting, and a bad one is refused', () => {
  withStub((mount) => {
    const fade = createFade({ mount, fadeMs: 400 });
    assert.equal(fade.setDuration(120), 120);
    assert.equal(mount.children[0].style.properties['--fade-ms'], '120ms');
    // A hand-typed URL must not be able to poison the transition.
    assert.equal(fade.setDuration(Number.NaN), 120);
    assert.equal(fade.setDuration(-50), 0, 'a negative duration is an instant cut');
    assert.equal(mount.children[0].style.properties['--fade-ms'], '0ms');
  });
});
