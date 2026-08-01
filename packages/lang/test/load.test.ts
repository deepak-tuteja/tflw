// M29/M30 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26/D28/D29): `scenario`/`threshold`/`ramp`/
// `think` grammar plus the load-arc's semantic checks (`checkScenarios`, TF033) — a file may
// declare any number of `scenario`s (M30 lifted M29's one-per-file restriction) but their names
// must be unique, `think` only legal inside one, no browser steps inside one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkScenarios } from '../src/index.js';

function parseScenario(source: string) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  assert.equal(program.scenarios.length, 1, 'expected exactly one scenario');
  return program.scenarios[0]!;
}

test('a closed `ramp to N users over <dur>` workload parses as RampUsersWorkload', () => {
  const scenario = parseScenario('scenario "Checkout burst"\n  ramp to 50 users over 30s\n  api GET /health\n');
  assert.deepEqual(scenario.workload, { ...scenario.workload, type: 'RampUsersWorkload', users: 50, overMs: 30_000 });
});

test('an open `ramp to N rps over <dur>` workload parses as RampRpsWorkload', () => {
  const scenario = parseScenario('scenario "Checkout burst"\n  ramp to 200 rps over 1m\n  api GET /health\n');
  assert.deepEqual(scenario.workload, { ...scenario.workload, type: 'RampRpsWorkload', rps: 200, overMs: 60_000 });
});

test('`think <dur>` parses a fixed pacing ThinkStmt (maxMs null)', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  think 2s\n  api GET /health\n');
  const think = scenario.body[0] as { type: string; minMs: number; maxMs: number | null };
  assert.equal(think.type, 'ThinkStmt');
  assert.equal(think.minMs, 2000);
  assert.equal(think.maxMs, null);
});

test('`think <dur> to <dur>` parses a ranged ThinkStmt', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  think 1s to 3s\n  api GET /health\n');
  const think = scenario.body[0] as { type: string; minMs: number; maxMs: number | null };
  assert.equal(think.minMs, 1000);
  assert.equal(think.maxMs, 3000);
});

test('`think` with a max below its min is a parse error, not a silently-swapped range', () => {
  const { diagnostics } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  think 3s to 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

test('`threshold pNN duration is less than <dur>` parses a duration-percentile threshold', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p95 duration is less than 800ms\n');
  assert.deepEqual(scenario.thresholds, [{ ...scenario.thresholds[0]!, metric: { kind: 'duration', percentile: 95 }, op: 'lessThan', value: 800 }]);
});

test('`threshold error rate is less than N%` parses the percentage as a 0-1 fraction', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold error rate is less than 1%\n');
  assert.deepEqual(scenario.thresholds, [{ ...scenario.thresholds[0]!, metric: { kind: 'errorRate' }, op: 'lessThan', value: 0.01 }]);
});

test('`threshold … is greater than …` parses ThresholdOp `greaterThan`', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p50 duration is greater than 0ms\n');
  assert.equal(scenario.thresholds[0]!.op, 'greaterThan');
});

// -- M43 (D67/D68/D70): `api … as "label"` tag, `threshold … for "label"` scope -------------

test('an `api` step with no `as` clause has a null tag', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  const step = scenario.body[0] as { type: string; tag: unknown };
  assert.equal(step.type, 'ApiStep');
  assert.equal(step.tag, null);
});

test('`api … as "label"` parses a StringLit tag', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n');
  const step = scenario.body[0] as { type: string; tag: { type: string; value: string } | null };
  assert.equal(step.tag?.type, 'StringLit');
  assert.equal(step.tag?.value, 'checkout');
});

test('`api … as "label"` still parses correctly when a body/timeout/without-redirects clause precedes it', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api POST /orders body { x: 1 } timeout 5s without redirects as "checkout"\n');
  const step = scenario.body[0] as { type: string; tag: { value: string } | null; timeoutMs: number; followRedirects: boolean };
  assert.equal(step.tag?.value, 'checkout');
  assert.equal(step.timeoutMs, 5000);
  assert.equal(step.followRedirects, false);
});

test('`wait until api` never parses a tag — `as "label"` there is a syntax error, not silently ignored', () => {
  const { diagnostics } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  wait until api GET /health as "label"\n    expect status equals 200\n');
  assert.ok(diagnostics.length > 0, 'expected a parse diagnostic');
});

test('a threshold with no `for` clause has a null scope', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p95 duration is less than 250ms\n');
  assert.equal(scenario.thresholds[0]!.scope, null);
});

test('`threshold … for "label"` parses a StringLit scope, positioned between the metric and `is`', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n  threshold p95 duration for "checkout" is less than 250ms\n');
  const threshold = scenario.thresholds[0]!;
  assert.equal(threshold.scope?.type, 'StringLit');
  assert.equal(threshold.scope?.value, 'checkout');
  assert.deepEqual(threshold.metric, { kind: 'duration', percentile: 95 });
  assert.equal(threshold.op, 'lessThan');
  assert.equal(threshold.value, 250);
});

test('`threshold error rate for "label" is less than N%` also parses a scope on an errorRate metric', () => {
  const scenario = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n  threshold error rate for "checkout" is less than 1%\n');
  const threshold = scenario.thresholds[0]!;
  assert.equal(threshold.scope?.value, 'checkout');
  assert.deepEqual(threshold.metric, { kind: 'errorRate' });
});

