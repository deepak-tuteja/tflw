// The runtime half of review finding `A4-06` (M95): a `capture` whose subject resolves to nothing.
//
// Until M95 this bound `undefined` and reported `✓`, which is a *false pass* rather than a lenient
// one — the run then interpolated the literal text `"undefined"` into every later `{name}`, and a
// target that answers 200 to `?v=undefined` made the whole suite green while asserting nothing. The
// checker cannot reach this case (an absent header is a property of the response, not of the
// source), so it has to fail here or nowhere; `A4-06`'s static half — an *interpolation typo* in
// the subject — is closed in `packages/lang/test/checker.test.ts`.
//
// The boundary that has to hold in the other direction is JSON `null`: it is a value the response
// really carried, so capturing it stays legal. Only `undefined` — an absent header, an absent
// object key, an out-of-range index — is the failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('an absent header fails the capture instead of binding `undefined` (A4-06)', async () => {
  const server = await startFixtureServer({
    '/x': (_req, res) => json(res, 200, { id: 7 }),
    '/y': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "t"
  api GET /x
  expect status equals 200
  capture header "X-Definitely-Missing" as v
  api GET /y?v={v}
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false, 'the suite must not pass on a capture that captured nothing');
  const steps = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps : [];
  const capture = steps.find((s) => s.kind === 'capture')!;
  assert.equal(capture.ok, false);
  assert.match(capture.detail ?? '', /nothing to capture at header "X-Definitely-Missing"/);

  // The amplification, asserted directly: the request that would have carried the literal string
  // `undefined` is never sent. Without this the test above would still pass if the capture were
  // merely *reported* as failed while the run carried on.
  assert.equal([...server.received.keys()].some((p) => p.startsWith('/y')), false, 'no later step may run, and none may send the text "undefined"');

  await server.close();
});

test('an absent JSON key fails the capture (A4-06)', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { id: 7 }) });

  const source = `test "t"
  api GET /x
  capture body.nope as v
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /nothing to capture at body\.nope/);

  await server.close();
});

test('an out-of-range array index fails the capture (A4-06)', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { items: [1, 2] }) });

  const source = `test "t"
  api GET /x
  capture body.items[5] as v
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /nothing to capture at body\.items\[5\]/);

  await server.close();
});

test('an explicit JSON `null` is a real value and stays capturable (A4-06)', async () => {
  const server = await startFixtureServer({
    '/x': (_req, res) => json(res, 200, { id: 7, note: null }),
    '/y': (_req, res) => json(res, 200, { ok: true }),
  });

  // The negative control for the rule above: `null` and `undefined` are the same falsy shape to a
  // careless guard, and collapsing them would make `capture body.note as n` — a field the response
  // genuinely carried — fail on a suite that is correct.
  const source = `test "t"
  api GET /x
  capture body.note as n
  capture body.id as i
  api GET /y?i={i}
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps : [];
  assert.equal(steps.filter((s) => s.kind === 'capture').every((s) => s.ok), true);
  assert.ok(server.received.has('/y?i=7'), 'the captured value still reaches the next request');

  await server.close();
});

test('a header that *is* present captures normally — the guard is not ambient (A4-06)', async () => {
  const server = await startFixtureServer({
    '/x': (_req, res) => res.writeHead(200, { 'x-request-id': 'abc123', 'content-type': 'application/json' }).end('{}'),
  });

  const source = `test "t"
  api GET /x
  capture header "X-Request-Id" as rid
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps : [];
  assert.match(steps.find((s) => s.kind === 'capture')!.detail ?? '', /rid = "abc123" \(captured\)/);

  await server.close();
});
