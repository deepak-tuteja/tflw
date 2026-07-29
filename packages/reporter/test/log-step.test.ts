// `log` step rendering in report.html (M27, PLAN_LOG.md decisions 117/119/122): a `log` step is
// filtered by destination (must include `html`) and by level (must clear the resolved threshold)
// rather than rendered like an ordinary pass/fail step — a filtered-out step is still present in
// `RunReport.tests[].steps` (decision 119's "always recorded"), it just contributes no `<li>`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport, StepResult } from '@tflw/runtime';
import { renderReportHtml } from '../src/html.js';

function reportWithStep(step: StepResult): RunReport {
  return {
    ok: true,
    env: 'local',
    startedAt: '2026-07-29T00:00:00.000Z',
    durationMs: 10,
    total: 1,
    passed: 1,
    failed: 0,
    seed: 1,
    now: '2026-07-29T00:00:00.000Z',
    insecure: false,
    tests: [{ name: 'a test', ok: true, durationMs: 5, steps: [step] }],
  };
}

function logStep(overrides: Partial<StepResult>): StepResult {
  return { kind: 'log', source: 'log "hi"', line: 2, ok: true, durationMs: 0, detail: 'hi', level: 'info', destination: 'both', ...overrides };
}

test('a `both`-destination log step renders with its level badge', () => {
  const html = renderReportHtml(reportWithStep(logStep({ destination: 'both', level: 'warn', detail: 'stock low' })));
  assert.match(html, /<li class="step ok kind-log level-warn">/);
  assert.match(html, /<span class="log-badge log-warn">WARN<\/span>/);
  assert.match(html, /<div class="detail">stock low<\/div>/);
});

test('an `html`-destination log step renders', () => {
  const html = renderReportHtml(reportWithStep(logStep({ destination: 'html' })));
  assert.match(html, /class="step ok kind-log level-info"/);
});

// Note: the embedded <style> block always defines `.kind-log`/`.log-warn`-shaped selectors
// regardless of whether any step used them (same pitfall the file header comment on the sibling
// retry-attempt test above already flags for `.attempt`) — assert on the actual `<li>` markup, not
// a bare substring, so a filtered-out step can't accidentally match the stylesheet instead.
const LOG_LI_RE = /<li class="step ok kind-log/;

test('a `console`-only log step is filtered out of report.html entirely', () => {
  const html = renderReportHtml(reportWithStep(logStep({ destination: 'console' })));
  assert.doesNotMatch(html, LOG_LI_RE);
});

test('a `none`-destination log step is filtered out of report.html entirely', () => {
  const html = renderReportHtml(reportWithStep(logStep({ destination: 'none' })));
  assert.doesNotMatch(html, LOG_LI_RE);
});

test('a log step below the resolved level threshold is filtered out', () => {
  const html = renderReportHtml(reportWithStep(logStep({ level: 'debug', destination: 'both' })), new Map(), 'warn');
  assert.doesNotMatch(html, LOG_LI_RE);
});

test('a log step at or above the resolved level threshold still renders', () => {
  const html = renderReportHtml(reportWithStep(logStep({ level: 'error', destination: 'both' })), new Map(), 'warn');
  assert.match(html, LOG_LI_RE);
  assert.match(html, /log-badge log-error/);
});

test('the default threshold (debug, no third argument) shows every level', () => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const html = renderReportHtml(reportWithStep(logStep({ level })));
    assert.match(html, new RegExp(`log-badge log-${level}`), `level ${level} should render under the default debug threshold`);
  }
});
