// M29/M30/M31 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26/D28/D29): the workload engine — a
// single-process VU loop over both workload models (D17), `pause`-excluded duration metrics,
// threshold evaluation (D24a), per-iteration error handling (D18: an iteration's `expect` failure
// is counted, never thrown), session establishment once before the loop (not per iteration), M30's
// concurrent multi-scenario scheduling with per-scenario metrics (D29, R6), and M31's
// multi-process building blocks: workload/sub-seed striping (`shareOfWorkloadTarget`/
// `globalIterationIndex`), `runLoadShard`, and `mergeLoadShardReports` (D19, R4).
//
// **These tests assert `report.failed`, not `report.ok` (`M114`, review row `M111-01`).** Since
// `M114`, `RunReport.ok` is the run's *verdict* — false on a run that reached none, i.e. one whose
// generator saturated (`inconclusive`) or that was Ctrl-C'd (`aborted`). Every test here points a
// real VU loop at a zero-latency loopback fixture, which is the one target shape that genuinely can
// make tflw its own bottleneck, so whether a given run reads `inconclusive` depends on how loaded
// the machine is at that moment — four of these went red the first time `ok` started reflecting it.
// That is not a reason to weaken the verdict; it is a reason to stop borrowing it. These tests are
// about workload *mechanics*, and the thing they always meant was "no test in this run failed",
// which is `failed === 0` — the exact narrow statement `ok` used to make. The verdict itself is
// covered directly, and deterministically, in `run-verdict.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram, runLoadShard, mergeLoadShardReports, shareOfWorkloadTarget, globalIterationIndex, computeBackOff, workloadOf, type LoadTest, type RunOptions } from '../src/interpreter.js';
import { LatencyHistogram } from '../src/histogram.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { LoadIterationResult, LoadShardResult, RunReport, SelfDiagnosis, SerializedHistogram, WorkloadTestResult } from '../src/types.js';
import { startFixtureServer, testConfig, json } from './support.js';

const HEALTHY_DIAGNOSIS: SelfDiagnosis = { avgEventLoopLagMs: 1, maxEventLoopLagMs: 2, cpuPercent: 5, saturated: false };

/** M89a — `LoadShardScenarioResult.successful`, the successful-only duration population crossing
 * the IPC boundary. Every hand-built shard fixture below describes a shard with `failures: 0`, so
 * its successful population *is* its whole histogram. Written once rather than inlined into the
 * five shard literals: the compile-time guard doesn't reach here (no tsconfig `include` covers
 * `test/`), so a missing field on this type surfaces as a runtime TypeError in whichever fixture
 * was forgotten, not as an error naming the field. */
const allSucceeded = (h: LatencyHistogram): SerializedHistogram => ({ iterations: h.count, sum: h.sum, min: h.min, max: h.max, histogram: h.toBuckets() });

/**
 * Drives the shipped single-process path (`runProgram` → `runProgramInner`) and presents the
 * workload rows the run report actually carries, as `scenarios`.
 *
 * M91a (review finding `B3-06`, `D-M91-2`): every test below used to call `runLoad` — an entry
 * point with **no production caller**, returning a `LoadReport` shape no artifact ships. 46 of
 * them, which is what made "1,607 tests green" a weaker signal than it read as (`OBS-02`). The
 * helper deliberately *reads* `report.tests` rather than rebuilding a view from the accumulators:
 * the whole point of the finding is that a test must observe what production produced.
 *
 * `ok` is therefore `RunReport.ok` — "every row in this report passed". Every fixture here is
 * workload-only, so that is the same verdict `LoadReport.ok` gave (each scenario's own thresholds,
 * `entry.ok`), counted over report rows instead of over scenarios.
 */
async function runWorkload(
  program: Parameters<typeof runProgram>[0],
  config: Parameters<typeof runProgram>[1],
  opts: RunOptions,
): Promise<RunReport & { readonly scenarios: readonly WorkloadTestResult[] }> {
  const { report } = await runProgram(program, config, opts);
  return { ...report, scenarios: report.tests.filter((t): t is WorkloadTestResult => t.kind === 'workload') };
}

test('a closed (`ramp to N users`) workload runs iterations and reports clean metrics', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Health burst"\n  ramp to 3 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(report.scenarios.length, 1);
  const s = report.scenarios[0]!;
  assert.equal(s.name, 'Health burst');
  assert.deepEqual(s.workload, { shape: 'ramp', model: 'closed', target: 3, overMs: 200 });
  assert.ok(s.metrics.iterations > 0, 'expected at least one iteration to run');
  assert.equal(s.metrics.failures, 0);
  assert.equal(s.metrics.errorRate, 0);
  assert.deepEqual(s.thresholds, []);
  assert.equal(s.ok, true);

  await server.close();
});

test('an open (`ramp to N rps`) workload schedules arrivals independent of completion', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Ramp"\n  ramp to 40 rps over 400ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  assert.deepEqual(s.workload, { shape: 'ramp', model: 'open', target: 40, overMs: 400 });
  // area under a 0→40rps linear ramp over 0.4s = 40*0.4/2 = 8 arrivals — exact by construction.
  assert.equal(s.metrics.iterations, 8);
  assert.equal(s.metrics.failures, 0);

  await server.close();
});

test('a failing `expect` inside a scenario fails that iteration and counts toward the error rate, never aborts the run', async () => {
  let n = 0;
  const server = await startFixtureServer({
    '/flaky': (_req, res) => {
      n++;
      json(res, n % 2 === 0 ? 500 : 200, { n });
    },
  });
  const source = 'test "Flaky"\n  ramp to 4 users over 200ms\n  api GET /flaky\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  const s = report.scenarios[0]!;
  assert.ok(s.metrics.iterations >= 4, JSON.stringify(s.metrics));
  assert.ok(s.metrics.failures > 0, 'expected at least one 500 to fail its iteration');
  assert.ok(s.metrics.errorRate > 0 && s.metrics.errorRate < 1);

  await server.close();
});

test('an `error rate` threshold fails the run when breached, passes when met', async () => {
  const alwaysFail = await startFixtureServer({ '/fail': (_req, res) => res.writeHead(500).end() });
  const failSource = 'test "AllFail"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n  threshold error rate is less than 50%\n';
  const { program: failProgram } = parseSource(failSource);
  const failReport = await runWorkload(failProgram, testConfig(alwaysFail.baseUrl), { source: failSource });
  assert.equal(failReport.ok, false);
  assert.equal(failReport.scenarios[0]!.ok, false);
  assert.equal(failReport.scenarios[0]!.thresholds[0]!.ok, false);
  assert.equal(failReport.scenarios[0]!.thresholds[0]!.label, 'error rate');
  await alwaysFail.close();

  const alwaysOk = await startFixtureServer({ '/ok': (_req, res) => json(res, 200, { ok: true }) });
  const okSource = 'test "AllOk"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n  threshold error rate is less than 50%\n';
  const { program: okProgram } = parseSource(okSource);
  const okReport = await runWorkload(okProgram, testConfig(alwaysOk.baseUrl), { source: okSource });
  assert.equal(okReport.ok, true);
  assert.equal(okReport.scenarios[0]!.ok, true);
  assert.equal(okReport.scenarios[0]!.thresholds[0]!.ok, true);
  await alwaysOk.close();
});

test('a `pNN duration` threshold reads the exact requested percentile, not just the fixed p50/90/95/99 summary', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // p1 is trivially satisfied by any real latency floor; asserts the machinery accepts and
  // evaluates an arbitrary percentile (not just the four baked into LoadDurationStats).
  const source = 'test "S"\n  ramp to 2 users over 100ms\n  api GET /health\n  expect status equals 200\n  threshold p1 duration is less than 5000ms\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  assert.equal(report.scenarios[0]!.thresholds[0]!.label, 'p1 duration');
  assert.equal(report.scenarios[0]!.thresholds[0]!.ok, true);
  await server.close();
});

test('`pause` time is excluded from the reported iteration duration', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 1 users over 50ms\n  pause 300ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  // FS-05 found this guard missing: without it, a source whose pacing line no longer parses drops
  // to a `null` step and every assertion below holds *vacuously* — the two tests that exist to
  // prove pause time is excluded both passed against a program containing no pause at all.
  assert.deepEqual(diagnostics, []);
  const seen: LoadIterationResult[] = [];
  const report = await runWorkload(program, testConfig(server.baseUrl), { source, onIteration: (r) => seen.push(r) });
  assert.ok(seen.length >= 1);
  // Real wall time per iteration is >=300ms (the pause) + request time, but the *reported*
  // duration should be just the request — comfortably under the pause time itself.
  for (const r of seen) {
    assert.equal(r.scenario, 'S');
    assert.ok(r.durationMs < 250, `expected pause-excluded duration, got ${r.durationMs}ms`);
  }
  assert.ok(report.scenarios[0]!.metrics.durations.max < 250, JSON.stringify(report.scenarios[0]!.metrics));
  await server.close();
});

test('`runLoadShard` throws when the program declares no workload-bearing `test` — and says so without naming a command (B3-08, M90c)', async () => {
  // The message used to open ``\`tflw load\` needs …`` — a command `M53` removed. Naming `tflw run`
  // instead would have been a second lie in the same sentence: `tflw run` on such a file does not
  // error, it runs the functional tests. This is a library precondition and now reads as one.
  //
  // What this test is and is not (`B5-13`, closed by M91a/`D-M91-3`): it used to drive the guard
  // through `runLoad`, an entry point production never called — so it asserted a string no user
  // could reach, via a path no user could take. `M91a` deleted `runLoad`; the guard's one
  // surviving caller is `runLoadShard`, the forked `--workers N>1` worker, and the test drives it
  // there now. The message is *still* unreachable in the shipped product — `cli.ts` checks
  // `hasWorkload` before forking, so a zero-workload program never reaches a shard — but the guard
  // stays: it is `runLoadShard`'s documented precondition, and it is now proved through the entry
  // point production actually uses rather than through one invented for the test.
  const { program } = parseSource('test "not a load test"\n  api GET /health\n');
  const shard = { index: 0, count: 1 };
  await assert.rejects(() => runLoadShard(program, testConfig('http://127.0.0.1:1'), { source: '', shard }), /no workload-bearing `test`/);
  await assert.rejects(
    () => runLoadShard(program, testConfig('http://127.0.0.1:1'), { source: '', shard }),
    (e: unknown) => {
      assert.doesNotMatch((e as Error).message, /tflw (load|run)/, 'a library precondition names no command');
      return true;
    },
  );
});

// M52 (Phase 2, PLAN_UNIFIED_TEST_WORKLOAD.md): the 4 new workload kinds Phase 1b (D97) only
// parsed/checked now actually execute — a real VU/arrival loop per kind, not just accepted syntax.

test('a `hold N users for <dur>` workload runs a flat population for the whole duration, no ramp-in', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Steady"\n  hold 4 users for 300ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  assert.deepEqual(s.workload, { shape: 'hold', model: 'closed', target: 4, forMs: 300 });
  assert.ok(s.metrics.iterations >= 4, `expected several iterations from 4 flat VUs over 300ms, got ${s.metrics.iterations}`);
  assert.equal(s.metrics.failures, 0);
  await server.close();
});

