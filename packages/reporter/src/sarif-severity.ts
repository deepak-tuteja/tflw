// M135a (PLAN_M135_SARIF.md D406) — tflw's four severities as the two things a SARIF consumer ranks
// on.
//
// **Why a table and not a `switch` at the call site.** R9 specified this mapping against a
// vocabulary tflw does not use — critical/high/medium/low, where the shipped levels are
// critical/serious/moderate/minor — so this file is that table *translated*, and translating it once
// in a named module is what lets `M135c` assert the numbers without re-deriving them.
//
// **The trap, and it is the one that ships silently.** `security-severity` is a **string** in
// `rule.properties`. GitHub ignores a numeric value, and ignoring it makes no noise: the alert
// appears, ranked wrong, and nothing anywhere says so. The type below is `string` for that reason
// and not as a stylistic preference.
//
// The numerics sit squarely inside GitHub's own bands (≥9.0 critical · 7.0–8.9 high · 4.0–6.9
// medium · <4.0 low) rather than on a boundary, so no rounding difference can reclassify a rule.

import type { Severity } from '@tflw/runtime';

/** The three SARIF result levels tflw emits. `none` is legal SARIF and unused here — every finding
 *  this tool produces is a weakness someone should act on. */
export type SarifLevel = 'error' | 'warning' | 'note';

export interface SarifSeverity {
  readonly level: SarifLevel;
  /** **A string, always.** See the header. */
  readonly securitySeverity: string;
}

/**
 * Four levels into three.
 *
 * `serious` reads as `error` alongside `critical` because the alternative makes the tool say two
 * different things about one finding: `--fail-on` defaults to failing on any finding, so a
 * `serious` fails the build while a dashboard filed it as a warning, and a reader comparing the two
 * trusts whichever they saw first. The compression is lossy and the `security-severity` numeric is
 * where the lost rank is recovered.
 */
export const SARIF_SEVERITY: Readonly<Record<Severity, SarifSeverity>> = {
  critical: { level: 'error', securitySeverity: '9.5' },
  serious: { level: 'error', securitySeverity: '7.5' },
  moderate: { level: 'warning', securitySeverity: '5.0' },
  minor: { level: 'note', securitySeverity: '2.0' },
};

/** `critical` is the fallback rather than `minor` because an unrecognised severity means a build
 *  mismatch, and a mismatch that silently ranks a finding as noise is the failure this arc keeps
 *  refusing: did-not-know must not render as clean. Unreachable while `Severity` stays four-valued. */
export function sarifSeverityOf(severity: Severity): SarifSeverity {
  return SARIF_SEVERITY[severity] ?? SARIF_SEVERITY.critical;
}
