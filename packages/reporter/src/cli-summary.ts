// A compact terminal summary of a run (SPEC §13). Secrets are already redacted in the report.

import type { RunReport, TestResult } from '@tflw/runtime';

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
  return lines.join('\n');
}

function testLine(test: TestResult, c: typeof C): string {
  const mark = test.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const flaky = test.flaky ? ` ${c.dim}(flaky)${c.reset}` : '';
  return `  ${mark} ${test.name}${flaky} ${c.dim}(${test.durationMs} ms)${c.reset}`;
}
