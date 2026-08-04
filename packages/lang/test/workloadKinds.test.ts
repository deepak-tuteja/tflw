// Phase 1b (PLAN_UNIFIED_TEST_WORKLOAD.md D97/D98/D102): the 4 new workload kinds added alongside
// `ramp` — `hold` (steady-state), `step`/`spike` (stage lists), and the two iteration-count forms
// (`run … iterations across … users` / `run … iterations per user across … users`). Each supports
// both a closed (`users`) and open (`rps`) variant per D98, except the count-based kinds which
// only ever count VUs (D97 doesn't define an rps flavor for them).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkWorkloadTests } from '../src/index.js';

function parseWorkloadTest(source: string) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  assert.equal(program.tests.length, 1, 'expected exactly one test');
  const t = program.tests[0]!;
  assert.ok(t.workload, 'expected a workload-bearing test');
  return t;
}

// -- `hold` ------------------------------------------------------------------------------------

test('`hold N users for <dur>` parses as HoldUsersWorkload', () => {
  const t = parseWorkloadTest('test "S"\n  hold 30 users for 20s\n  api GET /health\n');
  assert.deepEqual(t.workload, { ...t.workload, type: 'HoldUsersWorkload', users: 30, forMs: 20_000 });
});

test('`hold N rps for <dur>` parses as HoldRpsWorkload', () => {
  const t = parseWorkloadTest('test "S"\n  hold 100 rps for 1m\n  api GET /health\n');
  assert.deepEqual(t.workload, { ...t.workload, type: 'HoldRpsWorkload', rps: 100, forMs: 60_000 });
});

