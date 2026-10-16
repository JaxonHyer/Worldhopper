/**
 * Correctness linting — not style, and deliberately short.
 *
 * Why this exists (2026-10-16): two failures in a row reached CI and cost whole
 * runs, and both were the kind of thing a parser names in milliseconds.
 *
 *   - `createFade` read `fadeMs` three lines above the `let` that defines it.
 *     A temporal dead zone reference throws while the game is booting, so the
 *     page never set its `ready` flag and all eighty headless tests timed out
 *     waiting for a game that had already died.
 *   - The frame loop called `gateStatus(...)` and `gateStep(...)` without ever
 *     importing them. An undefined reference throws on the first frame, so the
 *     loop never rescheduled and, again, `ready` never arrived.
 *
 * Neither is a style opinion; both are a name that does not exist. The headless
 * suite cannot see them quickly, because its only oracle is a browser and the
 * symptom of a dead game is a *timeout*, not an error. This file is that error
 * message, cheaply, before the browser is ever launched.
 *
 * Rules are limited to "this cannot be right": undefined names, dead code,
 * duplicated keys, unreachable statements. Nothing here is about formatting,
 * and nothing here should ever be silenced for tidiness.
 */

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  history: 'readonly',
  navigator: 'readonly',
  screen: 'readonly',
  localStorage: 'readonly',
  performance: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  devicePixelRatio: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  Image: 'readonly',
  fetch: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  PointerEvent: 'readonly',
  KeyboardEvent: 'readonly',
  TouchEvent: 'readonly',
  ResizeObserver: 'readonly',
  WebGL2RenderingContext: 'readonly',
  OffscreenCanvas: 'readonly',
};

const correctness = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-cond-assign': 'error',
  'no-obj-calls': 'error',
  'no-setter-return': 'error',
  'no-unsafe-negation': 'error',
  'no-loss-of-precision': 'error',
  'no-sparse-arrays': 'error',
  'no-template-curly-in-string': 'error',
  'valid-typeof': 'error',
  'use-isnan': 'error',
};

export default [
  {
    ignores: ['dist/**', 'artifacts/**', 'node_modules/**', 'coverage/**', 'test-results/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2025, sourceType: 'module' },
    rules: correctness,
  },
  {
    // The game runs in a browser; the harness and the build scripts do not.
    files: ['src/**/*.js'],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', '*.js', '*.mjs', 'vite.config.js', 'playwright.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        __dirname: 'readonly',
        ...browserGlobals,
      },
    },
  },
];
