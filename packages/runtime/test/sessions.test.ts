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

// Two independent, unrelated sessions (M14/M15's `as admin, userA` — a test can opt into several
// at once): `admin` is a bearer session (same as `configWithSession`'s default); `shopper` is a
// cookie session, so a test opting into both proves headers and cookies from *different* sessions
// both land on the same outgoing request.
function configWithTwoSessions(baseUrl: string): ResolvedConfig {
  const configSource = `env test default
  api "${baseUrl}"

session admin
  api POST /auth/login body { user: "a", pass: "b" }
  capture body.token as token
  header "Authorization" is "Bearer {token}"

session shopper
  api POST /shopper/login
`;
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

  // Bypass the checker by hand-building a TestDecl whose session isn't declared in config.
  const { program } = parseSource(`test "ok"\n  api GET /orders\n  expect status equals 200\n`);
  const bad = { ...program, tests: [{ ...program.tests[0]!, sessions: ['ghost'] }] };
  const { report } = await runProgram(bad, config, { source: '' });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /unknown session "ghost"/);

  await server.close();
});

// M15/gap #7: `test "..." as admin, userA` — several independent, unrelated sessions opted into
// at once. Merge rule: later-listed session wins any header/cookie-name conflict against an
// earlier one (same "later source replaces" rule the whole precedence chain already follows).

test('a test opting into two independent sessions gets both sessions\' headers and cookies on the same request', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/shopper/login': (_req, res) => {
      res.setHeader('Set-Cookie', 'shopper_id=abc123');
      json(res, 200, {});
    },
    '/orders': (req, res) =>
      json(res, 200, { auth: req.headers['authorization'] ?? null, cookie: req.headers['cookie'] ?? null }),
  });
  const config = configWithTwoSessions(server.baseUrl);

  const source = `test "reads orders as both admin and shopper" as admin, shopper
  api GET /orders
  expect status equals 200
  expect body.auth equals "Bearer tok-123"
  expect body.cookie equals "shopper_id=abc123"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/auth/login')!.length, 1);
  assert.equal(server.received.get('/shopper/login')!.length, 1);

  await server.close();
});

test('a later-listed session wins a header-name conflict against an earlier one', async () => {
  const server = await startFixtureServer({
    '/first/login': (_req, res) => json(res, 200, {}),
    '/second/login': (_req, res) => json(res, 200, {}),
    '/whoami': (req, res) => json(res, 200, { actor: req.headers['x-actor'] ?? null }),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session first
  api POST /first/login
  header "X-Actor" is "first"

session second
  api POST /second/login
  header "X-Actor" is "second"
`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, []);
  const config = resolveConfig(parsed.config, selectEnv(parsed.config, {}));

  const source = `test "second wins, listed last" as first, second
  api GET /whoami
  expect status equals 200
  expect body.actor equals "second"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  // Reversed opt-in order flips the winner too — confirms this is genuinely "later in the `as`
  // list", not e.g. "whichever session declares last in tflw.config".
  const reversedSource = `test "first wins when listed last instead" as second, first
  api GET /whoami
  expect status equals 200
  expect body.actor equals "first"
`;
  const { program: reversedProgram } = parseSource(reversedSource);
  const { report: reversedReport } = await runProgram(reversedProgram, config, { source: reversedSource });
  assert.equal(reversedReport.ok, true, JSON.stringify(reversedReport.tests, null, 2));

  await server.close();
});

test('each session in a multi-session opt-in is still only shown once across the whole run, independently per name', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/shopper/login': (_req, res) => {
      res.setHeader('Set-Cookie', 'shopper_id=abc123');
      json(res, 200, {});
    },
    '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
    '/profile': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  const config = configWithTwoSessions(server.baseUrl);

  // "first" opts into only `admin`; "second" opts into both — `admin` must still only ever log in
  // once across the two tests (cached), and `shopper` (never used by "first") logs in exactly
  // once too, its steps spliced only into whichever test actually owns that name.
  const source = `test "first" as admin
  api GET /orders
  expect status equals 200

test "second" as admin, shopper
  api GET /profile
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/auth/login')!.length, 1, 'admin must log in exactly once, shared across both tests');
  assert.equal(server.received.get('/shopper/login')!.length, 1, 'shopper must log in exactly once');

  const firstKinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.deepEqual(firstKinds, ['api', 'capture', 'header', 'api', 'expect'], '"first" owns admin\'s splice (it opted in first)');

  const secondKinds = report.tests[1]!.steps.map((s) => s.kind);
  assert.deepEqual(secondKinds, ['api', 'api', 'expect'], '"second" does not re-show admin\'s steps, but does own shopper\'s splice (a bare `api` step, no capture/header)');

  await server.close();
});

