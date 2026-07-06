// M2.5: `before`/`after` hooks (file + each scope, SPEC §4.2). Design calls made explicit in
// PLAN.md decision 40 / PROGRESS.md's M2.5 section: `before`(each)/`after`(each) share a scope
// with the test they wrap; `before file`/`after file` run once, isolated; cleanup (`after`)
// always runs even on test failure; a failing `before` skips the test body (and `after`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('`before`(each) sets a var the test and its `after` can both see', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 201, { ok: true }),
    '/cleanup': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `before
  let orderId = "seeded-123"

test "uses the before-hook variable"
  api POST /orders body { id: {orderId} }
  expect status equals 201

after
  api POST /cleanup body { id: {orderId} }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const orders = JSON.parse(server.received.get('/orders')![0]!.body);
  assert.equal(orders.id, 'seeded-123');
  const cleanup = JSON.parse(server.received.get('/cleanup')![0]!.body);
  assert.equal(cleanup.id, 'seeded-123');
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['let', 'api', 'expect', 'api', 'expect']);

  await server.close();
});

test('`after`(each) still runs when the test body fails, and can flip a passing test to failed', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 201, { ok: true }),
    '/cleanup': (_req, res) => res.writeHead(500).end(),
  });

  const source = `test "passes, but cleanup fails"
  api POST /orders body { name: "Widget" }
  expect status equals 201

after
  api POST /cleanup
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.equal(server.received.get('/cleanup')!.length, 1);
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['api', 'expect', 'api', 'expect']);
  assert.match(report.tests[0]!.error ?? '', /500/);

  await server.close();
});

test('a failing `before`(each) skips the test body and `after`', async () => {
  const server = await startFixtureServer({
    '/setup': (_req, res) => res.writeHead(500).end(),
    '/orders': (_req, res) => json(res, 201, { ok: true }),
    '/cleanup': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `before
  api GET /setup
  expect status equals 200

test "never runs its own body"
  api POST /orders body { name: "Widget" }
  expect status equals 201

after
  api POST /cleanup
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.equal(server.received.has('/orders'), false);
  assert.equal(server.received.has('/cleanup'), false);
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['api', 'expect']);

  await server.close();
});

test('`before file` runs once and its bindings are isolated from every test\'s own scope', async () => {
  const server = await startFixtureServer({
    '/seed': (_req, res) => json(res, 201, { token: 'file-token' }),
  });

  const source = `before file
  api POST /seed
  expect status equals 201
  capture body.token as fileToken

test "first"
  let localVar = "a"

test "second"
  let localVar = "b"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/seed')!.length, 1); // ran once, not once per test
  assert.equal(report.tests.length, 2);

  await server.close();
});

test('a failing `before file` aborts the whole file — no tests run, reported as its own entry', async () => {
  const server = await startFixtureServer({ '/seed': (_req, res) => res.writeHead(500).end() });

  const source = `before file
  api POST /seed
  expect status equals 201

test "never runs"
  api GET /never-called
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.equal(report.tests.length, 1);
  assert.equal(report.tests[0]!.name, 'before file');
  assert.equal(report.tests[0]!.ok, false);

  await server.close();
});

test('`after file` runs once after every test, and a failure surfaces as its own report entry', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 201, { ok: true }),
    '/teardown': (_req, res) => res.writeHead(500).end(),
  });

  const source = `test "normal test"
  api POST /orders body { name: "Widget" }
  expect status equals 201

after file
  api POST /teardown
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.tests.length, 2);
  assert.equal(report.tests[0]!.name, 'normal test');
  assert.equal(report.tests[0]!.ok, true);
  assert.equal(report.tests[1]!.name, 'after file');
  assert.equal(report.tests[1]!.ok, false);
  assert.equal(report.ok, false);

  await server.close();
});
