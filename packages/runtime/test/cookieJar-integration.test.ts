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

/** An env declaring a second, named `api` service (SPEC §3.2) — the shape `B4-06` is about and the
 * one no cookie-jar test had before M88c2, which is why an unscoped jar survived this long. */
function configWithService(baseUrl: string, serviceName: string, serviceUrl: string): ResolvedConfig {
  const configSource = `env test default\n  api "${baseUrl}"\n  api ${serviceName} "${serviceUrl}"\n`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  const envBlock = selectEnv(parsed.config, {});
  return resolveConfig(parsed.config, envBlock);
}

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

// --- origin scoping through the interpreter (M88c2, `B4-06`, D-M88-7/8/9/12) --------------------
//
// The pair, per the plan's §4 parity rule: it is not enough that A's cookie reaches A. The failing
// half — that it does *not* reach B — is the entire finding, and asserting only the first half is
// how the unscoped jar passed its own tests for four milestones.

test('a cookie set by the default api service is not replayed to a second, named service — and vice versa', async () => {
  const serviceA = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=secret-for-a' }).end('{}'),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const serviceB = await startFixtureServer({
    '/warehouses': (req, res) => res.writeHead(200, { 'set-cookie': 'inventory=secret-for-b' }).end(JSON.stringify({ cookie: req.headers['cookie'] ?? null })),
    '/stock': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = configWithService(serviceA.baseUrl, 'inventory', serviceB.baseUrl);

  const source = `test "a's session never leaves a"
  api POST /login
  expect status equals 200

  api inventory GET /warehouses
  expect status equals 200
  expect body.cookie equals null

  api inventory GET /stock
  expect status equals 200
  expect body.cookie equals "inventory=secret-for-b"

  api GET /profile
  expect status equals 200
  expect body.cookie equals "session=secret-for-a"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await serviceA.close();
  await serviceB.close();
});

test('the step trace says when a request went out cookie-less because the jar is scoped elsewhere (D-M88-12)', async () => {
  const serviceA = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': 'session=secret-for-a' }).end('{}'),
  });
  const serviceB = await startFixtureServer({
    '/warehouses': (_req, res) => json(res, 200, { ok: true }),
  });
  const config = configWithService(serviceA.baseUrl, 'inventory', serviceB.baseUrl);

  const source = `test "cookie-less by scope"
  api inventory GET /warehouses
  expect status equals 200

  api POST /login
  expect status equals 200

  api inventory GET /warehouses
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const steps = report.tests[0]!.steps;
  const before = steps[0]!.detail ?? '';
  const after = steps[4]!.detail ?? '';
  assert.doesNotMatch(before, /no cookies for/, 'an empty jar is ordinary — the note must not fire before anything has been set');
  assert.match(after, /no cookies for http:\/\/127\.0\.0\.1:\d+ \(jar holds cookies for http:\/\/127\.0\.0\.1:\d+\)/);
  assert.doesNotMatch(after, /secret-for-a/, 'the note names origins, never values');

  await serviceA.close();
  await serviceB.close();
});

test('a login that sets its cookie on a 302 is remembered — the intermediate hop reaches the jar, not just the trace (`B4-15` end to end)', async () => {
  // M88c1 made the hop *observable*; this is the half that makes it matter. Before both, the
  // commonest login shape on earth — POST /login → 302 + Set-Cookie → /dashboard — silently lost
  // its session and every later step went out unauthenticated behind a green ✓.
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(302, { location: '/dashboard', 'set-cookie': 'session=set-on-the-302' }).end(),
    '/dashboard': (_req, res) => json(res, 200, { landed: true }),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = testConfig(server.baseUrl);

  const source = `test "the 302's cookie survives"
  api POST /login
  expect status equals 200

  api GET /profile
  expect status equals 200
  expect body.cookie equals "session=set-on-the-302"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await server.close();
});

test('a cookie set by a cross-origin redirect target is filed under the target, not under the service that was asked (D-M88-8)', async () => {
  // The step names service A; the cookie is set by B. Filing under the *requested* origin — the
  // only thing `execApi` knew before `cookieEvents` — would hand B's credential to A on the next
  // request, which is the cross-service replay origin scoping exists to stop, reintroduced by the
  // back door.
  const serviceB = await startFixtureServer({
    '/sso': (_req, res) => res.writeHead(200, { 'set-cookie': 'sso=issued-by-b' }).end('{}'),
    '/stock': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const serviceA = await startFixtureServer({
    '/handoff': (_req, res) => res.writeHead(302, { location: `${serviceB.baseUrl}/sso` }).end(),
    '/profile': (req, res) => json(res, 200, { cookie: req.headers['cookie'] ?? null }),
  });
  const config = configWithService(serviceA.baseUrl, 'inventory', serviceB.baseUrl);

  const source = `test "b's cookie belongs to b"
  api GET /handoff
  expect status equals 200

  api GET /profile
  expect status equals 200
  expect body.cookie equals null

  api inventory GET /stock
  expect status equals 200
  expect body.cookie equals "sso=issued-by-b"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  await serviceA.close();
  await serviceB.close();
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
