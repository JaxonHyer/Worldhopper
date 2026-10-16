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
  /**
   * A ceiling on the *whole* run, and the reason it exists: a run that wedges
   * used to be killed by the job's own 25-minute timeout, which skips every
   * `if: always()` step after it — so the report, the screenshots and the
   * per-test timings were all lost and a red build arrived with no explanation.
   * Timing out here instead ends the run cleanly, publishes the evidence, and
   * leaves the failure readable.
   */
  //   Playwright stops itself at 11 min -> a *complete* report is written
  //   -> the CI step's own 14-min guard catches anything Playwright cannot
  //   -> the job's 25-min cap is never reached, so the upload steps always run.
  globalTimeout: 660_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /**
   * Stop the run after a handful of failures.
   *
   * When everything fails for one reason — the game not starting, a broken
   * selector — repeating the same 30-second timeout eighty times tells you
   * nothing the first six did not, and it is what turns a one-line bug into a
   * run that has to be killed at the job's timeout. Six is enough to see a
   * pattern and small enough to be cheap. Locally, run everything.
   */
  maxFailures: process.env.CI ? 6 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'artifacts/playwright-report' }],
    // Machine-readable copy: scripts/ci-report.mjs turns it into the markdown
    // summary CI publishes (the agent's only readable window into a red build).
    ['json', { outputFile: 'artifacts/playwright-report/report.json' }],
  ],
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
