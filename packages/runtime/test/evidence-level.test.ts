// `evidence full|headers-only|none` (SPEC §13, PLAN decision 101c, enterprise arc cluster 2) —
// trims the report-only trace built alongside every step. The property under test throughout:
// trimming never affects what `expect`/`capture` can see — only what lands in the report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

const SOURCE = `test "reads a user"\n  api GET /user\n  expect status equals 200\n  expect body.email equals "a@example.com"\n`;

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
