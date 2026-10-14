import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const HOST = '127.0.0.1';

/**
 * The headless harness from AGENT_PROMPT.md §8: loads the *built* game, asserts
 * zero console errors, scripts input, grabs before/after screenshots and reads
 * game state through window.__debug().
 *
 * Screenshots land in artifacts/screenshots/<project>/ and are uploaded by CI.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'artifacts/test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }]],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
      // Software WebGL must be explicitly allowed on GPU-less CI runners.
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
    {
      name: 'phone-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host ${HOST}`,
    url: `http://${HOST}:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
