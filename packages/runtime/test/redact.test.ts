// Taint redaction (redact.ts, P#30). Every `env(NAME)` value is registered and masked wherever it
// later appears in a report/trace. P#46 flagged a gap: a secret containing characters that
// `JSON.stringify` escapes (quotes, backslashes, newlines) would appear in its *escaped* form
// inside a `body { … }` trace and dodge a plain substring match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { Redactor } from '../src/redact.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('Redactor.redact masks a registered secret wherever it appears verbatim', () => {
  const r = new Redactor();
  r.register('API_KEY', 'sekret');
  assert.equal(r.redact('Authorization: Bearer sekret'), 'Authorization: Bearer •••(API_KEY)');
});

test('Redactor.redact also masks the JSON-string-escaped form of a secret containing quotes/backslashes (P#46)', () => {
  const r = new Redactor();
  r.register('ADMIN_PW', 'p"w\\word');
  const jsonBody = JSON.stringify({ pass: 'p"w\\word' });
  assert.ok(jsonBody.includes('p\\"w\\\\word'), 'sanity: JSON.stringify really does escape this value');
  assert.doesNotMatch(r.redact(jsonBody), /p"w\\word/);
  assert.match(r.redact(jsonBody), /•••\(ADMIN_PW\)/);
});

test('two env vars sharing the same secret value are both named in the placeholder, not just whichever registered first (decision 72)', () => {
  const r = new Redactor();
  r.register('API_KEY', 'sharedsecret');
  r.register('LEGACY_KEY', 'sharedsecret');
  assert.equal(r.redact('token=sharedsecret'), 'token=•••(API_KEY|LEGACY_KEY)');
  // Registering the same name again for the same value must not duplicate it in the placeholder.
  r.register('API_KEY', 'sharedsecret');
  assert.equal(r.redact('token=sharedsecret'), 'token=•••(API_KEY|LEGACY_KEY)');
});

test('a secret appearing in an early response is masked by the final report pass, even though its `env()` isn\'t evaluated until a later step (decision 56)', async () => {
  // Before decision 56, redaction only happened per-step, using whatever the redactor knew *at
  // that moment* — so a secret first read late in a run could never retroactively mask an earlier
  // step's already-built trace. `whoami` echoes the secret value first; only the second step
  // actually evaluates `env(ADMIN_PW)`, registering it.
  const server = await startFixtureServer({
    '/whoami': (_req, res) => json(res, 200, { note: 'current pw is p@ssw0rd-xyz' }),
    '/login': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "secret surfaces before it's ever read via env()"
  api GET /whoami
  expect status equals 200
  api POST /login body { pass: env(ADMIN_PW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const whoamiStep = report.tests[0]!.steps.find((s) => s.detail?.includes('/whoami'))!;
  assert.doesNotMatch(whoamiStep.response!.bodyText, /p@ssw0rd-xyz/, 'the final report pass must retroactively mask the earlier response');
  assert.match(whoamiStep.response!.bodyText, /•••\(ADMIN_PW\)/);

  await server.close();
});

test('`require env` pre-registers a secret at run start, masking a response that echoes it even when `env()` is never evaluated anywhere in the file (decision 56)', async () => {
  // The only case per-step redaction *and* a trailing full-report pass both miss on their own: a
  // required var that leaks into a response but whose `env(NAME)` is never actually called in this
  // run, so nothing would ever register it — unless it's pre-registered from `require env` alone.
  const server = await startFixtureServer({ '/whoami': (_req, res) => json(res, 200, { note: 'current pw is p@ssw0rd-xyz' }) });

  const source = `test "never calls env() at all"
  api GET /whoami
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['ADMIN_PW'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const whoamiStep = report.tests[0]!.steps.find((s) => s.detail?.includes('/whoami'))!;
  assert.doesNotMatch(whoamiStep.response!.bodyText, /p@ssw0rd-xyz/);
  assert.match(whoamiStep.response!.bodyText, /•••\(ADMIN_PW\)/);

  await server.close();
});

test('an env() secret with a quote in it stays redacted end-to-end through a JSON request body', async () => {
  const server = await startFixtureServer({ '/login': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "login"
  api POST /login body { pass: env(ADMIN_PW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p"w\\word' };
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.request!.body ?? '', /w\\word/);
  assert.match(apiStep.request!.body ?? '', /•••\(ADMIN_PW\)/);

  await server.close();
});

test('a short `require env` value is not substring-redacted, so it never corrupts unrelated report content (decision 64)', () => {
  const r = new Redactor();
  r.register('PORT', '3001'); // 4 chars — below the redaction floor
  assert.equal(r.redact('order id 3001 shipped'), 'order id 3001 shipped', 'a short secret must not blot out an unrelated matching field');
});

test('a short secret is never registered end-to-end, so an unrelated response field that happens to equal it renders untouched (decision 64)', async () => {
  const server = await startFixtureServer({ '/orders/3001': (_req, res) => json(res, 200, { orderId: 3001, status: 'shipped' }) });

  const source = `test "an unrelated field equal to a short secret stays visible"
  api GET /orders/3001
  expect status equals 200
  expect body.orderId equals 3001
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, PORT: '3001' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['PORT'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.match(apiStep.response!.bodyText, /"orderId":3001/, 'the unrelated orderId field must not be redacted just because it matches a short secret');

  await server.close();
});
