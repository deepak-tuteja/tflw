// Phase 2b (PLAN_UNIFIED_TEST_WORKLOAD.md, D99/D105-D112): `runProgram` now drives a file's
// workload-bearing `test`s too (formerly `runLoad`'s exclusive job), dispatching every test —
// functional and workload alike — through one batched loop keyed by each test's own `concurrency`
// field. These tests cover what `load.test.ts`/`hooks.test.ts` etc. don't: cross-kind batching
// (D109), real concurrent execution for a `parallel` batch (D111), and declaration-order report
// assembly independent of completion order (D112).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram, runLoadShard } from '../src/interpreter.js';
import type { ReportEntry, WorkloadTestResult } from '../src/types.js';
import { startFixtureServer, testConfig, json } from './support.js';

function workloadEntries(tests: readonly ReportEntry[]): WorkloadTestResult[] {
  return tests.filter((t): t is WorkloadTestResult => t.kind === 'workload');
}

// M56 (Phase 3, D116/D117): a workload test's result now lives inline in `report.tests` (tagged
// `kind: 'workload'`) and `selfDiagnosis`/`inconclusive`/`aborted` are top-level `RunReport`
// fields — there's no more separate `loadReport` sibling `runProgram` returns.

test('a file with only functional tests produces no workload entries or selfDiagnosis (unaffected by Phase 2b)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'test "a"\n  api GET /health\n  expect status equals 200\n\ntest "b"\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.equal(report.tests.length, 2);
  assert.equal(workloadEntries(report.tests).length, 0);
  assert.equal(report.selfDiagnosis, undefined);
  await server.close();
});

test('a file mixing functional and workload-bearing tests (all default `sequential`) runs both, in declaration order, in one report', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = [
    'test "functional"',
    '  api GET /health',
    '  expect status equals 200',
    '',
    'test "burst"',
    '  ramp to 3 users over 200ms',
    '  api GET /health',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.equal(report.tests.length, 2);
  assert.equal(report.tests[0]!.name, 'functional');
  assert.equal(report.tests[0]!.kind, 'functional');
  const burst = workloadEntries(report.tests)[0]!;
  assert.equal(burst.name, 'burst');
  assert.ok(burst.metrics.iterations > 0);
  await server.close();
});

test('two `sequential` (default) tests never overlap in wall time', async () => {
  let inFlight = 0;
  let sawOverlap = false;
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      inFlight++;
      if (inFlight > 1) sawOverlap = true;
      setTimeout(() => {
        inFlight--;
        json(res, 200, { ok: true });
      }, 80);
    },
  });
  const source = 'test "a"\n  api GET /slow\n  expect status equals 200\n\ntest "b"\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.equal(sawOverlap, false, 'sequential tests must not run concurrently');
  await server.close();
});

test('two `parallel`-tagged tests actually overlap in wall time (D109/D111)', async () => {
  let inFlight = 0;
  let sawOverlap = false;
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      inFlight++;
      if (inFlight > 1) sawOverlap = true;
      setTimeout(() => {
        inFlight--;
        json(res, 200, { ok: true });
      }, 80);
    },
  });
  const source = 'test "a" parallel\n  api GET /slow\n  expect status equals 200\n\ntest "b" parallel\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const start = Date.now();
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  const elapsedMs = Date.now() - start;

  assert.equal(report.ok, true);
  assert.equal(sawOverlap, true, 'a `parallel` batch must run its members concurrently');
  // Two 80ms requests run concurrently should take much less than 160ms total (sequential would).
  assert.ok(elapsedMs < 150, `expected concurrent execution to finish well under 150ms, took ${elapsedMs}ms`);
  await server.close();
});

test('a `parallel` batch mixing a functional test and a workload-bearing test runs both concurrently', async () => {
  let inFlight = 0;
  let sawOverlap = false;
  const bump = (res: import('node:http').ServerResponse, delayMs: number): void => {
    inFlight++;
    if (inFlight > 1) sawOverlap = true;
    setTimeout(() => {
      inFlight--;
      json(res, 200, { ok: true });
    }, delayMs);
  };
  const server = await startFixtureServer({
    '/burst': (_req, res) => bump(res, 60),
    '/slow': (_req, res) => bump(res, 150),
  });
  const source = [
    'test "functional" parallel',
    '  api GET /slow',
    '  expect status equals 200',
    '',
    'test "burst" parallel',
    '  ramp to 2 users over 150ms',
    '  api GET /burst',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.ok(workloadEntries(report.tests)[0]?.ok);
  assert.ok(sawOverlap, 'the functional test should still be in flight while the workload test iterates');
  await server.close();
});

test('D112: final report order is declaration order, independent of which batch member finishes first', async () => {
  const server = await startFixtureServer({
    '/fast': (_req, res) => json(res, 200, { ok: true }),
    '/slow': (_req, res) => setTimeout(() => json(res, 200, { ok: true }), 100),
  });
  // "first" is declared first but finishes last (slow endpoint); "second" is declared second but
  // finishes first (fast endpoint) — the final report must still list them in declaration order.
  const source = [
    'test "first" parallel',
    '  api GET /slow',
    '  expect status equals 200',
    '',
    'test "second" parallel',
    '  api GET /fast',
    '  expect status equals 200',
  ].join('\n');
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.tests.map((t) => t.name),
    ['first', 'second'],
  );
  await server.close();
});

