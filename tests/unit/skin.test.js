/**
 * `cognitiveSkin`: the contract, and the one canon rule that is load-bearing.
 *
 * The roadmap puts it in bold, so it gets a test rather than a code review:
 * *"Beads exist only over the Rosharan system. Never put beads on Scadrial."*
 * A skin that gets this wrong must fail here — in Node, in milliseconds — and
 * not in a screenshot of a planet nobody has authored yet.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAD_SYSTEM, SKIN_FORMS, UNAUTHORED_SKIN, beadVariation, describeSkin, resolveCognitiveSkin } from '../../src/core/skin.js';
import { MAPS, getMap } from '../../src/core/maps/index.js';

/** A map-shaped object with just enough to be resolved. */
const mapWith = (system, cognitiveSkin) => ({ id: `synthetic-${system}`, system, cognitiveSkin });

const ROSHARAN_SKIN = {
  id: 'synthetic-beads',
  system: BEAD_SYSTEM,
  objectForm: 'glass-beads',
  livingForm: 'flame',
  waterForm: 'solid-obsidian',
  landForm: 'bead-sea',
  light: { source: 'black-sky-frail-white-sun', dayNightCycle: false },
};
const SCADRIAN_SKIN = {
  id: 'synthetic-mist',
  system: 'scadrian',
  objectForm: 'misty-figures',
  livingForm: 'glow',
  waterForm: 'solid-dark-stone',
  landForm: 'misty-fluid',
  light: { source: 'drifting-mist-light' },
};

test('an authored skin resolves whole, with its forms and its canon guards clear', () => {
  const skin = resolveCognitiveSkin(mapWith(BEAD_SYSTEM, ROSHARAN_SKIN));
  assert.equal(skin.authored, true);
  assert.deepEqual(skin.violations, []);
  assert.equal(skin.objectForm, 'glass-beads');
  assert.equal(skin.landForm, 'bead-sea');
  assert.equal(skin.light.source, 'black-sky-frail-white-sun');
  // "no day or night cycle in the Cognitive Realm" is data, not a comment.
  assert.equal(skin.light.dayNightCycle, false);
});

test('beads on anything but Roshar are a canon violation, not a look', () => {
  // The exact mistake the roadmap names: Scadrial is mist, never beads.
  const skin = resolveCognitiveSkin(mapWith('scadrian', { ...SCADRIAN_SKIN, objectForm: 'glass-beads' }));
  assert.equal(skin.authored, false, 'a canon violation must not draw');
  assert.ok(skin.violations.some((v) => v.startsWith('objectForm:not-rosharan')), `got ${skin.violations}`);

  // ...and the bead sea is the same offence by another name.
  const land = resolveCognitiveSkin(mapWith('scadrian', { ...SCADRIAN_SKIN, landForm: 'bead-sea' }));
  assert.equal(land.authored, false);
  assert.ok(land.violations.some((v) => v.startsWith('landForm:not-rosharan')));

  // A map with no system at all cannot claim them either: an unassigned world is
  // not a licence to borrow someone else's canon.
  const unassigned = resolveCognitiveSkin(mapWith('unassigned', ROSHARAN_SKIN));
  assert.equal(unassigned.authored, false);
  const beadOffences = unassigned.violations.filter((v) => v.includes('not-rosharan'));
  assert.equal(beadOffences.length, 2, `both bead forms must be refused, got ${unassigned.violations}`);

  // Scadrial's own forms are fine on Scadrial.
  const mist = resolveCognitiveSkin(mapWith('scadrian', SCADRIAN_SKIN));
  assert.equal(mist.authored, true);
  assert.deepEqual(mist.violations, []);

  // A skin cannot promote itself: the map's system is the one that counts.
  const selfClaiming = resolveCognitiveSkin({ id: 'liar', system: 'scadrian', cognitiveSkin: ROSHARAN_SKIN });
  assert.equal(selfClaiming.authored, false, 'a Scadrian map with a Rosharan skin is still Scadrial');
  assert.ok(selfClaiming.violations.some((v) => v.startsWith('system:mismatch')));
  assert.ok(selfClaiming.violations.some((v) => v.startsWith('objectForm:not-rosharan')));
});

test('an unknown form is refused rather than drawn as something else', () => {
  const skin = resolveCognitiveSkin(mapWith(BEAD_SYSTEM, { ...ROSHARAN_SKIN, livingForm: 'ghost-flames' }));
  assert.equal(skin.authored, false);
  assert.ok(skin.violations.includes('livingForm:unknown:ghost-flames'));
});

test('a partly-authored skin is not authored at all', () => {
  const skin = resolveCognitiveSkin(mapWith(BEAD_SYSTEM, { ...ROSHARAN_SKIN, waterForm: 'unassigned' }));
  assert.equal(skin.authored, false);
  assert.equal(skin.objectForm, 'unassigned', 'a half-skin must not leak the forms it did name');
  assert.deepEqual(skin.violations, []);
});

test('the unassigned skin is the documented, empty one', () => {
  const skin = resolveCognitiveSkin({ id: 'nowhere', system: 'unassigned', cognitiveSkin: { system: 'unassigned' } });
  assert.equal(skin.authored, false);
  assert.equal(skin.objectForm, UNAUTHORED_SKIN.objectForm);
  // Optional blocks are still filled in, so nothing downstream has to guess.
  assert.ok(skin.light.sun.direction.y > 0.5);
  assert.match(skin.palette.bead, /^#/);
});

test('the shipped maps resolve: the test range unassigned, Roshar authored', () => {
  for (const map of Object.values(MAPS)) {
    const skin = resolveCognitiveSkin(map);
    assert.deepEqual(skin.violations, [], `${map.id} has a skin violation`);
    if (map.id === 'blank-basin') {
      assert.equal(skin.authored, false, 'the test range has no canon, so it has no skin');
    }
  }
  const roshar = resolveCognitiveSkin(getMap('roshar'));
  assert.equal(roshar.authored, true);
  assert.equal(roshar.system, BEAD_SYSTEM);
  assert.equal(roshar.objectForm, 'glass-beads');
  assert.equal(roshar.livingForm, 'flame');
  assert.equal(roshar.waterForm, 'solid-obsidian');
  assert.equal(roshar.landForm, 'bead-sea');
  // Every form named is one the vocabulary actually has.
  for (const key of ['objectForm', 'livingForm', 'waterForm', 'landForm']) {
    assert.ok(SKIN_FORMS[key].includes(roshar[key]), `${key} must be a known form`);
  }
  assert.equal(describeSkin(roshar).authored, true);
});

test('a bead is a function of where it is, not of when it was drawn', () => {
  // The variation has to come from the world position: a bead that changed size
  // as the camera moved would make the sea crawl.
  const a = beadVariation(3, -7, 1607255203);
  const b = beadVariation(3, -7, 1607255203);
  assert.deepEqual(a, b);
  const elsewhere = beadVariation(4, -7, 1607255203);
  assert.notDeepEqual(a, elsewhere);
  const otherSeed = beadVariation(3, -7, 99);
  assert.notDeepEqual(a, otherSeed);
  assert.ok(a.radius >= 0.45 && a.radius <= 0.85, 'radius stays inside the documented range');
});
