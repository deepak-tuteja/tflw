// Generic scan-finding model (M3e, PLAN_BROWSER_PERF_SECURITY.md §1.10 D14) — deliberately the one
// piece of the a11y feature that isn't axe-core-specific. `expect page has no [<severity>] a11y
// violations` (SPEC §9.8) is the first *scan* this codebase runs (produce a list of findings each
// carrying a severity, then assert a filtered count is zero); the PLAN requires the future pentest
// scan arc (v1.2.0, security-arc Tier 1+) to reuse this "scan-and-assert machinery" rather than
// building its own severity vocabulary and filter/count logic a second time. Everything here is
// pure and has no axe-core/Playwright import — `a11y.ts` is the only file that knows how to
// *produce* a `Finding[]`; this file only knows how to filter and describe one.

import type { FindingSeverity } from '@tflw/lang';

export type Severity = FindingSeverity;

/** Increasing severity — mirrors axe-core's own `impact` scale exactly (SPEC §9.8) so a future
 * non-a11y scan source only needs to map its own vocabulary onto these four buckets, not invent a
 * fifth ordering. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { minor: 0, moderate: 1, serious: 2, critical: 3 };

/**
 * M134b (D376) — the half of R8's fingerprint that only the *rule* can know.
 *
 * **Deliberately does not carry the endpoint.** The endpoint is a fact about the request, and the
 * interpreter holds the request; a rule that had to supply it would need a method it does not
 * receive — `securityRules.ts`'s `Observation` has a URL and no verb, and threading one in would
 * ripple through every Tier 1 fixture to buy a field the caller already has. So the rule says *where
 * within the request*, the boundary says *which endpoint*, and `scanFindings.ts` joins them.
 *
 * Lives here rather than in `scanFindings.ts` so `Finding` can carry it without this module
 * importing the one that consumes it.
 */
export interface FindingSite {
  /** `body.status`, `query.sort`, `path segment 2`; the cookie's name for a per-cookie rule; the
   *  principal's name for a scan that moves an identity rather than a payload. This is what keeps
   *  two weaknesses on one endpoint from collapsing into a single baseline entry. */
  readonly location?: string;
  /** What was violated, when one rule can be violated in more than one way — the detector that
   *  matched (`a stack frame`, `an SQL error`). Absent when the rule id already says it. */
  readonly invariant?: string;
}

/** One scan result, independent of what produced it (an a11y rule violation today; a security
 * finding once the pentest scan arc lands). `detail` is a short, human-readable pointer to *where*
 * (a target selector, a request path, …) — never the full raw scanner output, which stays out of
 * scope for the failure message the same way a large response body is truncated elsewhere. */
export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly description: string;
  readonly detail: string;
  /**
   * M134b (D376) — R8's fingerprint inputs, attached by the rule that raised this finding.
   *
   * On the `Finding` rather than computed at the report boundary because only the rule knows *which
   * input* it was looking at when it fired: `detail` says so in prose, but a fingerprint parsed back
   * out of a sentence breaks the first time the sentence is reworded, which is the shape `M125e`
   * filed against a display label derived from an identity key.
   *
   * Optional in both directions: a rule with nothing to add omits it (Tier 1's whole-response
   * hygiene rules genuinely have one weakness per endpoint), and the a11y scan — the model's first
   * producer, which has no request at all — never sets it and is never fingerprinted.
   */
  readonly where?: FindingSite;
  /**
   * M134b (D369/D388) — the id of the mutation payload that produced this finding, when one did.
   *
   * **Deliberately not part of `FindingSite`, and therefore not part of the fingerprint.** The site
   * is the weakness; the payload is one of many ways to reach it, and keying on it would file the
   * same weakness once per payload that happened to trip it — R8's exclusion of "the concrete fuzz
   * payload" applied to the corpus half too, not only the seeded one.
   *
   * It is here because the *boundary* needs it for one decision: whether this run generated that
   * payload, which is what makes a finding seeded and so non-gating. The rule pack sets it and knows
   * nothing about seeding — a seeded payload is judged by exactly the same rules as a reviewed one,
   * and only its standing afterwards differs.
   */
  readonly payload?: string;
}

/** `floor` is a minimum severity, not an exact match — `serious` also keeps `critical` findings, so
 * a test asserting "no serious violations" can't be quietly satisfied by something worse (SPEC
 * §9.8's house-style note). `undefined`/`null` keeps every severity. */
export function filterBySeverity(findings: readonly Finding[], floor: Severity | null | undefined): Finding[] {
  if (!floor) return [...findings];
  const min = SEVERITY_RANK[floor];
  return findings.filter((f) => SEVERITY_RANK[f.severity] >= min);
}