// Decision 3a (enterprise arc): a 401 while using a cached session's headers auto re-establishes
// that session and retries the failing request once — not just `oauth2` sessions get this, every
// hand-written `session` does too, since the trigger is the response status, not the session kind.

test('a 401 while using a cached session auto re-establishes the session and retries the request once', async () => {
  let loginCount = 0;
  let validToken = '';
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      validToken = `tok-${loginCount}`;
      json(res, 200, { token: validToken });
    },
    '/orders': (req, res) => {
      if (req.headers['authorization'] === `Bearer ${validToken}`) json(res, 200, { auth: req.headers['authorization'] });
      else res.writeHead(401).end();
    },
  });
  const config = configWithSession(server.baseUrl);
  const sessionCache = new SessionCache();

  const sourceA = `test "first" as admin\n  api GET /orders\n  expect status equals 200\n`;
  const { program: programA } = parseSource(sourceA);
  const { report: reportA } = await runProgram(programA, config, { source: sourceA, sessionCache });
  assert.equal(reportA.ok, true, JSON.stringify(reportA.tests, null, 2));
  assert.equal(loginCount, 1);

  // Simulate the token being revoked/rotated server-side between runs (e.g. an admin session
  // expiring out from under the client) — the cache still holds the now-stale `Bearer tok-1`.
  validToken = 'rotated-away';

  const sourceB = `test "second" as admin\n  api GET /orders\n  expect status equals 200\n  expect body.auth equals "Bearer tok-2"\n`;
  const { program: programB } = parseSource(sourceB);
  const { report: reportB } = await runProgram(programB, config, { source: sourceB, sessionCache });

  assert.equal(reportB.ok, true, JSON.stringify(reportB.tests, null, 2));
  assert.equal(loginCount, 2, 'the 401 must have triggered exactly one re-login');
  assert.equal(server.received.get('/orders')!.length, 3, 'test A: 1 request; test B: 1 failing (401) + 1 retried (200)');

  await server.close();
});

test('when re-establishing the session after a 401 itself fails, the original 401 stands and the test fails clearly', async () => {
  let loginCount = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      if (loginCount === 1) {
        json(res, 200, { token: 'tok-1' });
        return;
      }
      res.writeHead(500).end();
    },
    // Always 401s — simulates a credential that's been revoked for a reason re-auth can't fix.
    '/orders': (_req, res) => res.writeHead(401).end(),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "always 401" as admin\n  api GET /orders\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.equal(loginCount, 2, 'establish once, one re-establish attempt on the 401 — never left uninvestigated');
  const kinds = report.tests[0]!.steps.map((s) => s.kind);
  assert.ok(kinds.includes('header'), 'a synthetic step records the failed re-establish attempt as evidence');
  assert.equal(server.received.get('/orders')!.length, 1, 'the re-establish itself failed, so the api step is never retried');

  await server.close();
});

test('a 401 that persists even after successfully re-establishing the session is retried only once, then fails', async () => {
  let loginCount = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      json(res, 200, { token: `tok-${loginCount}` });
    },
    // Always 401s regardless of the token — e.g. the account itself lost access, re-auth can't help.
    '/orders': (_req, res) => res.writeHead(401).end(),
  });
  const config = configWithSession(server.baseUrl);

  const source = `test "always 401" as admin\n  api GET /orders\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.equal(loginCount, 2, 'establish once, retry-refresh once — never an unbounded retry loop');
  assert.equal(server.received.get('/orders')!.length, 2, 'the original request plus exactly one retry, never more');

  await server.close();
});

test('an anonymous test never triggers a session refresh on its own 401 (it has no session to refresh)', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => res.writeHead(401).end() });
  const config = configWithSession(server.baseUrl);

  const source = `test "anonymous, 401"\n  api GET /orders\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.equal(server.received.get('/orders')!.length, 1, 'no session to refresh, so no retry — one request, one clean failure');

  await server.close();
});

