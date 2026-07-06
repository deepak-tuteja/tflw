// M2.5: `check` — identical grammar to `expect`, but soft: records pass/fail and continues,
// failing the test only at the end if any check failed (SPEC §6.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a passing `check` behaves like `expect` when nothing fails', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { name: 'Widget', active: true }) });

  const source = `test "all checks pass"
  api GET /profile
  check body.name equals "Widget"
  check body.active equals true
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.ok(report.tests[0]!.steps.every((s) => s.kind !== 'expect' || s.ok));

  await server.close();
});

test('a failed `check` does not stop the test — later steps still run', async () => {
  const server = await startFixtureServer({
    '/profile': (_req, res) => json(res, 200, { name: 'Widget', email: 'wrong@example.com', active: true }),
    '/audit': (_req, res) => json(res, 201, { ok: true }),
  });

  const source = `test "audits without stopping at the first mismatch"
  api GET /profile
  check body.name equals "Widget"
  check body.email equals "widget@example.com"
  check body.active equals true
  api POST /audit body { seen: true }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  // the whole run failed (a check failed) but every step still executed, including the api call after the checks
  assert.equal(server.received.get('/audit')!.length, 1);
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['api', 'check', 'check', 'check', 'api', 'expect']);
  const checkSteps = report.tests[0]!.steps.filter((s) => s.kind === 'check');
  assert.deepEqual(checkSteps.map((s) => s.ok), [true, false, true]);
  assert.match(report.tests[0]!.error ?? '', /widget@example.com/);

  await server.close();
});

test('multiple failed checks all surface in the test error, not just the first', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { name: 'Gadget', active: false }) });

  const source = `test "two checks fail"
  api GET /profile
  check body.name equals "Widget"
  check body.active equals true
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /Gadget/);
  assert.match(error, /false/);

  await server.close();
});

test('a failing `check` inside an imported action stays soft — later steps still run, test fails only at the end (decision 55)', async () => {
  // Before decision 55, `execCall` treated *any* `!exec.ok` from an action's steps (including
  // accumulated soft-`check` failures) as a hard `RuntimeError`, aborting the caller immediately —
  // silently turning check→expect the moment the check happened to live inside an action.
  const server = await startFixtureServer({
    '/profile': (_req, res) => json(res, 200, { name: 'Widget', email: 'wrong@example.com' }),
    '/audit': (_req, res) => json(res, 201, { ok: true }),
  });

  const source = `action audit profile()
  api GET /profile
  check body.name equals "Widget"
  check body.email equals "widget@example.com"
  capture body.name as n
  give n

test "runs an action with a soft check failure inside, then keeps going"
  let name = audit profile()
  api POST /audit body { seen: true }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false, JSON.stringify(report.tests[0], null, 2));
  assert.equal(server.received.get('/audit')!.length, 1, 'steps after the action call must still run, not abort');
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['api', 'check', 'check', 'capture', 'give', 'call', 'api', 'expect']);
  const checkSteps = report.tests[0]!.steps.filter((s) => s.kind === 'check');
  assert.deepEqual(checkSteps.map((s) => s.ok), [true, false], 'both of the action\'s own checks must be visible, spliced into the caller\'s report');
  assert.equal(
    report.tests[0]!.steps.find((s) => s.kind === 'call')!.ok,
    false,
    'the call step itself is flagged failed too, so a manual QA scanning the timeline sees it at a glance',
  );
  assert.match(report.tests[0]!.error ?? '', /widget@example.com/);

  await server.close();
});

test('a hard `expect` after a passing `check` still fails fast as usual', async () => {
  const server = await startFixtureServer({
    '/profile': (_req, res) => json(res, 200, { name: 'Widget' }),
    '/unreached': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "expect still fails fast"
  api GET /profile
  check body.name equals "Widget"
  expect body.name equals "Something else"
  api GET /unreached
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.equal(server.received.has('/unreached'), false);
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['api', 'check', 'expect']);

  await server.close();
});
