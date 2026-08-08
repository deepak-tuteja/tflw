// `session <name> oauth2 ...` — OAuth2 client-credentials sugar (SPEC §3.3, decision 3c,
// enterprise arc). The runtime POSTs the client-credentials grant to `token url`, turns
// `access_token` into the session's `Authorization: Bearer` header the same way a hand-written
// session's `header` step would, and (when the server sends one) turns `expires_in` into the
// session cache's refresh TTL (decision 3a's proactive half — the reactive, 401-triggered half is
// exercised in sessions.test.ts and applies to every session, not just this sugar).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram, SessionCache } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { ResolvedConfig } from '../src/types.js';
import { startFixtureServer, json } from './support.js';

function configWithOauth2Session(baseUrl: string, tokenPath = '/oauth/token'): ResolvedConfig {
  const configSource = `env test default
  api "${baseUrl}"

session admin oauth2
  token url "${baseUrl}${tokenPath}"
  client id env(CLIENT_ID)
  client secret env(CLIENT_SECRET)

require env CLIENT_ID, CLIENT_SECRET
`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  const envBlock = selectEnv(parsed.config, {});
  return resolveConfig(parsed.config, envBlock);
}

async function withClientCreds<T>(id: string, secret: string, fn: () => Promise<T>): Promise<T> {
  process.env.CLIENT_ID = id;
  process.env.CLIENT_SECRET = secret;
  try {
    return await fn();
  } finally {
    delete process.env.CLIENT_ID;
    delete process.env.CLIENT_SECRET;
  }
}

test('an oauth2 session POSTs the client-credentials grant and applies a Bearer header', () =>
  withClientCreds('id-1', 'secret-1', async () => {
    const server = await startFixtureServer({
      '/oauth/token': (req, res, body) => {
        assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
        assert.match(body, /grant_type=client_credentials/);
        assert.match(body, /client_id=id-1/);
        assert.match(body, /client_secret=secret-1/);
        json(res, 200, { access_token: 'tok-abc', expires_in: 3600 });
      },
      '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
    });
    const config = configWithOauth2Session(server.baseUrl);

    const source = `test "reads orders" as admin\n  api GET /orders\n  expect status equals 200\n  expect body.auth equals "Bearer tok-abc"\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    assert.equal(server.received.get('/oauth/token')!.length, 1);

    await server.close();
  }));

test('a `scope` line is included in the client-credentials request when given', () =>
  withClientCreds('id-1', 'secret-1', async () => {
    let receivedBody = '';
    const server = await startFixtureServer({
      '/oauth/token': (_req, res, body) => {
        receivedBody = body;
        json(res, 200, { access_token: 'tok-abc' });
      },
      '/orders': (_req, res) => json(res, 200, {}),
    });
    const configSource = `env test default
  api "${server.baseUrl}"

session admin oauth2
  token url "${server.baseUrl}/oauth/token"
  client id env(CLIENT_ID)
  client secret env(CLIENT_SECRET)
  scope "read write"

require env CLIENT_ID, CLIENT_SECRET
`;
    const parsed = parseConfigSource(configSource);
    assert.deepEqual(parsed.diagnostics, []);
    const config = resolveConfig(parsed.config, selectEnv(parsed.config, {}));

    const source = `test "reads orders" as admin\n  api GET /orders\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    assert.match(receivedBody, /scope=read\+write/);

    await server.close();
  }));

test('an oauth2 session with no `expires_in` in the response never proactively expires (only the reactive 401 refresh applies)', () =>
  withClientCreds('id-1', 'secret-1', async () => {
    let tokenCount = 0;
    const server = await startFixtureServer({
      '/oauth/token': (_req, res) => {
        tokenCount++;
        json(res, 200, { access_token: `tok-${tokenCount}` }); // no expires_in
      },
      '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
    });
    const config = configWithOauth2Session(server.baseUrl);
    const sessionCache = new SessionCache();

    for (const label of ['first', 'second']) {
      const source = `test "${label}" as admin\n  api GET /orders\n  expect status equals 200\n  expect body.auth equals "Bearer tok-1"\n`;
      const { program } = parseSource(source);
      const { report } = await runProgram(program, config, { source, sessionCache });
      assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    }
    assert.equal(tokenCount, 1, 'no `expires_in` means no TTL — the token is reused, not re-fetched');

    await server.close();
  }));

test("an oauth2 session's `expires_in` TTL causes a proactive re-fetch once it has passed", () =>
  withClientCreds('id-1', 'secret-1', async () => {
    let tokenCount = 0;
    const server = await startFixtureServer({
      '/oauth/token': (_req, res) => {
        tokenCount++;
        json(res, 200, { access_token: `tok-${tokenCount}`, expires_in: 0 });
      },
      '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
    });
    const config = configWithOauth2Session(server.baseUrl);
    const sessionCache = new SessionCache();

    const sourceA = `test "first" as admin\n  api GET /orders\n  expect status equals 200\n  expect body.auth equals "Bearer tok-1"\n`;
    const { program: programA } = parseSource(sourceA);
    const { report: reportA } = await runProgram(programA, config, { source: sourceA, sessionCache });
    assert.equal(reportA.ok, true, JSON.stringify(reportA.tests, null, 2));

    await new Promise((r) => setTimeout(r, 20)); // let the (already-expired-at-0s) TTL pass

    const sourceB = `test "second" as admin\n  api GET /orders\n  expect status equals 200\n  expect body.auth equals "Bearer tok-2"\n`;
    const { program: programB } = parseSource(sourceB);
    const { report: reportB } = await runProgram(programB, config, { source: sourceB, sessionCache });
    assert.equal(reportB.ok, true, JSON.stringify(reportB.tests, null, 2));

    assert.equal(tokenCount, 2, 'the TTL expiring must trigger a proactive re-fetch, not a reused stale token');

    await server.close();
  }));

