// M32 (PLAN_REPORTS_PERF_SECURITY.md R2/R3/R6) — renderLoadReportHtml is a pure function of a
// LoadReport, mirroring html.test.ts's approach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoadReport } from '@tflw/runtime';
import { renderLoadReportHtml } from '../src/load-html.js';

const metricsWithData = {
  iterations: 10,
  failures: 1,
  errorRate: 0.1,
  durations: { min: 5, max: 500, avg: 80, p50: 50, p90: 200, p95: 300, p99: 480 },
  histogram: [
    { value: 5, count: 3 },
    { value: 50, count: 5 },
    { value: 500, count: 2 },
  ],
  timeline: [
    { offsetSeconds: 0, count: 5, failures: 1, rps: 5, errorRate: 0.2, min: 5, mean: 50, max: 100, p50: 40, p95: 90, p99: 100 },
    { offsetSeconds: 1, count: 5, failures: 0, rps: 5, errorRate: 0, min: 10, mean: 60, max: 500, p50: 55, p95: 300, p99: 480 },
  ],
};

const emptyMetrics = { iterations: 0, failures: 0, errorRate: 0, durations: { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 }, histogram: [], timeline: [] };

const healthyDiagnosis = { avgEventLoopLagMs: 1, maxEventLoopLagMs: 2, cpuPercent: 5, saturated: false };

const baseReport: LoadReport = {
  ok: true,
  scenarios: [
    {
      name: 'checkout',
      workload: { kind: 'users', target: 10, overMs: 1000 },
      metrics: metricsWithData,
      thresholds: [{ label: 'p95 duration', op: 'lessThan', target: 800, actual: 300, ok: true }],
      ok: true,
    },
  ],
  combined: metricsWithData,
  startedAt: '2026-07-31T00:00:00.000Z',
  durationMs: 5000,
  seed: 42,
  now: '2026-07-31T00:00:00.000Z',
  selfDiagnosis: healthyDiagnosis,
  inconclusive: false,
};

test('renders a self-contained document (no external requests) with the PASS badge and both a combined and a per-scenario section', () => {
  const html = renderLoadReportHtml(baseReport);
  assert.doesNotMatch(html, /<link[^>]+href="http/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.match(html, /<span class="badge ok">PASS<\/span>/);
  assert.match(html, /<h2>Combined<\/h2>/);
  assert.match(html, /<h2>Scenario &quot;checkout&quot;<\/h2>/);
  assert.match(html, /ramp to 10 users over 1000ms/);
});

test('an inconclusive report shows INCONCLUSIVE, not PASS/FAIL, plus the saturation banner', () => {
  const html = renderLoadReportHtml({ ...baseReport, ok: true, inconclusive: true, selfDiagnosis: { ...healthyDiagnosis, saturated: true } });
  assert.match(html, /<span class="badge inconclusive">INCONCLUSIVE<\/span>/);
  assert.match(html, /inconclusive-banner/);
  assert.doesNotMatch(html, />PASS</);
});

test('a failing report shows FAIL and the threshold row is marked fail', () => {
  const failing: LoadReport = {
    ...baseReport,
    ok: false,
    scenarios: [{ ...baseReport.scenarios[0]!, ok: false, thresholds: [{ label: 'p95 duration', op: 'lessThan', target: 800, actual: 900, ok: false }] }],
  };
  const html = renderLoadReportHtml(failing);
  assert.match(html, /<span class="badge fail">FAIL<\/span>/);
  assert.match(html, /<tr class="fail"><td>✗<\/td>/);
});

test('an aborted report shows the abortedMessage banner', () => {
  const aborted: LoadReport = { ...baseReport, aborted: true, abortedMessage: 'aborted at 12s of 30s planned' };
  const html = renderLoadReportHtml(aborted);
  assert.match(html, /aborted-banner/);
  assert.match(html, /aborted at 12s of 30s planned/);
});

test('a report with zero iterations renders "no iterations recorded" chart placeholders instead of crashing on empty data', () => {
  const empty: LoadReport = { ...baseReport, combined: emptyMetrics, scenarios: [{ ...baseReport.scenarios[0]!, metrics: emptyMetrics, thresholds: [] }] };
  const html = renderLoadReportHtml(empty);
  assert.match(html, /no iterations recorded/);
});

test('the generator section reflects a saturated selfDiagnosis with a visible warning', () => {
  const saturated: LoadReport = { ...baseReport, selfDiagnosis: { ...healthyDiagnosis, saturated: true }, inconclusive: true };
  const html = renderLoadReportHtml(saturated);
  assert.match(html, /<section class="generator saturated">/);
  assert.match(html, /tflw itself was the bottleneck/);
});

// M34 (D17): the back-off/coordinated-omission warning — only rendered when `backOff.warning` is
// true, never for an open-model scenario (no `backOff` field at all) or a healthy closed one.

test('a scenario with backOff.warning shows the coordinated-omission banner with its ratio', () => {
  const backedOff: LoadReport = { ...baseReport, scenarios: [{ ...baseReport.scenarios[0]!, backOff: { ratio: 0.41, warning: true } }] };
  const html = renderLoadReportHtml(backedOff);
  assert.match(html, /class="backoff-warning"/);
  assert.match(html, /41%/);
  assert.match(html, /coordinated omission, D17/);
});

test('a scenario with backOff present but warning:false renders no banner', () => {
  const healthy: LoadReport = { ...baseReport, scenarios: [{ ...baseReport.scenarios[0]!, backOff: { ratio: 0.03, warning: false } }] };
  const html = renderLoadReportHtml(healthy);
  assert.doesNotMatch(html, /class="backoff-warning"/);
});

test('a scenario with no backOff field (open-model, or never computed) renders no banner', () => {
  const html = renderLoadReportHtml(baseReport);
  assert.doesNotMatch(html, /class="backoff-warning"/);
});

test('scenario/threshold text is escaped', () => {
  const weird: LoadReport = { ...baseReport, scenarios: [{ ...baseReport.scenarios[0]!, name: 'checkout <fast>' }] };
  const html = renderLoadReportHtml(weird);
  assert.match(html, /Scenario &quot;checkout &lt;fast&gt;&quot;/);
  assert.doesNotMatch(html, /Scenario "checkout <fast>"/);
});
