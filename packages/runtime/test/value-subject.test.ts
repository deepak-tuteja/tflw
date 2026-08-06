// The runtime half of review finding `FU-11` (M96): a `{name}` / `{name.path}` value subject
// resolves against the variable scope and is asserted on like any other subject.
//
// The grammar half is in `packages/lang/test/valueSubject.test.ts`. What has to be proven *here* is
// the half a parse test cannot reach: that `resolveSubject`'s new branch returns a real value
// rather than `undefined` — an assertion that resolves to nothing and compares `undefined` against
// the expected value would *pass* every "it parses and runs" test while checking nothing at all.
// So each test below fails the assertion on purpose at least once, or asserts on the reported
// value, rather than only asserting a green step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a value subject resolves to its bound value, not `undefined` (FU-11)', async () => {
  // The load-bearing control: `t` is 5, and the assertion demands 999. If `resolveSubject` returned
  // `undefined` this step would still be reported — as a *failure* — so the pass/fail bit alone
  // proves nothing. The reported detail has to name `5`.
  const source = `test "t"
  let t = 5
  expect {t} equals 999
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  const step = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps[1]! : undefined!;
  assert.equal(step.ok, false);
  assert.match(step.detail ?? '', /\b5\b/, 'the failure must report the real bound value');
  assert.doesNotMatch(step.detail ?? '', /undefined/);
});

test('a value assertion needs no response at all (TF039 exemption, runtime half)', async () => {
  // The checker exempts it; the interpreter has to agree, or `tflw check` would pass a file the run
  // then rejects — the exact soundness direction the checker contract is about.
  const source = `test "t"
  let n = 7
  expect {n} is greater than 3
  expect {n} is less than 10
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, true, 'no `api` step runs, and none is needed');
});

test('a captured response value is asserted on directly — the FU-11 motivating case', async () => {
  // Token rotation, the shape `testFlow-tests/tests/api/identity/token-refresh-lifecycle.tflw` was
  // written for and could not express: "the new token differs from the old one".
  const server = await startFixtureServer({
    '/login': (_req, res) => json(res, 200, { token: 'aaa' }),
    '/refresh': (_req, res) => json(res, 200, { token: 'bbb' }),
  });

  const source = `test "rotation"
  api GET /login
  capture body.token as first
  api GET /refresh
  capture body.token as second
  expect {second} not equals {first}
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true);

  // The control that makes the above mean something: a server that does *not* rotate has to fail.
  // Without this, the test would pass against a broken API — which is precisely `FU-11`'s bug.
  const stale = await startFixtureServer({
    '/login': (_req, res) => json(res, 200, { token: 'same' }),
    '/refresh': (_req, res) => json(res, 200, { token: 'same' }),
  });
  const { report: staleReport } = await runProgram(parseSource(source).program, testConfig(stale.baseUrl), { source });
  assert.equal(staleReport.ok, false, 'a token that never rotates must fail the rotation test');

  await server.close();
  await stale.close();
});

test('a path into a captured object resolves (FU-11)', async () => {
  const server = await startFixtureServer({ '/o': (_req, res) => json(res, 200, { order: { total: 42 } }) });
  const source = `test "t"
  api GET /o
  capture body.order as o
  expect {o.total} equals 42
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true);
  await server.close();
});

test('`all` over a captured array quantifies element by element (D131)', async () => {
  const server = await startFixtureServer({
    '/o': (_req, res) => json(res, 200, { items: [{ price: 5 }, { price: 0 }, { price: 9 }] }),
  });
  const source = `test "t"
  api GET /o
  capture body.items as items
  expect all {items.price} is greater than 0
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  // The middle element is 0, so `all` must fail *and* name which element did.
  assert.equal(report.ok, false);
  const step = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps[2]! : undefined!;
  assert.equal(step.ok, false);
  assert.match(step.detail ?? '', /items\[1\]\.price/, 'the failing element must be identified by index');
  await server.close();
});

test('`any` over a captured array passes on one match (D131)', async () => {
  const server = await startFixtureServer({
    '/o': (_req, res) => json(res, 200, { items: [{ price: 0 }, { price: 9 }] }),
  });
  const source = `test "t"
  api GET /o
  capture body.items as items
  expect any {items.price} is greater than 0
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true);
  await server.close();
});