test('an oauth2 token request that fails (non-2xx) fails every test opting into it, with a clear error', () =>
  withClientCreds('id-1', 'wrong-secret', async () => {
    const server = await startFixtureServer({
      '/oauth/token': (_req, res) => json(res, 401, { error: 'invalid_client' }),
      '/orders': (_req, res) => json(res, 200, {}),
    });
    const config = configWithOauth2Session(server.baseUrl);

    const source = `test "never runs" as admin\n  api GET /orders\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, false);
    assert.match(report.tests[0]!.error ?? '', /session "admin" failed to establish/);
    assert.equal(server.received.has('/orders'), false, 'the test body must never run once its session fails');

    await server.close();
  }));

test('a token response missing `access_token` fails the session clearly', () =>
  withClientCreds('id-1', 'secret-1', async () => {
    const server = await startFixtureServer({
      '/oauth/token': (_req, res) => json(res, 200, { ok: true }), // no access_token
    });
    const config = configWithOauth2Session(server.baseUrl);

    const source = `test "never runs" as admin\n  api GET /orders\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, false);
    assert.match(report.tests[0]!.error ?? '', /access_token/);

    await server.close();
  }));

test("the oauth2 client secret never appears in the report's recorded evidence", () =>
  withClientCreds('id-1', 'super-secret-value', async () => {
    const server = await startFixtureServer({
      '/oauth/token': (_req, res) => json(res, 200, { access_token: 'tok-abc', expires_in: 3600 }),
      '/orders': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
    });
    const config = configWithOauth2Session(server.baseUrl);

    const source = `test "reads orders" as admin\n  api GET /orders\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /super-secret-value/);
    assert.match(serialized, /•••\(CLIENT_SECRET\)/, 'the redaction placeholder must appear instead');

    await server.close();
  }));

// `M111` (`FU-06`) — the `oauth2` arm was not merely carrying the caller's `lines`; it never saw
// `sessionCtx` at all. `runSession` split on `decl.oauth2` *before* deriving the session's context,
// so M97c-03's `baseDir`/`filePath` rebase applied only to hand-written sessions and this whole
// branch kept the establishing test file's `baseDir`, `filePath` and text. Nothing in that
// derivation is specific to a hand-written body — both arms declare their steps in `tflw.config`
// and both report them — so M111 moved the split below the derivation, and this is the test that
// says so. It is worth its own case because the two arms build their step through entirely
// separate code (`execSteps` vs. `runOauth2Session`'s hand-rolled `mkStep`): fixing one says
// nothing about the other.
test('an oauth2 session step reports its own `tflw.config` line, not the establishing test file\'s', () =>
  withClientCreds('id-1', 'secret-1', async () => {
    const server = await startFixtureServer({
      '/oauth/token': (_req, res) => json(res, 200, { access_token: 'tok-abc', expires_in: 3600 }),
      '/orders': (_req, res) => json(res, 200, { ok: true }),
    });
    const configSource = `env test default
  api "${server.baseUrl}"

session admin oauth2
  token url "${server.baseUrl}/oauth/token"
  client id env(CLIENT_ID)
  client secret env(CLIENT_SECRET)
`;
    const parsed = parseConfigSource(configSource);
    assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
    const config = resolveConfig(parsed.config, selectEnv(parsed.config, {}));
    const configLines = configSource.split(/\r?\n/);

    // The oauth2 block's span starts at its `session admin oauth2` header — line 4 — so line 4 is
    // the one that has to carry a decoy. The first draft of this test padded lines 5-7 and left 4
    // blank, which made it **pass on the unfixed code**: the old behaviour read the test file's
    // blank line 4, and `''` matched `tflw.config`'s own blank line 3. A control that cannot fail
    // is a passing test of nothing, so every line from 4 down carries text now, and the assertion
    // below names the one string it must be rather than asking for membership in a set that
    // contains the empty string.
    const source = `test "reads orders" as admin
  api GET /orders
  expect status equals 200
# DECOY line 4 — belongs to the test file, never to a session step
# DECOY line 5 — belongs to the test file, never to a session step
# DECOY line 6 — belongs to the test file, never to a session step
# DECOY line 7 — belongs to the test file, never to a session step
`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source, configLines });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    const steps = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps : [];
    const tokenStep = steps[0]!;
    assert.equal(tokenStep.source, 'session admin oauth2');
    assert.ok(configLines.map((l) => l.trim()).includes(tokenStep.source));

    await server.close();
  }));
