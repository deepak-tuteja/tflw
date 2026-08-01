// M29/M30/M31 (PLAN_BROWSER_PERF_SECURITY.md D16-D19/D24a/D26/D28/D29): the `runLoad` engine — a
// single-process VU loop over both workload models (D17), `think`-excluded duration metrics,
// threshold evaluation (D24a), per-iteration error handling (D18: an iteration's `expect` failure
// is counted, never thrown), session establishment once before the loop (not per iteration), M30's
// concurrent multi-scenario scheduling with combined-vs-per-scenario metrics (D29, R6), and M31's
// multi-process building blocks: workload/sub-seed striping (`shareOfWorkloadTarget`/
// `globalIterationIndex`), `runLoadShard`, and `mergeLoadShardReports` (D19, R4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runLoad, runLoadShard, mergeLoadShardReports, shareOfWorkloadTarget, globalIterationIndex, computeBackOff } from '../src/interpreter.js';
import { LatencyHistogram } from '../src/histogram.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { LoadIterationResult, LoadShardResult, SelfDiagnosis } from '../src/types.js';
import { startFixtureServer, testConfig, json } from './support.js';

const HEALTHY_DIAGNOSIS: SelfDiagnosis = { avgEventLoopLagMs: 1, maxEventLoopLagMs: 2, cpuPercent: 5, saturated: false };

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

// ---- M37: session-refresh regression tests (D43 found the bug, D44/D45 fixed it) --------------

test('a session token that goes stale mid-run re-establishes a small, bounded number of times — not once per remaining iteration (D43/D44)', async () => {
  let loginCount = 0;
  let validToken = '';
  let healthCalls = 0;
  const ROTATE_AT = 4;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      validToken = `tok-${loginCount}`;
      json(res, 200, { token: validToken });
    },
    '/health': (req, res) => {
      healthCalls++;
      // Simulate a credential going stale out from under the client mid-run (D43's real trigger
      // was a short JWT TTL) — the server unilaterally stops accepting whatever token was valid a
      // moment ago, independent of anything the client does.
      if (healthCalls === ROTATE_AT) validToken = 'rotated-away';
      json(res, req.headers['authorization'] === `Bearer ${validToken}` ? 200 : 401, {});
    },
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /auth/login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  // Long enough, with enough VUs, to run many iterations past ROTATE_AT — the whole point is
  // proving those later iterations don't each pay for their own re-login.
  const source = 'scenario "Auth burst" as admin\n  ramp to 3 users over 300ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.ok(healthCalls > ROTATE_AT + 10, `expected many iterations after the rotation, got ${healthCalls} total health calls`);
  // Before the fix: every iteration after the rotation cloned the same frozen (now-stale) headers,
  // so every single one of them 401'd and paid for its own re-login — loginCount would track
  // healthCalls, not stay bounded. After the fix: the one real refresh becomes visible to every
  // other iteration immediately via the shared cache, so only a couple of logins happen in total
  // (the initial establish, the one the rotation triggers, and — since a couple of VUs may already
  // have a request in flight against the old token at the exact rotation instant — possibly one
  // storm-guard-bounded extra, never one per iteration).
  assert.ok(loginCount <= 3, `expected a small, bounded number of re-logins, got ${loginCount} across ${healthCalls} health calls`);
  await server.close();
});

