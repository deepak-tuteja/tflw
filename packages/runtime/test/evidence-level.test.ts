// `evidence full|headers-only|none` (SPEC §13, PLAN decision 101c, enterprise arc cluster 2) —
// trims the report-only trace built alongside every step. The property under test throughout:
// trimming never affects what `expect`/`capture` can see — only what lands in the report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

const SOURCE = `test "reads a user"\n  api GET /user\n  expect status equals 200\n  expect body.email equals "a@example.com"\n`;

/** A realistic-looking bearer token — long enough to clear `MIN_REDACTABLE_LENGTH`/
 * `MIN_MASKABLE_LENGTH`, and distinctive enough that a substring search over the whole serialized
 * report is a meaningful "does this leak" check. */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

test('`full` (the default) keeps headers and body in the report, unchanged from today', async () => {
  const server = await startFixtureServer({ '/user': (_req, res) => json(res, 200, { email: 'a@example.com' }) });
  const config = testConfig(server.baseUrl); // evidenceLevel: 'full' by default

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.match(apiStep.response!.bodyText, /a@example\.com/);
  assert.ok(Object.keys(apiStep.response!.headers).length > 0);

  await server.close();
});

test('`headers-only` drops the body from the report but keeps headers, and assertions still pass', async () => {
  const server = await startFixtureServer({ '/user': (_req, res) => json(res, 200, { email: 'a@example.com' }) });
  const config = { ...testConfig(server.baseUrl), evidenceLevel: 'headers-only' as const };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2)); // `expect body.email` still ran against the raw trace
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.response!.bodyText, /a@example\.com/);
  assert.equal(apiStep.request!.body, undefined);
  assert.ok(Object.keys(apiStep.response!.headers).length > 0, 'headers must still be present at this level');

  await server.close();
});

test('`none` drops both headers and body from the report, and assertions still pass', async () => {
  const server = await startFixtureServer({ '/user': (_req, res) => json(res, 200, { email: 'a@example.com' }) });
  const config = { ...testConfig(server.baseUrl), evidenceLevel: 'none' as const };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.response!.bodyText, /a@example\.com/);
  assert.deepEqual(apiStep.response!.headers, {});
  assert.deepEqual(apiStep.request!.headers, {});
  assert.equal(apiStep.request!.url.includes(server.baseUrl.replace('http://', '')), true, 'the URL itself is never trimmed — the report still identifies the request');

  await server.close();
});

// ---- FS-02 (review findings V2-03 / V2-04) ---------------------------------
//
// Before FS-02, `redactRequest`/`redactResponse` were the *only* functions in `interpreter.ts` that
// read `config.evidenceLevel`. A step's own detail text did not, so `evidence none` dropped the
// response body from the trace and then printed a field out of that same body verbatim one line
// below it. This whole block is the fixture the old `evidence-level.test.ts` was missing: it had
// neither a `capture` step nor a failing assertion, which is exactly why it passed while both leaks
// were live.

const SESSION_SOURCE = `test "logs in"\n  api GET /session\n  expect status equals 200\n  capture body.accessToken as token\n  expect body.accessToken equals "not-the-token"\n`;

function sessionServer() {
  return startFixtureServer({ '/session': (_req, res) => json(res, 200, { accessToken: JWT }) });
}

test('`evidence none`: a captured secret and a failing assertion leak it into no part of the report', async () => {
  const server = await sessionServer();
  const config = { ...testConfig(server.baseUrl), evidenceLevel: 'none' as const };

  const { program } = parseSource(SESSION_SOURCE);
  const { report } = await runProgram(program, config, { source: SESSION_SOURCE });

  assert.equal(report.ok, false, 'the last assertion is meant to fail — that is the leak path under test');

  // `results.json` is `JSON.stringify(report)` verbatim, and `report.html`/`junit.xml` are both
  // rendered from this same object — so zero occurrences here is zero occurrences in all three.
  assert.equal(JSON.stringify(report).includes(JWT), false, 'the token must not appear anywhere in the report at `evidence none`');

  // …but the report must still be *useful*. Dropping detail entirely below `full` was the rejected
  // alternative precisely because it would make `evidence none` useless for diagnosing a CI
  // failure: what was compared survives, what it was compared against does not.
  const failing = report.tests[0]!.steps.filter((s) => s.kind === 'expect').at(-1)!;
  assert.equal(failing.ok, false);
  assert.match(failing.detail!, /body\.accessToken/, 'the failure must still name the subject it compared');
  assert.match(failing.detail!, /omitted by evidence level/, 'and say why the value is missing, not just omit it silently');

  const captureStep = report.tests[0]!.steps.find((s) => s.kind === 'capture')!;
  assert.match(captureStep.detail!, /^token = \[omitted by evidence level\] \(captured\)$/);

  await server.close();
});

test('`evidence full` (the default) is unchanged — capture and expect detail still show real values', async () => {
  const server = await sessionServer();
  const config = testConfig(server.baseUrl);

  const { program } = parseSource(SESSION_SOURCE);
  const { report } = await runProgram(program, config, { source: SESSION_SOURCE });

  const captureStep = report.tests[0]!.steps.find((s) => s.kind === 'capture')!;
  assert.match(captureStep.detail!, new RegExp(JWT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'FS-02 must not change the default level');

  await server.close();
});

test('`headers-only`: a header subject keeps its value in detail, a body subject does not', async () => {
  // The rule is read straight off `redactRequest`/`redactResponse` rather than invented separately:
  // detail never shows what the trace level already dropped. At `headers-only` the trace still
  // prints every header, so masking a header subject's value in the line below it would be theatre;
  // bodies are gone, so a body subject's value must go with them.
  const server = await startFixtureServer({
    '/session': (_req, res) => {
      res.setHeader('x-session-token', JWT);
      json(res, 200, { accessToken: JWT });
    },
  });
  const config = { ...testConfig(server.baseUrl), evidenceLevel: 'headers-only' as const };
  const source = `test "logs in"\n  api GET /session\n  capture header "x-session-token" as h\n  capture body.accessToken as b\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const [headerCapture, bodyCapture] = report.tests[0]!.steps.filter((s) => s.kind === 'capture');
  assert.match(headerCapture!.detail!, /eyJhbGciOiJIUzI1NiJ9/, 'the header is already printed in full in the header panel above');
  assert.match(bodyCapture!.detail!, /^b = \[omitted by evidence level\] \(captured\)$/);

  await server.close();
});

test('`status` and `duration` survive at every level — they are the structure, not the values', async () => {
  const server = await sessionServer();
  const config = { ...testConfig(server.baseUrl), evidenceLevel: 'none' as const };
  const source = `test "logs in"\n  api GET /session\n  expect status equals 500\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  const failing = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.equal(failing.ok, false);
  assert.match(failing.detail!, /200/, 'a status code is never a secret, and a failure that hides it is unusable');

  await server.close();
});

test('`evidence none` does not break `wait until api` (its retry loop reads the redacted trace directly)', async () => {
  // A light regression check: `wait` steps read `last.redacted.request`/`.response` (interpreter.ts)
  // rather than rebuilding them, so this exercises that path still working once `redactRequest`/
  // `redactResponse` also apply evidence-level trimming.
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      json(res, 200, { status: calls < 2 ? 'pending' : 'shipped' });
    },
  });
  const config = { ...testConfig(server.baseUrl), evidenceLevel: 'none' as const };
  const source = `test "polls"\n  wait until api GET /poll\n    expect body.status equals "shipped"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});
