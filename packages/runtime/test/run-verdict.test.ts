// `M114` (review row `M111-01`) — the guard behind `RunReport.ok` meaning "this run passed".
//
// Deterministic on purpose. The tests that used to carry this claim were in `load.test.ts`, where
// every run points a real VU loop at a zero-latency loopback fixture and so can legitimately read
// `inconclusive` depending on how loaded the machine is — a verdict cannot be pinned down by a test
// whose input is the machine's spare CPU. Here the report is a literal, so `ok` is a function of
// nothing else.
//
// What each of the two halves is for:
//
//  - `noVerdictReason` — the ordering, and that it reads the two fields it claims to.
//  - `finalizeVerdict` — that `ok` is `false` on a no-verdict run **while `failed` stays 0**. That
//    pairing is the whole finding: `{"ok": true, "passed": 1, "failed": 0, "aborted": true}` is what
//    `results.json` shipped for fifteen milestones, and a CI job branching on `ok` read a clean pass
//    off a run cut short at 0s of a 4s plan.
//
// The third test is the one that would have caught the real regression risk: `finalizeVerdict` is
// applied by `spliceLoadReportIntoRunReport`, which is exactly where `aborted`/`inconclusive` arrive
// *after* `runProgram` already stamped `ok`. A per-producer copy of the rule would have been
// forgotten there, and nothing else in the suite reaches that path with an abort in hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeVerdict, noVerdictReason } from '../src/run-verdict.js';
import { spliceLoadReportIntoRunReport } from '../src/interpreter.js';
import type { LoadReport, RunReport, SelfDiagnosis } from '../src/types.js';

const cleanRun: RunReport = {
  ok: true,
  env: 'local',
  startedAt: '2026-08-09T00:00:00.000Z',
  durationMs: 100,
  total: 1,
  passed: 1,
  failed: 0,
  seed: 42,
  now: '2026-08-09T00:00:00.000Z',
  insecure: false,
  tests: [{ kind: 'functional', name: 'health check', ok: true, durationMs: 12, steps: [] }],
};

const healthy: SelfDiagnosis = { avgEventLoopLagMs: 0, maxEventLoopLagMs: 0, cpuPercent: 4, saturated: false };

test('`noVerdictReason`: abort outranks inconclusive, and a clean run has neither', () => {
  assert.equal(noVerdictReason(cleanRun), null);
  assert.equal(noVerdictReason({ ...cleanRun, inconclusive: true }), 'inconclusive');
  assert.equal(noVerdictReason({ ...cleanRun, aborted: true }), 'aborted');
  assert.equal(
    noVerdictReason({ ...cleanRun, aborted: true, inconclusive: true }),
    'aborted',
    'a run that was cut short never gathered the sample a saturation reading would describe — the abort is the more basic fact, and the exit-code ladder orders them the same way',
  );
});

test('`finalizeVerdict`: a run that reached a verdict keeps it', () => {
  assert.equal(finalizeVerdict(cleanRun).ok, true);
  assert.equal(finalizeVerdict({ ...cleanRun, inconclusive: false }).ok, true);

  const failing: RunReport = {
    ...cleanRun,
    ok: false,
    passed: 0,
    failed: 1,
    tests: [{ kind: 'functional', name: 'health check', ok: false, durationMs: 12, steps: [], error: 'boom' }],
  };
  assert.equal(finalizeVerdict(failing).ok, false);
});

test('`finalizeVerdict`: a run that reached no verdict is not `ok` — with `failed` still 0 (`M111-01`)', () => {
  for (const noVerdict of [{ aborted: true, abortedMessage: 'aborted at 0s of 4s planned' }, { inconclusive: true }]) {
    const stamped = finalizeVerdict({ ...cleanRun, ...noVerdict });
    assert.equal(stamped.ok, false, `${JSON.stringify(noVerdict)} must not report a pass`);
    // The other half of the contract, and the reason no new field was added: "nothing that ran
    // failed" is still recoverable, from the field named for counting failures.
    assert.equal(stamped.failed, 0);
    assert.equal(stamped.passed, 1);
  }
});

test('`finalizeVerdict` also runs where the abort *arrives* — `spliceLoadReportIntoRunReport`', () => {
  // `runProgram` stamps `ok` before this splice exists; the merged `LoadReport` is what carries the
  // abort in a `--workers N` run, so a verdict computed only at the earlier producer survives here
  // as a stale `true`.
  const loadReport: LoadReport = {
    ok: true,
    scenarios: [],
    startedAt: cleanRun.startedAt,
    durationMs: 100,
    seed: 42,
    now: cleanRun.now,
    selfDiagnosis: healthy,
    inconclusive: false,
    aborted: true,
    abortedMessage: 'aborted at 1s of 30s planned',
  };

  const spliced = spliceLoadReportIntoRunReport(cleanRun, loadReport);
  assert.equal(spliced.aborted, true);
  assert.equal(spliced.ok, false, 'the splice is where `aborted` arrives, so it is where the verdict has to be re-derived');

  const saturated = spliceLoadReportIntoRunReport(cleanRun, { ...loadReport, aborted: false, inconclusive: true });
  assert.equal(saturated.ok, false);
  assert.equal(spliceLoadReportIntoRunReport(cleanRun, { ...loadReport, aborted: false }).ok, true, 'and a healthy merged load report must still leave a clean run clean');
});