test('a bare `cleanup` line sets ScenarioDecl.cleanup; omitted defaults to false', () => {
  const withCleanup = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  cleanup\n  api GET /health\n');
  assert.equal(withCleanup.cleanup, true);
  const withoutCleanup = parseScenario('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  assert.equal(withoutCleanup.cleanup, false);
});

test('a scenario with no `ramp to …` workload line is a parse error', () => {
  const { diagnostics, program } = parseSource('scenario "S"\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
  assert.equal(program.scenarios.length, 0);
});

test('a second `ramp to …` line in one scenario is a parse error (exactly one workload)', () => {
  const { diagnostics } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  ramp to 2 users over 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});

test('checkScenarios: a second, differently-named `scenario` in one file is not flagged (M30 lifts the one-per-file restriction)', () => {
  const { program, diagnostics } = parseSource(
    'scenario "First"\n  ramp to 1 users over 1s\n  api GET /health\n\nscenario "Second"\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.scenarios.length, 2);
  const diags = checkScenarios(program);
  assert.deepEqual(diags, []);
});

test('checkScenarios: two `scenario`s sharing a name is flagged (TF033, M30/D29) — the first is not, the second points back at it', () => {
  const { program, diagnostics } = parseSource(
    'scenario "Same"\n  ramp to 1 users over 1s\n  api GET /health\n\nscenario "Same"\n  ramp to 2 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.scenarios.length, 2);
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /duplicate scenario name "Same"/);
  assert.deepEqual(diags[0]!.span, program.scenarios[1]!.span);
});

test('checkScenarios: three `scenario`s where only two share a name flags exactly one diagnostic', () => {
  const { program } = parseSource(
    'scenario "A"\n  ramp to 1 users over 1s\n  api GET /health\n\nscenario "B"\n  ramp to 1 users over 1s\n  api GET /health\n\nscenario "A"\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.equal(program.scenarios.length, 3);
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.deepEqual(diags[0]!.span, program.scenarios[2]!.span);
});

test('checkScenarios: `think` inside a plain `test` is flagged (TF033)', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  think 1s\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /`think` is only legal inside a `scenario`/);
});

test('checkScenarios: `think` inside a `before`/`after` hook is flagged (TF033)', () => {
  const { program } = parseSource('before\n  think 1s\ntest "ok"\n  api GET /health\n');
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
});

test('checkScenarios: `think` inside a `scenario` body is not flagged', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  think 1s\n  api GET /health\n');
  const diags = checkScenarios(program);
  assert.deepEqual(diags, []);
});

test('checkScenarios: a browser step directly inside a `scenario` body is flagged (TF033, D19)', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  open "/checkout"\n');
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
  assert.match(diags[0]!.message, /browser steps aren't supported inside a `scenario`/);
});

test('checkScenarios: a UI-locator `expect` inside a `scenario` body is flagged (TF033, D19)', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  expect button "Pay" is visible\n');
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF033');
});

test('checkScenarios: an ordinary API `expect`/`check` inside a `scenario` body is not flagged', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n  expect status equals 200\n  check status equals 200\n');
  const diags = checkScenarios(program);
  assert.deepEqual(diags, []);
});

// -- M43 (D70/D72): `threshold … for "label"` scoping, TF034 --------------------------------

test('checkScenarios: `threshold … for "label"` matching an explicit `as "label"` tag is not flagged (TF034)', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  threshold p95 duration for "checkout" is less than 250ms\n  api POST /orders as "checkout"\n');
  const diags = checkScenarios(program);
  assert.deepEqual(diags, []);
});

test('checkScenarios: `threshold … for "label"` matching an automatic `METHOD path.raw` identity is not flagged (TF034)', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  threshold p95 duration for "GET /health" is less than 250ms\n  api GET /health\n');
  const diags = checkScenarios(program);
  assert.deepEqual(diags, []);
});

test('checkScenarios: `threshold … for "label"` matching no step in the scenario is flagged (TF034)', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  threshold p95 duration for "checkotu" is less than 250ms\n  api POST /orders as "checkout"\n');
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF034');
  assert.match(diags[0]!.message, /for "checkotu"/);
  assert.match(diags[0]!.hint ?? '', /"checkout"/, 'the hint should list the scenario\'s own known identities');
});

test('checkScenarios: a `for "label"` on one scenario does not see another scenario\'s identities (TF034 is per-scenario)', () => {
  const { program } = parseSource(
    'scenario "A"\n  ramp to 1 users over 1s\n  api POST /orders as "checkout"\n\nscenario "B"\n  ramp to 1 users over 1s\n  threshold p95 duration for "checkout" is less than 250ms\n  api GET /health\n',
  );
  const diags = checkScenarios(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF034');
});

test('checkScenarios: an unscoped threshold (no `for` clause) is never flagged by TF034', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  threshold error rate is less than 1%\n  api GET /health\n');
  const diags = checkScenarios(program);
  assert.deepEqual(diags, []);
});

test('`scenario` is accepted at the top level alongside `test`/`action` in the same file', () => {
  const { program, diagnostics } = parseSource(
    'test "functional"\n  api GET /health\n\nscenario "load"\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests.length, 1);
  assert.equal(program.scenarios.length, 1);
});

test('a workload target of 0 (or negative) is a parse error', () => {
  const { diagnostics } = parseSource('scenario "S"\n  ramp to 0 users over 1s\n  api GET /health\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), JSON.stringify(diagnostics));
});
