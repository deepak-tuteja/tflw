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

/** Starts sampling this process's event-loop lag (via `setInterval` drift) and CPU usage (via
 * `process.cpuUsage()` deltas) immediately; `stop()` ends sampling and returns the verdict. Safe to
 * call once per `runLoad`/`runLoadShard` invocation — the timer is `unref`'d so it never itself
 * keeps the process alive. */
export function startSelfDiagnosis(sampleMs = 100): { stop(): SelfDiagnosis } {
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

  return {
    stop(): SelfDiagnosis {
      clearInterval(timer);
      const wallMs = Math.max(1, performance.now() - wallStart);
      const cpu = process.cpuUsage(cpuStart);
      const cpuMs = (cpu.user + cpu.system) / 1000;
      const cpuPercent = (cpuMs / wallMs) * 100;
      const avgEventLoopLagMs = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;
      const maxEventLoopLagMs = lags.length > 0 ? Math.max(...lags) : 0;
      const saturated = avgEventLoopLagMs > sampleMs * LAG_SATURATION_MULTIPLE || cpuPercent > CPU_SATURATION_PERCENT;
      return { avgEventLoopLagMs, maxEventLoopLagMs, cpuPercent, saturated };
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
