// M29/M30 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26/D28/D29), M50 (PLAN_UNIFIED_TEST_
// WORKLOAD.md D93-D96/D103): `threshold`/`ramp`/`think` grammar plus the load-arc's semantic
// checks (`checkWorkloadTests`, TF033) — a file may declare any number of workload-bearing `test`
// blocks (M30 lifted M29's one-per-file restriction on what was then `scenario`) but their names
// must be unique, `think` only legal inside one, no browser steps inside one. M50 collapsed the
// standalone `scenario` keyword/AST node into an ordinary `test` block with a non-null `workload`
// — kind is inferred from the presence of a `ramp to …` line, not a separate keyword.

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

test('a closed `ramp to N users over <dur>` workload parses as RampUsersWorkload', () => {
  const t = parseWorkloadTest('test "Checkout burst"\n  ramp to 50 users over 30s\n  api GET /health\n');
  assert.deepEqual(t.workload, { ...t.workload, type: 'RampUsersWorkload', users: 50, overMs: 30_000 });
});

test('an open `ramp to N rps over <dur>` workload parses as RampRpsWorkload', () => {
  const t = parseWorkloadTest('test "Checkout burst"\n  ramp to 200 rps over 1m\n  api GET /health\n');
  assert.deepEqual(t.workload, { ...t.workload, type: 'RampRpsWorkload', rps: 200, overMs: 60_000 });
});

test('`think <dur>` parses a fixed pacing ThinkStmt (maxMs null)', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  think 2s\n  api GET /health\n');
  const think = t.body[0] as { type: string; minMs: number; maxMs: number | null };
  assert.equal(think.type, 'ThinkStmt');
  assert.equal(think.minMs, 2000);
  assert.equal(think.maxMs, null);
});

test('`think <dur> to <dur>` parses a ranged ThinkStmt', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  think 1s to 3s\n  api GET /health\n');
  const think = t.body[0] as { type: string; minMs: number; maxMs: number | null };
  assert.equal(think.minMs, 1000);
  assert.equal(think.maxMs, 3000);
});

test('`think` with a max below its min is a parse error, not a silently-swapped range', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 1 users over 1s\n  think 3s to 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

test('`threshold pNN duration is less than <dur>` parses a duration-percentile threshold', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p95 duration is less than 800ms\n');
  assert.deepEqual(t.thresholds, [{ ...t.thresholds[0]!, metric: { kind: 'duration', percentile: 95 }, op: 'lessThan', value: 800 }]);
});

test('`threshold error rate is less than N%` parses the percentage as a 0-1 fraction', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold error rate is less than 1%\n');
  assert.deepEqual(t.thresholds, [{ ...t.thresholds[0]!, metric: { kind: 'errorRate' }, op: 'lessThan', value: 0.01 }]);
});

test('`threshold … is greater than …` parses ThresholdOp `greaterThan`', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p50 duration is greater than 0ms\n');
  assert.equal(t.thresholds[0]!.op, 'greaterThan');
});

// -- M43 (D67/D68/D70): `api … as "label"` tag, `threshold … for "label"` scope -------------

test('an `api` step with no `as` clause has a null tag', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  const step = t.body[0] as { type: string; tag: unknown };
  assert.equal(step.type, 'ApiStep');
  assert.equal(step.tag, null);
});

test('`api … as "label"` parses a StringLit tag', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n');
  const step = t.body[0] as { type: string; tag: { type: string; value: string } | null };
  assert.equal(step.tag?.type, 'StringLit');
  assert.equal(step.tag?.value, 'checkout');
});

test('`api … as "label"` still parses correctly when a body/timeout/without-redirects clause precedes it', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api POST /orders body { x: 1 } timeout 5s without redirects as "checkout"\n');
  const step = t.body[0] as { type: string; tag: { value: string } | null; timeoutMs: number; followRedirects: boolean };
  assert.equal(step.tag?.value, 'checkout');
  assert.equal(step.timeoutMs, 5000);
  assert.equal(step.followRedirects, false);
});

test('`wait until api` never parses a tag — `as "label"` there is a syntax error, not silently ignored', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 1 users over 1s\n  wait until api GET /health as "label"\n    expect status equals 200\n');
  assert.ok(diagnostics.length > 0, 'expected a parse diagnostic');
});

test('a threshold with no `for` clause has a null scope', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p95 duration is less than 250ms\n');
  assert.equal(t.thresholds[0]!.scope, null);
});

test('`threshold … for "label"` parses a StringLit scope, positioned between the metric and `is`', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n  threshold p95 duration for "checkout" is less than 250ms\n');
  const threshold = t.thresholds[0]!;
  assert.equal(threshold.scope?.type, 'StringLit');
  assert.equal(threshold.scope?.value, 'checkout');
  assert.deepEqual(threshold.metric, { kind: 'duration', percentile: 95 });
  assert.equal(threshold.op, 'lessThan');
  assert.equal(threshold.value, 250);
});

test('`threshold error rate for "label" is less than N%` also parses a scope on an errorRate metric', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n  threshold error rate for "checkout" is less than 1%\n');
  const threshold = t.thresholds[0]!;
  assert.equal(threshold.scope?.value, 'checkout');
  assert.deepEqual(threshold.metric, { kind: 'errorRate' });
});

test('a bare `cleanup` line sets TestDecl.cleanup; omitted defaults to false', () => {
  const withCleanup = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  cleanup\n  api GET /health\n');
  assert.equal(withCleanup.cleanup, true);
  const withoutCleanup = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  assert.equal(withoutCleanup.cleanup, false);
});