test('a `with each` test\'s own row-cases stay internally sequential even inside a `parallel` batch', async () => {
  let inFlight = 0;
  let sawOverlap = false;
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      inFlight++;
      if (inFlight > 1) sawOverlap = true;
      setTimeout(() => {
        inFlight--;
        json(res, 200, { ok: true });
      }, 40);
    },
  });
  const source = [
    'with each',
    '  | n |',
    '  | 1 |',
    '  | 2 |',
    'test "rows" parallel',
    '  api GET /slow',
    '  expect status equals 200',
    '',
    'test "solo" parallel',
    '  api GET /slow',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.equal(report.tests.length, 3);
  // "rows" contributes its 2 row-cases contiguously, in declaration order, ahead of "solo" —
  // matching `expandTestCases`' own per-test-decl grouping.
  assert.deepEqual(
    report.tests.map((t) => t.name),
    ['rows', 'rows', 'solo'],
  );
  assert.equal(sawOverlap, true, 'the "rows" batch member should still overlap with "solo" even though its own rows are sequential');
  await server.close();
});

test('a default-`sequential` `with each` group fully finishes (all rows) before its neighbor starts — no overlap either way', async () => {
  let inFlight = 0;
  let sawOverlap = false;
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      inFlight++;
      if (inFlight > 1) sawOverlap = true;
      setTimeout(() => {
        inFlight--;
        json(res, 200, { ok: true });
      }, 40);
    },
  });
  const source = [
    'with each',
    '  | n |',
    '  | 1 |',
    '  | 2 |',
    'test "rows"',
    '  api GET /slow',
    '  expect status equals 200',
    '',
    'test "solo"',
    '  api GET /slow',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.tests.map((t) => t.name),
    ['rows', 'rows', 'solo'],
  );
  // Unlike the `parallel` counterpart above, "rows" and "solo" here are both default `sequential` —
  // each is its own singleton batch (D109), so "rows" (both its cases) must fully finish before
  // "solo" starts, on top of "rows"' own cases already never overlapping each other internally.
  assert.equal(sawOverlap, false, 'a default-`sequential` `with each` group must not overlap its own rows, nor its sequential neighbor');
  await server.close();
});

