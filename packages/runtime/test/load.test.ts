// M29/M30 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26/D29): the `runLoad` engine — a
// single-process VU loop over both workload models (D17), `think`-excluded duration metrics,
// threshold evaluation (D24a), per-iteration error handling (D18: an iteration's `expect` failure
// is counted, never thrown), session establishment once before the loop (not per iteration), and
// M30's concurrent multi-scenario scheduling with combined-vs-per-scenario metrics (D29, R6).

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
  assert.equal(report.scenarios.length, 1);
  const s = report.scenarios[0]!;
  assert.equal(s.name, 'Health burst');
  assert.deepEqual(s.workload, { kind: 'users', target: 3, overMs: 200 });
  assert.ok(s.metrics.iterations > 0, 'expected at least one iteration to run');
  assert.equal(s.metrics.failures, 0);
  assert.equal(s.metrics.errorRate, 0);
  assert.deepEqual(s.thresholds, []);
  assert.equal(s.ok, true);
  // A single-scenario run's combined metrics are exactly that scenario's own metrics.
  assert.deepEqual(report.combined, s.metrics);

  await server.close();
});

test('an open (`ramp to N rps`) workload schedules arrivals independent of completion', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "Ramp"\n  ramp to 40 rps over 400ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  const s = report.scenarios[0]!;
  assert.deepEqual(s.workload, { kind: 'rps', target: 40, overMs: 400 });
  // area under a 0→40rps linear ramp over 0.4s = 40*0.4/2 = 8 arrivals — exact by construction.
  assert.equal(s.metrics.iterations, 8);
  assert.equal(s.metrics.failures, 0);
  assert.equal(report.combined.iterations, 8);

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

  const s = report.scenarios[0]!;
  assert.ok(s.metrics.iterations >= 4, JSON.stringify(s.metrics));
  assert.ok(s.metrics.failures > 0, 'expected at least one 500 to fail its iteration');
  assert.ok(s.metrics.errorRate > 0 && s.metrics.errorRate < 1);

  await server.close();
});

test('an `error rate` threshold fails the run when breached, passes when met', async () => {
  const alwaysFail = await startFixtureServer({ '/fail': (_req, res) => res.writeHead(500).end() });
  const failSource = 'scenario "AllFail"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n  threshold error rate is less than 50%\n';
  const { program: failProgram } = parseSource(failSource);
  const failReport = await runLoad(failProgram, testConfig(alwaysFail.baseUrl), { source: failSource });
  assert.equal(failReport.ok, false);
  assert.equal(failReport.scenarios[0]!.ok, false);
  assert.equal(failReport.scenarios[0]!.thresholds[0]!.ok, false);
  assert.equal(failReport.scenarios[0]!.thresholds[0]!.label, 'error rate');
  await alwaysFail.close();

  const alwaysOk = await startFixtureServer({ '/ok': (_req, res) => json(res, 200, { ok: true }) });
  const okSource = 'scenario "AllOk"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n  threshold error rate is less than 50%\n';
  const { program: okProgram } = parseSource(okSource);
  const okReport = await runLoad(okProgram, testConfig(alwaysOk.baseUrl), { source: okSource });
  assert.equal(okReport.ok, true);
  assert.equal(okReport.scenarios[0]!.ok, true);
  assert.equal(okReport.scenarios[0]!.thresholds[0]!.ok, true);
  await alwaysOk.close();
});

test('a `pNN duration` threshold reads the exact requested percentile, not just the fixed p50/90/95/99 summary', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // p1 is trivially satisfied by any real latency floor; asserts the machinery accepts and
  // evaluates an arbitrary percentile (not just the four baked into LoadDurationStats).
  const source = 'scenario "S"\n  ramp to 2 users over 100ms\n  api GET /health\n  expect status equals 200\n  threshold p1 duration is less than 5000ms\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  assert.equal(report.scenarios[0]!.thresholds[0]!.label, 'p1 duration');
  assert.equal(report.scenarios[0]!.thresholds[0]!.ok, true);
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
  for (const r of seen) {
    assert.equal(r.scenario, 'S');
    assert.ok(r.durationMs < 250, `expected think-excluded duration, got ${r.durationMs}ms`);
  }
  assert.ok(report.scenarios[0]!.metrics.durations.max < 250, JSON.stringify(report.scenarios[0]!.metrics));
  await server.close();
});

test('`runLoad` throws when the file declares no `scenario`', async () => {
  const { program } = parseSource('test "not a scenario"\n  api GET /health\n');
  await assert.rejects(() => runLoad(program, testConfig('http://127.0.0.1:1'), { source: '' }), /at least one `scenario`/);
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
  assert.equal(report.scenarios[0]!.metrics.failures, 0);

  await server.close();
});

