// A compact terminal summary of a run (SPEC §13). Secrets are already redacted in the report.

import type { LoadDurationStats, LoadMetrics, RunReport, SelfDiagnosis, TestResult, WorkloadTestResult } from '@tflw/runtime';
import { formatThresholdActual, formatThresholdTarget } from './threshold-format.js';
import { describeWorkload } from './workload-format.js';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  bold: '\x1b[1m',
};

export function renderCliSummary(report: RunReport, color = true): string {
  const c = color ? C : { reset: '', dim: '', red: '', green: '', bold: '' };
  const lines: string[] = [];
  for (const test of report.tests) {
    if (test.kind === 'workload') {
      lines.push(...workloadLines(test, c));
      continue;
    }
    lines.push(testLine(test, c));
    for (const step of test.steps) {
      if (!step.ok) lines.push(`    ${c.red}✗ ${step.source}${c.reset}${step.detail ? `\n      ${c.red}${step.detail}${c.reset}` : ''}`);
    }
  }
  const tally = `${report.passed}/${report.total} passed${report.failed ? `, ${report.failed} failed` : ''}`;
  const badge = report.ok ? `${c.green}${c.bold}PASS${c.reset}` : `${c.red}${c.bold}FAIL${c.reset}`;
  lines.push('');
  lines.push(`${badge} ${tally} ${c.dim}· env ${report.env} · seed ${report.seed} · now ${report.now} · ${report.durationMs} ms${c.reset}`);
  // Never a silent trade-off: `insecure true` disables TLS certificate verification for the whole
  // run (decision 78) — every summary says so, loudly, in red, not just in `tflw.config`.
  if (report.insecure) lines.push(`${c.red}${c.bold}⚠ insecure: true${c.reset}${c.dim} — TLS certificate verification was disabled for this run${c.reset}`);
  if (report.selfDiagnosis) lines.push(generatorLine(report.selfDiagnosis, c));
  if (report.inconclusive) lines.push(`${c.red}${c.bold}⚠ inconclusive${c.reset}${c.dim} — tflw itself is the bottleneck; workload numbers above reflect tflw contending with itself, not the system under test${c.reset}`);
  if (report.aborted) lines.push(`${c.red}${c.bold}⚠ aborted${c.reset}${c.dim} — ${report.abortedMessage ?? 'stopped before its planned duration elapsed'}${c.reset}`);
  return lines.join('\n');
}

function testLine(test: TestResult, c: typeof C): string {
  const mark = test.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const flaky = test.flaky ? ` ${c.dim}(flaky)${c.reset}` : '';
  return `  ${mark} ${test.name}${flaky} ${c.dim}(${test.durationMs} ms)${c.reset}`;
}

/** M56 (Phase 3, D122) — a workload test's console lines, folded into the one final summary
 * alongside functional ones instead of a separate `renderLoadSummary` block: name + ok/fail mark
 * + workload description, the same iterations/failures/error-rate/duration line the old
 * `renderLoadMetricsLine` printed per scenario, one tick-marked line per declared `threshold`
 * (empty when it declared none, matching `junit.ts`'s D119 "nothing to gate on" treatment), and a
 * per-endpoint breakdown (M43/D69) when there's more than one identity to break down. */
function workloadLines(test: WorkloadTestResult, c: typeof C): string[] {
  const mark = test.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const lines = [`  ${mark} ${test.name} ${c.dim}(workload — ${describeWorkload(test.workload)})${c.reset}`, ...metricsLines(test.metrics, c)];
  for (const t of test.thresholds) {
    const tickMark = t.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const cmp = t.op === 'lessThan' ? '<' : '>';
    lines.push(`      ${tickMark} ${t.label} ${cmp} ${formatThresholdTarget(t)} ${c.dim}(actual: ${formatThresholdActual(t)})${c.reset}`);
  }
  if (test.backOff?.warning) {
    const pct = (test.backOff.ratio * 100).toFixed(0);
    lines.push(`    ${c.red}⚠ your load backed off — an estimated ${pct}% of this test's available VU time was lost to the target system slowing down; results understate real latency${c.reset}`);
  }
  if (test.endpoints.length > 1) {
    lines.push(`    ${c.dim}endpoints:${c.reset}`);
    for (const e of test.endpoints) {
      const d = e.metrics.durations;
      lines.push(`      ${c.dim}${e.identity}: iterations ${e.metrics.iterations}  error rate ${(e.metrics.errorRate * 100).toFixed(2)}%  p50 ${d.p50}ms  p95 ${d.p95}ms  p99 ${d.p99}ms${c.reset}`);
    }
  }
  return lines;
}

function metricsLines(metrics: LoadMetrics, c: typeof C): string[] {
  const lines = [`    ${c.dim}iterations: ${metrics.iterations}  failures: ${metrics.failures}  error rate: ${(metrics.errorRate * 100).toFixed(2)}%${c.reset}`];
  // M89a (D-M89-0) — **both** populations, labelled. Thresholds read the successful-only line, so
  // that one is what an author needs to reconcile a verdict against; the all-iterations line stays
  // because it is the run that actually happened, and seeing the two diverge is itself the signal
  // that failures are fast (`B3-02`'s whole mechanism). When nothing failed they are identical and
  // the second line is suppressed — a run with no failures shouldn't pay for a distinction that
  // has no content in it.
  lines.push(`    ${c.dim}duration (ms, pause-excluded, all ${metrics.iterations}): ${durationDigits(metrics.durations)}${c.reset}`);
  if (metrics.failures > 0) {
    const s = metrics.successful;
    const detail = s.iterations === 0 ? 'none — every iteration failed, so thresholds on duration cannot be evaluated' : durationDigits(s.durations);
    lines.push(`    ${c.dim}duration (ms, successful ${s.iterations} — what thresholds read): ${detail}${c.reset}`);
  }
  return lines;
}

function durationDigits(d: LoadDurationStats): string {
  return `min ${d.min}  avg ${Math.round(d.avg)}  p50 ${d.p50}  p90 ${d.p90}  p95 ${d.p95}  p99 ${d.p99}  max ${d.max}`;
}

/** M31 (D19/D28): the generator's own event-loop-lag/CPU reading, once per run (not per workload
 * test — `SelfDiagnosis` is a run-level property). Healthy — dim, one line; saturated — the
 * "tflw itself is the bottleneck" warning D28 asks the report to say out loud. */
function generatorLine(d: SelfDiagnosis, c: typeof C): string {
  const stats = `avg event-loop lag ${d.avgEventLoopLagMs.toFixed(1)}ms  max ${d.maxEventLoopLagMs.toFixed(1)}ms  cpu ${d.cpuPercent.toFixed(0)}%`;
  if (!d.saturated) return `${c.dim}generator: ${stats}${c.reset}`;
  return `${c.red}${c.bold}⚠ tflw itself is the bottleneck${c.reset}${c.dim} (${stats}) — measured latency/throughput reflects tflw's own generator process, not your system under test${c.reset}`;
}
