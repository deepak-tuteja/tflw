// M32 (PLAN_REPORTS_PERF_SECURITY.md R11) — junit.xml for a `LoadReport`: one `<testcase>` per
// scenario × declared `threshold`, so existing CI gating (already reading junit for `tflw run`)
// works unchanged for `tflw load` too. Named `load-junit.xml`, not `junit.xml` — R2's naming table
// reuses `junit.xml` for both `run` and `load`, but both modes write into the same `report/`
// directory by default, and a CI pipeline running both in one job would have the second silently
// clobber the first; the mode-prefix R2 already uses for `load-report.html`/`load-results.json`
// avoids that same collision here.

import type { LoadReport, LoadScenarioReport, LoadThresholdResult } from '@tflw/runtime';

export function renderLoadJunitXml(report: LoadReport): string {
  const time = (report.durationMs / 1000).toFixed(3);
  const total = report.scenarios.reduce((n, s) => n + s.thresholds.length, 0);
  const failures = report.inconclusive ? 0 : report.scenarios.reduce((n, s) => n + s.thresholds.filter((t) => !t.ok).length, 0);
  const skipped = report.inconclusive ? total : 0;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<testsuite name="tflw load" tests="${total}" failures="${failures}" errors="0" skipped="${skipped}" time="${time}" timestamp="${esc(report.startedAt)}">`);
  lines.push('  <properties>');
  lines.push(`    <property name="seed" value="${report.seed}"/>`);
  lines.push(`    <property name="now" value="${esc(report.now)}"/>`);
  if (report.aborted) lines.push(`    <property name="aborted" value="${esc(report.abortedMessage ?? 'true')}"/>`);
  lines.push('  </properties>');
  for (const scenario of report.scenarios) {
    for (const threshold of scenario.thresholds) lines.push(renderTestCase(scenario, threshold, report.inconclusive));
  }
  lines.push('</testsuite>');
  return lines.join('\n') + '\n';
}

function renderTestCase(scenario: LoadScenarioReport, threshold: LoadThresholdResult, inconclusive: boolean): string {
  const cmp = threshold.op === 'lessThan' ? '<' : '>';
  const name = `${scenario.name} — ${threshold.label} ${cmp} ${threshold.target}`;
  const attrs = `name="${esc(name)}" time="0.000"`;
  // R11: "an inconclusive run marks them skipped, not passed" — a saturated generator invalidates
  // every threshold's verdict in this run, not just the ones that happened to fail, so no
  // threshold here is reported passing OR failing.
  if (inconclusive) {
    return `  <testcase ${attrs}>\n    <skipped message="tflw's own generator process saturated during this run — results are inconclusive"/>\n  </testcase>`;
  }
  if (threshold.ok) return `  <testcase ${attrs}/>`;
  const message = esc(`threshold breached: actual ${threshold.actual} ${cmp === '<' ? 'was not less than' : 'was not greater than'} ${threshold.target}`);
  return `  <testcase ${attrs}>\n    <failure message="${message}">${message}</failure>\n  </testcase>`;
}

function esc(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '�')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
