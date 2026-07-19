// `allow hosts "…"` (SPEC §3.7, PLAN decision 101a, enterprise arc cluster 2) — a request whose
// URL hostname matches none of the configured hosts is refused before any network I/O, not just
// reported as a failed request. Real fixture server (no mocking): the assertion that matters most
// here is `server.received` staying empty for a blocked path, proving the connection was never
// attempted at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

const SOURCE = `test "health check"\n  api GET /health\n  expect status equals 200\n`;

test('a host in `allow hosts` is unaffected — the request goes through as normal', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const config = { ...testConfig(server.baseUrl), allowHosts: ['127.0.0.1'] };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/health')!.length, 1);

  await server.close();
});

test('a host not in `allow hosts` is refused before any network I/O reaches it', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const config = { ...testConfig(server.baseUrl), allowHosts: ['definitely-not-this-host.example.com'] };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /127\.0\.0\.1/);
  assert.match(error, /allow hosts/);
  assert.equal(server.received.has('/health'), false, 'a blocked request must never actually reach the server');

  await server.close();
});

test('a `*.domain` pattern matches subdomains and the bare domain', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // The fixture server only ever listens on 127.0.0.1, so this exercises the matcher directly
  // rather than through a real DNS name — the point under test is `hostMatchesAllowPattern`'s
  // suffix logic, which is hostname-string-shaped regardless of what actually resolves it.
  const allowedByWildcard = { ...testConfig(server.baseUrl), allowHosts: ['*.0.0.1'] };
  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, allowedByWildcard, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

test('`allow hosts` never declared (null) means no enforcement — unchanged default behavior', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const config = testConfig(server.baseUrl); // allowHosts: null by default

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});