test('a `hold N rps for <dur>` workload schedules a constant arrival rate', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Steady RPS"\n  hold 20 rps for 400ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  assert.deepEqual(s.workload, { shape: 'hold', model: 'open', target: 20, forMs: 400 });
  // a constant 20rps for 0.4s should land close to 8 arrivals (poll-interval jitter at these small
  // scales, unlike `ramp`'s exact closed-form schedule — see `runOpenPopulationArrivals`'s doc).
  assert.ok(s.metrics.iterations >= 4 && s.metrics.iterations <= 12, `expected ~8 iterations, got ${s.metrics.iterations}`);
  await server.close();
});

test('a `step users` staircase runs more iterations at its higher stages than a flat run at the lowest level would', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Staircase"\n  step users\n    to 1 for 150ms\n    to 6 for 150ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  // M89b (`B3-03`) — the stages survive into the report. This used to assert
  // `{ kind: 'users', target: 6, overMs: 300 }`: the peak and the total, which a `spike` with the
  // same peak and span produced byte-identically.
  assert.deepEqual(s.workload, { shape: 'step', model: 'closed', stages: [{ target: 1, durationMs: 150 }, { target: 6, durationMs: 150 }] });
  assert.ok(s.metrics.iterations >= 6, `expected the 6-VU second stage to contribute several iterations, got ${s.metrics.iterations}`);
  await server.close();
});

test('a `spike users` schedule ramps up, holds, and ramps back down without erroring', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source =
    'test "Spike"\n  spike users\n    hold 1 for 100ms\n    to 5 over 150ms\n    hold 5 for 150ms\n    to 1 over 150ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  // M89b (`B3-03`) — `ramped` per stage, mirroring what `stageTargetAt` schedules: `hold N for`
  // jumps, `to N over` ramps from the previous level.
  assert.deepEqual(s.workload, {
    shape: 'spike',
    model: 'closed',
    stages: [
      { target: 1, durationMs: 100, ramped: false },
      { target: 5, durationMs: 150, ramped: true },
      { target: 5, durationMs: 150, ramped: false },
      { target: 1, durationMs: 150, ramped: true },
    ],
  });
  assert.ok(s.metrics.iterations > 0);
  assert.equal(s.metrics.failures, 0);
  await server.close();
});

test('`run N iterations across M users` (shared pool) runs exactly N iterations total, never more', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "SharedPool"\n  run 17 iterations across 4 users\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  // M89b (`B3-03`) — used to be `{ kind: 'users', target: 4, overMs: 0 }`, which rendered as
  // `ramp to 4 users over 0ms`, a workload the grammar cannot express.
  assert.deepEqual(s.workload, { shape: 'iterations', iterations: 17, vus: 4, perVu: false });
  assert.equal(s.metrics.iterations, 17);
  await server.close();
});

test('`run N iterations per user across M users` runs exactly M*N iterations total', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "PerVu"\n  run 5 iterations per user across 3 users\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  assert.equal(s.metrics.iterations, 15);
  await server.close();
});

test('`pause` paces a `run … iterations …` body without being excluded from the iteration budget (D102)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "PacedIterations"\n  run 3 iterations per user across 1 users\n  pause 10ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(report.scenarios[0]!.metrics.iterations, 3);
  await server.close();
});

// M52/D98: the D17 back-off diagnostic extends to every closed (`users`) kind, not just `ramp`.
test('computeBackOff: a `hold`/`step`/`spike` (closed/users) workload is eligible for the diagnostic, same as `ramp` (D98)', () => {
  const hold = parseSource('test "S"\n  hold 5 users for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const step = parseSource('test "S"\n  step users\n    to 5 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const spike = parseSource('test "S"\n  spike users\n    hold 5 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  for (const scenario of [hold, step, spike]) {
    const backOff = computeBackOff(scenario, { count: 20, sum: 200 }, { count: 10, sum: 2000 });
    assert.ok(backOff, `expected ${scenario.workload.type} to be eligible for the back-off diagnostic`);
    assert.equal(backOff!.warning, true);
  }
});

// M107b (`M107-01`, D-M107-1) — the diagnostic requires one concurrency level for the whole window.
//
// The numbers that settled it are in `hasConstantConcurrency`'s doc: against a healthy
// finite-capacity service, `ramp to 5 users over 1500ms` warned 8/8 at ratio 0.569-0.589, which is
// *higher* than a genuinely leaking service scores under either shape (0.334-0.381). No threshold
// separates them. Under `hold` the same three targets separate by two orders of magnitude.
test('computeBackOff: undefined for a `ramp` — a rising target makes the two halves incomparable (M107-01, D-M107-1)', () => {
  const ramp = parseSource('test "S"\n  ramp to 5 users over 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  // The most extreme input the arithmetic accepts — early mean 10ms against late mean 200ms, which
  // on a `hold` produces ratio 0.95 and a warning two tests below. The point is that the shape
  // decides, not the numbers: no early/late gap makes a ramp answerable.
  assert.equal(computeBackOff(ramp, { count: 20, sum: 200 }, { count: 10, sum: 2000 }), undefined);
});

test('computeBackOff: a `step`/`spike` that changes its target is a ramp in disguise, and is equally undefined (M107-01)', () => {
  const step = parseSource('test "S"\n  step users\n    to 2 for 1s\n    to 10 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const spike = parseSource('test "S"\n  spike users\n    hold 2 for 1s\n    hold 10 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const ramped = parseSource('test "S"\n  spike users\n    to 5 over 1s\n    hold 5 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  for (const scenario of [step, spike, ramped]) {
    assert.equal(
      computeBackOff(scenario, { count: 20, sum: 200 }, { count: 10, sum: 2000 }),
      undefined,
      `expected ${scenario.workload.type} with a varying target to be ineligible`,
    );
  }
});

test('computeBackOff: a `step`/`spike` holding one target throughout is a `hold` written long-hand, and stays eligible (M107-01)', () => {
  // The control for the test above. Without it, "varying target → undefined" is also satisfied by
  // dropping `step`/`spike` from the diagnostic altogether, which D98 deliberately added.
  const step = parseSource('test "S"\n  step users\n    to 5 for 1s\n    to 5 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const spike = parseSource('test "S"\n  spike users\n    hold 5 for 1s\n    hold 5 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  for (const scenario of [step, spike]) {
    const backOff = computeBackOff(scenario, { count: 20, sum: 200 }, { count: 10, sum: 2000 });
    assert.ok(backOff, `expected ${scenario.workload.type} at one target to stay eligible`);
    assert.equal(backOff!.warning, true);
  }
});

test('computeBackOff: undefined for every open (`rps`) or count-based kind — no "backing off" concept there (D17/D102)', () => {
  const holdRps = parseSource('test "S"\n  hold 100 rps for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const stepRps = parseSource('test "S"\n  step rps\n    to 100 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const spikeRps = parseSource('test "S"\n  spike rps\n    hold 100 for 1s\n  api GET /health\n').program.tests[0]! as LoadTest;
  const shared = parseSource('test "S"\n  run 10 iterations across 5 users\n  api GET /health\n').program.tests[0]! as LoadTest;
  const perVu = parseSource('test "S"\n  run 2 iterations per user across 5 users\n  api GET /health\n').program.tests[0]! as LoadTest;
  for (const scenario of [holdRps, stepRps, spikeRps, shared, perVu]) {
    assert.equal(computeBackOff(scenario, { count: 20, sum: 200 }, { count: 10, sum: 2000 }), undefined, `expected ${scenario.workload.type} to be ineligible`);
  }
});

test('a session opted into via `as <name>` establishes once before the loop, not once per iteration', async () => {
  let logins = 0;
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      logins++;
      json(res, 200, { token: 'tok-abc' });
    },
    '/health': (req, res) => json(res, req.headers['authorization'] === 'Bearer tok-abc' ? 200 : 401, {}),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  const source = 'test "Auth burst" as admin\n  ramp to 5 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, config, { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(logins, 1, 'session should establish exactly once, not per iteration');
  assert.equal(report.scenarios[0]!.metrics.failures, 0);

  await server.close();
});

// ---- M37: session-refresh regression tests (D43 found the bug, D44/D45 fixed it) --------------

test('a session token that goes stale mid-run re-establishes a small, bounded number of times — not once per remaining iteration (D43/D44)', async () => {
  let loginCount = 0;
  let validToken = '';
  let healthCalls = 0;
  const ROTATE_AT = 4;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      validToken = `tok-${loginCount}`;
      json(res, 200, { token: validToken });
    },
    '/health': (req, res) => {
      healthCalls++;
      // Simulate a credential going stale out from under the client mid-run (D43's real trigger
      // was a short JWT TTL) — the server unilaterally stops accepting whatever token was valid a
      // moment ago, independent of anything the client does.
      if (healthCalls === ROTATE_AT) validToken = 'rotated-away';
      json(res, req.headers['authorization'] === `Bearer ${validToken}` ? 200 : 401, {});
    },
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /auth/login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  // Long enough, with enough VUs, to run many iterations past ROTATE_AT — the whole point is
  // proving those later iterations don't each pay for their own re-login.
  const source = 'test "Auth burst" as admin\n  ramp to 3 users over 300ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, config, { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.ok(healthCalls > ROTATE_AT + 10, `expected many iterations after the rotation, got ${healthCalls} total health calls`);
  // Before the fix: every iteration after the rotation cloned the same frozen (now-stale) headers,
  // so every single one of them 401'd and paid for its own re-login — loginCount would track
  // healthCalls, not stay bounded. After the fix: the one real refresh becomes visible to every
  // other iteration immediately via the shared cache, so only a couple of logins happen in total
  // (the initial establish, the one the rotation triggers, and — since a couple of VUs may already
  // have a request in flight against the old token at the exact rotation instant — possibly one
  // storm-guard-bounded extra, never one per iteration).
  assert.ok(loginCount <= 3, `expected a small, bounded number of re-logins, got ${loginCount} across ${healthCalls} health calls`);
  await server.close();
});

test('several concurrent VUs hitting a 401 on the same stale token near-simultaneously trigger exactly one real re-login, not one each (D45)', async () => {
  let loginCount = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      // An artificial delay widens the race window to tens of milliseconds — every VU's first
      // request is guaranteed to discover the stale token and start racing
      // `SessionCache.reestablish` *before* this (the one real re-login) resolves, deterministically,
      // rather than depending on sub-millisecond real-time VU-spawn scheduling to line them up.
      setTimeout(() => json(res, 200, { token: `tok-${loginCount}` }), 30);
    },
    // Only the *second* login's token is ever accepted — the upfront fail-fast establish (which
    // always produces the first login) is deliberately already-stale, so every VU's very first
    // request 401s.
    '/health': (req, res) => json(res, req.headers['authorization'] === 'Bearer tok-2' ? 200 : 401, {}),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /auth/login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  // The ramp window is anchored to the run's global start time, which precedes the upfront
  // fail-fast session establishment above — so `overMs` needs enough headroom past that initial
  // establish's own 30ms delay for any VU to spawn at all, plus enough further room for several
  // VUs' first iterations to land within the *second* login's own 30ms delay and genuinely race
  // `SessionCache.reestablish` on the same stale ref, not just queue up one after another.
  const source = 'test "Auth storm" as admin\n  ramp to 20 users over 250ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, config, { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(loginCount, 2, `expected exactly one real re-login beyond the initial (already-stale) establish, got ${loginCount}`);
  await server.close();
});

// ---- M30: concurrent multi-scenario runs (D29, R6) -------------------------------------------

test('two `parallel` scenarios in one file run concurrently — a fast scenario is not blocked behind a slower one scheduling its arrivals', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // "Slow" is an open-workload scenario whose arrival schedule spans real time (5 arrivals spread
  // across it) — if scenarios ran sequentially (the M29 shape, one scenario per file, and — since
  // Phase 2b/D109 — the new default for two `test`s with no explicit `parallel` keyword), "Fast"
  // couldn't even start until "Slow"'s task fully finished scheduling *and awaiting* every one of
  // its arrivals. Both declare `parallel` explicitly (D109's opt-in) to keep asserting the
  // concurrent-execution behavior this test has always been about. Asserted on arrival *order*,
  // not a wall-clock threshold (flaky under CI/test-suite CPU contention, which delays every timer
  // uniformly but doesn't reorder concurrent work): a truly concurrent "Fast" (near-zero spawn
  // delay) lands among "Slow"'s iterations, not strictly after every one of them.
  const source =
    'test "Slow" parallel\n  ramp to 20 rps over 500ms\n  api GET /health\n  expect status equals 200\n\n' +
    'test "Fast" parallel\n  ramp to 1 users over 10ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const seen: LoadIterationResult[] = [];
  const report = await runWorkload(program, testConfig(server.baseUrl), { source, onIteration: (r) => seen.push(r) });
  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));

  const firstFastIndex = seen.findIndex((r) => r.scenario === 'Fast');
  const lastSlowIndex = seen.length - 1 - [...seen].reverse().findIndex((r) => r.scenario === 'Slow');
  assert.ok(firstFastIndex >= 0, 'expected at least one "Fast" iteration');
  assert.ok(
    firstFastIndex < lastSlowIndex,
    `"Fast"'s first iteration (index ${firstFastIndex}) never interleaved with "Slow"'s (last at ${lastSlowIndex}) — scenarios look serialized, not concurrent: ${JSON.stringify(seen.map((r) => r.scenario))}`,
  );

  await server.close();
});

