// M2.5: junit.xml — the standard CI-consumable summary alongside report.html (SPEC §13, P#23).
// Pure function, no I/O (mirrors renderReportHtml/renderCliSummary); the CLI does the writing.
// M56 (Phase 3, D119) collapses in what was `load-junit.ts`'s separate `load-junit.xml`: one
// `<testcase>` per `ReportEntry` regardless of kind.
//
// M65 (FS-09, review finding A13-01) gives the document a real shape: a `<testsuites>` root, one
// `<testsuite>` per `.tflw` file, and `classname` on every `<testcase>`. Before it, every test from
// every file shared a single `<testsuite name="tflw">` and no `<testcase>` carried any file
// attribution at all — so two same-named tests in different files were byte-identical to a CI
// dashboard, which merges them into one and misattributes flaky-test history between them. The
// grouping key comes from `group-by-file.ts`, the same one `report.html`'s sidebar has always used.
//
// Changing the root element is breaking for anything that reads this file, which is why it happened
// now: `1.0.0` is the first publish, so today there is nobody to break. Most JUnit parsers accept
// either root; one that insists on a bare `<testsuite>` gets the wrapper it wanted anyway.

import type { LoadThresholdResult, ReportEntry, RunReport, TestResult, WorkloadTestResult } from '@tflw/runtime';
import { fileOf, groupByFile } from './group-by-file.js';
import { formatThresholdActual, formatThresholdTarget } from './threshold-format.js';

export function renderJunitXml(report: RunReport): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  const inconclusive = report.inconclusive ?? false;
  const suites = groupByFile(report.tests, fileOf);
  const totals = countsOf(report.tests, inconclusive);

  // The root's `time` is the run's wall clock, not the sum of its suites': files run concurrently,
  // so the sum would overstate how long the run took.
  lines.push(`<testsuites ${countAttrs('tflw', totals, (report.durationMs / 1000).toFixed(3), report)}>`);
  for (const [file, tests] of suites) lines.push(...renderSuite(file, tests, report, inconclusive));
  lines.push('</testsuites>');
  return lines.join('\n') + '\n';
}

interface Counts {
  readonly tests: number;
  readonly failures: number;
  readonly skipped: number;
}

function countsOf(entries: readonly ReportEntry[], inconclusive: boolean): Counts {
  return {
    tests: entries.reduce((n, t) => n + testCaseCount(t), 0),
    failures: entries.reduce((n, t) => n + testCaseFailureCount(t, inconclusive), 0),
    skipped: inconclusive ? entries.filter((t) => t.kind === 'workload').reduce((n, t) => n + testCaseCount(t), 0) : 0,
  };
}

function countAttrs(name: string, counts: Counts, time: string, report: RunReport): string {
  const skipped = counts.skipped > 0 ? ` skipped="${counts.skipped}"` : '';
  return `name="${esc(name)}" tests="${counts.tests}" failures="${counts.failures}" errors="0"${skipped} time="${time}" timestamp="${esc(report.startedAt)}"`;
}

/** One file's `<testsuite>`. Its `time` is the sum of its own testcases' durations — a workload
 * `<testcase>` contributes `0.000` (a workload test has no single "this took Nms" figure; its
 * a workload's declared span is planned, not an outcome), exactly as it does at the testcase level. */
function renderSuite(file: string, tests: readonly ReportEntry[], report: RunReport, inconclusive: boolean): string[] {
  const time = (tests.reduce((ms, t) => ms + entryDurationMs(t), 0) / 1000).toFixed(3);
  const lines: string[] = [];
  lines.push(`  <testsuite ${countAttrs(file, countsOf(tests, inconclusive), time, report)}>`);
  lines.push(...renderProperties(report));
  for (const t of tests) lines.push(...renderEntry(t, file, inconclusive));
  lines.push('  </testsuite>');
  return lines;
}

/** `env`/`seed`/`now`/`aborted` describe the *run*, not one file, but `<properties>` is only valid
 * under a `<testsuite>` — a root-level block would be rejected by a strict validator, and this is
 * an artifact CI depends on. So each suite repeats them, and any suite a reader opens can hand back
 * the seed needed to reproduce the run (SPEC §13). `aborted` likewise means "this run was aborted",
 * not "this file was": the merged report cannot attribute an abort to a file, and it never could —
 * `abortedMessage` names the first file aborted and nothing distinguishes the rest. */
