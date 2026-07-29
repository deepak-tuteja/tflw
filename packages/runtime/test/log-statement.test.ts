// `log` statement (M27, PLAN_LOG.md decisions 113-122): a `log` step always succeeds, its message
// interpolates `{var}` like every other string-bearing step, its level defaults to `info`, and its
// *effective* destination is the statement's own `to …` clause when given, else the resolved
// config's `logDestination` — always recorded in `report.tests[].steps` regardless of that
// destination (structured output stays complete; only rendering filters, decisions 119/122).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { testConfig } from './support.js';

const BASE_URL = 'http://localhost:1'; // never dialed — no `api` step in these sources

test('a bare `log "…"` step always succeeds, defaults to level info, and falls back to the config destination', async () => {
  const source = 'test "ok"\n  log "order created"\n';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(BASE_URL), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const step = report.tests[0]!.steps.find((s) => s.kind === 'log')!;
  assert.equal(step.ok, true);
  assert.equal(step.level, 'info');
  assert.equal(step.destination, 'both'); // testConfig's default logDestination
  assert.equal(step.detail, 'order created');
});

test('`log warn "…"` carries its own level through to the StepResult', async () => {
  const source = 'test "ok"\n  log warn "stock low"\n';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(BASE_URL), { source });

  const step = report.tests[0]!.steps.find((s) => s.kind === 'log')!;
  assert.equal(step.level, 'warn');
  assert.equal(step.detail, 'stock low');
});

test('`{var}` interpolation resolves a bound variable into the log message', async () => {
  const source = 'test "ok"\n  let orderId = 42\n  log "order {orderId} created"\n';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(BASE_URL), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const step = report.tests[0]!.steps.find((s) => s.kind === 'log')!;
  assert.equal(step.detail, 'order 42 created');
});

test('an explicit `to console` always wins over the resolved config destination', async () => {
  const source = 'test "ok"\n  log "msg" to console\n';
  const { program } = parseSource(source);
  const config = { ...testConfig(BASE_URL), logDestination: 'html' as const };
  const { report } = await runProgram(program, config, { source });

  const step = report.tests[0]!.steps.find((s) => s.kind === 'log')!;
  assert.equal(step.destination, 'console');
});

test('a bare `log "…"` (no `to` clause) falls back to the resolved config destination', async () => {
  const source = 'test "ok"\n  log "msg"\n';
  const { program } = parseSource(source);
  const config = { ...testConfig(BASE_URL), logDestination: 'html' as const };
  const { report } = await runProgram(program, config, { source });

  const step = report.tests[0]!.steps.find((s) => s.kind === 'log')!;
  assert.equal(step.destination, 'html');
});

test('a bare `log "…"` still resolves against a CLI-style `--log-output none` override baked into the config', async () => {
  // `--log-output` (cli.ts) is applied by overriding `ResolvedConfig.logDestination` before
  // `runProgram` is ever called — from the interpreter's point of view this is indistinguishable
  // from an ordinary config value, so exercising it here is exercising the real mechanism.
  const source = 'test "ok"\n  log "msg"\n';
  const { program } = parseSource(source);
  const config = { ...testConfig(BASE_URL), logDestination: 'none' as const };
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const step = report.tests[0]!.steps.find((s) => s.kind === 'log')!;
  // Always recorded regardless of destination (decision 119) — `'none'` only ever means "no
  // renderer should show this," never "don't run/record it."
  assert.equal(step.destination, 'none');
  assert.equal(step.ok, true);
});

test('several `log` steps interleave in source order with other step kinds', async () => {
  const source = 'test "ok"\n  log "before"\n  let x = 1\n  log "after, x={x}"\n';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(BASE_URL), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['log', 'let', 'log']);
  assert.equal(report.tests[0]!.steps[2]!.detail, 'after, x=1');
});
