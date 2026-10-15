import { test } from '@playwright/test';
import { attachWatch, gotoGame, openStick, readDebug, saveShot } from './helpers.js';

/**
 * Deliverable screenshots for the owner's taste calls (§10): the third-person
 * pose (the change they asked for), first person for comparison, 3 palette
 * variants, plus overlay / panel / credits. These are the images the owner
 * compares against the live build.
 */

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

    watch.assertClean();
    return;
  }

  for (const variant of ['ashen-basin', 'mist-sea', 'cold-ridge']) {
    await gotoGame(page, `?palette=${variant}`);
    const debug = await readDebug(page);
    if (debug.palette !== variant) throw new Error(`palette ${variant} did not load (got ${debug.palette})`);
    await saveShot(page, `world-${variant}`, testInfo);
  }

  await gotoGame(page);
  await saveShot(page, 'world-default', testInfo);

  // Walking: hold W and photograph the world from where the player got to.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2200);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  await saveShot(page, 'world-walked', testInfo);

  // The third-person pose, from a few distances so the boom length is judgeable
  // in one image set rather than by dragging the slider back and forth.
  for (const distance of [3, 4.2, 6.5]) {
    await gotoGame(page, `?camdist=${distance}&debug=0`);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1400);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(220); // catch them mid-stride, still walking
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
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await saveShot(page, 'third-person-looking-down', testInfo);

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
