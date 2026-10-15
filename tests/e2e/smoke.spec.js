import { test, expect } from '@playwright/test';
import { attachWatch, gotoGame, readDebug, saveShot, waitForReady } from './helpers.js';

/**
 * The M0 gate: the built game loads, renders, reports state through
 * window.__debug(), never touches the network outside its own origin and
 * produces zero console errors.
 */

test('loads, renders, and reports state through the debug hook', async ({ page }, testInfo) => {
  const watch = attachWatch(page);
  await gotoGame(page);

  const debug = await readDebug(page);
  expect(debug.ready).toBe(true);
  expect(debug.realm).toBe('physical');
  expect(debug.mapId).toBe('blank-basin');
  expect(debug.seed).toBe(20261014);
  expect(debug.entityCount).toBeGreaterThan(0);
  expect(debug.drawCalls).toBeGreaterThan(0);
  expect(debug.triangles).toBeGreaterThan(0);
  expect(debug.distanceFromOrigin).toBeLessThan(10);
  expect(debug.scaleFence.warn).toBe(false);
  expect(debug.ui.overlay).toBe(false);

  const box = await page.locator('#game').boundingBox();
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeGreaterThan(200);

  // `hidden` has to mean hidden: an overlay that stays on screen (and swallows
  // every pointer event) is invisible to state assertions alone.
  for (const selector of ['.credits', '.tuning-panel', '.debug-overlay', '.dock__dev']) {
    expect(await page.locator(selector).isVisible(), `${selector} must be hidden on load`).toBe(false);
  }

  // The sim loop is alive: tick advances while wall-clock time passes.
  const before = await readDebug(page);
  await page.waitForTimeout(400);
  const after = await readDebug(page);
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(after.fps).toBeGreaterThan(0);

  const first = await saveShot(page, 'home', testInfo);
  expect(first).toBeTruthy();

  watch.assertSameOrigin();
  watch.assertClean();
  watch.report();
});

test('is reproducible from ?seed= and different seeds build different worlds', async ({ page }) => {
  const watch = attachWatch(page);

  await gotoGame(page, '?seed=4242');
  const first = await readDebug(page);
  expect(first.seed).toBe(4242);

  await gotoGame(page, '?seed=4242');
  const second = await readDebug(page);
  expect(second.seed).toBe(4242);
  expect(second.entityHash).toBe(first.entityHash);
  expect(second.entityCount).toBe(first.entityCount);

  await gotoGame(page, '?seed=4243');
  const other = await readDebug(page);
  expect(other.seed).toBe(4243);
  expect(other.entityHash).not.toBe(first.entityHash);

  watch.assertClean();
});

test('a word seed works too', async ({ page }) => {
  const watch = attachWatch(page);
  await gotoGame(page, '?seed=emberdark');
  const first = await readDebug(page);
  expect(Number.isInteger(first.seed)).toBe(true);
  expect(first.seed).toBeGreaterThan(0);
  await gotoGame(page, '?seed=emberdark');
  const second = await readDebug(page);
  expect(second.seed).toBe(first.seed);
  expect(second.entityHash).toBe(first.entityHash);
  watch.assertClean();
});

test('nothing is fetched from outside the origin', async ({ page }) => {
  const watch = attachWatch(page);
  await gotoGame(page);
  await page.waitForTimeout(300);
  expect(watch.requests.length).toBeGreaterThan(0);
  watch.assertSameOrigin();
  watch.assertClean();
});

test('WebGL is genuinely running (probe, not a benchmark)', async ({ page }) => {
  const watch = attachWatch(page);
  await gotoGame(page);
  const probe = await page.evaluate(() => {
    const canvas = document.getElementById('game');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { ok: false };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ok: true,
      version: gl.getParameter(gl.VERSION),
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    };
  });
  expect(probe.ok).toBe(true);
  expect(String(probe.version)).toContain('WebGL');
  // Logged for diagnostics only — sandbox/CI frame rates are meaningless (§8).
  console.log(`[probe] ${probe.version} :: ${probe.gpu}`);
  watch.assertClean();
});

test('the debug overlay toggles and reports the scale-fence canary', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'the phone project drives the overlay through the dev dock instead');
  const watch = attachWatch(page);
  await gotoGame(page);

  await page.keyboard.press('Backquote');
  await page.waitForTimeout(300);
  expect(await page.locator('.debug-overlay').isVisible()).toBe(true);
  expect((await readDebug(page)).ui.overlay).toBe(true);
  await expect(page.locator('.debug-overlay')).toContainText('distance from origin');
  await expect(page.locator('.debug-overlay')).toContainText('seed / palette');
  await expect(page.locator('.debug-overlay .is-warn')).toHaveCount(0);
  await saveShot(page, 'overlay', testInfo);

  await page.keyboard.press('Backquote');
  await page.waitForTimeout(200);
  expect(await page.locator('.debug-overlay').isVisible()).toBe(false);
  expect((await readDebug(page)).ui.overlay).toBe(false);

  watch.assertClean();
});

test('the in-game credits carry the unofficial fan-work notice', async ({ page, isMobile }, testInfo) => {
  const watch = attachWatch(page);
  await gotoGame(page);

  if (isMobile) await page.locator('.dock__button[aria-label*="Credits"]').tap();
  else await page.keyboard.press('c');
  await page.waitForTimeout(200);

  const card = page.locator('.credits__card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Unofficial, non-commercial fan work');
  await expect(card).toContainText('Not affiliated');
  await saveShot(page, isMobile ? 'phone-credits' : 'credits', testInfo);

  await page.locator('.credits__close').click();
  await page.waitForTimeout(150);
  expect((await readDebug(page)).ui.credits).toBe(false);

  watch.assertClean();
  await waitForReady(page);
});
