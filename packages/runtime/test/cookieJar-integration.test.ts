// First-class cookie jar (SPEC §3.3, P#33) — interpreter-level wiring. The pure jar logic
// (parsing/expiry/serialize) is covered in cookieJar.test.ts; these tests prove it's actually
// threaded through `execApi`, `session` blocks, and action calls the way §3.3 documents.
//
// The core proof (`a login setting two cookies at once no longer crashes...`) is the direct fix
// for what was TFLW-GAPS.md gap #1 in testFlow-tests: replaying a newline-joined multi-`Set-Cookie`
// capture as a `Cookie` header used to throw `Headers.append: "...\n..." is an invalid header
// value` — a real, empirically-confirmed hard failure (testFlow-tests/tests/.gaps/cookie-jar.tflw),
// not a theoretical one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { ResolvedConfig } from '../src/types.js';
import { startFixtureServer, json, testConfig } from './support.js';

function configWithSession(baseUrl: string, sessionBody: string): ResolvedConfig {
  const configSource = `env test default\n  api "${baseUrl}"\n\nsession shopper\n${sessionBody}`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  const envBlock = selectEnv(parsed.config, {});
  return resolveConfig(parsed.config, envBlock);
}

test('a single Set-Cookie is auto-captured and auto-replayed on the next api step in the same test, with no capture/header at all', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=tok-abc; Path=/; HttpOnly' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = testConfig(server.baseUrl);

  const source = `test "cookie carries forward with no capture/header at all"
  api POST /login
  expect status equals 200

  api GET /profile
  expect status equals 200
  expect body.cookie equals "session=tok-abc"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await server.close();
});

test('a login setting two cookies at once no longer crashes replaying them — both land in one proper Cookie header (fixes the former hard-crash gap)', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      res.writeHead(200, { 'set-cookie': ['session=abc123; Path=/; HttpOnly', 'session_refresh=xyz789; Path=/; HttpOnly'] });
      res.end('{}');
    },
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = testConfig(server.baseUrl);

  const source = `test "dual Set-Cookie replays cleanly"
  api POST /login
  expect status equals 200

  api GET /profile
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const receivedCookie = server.received.get('/profile')![0]!.headers['cookie'];
  assert.match(receivedCookie ?? '', /session=abc123/);
  assert.match(receivedCookie ?? '', /session_refresh=xyz789/);
  assert.doesNotMatch(receivedCookie ?? '', /\n/, 'must be one real Cookie header value, never an embedded newline');

  await server.close();
});

test('a session block\'s own cookie login is seeded into every test opting in via `as <session>` — no manual capture/header needed', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=tok-abc; Path=/; HttpOnly' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = configWithSession(server.baseUrl, `  api POST /login\n  expect status equals 200\n`);

  const source = `test "reads profile" as shopper
  api GET /profile
  expect status equals 200
  expect body.cookie equals "session=tok-abc"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/login')!.length, 1, 'the cached session must still only log in once');

  await server.close();
});

test('two tests sharing the same cached session never leak cookie mutations into each other', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=tok-abc' }).end('{}'),
    '/bump': (_req, res) => res.writeHead(200, { 'set-cookie': 'extra=only-in-test-a' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = configWithSession(server.baseUrl, `  api POST /login\n  expect status equals 200\n`);

  const source = `test "a bumps its own jar" as shopper
  api POST /bump
  expect status equals 200

  api GET /profile
  expect status equals 200
  expect body.cookie contains "extra=only-in-test-a"

test "b never sees a's bump" as shopper
  api GET /profile
  expect status equals 200
  expect body.cookie equals "session=tok-abc"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await server.close();
});

test('an explicit per-step `header "Cookie" is …` still overrides the jar (manual escape hatch preserved)', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=from-jar' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = testConfig(server.baseUrl);

  const source = `test "manual header wins over the jar"
  api POST /login
  expect status equals 200

  api GET /profile
    header "Cookie" is "session=manual-override"
  expect status equals 200
  expect body.cookie equals "session=manual-override"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await server.close();
});

test('Max-Age=0 in a later response deletes the cookie — the next request no longer sends it (a real logout)', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=tok-abc' }).end('{}'),
    '/logout': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=tok-abc; Max-Age=0' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = testConfig(server.baseUrl);

  const source = `test "logout clears the cookie"
  api POST /login
  expect status equals 200

  api POST /logout
  expect status equals 200

  api GET /profile
  expect status equals 200
  expect body.cookie equals null
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await server.close();
});

test('an action call shares the caller test\'s jar — a login inside an action updates cookies the caller\'s next step then sends', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=from-action' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = testConfig(server.baseUrl);

  const source = `action log in()
  api POST /login
  expect status equals 200
  give true

test "action's login cookie carries into the caller's own next step"
  let ok = log in()
  api GET /profile
  expect status equals 200
  expect body.cookie equals "session=from-action"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await server.close();
});
