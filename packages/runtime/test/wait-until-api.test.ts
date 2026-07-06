// M2: `wait until api` re-issues the request until its nested expects pass or wait times out
// (P#15, SPEC §5.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('polls until the nested expects pass, then continues the test', async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      json(res, 200, { status: calls >= 3 ? 'shipped' : 'pending' });
    },
  });

  const source = `test "waits for shipment"
  wait until api GET /poll
    expect body.status equals "shipped"
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.ok(calls >= 3);
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /passed after 3 attempts/);

  await server.close();
});

test('times out and fails the test when the condition never holds', async () => {
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "never ships"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 500 }), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /timed out after 500ms/);

  await server.close();
});

test('a hanging single poll fails close to the wait deadline, not the full request timeout (decision 67)', async () => {
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      setTimeout(() => json(res, 200, { status: 'shipped' }), 5000);
    },
  });

  const source = `test "endpoint hangs"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl, { wait: 300, step: 30000 });

  const startedAt = performance.now();
  const { report } = await runProgram(program, config, { source });
  const elapsed = performance.now() - startedAt;

  assert.equal(report.ok, false);
  // Bounded well under the 30s step timeout — proves the poll's own request timeout was clamped to
  // the remaining wait budget instead of the much larger `timeouts.step` default.
  assert.ok(elapsed < 3000, `expected to fail quickly, took ${elapsed}ms`);

  await server.close();
});
