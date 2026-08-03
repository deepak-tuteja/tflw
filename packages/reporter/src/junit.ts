// M2.5: junit.xml — the standard CI-consumable summary alongside report.html (SPEC §13, P#23).
// Pure function, no I/O (mirrors renderReportHtml/renderCliSummary); the CLI does the writing.
// M56 (Phase 3, D119) collapses in what was `load-junit.ts`'s separate `load-junit.xml`: one
// `<testsuite>`, one `<testcase>` per `ReportEntry` regardless of kind.

import type { LoadThresholdResult, ReportEntry, RunReport, TestResult, WorkloadTestResult } from '@tflw/runtime';

export function renderJunitXml(report: RunReport): string {
  const time = (report.durationMs / 1000).toFixed(3);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  const total = report.tests.reduce((n, t) => n + testCaseCount(t), 0);
  const failures = report.tests.reduce((n, t) => n + testCaseFailureCount(t, report.inconclusive ?? false), 0);
  const skipped = report.inconclusive ? report.tests.filter((t) => t.kind === 'workload').reduce((n, t) => n + testCaseCount(t), 0) : 0;
  lines.push(
    `<testsuite name="tflw" tests="${total}" failures="${failures}" errors="0"${skipped > 0 ? ` skipped="${skipped}"` : ''} time="${time}" timestamp="${esc(report.startedAt)}">`,
  );
  lines.push('  <properties>');
  lines.push(`    <property name="env" value="${esc(report.env)}"/>`);
  lines.push(`    <property name="seed" value="${report.seed}"/>`);
  lines.push(`    <property name="now" value="${esc(report.now)}"/>`);
  if (report.aborted) lines.push(`    <property name="aborted" value="${esc(report.abortedMessage ?? 'true')}"/>`);
  lines.push('  </properties>');
  for (const t of report.tests) lines.push(...renderEntry(t, report.inconclusive ?? false));
  lines.push('</testsuite>');
  return lines.join('\n') + '\n';
}

function testCaseCount(entry: ReportEntry): number {
  return entry.kind === 'workload' ? Math.max(1, entry.thresholds.length) : 1;
}

function testCaseFailureCount(entry: ReportEntry, inconclusive: boolean): number {
  if (entry.kind !== 'workload') return entry.ok ? 0 : 1;
  if (inconclusive) return 0; // R11: inconclusive marks every threshold skipped, not failed
  return entry.thresholds.filter((t) => !t.ok).length;
}

function renderEntry(entry: ReportEntry, inconclusive: boolean): string[] {
  return entry.kind === 'workload' ? renderWorkloadTestCases(entry, inconclusive) : [renderTestCase(entry)];
}

function renderTestCase(test: TestResult): string {
  const time = (test.durationMs / 1000).toFixed(3);
  const attrs = `name="${esc(test.name)}" time="${time}"`;
  if (test.ok) {
    if (!test.flaky) return `  <testcase ${attrs}/>`;
    const priorCount = test.attempts ? test.attempts.length - 1 : undefined;
    const message =
      priorCount !== undefined
        ? `flaky: passed on attempt ${test.attempts!.length} of ${test.attempts!.length} (${priorCount} prior attempt${priorCount === 1 ? '' : 's'} failed)`
        : 'flaky: passed after a retry';
    return `  <testcase ${attrs}>\n    <system-out>${esc(message)}</system-out>\n  </testcase>`;
  }
  const message = esc(test.error ?? 'test failed');
  return `  <testcase ${attrs}>\n    <failure message="${message}">${message}</failure>\n  </testcase>`;
}

/** M56 (Phase 3, D119) — one `<testcase>` per declared `threshold` (named `${test.name} — ${label}
 * ${op} ${target}`, matching the old `load-junit.ts` naming so existing CI dashboards reading that
 * shape keep working), or one bare `<testcase name="${test.name}"/>` when it declared none — so a
 * threshold-less workload test still shows up in CI output instead of vanishing entirely.
 *
 * M60 (A4-01) narrowed how a threshold-less result can arrive here: the checker now rejects a
 * workload-bearing `test` with no `threshold` (TF033), because its verdict is decided only by
 * thresholds, so with none it reported `PASS` over a 100% error rate. The zero-threshold branch
 * stays — this is a library boundary and a caller can still hand one in — but it is no longer a
 * shape any `.tflw` file run through the CLI produces. */
function renderWorkloadTestCases(test: WorkloadTestResult, inconclusive: boolean): string[] {
  if (test.thresholds.length === 0) return [`  <testcase name="${esc(test.name)}" time="0.000"/>`];
  return test.thresholds.map((t) => renderThresholdTestCase(test, t, inconclusive));
}

function renderThresholdTestCase(test: WorkloadTestResult, threshold: LoadThresholdResult, inconclusive: boolean): string {
  const cmp = threshold.op === 'lessThan' ? '<' : '>';
  const name = `${test.name} — ${threshold.label} ${cmp} ${threshold.target}`;
  const attrs = `name="${esc(name)}" time="0.000"`;
  // R11: "an inconclusive run marks them skipped, not passed" — a saturated generator invalidates
  // every threshold's verdict in this run, not just the ones that happened to fail.
  if (inconclusive) {
    return `  <testcase ${attrs}>\n    <skipped message="tflw's own generator process saturated during this run — results are inconclusive"/>\n  </testcase>`;
  }
  if (threshold.ok) return `  <testcase ${attrs}/>`;
  const message = esc(`threshold breached: actual ${threshold.actual} ${cmp === '<' ? 'was not less than' : 'was not greater than'} ${threshold.target}`);
  return `  <testcase ${attrs}>\n    <failure message="${message}">${message}</failure>\n  </testcase>`;
}

// XML 1.0 forbids every C0 control character other than tab/LF/CR outright — not just the five
// entity-escaped characters (decision 73). A test name or error message that happens to echo one
// (e.g. from a garbled/binary response body) would otherwise produce a `junit.xml` that some CI
// JUnit parsers reject as not well-formed rather than degrade gracefully.
const XML_INVALID_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function esc(s: string): string {
  return s
    .replace(XML_INVALID_CONTROL_CHARS, '�')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