// M91a (`B3-19`): this used to also assert that `report.combined` pooled both scenarios'
// iterations and failures. `combined` was computed, dropped by `spliceLoadReportIntoRunReport`,
// and read by nothing — so half this test's title described a number no user could observe. What
// remains is the half that ships, and the half that can actually regress: one scenario's failures
// must never leak into another's.
test('each scenario\'s own metrics stay scoped to itself — one scenario\'s failures never leak into another\'s', async () => {
  const server = await startFixtureServer({
    '/ok': (_req, res) => json(res, 200, { ok: true }),
    '/fail': (_req, res) => res.writeHead(500).end(),
  });
  const source =
    'test "Good"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n\n' +
    'test "Bad"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.scenarios.length, 2);
  const good = report.scenarios.find((s) => s.name === 'Good')!;
  const bad = report.scenarios.find((s) => s.name === 'Bad')!;
  assert.equal(good.metrics.failures, 0, 'Good scenario\'s own failures must not include Bad\'s');
  assert.ok(bad.metrics.failures > 0, 'Bad scenario should have failures of its own');
  assert.equal(bad.metrics.failures, bad.metrics.iterations, 'every Bad iteration hits the always-500 endpoint');
  assert.equal(good.metrics.iterations, good.metrics.successful.iterations, 'Good ran clean');

  await server.close();
});

test('each scenario\'s thresholds evaluate only against its own metrics — one can fail while another passes, gating the run\'s own failure count', async () => {
  const server = await startFixtureServer({
    '/ok': (_req, res) => json(res, 200, { ok: true }),
    '/fail': (_req, res) => res.writeHead(500).end(),
  });
  const source =
    'test "Passing"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n  threshold error rate is less than 1%\n\n' +
    'test "Failing"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n  threshold error rate is less than 1%\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  const passing = report.scenarios.find((s) => s.name === 'Passing')!;
  const failing = report.scenarios.find((s) => s.name === 'Failing')!;
  assert.equal(passing.ok, true);
  assert.equal(failing.ok, false);
  assert.equal(report.failed, 1, 'the overall run must count the breaching scenario as failed — and only that one');

  await server.close();
});

test('a session shared by two scenarios (both `as admin`) establishes exactly once, reused by both', async () => {
  let logins = 0;
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      logins++;
      json(res, 200, { token: 'tok-abc' });
    },
    '/health': (req, res) => json(res, req.headers['authorization'] === 'Bearer tok-abc' ? 200 : 401, {}),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  const source =
    'test "One" as admin\n  ramp to 3 users over 100ms\n  api GET /health\n  expect status equals 200\n\n' +
    'test "Two" as admin\n  ramp to 3 users over 100ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, config, { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(logins, 1, 'a session shared by two concurrent scenarios should still establish exactly once');

  await server.close();
});

// ---- M31: multi-process building blocks (D19, R4) --------------------------------------------

test('shareOfWorkloadTarget: splits a target evenly, remainder to the lowest-indexed shards, and always sums back to the target', () => {
  assert.equal(shareOfWorkloadTarget(10), 10, 'undefined shard is the identity split');
  assert.equal(shareOfWorkloadTarget(10, { index: 0, count: 3 }), 4);
  assert.equal(shareOfWorkloadTarget(10, { index: 1, count: 3 }), 3);
  assert.equal(shareOfWorkloadTarget(10, { index: 2, count: 3 }), 3);
  const shares = [0, 1, 2, 3].map((index) => shareOfWorkloadTarget(10, { index, count: 4 }));
  assert.deepEqual(shares.reduce((a, b) => a + b, 0), 10);
  // A target smaller than the shard count legitimately gives some shards 0 — not an error.
  assert.equal(shareOfWorkloadTarget(2, { index: 2, count: 4 }), 0);
  assert.equal(shareOfWorkloadTarget(2, { index: 0, count: 4 }), 1);
});

test('globalIterationIndex: id ≡ shard.index mod shard.count, so two shards never collide without coordinating', () => {
  assert.equal(globalIterationIndex(5), 5, 'undefined shard is the identity map');
  const shardACount3 = { index: 0, count: 3 };
  const shardBCount3 = { index: 1, count: 3 };
  const idsA = [0, 1, 2, 3].map((local) => globalIterationIndex(local, shardACount3));
  const idsB = [0, 1, 2, 3].map((local) => globalIterationIndex(local, shardBCount3));
  assert.deepEqual(idsA, [0, 3, 6, 9]);
  assert.deepEqual(idsB, [1, 4, 7, 10]);
  assert.ok(idsA.every((id) => id % 3 === shardACount3.index));
  assert.ok(idsB.every((id) => id % 3 === shardBCount3.index));
  assert.deepEqual(
    idsA.filter((id) => idsB.includes(id)),
    [],
    'no id produced by shard A should ever be produced by shard B',
  );
});

// B3-01 (M79). The two tests above cover `shareOfWorkloadTarget` as a *pure function*, where the
// shares do sum back to the target exactly, as its doc comment says. That says nothing about two
// independent applications of it composed, which is what the count-bounded workloads do — and
// composing them is what dropped iterations on the floor whenever `vus < shard.count`. These assert
// the invariant that actually matters to a user: a count-bounded workload runs *exactly* the number
// of iterations it was told to, no matter how many processes `--workers` spread it over.
test('B3-01: `run N iterations across M users` executes exactly N iterations at every shard count, including M < count', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  run 12 iterations across 2 users\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  // count 1-2 exercise `vus >= count` (the shape that always worked); 3, 4 and 8 exercise
  // `vus < count`, where the higher-indexed shards get no VU at all — pre-fix they took a share of
  // the iteration pool anyway and never ran it, giving 8, 6 and 4 of the 12 requested.
  for (const count of [1, 2, 3, 4, 8]) {
    const shards = await Promise.all(
      Array.from({ length: count }, (_, index) => runLoadShard(program, config, { source, shard: { index, count } })),
    );
    const perShard = shards.map((s) => s.scenarios[0]?.iterations ?? 0);
    const total = perShard.reduce((a, b) => a + b, 0);
    assert.equal(total, 12, `--workers ${count} ran ${total} of 12 iterations (per-shard ${perShard.join(',')})`);
    assert.equal(
      shards.reduce((sum, s) => sum + (s.scenarios[0]?.failures ?? 0), 0),
      0,
      `--workers ${count} should have no failures`,
    );
    // The complementary half of the same invariant: a shard with no VU must claim no iterations.
    // Without this, "exactly 12" could be met by a shard that reports iterations it never ran.
    assert.ok(
      perShard.slice(2).every((n) => n === 0),
      `only the 2 shards holding a VU may run iterations (per-shard ${perShard.join(',')})`,
    );
  }

  await server.close();
});

test('B3-01: `run N iterations per user across M users` executes exactly N*M iterations at every shard count', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // The per-VU kind stripes only `vus` — there is no second axis to compose — so it was already
  // correct. Locked in here so a future change to the shared-pool split can't quietly break it.
  const source = 'test "S"\n  run 3 iterations per user across 2 users\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  for (const count of [1, 2, 4]) {
    const shards = await Promise.all(
      Array.from({ length: count }, (_, index) => runLoadShard(program, config, { source, shard: { index, count } })),
    );
    const perShard = shards.map((s) => s.scenarios[0]?.iterations ?? 0);
    assert.equal(
      perShard.reduce((a, b) => a + b, 0),
      6,
      `--workers ${count} should run 2 users x 3 iterations (per-shard ${perShard.join(',')})`,
    );
  }

  await server.close();
});

test('runLoadShard with shard {index:0, count:1} behaves like the whole run (a lone shard is the identity case)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 3 users over 150ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const shardResult = await runLoadShard(program, testConfig(server.baseUrl), { source, shard: { index: 0, count: 1 } });
  assert.equal(shardResult.scenarios.length, 1);
  assert.equal(shardResult.scenarios[0]!.name, 'S');
  assert.ok(shardResult.scenarios[0]!.iterations > 0);
  assert.equal(shardResult.scenarios[0]!.failures, 0);
  assert.equal(typeof shardResult.selfDiagnosis.saturated, 'boolean');
  await server.close();
});

