// M29/M30 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26/D28/D29), M50 (PLAN_UNIFIED_TEST_
// WORKLOAD.md D93-D96/D103): `threshold`/`ramp`/`pause` grammar plus the load-arc's semantic
// checks (`checkWorkloadTests`, TF033) — a file may declare any number of workload-bearing `test`
// blocks (M30 lifted M29's one-per-file restriction on what was then `scenario`) but their names
// must be unique, `pause` only legal inside one, no browser steps inside one. M50 collapsed the
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

test('`pause <dur>` parses a fixed pacing PauseStmt (maxMs null)', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  pause 2s\n  api GET /health\n');
  const pause = t.body[0] as { type: string; minMs: number; maxMs: number | null };
  assert.equal(pause.type, 'PauseStmt');
  assert.equal(pause.minMs, 2000);
  assert.equal(pause.maxMs, null);
});

test('`pause <dur> to <dur>` parses a ranged PauseStmt', () => {
  const t = parseWorkloadTest('test "S"\n  ramp to 1 users over 1s\n  pause 1s to 3s\n  api GET /health\n');
  const pause = t.body[0] as { type: string; minMs: number; maxMs: number | null };
  assert.equal(pause.minMs, 1000);
  assert.equal(pause.maxMs, 3000);
});

test('`pause` with a max below its min is a parse error, not a silently-swapped range', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 1 users over 1s\n  pause 3s to 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

// ---- FS-05 (milestone B1): `think` was renamed to `pause` ------------------

test('FS-05: `think` stops parsing and names `pause` outright, rather than leaving a did-you-mean to bridge two words that share no letters', () => {
  const { diagnostics } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  think 2s\n  api GET /health\n');
  const diag = diagnostics.find((d) => d.code === 'TF033');
  assert.ok(diag, `expected a TF033 migration diagnostic, got ${JSON.stringify(diagnostics)}`);
  assert.match(diag!.message, /`think` was renamed to `pause`/);
  assert.match(diag!.message, /pause 2s/);
  assert.match(diag!.hint ?? '', /same semantics and the same workload-only restriction/);
});

test('FS-05: `think` is diagnosed the same way inside a plain functional test — the rename is reported before the workload rule, so the reader fixes one thing at a time', () => {
  const { diagnostics } = parseSource('test "t"\n  think 2s\n  api GET /health\n');
  assert.equal(diagnostics.filter((d) => d.severity !== 'warning').length, 1, JSON.stringify(diagnostics));
  assert.match(diagnostics[0]!.message, /`think` was renamed to `pause`/);
});

test('FS-05: the unknown-step fallback no longer advertises `think` as something a reader may write', () => {
  const { diagnostics } = parseSource('test "t"\n  zzzz 2s\n  api GET /health\n');
  const diag = diagnostics.find((d) => d.code === 'TF011');
  assert.ok(diag, JSON.stringify(diagnostics));
  const help = `${diag!.message} ${diag!.hint ?? ''}`;
  assert.ok(help.includes('pause'), `expected \`pause\` to be offered: ${help}`);
  assert.ok(!/\bthink\b/.test(help), `a retired spelling must not appear in the list of valid steps: ${help}`);
});

test('FS-05: TF033\'s `pause` hint names both ways out — `wait until` for a condition, the JS escape hatch for elapsed time', () => {
  const { program } = parseSource('test "t"\n  pause 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1, JSON.stringify(diags));
  const hint = diags[0]!.hint ?? '';
  // The old hint sent every reader to `wait until …`. That is right for eventual consistency and
  // wrong for the two cases people most often reach for a sleep in — a cache TTL and a token
  // expiry — where elapsed time *is* the thing under test and there is no condition to poll.
  assert.match(hint, /wait until …/);
  assert.match(hint, /wait until … for <dur>/);
  assert.match(hint, /cache TTL/);
  assert.match(hint, /JS escape hatch/);
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
    'test "First"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n\ntest "Second"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 2);
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: two workload-bearing tests sharing a name is flagged (TF033, M30/D29) — the first is not, the second points back at it', () => {
  const { program, diagnostics } = parseSource(
    'test "Same"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n\ntest "Same"\n  ramp to 2 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n',
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
  const { program } = parseSource('test "Same"\n  api GET /health\n\ntest "Same"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: three workload-bearing tests where only two share a name flags exactly one diagnostic', () => {
  const { program } = parseSource(
    'test "A"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n\ntest "B"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n\ntest "A"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n',
  );
  assert.equal(program.tests.length, 3);
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.deepEqual(diags[0]!.span, program.tests[2]!.span);
});

test('checkWorkloadTests: `pause` inside a plain functional `test` is flagged (TF033)', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  pause 1s\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`pause` is only legal inside a workload-bearing `test`/);
});

test('checkWorkloadTests: `pause` inside a `before`/`after` hook is flagged (TF033)', () => {
  const { program } = parseSource('before\n  pause 1s\ntest "ok"\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
});

test('checkWorkloadTests: `pause` inside a workload-bearing test body is not flagged', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  pause 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: a browser step directly inside a workload-bearing test body is flagged (TF033, D19)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  open "/checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /browser steps aren't supported inside a workload-bearing `test`/);
});

test('checkWorkloadTests: a UI-locator `expect` inside a workload-bearing test body is flagged (TF033, D19)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  expect button "Pay" is visible\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
});

test('checkWorkloadTests: an ordinary API `expect`/`check` inside a workload-bearing test body is not flagged', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n  expect status equals 200\n  check status equals 200\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

// -- M50 (D96): `retry`/`with each` can't coexist with a workload -----------------------------

test('checkWorkloadTests: `retry N` alongside a workload is flagged (D96)', () => {
  const { program } = parseSource('test "S" retry 2\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`retry` can't be combined with a workload/);
});

test('checkWorkloadTests: `with each` alongside a workload is flagged (D96)', () => {
  const { program } = parseSource('with each\n  | n |\n  | 1 |\ntest "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
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
  const { program } = parseSource('test "S" parallel\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: `sequential` alongside a workload is never flagged', () => {
  const { program } = parseSource('test "S" sequential\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

// -- M43 (D70/D72): `threshold … for "label"` scoping, TF034 --------------------------------
//
// Each fixture below carries an unscoped `threshold error rate …` it does not otherwise need. That
// line is M89c's doing: a scoped *duration* threshold is still a duration threshold, so without it
// these tests would each raise a second, unrelated TF033 and stop isolating TF034.

test('checkWorkloadTests: `threshold … for "label"` matching an explicit `as "label"` tag is not flagged (TF034)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  threshold p95 duration for "checkout" is less than 250ms\n  api POST /orders as "checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: `threshold … for "label"` matching an automatic `METHOD path.raw` identity is not flagged (TF034)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  threshold p95 duration for "GET /health" is less than 250ms\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.deepEqual(diags, []);
});

test('checkWorkloadTests: `threshold … for "label"` matching no step in the test is flagged (TF034)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  threshold p95 duration for "checkotu" is less than 250ms\n  api POST /orders as "checkout"\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF034');
  assert.match(diags[0]!.message, /for "checkotu"/);
  assert.match(diags[0]!.hint ?? '', /"checkout"/, 'the hint should list the test\'s own known identities');
});

test('checkWorkloadTests: a `for "label"` on one workload-bearing test does not see another one\'s identities (TF034 is per-test)', () => {
  const { program } = parseSource(
    'test "A"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api POST /orders as "checkout"\n\ntest "B"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  threshold p95 duration for "checkout" is less than 250ms\n  api GET /health\n',
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

// -- M60 (A4-01): a workload-bearing test must be able to fail --------------------------------

test('checkWorkloadTests: a workload-bearing test with no `threshold` is flagged (TF033) — it can never fail', () => {
  const { program } = parseSource('test "load no threshold"\n  run 5 iterations across 1 users\n  api GET /nope\n  expect status equals 999\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /has no `threshold`, so it can never fail/);
  assert.match(diags[0]!.hint ?? '', /threshold error rate is less than 1%/, 'the hint must name a threshold that actually parses');
  // The property, not the message: this exact file used to check clean and then report `PASS 1/1`
  // with a 100% error rate. Whatever the wording, it must not be accepted.
  assert.equal(diags[0]!.span.start.line, 1, 'reported on the test declaration');
});

// This test used to read "one `threshold` of any kind satisfies the rule" and assert that a
// lone `threshold p95 duration …` was accepted — M60's own suite encoding `B3-14`, the defect
// M89c closes. The duration case moved to the M89c block below; what survives here is the half
// that was always true.
test('checkWorkloadTests: a lone error-rate threshold satisfies the rule', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  assert.deepEqual(checkWorkloadTests(program), []);
});

test('checkWorkloadTests: a functional test needs no threshold (the rule is workload-only)', () => {
  const { program } = parseSource('test "plain"\n  api GET /health\n  expect status equals 200\n');
  assert.deepEqual(checkWorkloadTests(program), []);
});

// -- M89c (B3-14, D-M89-6): *a* threshold is not a *meaningful* threshold ----------------------
//
// M60 stated its own goal as "a 100 % error rate still reports PASS" and then wrote a rule that
// only requires some threshold to exist. Probing found the goal unmet in two live shapes and one
// stale one:
//
//   1. duration-only, 50 % of requests failing fast → `error rate: 50.00%` printed on the line
//      directly above `✓`, verdict PASS, exit 0. This is `B3-14`.
//   2. duration + an error-rate threshold *scoped* to a healthy endpoint → both thresholds green,
//      50 % scenario error rate, PASS. Requiring merely "an errorRate threshold" would have
//      accepted this, which is why the rule requires the unscoped form.
//   3. duration-only at a *100 %* error rate — the example `B3-14` was filed with — is already
//      caught, by M89a's D-M89-1 (zero successful iterations → `actual: null` → fail), three
//      commits before this one. The row is restated in REVIEW_FINDINGS.md rather than closed on
//      evidence that no longer holds.

test('checkWorkloadTests: a duration threshold with no error-rate threshold is flagged (TF033, M89c)', () => {
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  threshold p95 duration is less than 800ms\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1, JSON.stringify(diags));
  assert.equal(diags[0]!.code, 'TF033');
  assert.equal(diags[0]!.severity, 'error', 'a warning changes no exit code (M60\'s own reasoning)');
  assert.match(diags[0]!.message, /thresholds duration but not error rate/);
  assert.match(diags[0]!.hint ?? '', /threshold error rate is less than 1%/, 'the hint must name a threshold that actually parses');
  // Reported on the misleading line, not on the `test` line: the duration threshold is the thing
  // that looks like coverage and isn't.
  assert.equal(diags[0]!.span.start.line, 3, 'reported on the duration threshold');
});

test('checkWorkloadTests: a *scoped* error-rate threshold does not satisfy the rule (M89c — one side of the branch is not the branch)', () => {
  const { program, diagnostics } = parseSource(
    'test "S"\n  ramp to 1 users over 1s\n  threshold p95 duration is less than 800ms\n  threshold error rate for "ok" is less than 1%\n  api GET /health as "ok"\n  api GET /other as "flaky"\n',
  );
  assert.deepEqual(diagnostics, []);
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1, JSON.stringify(diags));
  assert.equal(diags[0]!.code, 'TF033');
  // The hint has to explain *why* the threshold they already wrote isn't enough, naming it — a
  // bare "add an error-rate threshold" reads as a false negative to someone looking straight at one.
  assert.match(diags[0]!.hint ?? '', /error rate for "ok"/);
  assert.match(diags[0]!.hint ?? '', /only bounds that endpoint's own bucket/);
});

test('checkWorkloadTests: an unscoped error-rate threshold alongside a scoped one satisfies the rule (M89c)', () => {
  const { program } = parseSource(
    'test "S"\n  ramp to 1 users over 1s\n  threshold p95 duration is less than 800ms\n  threshold error rate for "ok" is less than 1%\n  threshold error rate is less than 2%\n  api GET /health as "ok"\n',
  );
  assert.deepEqual(checkWorkloadTests(program), [], 'the scoped one is extra detail, not a disqualifier');
});

test('checkWorkloadTests: the no-threshold and duration-only arms never both fire (M89c)', () => {
  // A test with no thresholds has no duration threshold either, so the arms are mutually exclusive
  // by construction. Asserted because "two diagnostics for one mistake" is the failure mode the
  // parser-recovery cluster (C11) spent two milestones undoing.
  const { program } = parseSource('test "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1, JSON.stringify(diags));
  assert.match(diags[0]!.message, /has no `threshold`/);
});

test('checkWorkloadTests: the rule keys off the metric, not the count — many duration thresholds still need one error-rate threshold (M89c)', () => {
  const { program } = parseSource(
    'test "S"\n  ramp to 1 users over 1s\n  threshold p50 duration is less than 100ms\n  threshold p95 duration is less than 800ms\n  threshold p99 duration is less than 2000ms\n  api GET /health\n',
  );
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1, 'one diagnostic for the test, not one per duration threshold');
  assert.equal(diags[0]!.span.start.line, 3, 'reported on the first duration threshold');
});

// -- M60 (A4-02): D18/D19 follow calls into actions --------------------------------------------

test('checkWorkloadTests: `pause` inside an action called from a functional test is flagged at the call site (D18)', () => {
  const { program } = parseSource('action helper()\n  api GET /x\n  pause 2s\n\ntest "t"\n  helper()\n  api GET /x\n  expect status equals 200\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`pause` is only legal inside a workload-bearing `test`/);
  assert.match(diags[0]!.hint ?? '', /`helper` \(line 3\) contains a `pause`/, 'the hint must name the action and the line the `pause` is on');
  // At the call site, not at the `pause`: the action itself is legal under a workload.
  const callLine = program.tests[0]!.body[0]!.span.start.line;
  assert.equal(diags[0]!.span.start.line, callLine);
});

test('checkWorkloadTests: the same action called from a workload-bearing test is never flagged', () => {
  const { program } = parseSource(
    'action helper()\n  api GET /x\n  pause 2s\n\ntest "load"\n  hold 2 users for 1s\n  threshold error rate is less than 1%\n  helper()\n',
  );
  assert.deepEqual(checkWorkloadTests(program), []);
});

test('checkWorkloadTests: a browser step inside an action called from a workload-bearing test is flagged at the call site (D19)', () => {
  const { program } = parseSource(
    'action openIt()\n  open "/"\n  click button "Buy"\n\ntest "load"\n  hold 2 users for 1s\n  threshold error rate is less than 1%\n  openIt()\n  expect status equals 200\n',
  );
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /browser steps aren't supported inside a workload-bearing `test`/);
  assert.match(diags[0]!.hint ?? '', /`openIt` \(line 2\) contains a browser step/);
});

test('checkWorkloadTests: a call in value position (`let x = helper()`) is resolved too, not just a bare call statement', () => {
  const { program } = parseSource('action helper()\n  pause 2s\n  give 1\n\ntest "t"\n  let x = helper()\n  api GET /x\n  expect status equals 200\n');
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /`helper` \(line 2\)/);
});

test('checkWorkloadTests: the ban is transitive through a chain of actions', () => {
  const { program } = parseSource(
    'action inner()\n  pause 2s\n\naction outer()\n  inner()\n\ntest "t"\n  outer()\n  api GET /x\n  expect status equals 200\n',
  );
  const diags = checkWorkloadTests(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /`inner` \(line 2\) contains a `pause`/, 'names the action that actually holds the `pause`, not the one called');
});

test('checkWorkloadTests: a recursive action terminates instead of hanging the checker', () => {
  const { program } = parseSource('action loops()\n  loops()\n\ntest "t"\n  loops()\n  api GET /x\n  expect status equals 200\n');
  assert.deepEqual(checkWorkloadTests(program), []);
});

test('checkWorkloadTests: a call to a name with no matching action (a `use`d JS helper, or a typo) is skipped, not guessed at', () => {
  const { program } = parseSource('test "t"\n  sign payload("x")\n  api GET /x\n  expect status equals 200\n');
  assert.deepEqual(checkWorkloadTests(program), []);
});
