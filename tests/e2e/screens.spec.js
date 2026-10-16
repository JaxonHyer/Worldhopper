import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, openStick, readDebug, saveShot } from './helpers.js';

/**
 * Deliverable screenshots for the owner's taste calls (§10): the third-person
 * pose (the change they asked for), first person for comparison, 3 palette
 * variants, plus overlay / panel / credits. These are the images the owner
 * compares against the live build.
 */

/**
 * The pool is 14 m ahead of the spawn (M2: a Perpendicularity *by spawn*), and
 * its edge — the point where walking forward takes you into the other realm —
 * is 10.6 m out. Measured in the sim: a 1.0 s walk plus the 0.3 s of coasting
 * after the key comes up travels 7.90 m, leaving 2.70 m in hand. (At 1.2 s it
 * was 1.12 m, which was not enough: these waits are wall clock, so the key
 * dispatch latency lands on top, and the first green run came back with a
 * flaky "the pool must not have swallowed the walk".)
 *
 * Every walk in this file exists to photograph the **physical** world and the
 * character's pose, so the walks stop short of the pool — and each one asserts
 * the realm *before* its screenshot, so a walk that goes wrong fails instead of
 * quietly filing a lens picture under the physical world's name.
 */
const POOL_EDGE_SECONDS = 1.0;

const isPhysical = async (page) => (await readDebug(page)).realm === 'physical';

test('captures the deliverable screenshots', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  // Eight page loads and several seconds of walking each; CI renders with
  // SwiftShader, so give the gallery room rather than measuring its patience.
  test.setTimeout(240_000);

  if (isMobile) {
    await gotoGame(page);
    await saveShot(page, 'phone-home', testInfo);

    // The stick only exists while a thumb is on it, so capture mid-gesture.
    const stick = await openStick(page, 0, -110);
    await page.waitForTimeout(700);
    await saveShot(page, 'phone-stick', testInfo);
    await stick.release();

    await page.locator('.touch-jump').tap();
    await page.waitForTimeout(260);
    await saveShot(page, 'phone-jump', testInfo);
    await page.waitForTimeout(1200);

    // The sprint toggle, in its on state: bottom-left, one tap, no holding.
    await page.locator('.touch-sprint').tap();
    await page.waitForTimeout(200);
    await saveShot(page, 'phone-sprint-on', testInfo);
    await page.locator('.touch-sprint').tap();

    watch.assertClean();
    return;
  }

  // The test range's three palettes, named along with the map they belong to:
  // palette names are per-world data, and the game no longer opens on this map.
  for (const variant of ['ashen-basin', 'mist-sea', 'cold-ridge']) {
    await gotoGame(page, `?map=blank-basin&palette=${variant}`);
    const debug = await readDebug(page);
    if (debug.palette !== variant) throw new Error(`palette ${variant} did not load (got ${debug.palette})`);
    await saveShot(page, `world-${variant}`, testInfo);
  }

  await gotoGame(page);
  await saveShot(page, 'world-default', testInfo);

  // Walking: hold W and photograph the world from where the player got to.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(POOL_EDGE_SECONDS * 1000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  expect(await isPhysical(page), 'the pool must not have swallowed the walk').toBe(true);
  await saveShot(page, 'world-walked', testInfo);

  // The third-person pose, from a few distances so the boom length is judgeable
  // in one image set rather than by dragging the slider back and forth.
  for (const distance of [3, 4.2, 6.5]) {
    await gotoGame(page, `?camdist=${distance}&debug=0`);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(POOL_EDGE_SECONDS * 1000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(220); // catch them mid-stride, still walking
    expect(await isPhysical(page), 'the pool must not have swallowed the walk').toBe(true);
    await saveShot(page, `third-person-${String(distance).replace('.', '_')}m`, testInfo);
  }

  // Looking down at the character, which is where a boom camera earns its keep.
  await gotoGame(page, '?camdist=5.5');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(800, 700, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(180); // still short of the pool edge at 1.08 s
  await page.keyboard.up('KeyW');
  expect(await isPhysical(page), 'the pool must not have swallowed the walk').toBe(true);
  await saveShot(page, 'third-person-looking-down', testInfo);

  // The face. Walking backwards turns the body to face the camera — this is the
  // fix for "because of camera position I cannot see the face" — so both
  // characters are photographed head-on and from behind at the same distance.
  for (const [name, query] of [
    ['face-boy', ''],
    ['face-girl', '?girl=1'],
  ]) {
    await gotoGame(page, `${query}${query ? '&' : '?'}camdist=3.4&debug=0`);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(1600);
    await saveShot(page, `${name}-walking-at-camera`, testInfo);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(400);
    await saveShot(page, `${name}-idle`, testInfo);
    // And walking away, which is the view the game normally gives: the girl's
    // long hair is behind her, so this is the shot that shows it.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1400);
    await saveShot(page, `${name}-walking-away`, testInfo);
    await page.keyboard.up('KeyW');
  }

  await gotoGame(page, '?view=first');
  await saveShot(page, 'first-person', testInfo);

  await gotoGame(page, '?debug=1');
  await saveShot(page, 'overlay', testInfo);

  await gotoGame(page, '?dev=1');
  await page.locator('.dock__button[aria-label*="Tuning"]').click();
  await page.waitForTimeout(250);
  await saveShot(page, 'tuning-panel', testInfo);

  await gotoGame(page, '?dev=1');
  await page.locator('.dock__button[aria-label*="Credits"]').click();
  await page.waitForTimeout(250);
  await saveShot(page, 'credits', testInfo);

  watch.assertClean();
});