test('mergeLoadShardReports: pools iterations/failures across shards and re-evaluates thresholds against the merged data', () => {
  const source = 'test "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p95 duration is less than 100ms\n';
  const { program } = parseSource(source);

  const fastHistogram = new LatencyHistogram();
  for (const v of [10, 12, 11, 13, 9]) fastHistogram.record(v);
  const slowHistogram = new LatencyHistogram();
  for (const v of [500, 520, 510]) slowHistogram.record(v);

  const shardFast: LoadShardResult = {
    scenarios: [{ name: 'S', workload: { shape: 'ramp', model: 'closed', target: 1, overMs: 1000 }, iterations: fastHistogram.count, failures: 0, sum: fastHistogram.sum, min: fastHistogram.min, max: fastHistogram.max, histogram: fastHistogram.toBuckets(), successful: allSucceeded(fastHistogram), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: HEALTHY_DIAGNOSIS,
  };
  const shardSlow: LoadShardResult = {
    scenarios: [{ name: 'S', workload: { shape: 'ramp', model: 'closed', target: 1, overMs: 1000 }, iterations: slowHistogram.count, failures: 0, sum: slowHistogram.sum, min: slowHistogram.min, max: slowHistogram.max, histogram: slowHistogram.toBuckets(), successful: allSucceeded(slowHistogram), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: HEALTHY_DIAGNOSIS,
  };

  const merged = mergeLoadShardReports(program, [shardFast, shardSlow], { startedAt: new Date().toISOString(), durationMs: 1000, seed: 42, now: new Date().toISOString() });
  assert.equal(merged.scenarios.length, 1);
  const s = merged.scenarios[0]!;
  assert.equal(s.metrics.iterations, 8, 'iterations from both shards must be pooled');
  assert.equal(s.metrics.durations.min, 9);
  assert.equal(s.metrics.durations.max, 520);
  // p95 over the pooled 8 samples lands among the slow shard's values — well above the 100ms
  // threshold, which only a genuinely merged (not per-shard) evaluation would catch.
  assert.equal(s.thresholds[0]!.ok, false, JSON.stringify(s.thresholds[0]));
  assert.equal(merged.ok, false);
  assert.equal(s.metrics.iterations, 8, 'both shards\' iterations land in the merged scenario row');
});

test('mergeLoadShardReports: a shard missing a scenario entirely (its striped share rounded to 0) is tolerated, not an error', () => {
  const source = 'test "A"\n  ramp to 1 users over 1s\n  api GET /health\n\ntest "B"\n  ramp to 1 users over 1s\n  api GET /health\n';
  const { program } = parseSource(source);
  const hA = new LatencyHistogram();
  hA.record(5);
  const shardWithOnlyA: LoadShardResult = {
    scenarios: [{ name: 'A', workload: { shape: 'ramp', model: 'closed', target: 1, overMs: 1000 }, iterations: 1, failures: 0, sum: 5, min: 5, max: 5, histogram: hA.toBuckets(), successful: allSucceeded(hA), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: HEALTHY_DIAGNOSIS,
  };
  const merged = mergeLoadShardReports(program, [shardWithOnlyA], { startedAt: new Date().toISOString(), durationMs: 100, seed: 1, now: new Date().toISOString() });
  assert.equal(merged.scenarios.length, 2);
  const a = merged.scenarios.find((s) => s.name === 'A')!;
  const b = merged.scenarios.find((s) => s.name === 'B')!;
  assert.equal(a.metrics.iterations, 1);
  assert.equal(b.metrics.iterations, 0);
  assert.equal(b.metrics.errorRate, 0, 'zero iterations is a defined 0 error rate, not NaN');
});

test('mergeLoadShardReports: selfDiagnosis.saturated is true if any shard saturated', () => {
  const source = 'test "S"\n  ramp to 1 users over 1s\n  api GET /health\n';
  const { program } = parseSource(source);
  const empty = new LatencyHistogram();
  empty.record(1);
  const shard = (saturated: boolean): LoadShardResult => ({
    scenarios: [{ name: 'S', workload: { shape: 'ramp', model: 'closed', target: 1, overMs: 1000 }, iterations: 1, failures: 0, sum: 1, min: 1, max: 1, histogram: empty.toBuckets(), successful: allSucceeded(empty), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: { ...HEALTHY_DIAGNOSIS, saturated },
  });
  const merged = mergeLoadShardReports(program, [shard(false), shard(true)], { startedAt: new Date().toISOString(), durationMs: 100, seed: 1, now: new Date().toISOString() });
  assert.equal(merged.selfDiagnosis.saturated, true);
});

test('mergeLoadShardReports throws on an empty shard-results array', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  assert.throws(() => mergeLoadShardReports(program, [], { startedAt: new Date().toISOString(), durationMs: 0, seed: 1, now: new Date().toISOString() }), /at least one shard/);
});

test('two real shards (runLoadShard against the same server) merge into one sane scenario row', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 4 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);
  const [shard0, shard1] = await Promise.all([
    runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }),
    runLoadShard(program, config, { source, shard: { index: 1, count: 2 } }),
  ]);
  const merged = mergeLoadShardReports(program, [shard0, shard1], { startedAt: new Date().toISOString(), durationMs: 200, seed: 7, now: new Date().toISOString() });
  assert.equal(merged.scenarios.length, 1);
  assert.equal(merged.scenarios[0]!.name, 'S');
  assert.ok(merged.scenarios[0]!.metrics.iterations > 0, 'both shards together should have run at least one iteration');
  await server.close();
});

test('a workload run reports a plausible selfDiagnosis (single-process, unsharded)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 1 users over 50ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  assert.equal(typeof report.selfDiagnosis.saturated, 'boolean');
  assert.ok(report.selfDiagnosis.avgEventLoopLagMs >= 0);
  assert.ok(report.selfDiagnosis.cpuPercent >= 0);
  await server.close();
});

// ---- M32: metrics.histogram/timeline, inconclusive, partial-on-abort, progress ticks (R3-R5/R11) ----

test('LoadMetrics carries its own histogram + timeline, and the timeline accounts for every iteration', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 3 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.ok(s.metrics.histogram.length > 0, 'a scenario with iterations must have a non-empty histogram');
  assert.ok(s.metrics.timeline.length > 0, 'a scenario with iterations must have a non-empty timeline');
  assert.equal(s.metrics.timeline[0]!.offsetSeconds, 0);
  // M91a (`B3-19`): asserted against `report.combined` until that field was deleted for being
  // written twice and read nowhere. The invariant is real — `report.html`'s charts render from
  // exactly these two arrays — so it moves to the metrics a report row actually carries.
  assert.equal(
    s.metrics.timeline.reduce((n, p) => n + p.count, 0),
    s.metrics.iterations,
    'summing every timeline point\'s count must equal the scenario\'s iteration count',
  );
  await server.close();
});

test('a workload run: inconclusive mirrors selfDiagnosis.saturated', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 1 users over 20ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  assert.equal(report.inconclusive, report.selfDiagnosis.saturated);
  assert.equal(report.aborted, undefined, 'a run that reaches its planned end must not be flagged aborted');
  await server.close();
});

test('mergeLoadShardReports: inconclusive mirrors the merged selfDiagnosis.saturated', () => {
  const source = 'test "S"\n  ramp to 1 users over 1s\n  api GET /health\n';
  const { program } = parseSource(source);
  const h = new LatencyHistogram();
  h.record(1);
  const shard: LoadShardResult = {
    scenarios: [{ name: 'S', workload: { shape: 'ramp', model: 'closed', target: 1, overMs: 1000 }, iterations: 1, failures: 0, sum: 1, min: 1, max: 1, histogram: h.toBuckets(), successful: allSucceeded(h), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: { ...HEALTHY_DIAGNOSIS, saturated: true },
  };
  const merged = mergeLoadShardReports(program, [shard], { startedAt: new Date().toISOString(), durationMs: 100, seed: 1, now: new Date().toISOString() });
  assert.equal(merged.inconclusive, true);
});

test('an already-aborted signal runs zero iterations and flags aborted/abortedMessage', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 5 users over 5000ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const controller = new AbortController();
  controller.abort();
  const report = await runWorkload(program, testConfig(server.baseUrl), { source, abortSignal: controller.signal });
  assert.equal(report.aborted, true);
  assert.match(report.abortedMessage!, /^aborted at \d+s of 5s planned$/, report.abortedMessage);
  assert.equal(report.scenarios[0]!.metrics.iterations, 0);
  await server.close();
});

test('aborting mid-run stops new iterations well short of the planned duration', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // Long planned duration (5s) so "aborted well before the end" isn't a race against natural
  // completion — the abort fires at 100ms, under 1/40th of the plan.
  const source = 'test "S"\n  ramp to 20 users over 5000ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const start = Date.now();
  const report = await runWorkload(program, testConfig(server.baseUrl), { source, abortSignal: controller.signal });
  const wallMs = Date.now() - start;
  assert.equal(report.aborted, true);
  assert.ok(wallMs < 2000, `abort should stop the run well under the 5s plan (took ${wallMs}ms)`);
  assert.ok(report.scenarios[0]!.metrics.iterations > 0, 'iterations already in flight when the abort fired should still be counted');
  await server.close();
});

test('onProgressTick fires roughly once a second with a cumulative, non-decreasing snapshot', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "S"\n  ramp to 5 users over 1300ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const ticks: { iterations: number; failures: number; elapsedMs: number }[] = [];
  await runWorkload(program, testConfig(server.baseUrl), { source, onProgressTick: (snapshot) => ticks.push(snapshot) });
  assert.ok(ticks.length >= 1, `expected at least one tick over a 1.3s run, got ${ticks.length}`);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i]!.iterations >= ticks[i - 1]!.iterations, 'iterations must never decrease tick to tick');
    assert.ok(ticks[i]!.elapsedMs >= ticks[i - 1]!.elapsedMs, 'elapsedMs must never decrease tick to tick');
  }
  await server.close();
});

// -- M34 (D17, back-off/coordinated-omission diagnostic) — computeBackOff's pure logic gets ------
// deterministic unit coverage (hand-built early/late totals, no real timing to flake on); a
// handful of real end-to-end runs below confirm the wiring (runProgram/runLoadShard/
// mergeLoadShardReports) all actually reach it, the same split M31's shareOfWorkloadTarget/
// globalIterationIndex unit tests and their own real-shard integration test already use.
//
// The design landed here (early-half-mean vs. late-half-mean) replaced an earlier attempt that
// compared achieved iterations against an "ideal" pace estimated from p10 (the fastest tenth of
// observed durations) — that approach was systematically biased: p10 is *always* faster than a
// run's typical iteration by construction, so it flagged "backing off" even against a genuinely
// healthy, uniformly-fast server (caught by a real, non-simulated run during this diagnostic's own
// development, not by inspection). Comparing two same-shape aggregates (mean vs. mean, each from a
// representative half of the run) has no such structural bias.

test('computeBackOff: undefined for an open-model (`ramp to N rps`) scenario — no "backing off" concept in that model (D17)', () => {
  const { program } = parseSource('test "S"\n  ramp to 100 rps over 1s\n  api GET /health\n');
  assert.equal(computeBackOff((program.tests[0]! as LoadTest), { count: 10, sum: 50 }, { count: 10, sum: 500 }), undefined);
});

