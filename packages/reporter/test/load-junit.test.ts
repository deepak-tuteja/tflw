// M32 (PLAN_REPORTS_PERF_SECURITY.md R11) — renderLoadJunitXml is a pure function of a LoadReport,
// mirroring junit.test.ts's approach: a synthetic report pins the exact shape without a live run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoadReport } from '@tflw/runtime';
import { renderLoadJunitXml } from '../src/load-junit.js';

const emptyMetrics = { iterations: 0, failures: 0, errorRate: 0, durations: { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 }, histogram: [], timeline: [] };

const healthyDiagnosis = { avgEventLoopLagMs: 1, maxEventLoopLagMs: 2, cpuPercent: 5, saturated: false };

const baseReport: LoadReport = {
  ok: false,
  scenarios: [
    {
      name: 'checkout',
      workload: { kind: 'users', target: 10, overMs: 1000 },
      metrics: emptyMetrics,
      thresholds: [
        { label: 'p95 duration', op: 'lessThan', target: 800, actual: 950, ok: false },
        { label: 'error rate', op: 'lessThan', target: 0.01, actual: 0, ok: true },
      ],
      ok: false,
    },
  ],
  combined: emptyMetrics,
  startedAt: '2026-07-31T00:00:00.000Z',
  durationMs: 5000,
  seed: 42,
  now: '2026-07-31T00:00:00.000Z',
  selfDiagnosis: healthyDiagnosis,
  inconclusive: false,
};

test('renderLoadJunitXml: one <testcase> per scenario x threshold, pass/fail from threshold.ok', () => {
  const xml = renderLoadJunitXml(baseReport);
  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="tflw load" tests="2" failures="1" errors="0" skipped="0" time="5.000" timestamp="2026-07-31T00:00:00.000Z">
  <properties>
    <property name="seed" value="42"/>
    <property name="now" value="2026-07-31T00:00:00.000Z"/>
  </properties>
  <testcase name="checkout — p95 duration &lt; 800" time="0.000">
    <failure message="threshold breached: actual 950 was not less than 800">threshold breached: actual 950 was not less than 800</failure>
  </testcase>
  <testcase name="checkout — error rate &lt; 0.01" time="0.000"/>
</testsuite>
`,
  );
});

test('renderLoadJunitXml: an inconclusive report marks every threshold skipped, not passed or failed', () => {
  const xml = renderLoadJunitXml({ ...baseReport, inconclusive: true });
  assert.match(xml, /skipped="2"/);
  assert.match(xml, /failures="0"/);
  assert.doesNotMatch(xml, /<failure/);
  const skipped = [...xml.matchAll(/<skipped message="([^"]+)"/g)];
  assert.equal(skipped.length, 2, 'both testcases (including the one whose threshold actually failed) must be skipped');
  assert.match(skipped[0]![1]!, /saturated/);
});

test('renderLoadJunitXml: a scenario with no thresholds contributes zero testcases', () => {
  const noThresholds: LoadReport = { ...baseReport, scenarios: [{ ...baseReport.scenarios[0]!, thresholds: [], ok: true }] };
  const xml = renderLoadJunitXml(noThresholds);
  assert.match(xml, /tests="0" failures="0"/);
  assert.doesNotMatch(xml, /<testcase/);
});

test('renderLoadJunitXml: an aborted run records the abortedMessage as a property', () => {
  const aborted: LoadReport = { ...baseReport, aborted: true, abortedMessage: 'aborted at 12s of 30s planned' };
  const xml = renderLoadJunitXml(aborted);
  assert.match(xml, /<property name="aborted" value="aborted at 12s of 30s planned"\/>/);
});

test('renderLoadJunitXml escapes XML-special characters in a scenario name', () => {
  const weird: LoadReport = {
    ...baseReport,
    scenarios: [{ ...baseReport.scenarios[0]!, name: 'checkout <fast> & "cheap"', thresholds: [{ label: 'error rate', op: 'lessThan', target: 0.01, actual: 0, ok: true }] }],
  };
  const xml = renderLoadJunitXml(weird);
  assert.match(xml, /checkout &lt;fast&gt; &amp; &quot;cheap&quot;/);
  assert.doesNotMatch(xml, /checkout <fast>/);
});
