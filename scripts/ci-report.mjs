#!/usr/bin/env node
/**
 * Turns the Playwright JSON report into a short markdown summary that CI can
 * publish (step summary, job log, and the rolling `ci-artifacts` branch).
 *
 * Why this exists: the sandboxed agent that writes the code cannot read GitHub
 * Actions logs or download artifacts. This file is the channel it *can* read
 * (via the repository), so a red build comes with its error text and its
 * screenshots instead of "something failed".
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_REPORT = path.join('artifacts', 'playwright-report', 'report.json');

export function readReport(file = DEFAULT_REPORT) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function flatten(report) {
  const results = [];
  const visit = (suite, trail) => {
    const name = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) results.push({ spec, trail: name });
    for (const child of suite.suites ?? []) visit(child, name);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  return results;
}

function firstLine(text, max = 400) {
  const line = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // Playwright's ANSI colour codes would show up literally in markdown.
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, ''))
    .find(() => true);
  return line ? (line.length > max ? `${line.slice(0, max)}…` : line) : '';
}

export function summarizeReport(report, { runUrl, ref, sha, title = 'Headless test report' } = {}) {
  const lines = [`## ${title}`, ''];
  if (!report) {
    lines.push('No Playwright JSON report was produced — the run died before the tests reported. Check the step log.', '');
    return lines.join('\n');
  }

  const entries = flatten(report);
  const stats = report.stats ?? {};
  const total = stats.expected ?? 0;
  const unexpected = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  const duration = typeof stats.duration === 'number' ? `${(stats.duration / 1000).toFixed(1)}s` : 'n/a';

  lines.push(`**${total + unexpected + flaky + skipped} tests** · ${unexpected === 0 ? '✅ all green' : `❌ ${unexpected} failed`} · ${flaky} flaky · ${skipped} skipped · ${duration}`);
  if (runUrl) lines.push('', `run: ${runUrl}${ref ? ` · \`${ref}\`` : ''}${sha ? ` · \`${sha.slice(0, 8)}\`` : ''}`);
  lines.push('');

  const failures = [];
  const probeLines = [];
  const timings = [];

  for (const { spec, trail } of entries) {
    const isOk = spec.ok !== false;
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        if (result.status !== 'skipped' && typeof result.duration === 'number') {
          timings.push({
            name: [...trail, spec.title].filter(Boolean).join(' › '),
            project: test.projectName ?? test.projectId ?? '',
            duration: result.duration,
          });
        }
        for (const chunk of result.stdout ?? []) {
          const text = typeof chunk === 'string' ? chunk : chunk?.text;
          if (text && /\[probe\]/.test(text)) probeLines.push(text.trim());
        }
        if (result.status !== 'failed' && result.status !== 'timedOut') continue;
        failures.push({
          name: [...trail, spec.title].filter(Boolean).join(' › '),
          project: test.projectName ?? test.projectId ?? '',
          status: result.status,
          error: firstLine(result.error?.message ?? result.errors?.[0]?.message ?? ''),
          detail: String(result.error?.stack ?? result.error?.message ?? '').slice(0, 2000),
        });
      }
    }
    if (!isOk && failures.length === 0) {
      failures.push({ name: [...trail, spec.title].filter(Boolean).join(' › '), project: '', status: 'failed', error: 'failed without details', detail: '' });
    }
  }

  if (failures.length > 0) {
    lines.push('### Failures', '');
    for (const failure of failures) {
      lines.push(`- **${failure.name}**${failure.project ? ` _(${failure.project})_` : ''} — ${failure.status}`);
      if (failure.error) lines.push(`  - ${failure.error}`);
      if (failure.detail) {
        lines.push('', '```', failure.detail.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 1800), '```', '');
      }
    }
  }

  // Which tests actually ate the clock. A run that overruns its step budget is
  // otherwise invisible from the outside — the job simply stops — so the timings
  // are published with every run, green or red.
  if (timings.length > 1) {
    const slowest = [...timings].sort((a, b) => b.duration - a.duration).slice(0, 8);
    lines.push('### Slowest tests', '');
    for (const timing of slowest) {
      lines.push(`- ${(timing.duration / 1000).toFixed(1)}s — ${timing.name}${timing.project ? ` _(${timing.project})_` : ''}`);
    }
    lines.push('');
  }

  if (probeLines.length > 0) {
    lines.push('### Renderer probe (diagnostic only, never evidence of performance)', '');
    for (const line of new Set(probeLines)) lines.push(`- \`${line}\``);
    lines.push('');
  }

  return lines.join('\n');
}

function main() {
  const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
  const file = inputArg ? inputArg.split('=')[1] : DEFAULT_REPORT;
  const markdown = summarizeReport(readReport(file), {
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
    ref: process.env.GITHUB_REF_NAME,
    sha: process.env.GITHUB_SHA,
  });
  process.stdout.write(`${markdown}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
