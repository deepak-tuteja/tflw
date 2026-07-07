// M2.5: `retry N` — up to N re-runs on failure; a pass on any attempt is reported `flaky: true`,
// never silently green (SPEC §4.4, P#10). Every attempt reuses the same seed so generated values
// are identical across attempts (a real fixture-server flake, not data-dependent behavior).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a test that fails then passes within its retry budget is reported passed and flaky', async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/flaky': (_req, res) => {
      calls++;
      if (calls < 3) res.writeHead(500).end();
      else json(res, 200, { ok: true });
    },
  });

  const source = `test "eventually works" retry 2
  api GET /flaky
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.equal(report.tests[0]!.flaky, true);
  assert.equal(calls, 3); // failed twice, passed on the 3rd (2 retries used)

  await server.close();
});

test('a test that exhausts its retries still fails, and is not marked flaky', async () => {
  const server = await startFixtureServer({ '/always-down': (_req, res) => res.writeHead(500).end() });

  const source = `test "never recovers" retry 2
  api GET /always-down
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.equal(report.tests[0]!.flaky, undefined);
  assert.equal(server.received.get('/always-down')!.length, 3); // 1 initial + 2 retries

  await server.close();
});

test('a test that passes on the first attempt is not marked flaky, regardless of `retry`', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "clean pass" retry 3
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true);
  assert.equal(report.tests[0]!.flaky, undefined);
  assert.equal(server.received.get('/health')!.length, 1);

  await server.close();
});

test('generated values are identical across retry attempts (same seed replayed, not advanced)', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => res.writeHead(500).end() });

  const source = `test "captures the generated value each attempt" retry 2
  let sku = random like "ORD-####"
  api POST /orders body { sku: {sku} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, seed: 42 });

  assert.equal(report.ok, false); // always 500, exhausts retries
  const received = server.received.get('/orders')!;
  assert.equal(received.length, 3); // 1 initial + 2 retries
  const skus = received.map((r) => JSON.parse(r.body).sku);
  assert.deepEqual(skus, [skus[0], skus[0], skus[0]]); // identical every attempt — same seed replayed

  await server.close();
});

// Decision 59 backfill: the reproducibility guarantees were previously exercised piecemeal
// (`random` under retry above; date generators and session-internal generators got dedicated tests
// in generators.test.ts/sessions.test.ts/the CLI e2e suite as part of decisions 52–53) but nothing
// proved the flip side of `random`'s replay — that `unique`'s run-wide counter *keeps advancing*
// across retry attempts instead of replaying, which is exactly what lets a retried attempt avoid
// colliding with data the failed attempt already created (SPEC §4.4/§7.4).
test('`unique` values advance (never replay) across retry attempts, unlike `random`', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => res.writeHead(500).end() });

  const source = `test "unique keeps advancing across retries" retry 2
  let sku = unique like "ORD-####"
  let orderId = unique("order")
  api POST /orders body { sku: {sku}, orderId: {orderId} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, seed: 42 });

  assert.equal(report.ok, false); // always 500, exhausts retries
  const received = server.received.get('/orders')!;
  assert.equal(received.length, 3); // 1 initial + 2 retries
  const skus = received.map((r) => JSON.parse(r.body).sku);
  const orderIds = received.map((r) => JSON.parse(r.body).orderId);
  assert.equal(new Set(skus).size, 3, '`unique like` must produce a distinct value on every retry attempt, not replay the first');
  assert.equal(new Set(orderIds).size, 3, '`unique("prefix")` must produce a distinct value on every retry attempt, not replay the first');

  await server.close();
});

// PLAN decision 86: a flaky pass's earlier failing evidence used to be silently discarded — only
// the final (kept) attempt's steps ever reached the report. `TestResult.attempts` now carries
// every attempt actually run, so report.html can show the full recovery trail.
test("a flaky pass's report carries every attempt's steps, not just the final one", async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/flaky': (_req, res) => {
      calls++;
      if (calls < 3) res.writeHead(500).end();
      else json(res, 200, { ok: true });
    },
  });

  const source = `test "eventually works" retry 2
  api GET /flaky
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  const attempts = report.tests[0]!.attempts;
  assert.equal(attempts?.length, 3);
  assert.equal(attempts![0]!.ok, false);
  assert.equal(attempts![1]!.ok, false);
  assert.equal(attempts![2]!.ok, true);
  assert.equal(attempts![0]!.attempt, 1);
  assert.equal(attempts![2]!.attempt, 3);
  assert.ok(attempts![0]!.steps.some((s) => s.detail?.includes('500')), 'attempt 1 steps should show the 500 that failed it');
  assert.ok(attempts![1]!.steps.some((s) => s.detail?.includes('500')), 'attempt 2 steps should show the 500 that failed it');
  assert.deepEqual(attempts![2]!.steps, report.tests[0]!.steps, 'the final attempt mirrors the top-level steps field');
  assert.ok(attempts![0]!.error !== undefined);
  assert.ok(attempts![1]!.error !== undefined);
  assert.equal(attempts![2]!.error, undefined);

  await server.close();
});

test('a test that passes on the first attempt has no `attempts` field at all', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "clean pass" retry 3
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.tests[0]!.attempts, undefined);

  await server.close();
});

test('a test that exhausts its retries still records every failed attempt', async () => {
  const server = await startFixtureServer({ '/always-down': (_req, res) => res.writeHead(500).end() });

  const source = `test "never recovers" retry 2
  api GET /always-down
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  const attempts = report.tests[0]!.attempts;
  assert.equal(attempts?.length, 3);
  assert.ok(attempts!.every((a) => a.ok === false));
  assert.deepEqual(attempts![2]!.steps, report.tests[0]!.steps, 'the top-level steps field still mirrors the last attempt, even though it failed');

  await server.close();
});
