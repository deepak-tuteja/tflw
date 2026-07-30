// M29 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26): the `runLoad` engine — single-scenario,
// single-process VU loop over both workload models (D17), `think`-excluded duration metrics,
// threshold evaluation (D24a), per-iteration error handling (D18: an iteration's `expect` failure
// is counted, never thrown), and session establishment once before the loop (not per iteration).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runLoad } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { LoadIterationResult } from '../src/types.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a closed (`ramp to N users`) workload runs iterations and reports clean metrics', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "Health burst"\n  ramp to 3 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.scenario, 'Health burst');
  assert.deepEqual(report.workload, { kind: 'users', target: 3, overMs: 200 });
  assert.ok(report.metrics.iterations > 0, 'expected at least one iteration to run');
  assert.equal(report.metrics.failures, 0);
  assert.equal(report.metrics.errorRate, 0);
  assert.deepEqual(report.thresholds, []);

  await server.close();
});

test('an open (`ramp to N rps`) workload schedules arrivals independent of completion', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "Ramp"\n  ramp to 40 rps over 400ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.workload, { kind: 'rps', target: 40, overMs: 400 });
  // area under a 0→40rps linear ramp over 0.4s = 40*0.4/2 = 8 arrivals — exact by construction.
  assert.equal(report.metrics.iterations, 8);
  assert.equal(report.metrics.failures, 0);

  await server.close();
});

test('a failing `expect` inside a scenario fails that iteration and counts toward the error rate, never aborts the run', async () => {
  let n = 0;
  const server = await startFixtureServer({
    '/flaky': (_req, res) => {
      n++;
      json(res, n % 2 === 0 ? 500 : 200, { n });
    },
  });
  const source = 'scenario "Flaky"\n  ramp to 4 users over 200ms\n  api GET /flaky\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });

  assert.ok(report.metrics.iterations >= 4, JSON.stringify(report.metrics));
  assert.ok(report.metrics.failures > 0, 'expected at least one 500 to fail its iteration');
  assert.ok(report.metrics.errorRate > 0 && report.metrics.errorRate < 1);

  await server.close();
});

test('an `error rate` threshold fails the run when breached, passes when met', async () => {
  const alwaysFail = await startFixtureServer({ '/fail': (_req, res) => res.writeHead(500).end() });
  const failSource = 'scenario "AllFail"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n  threshold error rate is less than 50%\n';
  const { program: failProgram } = parseSource(failSource);
  const failReport = await runLoad(failProgram, testConfig(alwaysFail.baseUrl), { source: failSource });
  assert.equal(failReport.ok, false);
  assert.equal(failReport.thresholds[0]!.ok, false);
  assert.equal(failReport.thresholds[0]!.label, 'error rate');
  await alwaysFail.close();

  const alwaysOk = await startFixtureServer({ '/ok': (_req, res) => json(res, 200, { ok: true }) });
  const okSource = 'scenario "AllOk"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n  threshold error rate is less than 50%\n';
  const { program: okProgram } = parseSource(okSource);
  const okReport = await runLoad(okProgram, testConfig(alwaysOk.baseUrl), { source: okSource });
  assert.equal(okReport.ok, true);
  assert.equal(okReport.thresholds[0]!.ok, true);
  await alwaysOk.close();
});

test('a `pNN duration` threshold reads the exact requested percentile, not just the fixed p50/90/95/99 summary', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // p1 is trivially satisfied by any real latency floor; asserts the machinery accepts and
  // evaluates an arbitrary percentile (not just the four baked into LoadDurationStats).
  const source = 'scenario "S"\n  ramp to 2 users over 100ms\n  api GET /health\n  expect status equals 200\n  threshold p1 duration is less than 5000ms\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  assert.equal(report.thresholds[0]!.label, 'p1 duration');
  assert.equal(report.thresholds[0]!.ok, true);
  await server.close();
});

test('`think` time is excluded from the reported iteration duration', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 1 users over 50ms\n  think 300ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const seen: LoadIterationResult[] = [];
  const report = await runLoad(program, testConfig(server.baseUrl), { source, onIteration: (r) => seen.push(r) });
  assert.ok(seen.length >= 1);
  // Real wall time per iteration is >=300ms (the think) + request time, but the *reported*
  // duration should be just the request — comfortably under the think time itself.
  for (const r of seen) assert.ok(r.durationMs < 250, `expected think-excluded duration, got ${r.durationMs}ms`);
  assert.ok(report.metrics.durations.max < 250, JSON.stringify(report.metrics));
  await server.close();
});

test('`runLoad` throws when the file declares no `scenario` (or more than one — checker-enforced upstream)', async () => {
  const { program } = parseSource('test "not a scenario"\n  api GET /health\n');
  await assert.rejects(() => runLoad(program, testConfig('http://127.0.0.1:1'), { source: '' }), /exactly one `scenario`/);
});

test('a session opted into via `as <name>` establishes once before the loop, not once per iteration', async () => {
  let logins = 0;
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      logins++;
      json(res, 200, { token: 'tok-abc' });
    },
    '/health': (req, res) => json(res, req.headers['authorization'] === 'Bearer tok-abc' ? 200 : 401, {}),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  const source = 'scenario "Auth burst" as admin\n  ramp to 5 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(logins, 1, 'session should establish exactly once, not per iteration');
  assert.equal(report.metrics.failures, 0);

  await server.close();
});
