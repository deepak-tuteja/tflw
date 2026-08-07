// `M97c-03` — a `session` body's relative paths resolved against **whichever test file established
// the session**, not against the file the session is declared in.
//
// A session is declared once, in `tflw.config`, and runs at most once per run (`SessionCache`). But
// `runSession(decl, config, tc)` executes that shared body against the `TestCtx` of whichever test
// *file* happened to trigger it first, and the CLI builds each file's `tc` with
// `baseDir: dirname(file)`. So a single `tflw.config` line naming `./creds.json` meant a different
// absolute path per test file, and which one won was decided by run order — file sort order, or
// under `--workers N>1` a genuine race.
//
// This is the same class of defect decision 53 already fixed one field over: a session's `rng` used
// to come from `tc.rng` and was re-seeded from the session's own *name* precisely because `tc`
// "belongs to whichever test's `TestCtx` happened to win the race". `baseDir` and `filePath` are
// the two fields that were left behind.
//
// The fixture below is deliberately three directories, not two. Two would prove only that the
// answer changes with order; three proves the answer is *wrong* — none of the orders picks the
// config's own directory, which is the one file the session's author was looking at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram, SessionCache } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { ResolvedConfig } from '../src/types.js';
import { startFixtureServer, json } from './support.js';

/** `session admin` reads its credentials from a file — the one line whose meaning was ambiguous. */
function configWithFileBackedSession(baseUrl: string): ResolvedConfig {
  const source = `env test default
  api "${baseUrl}"

session admin
  api POST /auth/login body from "./creds.json"
  capture body.token as token
  header "Authorization" is "Bearer {token}"
`;
  const parsed = parseConfigSource(source);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  return resolveConfig(parsed.config, selectEnv(parsed.config, {}));
}

/** Two test files that both opt into the same session, run in a given order under one cache. */
async function runBothFiles(
  config: ResolvedConfig,
  configDir: string,
  first: string,
  second: string,
): Promise<void> {
  const sessionCache = new SessionCache();
  const source = `test "uses the session" as admin
  api GET /orders
  expect status equals 200
`;
  const { program } = parseSource(source);
  for (const baseDir of [first, second]) {
    await runProgram(program, config, { source, baseDir, configDir, sessionCache });
  }
}

test('a session\'s file-backed body resolves against the config directory, not whichever test file established it', async () => {
  // Three directories, each with its own `creds.json`. `configDir` is where `tflw.config` lives —
  // the only correct answer. `fileA`/`fileB` are two test files that both say `as admin`.
  const configDir = await mkdtemp(join(tmpdir(), 'tflw-sess-config-'));
  const fileA = await mkdtemp(join(tmpdir(), 'tflw-sess-a-'));
  const fileB = await mkdtemp(join(tmpdir(), 'tflw-sess-b-'));
  await writeFile(join(configDir, 'creds.json'), '{"who": "config"}');
  await writeFile(join(fileA, 'creds.json'), '{"who": "fileA"}');
  await writeFile(join(fileB, 'creds.json'), '{"who": "fileB"}');

  const server = await startFixtureServer({
    '/auth/login': (_req, res) => json(res, 200, { token: 'tok' }),
    '/orders': (_req, res) => json(res, 200, { ok: true }),
  });

  try {
    const config = configWithFileBackedSession(server.baseUrl);

    // The session is cached, so `/auth/login` is hit exactly once per order — by whichever file
    // got there first. Whose `creds.json` did it read?
    await runBothFiles(config, configDir, fileA, fileB);
    const afterAB = server.received.get('/auth/login')!.map((r) => r.body);

    server.received.delete('/auth/login');
    await runBothFiles(config, configDir, fileB, fileA);
    const afterBA = server.received.get('/auth/login')!.map((r) => r.body);

    assert.equal(afterAB.length, 1, 'the session cache should establish exactly once per run');
    assert.equal(afterBA.length, 1, 'the session cache should establish exactly once per run');

    // The defect, stated as the thing a user would notice: the same `tflw.config` line sends
    // different credentials depending on which test file ran first.
    assert.equal(
      afterAB[0],
      afterBA[0],
      'the same `session` declaration sent different bodies depending on test-file run order',
    );

    // And the stronger half: the file it reads is the one next to `tflw.config`, which is the file
    // the person who wrote `body from "./creds.json"` was actually looking at.
    assert.equal(afterAB[0], '{"who": "config"}');
  } finally {
    await server.close();
    await rm(configDir, { recursive: true, force: true });
    await rm(fileA, { recursive: true, force: true });
    await rm(fileB, { recursive: true, force: true });
  }
});

test('a relative mTLS `cert`/`key` resolves against the config, not against each test file', async () => {
  // The same defect, one config key over, and with a wider blast radius than the session row: mTLS
  // `cert`/`key` are per-`env` keys in `tflw.config` (SPEC §3.6) and `execApi` resolves them against
  // the *caller's* `baseDir` — so `cert "./certs/client.pem"`, which is SPEC §3.6's own example,
  // means `tests/certs/client.pem` for a test file under `tests/`. Not order-dependent like the
  // session case: just wrong, for every test file that does not sit beside `tflw.config`.
  //
  // Every existing test in `mtls.test.ts` passes an **absolute** path, which is exactly why a bug
  // in relative-path resolution could live under full end-to-end mTLS coverage. This asserts on the
  // resolved path in the error text rather than standing up a second CA — the resolution is the
  // whole claim, and a handshake would only prove it more slowly.
  const configDir = await mkdtemp(join(tmpdir(), 'tflw-mtls-config-'));
  const fileDir = join(configDir, 'tests');
  await mkdir(fileDir, { recursive: true });

  const parsed = parseConfigSource(
    `env test default\n  api "https://example.invalid"\n  cert "./certs/client.pem"\n  key "./certs/client.key"\n`,
  );
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  const config = resolveConfig(parsed.config, selectEnv(parsed.config, {}));

  try {
    const source = `test "any request at all"
  api GET /health
`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source, baseDir: fileDir, configDir });

    // The certs do not exist anywhere, so this fails either way — the question is *which path* it
    // says it looked in. That string is the bug, and it is also what a user would file a report about.
    const message = JSON.stringify(report.tests[0]);
    assert.ok(
      message.includes(join(configDir, 'certs', 'client.pem')),
      `mTLS cert resolved against the test file's directory, not the config's:\n${message}`,
    );
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test('a test body\'s own relative paths still resolve against the test file, not the config', async () => {
  // The soundness half. The fix rebases *session* bodies only; rebasing ordinary test steps too
  // would silently break every existing suite whose fixtures sit next to the `.tflw` file. This is
  // the control that would catch that — it fails if the new base leaks past the session frame.
  const configDir = await mkdtemp(join(tmpdir(), 'tflw-own-config-'));
  const fileDir = await mkdtemp(join(tmpdir(), 'tflw-own-file-'));
  await writeFile(join(configDir, 'order.json'), '{"from": "config"}');
  await writeFile(join(fileDir, 'order.json'), '{"from": "testfile"}');

  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  try {
    const parsed = parseConfigSource(`env test default\n  api "${server.baseUrl}"\n`);
    assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
    const config = resolveConfig(parsed.config, selectEnv(parsed.config, {}));

    const source = `test "posts its own fixture"
  api POST /orders body from "./order.json"
  expect status equals 201
`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source, baseDir: fileDir, configDir });

    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    assert.equal(server.received.get('/orders')![0]!.body, '{"from": "testfile"}');
  } finally {
    await server.close();
    await rm(configDir, { recursive: true, force: true });
    await rm(fileDir, { recursive: true, force: true });
  }
});