test('D114: a `parallel` batch buffers each test\'s events and flushes them as one atomic block', async () => {
  const server = await startFixtureServer({
    '/a1': (_req, res) => setTimeout(() => json(res, 200, { ok: true }), 30),
    '/a2': (_req, res) => json(res, 200, { ok: true }),
    '/b1': (_req, res) => json(res, 200, { ok: true }),
    '/b2': (_req, res) => setTimeout(() => json(res, 200, { ok: true }), 30),
  });
  const source = [
    'test "a" parallel',
    '  api GET /a1',
    '  expect status equals 200',
    '  api GET /a2',
    '  expect status equals 200',
    '',
    'test "b" parallel',
    '  api GET /b1',
    '  expect status equals 200',
    '  api GET /b2',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const events: { type: string; test: string }[] = [];
  const { report } = await runProgram(program, testConfig(server.baseUrl), {
    source,
    emit: (ev) => {
      if (ev.type === 'test:start') events.push({ type: 'start', test: ev.name });
      else if (ev.type === 'step:end') events.push({ type: 'step', test: ev.test });
      else if (ev.type === 'test:end') events.push({ type: 'end', test: ev.result.name });
    },
  });

  assert.equal(report.ok, true);
  // Each test's own 6 events (test:start + 4 step:end [2 `api` + 2 `expect`] + test:end) must
  // appear as one contiguous run in the live stream, never split by the other test's events, even
  // though both genuinely ran concurrently (D114) — the final assembled `report.tests` order
  // (D112) is covered separately above.
  for (const name of ['a', 'b']) {
    const indices = events.map((e, i) => (e.test === name ? i : -1)).filter((i) => i >= 0);
    assert.equal(indices.length, 6, `expected 6 events (start + 4 steps + end) for "${name}", got ${JSON.stringify(events)}`);
    const first = indices[0]!;
    const last = indices[indices.length - 1]!;
    assert.equal(last - first + 1, indices.length, `expected "${name}"'s events to be contiguous, got indices ${JSON.stringify(indices)} in ${JSON.stringify(events)}`);
  }
  await server.close();
});

test('a `before file` hook failure runs neither functional nor workload-bearing tests, and produces no workload entry or selfDiagnosis', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = [
    'before file',
    '  api GET /missing',
    '  expect status equals 200',
    '',
    'test "functional"',
    '  api GET /health',
    '  expect status equals 200',
    '',
    'test "burst"',
    '  ramp to 1 users over 100ms',
    '  api GET /health',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.equal(report.tests.length, 1);
  assert.equal(report.tests[0]!.name, 'before file');
  assert.equal(workloadEntries(report.tests).length, 0);
  assert.equal(report.selfDiagnosis, undefined);
  await server.close();
});

// Regression coverage for a bug found while writing the concurrency-model README (docs/CONCURRENCY.md):
// a workload test's ramp/hold/step/spike schedule (`spawnAt`/`runEnd` in `runScenarioTask`) is
// computed from its `ScenarioRunCtx.runStart`. Before this fix, every batch shared the same
// file-global `runStart` stamped once at the top of `runProgramInner` — correct for batch 1 (whose
// members start at essentially that instant, same as pre-Phase-2b `runLoadCore`, where every
// scenario always started together), but wrong for batch 2+: a `sequential` (the default) workload
// test declared after an earlier batch inherited a `runStart` already stale by however long that
// earlier batch took, so its entire ramp/arrival schedule was already in the past the instant it
// started — observed as a hard 0 iterations, not merely degraded metrics.

test('a `sequential` workload test in the second batch still gets its own full iteration count, not 0 (regression)', async () => {
  const server = await startFixtureServer({ '/a': (_req, res) => json(res, 200, { ok: true }), '/b': (_req, res) => json(res, 200, { ok: true }) });
  const source = [
    'test "sceneA"',
    '  ramp to 3 users over 200ms',
    '  api GET /a',
    '  expect status equals 200',
    '',
    'test "sceneB"',
    '  ramp to 3 users over 200ms',
    '  api GET /b',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  const [sceneA, sceneB] = workloadEntries(report.tests);
  assert.ok(sceneA!.ok && sceneB!.ok);
  assert.ok(sceneA!.metrics.iterations > 0, 'the first batch\'s scenario should still iterate as before');
  assert.ok(sceneB!.metrics.iterations > 0, 'a second, later-batch scenario must not be starved by a stale file-global runStart');
  await server.close();
});

test('two default-`sequential` workload tests still never overlap in wall time, even after the per-batch runStart fix', async () => {
  let inFlightA = 0;
  let inFlightB = 0;
  let sawCrossOverlap = false;
  const server = await startFixtureServer({
    '/a': (_req, res) => {
      inFlightA++;
      if (inFlightB > 0) sawCrossOverlap = true;
      setTimeout(() => {
        inFlightA--;
        json(res, 200, { ok: true });
      }, 20);
    },
    '/b': (_req, res) => {
      inFlightB++;
      if (inFlightA > 0) sawCrossOverlap = true;
      setTimeout(() => {
        inFlightB--;
        json(res, 200, { ok: true });
      }, 20);
    },
  });
  const source = [
    'test "sceneA"',
    '  ramp to 3 users over 150ms',
    '  api GET /a',
    '  expect status equals 200',
    '',
    'test "sceneB"',
    '  ramp to 3 users over 150ms',
    '  api GET /b',
    '  expect status equals 200',
  ].join('\n');
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.ok(workloadEntries(report.tests).every((s) => s.ok));
  assert.equal(sawCrossOverlap, false, 'sequential scenarios must still run one after the other, not concurrently');
  await server.close();
});

test('`runLoadShard` (the `--workers N>1` forked-process engine) also batches its scenarios by `parallel`/`sequential`, not one blind `Promise.all` (regression)', async () => {
  const server = await startFixtureServer({ '/a': (_req, res) => json(res, 200, { ok: true }), '/b': (_req, res) => json(res, 200, { ok: true }) });
  const source = [
    'test "sceneA"',
    '  ramp to 3 users over 200ms',
    '  api GET /a',
    '  expect status equals 200',
    '',
    'test "sceneB"',
    '  ramp to 3 users over 200ms',
    '  api GET /b',
    '  expect status equals 200',
  ].join('\n');
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const shardResult = await runLoadShard(program, testConfig(server.baseUrl), { source, shard: { index: 0, count: 1 } });

  const [sceneA, sceneB] = shardResult.scenarios;
  assert.ok(sceneA!.iterations > 0);
  assert.ok(sceneB!.iterations > 0, 'a forked shard must not zero out a later-batch sequential scenario either');
});
