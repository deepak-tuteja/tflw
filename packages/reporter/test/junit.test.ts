// M2.5: junit.xml is a pure function of a RunReport (SPEC §13, P#23) — a synthetic report is
// enough to pin the exact shape without needing a live run.
//
// M65 (FS-09): every fixture below carries a `file`. Before it, not one did — which is why nothing
// here noticed that `junit.ts` imported the same `RunReport` as `html.ts` and threw the field away.
// A fixture that never exercises a field cannot catch the consumer that ignores it.

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
    { kind: 'functional', name: 'health check', file: 'tests/health.tflw', ok: true, durationMs: 12, steps: [] },
    { kind: 'functional', name: 'eventually works', file: 'tests/health.tflw', ok: true, durationMs: 45, steps: [], flaky: true },
    {
      kind: 'functional',
      name: 'broken <thing> & "stuff"',
      file: 'tests/checkout.tflw',
      ok: false,
      durationMs: 8,
      steps: [],
      error: 'expected status to equal 200, but got 500',
    },
  ],
};

test('renderJunitXml produces a <testsuites> root with one <testsuite> per file, per-file counts, and a classname on every testcase', () => {
  const xml = renderJunitXml(report);

  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="tflw" tests="3" failures="1" errors="0" time="1.234" timestamp="2026-07-05T00:00:00.000Z">
  <testsuite name="tests/health.tflw" tests="2" failures="0" errors="0" time="0.057" timestamp="2026-07-05T00:00:00.000Z">
    <properties>
      <property name="env" value="local"/>
      <property name="seed" value="42"/>
      <property name="now" value="2026-07-05T00:00:00.000Z"/>
    </properties>
    <testcase name="health check" classname="tests/health.tflw" time="0.012"/>
    <testcase name="eventually works" classname="tests/health.tflw" time="0.045">
      <system-out>flaky: passed after a retry</system-out>
    </testcase>
  </testsuite>
  <testsuite name="tests/checkout.tflw" tests="1" failures="1" errors="0" time="0.008" timestamp="2026-07-05T00:00:00.000Z">
    <properties>
      <property name="env" value="local"/>
      <property name="seed" value="42"/>
      <property name="now" value="2026-07-05T00:00:00.000Z"/>
    </properties>
    <testcase name="broken &lt;thing&gt; &amp; &quot;stuff&quot;" classname="tests/checkout.tflw" time="0.008">
      <failure message="expected status to equal 200, but got 500">expected status to equal 200, but got 500</failure>
    </testcase>
  </testsuite>
</testsuites>
`,
  );
});

// FS-09 (review finding A13-01) — the property this whole milestone exists for, and the one no
// existing assertion could have expressed: every other test here is about a single <testcase>, and
// this one is about a *pair*. Two tests may legitimately share a name across files (`smoke.tflw`
// and `regression.tflw` both having a "checkout works"); a CI dashboard keys flaky-test history off
// name + classname, so with no classname it merges the two into one row and attributes each one's
// failures to the other.
test('two same-named tests in different files are distinguishable — different suites, different classnames', () => {
  const xml = renderJunitXml({
    ...report,
    tests: [
      { kind: 'functional', name: 'checkout works', file: 'tests/smoke.tflw', ok: true, durationMs: 10, steps: [] },
      { kind: 'functional', name: 'checkout works', file: 'tests/regression.tflw', ok: false, durationMs: 20, steps: [], error: 'got 500' },
    ],
  });

  const cases = [...xml.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cases, [
    ['checkout works', 'tests/smoke.tflw'],
    ['checkout works', 'tests/regression.tflw'],
  ]);
  assert.notEqual(cases[0]![1], cases[1]![1], 'identical names must not produce identical testcase identities');

  // …and the failure is attributed to exactly one of the two suites, not to both and not to the run
  // as an undifferentiated whole.
  assert.match(xml, /<testsuite name="tests\/smoke\.tflw" tests="1" failures="0"/);
  assert.match(xml, /<testsuite name="tests\/regression\.tflw" tests="1" failures="1"/);
  assert.match(xml, /<testsuites name="tflw" tests="2" failures="1"/);
});

// `TestResult.file` is optional by design — the interpreter never sets it, and the CLI stamps it
// afterwards — so a report can legitimately arrive with none. It still needs a suite, and it gets
// the same placeholder `report.html`'s sidebar has always used, from the one shared `group-by-file`
// rule rather than a second private copy of the string.
test('a report with no file on any test still produces one suite, under the shared (no file) placeholder', () => {
  const xml = renderJunitXml({ ...report, tests: [{ kind: 'functional', name: 'ok', ok: true, durationMs: 1, steps: [] }] });
  assert.match(xml, /<testsuite name="\(no file\)" tests="1" failures="0"/);
  assert.match(xml, /<testcase name="ok" classname="\(no file\)" time="0\.001"\/>/);
});

test('renderJunitXml strips XML-invalid C0 control characters from a test name/error, keeping tab/LF/CR intact (decision 73)', () => {
  // e.g. a garbled/binary response body echoed into an error message could carry a raw \x01 or
  // \x1F — XML 1.0 forbids these outright (unlike & < > ", which entity-escaping already handles),
  // so leaving them in would hand some CI JUnit parsers a document that isn't well-formed XML.
  const dirtyReport: RunReport = {
    ...report,
    tests: [{ kind: 'functional', name: 'name with a \x01 control char', file: 'tests/dirty\x07.tflw', ok: false, durationMs: 3, steps: [], error: 'bad byte: \x1F end' }],
  };
  const xml = renderJunitXml(dirtyReport);

  assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/, 'no XML-invalid control character may survive into the document');
  assert.match(xml, /name with a � control char/);
  assert.match(xml, /bad byte: � end/);
  // The file path is interpolated into two new places as of M65 (`<testsuite name>` and every
  // `classname`), so it has to be escaped in both — a path is report-derived text like any other.
  assert.match(xml, /<testsuite name="tests\/dirty�\.tflw"/);
  assert.match(xml, /classname="tests\/dirty�\.tflw"/);
});

test('renderJunitXml on an all-passing report has zero failures and no <failure>/<system-out> elements', () => {
  const cleanReport: RunReport = { ...report, ok: true, failed: 0, tests: [{ kind: 'functional', name: 'ok', file: 'tests/ok.tflw', ok: true, durationMs: 1, steps: [] }] };
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
        file: 'tests/flaky.tflw',
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
  const withoutAttempts: RunReport = { ...report, tests: [{ kind: 'functional', name: 'eventually works', file: 'tests/flaky.tflw', ok: true, durationMs: 45, steps: [], flaky: true }] };
  assert.match(renderJunitXml(withoutAttempts), /<system-out>flaky: passed after a retry<\/system-out>/);
});

// The run's `time` is wall clock and a suite's is the sum of its own testcases — those are
// different numbers whenever files run concurrently, and summing the suites to fill in the root
// would report a run as having taken longer than it did.
test('each suite times its own testcases; the root reports the run wall clock, not their sum', () => {
  const xml = renderJunitXml({
    ...report,
    durationMs: 1234,
    tests: [
      { kind: 'functional', name: 'a', file: 'tests/one.tflw', ok: true, durationMs: 1000, steps: [] },
      { kind: 'functional', name: 'b', file: 'tests/two.tflw', ok: true, durationMs: 1000, steps: [] },
    ],
  });
  assert.match(xml, /<testsuites name="tflw" tests="2" failures="0" errors="0" time="1\.234"/);
  assert.match(xml, /<testsuite name="tests\/one\.tflw" tests="1" failures="0" errors="0" time="1\.000"/);
  assert.match(xml, /<testsuite name="tests\/two\.tflw" tests="1" failures="0" errors="0" time="1\.000"/);
});

// -- M56 (Phase 3, D119): a WorkloadTestResult entry, folded in from the old load-junit.ts --------

const emptyMetrics = { iterations: 0, failures: 0, errorRate: 0, durations: { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 }, histogram: [], timeline: [] };

const workloadTest: WorkloadTestResult = {
  kind: 'workload',
  name: 'checkout',
  file: 'load/checkout.tflw',
  workload: { kind: 'users', target: 10, overMs: 1000 },
  metrics: emptyMetrics,
  thresholds: [
    { label: 'p95 duration', op: 'lessThan', target: 800, actual: 950, ok: false },
    { label: 'error rate', op: 'lessThan', target: 0.01, actual: 0, ok: true },
  ],
  ok: false,
  endpoints: [],
};

test('a workload entry contributes one <testcase> per declared threshold, pass/fail from threshold.ok, each carrying its file as classname', () => {
  const xml = renderJunitXml({ ...report, tests: [workloadTest] });
  assert.match(
    xml,
    // M89a: `950ms`, not `950`. All three sinks now format a threshold's numbers through
    // `threshold-format.ts`, so junit's message carries the same units the console and
    // `report.html` always have — and, more to the point, the same wording for D-M89-1's
    // `actual: null` ("no successful iterations") instead of the literal `null` a raw
    // interpolation would have produced.
    /<testcase name="checkout — p95 duration &lt; 800" classname="load\/checkout\.tflw" time="0\.000">\s*<failure message="threshold breached: actual 950ms was not less than 800ms">/,
  );
  assert.match(xml, /<testcase name="checkout — error rate &lt; 0\.01" classname="load\/checkout\.tflw" time="0\.000"\/>/);
  // A workload test has no single duration, so its suite sums to nothing — the planned `overMs` is
  // an input, not an outcome, and reporting it as elapsed time would be a guess.
  assert.match(xml, /<testsuite name="load\/checkout\.tflw" tests="2" failures="1" errors="0" time="0\.000"/);
});

// D119: an intentional behavior change from the old load-junit.ts, which contributed zero
// <testcase>s for a threshold-less scenario (invisible in CI output) — a workload test with no
// `threshold` now still gets one bare <testcase>, so it shows up in the suite at all.
test('a workload entry with zero thresholds contributes one bare, always-passing <testcase>', () => {
  const noThresholds: WorkloadTestResult = { ...workloadTest, thresholds: [], ok: true };
  const xml = renderJunitXml({ ...report, tests: [noThresholds] });
  assert.match(xml, /tests="1" failures="0"/);
  assert.match(xml, /<testcase name="checkout" classname="load\/checkout\.tflw" time="0\.000"\/>/);
});

test('report.inconclusive marks every workload threshold <testcase> skipped, not passed or failed, and counts them skipped on both root and suite', () => {
  const xml = renderJunitXml({ ...report, tests: [workloadTest], inconclusive: true });
  assert.match(xml, /<testsuites name="tflw" tests="2" failures="0" errors="0" skipped="2"/);
  assert.match(xml, /<testsuite name="load\/checkout\.tflw" tests="2" failures="0" errors="0" skipped="2"/);
  assert.doesNotMatch(xml, /<failure/);
  const skipped = [...xml.matchAll(/<skipped message="([^"]+)"/g)];
  assert.equal(skipped.length, 2);
  assert.match(skipped[0]![1]!, /saturated/);
});

// `aborted` is a run-level fact, but `<properties>` is only schema-valid under a `<testsuite>` —
// so every suite repeats it, and a reader who opens any one of them can still recover the seed and
// see that the run was cut short.
test('report.aborted records the abortedMessage as a property, on every file suite', () => {
  const xml = renderJunitXml({
    ...report,
    tests: [{ kind: 'functional', name: 'a', file: 'tests/one.tflw', ok: true, durationMs: 1, steps: [] }, workloadTest],
    aborted: true,
    abortedMessage: 'aborted at 12s of 30s planned',
  });
  const props = [...xml.matchAll(/<property name="aborted" value="([^"]+)"\/>/g)];
  assert.equal(props.length, 2, 'each suite carries the run properties — a root-level block is not valid JUnit');
  assert.equal(props[0]![1], 'aborted at 12s of 30s planned');
  assert.equal([...xml.matchAll(/<property name="seed" value="42"\/>/g)].length, 2);
});

test('a file mixing functional and workload entries contributes testcases for both, in order, in one suite', () => {
  const xml = renderJunitXml({
    ...report,
    tests: [
      { kind: 'functional', name: 'health check', file: 'load/checkout.tflw', ok: true, durationMs: 12, steps: [] },
      { ...workloadTest, thresholds: [{ label: 'error rate', op: 'lessThan', target: 0.01, actual: 0, ok: true }], ok: true },
    ],
  });
  const names = [...xml.matchAll(/<testcase name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['health check', 'checkout — error rate &lt; 0.01']);
  assert.equal([...xml.matchAll(/<testsuite /g)].length, 1, 'one file, one suite, regardless of entry kind');
});