test('several concurrent VUs hitting a 401 on the same stale token near-simultaneously trigger exactly one real re-login, not one each (D45)', async () => {
  let loginCount = 0;
  const server = await startFixtureServer({
    '/auth/login': (_req, res) => {
      loginCount++;
      // An artificial delay widens the race window to tens of milliseconds — every VU's first
      // request is guaranteed to discover the stale token and start racing
      // `SessionCache.reestablish` *before* this (the one real re-login) resolves, deterministically,
      // rather than depending on sub-millisecond real-time VU-spawn scheduling to line them up.
      setTimeout(() => json(res, 200, { token: `tok-${loginCount}` }), 30);
    },
    // Only the *second* login's token is ever accepted — the upfront fail-fast establish (which
    // always produces the first login) is deliberately already-stale, so every VU's very first
    // request 401s.
    '/health': (req, res) => json(res, req.headers['authorization'] === 'Bearer tok-2' ? 200 : 401, {}),
  });
  const configSource = `env test default
  api "${server.baseUrl}"

session admin
  api POST /auth/login
  capture body.token as tok
  header "Authorization" is "Bearer {tok}"
`;
  const parsedConfig = parseConfigSource(configSource);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const envBlock = selectEnv(parsedConfig.config, {});
  const config = resolveConfig(parsedConfig.config, envBlock);

  // The ramp window is anchored to the run's global start time, which precedes the upfront
  // fail-fast session establishment above — so `overMs` needs enough headroom past that initial
  // establish's own 30ms delay for any VU to spawn at all, plus enough further room for several
  // VUs' first iterations to land within the *second* login's own 30ms delay and genuinely race
  // `SessionCache.reestablish` on the same stale ref, not just queue up one after another.
  const source = 'scenario "Auth storm" as admin\n  ramp to 20 users over 250ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);

  const report = await runLoad(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(loginCount, 2, `expected exactly one real re-login beyond the initial (already-stale) establish, got ${loginCount}`);
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

// ---- M31: multi-process building blocks (D19, R4) --------------------------------------------

test('shareOfWorkloadTarget: splits a target evenly, remainder to the lowest-indexed shards, and always sums back to the target', () => {
  assert.equal(shareOfWorkloadTarget(10), 10, 'undefined shard is the identity split');
  assert.equal(shareOfWorkloadTarget(10, { index: 0, count: 3 }), 4);
  assert.equal(shareOfWorkloadTarget(10, { index: 1, count: 3 }), 3);
  assert.equal(shareOfWorkloadTarget(10, { index: 2, count: 3 }), 3);
  const shares = [0, 1, 2, 3].map((index) => shareOfWorkloadTarget(10, { index, count: 4 }));
  assert.deepEqual(shares.reduce((a, b) => a + b, 0), 10);
  // A target smaller than the shard count legitimately gives some shards 0 — not an error.
  assert.equal(shareOfWorkloadTarget(2, { index: 2, count: 4 }), 0);
  assert.equal(shareOfWorkloadTarget(2, { index: 0, count: 4 }), 1);
});

test('globalIterationIndex: id ≡ shard.index mod shard.count, so two shards never collide without coordinating', () => {
  assert.equal(globalIterationIndex(5), 5, 'undefined shard is the identity map');
  const shardACount3 = { index: 0, count: 3 };
  const shardBCount3 = { index: 1, count: 3 };
  const idsA = [0, 1, 2, 3].map((local) => globalIterationIndex(local, shardACount3));
  const idsB = [0, 1, 2, 3].map((local) => globalIterationIndex(local, shardBCount3));
  assert.deepEqual(idsA, [0, 3, 6, 9]);
  assert.deepEqual(idsB, [1, 4, 7, 10]);
  assert.ok(idsA.every((id) => id % 3 === shardACount3.index));
  assert.ok(idsB.every((id) => id % 3 === shardBCount3.index));
  assert.deepEqual(
    idsA.filter((id) => idsB.includes(id)),
    [],
    'no id produced by shard A should ever be produced by shard B',
  );
});

test('runLoadShard with shard {index:0, count:1} behaves like the whole run (a lone shard is the identity case)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 3 users over 150ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const shardResult = await runLoadShard(program, testConfig(server.baseUrl), { source, shard: { index: 0, count: 1 } });
  assert.equal(shardResult.scenarios.length, 1);
  assert.equal(shardResult.scenarios[0]!.name, 'S');
  assert.ok(shardResult.scenarios[0]!.iterations > 0);
  assert.equal(shardResult.scenarios[0]!.failures, 0);
  assert.equal(typeof shardResult.selfDiagnosis.saturated, 'boolean');
  await server.close();
});

test('mergeLoadShardReports: pools iterations/failures across shards and re-evaluates thresholds against the merged data', () => {
  const source = 'scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n  threshold p95 duration is less than 100ms\n';
  const { program } = parseSource(source);

  const fastHistogram = new LatencyHistogram();
  for (const v of [10, 12, 11, 13, 9]) fastHistogram.record(v);
  const slowHistogram = new LatencyHistogram();
  for (const v of [500, 520, 510]) slowHistogram.record(v);

  const shardFast: LoadShardResult = {
    scenarios: [{ name: 'S', workload: { kind: 'users', target: 1, overMs: 1000 }, iterations: fastHistogram.count, failures: 0, sum: fastHistogram.sum, min: fastHistogram.min, max: fastHistogram.max, histogram: fastHistogram.toBuckets(), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: HEALTHY_DIAGNOSIS,
  };
  const shardSlow: LoadShardResult = {
    scenarios: [{ name: 'S', workload: { kind: 'users', target: 1, overMs: 1000 }, iterations: slowHistogram.count, failures: 0, sum: slowHistogram.sum, min: slowHistogram.min, max: slowHistogram.max, histogram: slowHistogram.toBuckets(), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: HEALTHY_DIAGNOSIS,
  };

  const merged = mergeLoadShardReports(program, [shardFast, shardSlow], { startedAt: new Date().toISOString(), durationMs: 1000, seed: 42, now: new Date().toISOString() });
  assert.equal(merged.scenarios.length, 1);
  const s = merged.scenarios[0]!;
  assert.equal(s.metrics.iterations, 8, 'iterations from both shards must be pooled');
  assert.equal(s.metrics.durations.min, 9);
  assert.equal(s.metrics.durations.max, 520);
  // p95 over the pooled 8 samples lands among the slow shard's values — well above the 100ms
  // threshold, which only a genuinely merged (not per-shard) evaluation would catch.
  assert.equal(s.thresholds[0]!.ok, false, JSON.stringify(s.thresholds[0]));
  assert.equal(merged.ok, false);
  assert.equal(merged.combined.iterations, 8);
});

test('mergeLoadShardReports: a shard missing a scenario entirely (its striped share rounded to 0) is tolerated, not an error', () => {
  const source = 'scenario "A"\n  ramp to 1 users over 1s\n  api GET /health\n\nscenario "B"\n  ramp to 1 users over 1s\n  api GET /health\n';
  const { program } = parseSource(source);
  const hA = new LatencyHistogram();
  hA.record(5);
  const shardWithOnlyA: LoadShardResult = {
    scenarios: [{ name: 'A', workload: { kind: 'users', target: 1, overMs: 1000 }, iterations: 1, failures: 0, sum: 5, min: 5, max: 5, histogram: hA.toBuckets(), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: HEALTHY_DIAGNOSIS,
  };
  const merged = mergeLoadShardReports(program, [shardWithOnlyA], { startedAt: new Date().toISOString(), durationMs: 100, seed: 1, now: new Date().toISOString() });
  assert.equal(merged.scenarios.length, 2);
  const a = merged.scenarios.find((s) => s.name === 'A')!;
  const b = merged.scenarios.find((s) => s.name === 'B')!;
  assert.equal(a.metrics.iterations, 1);
  assert.equal(b.metrics.iterations, 0);
  assert.equal(b.metrics.errorRate, 0, 'zero iterations is a defined 0 error rate, not NaN');
});

test('mergeLoadShardReports: selfDiagnosis.saturated is true if any shard saturated', () => {
  const source = 'scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n';
  const { program } = parseSource(source);
  const empty = new LatencyHistogram();
  empty.record(1);
  const shard = (saturated: boolean): LoadShardResult => ({
    scenarios: [{ name: 'S', workload: { kind: 'users', target: 1, overMs: 1000 }, iterations: 1, failures: 0, sum: 1, min: 1, max: 1, histogram: empty.toBuckets(), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: { ...HEALTHY_DIAGNOSIS, saturated },
  });
  const merged = mergeLoadShardReports(program, [shard(false), shard(true)], { startedAt: new Date().toISOString(), durationMs: 100, seed: 1, now: new Date().toISOString() });
  assert.equal(merged.selfDiagnosis.saturated, true);
});

test('mergeLoadShardReports throws on an empty shard-results array', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n');
  assert.throws(() => mergeLoadShardReports(program, [], { startedAt: new Date().toISOString(), durationMs: 0, seed: 1, now: new Date().toISOString() }), /at least one shard/);
});

test('two real shards (runLoadShard against the same server) merge into a sane combined report', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 4 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);
  const [shard0, shard1] = await Promise.all([
    runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }),
    runLoadShard(program, config, { source, shard: { index: 1, count: 2 } }),
  ]);
  const merged = mergeLoadShardReports(program, [shard0, shard1], { startedAt: new Date().toISOString(), durationMs: 200, seed: 7, now: new Date().toISOString() });
  assert.equal(merged.scenarios.length, 1);
  assert.equal(merged.scenarios[0]!.name, 'S');
  assert.ok(merged.combined.iterations > 0, 'both shards together should have run at least one iteration');
  assert.equal(merged.combined.iterations, merged.scenarios[0]!.metrics.iterations);
  await server.close();
});

test('`runLoad` reports a plausible selfDiagnosis (single-process, unsharded)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 1 users over 50ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  assert.equal(typeof report.selfDiagnosis.saturated, 'boolean');
  assert.ok(report.selfDiagnosis.avgEventLoopLagMs >= 0);
  assert.ok(report.selfDiagnosis.cpuPercent >= 0);
  await server.close();
});

// ---- M32: metrics.histogram/timeline, inconclusive, partial-on-abort, progress ticks (R3-R5/R11) ----

test('LoadMetrics carries its own histogram + timeline, both for a scenario and the combined view', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 3 users over 200ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.ok(s.metrics.histogram.length > 0, 'a scenario with iterations must have a non-empty histogram');
  assert.ok(s.metrics.timeline.length > 0, 'a scenario with iterations must have a non-empty timeline');
  assert.equal(s.metrics.timeline[0]!.offsetSeconds, 0);
  assert.ok(report.combined.histogram.length > 0);
  assert.ok(report.combined.timeline.length > 0);
  assert.equal(
    report.combined.timeline.reduce((n, p) => n + p.count, 0),
    report.combined.iterations,
    'summing every timeline point\'s count must equal the total iteration count',
  );
  await server.close();
});

test('`runLoad`: inconclusive mirrors selfDiagnosis.saturated', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 1 users over 20ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  assert.equal(report.inconclusive, report.selfDiagnosis.saturated);
  assert.equal(report.aborted, undefined, 'a run that reaches its planned end must not be flagged aborted');
  await server.close();
});

test('mergeLoadShardReports: inconclusive mirrors the merged selfDiagnosis.saturated', () => {
  const source = 'scenario "S"\n  ramp to 1 users over 1s\n  api GET /health\n';
  const { program } = parseSource(source);
  const h = new LatencyHistogram();
  h.record(1);
  const shard: LoadShardResult = {
    scenarios: [{ name: 'S', workload: { kind: 'users', target: 1, overMs: 1000 }, iterations: 1, failures: 0, sum: 1, min: 1, max: 1, histogram: h.toBuckets(), timeline: [], early: { count: 0, sum: 0 }, late: { count: 0, sum: 0 }, endpoints: [] }],
    selfDiagnosis: { ...HEALTHY_DIAGNOSIS, saturated: true },
  };
  const merged = mergeLoadShardReports(program, [shard], { startedAt: new Date().toISOString(), durationMs: 100, seed: 1, now: new Date().toISOString() });
  assert.equal(merged.inconclusive, true);
});

test('`runLoad` with an already-aborted signal runs zero iterations and flags aborted/abortedMessage', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 5 users over 5000ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const controller = new AbortController();
  controller.abort();
  const report = await runLoad(program, testConfig(server.baseUrl), { source, abortSignal: controller.signal });
  assert.equal(report.aborted, true);
  assert.match(report.abortedMessage!, /^aborted at \d+s of 5s planned$/, report.abortedMessage);
  assert.equal(report.combined.iterations, 0);
  await server.close();
});

test('`runLoad`: aborting mid-run stops new iterations well short of the planned duration', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // Long planned duration (5s) so "aborted well before the end" isn't a race against natural
  // completion — the abort fires at 100ms, under 1/40th of the plan.
  const source = 'scenario "S"\n  ramp to 20 users over 5000ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const start = Date.now();
  const report = await runLoad(program, testConfig(server.baseUrl), { source, abortSignal: controller.signal });
  const wallMs = Date.now() - start;
  assert.equal(report.aborted, true);
  assert.ok(wallMs < 2000, `abort should stop the run well under the 5s plan (took ${wallMs}ms)`);
  assert.ok(report.combined.iterations > 0, 'iterations already in flight when the abort fired should still be counted');
  await server.close();
});