function renderProperties(report: RunReport): string[] {
  const lines = ['    <properties>'];
  lines.push(`      <property name="env" value="${esc(report.env)}"/>`);
  lines.push(`      <property name="seed" value="${report.seed}"/>`);
  lines.push(`      <property name="now" value="${esc(report.now)}"/>`);
  if (report.aborted) lines.push(`      <property name="aborted" value="${esc(report.abortedMessage ?? 'true')}"/>`);
  lines.push('    </properties>');
  return lines;
}

function entryDurationMs(entry: ReportEntry): number {
  return entry.kind === 'workload' ? 0 : entry.durationMs;
}

function testCaseCount(entry: ReportEntry): number {
  return entry.kind === 'workload' ? Math.max(1, entry.thresholds.length) : 1;
}

function testCaseFailureCount(entry: ReportEntry, inconclusive: boolean): number {
  if (entry.kind !== 'workload') return entry.ok ? 0 : 1;
  if (inconclusive) return 0; // R11: inconclusive marks every threshold skipped, not failed
  return entry.thresholds.filter((t) => !t.ok).length;
}

function renderEntry(entry: ReportEntry, file: string, inconclusive: boolean): string[] {
  return entry.kind === 'workload' ? renderWorkloadTestCases(entry, file, inconclusive) : [renderTestCase(entry, file)];
}

/** M65 (FS-09): `classname` is the source file verbatim — the same string as the enclosing
 * `<testsuite name>`, and the same one `report.html`'s sidebar groups under. Not a dotted
 * Java-style package: a `.tflw` path is a path, and inventing a package name from it would produce
 * an identifier that appears nowhere else in the tool, in the output, or on disk. Playwright's own
 * JUnit reporter makes the same call. */
function renderTestCase(test: TestResult, file: string): string {
  const time = (test.durationMs / 1000).toFixed(3);
  const attrs = `name="${esc(test.name)}" classname="${esc(file)}" time="${time}"`;
  if (test.ok) {
    if (!test.flaky) return `    <testcase ${attrs}/>`;
    const priorCount = test.attempts ? test.attempts.length - 1 : undefined;
    const message =
      priorCount !== undefined
        ? `flaky: passed on attempt ${test.attempts!.length} of ${test.attempts!.length} (${priorCount} prior attempt${priorCount === 1 ? '' : 's'} failed)`
        : 'flaky: passed after a retry';
    return `    <testcase ${attrs}>\n      <system-out>${esc(message)}</system-out>\n    </testcase>`;
  }
  const message = esc(test.error ?? 'test failed');
  return `    <testcase ${attrs}>\n      <failure message="${message}">${message}</failure>\n    </testcase>`;
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
function renderWorkloadTestCases(test: WorkloadTestResult, file: string, inconclusive: boolean): string[] {
  if (test.thresholds.length === 0) return [`    <testcase name="${esc(test.name)}" classname="${esc(file)}" time="0.000"/>`];
  return test.thresholds.map((t) => renderThresholdTestCase(test, t, file, inconclusive));
}

function renderThresholdTestCase(test: WorkloadTestResult, threshold: LoadThresholdResult, file: string, inconclusive: boolean): string {
  const cmp = threshold.op === 'lessThan' ? '<' : '>';
  const name = `${test.name} — ${threshold.label} ${cmp} ${threshold.target}`;
  const attrs = `name="${esc(name)}" classname="${esc(file)}" time="0.000"`;
  // R11: "an inconclusive run marks them skipped, not passed" — a saturated generator invalidates
  // every threshold's verdict in this run, not just the ones that happened to fail.
  if (inconclusive) {
    return `    <testcase ${attrs}>\n      <skipped message="tflw's own generator process saturated during this run — results are inconclusive"/>\n    </testcase>`;
  }
  if (threshold.ok) return `    <testcase ${attrs}/>`;
  // M89a — the same formatter the console and `report.html` use, so all three sinks agree on units
  // and on how "no successful iterations" (D-M89-1's `actual: null`) is worded. Previously this
  // interpolated the raw number, which would have rendered that case as the literal `null`.
  const message = esc(`threshold breached: actual ${formatThresholdActual(threshold)} ${cmp === '<' ? 'was not less than' : 'was not greater than'} ${formatThresholdTarget(threshold)}`);
  return `    <testcase ${attrs}>\n      <failure message="${message}">${message}</failure>\n    </testcase>`;
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
