import { test } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot } from './helpers.js';

/**
 * Deliverable screenshots for the owner's taste calls (§10): 3 palette
 * variants of the same pose, plus overlay / panel / credits.
 * These are the images the owner compares against the live build.
 */

test('captures the M0 screenshots', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);

  if (isMobile) {
    await gotoGame(page);
    await saveShot(page, 'phone-home', testInfo);
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
