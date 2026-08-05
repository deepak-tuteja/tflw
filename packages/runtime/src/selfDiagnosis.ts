// M31 (PLAN_BROWSER_PERF_SECURITY.md D19/D28) — generator self-diagnosis: the same per-process
// worker loop already being instrumented for the histogram merge also samples its own event-loop
// lag and CPU usage over the run, so the report can say "tflw itself is the bottleneck" instead of
// silently handing back numbers that describe tflw's own generator process, not the system under
// test. This is diagnostic, not a control loop — it never throttles or paces the run, only reports
// on it (same restraint D18 already applies to `expect` inside a scenario: observe, never abort
// the run).

import type { SelfDiagnosis } from './types.js';

/** How long a saturated event loop is allowed to lag behind a healthy one before that alone counts
 * as saturation, expressed as a multiple of the sample interval — a healthy loop's lag should track
 * near 0 regardless of the interval chosen; lag exceeding the interval itself means scheduled work
 * (timers, VU wake-ups, the arrival schedule) is queuing behind other work on the same thread. */
const LAG_SATURATION_MULTIPLE = 1;
/** CPU saturation threshold, percent of one core — left headroom below 100 since a process rarely
 * reads as a clean 100.00 even when fully pinned (GC pauses, syscall accounting). */
const CPU_SATURATION_PERCENT = 90;
/** M32 — a run shorter than this never declares `saturated`, no matter how the numbers read.
 * `cpuPercent` is `cpuMs / wallMs`; one-time startup cost (V8 JIT warm-up, first-call module/regex
 * compilation) is real CPU time that doesn't shrink just because the run is brief, so a very short
 * window inflates the *rate* even when nothing is actually sustained-saturated — discovered via a
 * genuinely tiny (150ms) two-scenario run reading 140% CPU from pure startup cost, not load. Longer
 * runs amortize that fixed cost away on their own; this floor just stops a short one from reading a
 * transient blip as a verdict. */
const MIN_SATURATION_WINDOW_MS = 300;

/** Starts sampling this process's event-loop lag (via `setInterval` drift) and CPU usage (via
 * `process.cpuUsage()` deltas) immediately. `peek()` (M32, R5 — "surfaces the generator
 * self-diagnosis live") computes the verdict from samples collected so far without stopping
 * anything, so the CLI's ~1Hz progress tick can show a saturating generator mid-run, not just at
 * the end; `stop()` ends sampling and returns the final verdict. Safe to call once per
 * workload run — the timer is `unref`'d so it never itself keeps the process
 * alive. */
export function startSelfDiagnosis(sampleMs = 100): { peek(): SelfDiagnosis; stop(): SelfDiagnosis } {
  const lags: number[] = [];
  let expected = performance.now() + sampleMs;
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + sampleMs;
  }, sampleMs);
  timer.unref?.();

  const compute = (): SelfDiagnosis => {
    const wallMs = Math.max(1, performance.now() - wallStart);
    const cpu = process.cpuUsage(cpuStart);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const cpuPercent = (cpuMs / wallMs) * 100;
    const avgEventLoopLagMs = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;
    const maxEventLoopLagMs = lags.length > 0 ? Math.max(...lags) : 0;
    const saturated = wallMs >= MIN_SATURATION_WINDOW_MS && (avgEventLoopLagMs > sampleMs * LAG_SATURATION_MULTIPLE || cpuPercent > CPU_SATURATION_PERCENT);
    return { avgEventLoopLagMs, maxEventLoopLagMs, cpuPercent, saturated };
  };

  return {
    peek: compute,
    stop(): SelfDiagnosis {
      clearInterval(timer);
      return compute();
    },
  };
}

/** Combines every shard (worker process)'s own `SelfDiagnosis` into one verdict for the merged
 * report (M31 multi-process, `mergeLoadShardReports`) — if *any* generator process saturated, the
 * whole run's numbers are suspect, so `saturated` is the logical OR, not an average; the lag/CPU
 * numbers themselves are averaged (a representative generator-process reading) except
 * `maxEventLoopLagMs`, which stays the worst single spike across every process. Throws on an empty
 * array — a merge with zero shards is a caller bug, not a valid "no data" state (mirrors
 * `mergeLoadShardReports`'s own requirement of at least one shard). */
export function mergeSelfDiagnosis(diagnoses: readonly SelfDiagnosis[]): SelfDiagnosis {
  if (diagnoses.length === 0) throw new Error('mergeSelfDiagnosis needs at least one SelfDiagnosis');
  const avgEventLoopLagMs = diagnoses.reduce((sum, d) => sum + d.avgEventLoopLagMs, 0) / diagnoses.length;
  const maxEventLoopLagMs = Math.max(...diagnoses.map((d) => d.maxEventLoopLagMs));
  const cpuPercent = diagnoses.reduce((sum, d) => sum + d.cpuPercent, 0) / diagnoses.length;
  const saturated = diagnoses.some((d) => d.saturated);
  return { avgEventLoopLagMs, maxEventLoopLagMs, cpuPercent, saturated };
}
