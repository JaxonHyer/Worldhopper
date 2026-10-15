import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReport } from '../../scripts/ci-report.mjs';

const passing = {
  stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 1, duration: 1234 },
  suites: [
    {
      title: 'smoke.spec.js',
      specs: [
        { title: 'loads', ok: true, tests: [{ projectName: 'desktop-chromium', results: [{ status: 'passed', stdout: [{ text: '[probe] WebGL 2.0 :: SwiftShader Device' }] }] }] },
        { title: 'skips on desktop', ok: true, tests: [{ projectName: 'desktop-chromium', results: [{ status: 'skipped' }] }] },
      ],
    },
  ],
};

const failing = {
  stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0, duration: 4321 },
  suites: [
    {
      title: 'smoke.spec.js',
      suites: [
        {
          title: 'blank world',
          specs: [
            {
              title: 'the debug overlay toggles',
              ok: false,
              tests: [
                {
                  projectName: 'phone-chromium',
                  results: [
                    {
                      status: 'failed',
                      error: { message: '\u001b[31mError: expect(received).toBe(expected)\n\nCannot read properties of undefined (reading \'version\')\u001b[0m' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test('a green report reads as green and lists the probe line', () => {
  const markdown = summarizeReport(passing);
  assert.match(markdown, /all green/);
  assert.match(markdown, /3 tests/);
  assert.match(markdown, /SwiftShader/);
  assert.doesNotMatch(markdown, /### Failures/);
});

test('a failing report names the project, the spec and the error, without ANSI codes', () => {
  const markdown = summarizeReport(failing, { runUrl: 'https://example.invalid/run/1', ref: 'main' });
  assert.match(markdown, /1 failed/);
  assert.match(markdown, /blank world › the debug overlay toggles/);
  assert.match(markdown, /phone-chromium/);
  assert.match(markdown, /reading 'version'/);
  assert.doesNotMatch(markdown, /\u001b\[/);
  assert.match(markdown, /https:\/\/example\.invalid\/run\/1/);
});

test('a missing report says so instead of pretending everything is fine', () => {
  const markdown = summarizeReport(null);
  assert.match(markdown, /No Playwright JSON report/);
  assert.doesNotMatch(markdown, /all green/);
});