test('computeBackOff: undefined when either half has fewer than MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF samples', () => {
  const { program } = parseSource('test "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  assert.equal(computeBackOff((program.tests[0]! as LoadTest), { count: 2, sum: 20 }, { count: 10, sum: 2000 }), undefined, 'too few early samples');
  assert.equal(computeBackOff((program.tests[0]! as LoadTest), { count: 10, sum: 100 }, { count: 2, sum: 400 }), undefined, 'too few late samples');
});

test('computeBackOff: undefined when a half has zero total duration — avoids dividing by zero', () => {
  const { program } = parseSource('test "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  assert.equal(computeBackOff((program.tests[0]! as LoadTest), { count: 10, sum: 0 }, { count: 10, sum: 500 }), undefined);
});

test('computeBackOff: a healthy scenario (early and late means close together) reports a low ratio, no warning', () => {
  // `hold`, not `ramp`: since M107b these three are about the ratio arithmetic, and `ramp` no
  // longer reaches it (`M107-01`, D-M107-1).
  const { program } = parseSource('test "S"\n  hold 5 users for 1s\n  api GET /health\n');
  // early mean 10ms, late mean 11ms — ordinary sample-to-sample variance, not a real slowdown.
  const backOff = computeBackOff((program.tests[0]! as LoadTest), { count: 20, sum: 200 }, { count: 20, sum: 220 });
  assert.ok(backOff, 'expected a defined BackOffDiagnosis');
  assert.ok(backOff!.ratio < 0.2, `expected a low ratio, got ${backOff!.ratio}`);
  assert.equal(backOff!.warning, false);
});

test('computeBackOff: a scenario whose late half ran far slower than its early half reports a high ratio and warns', () => {
  const { program } = parseSource('test "S"\n  hold 5 users for 1s\n  api GET /health\n');
  // early mean 10ms, late mean 200ms — ratio = 1 - 10/200 = 0.95.
  const backOff = computeBackOff((program.tests[0]! as LoadTest), { count: 20, sum: 200 }, { count: 10, sum: 2000 });
  assert.ok(backOff, 'expected a defined BackOffDiagnosis');
  assert.ok(backOff!.ratio > 0.2, `expected a high ratio, got ${backOff!.ratio}`);
  assert.equal(backOff!.warning, true);
});

test('computeBackOff: a scenario that sped up (late half faster than early) reports ratio 0, not negative', () => {
  const { program } = parseSource('test "S"\n  hold 5 users for 1s\n  api GET /health\n');
  const backOff = computeBackOff((program.tests[0]! as LoadTest), { count: 20, sum: 2000 }, { count: 20, sum: 200 });
  assert.ok(backOff, 'expected a defined BackOffDiagnosis');
  assert.equal(backOff!.ratio, 0);
  assert.equal(backOff!.warning, false);
});

test('a real degrading server triggers a genuine backOff warning on a closed-model run', async () => {
  // Fast for the scenario's own first half of wall-clock time (matching computeBackOff's own
  // early/late split at `overMs / 2`), then deliberately slow — a time-based trigger, not a
  // request-count one, so it lines up with exactly what the diagnostic actually measures.
  const runStart = Date.now();
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      if (Date.now() - runStart < 700) return json(res, 200, {});
      setTimeout(() => json(res, 200, {}), 150);
    },
  });
  // 1400ms/5 users comfortably clears MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF (10) on both halves —
  // the late half alone fits roughly (700ms / 150ms) × 5 users ≈ 23 iterations.
  //
  // `hold`, not `ramp`, since M107b (`M107-01`): the trigger here is time-based, so the premise is
  // unchanged, but under `ramp` the diagnostic no longer applies at all — and worse, this test
  // would have kept passing under `ramp` for the wrong reason. A rising target makes a healthy
  // finite-capacity server score 0.57 all by itself, higher than this genuinely degrading one, so
  // the assertion below was never evidence that the *server's* degradation was what fired it.
  const source = 'test "Degrading"\n  hold 5 users for 1400ms\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.ok(s.backOff, 'expected a defined backOff diagnosis on a closed-model scenario');
  assert.equal(s.backOff!.warning, true, `expected the back-off warning to fire, ratio was ${s.backOff!.ratio}`);
  assert.ok(s.backOff!.ratio > 0.2, `expected ratio > 0.2, got ${s.backOff!.ratio}`);
  await server.close();
});

// M107 (`M106-04`) — the negative control below, and its own positive twin. The pair is deliberate:
// a control that says "no warning" is only worth reading if the *same* fixture, the same workload
// shape and the same assertion do produce a warning when the server really degrades. Without the
// twin, `warning === false` is satisfied by any change that stops the diagnostic running at all.
//
// WHY `hold`, NOT `ramp`. Until M107 the negative control ran `ramp to 5 users over 1500ms`, and it
// went red on CI (run 31228677758, Node 22, the Coverage step only) with `ratio 0.2549` against a
// server whose every response is a flat 5ms sleep. That was not jitter. Under `ramp`, the early
// half runs at roughly *half* the concurrency of the late half by construction — VUs spawn linearly
// across `overMs` — so the late half's iterations queue behind more concurrent work on the same
// single-threaded client loop and the same single-threaded fixture server. Rising latency under
// rising concurrency is Little's law, not a server backing off, and `computeBackOff` cannot tell
// the two apart: `ramp` simply cannot express the premise "uniform load" that this control asserts.
//
// Measured rather than reasoned about (8 runs each, identical conditions — `c8` instrumentation on
// a single contended core, which is what a CI runner executing the rest of the suite alongside this
// one looks like):
//
//     ramp to 5 users over 1500ms   ratio 0.085 0.101 0.166 0.092 0.143 0.137 0.128 0.122
//     hold 5 users for  1500ms      ratio 0.000 0.000 0.000 0.037 0.000 0.000 0.002 0.000
//
// Every `ramp` run is late-slower, never once the reverse, and the gap grows with contention — on
// an idle box the same 8 runs sit at 0.01-0.09, which is why this only ever failed under coverage.
// `hold` puts every VU live at t=0 (D97), so both halves run at identical concurrency and the
// remaining spread is symmetric noise. The confound is removed, not merely diluted.
//
// The 5ms delay (rather than an instant response) is kept for the original reason: a sub-1ms
// response swings 100%+ on jitter alone, so per-request noise would dominate the mean instead of
// being a small fraction of it. That `ramp` reads a *healthy* system as backing off is a real
// property of the shipped diagnostic, not a test artefact — filed as `M107-01`, not papered over
// here.
// M107b (`M107-01`, D-M107-1) — the finding itself, end to end, against the fixture that produced
// the measurement rather than against a hand-built `early`/`late` pair.
//
// The server is a single-queue service of capacity 2: flat while it is not oversubscribed, latency
// growing with the backlog beyond that. **It is healthy** — its behaviour never changes, it just
// obeys Little's law like every finite-capacity system. Before this fix, `ramp` warned on it 8 runs
// out of 8 at ratio 0.569-0.589.
//
// Both shapes are asserted in one test on purpose. `assert.equal(backOff, undefined)` alone is
// satisfied by any change that stops the diagnostic running at all, so the `hold` half is the
// control that says the diagnostic is still alive and still quiet on a healthy target.
test('a rising target against a healthy finite-capacity server produces no diagnosis, while the same server under `hold` still gets one (M107-01)', async () => {
  let inflight = 0;
  const server = await startFixtureServer({
    '/work': (_req, res) => {
      inflight++;
      const backlog = Math.max(0, inflight - 2);
      setTimeout(() => {
        inflight--;
        json(res, 200, { ok: true });
      }, 5 * (1 + backlog));
    },
  });
  const run = async (workload: string) => {
    const source = `test "Q"\n  ${workload}\n  api GET /work\n  expect status equals 200\n`;
    const report = await runWorkload(parseSource(source).program, testConfig(server.baseUrl), { source });
    return report.scenarios[0]!;
  };

  const ramp = await run('ramp to 5 users over 1500ms');
  assert.equal(ramp.backOff, undefined, 'a `ramp` cannot answer "did the target slow down" — no two windows share a concurrency level');

  const hold = await run('hold 5 users for 1500ms');
  assert.ok(hold.backOff, 'expected `hold` to still carry a diagnosis — otherwise the assertion above proves nothing');
  assert.equal(hold.backOff!.warning, false, `a healthy finite-capacity server must not warn under \`hold\`, ratio ${hold.backOff!.ratio}`);
  await server.close();
});

test('a uniformly fast server does not trigger a backOff warning', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => setTimeout(() => json(res, 200, { ok: true }), 5) });
  const source = 'test "Healthy"\n  hold 5 users for 1500ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  // Asserted, not `if (s.backOff)`-guarded as it was before M107. A guard makes this control pass
  // for free the moment the diagnostic stops applying to this workload kind at all — dropping
  // `HoldUsersWorkload` from `CLOSED_USERS_KINDS` used to leave it green (`backoff-hold-kind` in
  // scripts/mutate.mjs, which now kills it). 1500ms at a flat 5ms clears
  // MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF (10) by two orders of magnitude on both halves.
  assert.ok(s.backOff, 'expected a defined backOff diagnosis — a closed `hold` scenario carries one (D98)');
  assert.equal(s.backOff!.warning, false, `unexpected back-off warning against a healthy server, ratio ${s.backOff!.ratio}`);
  await server.close();
});

test('a degrading server under the same `hold` shape does trigger the warning — the control above can fail', async () => {
  // The negative control's twin: identical workload shape, identical assertions, one difference —
  // this server really does slow down halfway through. Time-based (not request-count-based) so it
  // lines up with `computeBackOff`'s own early/late split at half the scenario's wall clock.
  const runStart = Date.now();
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      if (Date.now() - runStart < 750) return setTimeout(() => json(res, 200, {}), 5);
      setTimeout(() => json(res, 200, {}), 150);
    },
  });
  const source = 'test "Degrading"\n  hold 5 users for 1500ms\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.ok(s.backOff, 'expected a defined backOff diagnosis on a closed `hold` scenario');
  assert.equal(s.backOff!.warning, true, `expected the back-off warning to fire, ratio was ${s.backOff!.ratio}`);
  await server.close();
});

test('an open-model (`ramp to N rps`) real run never carries a backOff field', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Open"\n  ramp to 40 rps over 400ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  assert.equal(report.scenarios[0]!.backOff, undefined);
  await server.close();
});

test('two real shards each contribute their own early/late totals, and mergeLoadShardReports recomputes backOff from the merged data', async () => {
  const runStart = Date.now();
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      if (Date.now() - runStart < 700) return json(res, 200, {});
      setTimeout(() => json(res, 200, {}), 150);
    },
  });
  // `hold`, not `ramp`, since M107b (`M107-01`): what this test is about is that the *merge* path
  // recomputes the diagnosis from summed halves rather than averaging two shards' ratios, and that
  // needs a shape the diagnosis applies to at all. The slow trigger is time-based, so the premise
  // is unchanged.
  const source = 'test "Degrading"\n  hold 6 users for 1400ms\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);
  const [shardA, shardB] = await Promise.all([
    runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }),
    runLoadShard(program, config, { source, shard: { index: 1, count: 2 } }),
  ]);
  assert.ok(shardA.scenarios[0]!.early.count > 0 || shardA.scenarios[0]!.late.count > 0, 'expected a real shard to report some iterations');
  assert.ok(shardB.scenarios[0]!.early.count > 0 || shardB.scenarios[0]!.late.count > 0, 'expected a real shard to report some iterations');

  const merged = mergeLoadShardReports(program, [shardA, shardB], { startedAt: new Date().toISOString(), durationMs: 1400, seed: 1, now: new Date().toISOString() });
  const s = merged.scenarios[0]!;
  assert.ok(s.backOff, 'expected a defined backOff diagnosis on the merged report');
  assert.equal(s.backOff!.warning, true, `expected the merged back-off warning to fire, ratio was ${s.backOff!.ratio}`);
  await server.close();
});

