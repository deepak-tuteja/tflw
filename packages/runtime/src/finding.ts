// Generic scan-finding model (M3e, PLAN_BROWSER_PERF_SECURITY.md §1.10 D14) — deliberately the one
// piece of the a11y feature that isn't axe-core-specific. `expect page has no [<severity>] a11y
// violations` (SPEC §9.8) is the first *scan* this codebase runs (produce a list of findings each
// carrying a severity, then assert a filtered count is zero); the PLAN requires the future pentest
// scan arc (v1.2.0, security-arc Tier 1+) to reuse this "scan-and-assert machinery" rather than
// building its own severity vocabulary and filter/count logic a second time. Everything here is
// pure and has no axe-core/Playwright import — `a11y.ts` is the only file that knows how to
// *produce* a `Finding[]`; this file only knows how to filter and describe one.

import type { A11ySeverity } from '@tflw/lang';

export type Severity = A11ySeverity;

/** Increasing severity — mirrors axe-core's own `impact` scale exactly (SPEC §9.8) so a future
 * non-a11y scan source only needs to map its own vocabulary onto these four buckets, not invent a
 * fifth ordering. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { minor: 0, moderate: 1, serious: 2, critical: 3 };

/** One scan result, independent of what produced it (an a11y rule violation today; a security
 * finding once the pentest scan arc lands). `detail` is a short, human-readable pointer to *where*
 * (a target selector, a request path, …) — never the full raw scanner output, which stays out of
 * scope for the failure message the same way a large response body is truncated elsewhere. */
export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly description: string;
  readonly detail: string;
}

/** `floor` is a minimum severity, not an exact match — `serious` also keeps `critical` findings, so
 * a test asserting "no serious violations" can't be quietly satisfied by something worse (SPEC
 * §9.8's house-style note). `undefined`/`null` keeps every severity. */
export function filterBySeverity(findings: readonly Finding[], floor: Severity | null | undefined): Finding[] {
  if (!floor) return [...findings];
  const min = SEVERITY_RANK[floor];
  return findings.filter((f) => SEVERITY_RANK[f.severity] >= min);
}
