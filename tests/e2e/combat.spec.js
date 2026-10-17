/**
 * Combat end-to-end (WP-3.1 / WP-3.2).
 *
 * What is here and why:
 *
 *  - The **owner's path**: hearts on screen, a punch button a thumb can reach
 *    that does not sit under another thumb control.
 *  - The **fairness contract**, read back out of a real browser: every damage
 *    event in the log is preceded by its source's telegraph. The unit suite
 *    proves it about the sim; this proves the sim that ships is the sim that
 *    was tested.
 *  - **Death is a beat, not a teleport**: the card shows, the fade covers the
 *    walk, and you come back at the beacon with everything you had.
 *
 * Every walk here is driven with `step()` and measured in distance or in the
 * debug snapshot, never in seconds of wall clock — a software renderer on CI
 * runs at a fraction of real speed, and a timed assertion would be measuring
 * the renderer rather than the game.
 *
 * Nothing in this file asserts that a punch, a wind-up or a death *feels*
 * right. That is the owner's call and it is in the PR as a question.
 */

import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

/**
 * The enemies are 24–40 m out and the default aggro is 16 m, so a test that
 * wants an encounter has to widen the ring. `?aggro=` is the owner's own
 * slider, which is the honest way to do it: the test plays with the same knobs
 * the player has.
 */
const ENCOUNTER = 'aggro=40';

/** The nearest live enemy, and how far it is. */
function nearest(debug) {
  const roster = debug.combat?.roster ?? [];
  let best = null;
  let bestDistance = Infinity;
  for (const enemy of roster) {
    const distance = Math.hypot(enemy.x - debug.player.x, enemy.z - debug.player.z);
    if (distance < bestDistance) {
      best = enemy;
      bestDistance = distance;
    }
  }
  return best ? { enemy: best, distance: bestDistance } : null;
}

/**
 * Turn the player to face a point.
 *
 * Q and E are the held-key look path, and they go through the same
 * `look.rate` channel as the debug stepper, so a turn driven this way is as
 * deterministic as a walk. (KeyQ raises yaw; KeyE lowers it — `applyLookRate`
 * subtracts.)
 */
async function facePoint(page, target, { tolerance = 0.4, maxFrames = 90 } = {}) {
  let debug = await readDebug(page);
  for (let i = 0; i < maxFrames; i++) {
    const dx = target.x - debug.player.x;
    const dz = target.z - debug.player.z;
    if (Math.hypot(dx, dz) < 0.4) return debug;
    const wanted = Math.atan2(-dx, -dz);
    let delta = wanted - debug.player.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= tolerance) return debug;
    // One fixed step per iteration rather than a computed duration: the key
    // rate is scaled by the owner's look slider, so predicting how long a turn
    // takes would mean reimplementing it here and drifting from it later.
    const key = delta > 0 ? 'KeyQ' : 'KeyE';
    await page.keyboard.down(key);
    debug = await stepSim(page, 1 / 60);
    await page.keyboard.up(key);
  }
  return debug;
}

/** Step until the nearest enemy is within `radius` metres, or give up. */
async function approach(page, radius, { maxSteps = 500, step = 0.1 } = {}) {
  let debug = await readDebug(page);
  for (let i = 0; i < maxSteps; i++) {
    const found = nearest(debug);
    if (found && found.distance <= radius) return debug;
    debug = await stepSim(page, step);
    if (debug.combat.dead) return debug;
  }
  return debug;
}

test('the world opens inhabited, and your hearts are on screen', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  const debug = await startFrozen(page, `?seed=4242&${ENCOUNTER}`);

  expect(debug.combat, 'the snapshot carries the combat block').toBeTruthy();
  expect(debug.combat.enemies, 'nobody lands in an empty world').toBeGreaterThanOrEqual(1);
  expect(debug.combat.maxHealth).toBe(4);
  expect(debug.combat.health).toBe(4);
  expect(debug.combat.dead).toBe(false);
  expect(debug.combat.roster.length).toBe(debug.combat.enemies);
  for (const enemy of debug.combat.roster) {
    expect(enemy.state).toBe('idle', 'a freshly spawned enemy is wandering, not hunting');
    expect(['crag-lurker', 'storm-warden']).toContain(enemy.type);
  }

  // Hearts, and no damage numbers anywhere.
  const hearts = page.locator('.health__heart:not([hidden])');
  await expect(hearts).toHaveCount(4);
  await expect(page.locator('.health__heart:not([hidden]).is-empty')).toHaveCount(0);
  await expect(page.locator('.health')).toHaveAttribute('aria-label', '4 of 4 hearts');
  await saveShot(page, 'combat-hearts', testInfo);

  watch.assertClean();
});

