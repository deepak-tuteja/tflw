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

// decision 98: uuid/password generators + base64/hex/url transforms

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('`unique uuid` is v4-shaped and guaranteed distinct via the embedded run counter', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const letLines = Array.from({ length: 10 }, (_, i) => `  let id${i} = unique uuid`).join('\n');
  const source = `test "unique uuids"
${letLines}
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = report.tests[0]!.steps.slice(0, 10).map((s) => s.detail!);
  const uuids = details.map((d) => {
    const m = d.match(/^id\d+ = "([^"]+)" \(unique\)$/);
    assert.ok(m, `expected a tagged unique uuid detail, got: ${d}`);
    return m[1]!;
  });
  for (const u of uuids) assert.match(u, UUID_RE);
  assert.equal(new Set(uuids).size, 10, 'every unique uuid must be distinct');
  // The trailing 8 hex digits are the run's monotonic counter itself, so consecutive calls in one
  // test produce consecutive trailing segments.
  const trailers = uuids.map((u) => parseInt(u.slice(-8), 16));
  for (let i = 1; i < trailers.length; i++) assert.equal(trailers[i], trailers[i - 1]! + 1);

  await server.close();
});

test('`random uuid` is v4-shaped and reproducible under the same `--seed`', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "random uuid"
  let a = random uuid
  let b = random uuid
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);

  const runA = await runProgram(program, config, { source, seed: 42 });
  const runB = await runProgram(program, config, { source, seed: 42 });
  const runC = await runProgram(program, config, { source, seed: 7 });

  const detailsA = runA.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail!);
  const detailsB = runB.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail!);
  const detailsC = runC.report.tests[0]!.steps.slice(0, 2).map((s) => s.detail!);

  for (const d of detailsA) {
    const m = d.match(/^\w+ = "([^"]+)" \(random\)$/);
    assert.ok(m, `expected a tagged random uuid detail, got: ${d}`);
    assert.match(m[1]!, UUID_RE);
  }
  assert.deepEqual(detailsA, detailsB, 'same seed must reproduce the exact same uuids');
  assert.notDeepEqual(detailsA, detailsC, 'a different seed should (overwhelmingly likely) differ');

  await server.close();
});

test('`random password` guarantees at least one upper/lower/digit/symbol, at any valid length', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "passwords"
  let default_ = random password
  let long = random password 32
  let floor = random password 4
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = report.tests[0]!.steps.slice(0, 3).map((s) => s.detail!);
  const pws = details.map((d) => {
    const m = d.match(/^\w+ = "([^"]+)" \(random\)$/);
    assert.ok(m, `expected a tagged random password detail, got: ${d}`);
    return m[1]!;
  });

  assert.equal(pws[0]!.length, 12, 'default length is 12');
  assert.equal(pws[1]!.length, 32);
  assert.equal(pws[2]!.length, 4);
  for (const pw of pws) {
    assert.match(pw, /[A-Z]/, `${pw} missing an uppercase letter`);
    assert.match(pw, /[a-z]/, `${pw} missing a lowercase letter`);
    assert.match(pw, /[0-9]/, `${pw} missing a digit`);
    assert.match(pw, /[!@#$%^&*\-_=+]/, `${pw} missing a symbol`);
  }

  await server.close();
});

test('`random password` below the length-4 floor fails clearly', async () => {
  const source = `test "too short"
  let pw = random password 3
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /random password 3.*length must be at least 4/);
});

test('base64/hex/url transforms round-trip and stay untagged (not a generator)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => res.writeHead(200).end('ok') });

  const source = `test "transforms"
  let creds = base64 encode("alice@example.test:s3cr3t")
  let decoded = base64 decode(creds)
  let hexed = hex encode("hello world")
  let unhexed = hex decode(hexed)
  let urled = url encode("a b&c")
  let unurled = url decode(urled)
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const details = report.tests[0]!.steps.slice(0, 6).map((s) => s.detail!);
  for (const d of details) assert.doesNotMatch(d, /\((random|unique)\)$/, 'transforms are not generators, no tag expected');

  assert.equal(details[0], 'creds = "YWxpY2VAZXhhbXBsZS50ZXN0OnMzY3IzdA=="');
  assert.equal(details[1], 'decoded = "alice@example.test:s3cr3t"');
  assert.equal(details[2], 'hexed = "68656c6c6f20776f726c64"');
  assert.equal(details[3], 'unhexed = "hello world"');
  assert.equal(details[4], 'urled = "a%20b%26c"');
  assert.equal(details[5], 'unurled = "a b&c"');

  await server.close();
});

test('base64/hex decode reject malformed input instead of silently dropping bad characters', async () => {
  const badHex = `test "bad hex"
  let x = hex decode("not-hex!")
  expect status equals 200
`;
  const { program: hexProgram } = parseSource(badHex);
  const { report: hexReport } = await runProgram(hexProgram, testConfig('http://127.0.0.1:1'), { source: badHex });
  assert.equal(hexReport.ok, false);
  assert.match(hexReport.tests[0]!.error ?? '', /hex decode\(\.\.\.\): "not-hex!" is not valid hex/);

  const badBase64 = `test "bad base64"
  let x = base64 decode("not valid base64!!")
  expect status equals 200
`;
  const { program: b64Program } = parseSource(badBase64);
  const { report: b64Report } = await runProgram(b64Program, testConfig('http://127.0.0.1:1'), { source: badBase64 });
  assert.equal(b64Report.ok, false);
  assert.match(b64Report.tests[0]!.error ?? '', /base64 decode\(\.\.\.\): "not valid base64!!" is not valid base64/);
});

test('url decode rejects malformed percent-encoding', async () => {
  const source = `test "bad percent-encoding"
  let x = url decode("100% not valid")
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /url decode\(\.\.\.\): "100% not valid" is not validly percent-encoded/);
});