// -- M43 (PLAN_BROWSER_PERF_SECURITY.md §2.14, D67-D70): per-endpoint breakdown --------------

test('a scenario with two untagged `api` steps gets two automatic-identity endpoints, each scoped to just its own requests', async () => {
  const server = await startFixtureServer({
    '/lookup': (_req, res) => setTimeout(() => json(res, 200, {}), 5),
    '/checkout': (_req, res) => setTimeout(() => json(res, 200, {}), 40),
  });
  const source = 'test "S"\n  ramp to 3 users over 200ms\n  api GET /lookup\n  api POST /checkout\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.endpoints.length, 2);
  assert.equal(s.endpoints[0]!.identity, 'GET /lookup');
  assert.equal(s.endpoints[1]!.identity, 'POST /checkout');
  assert.ok(s.endpoints[0]!.metrics.iterations > 0);
  assert.equal(s.endpoints[0]!.metrics.iterations, s.endpoints[1]!.metrics.iterations, 'both steps run once per iteration');
  // The whole-iteration metrics sum both legs; the /checkout leg alone should read slower on its
  // own than the fast /lookup leg — the exact asymmetry M43 exists to make visible.
  assert.ok(s.endpoints[1]!.metrics.durations.avg > s.endpoints[0]!.metrics.durations.avg, 'the slower leg should read slower in its own bucket');
  await server.close();
});

test('an `as "label"` tag replaces the automatic identity entirely (k6-style)', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, {}) });
  const source = 'test "S"\n  ramp to 2 users over 100ms\n  api POST /orders as "checkout"\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.endpoints.length, 1);
  assert.equal(s.endpoints[0]!.identity, 'checkout');
  await server.close();
});

test('an identity declared in source but never reached (every iteration fails first) still reports a zero-sample entry, not a missing one', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 500, {}) });
  const source = 'test "S"\n  ramp to 2 users over 100ms\n  api GET /health\n  expect status equals 200\n  api GET /never-reached\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.ok, true, 'no thresholds declared, so a scenario with only failed iterations is still vacuously ok');
  assert.equal(s.metrics.failures, s.metrics.iterations, 'every iteration should have failed at the expect');
  assert.deepEqual(
    s.endpoints.map((e) => e.identity),
    ['GET /health', 'GET /never-reached'],
  );
  const neverReached = s.endpoints.find((e) => e.identity === 'GET /never-reached')!;
  assert.equal(neverReached.metrics.iterations, 0);
  assert.equal(neverReached.metrics.errorRate, 0, 'zero samples is a defined 0 error rate, not NaN');
  const health = s.endpoints.find((e) => e.identity === 'GET /health')!;
  assert.ok(health.metrics.iterations > 0);
  assert.equal(health.metrics.failures, health.metrics.iterations, 'the failing expect should attribute to the endpoint it followed');
  await server.close();
});

test('`threshold … for "label"` evaluates against only that endpoint, independent of an unscoped threshold on the same metric', async () => {
  const server = await startFixtureServer({
    '/lookup': (_req, res) => setTimeout(() => json(res, 200, {}), 1),
    '/checkout': (_req, res) => setTimeout(() => json(res, 200, {}), 60),
  });
  const source =
    'test "S"\n  ramp to 3 users over 200ms\n  threshold p95 duration is less than 40ms\n  threshold p95 duration for "checkout" is less than 40ms\n  api GET /lookup\n  api POST /checkout as "checkout"\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.thresholds.length, 2);
  const whole = s.thresholds.find((t) => t.label === 'p95 duration')!;
  const scoped = s.thresholds.find((t) => t.label === 'p95 duration for "checkout"')!;
  // The whole-iteration threshold sums the fast lookup + slow checkout, so its own p95 is even
  // higher than the checkout-only threshold's — both fail here, but the scoped one's `actual`
  // should read close to the checkout leg alone, not the combined iteration.
  assert.ok(scoped.actual < whole.actual, `scoped p95 (${scoped.actual}) should read below the combined p95 (${whole.actual})`);
  assert.equal(scoped.ok, false);
  await server.close();
});

test('`mergeLoadShardReports` pools per-endpoint histograms across shards by identity', async () => {
  const server = await startFixtureServer({
    '/lookup': (_req, res) => json(res, 200, {}),
    '/checkout': (_req, res) => json(res, 200, {}),
  });
  const source = 'test "S"\n  ramp to 4 users over 200ms\n  api GET /lookup\n  api POST /checkout\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);
  const [shardA, shardB] = await Promise.all([
    runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }),
    runLoadShard(program, config, { source, shard: { index: 1, count: 2 } }),
  ]);
  const merged = mergeLoadShardReports(program, [shardA, shardB], { startedAt: new Date().toISOString(), durationMs: 200, seed: 1, now: new Date().toISOString() });
  const s = merged.scenarios[0]!;
  assert.equal(s.endpoints.length, 2);
  const lookup = s.endpoints.find((e) => e.identity === 'GET /lookup')!;
  const checkout = s.endpoints.find((e) => e.identity === 'POST /checkout')!;
  assert.equal(lookup.metrics.iterations, s.metrics.iterations, 'every iteration hits /lookup once');
  assert.equal(checkout.metrics.iterations, s.metrics.iterations, 'every iteration hits /checkout once');
  await server.close();
});

// M45 (PLAN_BROWSER_PERF_SECURITY.md §2.16, D75) — the closed-model (`RampUsersWorkload`) VU loop
// now pins one `node:http` connection per VU for that VU's whole lifetime instead of letting
// `sendRequest`'s unpinned `fetch()` open (and, without keep-alive reuse, often re-open) one per
// request. `httpPinned.test.ts` covers `sendPinnedRequest`/`createKeepAliveAgents` directly; these two
// exercise the real wiring end to end through the shipped `runProgram` path itself.

test('a closed-model scenario pins one connection per VU, reused across every iteration that VU runs', async () => {
  const ports: number[] = [];
  const server = await startFixtureServer({
    '/ping': (req, res) => {
      ports.push(req.socket.remotePort!);
      json(res, 200, { ok: true });
    },
  });
  const source = 'test "Pinned"\n  ramp to 2 users over 300ms\n  api GET /ping\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.ok(ports.length > 2, `expected more than one iteration per VU to actually run, got ${ports.length} total`);
  const distinctPorts = new Set(ports);
  assert.equal(distinctPorts.size, 2, `expected exactly 2 users' worth of distinct connections, saw ${distinctPorts.size} across ${ports.length} requests`);

  await server.close();
});

// ---------------------------------------------------------------------------------------------
// M121 (`M118-02`, D206/D207/D209) — the open model uses the same client as the closed one.
//
// M45 pinned the closed model and left the open one on `fetch`, reasoning that an arrival has no
// persistent VU to pin to. True of *pinning*, false of *pooling* — and on Node 26 the difference
// stopped being an optimisation: a `fetch` issued from a timer callback that its own loop does not
// await (an open arrival, exactly) has its completion deferred to roughly the next timer tick, so
// the reported duration tracked the inter-arrival gap instead of the service time. Measured chain,
// version bisect and the isolated trigger:
// `tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md`.
//
// These assert the *routing*, not a latency. This arc has paid twice for tests that encode a
// millisecond (`M115-02`, `M119-02`), and the defect is invisible on the Node versions CI runs
// (22/24) — a timing assertion would therefore have been both flaky and blind here. What is true on
// every version is which client sent the bytes, and that is what fails the moment someone reverts.
// ---------------------------------------------------------------------------------------------

/** `sec-fetch-mode` is emitted by `fetch`/undici and by nothing in `node:http` — verified present
 * on the fetch side and absent on the pinned side on Node 22.23.2, 24.19.0 and 26.7.0 rather than
 * assumed from the spec. `user-agent`/`accept-language` discriminate identically; this one is the
 * least likely to ever be set deliberately by a step the author wrote. */
const FETCH_ONLY_HEADER = 'sec-fetch-mode';

/** Every open (rate-based) grammar, so the assertion covers all three dispatch sites rather than
 * the one that happens to be most written about: `hold`/`step`+`spike` reach the shared arrival
 * scheduler, while `ramp to N rps` still runs its own inline closed-form schedule. A test that only
 * used `hold N rps` would leave `ramp`'s loop free to regress silently — and `ramp to N rps` is the
 * open workload the docs reach for first. */
const OPEN_WORKLOADS: readonly (readonly [string, string])[] = [
  ['ramp to N rps', 'ramp to 40 rps over 400ms'],
  ['hold N rps', 'hold 20 rps for 400ms'],
  ['step rps', 'step rps\n    to 20 for 200ms\n    to 30 for 200ms'],
  ['spike rps', 'spike rps\n    hold 20 for 200ms\n    to 30 over 200ms'],
];

for (const [label, workload] of OPEN_WORKLOADS) {
  test(`M121: an open-model (\`${label}\`) arrival sends over the keep-alive client, not \`fetch\``, async () => {
    const clients: (string | undefined)[] = [];
    const server = await startFixtureServer({
      '/health': (req, res) => {
        clients.push(req.headers[FETCH_ONLY_HEADER] as string | undefined);
        json(res, 200, { ok: true });
      },
    });
    const source = `test "Open"\n  ${workload}\n  api GET /health\n  expect status equals 200\n`;
    const { program, diagnostics } = parseSource(source);
    assert.deepEqual(diagnostics, []);

    const report = await runWorkload(program, testConfig(server.baseUrl), { source });

    assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
    assert.ok(clients.length > 0, 'the workload has to actually fire an arrival for this to assert anything');
    const viaFetch = clients.filter((c) => c !== undefined).length;
    assert.equal(viaFetch, 0, `${viaFetch} of ${clients.length} arrivals still went out over \`fetch\` (\`${FETCH_ONLY_HEADER}\` present)`);

    await server.close();
  });
}

test('M121/D207: every arrival in one open scenario shares one agent pair — not one pair per arrival', async () => {
  const ports: number[] = [];
  const server = await startFixtureServer({
    '/health': (req, res) => {
      ports.push(req.socket.remotePort!);
      json(res, 200, { ok: true });
    },
  });
  // A modest rate against an instant endpoint: arrivals essentially never overlap, so one shared
  // keep-alive pool serves all of them over a socket it reuses. A pair created per arrival cannot
  // reuse anything — every arrival would open (and pay a handshake for) its own connection, which
  // is the specific over-correction D207 rejects and `open-model-agents-per-arrival` restores.
  const source = 'test "Shared"\n  hold 20 rps for 500ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.ok(ports.length >= 5, `expected several arrivals to compare, got ${ports.length}`);
  // Stated as reuse rather than as an exact socket count: a genuinely coincident pair of arrivals
  // may legitimately open a second connection on a loaded machine, and pinning this to `=== 1`
  // would make a correct run red for a reason that has nothing to do with the decision under test.
  const distinct = new Set(ports).size;
  assert.ok(distinct < ports.length, `every one of the ${ports.length} arrivals opened its own connection (${distinct} distinct) — nothing was pooled`);

  await server.close();
});

