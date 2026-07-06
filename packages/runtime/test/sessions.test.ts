// M2.6: `session` blocks — the single auth concept (SPEC §3.3, P#20/31/42). A session's steps
// run once per run (cached across every test/file that opts in via `as <session>`); its `header`
// lines become headers auto-applied to that test's api steps. Design calls made explicit in
// PLAN.md decision 42: sessions are ordinary parsed steps, spliced into the report like an action
// call, but only shown once (the first test to need them) — later users get the cached headers
// silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram, SessionCache } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { ResolvedConfig } from '../src/types.js';
import { startFixtureServer, json } from './support.js';

function configWithSession(baseUrl: string, sessionBody = `  api POST /auth/login body { user: "a", pass: "b" }\n  capture body.token as token\n  header "Authorization" is "Bearer {token}"\n`): ResolvedConfig {
  const configSource = `env test default\n  api "${baseUrl}"\n\nsession admin\n${sessionBody}`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  const envBlock = selectEnv(parsed.config, {});
  return resolveConfig(parsed.config, envBlock);
}

test('a session header is auto-applied to the api steps of a test running `as <session>`', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "reads orders" as admin
  api GET /orders
  expect status equals 200
  expect body.auth equals "Bearer tok-123"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/auth/login')!.length, 1);

  await server.close();
});

test('an anonymous test (no `as`) never sees another test\'s session header', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "anonymous"
  api GET /orders
  expect status equals 200
  expect body.auth equals null
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.has('/auth/login'), false);

  await server.close();
});

test('the session runs once and is cached across every test that opts in — steps only shown for the first', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
    '/invoices': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "first" as admin
  api GET /orders
  expect status equals 200
  expect body.auth equals "Bearer tok-123"

test "second" as admin
  api GET /invoices
  expect status equals 200
  expect body.auth equals "Bearer tok-123"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/auth/login')!.length, 1, 'the session login must run exactly once');

  const firstKinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(firstKinds, ['api', 'capture', 'header', 'api', 'expect', 'expect']);

  const secondKinds = report.tests[1]!.steps.map((s) => s.kind);
  assert.deepEqual(secondKinds, ['api', 'expect', 'expect'], 'the second test must not re-show the session\'s steps');

  await server.close();
});

test('a session that fails to establish fails every test opting into it, with a clear error', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => res.writeHead(500).end(),
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "never runs its own steps" as admin
  api GET /orders
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /session "admin" failed to establish/);
  assert.equal(server.received.has('/orders'), false, 'the test body must never run once its session fails');

  await server.close();
});

test('a session that fails once then succeeds lets a `retry`ing test pass (decision 54)', async () => {
  // Before decision 54, `SessionCache` memoized the *failed* promise forever, so once a session
  // failed to establish, every test opting into it — including this same test's own `retry`
  // attempts, which share the same cache — was doomed for the rest of the run. Only a successful
  // outcome should be cached; a failed one must let a later attempt (or a later test) try again.
  let loginAttempts = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginAttempts++;
      if (loginAttempts === 1) {
        res.writeHead(500).end();
        return;
      }
      json(res, 200, { token: 'tok-123' });
    },
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "retries past a flaky session" as admin retry 1
  api GET /orders
  expect status equals 200
  expect body.auth equals "Bearer tok-123"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(report.tests[0]!.flaky, true, 'the first attempt failed (session down), so the eventual pass must be flagged flaky');
  assert.equal(loginAttempts, 2, 'the session must be re-attempted on the retry, not permanently cached as failed');

  await server.close();
});

test('a retried session-authenticated test keeps the session\'s steps as evidence in the surviving attempt (decision 68)', async () => {
  // Before decision 68, `SessionCache.shown` was claimed on attempt 1's `ensure()` call regardless
  // of which attempt's result the report actually keeps (SPEC §4.4: only the last attempt's steps
  // survive). Attempt 1 here fails for a reason unrelated to the session (its own `expect` fails),
  // consuming the one-time "shown" slot; attempt 2 (the one kept) would then get `steps: []` back
  // from `ensure()` even though the session headers took effect — no evidence a login ever ran.
  let bodyAttempts = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/orders': (req, res) => {
      bodyAttempts++;
      json(res, 200, { auth: req.headers['authorization'] ?? null, ready: bodyAttempts >= 2 });
    },
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "flaky body, stable session" as admin retry 1
  api GET /orders
  expect status equals 200
  expect body.ready equals true
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(report.tests[0]!.flaky, true, 'attempt 1 must have failed its own expect for this test to be flaky');
  assert.equal(server.received.get('/auth/login')!.length, 1, 'the session must still only log in once');

  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['api', 'capture', 'header', 'api', 'expect', 'expect'], 'the surviving (last) attempt must still carry the session\'s own steps as evidence it ran');

  await server.close();
});

test('a session is shared across separate `runProgram` calls via an explicit `sessionCache`', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithSession(server.baseUrl);
  const sessionCache = new SessionCache();

  const { program: programA } = parseSource(`test "a" as admin\n  api GET /orders\n  expect status equals 200\n`);
  const { program: programB } = parseSource(`test "b" as admin\n  api GET /orders\n  expect status equals 200\n`);

  const { report: reportA } = await runProgram(programA, config, { source: '', sessionCache });
  const { report: reportB } = await runProgram(programB, config, { source: '', sessionCache });

  assert.equal(reportA.ok, true);
  assert.equal(reportB.ok, true);
  assert.equal(server.received.get('/auth/login')!.length, 1, 'shared across both runProgram calls, the login must still run only once');

  await server.close();
});

test('a test referencing an unknown session fails clearly at runtime (defensive — the checker normally catches this first)', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, {}) });
  const config = configWithSession(server.baseUrl);

  // Bypass the checker by hand-building a TestDecl whose `session` isn't declared in config.
  const { program } = parseSource(`test "ok"\n  api GET /orders\n  expect status equals 200\n`);
  const bad = { ...program, tests: [{ ...program.tests[0]!, session: 'ghost' }] };
  const { report } = await runProgram(bad, config, { source: '' });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /unknown session "ghost"/);

  await server.close();
});