test('onProgressTick fires roughly once a second with a cumulative, non-decreasing snapshot', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "S"\n  ramp to 5 users over 1300ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const ticks: { iterations: number; failures: number; elapsedMs: number }[] = [];
  await runLoad(program, testConfig(server.baseUrl), { source, onProgressTick: (snapshot) => ticks.push(snapshot) });
  assert.ok(ticks.length >= 1, `expected at least one tick over a 1.3s run, got ${ticks.length}`);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i]!.iterations >= ticks[i - 1]!.iterations, 'iterations must never decrease tick to tick');
    assert.ok(ticks[i]!.elapsedMs >= ticks[i - 1]!.elapsedMs, 'elapsedMs must never decrease tick to tick');
  }
  await server.close();
});

// -- M34 (D17, back-off/coordinated-omission diagnostic) — computeBackOff's pure logic gets ------
// deterministic unit coverage (hand-built early/late totals, no real timing to flake on); a
// handful of real end-to-end runs below confirm the wiring (runLoad/runLoadShard/
// mergeLoadShardReports) all actually reach it, the same split M31's shareOfWorkloadTarget/
// globalIterationIndex unit tests and their own real-shard integration test already use.
//
// The design landed here (early-half-mean vs. late-half-mean) replaced an earlier attempt that
// compared achieved iterations against an "ideal" pace estimated from p10 (the fastest tenth of
// observed durations) — that approach was systematically biased: p10 is *always* faster than a
// run's typical iteration by construction, so it flagged "backing off" even against a genuinely
// healthy, uniformly-fast server (caught by a real, non-simulated run during this diagnostic's own
// development, not by inspection). Comparing two same-shape aggregates (mean vs. mean, each from a
// representative half of the run) has no such structural bias.