test('`hold` with a non-positive target is a parse error', () => {
  const { diagnostics } = parseSource('test "S"\n  hold 0 users for 10s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

// -- `step` ------------------------------------------------------------------------------------

test('`step users` with a single `to N for <dur>` stage parses as StepUsersWorkload', () => {
  const t = parseWorkloadTest('test "S"\n  step users\n    to 10 for 10s\n  api GET /health\n');
  assert.deepEqual(t.workload, {
    ...t.workload,
    type: 'StepUsersWorkload',
    stages: [{ ...(t.workload as { stages: unknown[] }).stages[0]!, type: 'Stage', mode: 'jump', target: 10, durationMs: 10_000 }],
  });
});

test('`step rps` with multiple stages parses each in order as StepRpsWorkload', () => {
  const t = parseWorkloadTest('test "S"\n  step rps\n    to 50 for 10s\n    to 100 for 10s\n    to 150 for 10s\n  api GET /health\n');
  const w = t.workload as { type: string; stages: { mode: string; target: number; durationMs: number }[] };
  assert.equal(w.type, 'StepRpsWorkload');
  assert.deepEqual(
    w.stages.map((s) => ({ mode: s.mode, target: s.target, durationMs: s.durationMs })),
    [
      { mode: 'jump', target: 50, durationMs: 10_000 },
      { mode: 'jump', target: 100, durationMs: 10_000 },
      { mode: 'jump', target: 150, durationMs: 10_000 },
    ],
  );
});

test('a `step` block with no stages is a parse error', () => {
  const { diagnostics } = parseSource('test "S"\n  step users\n  api GET /health\n');
  assert.ok(diagnostics.length > 0, JSON.stringify(diagnostics));
});

test('a `step` stage written with `over` instead of `for` is a parse error (that spelling is `spike`-only)', () => {
  const { diagnostics } = parseSource('test "S"\n  step users\n    to 10 over 10s\n  api GET /health\n');
  assert.ok(diagnostics.length > 0, 'expected a parse diagnostic');
});

// -- `spike` -----------------------------------------------------------------------------------

test('`spike users` with a baseline/ramp-up/hold/ramp-down schedule parses as SpikeUsersWorkload', () => {
  const t = parseWorkloadTest(
    'test "S"\n  spike users\n    hold 5 for 5s\n    to 100 over 5s\n    hold 100 for 10s\n    to 5 over 5s\n  api GET /health\n',
  );
  const w = t.workload as { type: string; stages: { mode: string; target: number; durationMs: number }[] };
  assert.equal(w.type, 'SpikeUsersWorkload');
  assert.deepEqual(
    w.stages.map((s) => ({ mode: s.mode, target: s.target, durationMs: s.durationMs })),
    [
      { mode: 'jump', target: 5, durationMs: 5_000 },
      { mode: 'ramp', target: 100, durationMs: 5_000 },
      { mode: 'jump', target: 100, durationMs: 10_000 },
      { mode: 'ramp', target: 5, durationMs: 5_000 },
    ],
  );
});

test('`spike rps` accepts the same `hold …/to … over …` stage vocabulary', () => {
  const t = parseWorkloadTest('test "S"\n  spike rps\n    to 500 over 10s\n    hold 500 for 5s\n  api GET /health\n');
  assert.equal((t.workload as { type: string }).type, 'SpikeRpsWorkload');
});

test('a `spike` stage line that is neither `hold` nor `to` is a parse error', () => {
  const { diagnostics } = parseSource('test "S"\n  spike users\n    ramp to 5 for 5s\n  api GET /health\n');
  assert.ok(diagnostics.length > 0, 'expected a parse diagnostic');
});

// -- iteration-count forms -----------------------------------------------------------------------

test('`run N iterations across M users` parses as SharedIterationsWorkload', () => {
  const t = parseWorkloadTest('test "S"\n  run 500 iterations across 20 users\n  api GET /health\n');
  assert.deepEqual(t.workload, { ...t.workload, type: 'SharedIterationsWorkload', iterations: 500, vus: 20 });
});

test('`run N iterations per user across M users` parses as PerVuIterationsWorkload', () => {
  const t = parseWorkloadTest('test "S"\n  run 25 iterations per user across 20 users\n  api GET /health\n');
  assert.deepEqual(t.workload, { ...t.workload, type: 'PerVuIterationsWorkload', iterationsPerVu: 25, vus: 20 });
});

test('`run` with a non-positive iteration count is a parse error', () => {
  const { diagnostics } = parseSource('test "S"\n  run 0 iterations across 20 users\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

test('`run` with a non-positive user count is a parse error', () => {
  const { diagnostics } = parseSource('test "S"\n  run 10 iterations across 0 users\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

// -- cross-kind exclusivity + checker (D96/D102) ------------------------------------------------

test('mixing two different workload keywords in one test is a parse error (at most one workload line)', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 1 users over 1s\n  hold 5 users for 10s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033' && /at most one workload line/.test(d.message)), JSON.stringify(diagnostics));
});

test('checkWorkloadTests: `retry` alongside a `hold` workload is flagged (D96 applies to every kind)', () => {
  const { program } = parseSource('test "S" retry 2\n  hold 5 users for 10s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /`retry` can't be combined with a workload/);
});

test('checkWorkloadTests: `pause` is legal inside a `run … iterations …` body (D102 — count-based kinds keep pacing)', () => {
  const { program } = parseSource('test "S"\n  run 10 iterations across 5 users\n  threshold error rate is less than 1%\n  pause 500ms\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: browser steps are still rejected inside a `step`/`spike`/`run` body, same as `ramp` (D19)', () => {
  const { program } = parseSource('test "S"\n  hold 5 users for 10s\n  threshold error rate is less than 1%\n  open "/checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /browser steps aren't supported inside a workload-bearing `test`/);
});

test('checkWorkloadTests: two differently-shaped workload-bearing tests sharing a name is still flagged (uniqueness is kind-agnostic)', () => {
  const { program } = parseSource(
    'test "Same"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n\ntest "Same"\n  hold 5 users for 10s\n  threshold error rate is less than 1%\n  api GET /health\n',
  );
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /duplicate load test name "Same"/);
});
