// `expect`/`check request connects`/`fails` (SPEC §6.2.2, PLAN decision 18, enterprise arc
// cluster 5.5). `mtls.test.ts` already reuses its own real-TLS-rejection fixture to prove the
// headline scenario (a `.tflw` file that previously crashed the run now passes green); this file
// covers the rest of the matcher's own behavior in isolation — ECONNREFUSED, `allow hosts`,
// `matching`, negation, the checker-enforced combine rule surfacing as a real runtime crash if
// ever bypassed, and `capture request` being rejected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('`expect request fails` passes green for a real ECONNREFUSED — nothing is listening on the port', async () => {
  // Start a real server, grab its ephemeral port, then close it — the port is refused, not
  // merely unrouted, exactly like a real "service is down" scenario.
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  expect request fails matching "ECONNREFUSED|connection refused"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('`expect request connects` fails, with a clear message, when the connection was refused', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  expect request connects\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expected request to connect, but got:.*connection refused/s);
});

test('`expect request fails` passes for an `allow hosts` block — the request never leaves the process', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const config = { ...testConfig(server.baseUrl), allowHosts: ['definitely-not-this-host.example.com'] };
    const source = `test "health check"\n  api GET /health\n  expect request fails matching "allow hosts"\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  } finally {
    await server.close();
  }
});

test('a bare `fails` (no `matching`) passes regardless of the specific failure reason', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  expect request fails\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('`fails matching` fails (with both the expected pattern and the real reason in the message) when the reason does not match', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  expect request fails matching "this text will never appear"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /to fail matching "this text will never appear", but got:.*connection refused/s);
});

test('`not connects` behaves exactly like a bare `fails` (generic negation composes, decision 18.1)', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  expect request not connects\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('`not fails` behaves exactly like a bare `connects`', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const config = testConfig(server.baseUrl);
    const source = `test "health check"\n  api GET /health\n  check request not fails\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  } finally {
    await server.close();
  }
});

test('a request assertion still opts in correctly when it is the `check` (soft) form, not just `expect`', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  check request fails\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('without a following `request` assertion, a connection failure still crashes the whole test fail-fast — unchanged default behavior (decision 18.2)', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /request failed/);
});

test('`capture request as x` is rejected at runtime — `request` carries no value to capture', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const config = testConfig(server.baseUrl);
    const source = `test "health check"\n  api GET /health\n  capture request as x\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, false);
    assert.match(report.tests[0]!.error ?? '', /`request` is not a capturable\/comparable value/);
  } finally {
    await server.close();
  }
});

test('an invalid regex in `fails matching` reports a clear runtime error, like every other `matches`-family matcher', async () => {
  const server = await startFixtureServer({});
  await server.close();
  const config = testConfig(server.baseUrl);
  const source = `test "health check"\n  api GET /health\n  expect request fails matching "("\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /invalid regex in matcher/);
});

test('two separate `api` calls in one test each get their own independent connection-error tracking', async () => {
  const downServer = await startFixtureServer({});
  await downServer.close();
  const upServer = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const config = { ...testConfig(downServer.baseUrl), services: { up: upServer.baseUrl } };
    const source = `test "mixed"\n  api GET /health\n  expect request fails\n  api up GET /health\n  expect request connects\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });

    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  } finally {
    await upServer.close();
  }
});