test('an unknown session among several opted into fails clearly, even when the others are valid', async () => {
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok-123' }),
    '/orders': (_req, res) => json(res, 200, {}),
  });
  const config = configWithSession(server.baseUrl);

  // Bypass the checker (same pattern as the single-session "unknown session" test above) — the
  // checker normally catches this at parse time; this proves the runtime's own defense is
  // per-name, not "first bad name in the list aborts silently."
  const { program } = parseSource(`test "ok"\n  api GET /orders\n  expect status equals 200\n`);
  const bad = { ...program, tests: [{ ...program.tests[0]!, sessions: ['admin', 'ghost'] }] };
  const { report } = await runProgram(bad, config, { source: '' });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /unknown session "ghost"/);

  await server.close();
});

test('M102/A4-OS-11: a session `header` line interpolates its NAME, not only its value', async () => {
  // `header "Authorization" is "Bearer {token}"` above has interpolated its *value* since M2.6.
  // The name was read literally until M102, so a session naming a header from a captured value —
  // a per-tenant trace header, an API that names its key after the account — sent a header whose
  // name contained braces, and the checker had been binding those `{var}`s the whole time.
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 't0k', hdr: 'X-Acme-Key' }),
    '/orders': (req, res) =>
      json(res, 200, {
        interpolated: req.headers['x-acme-key'] ?? null,
        literal: req.headers['{keyName}'] ?? null,
      }),
  });

  const config = configWithSession(
    server.baseUrl,
    `  api POST /auth/login body { user: "a", pass: "b" }\n  capture body.hdr as keyName\n  header "{keyName}" is "secret-value"\n`,
  );
  const source = `test "t" as admin\n  api GET /orders\n  expect body.interpolated equals "secret-value"\n  expect body.literal equals null\n`;
  const { program } = parseSource(source);
  const run = await runProgram(program, config, { source, seed: 1, sessionCache: new SessionCache() });

  assert.equal(run.report.tests[0]!.ok, true, JSON.stringify(run.report.tests[0]!.steps));
  await server.close();
});

// `B3-18` (M117) — a reactive 401 re-establish is a *whole login* against a different endpoint. It
// already reports itself as its own step, and `recordEndpointMetrics` feeds every `api` step's
// `durationMs` straight into that endpoint's histogram — which is what `threshold … for "label"`
// reads. So billing the refresh to whichever endpoint happened to trigger it puts a login inside
// that endpoint's latency sample. Same defect shape as `B3-02`, one indirection further out.
//
// These three are deliberately *timing* assertions, because the defect is a duration and nothing
// else observes it. The margins are wide (a 300ms login, a <150ms bound on a localhost request that
// really takes ~2ms) so that a loaded CI box cannot flip them; the paired assertion that the
// refresh step itself took >=250ms is what stops the whole test passing vacuously if the fixture
// ever stops being slow.
const B318_LOGIN_MS = 300;

/** A fixture whose login is expensive and whose work endpoint is not, so "did a login end up inside
 * this endpoint's sample?" is answerable by looking at one number. */
async function slowLoginFixture(work: (token: string) => Parameters<typeof startFixtureServer>[0][string]) {
  let loginCount = 0;
  let validToken = '';
  const server = await startFixtureServer({
    '/auth/login': async (_req, res) => {
      loginCount++;
      validToken = `tok-${loginCount}`;
      await new Promise((r) => setTimeout(r, B318_LOGIN_MS));
      json(res, 200, { token: validToken });
    },
    '/work': (req, res) => work(validToken)(req, res),
  });
  return { server, rotate: () => { validToken = 'rotated-away'; }, logins: () => loginCount };
}

const authed = (token: string) => (req: Parameters<Parameters<typeof startFixtureServer>[0][string]>[0], res: Parameters<Parameters<typeof startFixtureServer>[0][string]>[1]) => {
  if (req.headers['authorization'] === `Bearer ${token}`) json(res, 200, { ok: true });
  else res.writeHead(401).end();
};

