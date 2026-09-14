// The words and the order a run's findings are read in — pure, so that every sink can share them:
// the console, `report.html`, SARIF and, since `M192` U5, the page, which bundles for a browser
// and cannot import a module that reaches for `node:crypto` (`scanFindings.ts` does, for the
// fingerprint). Moved here from `scanFindings.ts` (the labels) and `@tflw/reporter`'s
// `findings.ts` (the order and the tally) with no change to either; the reporter re-exports them
// so its consumers and tests see the same names.

import type { ScanFinding, ScanKind, WithheldReason } from './scanFindings.js';

export const SCAN_KIND_LABEL: Readonly<Record<ScanKind, string>> = {
  security: 'security',
  authorization: 'authorization',
  'input-handling': 'input handling',
};

export const WITHHELD_LABEL: Readonly<Record<WithheldReason, string>> = {
  baseline: 'known/accepted',
  'fail-on': 'below --fail-on',
  seeded: 'seeded — never gates',
};

const SEVERITY_ORDER: Readonly<Record<string, number>> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/**
 * Gating findings first, then withheld ones; within each, worst severity first, then endpoint,
 * rule and site. The gate's verdict is the primary key because it is the reader's first question;
 * severity second because a critical finding the gate withheld is still the row to look at next.
 * Within a bucket the order is fully determined, so two runs of one suite produce byte-identical
 * output and a diff shows a real change.
 */
export function sortFindings(findings: readonly ScanFinding[]): ScanFinding[] {
  return [...findings].sort(
    (a, b) =>
      Number(Boolean(a.withheld)) - Number(Boolean(b.withheld)) ||
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.endpoint.localeCompare(b.endpoint) ||
      a.rule.localeCompare(b.rule) ||
      (a.location ?? '').localeCompare(b.location ?? ''),
  );
}

/** The one-line tally: how many findings gate, and how many were withheld and why. */
export function findingsSummaryLine(findings: readonly ScanFinding[]): string {
  const gating = findings.filter((f) => !f.withheld).length;
  const by = new Map<WithheldReason, number>();
  for (const f of findings) if (f.withheld) by.set(f.withheld, (by.get(f.withheld) ?? 0) + 1);
  const parts = [`${gating} failing`];
  for (const [reason, n] of by) parts.push(`${n} ${WITHHELD_LABEL[reason]}`);
  return `${findings.length} finding${findings.length === 1 ? '' : 's'} — ${parts.join(', ')}`;
}