test('computeBackOff: undefined for an open-model (`ramp to N rps`) scenario — no "backing off" concept in that model (D17)', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 100 rps over 1s\n  api GET /health\n');
  assert.equal(computeBackOff(program.scenarios[0]!, { count: 10, sum: 50 }, { count: 10, sum: 500 }), undefined);
});

test('computeBackOff: undefined when either half has fewer than MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF samples', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  assert.equal(computeBackOff(program.scenarios[0]!, { count: 2, sum: 20 }, { count: 10, sum: 2000 }), undefined, 'too few early samples');
  assert.equal(computeBackOff(program.scenarios[0]!, { count: 10, sum: 100 }, { count: 2, sum: 400 }), undefined, 'too few late samples');
});

test('computeBackOff: undefined when a half has zero total duration — avoids dividing by zero', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  assert.equal(computeBackOff(program.scenarios[0]!, { count: 10, sum: 0 }, { count: 10, sum: 500 }), undefined);
});

test('computeBackOff: a healthy scenario (early and late means close together) reports a low ratio, no warning', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  // early mean 10ms, late mean 11ms — ordinary sample-to-sample variance, not a real slowdown.
  const backOff = computeBackOff(program.scenarios[0]!, { count: 20, sum: 200 }, { count: 20, sum: 220 });
  assert.ok(backOff, 'expected a defined BackOffDiagnosis');
  assert.ok(backOff!.ratio < 0.2, `expected a low ratio, got ${backOff!.ratio}`);
  assert.equal(backOff!.warning, false);
});