test('B3-18: a reactive 401 re-establish is not billed to the endpoint whose request triggered it', async () => {
  const { server, rotate, logins } = await slowLoginFixture(authed);
  const config = configWithSession(server.baseUrl);
  const sessionCache = new SessionCache();

  const srcA = `test "establish" as admin\n  api GET /work\n  expect status equals 200\n`;
  const { program: pA } = parseSource(srcA);
  const { report: rA } = await runProgram(pA, config, { source: srcA, sessionCache });
  assert.equal(rA.ok, true, JSON.stringify(rA.tests, null, 2));

  rotate(); // the cached token is now stale server-side → the next /work 401s

  const srcB = `test "refreshes" as admin\n  api GET /work\n  expect status equals 200\n`;
  const { program: pB } = parseSource(srcB);
  const { report: rB } = await runProgram(pB, config, { source: srcB, sessionCache });
  assert.equal(rB.ok, true, JSON.stringify(rB.tests, null, 2));
  assert.equal(logins(), 2, 'the 401 must have triggered exactly one re-login');

  const steps = rB.tests[0]!.steps;
  const workStep = steps.find((s) => s.kind === 'api' && s.endpoint === 'GET /work');
  const refreshStep = steps.find((s) => s.kind === 'header' && (s.detail ?? '').includes('re-established'));

  assert.ok(refreshStep, `the refresh must report itself as its own step: ${JSON.stringify(steps, null, 2)}`);
  // Guards the test against passing for the wrong reason: if the fixture's login ever stops being
  // slow, the assertion below stops being able to fail and this one says so first.
  assert.ok(
    refreshStep!.durationMs >= B318_LOGIN_MS - 50,
    `the refresh step must carry the login's real cost, got ${refreshStep!.durationMs}ms`,
  );
  assert.ok(workStep, 'the retried request must still be reported as an api step for GET /work');
  assert.ok(
    workStep!.durationMs < 150,
    `GET /work answers in ~2ms; a ${B318_LOGIN_MS}ms login must not be inside its latency sample, got ${workStep!.durationMs}ms`,
  );

  await server.close();
});

test('B3-18 control: with no 401 the endpoint duration is measured from the start of the step, unchanged', async () => {
  // The other half of the pair. Without this, the assertion above is satisfied by any change that
  // makes durations small for every reason, including a broken clock.
  const { server, logins } = await slowLoginFixture(authed);
  const config = configWithSession(server.baseUrl);
  const sessionCache = new SessionCache();

  const src = `test "no refresh" as admin\n  api GET /work\n  expect status equals 200\n`;
  const { program } = parseSource(src);
  const { report } = await runProgram(program, config, { source: src, sessionCache });
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(logins(), 1, 'the initial establish only — no reactive refresh in this run');

  const steps = report.tests[0]!.steps;
  assert.equal(steps.some((s) => s.kind === 'header' && (s.detail ?? '').includes('re-established')), false);
  const workStep = steps.find((s) => s.kind === 'api' && s.endpoint === 'GET /work');
  assert.ok(workStep, 'GET /work must be reported');
  assert.ok(workStep!.durationMs < 150, `got ${workStep!.durationMs}ms`);

  // The establish's own login *is* billed to its own endpoint, which is the behaviour the fix must
  // not disturb: only the reactive path is re-based.
  const loginStep = steps.find((s) => s.kind === 'api' && s.endpoint === 'POST /auth/login');
  assert.ok(loginStep, 'the initial establish reports its login as its own api step');
  assert.ok(
    loginStep!.durationMs >= B318_LOGIN_MS - 50,
    `the establish's login keeps its real duration, got ${loginStep!.durationMs}ms`,
  );

  await server.close();
});

test('B3-18: when the re-establish itself fails, the 401 attempt is still not billed for it', async () => {
  // The `refresh.ok === false` branch: no retry happens, so the 401 attempt *is* this step's
  // sample — but a failed re-establish costs just as much real time as a successful one and is no
  // more this endpoint's latency.
  let loginCount = 0;
  let revoked = false;
  const server = await startFixtureServer({
    '/auth/login': async (_req, res) => {
      loginCount++;
      await new Promise((r) => setTimeout(r, B318_LOGIN_MS));
      if (loginCount === 1) json(res, 200, { token: 'tok-1' });
      else res.writeHead(500).end(); // the re-establish cannot succeed
    },
    '/work': (req, res) => {
      if (!revoked && req.headers['authorization'] === 'Bearer tok-1') json(res, 200, { ok: true });
      else res.writeHead(401).end();
    },
  });
  const config = configWithSession(server.baseUrl);
  const sessionCache = new SessionCache();

  const srcA = `test "establish" as admin\n  api GET /work\n  expect status equals 200\n`;
  const { program: pA } = parseSource(srcA);
  const { report: rA } = await runProgram(pA, config, { source: srcA, sessionCache });
  assert.equal(rA.ok, true, 'the establish run must succeed before the credential is revoked');
  revoked = true; // now every /work 401s, and the re-establish that follows cannot succeed

  const srcB = `test "refresh fails" as admin\n  api GET /work\n  expect status equals 200\n`;
  const { program: pB } = parseSource(srcB);
  const { report: rB } = await runProgram(pB, config, { source: srcB, sessionCache });
  assert.equal(rB.ok, false, 'a persistent 401 with a broken re-establish still fails the test');
  assert.equal(loginCount, 2, 'exactly one re-establish attempt, and it failed');

  const steps = rB.tests[0]!.steps;
  const failedRefresh = steps.find((s) => s.kind === 'header' && !s.ok);
  assert.ok(failedRefresh, `the failed re-establish reports itself: ${JSON.stringify(steps, null, 2)}`);
  assert.ok(
    failedRefresh!.durationMs >= B318_LOGIN_MS - 50,
    `the failed refresh carries its own cost, got ${failedRefresh!.durationMs}ms`,
  );
  const workStep = steps.find((s) => s.kind === 'api' && s.endpoint === 'GET /work');
  assert.ok(workStep, 'the 401 attempt is still reported as an api step');
  assert.ok(
    workStep!.durationMs < 150,
    `the 401 attempt itself took ~2ms; the failed refresh must not be inside its sample, got ${workStep!.durationMs}ms`,
  );

  await server.close();
});