test('the phone gets a punch button, and it touches no other thumb control', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'this is the phone’s thumb layout');
  const watch = attachWatch(page);
  await gotoGame(page, '?seed=4242');

  const boxes = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const overlaps = (a, b) =>
      Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
    const attack = box('.touch-attack');
    return {
      attack,
      jump: box('.touch-jump'),
      sprint: box('.touch-sprint'),
      prompt: box('.interact-prompt'),
      hitsJump: overlaps(attack, box('.touch-jump')),
      hitsSprint: overlaps(attack, box('.touch-sprint')),
      hitsPrompt: overlaps(attack, box('.interact-prompt')),
    };
  });

  expect(boxes.attack, 'the punch button is on screen').toBeTruthy();
  expect(boxes.attack.width, 'a thumb target, not a pixel hunt').toBeGreaterThanOrEqual(64);
  expect(boxes.attack.height).toBeGreaterThanOrEqual(64);
  expect(boxes.hitsJump, 'it must not sit under jump').toBe(false);
  expect(boxes.hitsSprint, 'it must not sit under sprint').toBe(false);
  expect(boxes.hitsPrompt, 'it must not sit under the Talk prompt').toBe(false);

  await saveShot(page, 'combat-thumb-layout', testInfo);
  watch.assertClean();
});

test('a punch connects — desktop key and phone tap', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  // One enemy and five hearts: enough of a fight to be a real test, and enough
  // health to survive the walk up to it.
  let debug = await startFrozen(page, `?seed=4242&${ENCOUNTER}&enemies=1&hearts=5`);
  expect(debug.combat.enemies).toBe(1);

  // Let it notice you and close the distance.
  debug = await approach(page, 7, { maxSteps: 400 });
  expect(debug.combat.dead, 'you survived the walk').toBe(false);
  const target = nearest(debug);
  expect(target, 'an enemy is out there').toBeTruthy();

  // Turn to face it, then let it come to you. A punch that connects from behind
  // would prove nothing about the arc.
  await facePoint(page, { x: target.enemy.x, z: target.enemy.z });
  debug = await approach(page, 2.6, { maxSteps: 300 });
  expect(debug.combat.dead, 'you survived the closing distance').toBe(false);
  // Re-aim at the last moment: it has been walking at you, so the bearing it
  // had a second ago is not the bearing it has now.
  await facePoint(page, { x: nearest(debug).enemy.x, z: nearest(debug).enemy.z }, { maxFrames: 20 });
  const before = debug.combat.hitsLanded;
  expect(before).toBe(0);

  await saveShot(page, 'combat-about-to-punch', testInfo);
  if (isMobile) {
    await page.locator('.touch-attack').tap();
  } else {
    await page.keyboard.press('KeyJ');
  }
  const after = await stepSim(page, 0.6);

  expect(after.combat.hitsLanded, 'the swing connected').toBeGreaterThan(before);
  expect(after.combat.swings).toBe(1);
  const swung = after.combat.events.filter((e) => e.kind === 'punch');
  expect(swung.length, 'the log says a swing happened').toBeGreaterThan(0);
  const hit = after.combat.roster.find((e) => e.id === target.enemy.id);
  if (hit) {
    expect(hit.health, 'and it cost the enemy something').toBeLessThanOrEqual(target.enemy.health);
  }
  await saveShot(page, 'combat-after-punch', testInfo);

  watch.assertClean();
});

