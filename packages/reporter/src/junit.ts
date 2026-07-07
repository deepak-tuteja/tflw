// M2.5: junit.xml — the standard CI-consumable summary alongside report.html (SPEC §13, P#23).
// Pure function, no I/O (mirrors renderReportHtml/renderCliSummary); the CLI does the writing.

import type { RunReport, TestResult } from '@tflw/runtime';

export function renderJunitXml(report: RunReport): string {
  const time = (report.durationMs / 1000).toFixed(3);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuite name="tflw" tests="${report.total}" failures="${report.failed}" errors="0" time="${time}" timestamp="${esc(report.startedAt)}">`,
  );
  lines.push('  <properties>');
  lines.push(`    <property name="env" value="${esc(report.env)}"/>`);
  lines.push(`    <property name="seed" value="${report.seed}"/>`);
  lines.push(`    <property name="now" value="${esc(report.now)}"/>`);
  lines.push('  </properties>');
  for (const t of report.tests) lines.push(renderTestCase(t));
  lines.push('</testsuite>');
  return lines.join('\n') + '\n';
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
