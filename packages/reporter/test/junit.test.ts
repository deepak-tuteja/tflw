// M2.5: junit.xml is a pure function of a RunReport (SPEC §13, P#23) — a synthetic report is
// enough to pin the exact shape without needing a live run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport, WorkloadTestResult } from '@tflw/runtime';
import { renderJunitXml } from '../src/junit.js';

const report: RunReport = {
  ok: false,
  env: 'local',
  startedAt: '2026-07-05T00:00:00.000Z',
  durationMs: 1234,
  total: 3,
  passed: 2,
  failed: 1,
  seed: 42,
  now: '2026-07-05T00:00:00.000Z',
  insecure: false,
  tests: [
    { kind: 'functional', name: 'health check', ok: true, durationMs: 12, steps: [] },
    { kind: 'functional', name: 'eventually works', ok: true, durationMs: 45, steps: [], flaky: true },
    { kind: 'functional', name: 'broken <thing> & "stuff"', ok: false, durationMs: 8, steps: [], error: 'expected status to equal 200, but got 500' },
  ],
};

test('renderJunitXml produces a standard testsuite with properties, a plain pass, a flaky pass, and a failure', () => {
  const xml = renderJunitXml(report);

  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="tflw" tests="3" failures="1" errors="0" time="1.234" timestamp="2026-07-05T00:00:00.000Z">
  <properties>
    <property name="env" value="local"/>
    <property name="seed" value="42"/>
    <property name="now" value="2026-07-05T00:00:00.000Z"/>
  </properties>
  <testcase name="health check" time="0.012"/>
  <testcase name="eventually works" time="0.045">
    <system-out>flaky: passed after a retry</system-out>
  </testcase>
  <testcase name="broken &lt;thing&gt; &amp; &quot;stuff&quot;" time="0.008">
    <failure message="expected status to equal 200, but got 500">expected status to equal 200, but got 500</failure>
  </testcase>
</testsuite>
`,
  );
});

test('renderJunitXml strips XML-invalid C0 control characters from a test name/error, keeping tab/LF/CR intact (decision 73)', () => {
  // e.g. a garbled/binary response body echoed into an error message could carry a raw \x01 or
  // \x1F — XML 1.0 forbids these outright (unlike & < > ", which entity-escaping already handles),
  // so leaving them in would hand some CI JUnit parsers a document that isn't well-formed XML.
  const dirtyReport: RunReport = {
    ...report,
    tests: [{ kind: 'functional', name: 'name with a \x01 control char', ok: false, durationMs: 3, steps: [], error: 'bad byte: \x1F end' }],
  };
  const xml = renderJunitXml(dirtyReport);

  assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/, 'no XML-invalid control character may survive into the document');
  assert.match(xml, /name with a � control char/);
  assert.match(xml, /bad byte: � end/);

  const tabNewlineReport: RunReport = {
    ...report,
    tests: [{ kind: 'functional', name: 'has\ttab and\nnewline', ok: true, durationMs: 1, steps: [] }],
  };
  assert.match(renderJunitXml(tabNewlineReport), /has\ttab and\nnewline/, 'tab/LF/CR are XML-legal and must survive untouched');
});

test('renderJunitXml on an all-passing report has zero failures and no <failure>/<system-out> elements', () => {
  const cleanReport: RunReport = { ...report, ok: true, failed: 0, tests: [{ kind: 'functional', name: 'ok', ok: true, durationMs: 1, steps: [] }] };
  const xml = renderJunitXml(cleanReport);
  assert.match(xml, /failures="0"/);
  assert.doesNotMatch(xml, /<failure/);
  assert.doesNotMatch(xml, /<system-out>/);
});

// PLAN decision 86: once `attempts` data is available, the flaky <system-out> line names the
// attempt count instead of the old generic string — but a report built before this change (or any
// hand-built one without `attempts`) must still produce the old fixed text, unchanged.
test('renderJunitXml includes the attempt count in <system-out> when `attempts` is present, and falls back to the old fixed string when it isn\'t', () => {
  const withAttempts: RunReport = {
    ...report,
    tests: [
      {
        kind: 'functional',
        name: 'eventually works',
        ok: true,
        durationMs: 45,
        steps: [],
        flaky: true,
        attempts: [
          { attempt: 1, ok: false, durationMs: 10, steps: [], error: 'got 500' },
          { attempt: 2, ok: false, durationMs: 10, steps: [], error: 'got 500' },
          { attempt: 3, ok: true, durationMs: 10, steps: [] },
        ],
      },
    ],
  };
  assert.match(
    renderJunitXml(withAttempts),
    /<system-out>flaky: passed on attempt 3 of 3 \(2 prior attempts failed\)<\/system-out>/,
  );

  // Existing shape (no `attempts` field at all) must be completely unaffected.
  const withoutAttempts: RunReport = { ...report, tests: [{ kind: 'functional', name: 'eventually works', ok: true, durationMs: 45, steps: [], flaky: true }] };
  assert.match(renderJunitXml(withoutAttempts), /<system-out>flaky: passed after a retry<\/system-out>/);
});

// -- M56 (Phase 3, D119): a WorkloadTestResult entry, folded in from the old load-junit.ts --------

const emptyMetrics = { iterations: 0, failures: 0, errorRate: 0, durations: { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 }, histogram: [], timeline: [] };

const workloadTest: WorkloadTestResult = {
  kind: 'workload',
  name: 'checkout',
  workload: { kind: 'users', target: 10, overMs: 1000 },
  metrics: emptyMetrics,
  thresholds: [
    { label: 'p95 duration', op: 'lessThan', target: 800, actual: 950, ok: false },
    { label: 'error rate', op: 'lessThan', target: 0.01, actual: 0, ok: true },
  ],
  ok: false,
  endpoints: [],
};

test('a workload entry contributes one <testcase> per declared threshold, pass/fail from threshold.ok', () => {
  const xml = renderJunitXml({ ...report, tests: [workloadTest] });
  assert.match(xml, /<testcase name="checkout — p95 duration &lt; 800" time="0\.000">\s*<failure message="threshold breached: actual 950 was not less than 800">/);
  assert.match(xml, /<testcase name="checkout — error rate &lt; 0\.01" time="0\.000"\/>/);
});

// D119: an intentional behavior change from the old load-junit.ts, which contributed zero
// <testcase>s for a threshold-less scenario (invisible in CI output) — a workload test with no
// `threshold` now still gets one bare <testcase>, so it shows up in the suite at all.
test('a workload entry with zero thresholds contributes one bare, always-passing <testcase>', () => {
  const noThresholds: WorkloadTestResult = { ...workloadTest, thresholds: [], ok: true };
  const xml = renderJunitXml({ ...report, tests: [noThresholds] });
  assert.match(xml, /tests="1" failures="0"/);
  assert.match(xml, /<testcase name="checkout" time="0\.000"\/>/);
});

test('report.inconclusive marks every workload threshold <testcase> skipped, not passed or failed', () => {
  const xml = renderJunitXml({ ...report, tests: [workloadTest], inconclusive: true });
  assert.match(xml, /skipped="2"/);
  assert.match(xml, /failures="0"/);
  assert.doesNotMatch(xml, /<failure/);
  const skipped = [...xml.matchAll(/<skipped message="([^"]+)"/g)];
  assert.equal(skipped.length, 2);
  assert.match(skipped[0]![1]!, /saturated/);
});

test('report.aborted records the abortedMessage as a property', () => {
  const xml = renderJunitXml({ ...report, tests: [workloadTest], aborted: true, abortedMessage: 'aborted at 12s of 30s planned' });
  assert.match(xml, /<property name="aborted" value="aborted at 12s of 30s planned"\/>/);
});

test('a file mixing functional and workload entries contributes testcases for both, in order', () => {
  const xml = renderJunitXml({
    ...report,
    tests: [
      { kind: 'functional', name: 'health check', ok: true, durationMs: 12, steps: [] },
      { ...workloadTest, thresholds: [{ label: 'error rate', op: 'lessThan', target: 0.01, actual: 0, ok: true }], ok: true },
    ],
  });
  const names = [...xml.matchAll(/<testcase name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['health check', 'checkout — error rate &lt; 0.01']);
});
