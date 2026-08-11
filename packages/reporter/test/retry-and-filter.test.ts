// M125d — three console/record rows that all turn on the same thing: a number the tool already had
// and never said out loud.
//
//   `FU-25`  a test that exhausted its `retry` budget failing every time printed exactly what a
//            test that ran once and failed printed — while results.json carried `attempts: 2`.
//   `FU-19`  the per-test back-off warning and the run-level saturation verdict blame opposite
//            parties and neither mentions the other.
//   `FU-23`  a `--tag`-filtered run overwrites .last-run.json, silently redefining `--failed`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport, TestResult, WorkloadTestResult } from '@tflw/runtime';
import { renderCliSummary } from '../src/cli-summary.js';
import { describeRunFilter, renderLastRun } from '../src/last-run.js';

const attempt = (n: number, ok: boolean) => ({ attempt: n, ok, durationMs: 4, steps: [] });

const functional = (over: Partial<TestResult>): TestResult =>
  ({ kind: 'functional', name: 'a test', ok: true, durationMs: 5, steps: [], file: 'a.tflw', ...over }) as TestResult;

const reportOf = (tests: readonly TestResult[], over: Partial<RunReport> = {}): RunReport => ({
  ok: tests.every((t) => t.ok),
  env: 'local',
  startedAt: '2026-08-11T00:00:00.000Z',
  durationMs: 50,
  total: tests.length,
  passed: tests.filter((t) => t.ok).length,
  failed: tests.filter((t) => !t.ok).length,
  seed: 1,
  now: '2026-08-11T00:00:00.000Z',
  insecure: false,
  tests,
  ...over,
});

// --- FU-25: retry visibility -------------------------------------------------------------------

test('a test that failed every attempt says how many attempts ran', () => {
  const out = renderCliSummary(reportOf([functional({ name: 'always fails', ok: false, attempts: [attempt(1, false), attempt(2, false)] })]), false);
  assert.match(out, /✗ always fails \(2 attempts\)/);
});

test('a single-attempt failure is unchanged — no count where no retry happened', () => {
  const out = renderCliSummary(reportOf([functional({ name: 'tried once', ok: false })]), false);
  assert.match(out, /✗ tried once \(\d+ ms\)/);
  assert.doesNotMatch(out, /attempts\)/);
});

test('the two are now distinguishable, which is the whole row', () => {
  // Measured before the fix: byte-identical lines apart from the name and the duration.
  const out = renderCliSummary(
    reportOf([
      functional({ name: 'retried twice', ok: false, attempts: [attempt(1, false), attempt(2, false)] }),
      functional({ name: 'tried once', ok: false }),
    ]),
    false,
  );
  const retried = out.split('\n').find((l) => l.includes('retried twice')) ?? '';
  const once = out.split('\n').find((l) => l.includes('tried once')) ?? '';
  assert.notEqual(retried.replace('retried twice', 'X'), once.replace('tried once', 'X'));
});

test('a flaky pass keeps saying (flaky) and does not also count attempts', () => {
  // `(flaky)` is the same fact stated better — it says a retry *saved* this test, where a bare
  // count would only say retries happened. Printing both would be noise, not information.
  const out = renderCliSummary(reportOf([functional({ name: 'eventually works', ok: true, flaky: true, attempts: [attempt(1, false), attempt(2, true)] })]), false);
  assert.match(out, /✓ eventually works \(flaky\)/);
  assert.doesNotMatch(out, /attempts\)/);
});

// --- FU-19: the two workload diagnoses, related ------------------------------------------------

const workload = (backOff: boolean): WorkloadTestResult =>
  ({
    kind: 'workload',
    name: 'burst',
    file: 'load/burst.tflw',
    workload: { shape: 'hold', model: 'closed', target: 50, overMs: 30_000 },
    metrics: { iterations: 100, failures: 0, errorRate: 0, durations: { min: 0, max: 11, avg: 1, p50: 1, p90: 2, p95: 3, p99: 4 }, histogram: [], timeline: [] },
    thresholds: [],
    ok: true,
    endpoints: [],
    ...(backOff ? { backOff: { warning: true, ratio: 0.98 } } : {}),
  }) as unknown as WorkloadTestResult;

const saturated = { avgEventLoopLagMs: 140, maxEventLoopLagMs: 400, cpuPercent: 97, saturated: true };

test('when both fire, the saturation verdict says how to read the back-off line above it', () => {
  const out = renderCliSummary(reportOf([workload(true)] as unknown as TestResult[], { inconclusive: true, selfDiagnosis: saturated } as Partial<RunReport>), false);
  assert.match(out, /⚠ your load backed off/);
  assert.match(out, /⚠ inconclusive/);
  assert.match(out, /two readings of one overloaded machine, not a contradiction/);
  assert.match(out, /Believe this line first/);
});

test('the relation is not asserted when only the generator saturated', () => {
  const out = renderCliSummary(reportOf([workload(false)] as unknown as TestResult[], { inconclusive: true, selfDiagnosis: saturated } as Partial<RunReport>), false);
  assert.match(out, /⚠ inconclusive/);
  assert.doesNotMatch(out, /two readings of one overloaded machine/);
});

test('a back-off warning on its own is untouched — the ordinary case reads exactly as before', () => {
  const out = renderCliSummary(reportOf([workload(true)] as unknown as TestResult[]), false);
  assert.match(out, /⚠ your load backed off/);
  assert.doesNotMatch(out, /two readings of one overloaded machine/);
  assert.doesNotMatch(out, /⚠ inconclusive/);
});

// --- FU-23: the record remembers how it was narrowed -------------------------------------------

test('describeRunFilter renders each filter as the user typed it', () => {
  assert.equal(describeRunFilter({ tags: ['smoke'] }), '--tag smoke');
  assert.equal(describeRunFilter({ tags: ['smoke', 'auth'] }), '--tag smoke,auth');
  assert.equal(describeRunFilter({ only: 'checkout' }), '--only checkout');
  assert.equal(describeRunFilter({ failed: true }), '--failed');
  assert.equal(describeRunFilter({ tags: ['smoke'], only: 'checkout', failed: true }), '--tag smoke --only checkout --failed');
});

test('an unfiltered run has no filter at all — not an empty string', () => {
  // The distinction matters downstream: `--failed` appends its "which was filtered by" clause on
  // presence, so an empty string would make every full run claim to have been narrowed by nothing.
  assert.equal(describeRunFilter({}), undefined);
  assert.equal(describeRunFilter({ tags: [] }), undefined);
});

test('an unfiltered record is byte-identical to what every earlier version wrote', () => {
  const report = reportOf([functional({ name: 'broken', ok: false, file: 'b.tflw' })]);
  assert.deepEqual(renderLastRun(report), { failed: [{ file: 'b.tflw', test: 'broken' }] });
  assert.ok(!('filter' in renderLastRun(report)));
});

test('a filtered record carries the filter alongside the failures', () => {
  const report = reportOf([functional({ name: 'broken', ok: false, file: 'b.tflw' })]);
  assert.deepEqual(renderLastRun(report, '--tag smoke'), { failed: [{ file: 'b.tflw', test: 'broken' }], filter: '--tag smoke' });
});
