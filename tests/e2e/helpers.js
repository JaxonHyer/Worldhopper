import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

const SHOT_DIR = path.join('artifacts', 'screenshots');

/**
 * Collect console errors, page errors, warnings and requests.
 * Tests assert `errors` is empty: "zero console errors" is a hard gate (§8).
 */
export function attachWatch(page) {
  const errors = [];
  const warnings = [];
  const requests = [];

  page.on('console', (message) => {
    const type = message.type();
    const text = message.text();
    if (type === 'error') errors.push(text);
    else if (type === 'warning') warnings.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    errors.push(`requestfailed: ${request.url()} (${failure?.errorText ?? 'unknown'})`);
  });
  page.on('request', (request) => requests.push(request.url()));

  return {
    errors,
    warnings,
    requests,
    /** Every request must be same-origin: no CDNs, fonts or analytics (§3). */
    assertSameOrigin() {
      const external = requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('http://127.0.0.1:'));
      expect(external, `external requests are forbidden: ${external.join(', ')}`).toEqual([]);
    },
    assertClean() {
      expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
    },
    report() {
      if (warnings.length > 0) console.log(`console warnings (allowed): ${warnings.join(' | ')}`);
    },
  };
}

/** Wait until the game has rendered its first frames. */
export async function waitForReady(page) {
  await page.waitForFunction(() => window.__worldhopper?.ready === true, null, { timeout: 30_000 });
}

/** Read the game-state snapshot exposed by the debug hook. */
export async function readDebug(page) {
  return page.evaluate(() => window.__debug());
}

export async function gotoGame(page, query = '') {
  await page.goto(`/${query}`);
  await waitForReady(page);
  // Let the rolling frame stats have a couple of samples.
  await page.waitForTimeout(150);
}

export async function saveShot(page, name, testInfo) {
  const dir = path.join(SHOT_DIR, testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  return file;
}

/** Mouse drag on the canvas (desktop look path). */
export async function dragLook(page, dx, dy = 0, steps = 12) {
  const box = await page.locator('#game').boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.mouse.up();
}

/**
 * Touch drag through the browser's real touch pipeline (CDP), so the phone
 * input path is exercised, not a synthetic event.
 *
 * `zone` matters on touch: the left of the screen is the movement stick and the
 * right is the look zone, so a look drag must start on the right.
 */
export async function touchDrag(page, dx, dy = 0, steps = 8, { zone = 'look', fromY = 0.5 } = {}) {
  const box = await page.locator('#game').boundingBox();
  const client = await page.context().newCDPSession(page);
  const startX = Math.round(box.x + box.width * (zone === 'look' ? 0.72 : 0.25));
  const startY = Math.round(box.y + box.height * fromY);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(startX + (dx * i) / steps), y: Math.round(startY + (dy * i) / steps), id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/**
 * Press and hold the thumb-stick in the movement zone. Returns a handle so a
 * screenshot can be taken mid-gesture (the stick only exists while touched).
 */
export async function openStick(page, dx, dy = 0, { steps = 6 } = {}) {
  const box = await page.locator('#game').boundingBox();
  const client = await page.context().newCDPSession(page);
  const startX = Math.round(box.x + box.width * 0.25);
  const startY = Math.round(box.y + box.height * 0.72);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(startX + (dx * i) / steps), y: Math.round(startY + (dy * i) / steps), id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  return {
    async release() {
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
    },
  };
}

/** Push the thumb-stick, optionally holding it for a while, then release. */
export async function stickDrag(page, dx, dy = 0, { holdMs = 0, steps = 6 } = {}) {
  const stick = await openStick(page, dx, dy, { steps });
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await stick.release();
}

/** Only true for the phone project (keeps touch tests out of desktop runs). */
export function usesTouch(isMobile) {
  return isMobile;
}

/** Hold a key for a while so continuous (per-second) input is exercised. */
export async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(80);
}

export function screenshotBytes(file) {
  return fs.readFileSync(file);
}