test('computeBackOff: a scenario whose late half ran far slower than its early half reports a high ratio and warns', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  // early mean 10ms, late mean 200ms — ratio = 1 - 10/200 = 0.95.
  const backOff = computeBackOff(program.scenarios[0]!, { count: 20, sum: 200 }, { count: 10, sum: 2000 });
  assert.ok(backOff, 'expected a defined BackOffDiagnosis');
  assert.ok(backOff!.ratio > 0.2, `expected a high ratio, got ${backOff!.ratio}`);
  assert.equal(backOff!.warning, true);
});

test('computeBackOff: a scenario that sped up (late half faster than early) reports ratio 0, not negative', () => {
  const { program } = parseSource('scenario "S"\n  ramp to 5 users over 1s\n  api GET /health\n');
  const backOff = computeBackOff(program.scenarios[0]!, { count: 20, sum: 2000 }, { count: 20, sum: 200 });
  assert.ok(backOff, 'expected a defined BackOffDiagnosis');
  assert.equal(backOff!.ratio, 0);
  assert.equal(backOff!.warning, false);
});

test('a real degrading server triggers a genuine backOff warning on a closed-model run', async () => {
  // Fast for the scenario's own first half of wall-clock time (matching computeBackOff's own
  // early/late split at `overMs / 2`), then deliberately slow — a time-based trigger, not a
  // request-count one, so it lines up with exactly what the diagnostic actually measures.
  const runStart = Date.now();
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      if (Date.now() - runStart < 700) return json(res, 200, {});
      setTimeout(() => json(res, 200, {}), 150);
    },
  });
  // 1400ms/5 users comfortably clears MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF (10) on both halves —
  // the late half alone fits roughly (700ms / 150ms) × 5 users ≈ 23 iterations.
  const source = 'scenario "Degrading"\n  ramp to 5 users over 1400ms\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.ok(s.backOff, 'expected a defined backOff diagnosis on a closed-model scenario');
  assert.equal(s.backOff!.warning, true, `expected the back-off warning to fire, ratio was ${s.backOff!.ratio}`);
  assert.ok(s.backOff!.ratio > 0.2, `expected ratio > 0.2, got ${s.backOff!.ratio}`);
  await server.close();
});

