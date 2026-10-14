import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot } from './helpers.js';

/**
 * Phone is a first-class target from M1 on (§10); M0 already has to load and
 * lay out correctly there. Real-hardware touch feel still needs the owner.
 */

test('fits a phone viewport without scrolling or overflow', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'phone project only');
  const watch = attachWatch(page);
  await gotoGame(page);

  const layout = await page.evaluate(() => {
    const canvas = document.getElementById('game');
    const rect = canvas.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      canvasWidth: rect.width,
      canvasHeight: rect.height,
      scrollWidth: document.scrollingElement.scrollWidth,
      scrollHeight: document.scrollingElement.scrollHeight,
      dpr: window.devicePixelRatio,
    };
  });

  expect(layout.canvasWidth).toBeCloseTo(layout.innerWidth, 0);
  expect(layout.canvasHeight).toBeCloseTo(layout.innerHeight, 0);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight);

  const debug = await readDebug(page);
  expect(debug.drawCalls).toBeGreaterThan(0);
  expect(debug.ui.overlay).toBe(false);

  await saveShot(page, 'phone-home', testInfo);
  watch.assertClean();
});

test('the dev dock gives a phone the same harness the keyboard has', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'phone project only');
  const watch = attachWatch(page);
  await gotoGame(page, '?dev=1');

  const credits = page.locator('.dock__button[aria-label*="Credits"]');
  const box = await credits.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  await page.locator('.dock__button[aria-label*="overlay"]').tap();
  await page.waitForTimeout(300);
  expect((await readDebug(page)).ui.overlay).toBe(true);
  await saveShot(page, 'phone-overlay', testInfo);

  await page.locator('.dock__button[aria-label*="Tuning"]').tap();
  await page.waitForTimeout(300);
  expect(await page.locator('.tuning-panel').isVisible()).toBe(true);
  await saveShot(page, 'phone-tuning-panel', testInfo);

  watch.assertClean();
});