test('a `test` with no `ramp to …` line parses fine, as an ordinary functional test (workload null)', () => {
  const { program, diagnostics } = parseSource('test "S"\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 1);
  assert.equal(program.tests[0]!.workload, null);
});

test('a second `ramp to …` line in one test is a parse error (at most one workload)', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 1 users over 1s\n  ramp to 2 users over 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

test('checkWorkloadTests: a second, differently-named workload-bearing test in one file is not flagged (M30 lifts the one-per-file restriction)', () => {
  const { program, diagnostics } = parseSource(
    'test "First"\n  ramp to 1 users over 1s\n  api GET /health\n\ntest "Second"\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 2);
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: two workload-bearing tests sharing a name is flagged (TF033, M30/D29) — the first is not, the second points back at it', () => {
  const { program, diagnostics } = parseSource(
    'test "Same"\n  ramp to 1 users over 1s\n  api GET /health\n\ntest "Same"\n  ramp to 2 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 2);
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /duplicate load test name "Same"/);
  assert.deepEqual(diags[0]!.span, program.tests[1]!.span);
});

test('checkWorkloadTests: a functional test sharing a name with a workload-bearing test is not flagged (D93 — only workload-bearing names are keyed)', () => {
  const { program } = parseSource('test "Same"\n  api GET /health\n\ntest "Same"\n  ramp to 1 users over 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: three workload-bearing tests where only two share a name flags exactly one diagnostic', () => {
  const { program } = parseSource(
    'test "A"\n  ramp to 1 users over 1s\n  api GET /health\n\ntest "B"\n  ramp to 1 users over 1s\n  api GET /health\n\ntest "A"\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.equal(program.tests.length, 3);
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.deepEqual(diags[0]!.span, program.tests[2]!.span);
});

test('checkWorkloadTests: `think` inside a plain functional `test` is flagged (TF033)', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  think 1s\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`think` is only legal inside a workload-bearing `test`/);
});

test('checkWorkloadTests: `think` inside a `before`/`after` hook is flagged (TF033)', () => {
  const { program } = parseSource('before\n  think 1s\ntest "ok"\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
});

test('checkWorkloadTests: `think` inside a workload-bearing test body is not flagged', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  think 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: a browser step directly inside a workload-bearing test body is flagged (TF033, D19)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  open "/checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /browser steps aren't supported inside a workload-bearing `test`/);
});

test('checkWorkloadTests: a UI-locator `expect` inside a workload-bearing test body is flagged (TF033, D19)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  expect button "Pay" is visible\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
});

test('checkWorkloadTests: an ordinary API `expect`/`check` inside a workload-bearing test body is not flagged', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n  expect status equals 200\n  check status equals 200\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

// -- M50 (D96): `retry`/`with each` can't coexist with a workload -----------------------------

test('checkWorkloadTests: `retry N` alongside a workload is flagged (D96)', () => {
  const { program } = parseSource('test "S" retry 2\n  ramp to 1 users over 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`retry` can't be combined with a workload/);
});

test('checkWorkloadTests: `with each` alongside a workload is flagged (D96)', () => {
  const { program } = parseSource('with each\n  | n |\n  | 1 |\ntest "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`with each` can't be combined with a workload/);
});

test('checkWorkloadTests: `retry`/`with each` on a plain functional test is never flagged', () => {
  const { program } = parseSource('test "ok" retry 2\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

// -- Phase 2b (D105-D107/D112): `parallel`/`sequential` is orthogonal to D96 -------------------

test('checkWorkloadTests: `parallel` alongside a workload is never flagged (D112 — orthogonal to D96)', () => {
  const { program } = parseSource('test "S" parallel\n  ramp to 1 users over 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: `sequential` alongside a workload is never flagged', () => {
  const { program } = parseSource('test "S" sequential\n  ramp to 1 users over 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

// -- M43 (D70/D72): `threshold … for "label"` scoping, TF034 --------------------------------

test('checkWorkloadTests: `threshold … for "label"` matching an explicit `as "label"` tag is not flagged (TF034)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold p95 duration for "checkout" is less than 250ms\n  api POST /orders as "checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: `threshold … for "label"` matching an automatic `METHOD path.raw` identity is not flagged (TF034)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold p95 duration for "GET /health" is less than 250ms\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: `threshold … for "label"` matching no step in the test is flagged (TF034)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold p95 duration for "checkotu" is less than 250ms\n  api POST /orders as "checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF034');
  assert.match(diags[0]!.message, /for "checkotu"/);
  assert.match(diags[0]!.hint ?? '', /"checkout"/, 'the hint should list the test\'s own known identities');
});

test('checkWorkloadTests: a `for "label"` on one workload-bearing test does not see another one\'s identities (TF034 is per-test)', () => {
  const { program } = parseSource(
    'test "A"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n\ntest "B"\n  ramp to 1 users over 1s\n  threshold p95 duration for "checkout" is less than 250ms\n  api GET /health\n',
  );
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF034');
});

test('checkWorkloadTests: an unscoped threshold (no `for` clause) is never flagged by TF034', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

// -- M50 (D93/D103): `scenario` itself is gone -----------------------------------------------

test('a workload-bearing test is accepted at the top level alongside a plain functional test in the same file', () => {
  const { program, diagnostics } = parseSource(
    'test "functional"\n  api GET /health\n\ntest "load"\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 2);
  assert.equal(program.tests[0]!.workload, null);
  assert.ok(program.tests[1]!.workload);
});

test('a bare `scenario` keyword produces the TF033 migration-hint diagnostic, not a generic parse error', () => {
  const { diagnostics } = parseSource('scenario "load"\n  ramp to 1 users over 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033' && /`scenario` was removed/.test(d.message)), JSON.stringify(diagnostics));
});

test('a workload target of 0 (or negative) is a parse error', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 0 users over 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});