test('a uniformly fast server does not trigger a backOff warning', async () => {
  // A small fixed delay (rather than a near-0ms instant response) keeps ordinary per-request
  // jitter a small *relative* fraction of the mean instead of dominating it — a health-check
  // response that's usually <1ms can swing 100%+ on jitter alone, which isn't a fair test of
  // whether the diagnostic itself is stable against genuine health. A longer run (1500ms) also
  // comfortably clears MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF (10) on both halves with real margin.
  const server = await startFixtureServer({ '/health': (_req, res) => setTimeout(() => json(res, 200, { ok: true }), 5) });
  const source = 'scenario "Healthy"\n  ramp to 5 users over 1500ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  if (s.backOff) assert.equal(s.backOff.warning, false, `unexpected back-off warning against a healthy server, ratio ${s.backOff.ratio}`);
  await server.close();
});

test('an open-model (`ramp to N rps`) real run never carries a backOff field', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = 'scenario "Open"\n  ramp to 40 rps over 400ms\n  api GET /health\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  assert.equal(report.scenarios[0]!.backOff, undefined);
  await server.close();
});

test('two real shards each contribute their own early/late totals, and mergeLoadShardReports recomputes backOff from the merged data', async () => {
  const runStart = Date.now();
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      if (Date.now() - runStart < 700) return json(res, 200, {});
      setTimeout(() => json(res, 200, {}), 150);
    },
  });
  const source = 'scenario "Degrading"\n  ramp to 6 users over 1400ms\n  api GET /slow\n  expect status equals 200\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);
  const [shardA, shardB] = await Promise.all([
    runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }),
    runLoadShard(program, config, { source, shard: { index: 1, count: 2 } }),
  ]);
  assert.ok(shardA.scenarios[0]!.early.count > 0 || shardA.scenarios[0]!.late.count > 0, 'expected a real shard to report some iterations');
  assert.ok(shardB.scenarios[0]!.early.count > 0 || shardB.scenarios[0]!.late.count > 0, 'expected a real shard to report some iterations');

  const merged = mergeLoadShardReports(program, [shardA, shardB], { startedAt: new Date().toISOString(), durationMs: 1400, seed: 1, now: new Date().toISOString() });
  const s = merged.scenarios[0]!;
  assert.ok(s.backOff, 'expected a defined backOff diagnosis on the merged report');
  assert.equal(s.backOff!.warning, true, `expected the merged back-off warning to fire, ratio was ${s.backOff!.ratio}`);
  await server.close();
});

// -- M43 (PLAN_BROWSER_PERF_SECURITY.md §2.14, D67-D70): per-endpoint breakdown --------------

test('a scenario with two untagged `api` steps gets two automatic-identity endpoints, each scoped to just its own requests', async () => {
  const server = await startFixtureServer({
    '/lookup': (_req, res) => setTimeout(() => json(res, 200, {}), 5),
    '/checkout': (_req, res) => setTimeout(() => json(res, 200, {}), 40),
  });
  const source = 'scenario "S"\n  ramp to 3 users over 200ms\n  api GET /lookup\n  api POST /checkout\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.endpoints.length, 2);
  assert.equal(s.endpoints[0]!.identity, 'GET /lookup');
  assert.equal(s.endpoints[1]!.identity, 'POST /checkout');
  assert.ok(s.endpoints[0]!.metrics.iterations > 0);
  assert.equal(s.endpoints[0]!.metrics.iterations, s.endpoints[1]!.metrics.iterations, 'both steps run once per iteration');
  // The whole-iteration metrics sum both legs; the /checkout leg alone should read slower on its
  // own than the fast /lookup leg — the exact asymmetry M43 exists to make visible.
  assert.ok(s.endpoints[1]!.metrics.durations.avg > s.endpoints[0]!.metrics.durations.avg, 'the slower leg should read slower in its own bucket');
  await server.close();
});

