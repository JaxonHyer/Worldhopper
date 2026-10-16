import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot, startFrozen, stepSim } from './helpers.js';

/**
 * M2: the cognitive skin — Roshar, the first authored world.
 *
 * What is being checked here is *not* "is it beautiful" (that is the owner's
 * call, and it is asked for in the PR). It is whether the realm actually
 * manifests: the renderer reports a bead sea where there was a basin, the sky
 * is not the physical sky, and the gate still works on the new world.
 *
 * The screenshots are the playtest artifact: physical and cognitive, side by
 * side, from the same seed.
 */

/**
 * The transition length is a feel number (`?fadems=`): the walk tests below are
 * about the rule, so they run it short, and the screenshots keep the default.
 */
const QUICK_FADE = 'fadems=120';
const withQuickFade = (query) => `${query}${query.includes('?') ? '&' : '?'}${QUICK_FADE}`;

test('Roshar manifests its skin in the cognitive realm, and only there', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop gallery; the phone is covered below');
  const watch = attachWatch(page);

  // Physical: the world as it was — no manifestation, and a sky that is a sky.
  const physical = await startFrozen(page, '?map=roshar');
  expect(physical.mapId).toBe('roshar');
  expect(physical.realm).toBe('physical');
  expect(physical.skin.authored).toBe(true);
  expect(physical.skin.objectForm).toBe('glass-beads');
  expect(physical.skin.beads).toBe(0, 'nothing is laid until the realm needs it');
  expect(physical.camera.projection).toBe('perspective');

  // Cognitive: the same map, the other manifestation.
  const cognitive = await startFrozen(page, '?map=roshar&realm=cognitive');
  expect(cognitive.realm).toBe('cognitive');
  expect(cognitive.camera.projection).toBe('orthographic');
  expect(cognitive.skin.authored).toBe(true);
  expect(cognitive.skin.beads, 'a bead sea, not a token handful').toBeGreaterThan(1000);
  expect(cognitive.skin.souls).toBe(physical.entityCount);
  // Same world: the realm is a lens, not a teleport.
  const cognitiveStepped = await stepSim(page, 0.5);
  expect(cognitiveStepped.entityHash).toBe(physical.entityHash);

  watch.assertClean();
});

test('the gate opens on the new world too, and takes you back', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path; the phone is covered below');
  const watch = attachWatch(page);
  const before = await startFrozen(page, withQuickFade('?map=roshar'));

  // Walk into the pool: the same arrangement as the test range, so the same
  // tactic — hold W until the fade counter moves, never race the boolean.
  await page.keyboard.down('KeyW');
  let fades = before.ui.fades;
  for (let i = 0; i < 10 && fades === before.ui.fades; i++) {
    fades = (await stepSim(page, 0.4)).ui.fades;
  }
  await page.keyboard.up('KeyW');
  expect(fades, 'walking into the pool must shift the realm on Roshar too').toBeGreaterThan(before.ui.fades);

  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 10_000 }).toBe('cognitive');
  const arrived = await readDebug(page);
  expect(arrived.camera.projection).toBe('orthographic');
  // You arrive *in* the manifestation, standing in the bead sea.
  expect(arrived.skin.beads).toBeGreaterThan(1000);
  expect(arrived.entityHash).toBe(before.entityHash);

  // And back out: walk on, turn round, come home.
  await page.keyboard.down('KeyS');
  let back = arrived.ui.fades;
  for (let i = 0; i < 10 && back === arrived.ui.fades; i++) {
    back = (await stepSim(page, 0.4)).ui.fades;
  }
  await page.keyboard.up('KeyS');
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 10_000 }).toBe('physical');
  watch.assertClean();
});

test('captures Roshar in both realms', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'the desktop camera is the one being judged here');
  const watch = attachWatch(page);
  test.setTimeout(120_000);

  // The physical world, from the spawn.
  await gotoGame(page, '?map=roshar&debug=0');
  await page.waitForTimeout(600);
  await saveShot(page, 'roshar-physical', testInfo);

  // The same seed, the same place, through the lens: the image the owner judges
  // the skin by.
  await gotoGame(page, '?map=roshar&realm=cognitive&debug=0');
  await page.waitForTimeout(900);
  await saveShot(page, 'roshar-cognitive', testInfo);

  // Walk a little, so the bead sea is judged as a sea rather than as a disc.
  await page.keyboard.down('KeyW');
  await stepSim(page, 1.0);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  await saveShot(page, 'roshar-cognitive-walked', testInfo);

  // First person, physical: the player's own eye on the patch, for comparison
  // with the M1 screenshots of the test range.
  await gotoGame(page, '?map=roshar&view=first&debug=0');
  await page.waitForTimeout(500);
  await saveShot(page, 'roshar-first-person', testInfo);
  watch.assertClean();
});

test('the phone gets the manifestation too', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch path');
  const watch = attachWatch(page);
  const before = await startFrozen(page, withQuickFade('?map=roshar'));
  expect(before.ui.touch).toBe(true);
  expect(before.mapId).toBe('roshar');

  // Push the thumb-stick forward and let it walk into the pool, exactly as a
  // player would: the realm must shift, and the skin must be there when it does.
  const box = await page.locator('#game').boundingBox();
  const client = await page.context().newCDPSession(page);
  const startX = Math.round(box.x + box.width * 0.25);
  const startY = Math.round(box.y + box.height * 0.72);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: startX, y: Math.round(startY - (130 * i) / 6), id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  const fadesBefore = (await readDebug(page)).ui.fades;
  let shifted = false;
  for (let i = 0; i < 10 && !shifted; i++) {
    const snap = await stepSim(page, 0.4);
    shifted = snap.ui.fades > fadesBefore;
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();

  expect(shifted, 'the thumb-stick path must reach the pool on Roshar').toBe(true);
  await expect.poll(async () => (await readDebug(page)).realm, { timeout: 10_000 }).toBe('cognitive');
  const arrived = await readDebug(page);
  expect(arrived.skin.beads).toBeGreaterThan(1000);
  expect(arrived.ui.fade).toBe(false);
  watch.assertClean();
});
