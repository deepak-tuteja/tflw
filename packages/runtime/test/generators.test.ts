// M2: `unique`/`random` generators + seeded reproducibility (P#19, P#21–23). `unique` guarantees
// distinctness via a monotonic counter (not randomness); `random` is deterministic per `--seed`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('the same seed reproduces identical `random` values; a different seed changes them', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "gen"
  let qty = random number 1 to 1000000
  let price = random decimal 0 to 100
  let color = random of "red", "blue", "green", "yellow", "purple"
  let token = random string 16
  let code = random like "SKU-####-??"
  api POST /orders body { qty: {qty} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, seed: 42 });
  const runB = await runProgram(program, config, { source, seed: 42 });
  const runC = await runProgram(program, config, { source, seed: 7 });

  const detailsA = runA.report.tests[0]!.steps.slice(0, 5).map((s) => s.detail);
  const detailsB = runB.report.tests[0]!.steps.slice(0, 5).map((s) => s.detail);
  const detailsC = runC.report.tests[0]!.steps.slice(0, 5).map((s) => s.detail);

  assert.deepEqual(detailsA, detailsB, 'same seed must reproduce the exact same generated values');
  assert.notDeepEqual(detailsA, detailsC, 'a different seed should (overwhelmingly likely) differ');
  assert.equal(runA.report.seed, 42);
  assert.equal(runC.report.seed, 7);
  for (const d of detailsA) assert.match(d ?? '', /\(random\)$/);

  await server.close();
});

test('`random number`/`random decimal` with a reversed range fail clearly instead of silently producing an out-of-range value (decision 70)', async () => {
  const numberSource = `test "reversed number range"
  let qty = random number 10 to 5
  expect status equals 200
`;
  const { program: numberProgram } = parseSource(numberSource);
  const { report: numberReport } = await runProgram(numberProgram, testConfig('http://127.0.0.1:1'), { source: numberSource });
  assert.equal(numberReport.ok, false);
  assert.match(numberReport.tests[0]!.error ?? '', /random number 10 to 5.*`to` must be ≥ `from`/);

  const decimalSource = `test "reversed decimal range"
  let price = random decimal 10.5 to 2.5
  expect status equals 200
`;
  const { program: decimalProgram } = parseSource(decimalSource);
  const { report: decimalReport } = await runProgram(decimalProgram, testConfig('http://127.0.0.1:1'), { source: decimalSource });
  assert.equal(decimalReport.ok, false);
  assert.match(decimalReport.tests[0]!.error ?? '', /random decimal 10\.5 to 2\.5.*`to` must be ≥ `from`/);
});

test('`unique(...)`/`unique email`/`unique number` are guaranteed distinct across a run', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const letLines = Array.from({ length: 15 }, (_, i) => `  let order${i} = unique("order")`).join('\n');
  const source = `test "uniques"
${letLines}
  let a = unique email
  let b = unique email
  let c = unique number
  let d = unique number
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = report.tests[0]!.steps.slice(0, 19).map((s) => s.detail);
  assert.equal(new Set(details).size, 19, 'every unique(...)/unique email/unique number value must be distinct');
  for (const d of details) assert.match(d ?? '', /\(unique\)$/);

  await server.close();
});

// Decision 52 backfill: `today`/`now`/`random date in past`/`in future` used to anchor on
// wall-clock `Date.now()`, so `--seed` alone never reproduced them across separate invocations.
// They now derive from one run-clock (`--now`, or the real instant otherwise) threaded through
// `EvalCtx`, so `--seed` + `--now` together reproduce absolute dates exactly.
test('the same seed AND `now` reproduce identical `random date in past`/`in future` values', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "dates"
  let past = random date in past
  let future = random date in future
  api POST /orders body { past: {past} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, seed: 42, now: '2026-01-01T00:00:00.000Z' });
  const runB = await runProgram(program, config, { source, seed: 42, now: '2026-01-01T00:00:00.000Z' });
  const runC = await runProgram(program, config, { source, seed: 42, now: '2027-06-15T00:00:00.000Z' });

  const detailsA = runA.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail);
  const detailsB = runB.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail);
  const detailsC = runC.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail);

  assert.deepEqual(detailsA, detailsB, 'same seed + same `now` must reproduce the exact same dates');
  assert.notDeepEqual(detailsA, detailsC, 'the same seed with a different `now` anchor must produce different absolute dates');
  assert.equal(runA.report.now, '2026-01-01T00:00:00.000Z');
  assert.equal(runC.report.now, '2027-06-15T00:00:00.000Z');
  for (const d of detailsA) assert.match(d ?? '', /\(random\)$/);

  await server.close();
});

test('`today`/`now` derive from the run clock, not wall-clock `Date.now()` at evaluation time', async () => {
  // Comparison-based (not a hardcoded date string) so the test is timezone-independent: whatever
  // the runner's local timezone, the same `--now` must format identically across two runs, and a
  // different `--now` must format differently.
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "today and now"
  let d = format today as "yyyy-MM-dd"
  let n = format now as "yyyy-MM-dd HH:mm:ss"
  api POST /orders body { d: {d} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, now: '2026-03-15T12:34:56.000Z' });
  const runB = await runProgram(program, config, { source, now: '2026-03-15T12:34:56.000Z' });
  const runC = await runProgram(program, config, { source, now: '2030-11-02T08:00:00.000Z' });
  for (const r of [runA, runB, runC]) assert.equal(r.report.ok, true, JSON.stringify(r.report.tests[0], null, 2));

  const detailsA = runA.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail);
  const detailsB = runB.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail);
  const detailsC = runC.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail);

  assert.deepEqual(detailsA, detailsB, 'the same `now` must format identically across separate runs');
  assert.notDeepEqual(detailsA, detailsC, 'a different `now` must format differently');

  await server.close();
});

test('`unique like` renders the pattern and stays distinct across calls', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "unique like"
  let a = unique like "ORD-######"
  let b = unique like "ORD-######"
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const [a, b] = report.tests[0]!.steps.slice(0, 2).map((s) => s.detail!);
  assert.match(a, /^a = "ORD-\d{6}" \(unique\)$/);
  assert.match(b, /^b = "ORD-\d{6}" \(unique\)$/);
  assert.notEqual(a, b);

  await server.close();
});
