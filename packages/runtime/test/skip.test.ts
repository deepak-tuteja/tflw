// `M242` `B` (`D1327`) — a skipped test runs nothing, is reported as its own outcome, and does not
// fail the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a skipped test sends nothing and runs no hook, and the run still passes', async () => {
  let hits = 0;
  const server = await startFixtureServer({ '/': (_req, res) => { hits += 1; json(res, 200, {}); } });
  const src = [
    'before',
    '  api GET /',
    'test "runs"',
    '  api GET /',
    '  expect status equals 200',
    'test "skipped" skip "the upstream is down until the 3rd"',
    '  api GET /',
    '  expect status equals 500',
    '',
  ].join('\n');
  const events: string[] = [];
  const { report } = await runProgram(parseSource(src).program, testConfig(server.baseUrl), { source: src, emit: (e) => events.push(e.type) });
  assert.equal(hits, 2, 'the running test and its hook — nothing for the skipped one');
  assert.equal(report.ok, true, 'a skip is not a failure');
  assert.deepEqual([report.total, report.passed, report.failed, report.skipped], [2, 1, 0, 1]);
  const skipped = report.tests[1]!;
  assert.equal(skipped.kind, 'functional');
  assert.equal(skipped.kind === 'functional' && skipped.skipped, 'the upstream is down until the 3rd');
  assert.equal(skipped.kind === 'functional' && skipped.steps.length, 0);
  assert.equal(events.filter((e) => e === 'test:end').length, 2, 'the skip streams its own end, like any test');
  await server.close();
});

test('a run with no skip keeps its earlier shape — no `skipped` key at all', async () => {
  const server = await startFixtureServer({ '/': (_req, res) => json(res, 200, {}) });
  const src = 'test "t"\n  api GET /\n  expect status equals 200\n';
  const { report } = await runProgram(parseSource(src).program, testConfig(server.baseUrl), { source: src });
  assert.ok(!('skipped' in report));
  assert.ok(!('skipped' in report.tests[0]!));
  await server.close();
});

// `M247` `B` (`D1353`) — `skip … on env`: the same file, run under two envs, skips in one and runs
// in the other. The env is the only thing that differs between the two runs.
test('`skip "…" on env ci` holds under `ci` and runs under `local`, and the skip names its env', async () => {
  let hits = 0;
  const server = await startFixtureServer({ '/': (_req, res) => { hits += 1; json(res, 200, {}); } });
  const src = 'test "refunds settle" skip "no payments sandbox in CI" on env ci, staging\n  api GET /\n  expect status equals 200\n';
  const program = parseSource(src).program;

  const underCi = await runProgram(program, { ...testConfig(server.baseUrl), envName: 'ci' }, { source: src });
  assert.equal(hits, 0, 'nothing is sent where the skip holds');
  const skipped = underCi.report.tests[0]!;
  assert.ok(skipped.kind === 'functional');
  assert.equal(skipped.skipped, 'no payments sandbox in CI (on env ci)');
  assert.equal(skipped.skippedOn, 'ci');
  assert.equal(underCi.report.skipped, 1);

  const underLocal = await runProgram(program, { ...testConfig(server.baseUrl), envName: 'local' }, { source: src });
  assert.equal(hits, 1, 'the same test runs where the skip does not hold');
  const ran = underLocal.report.tests[0]!;
  assert.ok(ran.kind === 'functional');
  assert.equal(ran.ok, true);
  assert.ok(!('skipped' in ran) && !('skippedOn' in ran), 'a test the env skip did not hold for is an ordinary test');
  assert.ok(!('skipped' in underLocal.report));
  await server.close();
});

test('an unconditional skip carries no env, whatever env the run is under', async () => {
  const server = await startFixtureServer({ '/': (_req, res) => json(res, 200, {}) });
  const src = 'test "t" skip "down"\n  api GET /\n';
  const { report } = await runProgram(parseSource(src).program, { ...testConfig(server.baseUrl), envName: 'ci' }, { source: src });
  const t = report.tests[0]!;
  assert.ok(t.kind === 'functional');
  assert.equal(t.skipped, 'down');
  assert.ok(!('skippedOn' in t));
  await server.close();
});