// -- M137b/D433: `csrf from … send as header "…"` -------------------------------------------------
//
// The verb-conditional half is the whole reason this token does not live in `SessionOutcome.headers`
// (D433/D434), so it is asserted in both directions from one run rather than only the positive one:
// a header that arrived on the `POST` proves the wiring, and the *same* header absent from the `GET`
// proves the channel is doing the thing it was separated out to do.

function configWithCsrfSession(baseUrl: string): ResolvedConfig {
  const configSource = `env test default\n  api "${baseUrl}"\n\nsession shopper\n  api POST /shopper/login\n  csrf from body.csrfToken send as header "X-CSRF-Token"\n`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  const envBlock = selectEnv(parsed.config, {});
  return resolveConfig(parsed.config, envBlock);
}

test('D433: the captured token rides mutating requests and stays off safe ones', async () => {
  const seen: Record<string, string | null> = {};
  const server = await startFixtureServer({
    '/shopper/login': (_req, res) => json(res, 200, { csrfToken: 'csrf-abc' }),
    '/orders': (req, res) => {
      seen[req.method!] = (req.headers['x-csrf-token'] as string | undefined) ?? null;
      return json(res, req.method === 'GET' ? 200 : 201, {});
    },
  });
  const config = configWithCsrfSession(server.baseUrl);

  const source = `test "mutates and reads" as shopper
  api GET /orders
  expect status equals 200
  api POST /orders body { a: 1 }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(seen['POST'], 'csrf-abc', 'a mutating request must carry the token the session captured');
  assert.equal(seen['GET'], null, 'a safe request must not — a browser does not send one, and an app may reject it');

  await server.close();
});

test('D433: an explicit per-step header still wins, so a deliberate wrong token stays writable', async () => {
  // The precedence that keeps hand-written negative tests expressible on a session that declares the
  // clause — `tests/api/identity/sessions.tflw` is exactly that shape, and D454 keeps it hand-written.
  let sent: string | undefined;
  const server = await startFixtureServer({
    '/shopper/login': (_req, res) => json(res, 200, { csrfToken: 'csrf-abc' }),
    '/orders': (req, res) => {
      sent = req.headers['x-csrf-token'] as string | undefined;
      return json(res, 201, {});
    },
  });
  const config = configWithCsrfSession(server.baseUrl);

  const source = `test "sends its own" as shopper
  api POST /orders body { a: 1 }
    header "X-CSRF-Token" is "deliberately-wrong"
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(sent, 'deliberately-wrong');

  await server.close();
});

test('D456: a `csrf from` path the login response cannot produce fails the session loudly', async () => {
  // This throw is where D443's `TF069` went. The property being asserted is that it is *loud*: the
  // session fails, so the test fails, so no probe ever runs against an unjudged mutating surface.
  // Binding `undefined` here would have sent the literal text "undefined" as the token, which an app
  // rejects for the right reason by accident — a broken clause reading as a working CSRF defence.
  const server = await startFixtureServer({
    '/shopper/login': (_req, res) => json(res, 200, { token: 'no-csrf-field-here' }),
    '/orders': (_req, res) => json(res, 201, {}),
  });
  const config = configWithCsrfSession(server.baseUrl);

  const source = `test "never gets there" as shopper\n  api POST /orders body { a: 1 }\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false, 'a mis-typed capture path must not produce a green run');
  const error = JSON.stringify(report.tests);
  assert.match(error, /no CSRF token at/);
  assert.equal(server.received.get('/orders'), undefined, 'the mutating request must never have been sent');

  await server.close();
});
