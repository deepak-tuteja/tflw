// M31 (PLAN_BROWSER_PERF_SECURITY.md D19/D28) — `startSelfDiagnosis`/`mergeSelfDiagnosis`: the
// generator's own event-loop-lag/CPU self-check ("tflw itself is the bottleneck"). The saturation
// case is tested via a deliberate, guaranteed-real synchronous block (not a timing race like the
// flaky wall-clock assertion M30 had to fix) — a real full-suite-CPU-contention false positive on
// the *healthy* case is still possible in principle, so that case only asserts the stats are sane,
// never that `saturated` is strictly `false`.
//
// The *saturated* case flaked in CI once (2026-08-03, cpuPercent 43.6% against a >50 floor) —
// under real contention, a `setTimeout`-based sleep tacked onto the busy-block can itself overshoot
// its wall-clock duration, diluting cpuPercent's denominator without adding real CPU. Fixed by
// shrinking that sleep to the minimum needed (just enough for the interval's overdue tick to fire)
// and extending the block itself for margin — see the test's own comment for the full mechanism.
// Confirmed via deliberate CPU-oversubscription locally (20 busy processes on a 16-core machine)
// that a sufficiently extreme contention level can still starve the block itself of proportional
// CPU (a different mechanism, not the sleep-overshoot above) — real GH-hosted runners are
// dedicated 2-4 vCPU, not oversubscribed like that, but the bounded retry below is cheap insurance
// against a transient spike either way, without paying `--test-concurrency=1`'s ~3x wall-clock
// cost across this entire (largest) test suite for a scenario this unlikely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSelfDiagnosis, mergeSelfDiagnosis } from '../src/selfDiagnosis.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('a mostly-idle window produces sane, non-negative stats', async () => {
  const diag = startSelfDiagnosis(50);
  await sleep(300);
  const result = diag.stop();
  assert.ok(result.avgEventLoopLagMs >= 0);
  assert.ok(result.maxEventLoopLagMs >= result.avgEventLoopLagMs);
  assert.ok(result.cpuPercent >= 0);
  assert.equal(typeof result.saturated, 'boolean');
});

test('a deliberately blocked event loop is detected as saturated', async () => {
  const MAX_ATTEMPTS = 3;
  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const diag = startSelfDiagnosis(20);
    // A real synchronous busy-block — the event loop genuinely cannot service the 20ms interval
    // timer during this window, so when it resumes there is a real, large lag sample waiting,
    // regardless of what else is happening on the machine (unlike a race against another timer).
    // 350ms clears MIN_SATURATION_WINDOW_MS (300ms) with margin on its own.
    const blockStart = performance.now();
    while (performance.now() - blockStart < 350) {
      // spin
    }
    // A short yield (not the previous 150ms) — just enough for the overdue 20ms interval tick to
    // actually fire and record its lag sample before `stop()` reads it; `stop()` runs
    // synchronously, so without *some* await here the pending tick never gets a turn. Kept short
    // deliberately: a `setTimeout`-based sleep's wall-clock duration can overshoot under real CI
    // CPU contention, diluting `cpuPercent`'s denominator without adding real CPU. A 150ms sleep
    // tacked onto a 300ms block left only a ~66.7% theoretical ceiling, no room for any overshoot;
    // a 20ms sleep tacked onto a 350ms block leaves a ~94.6% ceiling, comfortably absorbing an
    // overshoot many times its own size.
    await sleep(20);
    result = diag.stop();
    if (result.saturated && result.maxEventLoopLagMs > 100 && result.cpuPercent > 50) break;
    // Retry (bounded, see file header) — only a sufficiently extreme, transient contention spike
    // reaches this point, starving the busy-block itself of proportional CPU regardless of how
    // short the trailing sleep is.
  }
  assert.equal(result.saturated, true, JSON.stringify(result));
  assert.ok(result.maxEventLoopLagMs > 100, `expected a large lag spike, got ${result.maxEventLoopLagMs}ms`);
  assert.ok(result.cpuPercent > 50, `expected high CPU from the busy-block, got ${result.cpuPercent}% (after ${MAX_ATTEMPTS} attempts)`);
});

test('a very short run never reports saturated, even with an inflated CPU% reading (M32 fix)', async () => {
  // Under ~300ms, one-time startup cost (module/regex/JIT warm-up) can read as a high `cpuMs /
  // wallMs` percentage without any real sustained saturation — discovered via a genuinely short
  // (150ms) two-scenario `tflw load` run reading 140% CPU from pure startup cost. A brief busy
  // block reproduces the same shape deterministically: real CPU time, tiny wall-clock denominator.
  const diag = startSelfDiagnosis(20);
  const blockStart = performance.now();
  while (performance.now() - blockStart < 50) {
    // spin — inflates cpuPercent the same way a real short run's one-time costs do
  }
  const result = diag.stop();
  assert.equal(result.saturated, false, JSON.stringify(result));
});

test('mergeSelfDiagnosis: saturated is the logical OR across shards, not an average', () => {
  const healthy = { avgEventLoopLagMs: 1, maxEventLoopLagMs: 2, cpuPercent: 10, saturated: false };
  const saturated = { avgEventLoopLagMs: 200, maxEventLoopLagMs: 400, cpuPercent: 95, saturated: true };
  const merged = mergeSelfDiagnosis([healthy, healthy, saturated]);
  assert.equal(merged.saturated, true);
});

test('mergeSelfDiagnosis: lag/CPU are averaged, maxEventLoopLagMs is the worst single spike', () => {
  const a = { avgEventLoopLagMs: 10, maxEventLoopLagMs: 20, cpuPercent: 40, saturated: false };
  const b = { avgEventLoopLagMs: 30, maxEventLoopLagMs: 50, cpuPercent: 60, saturated: false };
  const merged = mergeSelfDiagnosis([a, b]);
  assert.equal(merged.avgEventLoopLagMs, 20);
  assert.equal(merged.maxEventLoopLagMs, 50);
  assert.equal(merged.cpuPercent, 50);
  assert.equal(merged.saturated, false);
});

test('mergeSelfDiagnosis throws on an empty array', () => {
  assert.throws(() => mergeSelfDiagnosis([]), /at least one/);
});