// ---- M30: concurrent multi-scenario runs (D29, R6) -------------------------------------------

test('two scenarios in one file run concurrently — a fast scenario is not blocked behind a slower one scheduling its arrivals', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // "Slow" is an open-workload scenario whose arrival schedule spans real time (5 arrivals spread
  // across it) — if scenarios ran sequentially (the M29 shape, one scenario per file), "Fast"
  // couldn't even start until "Slow"'s task fully finished scheduling *and awaiting* every one of
  // its arrivals. Asserted on arrival *order*, not a wall-clock threshold (flaky under CI/test-
  // suite CPU contention, which delays every timer uniformly but doesn't reorder concurrent work):
  // a truly concurrent "Fast" (near-zero spawn delay) lands among "Slow"'s iterations, not strictly
  // after every one of them.
  const source =
    'scenario "Slow"\n  ramp to 20 rps over 500ms\n  api GET /health\n  expect status equals 200\n\n' +
    'scenario "Fast"\n  ramp to 1 users over 10ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const seen: LoadIterationResult[] = [];
  const report = await runLoad(program, testConfig(server.baseUrl), { source, onIteration: (r) => seen.push(r) });
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));

  const firstFastIndex = seen.findIndex((r) => r.scenario === 'Fast');
  const lastSlowIndex = seen.length - 1 - [...seen].reverse().findIndex((r) => r.scenario === 'Slow');
  assert.ok(firstFastIndex >= 0, 'expected at least one "Fast" iteration');
  assert.ok(
    firstFastIndex < lastSlowIndex,
    `"Fast"'s first iteration (index ${firstFastIndex}) never interleaved with "Slow"'s (last at ${lastSlowIndex}) — scenarios look serialized, not concurrent: ${JSON.stringify(seen.map((r) => r.scenario))}`,
  );

  await server.close();
});

test('combined metrics pool every scenario\'s iterations; each scenario\'s own metrics stay scoped to itself', async () => {
  const server = await startFixtureServer({
    '/ok': (_req, res) => json(res, 200, { ok: true }),
    '/fail': (_req, res) => res.writeHead(500).end(),
  });
  const source =
    'scenario "Good"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n\n' +
    'scenario "Bad"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });

  assert.equal(report.scenarios.length, 2);
  const good = report.scenarios.find((s) => s.name === 'Good')!;
  const bad = report.scenarios.find((s) => s.name === 'Bad')!;
  assert.equal(good.metrics.failures, 0, 'Good scenario\'s own failures must not include Bad\'s');
  assert.ok(bad.metrics.failures > 0, 'Bad scenario should have failures of its own');
  assert.equal(bad.metrics.failures, bad.metrics.iterations, 'every Bad iteration hits the always-500 endpoint');

  assert.equal(report.combined.iterations, good.metrics.iterations + bad.metrics.iterations);
  assert.equal(report.combined.failures, good.metrics.failures + bad.metrics.failures);

  await server.close();
});

test('each scenario\'s thresholds evaluate only against its own metrics — one can fail while another passes, gating the overall report.ok', async () => {
  const server = await startFixtureServer({
    '/ok': (_req, res) => json(res, 200, { ok: true }),
    '/fail': (_req, res) => res.writeHead(500).end(),
  });
  const source =
    'scenario "Passing"\n  ramp to 3 users over 150ms\n  api GET /ok\n  expect status equals 200\n  threshold error rate is less than 1%\n\n' +
    'scenario "Failing"\n  ramp to 3 users over 150ms\n  api GET /fail\n  expect status equals 200\n  threshold error rate is less than 1%\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });

  const passing = report.scenarios.find((s) => s.name === 'Passing')!;
  const failing = report.scenarios.find((s) => s.name === 'Failing')!;
  assert.equal(passing.ok, true);
  assert.equal(failing.ok, false);
  assert.equal(report.ok, false, 'the overall run must fail if any one scenario breaches a threshold');

  await server.close();
});

test('a session shared by two scenarios (both `as admin`) establishes exactly once, reused by both', async () => {
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
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  const source =
    'scenario "One" as admin\n  ramp to 3 users over 100ms\n  api GET /health\n  expect status equals 200\n\n' +
    'scenario "Two" as admin\n  ramp to 3 users over 100ms\n  api GET /health\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(logins, 1, 'a session shared by two concurrent scenarios should still establish exactly once');

  await server.close();
});