// There is deliberately no in-suite *timing* test for `M118-02`, and the reason is worth keeping
// because D209 originally called for one. The plan specified a differential assertion — "the open
// and closed models report p50 within an order of magnitude of each other for one endpoint" — on the
// grounds that it states the invariant that actually broke without encoding a machine-specific
// millisecond. Building it and then running it on Node 26 **with the fix reverted**, which the
// milestone gate required precisely so the instrument could be checked, showed it does not work:
//
//   fixed     open p50 1ms   closed p50 0ms      reverted  open p50 5-8ms  closed p50 0ms
//
// The closed model against a loopback fixture reports **0**, so a ratio against it is degenerate —
// "within 10x of zero" admits anything under the `+1` floor, and the reverted run sailed through it
// 4 times in 5. The separation that genuinely exists (1ms vs 6ms) is *absolute*, which is the flake
// generator D209 refused on the strength of `M115-02` and `M119-02`, and lengthening the run until
// p50 stabilises needs `for 10s` per model — 20s on every CI run, to assert something neither Node
// version CI uses can even falsify. A test that catches the defect one run in five while reading as
// a guard is worse than no test: it is a flake that also grants false confidence.
//
// So the guard is structural (above) and the timing evidence is a recorded, manually-run
// reproduction: `tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md`, which carries the
// version bisect and the fixed-vs-reverted numbers measured on Node 26.

test('an `upload` body under a closed-model load still passes — falls back to the unpinned client for that request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-load-upload-'));
  await writeFile(join(dir, 'img.png'), 'fake-png-bytes');
  const server = await startFixtureServer({ '/uploads': (_req, res) => json(res, 201, { ok: true }) });
  const source = 'test "Upload burst"\n  ramp to 2 users over 200ms\n  api POST /uploads upload "./img.png" as "avatar"\n  expect status equals 201\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
  assert.equal(report.scenarios[0]!.metrics.failures, 0);

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// M89a (`B3-02`, `B3-12`, `B3-13`) — the population a threshold reads.
//
// The mechanism these tests exist for: a failing request is almost always *fast*. It 4xx/5xxs
// immediately, or the connection is refused, while a healthy one does real work. So mixing
// failures into a duration percentile drags it **down**, and a latency threshold then passes
// *because* the target is broken. The probe that filed `B3-02` reported `p95 2ms ✓ < 100ms` at a
// 96 % error rate, `PASS`, exit 0.
// ---------------------------------------------------------------------------------------------

/** A server whose `/mix` fails instantly for all but every `nth` request, and succeeds slowly —
 * the `B3-02` shape in its purest form. `slowMs` has to clear the threshold under test on its own,
 * so that a passing verdict can only ever come from the failures being counted. */
function mixedServer(nth: number, slowMs: number) {
  let n = 0;
  return {
    '/mix': (_req: unknown, res: import('node:http').ServerResponse) => {
      n += 1;
      if (n % nth !== 0) return json(res, 500, { ok: false });
      setTimeout(() => json(res, 200, { ok: true }), slowMs);
    },
  };
}

test('M89a/`B3-02`: a duration threshold reads successful iterations only — fast failures no longer buy a passing latency verdict', async () => {
  const server = await startFixtureServer(mixedServer(5, 120));
  // 20 iterations: 16 fail in ~0ms, 4 succeed in ~120ms. Pre-M89a the pooled p95 landed among the
  // instant failures and this threshold reported ✓; the successful-only p95 is ~120ms and fails.
  const source = 'test "S"\n  run 20 iterations across 2 users\n  api GET /mix\n  expect status equals 200\n  threshold p95 duration is less than 60ms\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;

  assert.equal(s.metrics.iterations, 20, 'every iteration is still counted');
  assert.equal(s.metrics.failures, 16);
  assert.equal(s.metrics.successful.iterations, 4);
  assert.ok(s.metrics.durations.p95 <= s.metrics.successful.durations.p95, 'the all-iterations p95 must be the *lower* of the two — that is exactly why it was the wrong one to threshold on');
  assert.ok(s.metrics.successful.durations.p95 >= 60, `successful-only p95 should clear 60ms, got ${s.metrics.successful.durations.p95}`);
  assert.equal(s.thresholds[0]!.ok, false, `the threshold must fail: ${JSON.stringify(s.thresholds[0])}`);
  assert.equal(report.failed, 1);

  await server.close();
});

test('M89a: `errorRate` still divides by *all* iterations — the denominator trap the split could have introduced', async () => {
  const server = await startFixtureServer(mixedServer(5, 5));
  const source = 'test "S"\n  run 20 iterations across 2 users\n  api GET /mix\n  expect status equals 200\n  threshold error rate is less than 100%\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;

  // Had the successful-only population been made by *narrowing* the one histogram rather than
  // adding a second, `errorRate` (`failures / histogram.count`) would have become
  // `failures / successes` = 16/4 = 400 % here, and 2400 % on the 1000-iteration probe.
  assert.equal(s.metrics.errorRate, 16 / 20, `expected 0.8, got ${s.metrics.errorRate}`);
  assert.ok(s.metrics.errorRate <= 1, 'an error rate can never exceed 100%');
  assert.equal(s.thresholds[0]!.actual, 16 / 20, 'an error-rate threshold reads the all-iterations denominator, not the successful one');

  await server.close();
});

test('M89a/D-M89-1: with zero successful iterations a duration threshold reports `actual: null` and fails', async () => {
  const server = await startFixtureServer({ '/mix': (_req, res) => json(res, 500, { ok: false }) });
  const source = 'test "S"\n  run 8 iterations across 2 users\n  api GET /mix\n  expect status equals 200\n  threshold p95 duration is less than 100ms\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;

  assert.equal(s.metrics.successful.iterations, 0);
  // The negative control for this decision: `LatencyHistogram.percentile` returns 0 on an empty
  // histogram, so reporting `actual: 0` would make "every single request failed" the *easiest*
  // way to pass a latency threshold — `B3-02`'s trap, reintroduced at its own boundary.
  assert.equal(s.thresholds[0]!.actual, null, 'no successful iterations means there is no percentile to state');
  assert.equal(s.thresholds[0]!.ok, false);
  assert.equal(report.failed, 1);

  await server.close();
});

test('M89a: `failures + successful.iterations === iterations`, at scenario and endpoint scope, for both workload models', async () => {
  const server = await startFixtureServer(mixedServer(3, 5));
  for (const workload of ['run 12 iterations across 2 users', 'ramp to 3 users over 300ms', 'ramp to 20 rps over 300ms', 'hold 2 users for 300ms']) {
    const source = `test "S"\n  ${workload}\n  api GET /mix as "mix"\n  expect status equals 200\n  threshold error rate is less than 100%\n`;
    const { program } = parseSource(source);
    const report = await runWorkload(program, testConfig(server.baseUrl), { source });

    for (const s of report.scenarios) {
      assert.equal(s.metrics.failures + s.metrics.successful.iterations, s.metrics.iterations, `${workload}: scenario scope`);
      for (const e of s.endpoints) {
        assert.equal(e.metrics.failures + e.metrics.successful.iterations, e.metrics.iterations, `${workload}: endpoint "${e.identity}"`);
      }
    }
  }
  await server.close();
});

test('M89a/`B3-02` at endpoint scope: a `threshold … for "label"` clause reads that endpoint\'s successful requests only', async () => {
  const server = await startFixtureServer(mixedServer(5, 120));
  const source = 'test "S"\n  run 20 iterations across 2 users\n  api GET /mix as "mix"\n  expect status equals 200\n  threshold p95 duration for "mix" is less than 60ms\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  const mix = s.endpoints.find((e) => e.identity === 'mix')!;

  assert.equal(mix.metrics.iterations, 20, 'every request is still a sample of the endpoint');
  assert.equal(mix.metrics.successful.iterations, 4);
  // The scoped form is what `checkout-burst` — the perf arc's own k6 acceptance benchmark —
  // thresholds on, so fixing only the whole-iteration scope would have shipped a release where
  // the unscoped threshold is honest and the scoped one is not.
  assert.equal(s.thresholds[0]!.ok, false, `scoped threshold must fail too: ${JSON.stringify(s.thresholds[0])}`);

  await server.close();
});

test('M89a/`B3-13`: a per-endpoint timeline records real failures — it was hardcoded to `ok: true`', async () => {
  const server = await startFixtureServer(mixedServer(5, 5));
  const source = 'test "S"\n  run 20 iterations across 2 users\n  api GET /mix as "mix"\n  expect status equals 200\n  threshold error rate is less than 100%\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const mix = report.scenarios[0]!.endpoints.find((e) => e.identity === 'mix')!;

  // `report.html` builds every per-endpoint error-rate chart from this series. With the literal
  // `true` it was flat zero for every endpoint of every run ever produced.
  const chartedFailures = mix.metrics.timeline.reduce((n, p) => n + p.failures, 0);
  assert.equal(chartedFailures, 16, `the endpoint's own error-rate series must carry its failures, got ${chartedFailures}`);
  assert.equal(mix.metrics.failures, 16);

  await server.close();
});

test('M89a/`B3-12`: a soft `check` failure is charged to the request it judged, not to whichever endpoint ran last', async () => {
  const server = await startFixtureServer({
    '/first': (_req, res) => json(res, 500, { ok: false }),
    '/second': (_req, res) => json(res, 200, { ok: true }),
  });
  // `check` records and continues (P#16), so the iteration runs on to `/second` after failing on
  // `/first`. M43 billed the *last* endpoint reached — `/second`, which answered 200 perfectly.
  const source = 'test "S"\n  run 4 iterations across 1 users\n  api GET /first as "first"\n  check status equals 200\n  api GET /second as "second"\n  expect status equals 200\n  threshold error rate is less than 100%\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  const first = s.endpoints.find((e) => e.identity === 'first')!;
  const second = s.endpoints.find((e) => e.identity === 'second')!;

  assert.equal(first.metrics.failures, 4, 'the endpoint that actually failed its check owns the failure');
  assert.equal(second.metrics.failures, 0, 'the innocent endpoint that answered 200 owns none');
  assert.equal(second.metrics.successful.iterations, 4);
  // Per-endpoint failures deliberately do *not* sum to the scenario's: this axis counts requests,
  // the scenario axis counts iterations.
  assert.equal(s.metrics.failures, 4);

  await server.close();
});

test('M89a/`B3-12`: two failing `check`s after one request bill that request once, never twice', async () => {
  const server = await startFixtureServer({ '/one': (_req, res) => json(res, 500, { ok: false, name: 'x' }) });
  const source = 'test "S"\n  run 3 iterations across 1 users\n  api GET /one as "one"\n  check status equals 200\n  check body.name equals "expected"\n  threshold error rate is less than 100%\n';
  const { program } = parseSource(source);

  const report = await runWorkload(program, testConfig(server.baseUrl), { source });
  const one = report.scenarios[0]!.endpoints.find((e) => e.identity === 'one')!;

  // Counted with `++` this would be 6 failures against 3 requests — a 200 % endpoint error rate.
  assert.equal(one.metrics.failures, 3, `one request, at most one failure: got ${one.metrics.failures}`);
  assert.equal(one.metrics.iterations, 3);
  assert.equal(one.metrics.errorRate, 1);

  await server.close();
});

