// M88b (review cluster C2 — `B4-04`) — `timeout step` is a whole-chain deadline (D-M88-2), stated
// once for every client path.
//
// The finding: the pinned workload client armed its deadline *inside* the hop loop, so every
// redirect got a fresh `timeoutMs`. `timeout 1s` therefore meant "no single hop exceeds 1s" under a
// workload and "the step finishes within 1s" everywhere else — the same file, the same step and the
// same 3-hop chain failing functionally and passing under `run … iterations`. Worse than a parity
// nit, because the workload then reported p95 1210ms — 21% over its own configured deadline — as
// healthy, and a `threshold p95 duration is less than 1s` is evaluated against exactly those
// numbers.
//
// Written as pairs, like `redirect-cap.test.ts`: the property is "pinned agrees with pooled on the
// same chain", never "the pinned path does what I typed". The pooled path is normative (D-M88-1) —
// `http.ts:159` holds one `AbortController` across the whole of `fetch`'s follow, and the mTLS
// worker already hoists its own above its own loop (`mtlsWorker.ts:80`), so this path was the only
// one of the three out of step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { sendRequest } from '../src/http.js';
import { createKeepAliveAgents, destroyKeepAliveAgents, sendPinnedRequest } from '../src/httpPinned.js';
import { startFixtureServer, testConfig, json, type Handler } from './support.js';

/** `/hopN` waits `delayMs`, then redirects to `/hop(N-1)`; `/hop0` waits `delayMs` and answers 200.
 * So `/hopN` costs `(N+1) × delayMs` in total while no *single* hop ever costs more than `delayMs`
 * — which is the whole shape of the defect: a per-hop deadline cannot see the difference. */
function slowChainRoutes(depth: number, delayMs: number): Record<string, Handler> {
  const routes: Record<string, Handler> = {
    '/hop0': (_req, res) => {
      setTimeout(() => json(res, 200, { landed: true }), delayMs);
    },
  };
  for (let i = 1; i <= depth; i++) {
    routes[`/hop${i}`] = (_req, res) => {
      setTimeout(() => res.writeHead(302, { location: `/hop${i - 1}` }).end(), delayMs);
    };
  }
  return routes;
}

test('a chain that overruns its budget one hop at a time times out on the pinned path too', async () => {
  // 3 hops × 400ms = 1200ms against a 1000ms budget, with every individual hop comfortably inside
  // it. Before M88b the pinned arm returned a 200 here while the pooled arm threw.
  const server = await startFixtureServer(slowChainRoutes(2, 400));
  const agents = createKeepAliveAgents();
  const opts = { method: 'GET', url: `${server.baseUrl}/hop2`, headers: {}, timeoutMs: 1000, followRedirects: true } as const;

  const pooled = await sendRequest(opts).then((r) => r, (e: Error) => e);
  const pinned = await sendPinnedRequest(opts, agents).then((r) => r, (e: Error) => e);

  assert.ok(pooled instanceof Error, `pooled returned instead of throwing: ${JSON.stringify(pooled)}`);
  assert.ok(pinned instanceof Error, `pinned returned instead of throwing: ${JSON.stringify(pinned)}`);
  // The sentence too, not just the fact — a workload's failure has to be recognisable as the same
  // failure a functional run would have reported, since comparability across the two is the point
  // of having one language for both.
  assert.equal(pinned.message, pooled.message, 'which client a step runs on must not change what a blown deadline says');
  assert.match(pinned.message, /timed out after 1000ms: GET/);

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('a chain that fits inside its budget still lands — the deadline is the chain’s, not each hop’s', async () => {
  // The negative control for the fix rather than for the defect: hoisting a deadline out of a loop
  // is exactly the change that over-tightens by accident (an un-rearmed timer, a stale flag), and
  // this is the case that would go red if it had.
  const server = await startFixtureServer(slowChainRoutes(2, 50));
  const agents = createKeepAliveAgents();
  const opts = { method: 'GET', url: `${server.baseUrl}/hop2`, headers: {}, timeoutMs: 2000, followRedirects: true } as const;

  const pooled = await sendRequest(opts);
  const pinned = await sendPinnedRequest(opts, agents);

  assert.equal(pinned.status, pooled.status);
  assert.equal(pinned.status, 200);
  assert.deepEqual(pinned.json, pooled.json);

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('back-to-back requests each get a fresh deadline — it is per call, not per pinned Agent pair', async () => {
  // The other way to over-tighten: one deadline for the chain must not become one deadline for the
  // VU. A workload runs thousands of iterations through the same `KeepAliveAgents`, so a timer that
  // outlived its call would fail every request after the first `timeoutMs` of the run.
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      setTimeout(() => json(res, 200, { ok: true }), 120);
    },
  });
  const agents = createKeepAliveAgents();
  const opts = { method: 'GET', url: `${server.baseUrl}/slow`, headers: {}, timeoutMs: 300, followRedirects: true } as const;

  for (let i = 0; i < 4; i++) {
    const res = await sendPinnedRequest(opts, agents);
    assert.equal(res.status, 200, `request ${i + 1} of 4 should still have its own 300ms`);
  }

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('the same step and the same `timeout` give the same verdict functionally and under a workload', async () => {
  // The end-to-end shape of `B4-04`, at the surface an author actually sees — and the probe that
  // confirmed it live on 2026-08-05 (`REVIEW_FINDINGS.md` §C2): one file, one `timeout 1s`, one
  // 3-hop chain, run both ways. Functional ✗ `request timed out after 1000ms`; workload ✓ PASS,
  // reporting a p95 21% over the deadline it was given as healthy.
  const server = await startFixtureServer(slowChainRoutes(2, 400));
  const body = '  api GET /hop2 timeout 1s\n  expect status equals 200\n';
  const functionalSource = `test "Chain"\n${body}`;
  // A workload's verdict is its thresholds' (`report.ok` reads nothing else), so comparing verdicts
  // at all requires one — which is also why `TF033` makes a threshold-less workload an error.
  const workloadSource = `test "Chain"\n  run 1 iterations per user across 1 users\n${body}  threshold error rate is less than 50%\n`;

  const functional = await runProgram(parseSource(functionalSource).program, testConfig(server.baseUrl), { source: functionalSource });
  // M91a (`B3-06`): was `runLoad`, an entry point with no production caller. The workload rows
  // come out of the shipped `runProgram` path now, read off the report it actually returns.
  const workloadRun = await runProgram(parseSource(workloadSource).program, testConfig(server.baseUrl), { source: workloadSource });
  const workload = { ...workloadRun.report, scenarios: workloadRun.report.tests.filter((t) => t.kind === 'workload') };

  assert.equal(functional.report.ok, false, JSON.stringify(functional.report.tests, null, 2));
  assert.match(functional.report.tests[0]!.error ?? '', /timed out after 1000ms/);

  const scenario = workload.scenarios[0]!;
  assert.equal(scenario.metrics.iterations, 1);
  assert.equal(workload.ok, functional.report.ok, 'a step that misses its deadline functionally must miss it under a workload too');
  assert.equal(scenario.metrics.errorRate, 1, JSON.stringify(scenario.metrics, null, 2));

  // And the number the threshold would have been evaluated against is inside the budget that
  // produced it. `p95 1210ms` under `timeout 1s` was the visible symptom, and it is the half a
  // verdict check alone would not catch: a run can report an over-budget duration *and* fail.
  assert.ok(
    scenario.metrics.durations.max <= 1000 + 250,
    `a whole-chain deadline of 1000ms cannot yield a ${scenario.metrics.durations.max}ms iteration`,
  );

  await server.close();
});
