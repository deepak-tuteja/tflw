// M31 (PLAN_BROWSER_PERF_SECURITY.md D19/D28) — `startSelfDiagnosis`/`mergeSelfDiagnosis`: the
// generator's own event-loop-lag/CPU self-check ("tflw itself is the bottleneck"). The saturation
// case is tested via a deliberate, guaranteed-real synchronous block (not a timing race like the
// flaky wall-clock assertion M30 had to fix) — a real full-suite-CPU-contention false positive on
// the *healthy* case is still possible in principle, so that case only asserts the stats are sane,
// never that `saturated` is strictly `false`.

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
  const diag = startSelfDiagnosis(20);
  // A real synchronous busy-block — the event loop genuinely cannot service the 20ms interval
  // timer during this window, so when it resumes there is a real, large lag sample waiting,
  // regardless of what else is happening on the machine (unlike a race against another timer).
  const blockStart = performance.now();
  while (performance.now() - blockStart < 300) {
    // spin
  }
  // M32: `startSelfDiagnosis` won't declare `saturated` for a run under `MIN_SATURATION_WINDOW_MS`
  // (300ms) — a real, deliberate 300ms block plus this 150ms tail comfortably clears that floor
  // with margin, rather than landing right on the boundary.
  await sleep(150);
  const result = diag.stop();
  assert.equal(result.saturated, true, JSON.stringify(result));
  assert.ok(result.maxEventLoopLagMs > 100, `expected a large lag spike, got ${result.maxEventLoopLagMs}ms`);
  assert.ok(result.cpuPercent > 50, `expected high CPU from the busy-block, got ${result.cpuPercent}%`);
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