test('an `as "label"` tag replaces the automatic identity entirely (k6-style)', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, {}) });
  const source = 'scenario "S"\n  ramp to 2 users over 100ms\n  api POST /orders as "checkout"\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.endpoints.length, 1);
  assert.equal(s.endpoints[0]!.identity, 'checkout');
});

test('an identity declared in source but never reached (every iteration fails first) still reports a zero-sample entry, not a missing one', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 500, {}) });
  const source = 'scenario "S"\n  ramp to 2 users over 100ms\n  api GET /health\n  expect status equals 200\n  api GET /never-reached\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.ok, true, 'no thresholds declared, so a scenario with only failed iterations is still vacuously ok');
  assert.equal(s.metrics.failures, s.metrics.iterations, 'every iteration should have failed at the expect');
  assert.deepEqual(
    s.endpoints.map((e) => e.identity),
    ['GET /health', 'GET /never-reached'],
  );
  const neverReached = s.endpoints.find((e) => e.identity === 'GET /never-reached')!;
  assert.equal(neverReached.metrics.iterations, 0);
  assert.equal(neverReached.metrics.errorRate, 0, 'zero samples is a defined 0 error rate, not NaN');
  const health = s.endpoints.find((e) => e.identity === 'GET /health')!;
  assert.ok(health.metrics.iterations > 0);
  assert.equal(health.metrics.failures, health.metrics.iterations, 'the failing expect should attribute to the endpoint it followed');
  await server.close();
});

test('`threshold … for "label"` evaluates against only that endpoint, independent of an unscoped threshold on the same metric', async () => {
  const server = await startFixtureServer({
    '/lookup': (_req, res) => setTimeout(() => json(res, 200, {}), 1),
    '/checkout': (_req, res) => setTimeout(() => json(res, 200, {}), 60),
  });
  const source =
    'scenario "S"\n  ramp to 3 users over 200ms\n  threshold p95 duration is less than 40ms\n  threshold p95 duration for "checkout" is less than 40ms\n  api GET /lookup\n  api POST /checkout as "checkout"\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);

  const report = await runLoad(program, testConfig(server.baseUrl), { source });
  const s = report.scenarios[0]!;
  assert.equal(s.thresholds.length, 2);
  const whole = s.thresholds.find((t) => t.label === 'p95 duration')!;
  const scoped = s.thresholds.find((t) => t.label === 'p95 duration for "checkout"')!;
  // The whole-iteration threshold sums the fast lookup + slow checkout, so its own p95 is even
  // higher than the checkout-only threshold's — both fail here, but the scoped one's `actual`
  // should read close to the checkout leg alone, not the combined iteration.
  assert.ok(scoped.actual < whole.actual, `scoped p95 (${scoped.actual}) should read below the combined p95 (${whole.actual})`);
  assert.equal(scoped.ok, false);
});

test('`mergeLoadShardReports` pools per-endpoint histograms across shards by identity', async () => {
  const server = await startFixtureServer({
    '/lookup': (_req, res) => json(res, 200, {}),
    '/checkout': (_req, res) => json(res, 200, {}),
  });
  const source = 'scenario "S"\n  ramp to 4 users over 200ms\n  api GET /lookup\n  api POST /checkout\n';
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl);
  const [shardA, shardB] = await Promise.all([
    runLoadShard(program, config, { source, shard: { index: 0, count: 2 } }),
    runLoadShard(program, config, { source, shard: { index: 1, count: 2 } }),
  ]);
  const merged = mergeLoadShardReports(program, [shardA, shardB], { startedAt: new Date().toISOString(), durationMs: 200, seed: 1, now: new Date().toISOString() });
  const s = merged.scenarios[0]!;
  assert.equal(s.endpoints.length, 2);
  const lookup = s.endpoints.find((e) => e.identity === 'GET /lookup')!;
  const checkout = s.endpoints.find((e) => e.identity === 'POST /checkout')!;
  assert.equal(lookup.metrics.iterations, s.metrics.iterations, 'every iteration hits /lookup once');
  assert.equal(checkout.metrics.iterations, s.metrics.iterations, 'every iteration hits /checkout once');
  await server.close();
});