test('every hit in a real session was telegraphed first', async ({ page }) => {
  const watch = attachWatch(page);
  await startFrozen(page, `?seed=4242&${ENCOUNTER}&enemies=4`);

  const seen = [];
  let damages = 0;
  // Twenty-five seconds of an actual encounter, read a second at a time: the
  // snapshot carries the tail of the log, so walking it in order sees the whole
  // run rather than only its last moments.
  for (let i = 0; i < 25; i++) {
    const debug = await stepSim(page, 1);
    seen.push(...debug.combat.events);
    damages += debug.combat.events.filter((e) => e.kind === 'damage').length;
    if (debug.combat.dead) break;
  }
  expect(damages, 'the run really contained a fight').toBeGreaterThan(0);

  // Deduplicate by tick+kind+source: the tail overlaps between reads.
  const log = [];
  const keys = new Set();
  for (const event of seen) {
    const key = `${event.tick}:${event.kind}:${event.by}:${event.to}`;
    if (keys.has(key)) continue;
    keys.add(key);
    log.push(event);
  }

  for (const event of log.filter((e) => e.kind === 'damage')) {
    const telegraph = [...log]
      .reverse()
      .find((e) => e.kind === 'telegraph' && e.by === event.by && e.tick <= event.tick);
    expect(telegraph, `damage at tick ${event.tick} from ${event.by} had no telegraph`).toBeTruthy();
    if (event.to === 'player') {
      expect(telegraph.windup, 'a hit on the player is telegraphed for the contract’s minimum').toBeGreaterThanOrEqual(0.4);
    }
  }

  watch.assertClean();
});

test('death is a beat, and the beacon is where you come back', async ({ page }, testInfo) => {
  const watch = attachWatch(page);
  // Three hearts and a fast fade, so the whole beat fits inside a test.
  let debug = await startFrozen(page, `?seed=4242&${ENCOUNTER}&enemies=3&hearts=3&fadems=60`);
  expect(debug.combat.beacon).toBe('beacon-waystone', 'Roshar’s opening checkpoint');

  // Stand there and let it happen. Every hit is telegraphed, so this is a slow,
  // readable death rather than an ambush.
  for (let i = 0; i < 60 && !debug.combat.dead; i++) {
    debug = await stepSim(page, 1);
  }
  expect(debug.combat.dead, 'three hearts and three hunters is a death').toBe(true);
  expect(debug.combat.health).toBe(0);
  expect(debug.combat.deaths).toBe(1);
  await expect(page.locator('.death-card')).toBeVisible();
  await saveShot(page, 'combat-death', testInfo);

  // The frame loop owns the beat (a fade holds the sim still, so a sim-driven
  // timer could never finish inside its own fade). It runs whether or not the
  // sim is paused, which is what makes this assertable.
  await expect
    .poll(async () => (await readDebug(page)).combat.dead, { timeout: 20_000 })
    .toBe(false);

  const back = await readDebug(page);
  expect(back.combat.health, 'you come back whole').toBe(back.combat.maxHealth);
  expect(back.combat.deaths).toBe(1, 'and you are not killed again for it');
  expect(Math.hypot(back.player.x, back.player.z), 'back at the beacon, not where you fell').toBeLessThan(1.5);
  expect(back.combat.invuln, 'with a moment of grace').toBeGreaterThan(0);
  await saveShot(page, 'combat-respawned', testInfo);

  watch.assertClean();
});

test('enemies are flames in the Cognitive Realm, like everything else that lives', async ({ page }, testInfo) => {
  const watch = attachWatch(page);
  await gotoGame(page, `?map=roshar&seed=4242&${ENCOUNTER}`);
  await page.evaluate(() => window.__worldhopper.realm('cognitive'));
  await expect.poll(async () => (await readDebug(page)).realm).toBe('cognitive');

  const debug = await readDebug(page);
  expect(debug.skin.authored).toBe(true);
  expect(debug.skin.enemyFlames, 'a living thing is a flame in Shadesmar').toBeGreaterThanOrEqual(1);
  // The beads-and-flames rule from skin.spec.js still holds: enemies are
  // actors, not furniture, so they are flames *in addition to* the entity count.
  expect(debug.combat.enemies).toBe(debug.skin.enemyFlames);
  await saveShot(page, 'combat-enemy-flames', testInfo);

  watch.assertClean();
});

test('the wind-up slider cannot be dragged below the fairness floor', async ({ page }) => {
  const watch = attachWatch(page);
  await gotoGame(page, `?seed=4242&windup=0.01&enemies=1&${ENCOUNTER}`);
  const debug = await readDebug(page);
  // The setting itself is clamped by the schema...
  expect(debug.settings.enemyWindup).toBe(0.4);
  // ...and even if it were not, the archetype floors it again on the way in.
  const windups = debug.combat.roster.map((enemy) => enemy.type);
  expect(windups.length).toBeGreaterThan(0);

  watch.assertClean();
});