test('M89a: the successful-only population survives the shard IPC boundary — a sharded run agrees with a single-process one', async () => {
  const server = await startFixtureServer(mixedServer(4, 60));
  const source = 'test "S"\n  run 24 iterations across 4 users\n  api GET /mix as "mix"\n  expect status equals 200\n  threshold p95 duration is less than 30ms\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const shards = [await runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }), await runLoadShard(program, config, { source, shard: { index: 1, count: 2 } })];
  const merged = mergeLoadShardReports(program, shards, { startedAt: new Date().toISOString(), durationMs: 1000, seed: 42, now: new Date().toISOString() });
  const s = merged.scenarios[0]!;

  assert.equal(s.metrics.failures + s.metrics.successful.iterations, s.metrics.iterations, 'the invariant holds after a merge too');
  assert.ok(s.metrics.successful.iterations > 0, 'some iterations must have succeeded for this to be a real comparison');
  // The merged population must be the *merged samples*, not a parent-side reconstruction from
  // counts — a reconstruction would put the threshold on a distribution no shard ever measured.
  assert.ok(s.metrics.successful.durations.p95 >= 30, `merged successful-only p95 should clear 30ms, got ${s.metrics.successful.durations.p95}`);
  assert.equal(s.thresholds[0]!.ok, false, JSON.stringify(s.thresholds[0]));
  const mix = s.endpoints.find((e) => e.identity === 'mix')!;
  assert.equal(mix.metrics.failures + mix.metrics.successful.iterations, mix.metrics.iterations, 'and at endpoint scope across the merge');

  await server.close();
});

// ---- M89b (`B3-03`, D-M89-4): `workloadOf` maps 10 AST kinds onto 5 report shapes -------------
//
// The unit-level half of the CLI e2e test that runs all 10 for real. Table-driven over the
// *source text*, not over hand-built AST nodes, so a grammar change that stops producing one of
// these kinds fails here rather than passing against a node the parser no longer emits.

/** Parses one workload-bearing test and hands back its report-side workload. */
function workloadFrom(decl: string): ReturnType<typeof workloadOf> {
  const source = `test "W"\n  ${decl}\n  api GET /health\n  expect status equals 200\n`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `\`${decl}\` did not parse`);
  const workload = program.tests[0]!.workload;
  assert.ok(workload, `\`${decl}\` produced no workload`);
  return workloadOf(workload);
}

test('`workloadOf` maps every workload kind onto its own report shape, losslessly', () => {
  assert.deepEqual(workloadFrom('ramp to 3 users over 200ms'), { shape: 'ramp', model: 'closed', target: 3, overMs: 200 });
  assert.deepEqual(workloadFrom('ramp to 40 rps over 400ms'), { shape: 'ramp', model: 'open', target: 40, overMs: 400 });
  assert.deepEqual(workloadFrom('hold 3 users for 200ms'), { shape: 'hold', model: 'closed', target: 3, forMs: 200 });
  assert.deepEqual(workloadFrom('hold 40 rps for 400ms'), { shape: 'hold', model: 'open', target: 40, forMs: 400 });
  assert.deepEqual(workloadFrom('step users\n    to 2 for 100ms\n    to 5 for 150ms'), {
    shape: 'step',
    model: 'closed',
    stages: [{ target: 2, durationMs: 100 }, { target: 5, durationMs: 150 }],
  });
  assert.deepEqual(workloadFrom('step rps\n    to 20 for 100ms\n    to 50 for 150ms'), {
    shape: 'step',
    model: 'open',
    stages: [{ target: 20, durationMs: 100 }, { target: 50, durationMs: 150 }],
  });
  assert.deepEqual(workloadFrom('spike users\n    hold 1 for 100ms\n    to 5 over 150ms'), {
    shape: 'spike',
    model: 'closed',
    stages: [{ target: 1, durationMs: 100, ramped: false }, { target: 5, durationMs: 150, ramped: true }],
  });
  assert.deepEqual(workloadFrom('spike rps\n    hold 10 for 100ms\n    to 50 over 150ms'), {
    shape: 'spike',
    model: 'open',
    stages: [{ target: 10, durationMs: 100, ramped: false }, { target: 50, durationMs: 150, ramped: true }],
  });
  assert.deepEqual(workloadFrom('run 17 iterations across 4 users'), { shape: 'iterations', iterations: 17, vus: 4, perVu: false });
  assert.deepEqual(workloadFrom('run 17 iterations per user across 4 users'), { shape: 'iterations', iterations: 17, vus: 4, perVu: true });
});

test('workloads that used to serialize identically no longer do', () => {
  // Each pair produced byte-identical report data under the old flat `{ kind, target, overMs }`:
  // the peak and the total span were all it kept, and the count-based kinds kept neither.
  const pairs: readonly (readonly [string, string])[] = [
    ['ramp to 4 users over 300ms', 'hold 4 users for 300ms'],
    ['step users\n    to 2 for 150ms\n    to 6 for 150ms', 'spike users\n    hold 2 for 150ms\n    to 6 over 150ms'],
    ['run 4 iterations across 4 users', 'run 4 iterations per user across 4 users'],
  ];
  for (const [a, b] of pairs) {
    assert.notDeepEqual(workloadFrom(a), workloadFrom(b), `\`${a}\` and \`${b}\` still report the same thing`);
  }
});

// ---- `M146b`: the numbers stop being true of the instrument only ------------------------------
//
// `B3-17` and `B3-20` are two ways for a load report to describe tflw rather than the target. The
// first: a scenario that asserts nothing still reports a p95 and an error rate, and both measure
// only whether a request left the machine and came back — the report has never said how many
// assertions it made, so a workload with zero and one with fifty are indistinguishable in it. The
// second: a reactive 401 re-establish sends real requests whose latencies land in no bucket at all.

test('a workload reports how many assertions its iterations actually made (`B3-17`)', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });

  const bare = 'test "Unasserted"\n  hold 2 users for 200ms\n  api GET /x\n  threshold error rate is less than 1%\n';
  const bareReport = await runWorkload(parseSource(bare).program, testConfig(server.baseUrl), { source: bare });
  const bareMetrics = bareReport.scenarios[0]!.metrics;
  assert.ok(bareMetrics.iterations > 0, 'the scenario has to have run for the count to mean anything');
  assert.equal(bareMetrics.assertions, 0, 'a scenario with no `expect`/`check` asserted nothing, and the report must say so rather than leaving it unsaid');

  const asserted = 'test "Asserted"\n  hold 2 users for 200ms\n  api GET /x\n  expect status equals 200\n  threshold error rate is less than 1%\n';
  const assertedReport = await runWorkload(parseSource(asserted).program, testConfig(server.baseUrl), { source: asserted });
  const assertedMetrics = assertedReport.scenarios[0]!.metrics;
  assert.equal(assertedMetrics.assertions, assertedMetrics.iterations, 'one `expect` per iteration, so the count is the iteration count');

  await server.close();
});

test('a `check` counts as an assertion too — the soft one is still an assertion (`B3-17`)', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Soft"\n  hold 2 users for 200ms\n  api GET /x\n  check status equals 200\n  check body.ok equals true\n';
  const report = await runWorkload(parseSource(source).program, testConfig(server.baseUrl), { source });
  const m = report.scenarios[0]!.metrics;
  assert.equal(m.assertions, m.iterations * 2, 'both `check` lines count, every iteration');
  await server.close();
});

test('an endpoint-scope metrics object reports `assertions: null`, never 0 (`B3-17`, `D-M89-1`’s distinction)', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "Scoped"\n  hold 2 users for 200ms\n  api GET /x as "x"\n  expect status equals 200\n';
  const report = await runWorkload(parseSource(source).program, testConfig(server.baseUrl), { source });
  const endpoint = report.scenarios[0]!.endpoints.find((e) => e.identity === 'x');
  assert.ok(endpoint, 'the tagged endpoint has its own report');
  assert.equal(
    endpoint.metrics.assertions,
    null,
    'an `expect` names no endpoint — attributing it to the preceding `api` would be a guess, and `0` would read as "measured zero assertions here", which is a different and false claim',
  );
  assert.ok(endpoint.metrics.iterations > 0, 'the rest of the endpoint metrics are unaffected');
  await server.close();
});

test('a reactive 401 re-establish attributes its login requests to their own endpoint (`B3-20`)', async () => {
  let logins = 0;
  let token = 'tok-1';
  let calls = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      logins++;
      token = `tok-${logins}`;
      json(res, 200, { token });
    },
    '/health': (req, res) => {
      calls++;
      // One-use token: the first call after each login succeeds, every later one 401s until the
      // session is re-established. That is the shape the row was filed against — a reactive
      // re-login inside the VU loop, not the once-before-the-loop establishment.
      const ok = req.headers['authorization'] === `Bearer ${token}` && calls % 2 === 1;
      json(res, ok ? 200 : 401, {});
    },
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /auth/login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const config = resolveConfig(parsedConfig.config, selectEnv(parsedConfig.config, {}));

  const source = 'test "Stale" as admin\n  hold 2 users for 400ms\n  api GET /health\n  expect status equals 200\n';
  const report = await runWorkload(parseSource(source).program, config, { source });

  assert.ok(logins > 1, `the fixture has to have forced at least one reactive re-login, got ${logins}`);
  const endpoints = report.scenarios[0]!.endpoints;
  const login = endpoints.find((e) => e.identity === 'POST /auth/login');
  assert.ok(
    login,
    `the login requests the re-establish actually sent must land in their own bucket; got only ${JSON.stringify(endpoints.map((e) => e.identity))}`,
  );
  assert.ok(login.metrics.iterations > 0, 'and carry real samples, not a zero-sample placeholder');
  await server.close();
});

test('the login bucket is additional, not a replacement — the scenario’s own endpoints keep their samples (`B3-20`)', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok' }),
    '/health': (req, res) => json(res, req.headers['authorization'] === 'Bearer tok' ? 200 : 401, {}),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /auth/login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  const config = resolveConfig(parsedConfig.config, selectEnv(parsedConfig.config, {}));
  const source = 'test "Steady" as admin\n  hold 2 users for 200ms\n  api GET /health\n  expect status equals 200\n';
  const report = await runWorkload(parseSource(source).program, config, { source });

  const health = report.scenarios[0]!.endpoints.find((e) => e.identity === 'GET /health');
  assert.ok(health && health.metrics.iterations > 0, 'the declared endpoint is still first-class');
  assert.equal(
    report.scenarios[0]!.endpoints.filter((e) => e.identity === 'POST /auth/login').length,
    0,
    'no reactive re-establish happened here, so no login bucket appears — the bucket is evidence of a real request, never a slot reserved in advance',
  );
  await server.close();
});