test('a quantifier over a captured array needs no response of its own (D131)', async () => {
  // `evaluateQuantified`'s response-null guard had to move *below* the subject check for this —
  // the two body roots need a response, the third does not.
  const source = `test "t"
  let items = [1, 2, 3]
  expect all {items} is greater than 0
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });
  assert.equal(report.ok, true);
});

test('a binary body outlives its request (D132 — `matches file` is deliberately allowed)', async () => {
  // Today a `body bytes` assertion must run *immediately*, before the next `api` step overwrites
  // the response. The value subject is what lets a captured binary body be compared later. The
  // control is the intervening request: without the capture surviving it, this cannot work.
  const bytes = Buffer.from('%PDF-1.4 fake receipt bytes');
  const server = await startFixtureServer({
    '/receipt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(bytes);
    },
    '/other': (_req, res) => json(res, 200, { ok: true }),
  });
  const source = `test "t"
  api GET /receipt
  capture body bytes as receipt
  api GET /other
  expect status equals 200
  expect {receipt} has count ${bytes.length}
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, 'the captured bytes must survive the intervening request');
  await server.close();
});

test('a type mismatch on a value subject is a runtime error, exactly as on `body.<path>` (D132)', async () => {
  // The other half of D132's partition: value-*type* compatibility is deliberately NOT static, so a
  // captured value is never stricter than the response it came from. Both forms must behave alike.
  const server = await startFixtureServer({ '/o': (_req, res) => json(res, 200, { name: 'Widget' }) });
  const direct = `test "t"\n  api GET /o\n  expect body.name is greater than 3\n`;
  const viaValue = `test "t"\n  api GET /o\n  capture body.name as n\n  expect {n} is greater than 3\n`;

  for (const [label, source] of [['body.<path>', direct], ['{value}', viaValue]] as const) {
    const { program, diagnostics } = parseSource(source);
    assert.deepEqual(diagnostics, [], `${label} must parse and check clean`);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    assert.equal(report.ok, false, `${label} must fail at run time, not at check time`);
  }
  await server.close();
});

test('an env-sourced secret asserted on is redacted in the report (D136b)', async () => {
  // M96 creates a new path for an `env()` value to reach a report: a failing `expect {pw} …`
  // carries the value into the failure message. SPEC §3.4 says redaction is taint-tracked and
  // value-based, applied as a final full-report pass — so a new source *should* be covered for
  // free. "Should be covered by construction" is exactly the claim `M92d` says a passing test
  // cannot establish alone, so the control below is the point of this test: if the mechanism does
  // not cover it, we found a credential leak in a feature we were about to ship.
  const source = `test "t"
  let pw = env(ADMIN_PW)
  expect {pw} equals "definitely-not-it"
`;
  const secret = 'p@ssw0rd-xyz';
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), {
    source,
    environ: { ADMIN_PW: secret },
  });

  assert.equal(report.ok, false, 'the assertion must fail — that is what puts the value in the report');
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /p@ssw0rd-xyz/, 'the raw secret must never reach the report');
  assert.match(serialized, /•••\(ADMIN_PW\)/, 'and it must be visibly masked, not silently dropped');

  // The negative control, and the reason this test is worth its length: the *same* assertion on a
  // plain literal must put the value in the report verbatim. Without this, "the secret is absent"
  // would be satisfied just as well by a value subject whose detail text never carried a value at
  // all — a passing test of nothing (`M92d`). This proves redaction is what removed it.
  const plainSource = `test "t"\n  let pw = "p@ssw0rd-xyz"\n  expect {pw} equals "definitely-not-it"\n`;
  const { report: plain } = await runProgram(parseSource(plainSource).program, testConfig('http://127.0.0.1:1'), { source: plainSource });
  assert.match(JSON.stringify(plain), /p@ssw0rd-xyz/, 'an unredacted value of the same shape does reach the report — so redaction, not absence, is what masked the secret above');
});

test('a value assertion survives a lowered `evidence` level (M96)', async () => {
  // `subjectValueSurvivesEvidenceLevel` has a `default:` arm, so the compiler did *not* flag the
  // new union member there — left alone it would have masked every value assertion's detail at any
  // level below `full`, since a `{var}` would have fallen through to "not part of the trace".
  // Which it is not — but that is a reason to *keep* it, not to blank it.
  const source = `test "t"
  let n = 5
  expect {n} equals 999
`;
  const { program } = parseSource(source);
  const config = { ...testConfig('http://127.0.0.1:1'), evidenceLevel: 'none' as const };
  const { report } = await runProgram(program, config, { source });

  const step = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps[1]! : undefined!;
  assert.equal(step.ok, false);
  assert.match(step.detail ?? '', /\b5\b/, 'a bound value is not response evidence, so `evidence none` must not blank it');
});
