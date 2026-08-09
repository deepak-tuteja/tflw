// M31 (PLAN_BROWSER_PERF_SECURITY.md D19/D28) — `startSelfDiagnosis`/`mergeSelfDiagnosis`: the
// generator's own event-loop-lag/CPU self-check ("tflw itself is the bottleneck"). The saturation
// case is tested via a deliberate, guaranteed-real synchronous block (not a timing race like the
// flaky wall-clock assertion M30 had to fix) — a real full-suite-CPU-contention false positive on
// the *healthy* case is still possible in principle, so that case only asserts the stats are sane,
// never that `saturated` is strictly `false`.
//
// The *saturated* case flaked twice on a `cpuPercent` floor the busy-block could not guarantee:
// once in CI (2026-08-03, 43.6% against a >50 floor), then again inside a local mutation sweep
// (`M119-02`, 46.2%) — reproduced deliberately at 1-in-5 runs against 16 competing busy loops on a
// 16-core box, versus 0-in-6 at rest. The 2026-08-03 fix read it as a sleep-overshoot diluting
// cpuPercent's denominator, shrank the trailing sleep, and added a bounded retry; its own comment
// conceded that extreme contention could still starve the block of proportional CPU but judged the
// retry "cheap insurance ... for a scenario this unlikely". It was not that unlikely, and a retry
// cannot help when the contention outlasts the whole test — all 3 attempts ran under the same load.
//
// `M119` fixed the assertion rather than the number. `cpuPercent > 50` was never this test's
// subject: `saturated` is an OR, a real block drives the *lag* arm on any machine, and the two
// assertions before it had both already passed. Nor was 50 the production threshold (that is
// `CPU_SATURATION_PERCENT`, 90) — it measured how much of a core the OS handed this process, which
// is not a property of tflw. Both arms are now pinned deterministically against `isSaturated` at
// their real thresholds, so the CPU arm ends up better covered than the racing floor ever had it,
// and the block below asserts only what it genuinely causes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSelfDiagnosis, mergeSelfDiagnosis, isSaturated } from '../src/selfDiagnosis.js';

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
  // 350ms clears MIN_SATURATION_WINDOW_MS (300ms) with margin on its own. Every assertion below
  // fails *safe* under CPU contention: competition can only delay the overdue tick further and
  // stretch the wall-clock window, pushing lag and `wallMs` deeper past their thresholds. That is
  // what makes the retry this test used to carry unnecessary rather than merely insufficient.
  const blockStart = performance.now();
  while (performance.now() - blockStart < 350) {
    // spin
  }
  // A short yield — just enough for the overdue 20ms interval tick to actually fire and record its
  // lag sample before `stop()` reads it; `stop()` runs synchronously, so without *some* await here
  // the pending tick never gets a turn.
  await sleep(20);
  const result = diag.stop();
  assert.equal(result.saturated, true, JSON.stringify(result));
  assert.ok(result.maxEventLoopLagMs > 100, `expected a large lag spike, got ${result.maxEventLoopLagMs}ms`);
  // Sanity only, never a floor — how much CPU the OS actually granted this process is the
  // machine's business, not tflw's (see file header). The threshold itself is pinned below.
  assert.ok(result.cpuPercent >= 0, `expected a sane CPU reading, got ${result.cpuPercent}%`);
});

// ---- M119 (`M119-02`): both saturation arms at their real thresholds, no scheduler involved ----

test('isSaturated: the lag arm fires on its own, just past the sample interval', () => {
  const base = { wallMs: 1000, cpuPercent: 5, sampleMs: 20 };
  assert.equal(isSaturated({ ...base, avgEventLoopLagMs: 21 }), true);
  // Strictly greater — lag merely *equal* to the interval is a loop keeping up, not falling behind.
  assert.equal(isSaturated({ ...base, avgEventLoopLagMs: 20 }), false);
});

test('isSaturated: the CPU arm fires on its own, just past CPU_SATURATION_PERCENT', () => {
  // The arm the busy-block never reliably reached: a pinned process, healthy lag. 90 is the real
  // threshold the production verdict uses — the flaky test asserted 50, which was neither this
  // number nor anything the code controls.
  const base = { wallMs: 1000, avgEventLoopLagMs: 0, sampleMs: 20 };
  assert.equal(isSaturated({ ...base, cpuPercent: 91 }), true);
  assert.equal(isSaturated({ ...base, cpuPercent: 90 }), false);
});

test('isSaturated: neither arm fires below MIN_SATURATION_WINDOW_MS (M32 floor)', () => {
  // Both arms screaming, but the window is too short to mean anything — startup cost reads as a
  // high rate against a tiny denominator, which is exactly what M32 found in a 150ms real run.
  const hot = { avgEventLoopLagMs: 500, cpuPercent: 140, sampleMs: 20 };
  assert.equal(isSaturated({ ...hot, wallMs: 299 }), false);
  assert.equal(isSaturated({ ...hot, wallMs: 300 }), true);
});

test('isSaturated: a healthy sample in a long window is not saturated', () => {
  assert.equal(isSaturated({ wallMs: 60_000, avgEventLoopLagMs: 1, cpuPercent: 12, sampleMs: 100 }), false);
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
