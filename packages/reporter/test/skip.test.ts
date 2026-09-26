// `M242` `B` (`D1327`) — a skipped test in every reporter: its own `<skipped>` testcase in JUnit, a
// grey row with its reason in report.html, its own number on the summary line, and no SARIF finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport } from '@tflw/runtime';
import { renderJunitXml } from '../src/junit.js';
import { renderReportHtml } from '../src/html.js';
import { renderCliSummary } from '../src/cli-summary.js';

const report: RunReport = {
  ok: true,
  env: 'local',
  startedAt: '2026-09-26T00:00:00.000Z',
  durationMs: 20,
  total: 2,
  passed: 1,
  failed: 0,
  skipped: 1,
  seed: 1,
  now: '2026-09-26T00:00:00.000Z',
  insecure: false,
  tests: [
    { kind: 'functional', name: 'runs', file: 'tests/a.tflw', ok: true, durationMs: 20, steps: [] },
    { kind: 'functional', name: 'waits for the sandbox', file: 'tests/a.tflw', ok: true, durationMs: 0, steps: [], skipped: 'down until the 3rd' },
  ],
};

test('JUnit: one `<skipped>` testcase carrying the reason, and the suite counts it', () => {
  const xml = renderJunitXml(report);
  assert.match(xml, /<testcase name="waits for the sandbox"[^>]*>\s*<skipped message="down until the 3rd"\/>\s*<\/testcase>/);
  assert.match(xml, /tests="2" failures="0" errors="0" skipped="1"/);
});

test('report.html: a grey row with a `skipped` badge and the reason, never a green dot', () => {
  const html = renderReportHtml(report);
  const at = html.indexOf('<section class="test skip');
  assert.ok(at > 0, 'a section for the skipped test');
  const section = html.slice(at, at + 600);
  assert.match(section, /class="test skip/);
  assert.match(section, /<span class="skipped">skipped<\/span>/);
  assert.match(html, /skipped: down until the 3rd/);
  assert.match(html, /class="testlink skip" data-target="t1">– waits for the sandbox/, 'the sidebar too');
});

test('the summary line counts a skip on its own', () => {
  assert.match(renderCliSummary(report, false), /1\/2 passed, 1 skipped/);
});
