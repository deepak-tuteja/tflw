// M134b (PLAN_M134_PENTEST_TIER3.md D376/D385/D386/D387) — the report-facing scan finding, its
// stable identity, and the gate that decides which findings are allowed to fail a build.
//
// **Why this file exists at all.** All three scans already produce `finding.ts`'s generic
// `Finding[]` — the reuse SPEC §9.8 predicted when the a11y scan invented the model — and all three
// then throw it away into the assertion's own prose. `authzRules.ts`'s findings are the single
// exception, and only because D332's repro emitter needed facts rather than a rendered sentence.
// Everything a report, a baseline or a SARIF exporter wants is therefore computed every run and
// discarded at the report boundary. This module is that boundary.
//
// **D385 — every scan feeds it, not only Tier 3.** D376 said findings ride `RunReport`; it did not
// say whose. Tier-3-only was rejected because it makes `--fail-on` mean a different thing depending
// on which matcher a file happened to use, which is exactly the accidental contract D383 gave this
// milestone its own number to avoid. One flag, one meaning, three producers.
//
// **What this file deliberately does NOT do: decide `RunReport.ok`.** `run-verdict.ts` is emphatic
// that `finalizeVerdict` is the one derivation of that field in the tool, and a scan finding already
// fails its build through the assertion that produced it. So the gate here can only ever turn a red
// assertion green (D386) — there is no second axis, no second source of truth, and the exit-code
// ladder is untouched.

import { createHash } from 'node:crypto';

import { SEVERITY_RANK, type Finding, type FindingSite, type Severity } from './finding.js';

export type { FindingSite } from './finding.js';

/** R8's full fingerprint input: the endpoint the boundary knows, joined with the site the rule
 *  attached. See `FindingSite` for why the two halves are supplied by different callers. */
export interface FindingLocus extends FindingSite {
  /** `templateEndpoint`'s normalized `METHOD /templated/path` — never the concrete URL. */
  readonly endpoint: string;
}

/** Which scan produced a finding. The three matchers, in the order they shipped. */
export type ScanKind = 'security' | 'authorization' | 'input-handling';

export const SCAN_KIND_LABEL: Readonly<Record<ScanKind, string>> = {
  security: 'security',
  authorization: 'authorization',
  'input-handling': 'input handling',
};

/**
 * One finding as it reaches `RunReport` and `report.html`.
 *
 * Note what is **not** here: a timestamp, a generated id, the concrete request URL's ids. Those are
 * exactly R8's exclusions, and they are excluded from the *structure* rather than from the hash
 * alone, so a future consumer cannot reintroduce run-to-run churn by fingerprinting a field that
 * happened to be lying around.
 */
export interface ScanFinding {
  readonly scan: ScanKind;
  readonly rule: string;
  readonly severity: Severity;
  readonly description: string;
  readonly detail: string;
  readonly endpoint: string;
  readonly location?: string;
  readonly invariant?: string;
  /**
   * R8's stable identity — the same weakness across runs, distinct weaknesses on one endpoint.
   *
   * **Absent exactly for seeded findings (D369)**, and that absence is the whole mechanism: a
   * seeded finding is un-baselinable and non-gating because it structurally *cannot* be keyed, not
   * because a rule somewhere remembers to skip it. A rule can be forgotten; a missing field cannot.
   */
  readonly fingerprint?: string;
  /** Present exactly when D369's seeded layer drew this payload. Carries what it takes to promote
   *  the payload into the fixed corpus, which is the section's entire call to action. */
  readonly seeded?: { readonly seed: number; readonly payload: string };
  /**
   * Why this finding did not fail the build, absent when it did.
   *
   * Rendered, never dropped. A finding withheld from a verdict is still a finding, and a green run
   * that judged less must not render identically to one that did not — `M134a` paid for that lesson
   * once already, when `input-assert.test.ts` found withheld payload classes invisible on a
   * *passing* line.
   */
  readonly withheld?: WithheldReason;
  /** The test file and line whose assertion raised it, so a report can point at the source. */
  readonly file?: string;
  readonly line?: number;
}

export type WithheldReason = 'baseline' | 'fail-on' | 'seeded';

export const WITHHELD_LABEL: Readonly<Record<WithheldReason, string>> = {
  baseline: 'known/accepted',
  'fail-on': 'below --fail-on',
  seeded: 'seeded — never gates',
};

/**
 * The run-level collector, threaded on `TestCtx` exactly as `tlsProber` and `authzSink` are.
 *
 * **Separate from `AuthzSink` on purpose, and the purpose is not tidiness.** That sink feeds D332's
 * repro emitter, which re-issues a request *as another identity* and therefore needs a principal,
 * the owner ids and the concrete URL. Two of the three scans have no principal at all. Folding the
 * two would put emitter-shaped fields on findings that can never fill them, so each sink keeps one
 * job: one writes runnable repros, one writes the report.
 */
export interface ScanSink {
  finding(f: ScanFinding): void;
  /**
   * D389 — what this assertion's pack did, reported once per assertion and merged across the run.
   *
   * Separate from `finding` because it is the half `M128-01` is actually filed about: a rule that
   * *stood down* produces no finding by definition, so a sink that only heard about findings could
   * never answer "which rules did not apply, and why". Reported on every assertion including the
   * ones that pass, which is the whole point — the row exists because the passing case is where the
   * information disappears.
   */
  census(c: ScanCensus): void;
  /**
   * `M136a` (D418a) — a subject this assertion could not put its question to.
   *
   * **The third channel, and it is not the second one wearing a different hat.** `census` is
   * *rule*-keyed and answers "which rules stood down": a rule declined, having looked at the
   * observation it was given. This is *subject*-keyed and answers "who was never asked": the rule
   * would have judged happily, and no answer ever arrived for it to judge. Tier 2's cookie-borne
   * principal refused at the CSRF layer (D325) and Tier 3's write refused for want of `probe
   * mutating` are the same fact about two different kinds of subject.
   *
   * It lives here rather than on `AuthzSink` — where the authorization half of it started — because
   * `AuthzSink` writes runnable repros and two of the three scans have no principal to write one
   * for. This sink writes the report, and the report is what the blind spot belongs in.
   */
  decline(d: ScanDecline): void;
}

/** One assertion's worth of D389's census, before the run merges them. */
export interface ScanCensus {
  readonly scan: ScanKind;
  readonly applied: readonly string[];
  readonly notApplicable: readonly { readonly rule: string; readonly because: string }[];
}

/**
 * `M136a` (D418a) — one subject a scan could not put its question to, before the run aggregates it.
 *
 * `subject` is deliberately a plain string rather than a union, because the three tiers do not have
 * a common notion of subject and inventing one would be a type widened by every tier that joined: a
 * **principal** for Tier 2 (`shopper`), whose refusals are per-identity, and an **endpoint** for
 * Tier 3 (`POST /notes`), whose are per-request. The reader always has `scan` beside it, and SARIF
 * namespaces it there (D421) rather than every producer carrying a prefix it might spell
 * differently.
 *
 * Tier 1 has no inhabitant and is not expected to grow one: it judges one observed response and
 * sends nothing, so there is no question it could fail to ask.
 */
export interface ScanDecline {
  readonly scan: ScanKind;
  readonly subject: string;
  readonly reason: string;
}

/**
 * R8's hash. Deliberately **not** over the whole finding: `detail` carries the concrete payload and
 * a response excerpt, so hashing it would move the fingerprint every time an error message was
 * reworded and invalidate a baseline for a change that fixed nothing.
 *
 * Truncated to 16 hex characters — 64 bits. A baseline holds tens to hundreds of entries; the
 * collision probability there is nil, and a person has to read these in a JSON file and match them
 * against a report by eye.
 *
 * The joiner is a NUL because every other candidate can occur inside a field — an endpoint holds
 * spaces and slashes, a location holds dots and brackets, an invariant is a sentence — and a
 * separator that can appear in the data lets two different loci hash to one fingerprint, which
 * silently extends one baseline entry over a second weakness. It is written as the escape and never
 * as the byte: a raw NUL makes this file binary to `grep`, which then reports no matches rather
 * than an error (`scripts/no-nul-bytes.test.mjs`, which caught exactly that here).
 */
export function fingerprintOf(scan: ScanKind, rule: string, locus: FindingLocus): string {
  const material = [scan, rule, locus.endpoint, locus.location ?? '', locus.invariant ?? ''].join('\u0000');
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Lift a generic `Finding` into its report-facing form, joining the endpoint the caller knows with
 * the site the rule attached, and computing R8's identity from the pair.
 *
 * `endpoint: null` is the a11y scan's case — no request, so no fingerprint, so not baselinable. That
 * is the honest outcome rather than hashing an empty string and collapsing every a11y violation in a
 * suite into one baseline entry.
 */
export function toScanFinding(
  scan: ScanKind,
  f: Finding,
  endpoint: string | null,
  extra?: { readonly seeded?: ScanFinding['seeded']; readonly file?: string; readonly line?: number },
): ScanFinding {
  const seeded = extra?.seeded;
  const locus: FindingLocus | null = endpoint === null ? null : { endpoint, ...(f.where ?? {}) };
  return {
    scan,
    rule: f.id,
    severity: f.severity,
    description: f.description,
    detail: f.detail,
    endpoint: locus?.endpoint ?? '',
    ...(locus?.location !== undefined ? { location: locus.location } : {}),
    ...(locus?.invariant !== undefined ? { invariant: locus.invariant } : {}),
    // The one place the seed's consequence is applied, rather than three call sites remembering it.
    ...(seeded || !locus ? {} : { fingerprint: fingerprintOf(scan, f.id, locus) }),
    ...(seeded ? { seeded } : {}),
    ...(extra?.file !== undefined ? { file: extra.file } : {}),
    ...(extra?.line !== undefined ? { line: extra.line } : {}),
  };
}

// ---------------------------------------------------------------------------
// D387 — the baseline document
// ---------------------------------------------------------------------------

export interface BaselineEntry {
  readonly fingerprint: string;
  /** Carried so a human reading the file knows what they accepted. Never part of the match — a rule
   *  renamed upstream must not silently un-accept every entry that mentioned it. */
  readonly rule: string;
  readonly endpoint: string;
  readonly note?: string;
}

export interface Baseline {
  readonly version: 1;
  readonly accepted: readonly BaselineEntry[];
}

export const BASELINE_VERSION = 1;

/**
 * Parse a baseline file, refusing anything ambiguous.
 *
 * Throws rather than degrading, because every failure mode here is *silently accepting nothing* —
 * and a baseline that quietly matched no findings looks exactly like a codebase that fixed them.
 * The one thing this feature must never do is make a build greener than the evidence.
 */
export function parseBaseline(text: string, source: string): Baseline {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${source} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must be a JSON object with "version" and "accepted"`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== BASELINE_VERSION) {
    throw new Error(`${source} has version ${JSON.stringify(obj['version'])} — this tflw understands version ${BASELINE_VERSION}`);
  }
  const accepted = obj['accepted'];
  if (!Array.isArray(accepted)) throw new Error(`${source} must have an "accepted" array`);
  const entries: BaselineEntry[] = [];
  accepted.forEach((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new Error(`${source}: accepted[${i}] must be an object`);
    const entry = e as Record<string, unknown>;
    const fingerprint = entry['fingerprint'];
    if (typeof fingerprint !== 'string' || !fingerprint) throw new Error(`${source}: accepted[${i}] has no "fingerprint"`);
    entries.push({
      fingerprint,
      rule: typeof entry['rule'] === 'string' ? entry['rule'] : '',
      endpoint: typeof entry['endpoint'] === 'string' ? entry['endpoint'] : '',
      ...(typeof entry['note'] === 'string' ? { note: entry['note'] } : {}),
    });
  });
  return { version: BASELINE_VERSION, accepted: entries };
}

/**
 * The document `--baseline-write` emits.
 *
 * Sorted by fingerprint so the file is stable across runs and a re-write produces an empty diff when
 * nothing changed — a suppression file that churns is a suppression file nobody reviews. Seeded
 * findings are absent because they have no fingerprint, which is D369 enforced by the type rather
 * than by a filter.
 */
export function renderBaseline(findings: readonly ScanFinding[]): string {
  const byFingerprint = new Map<string, BaselineEntry>();
  for (const f of findings) {
    if (!f.fingerprint || byFingerprint.has(f.fingerprint)) continue;
    byFingerprint.set(f.fingerprint, { fingerprint: f.fingerprint, rule: f.rule, endpoint: f.endpoint });
  }
  const accepted = [...byFingerprint.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return `${JSON.stringify({ version: BASELINE_VERSION, accepted }, null, 2)}\n`;
}

/**
 * Baseline entries this run produced no finding for.
 *
 * **Reported, never auto-removed.** A run narrowed by `--tags` or `--failed` naturally produces a
 * subset of the suite's findings, so pruning on absence would delete acceptances the next full run
 * still needs. Naming them is what makes a suppression file shrink; deleting them is what makes it
 * wrong.
 */
export function staleBaselineEntries(baseline: Baseline, produced: ReadonlySet<string>): BaselineEntry[] {
  return baseline.accepted.filter((e) => !produced.has(e.fingerprint));
}

// ---------------------------------------------------------------------------
// D386 — the gate
// ---------------------------------------------------------------------------

export interface ScanGate {
  /** Findings below this severity are withheld from the verdict — they still run, still render, and
   *  still reach the report. `null` is the default: whatever the file claims, stands. */
  readonly failOn: Severity | null;
  readonly accepted: ReadonlyMap<string, BaselineEntry>;
}

export interface GateVerdict {
  /** The findings still permitted to fail the assertion. */
  readonly gating: readonly ScanFinding[];
  /** Every finding, each stamped with `withheld` when it was not allowed to gate. */
  readonly all: readonly ScanFinding[];
  readonly withheldByFloor: number;
  readonly withheldByBaseline: number;
  readonly withheldAsSeeded: number;
}

export const OPEN_GATE: ScanGate = { failOn: null, accepted: new Map() };

/**
 * Decide which findings may fail the assertion that produced them.
 *
 * **`--fail-on` withholds findings; it does not narrow the rule pack.** The distinction is not
 * pedantry. D296 has the *matcher's* floor narrow the pack before applicability is evaluated, which
 * moves the counts line's denominator with it — correct there, because the author is saying which
 * rules they are asserting about. An operator relaxing a gate is saying something different: run
 * everything, report everything, fail on less. Narrowing the pack for `--fail-on` would make a
 * relaxed run *report* less rather than merely fail less, and a scanner that shows you fewer
 * problems when you turn its gate down is worse than no gate at all.
 *
 * Order matters for the counts: baseline is checked first, so a finding that is both accepted and
 * below the floor is reported as accepted — the more specific statement, and the one whose entry a
 * reader can go delete.
 */
export function judge(findings: readonly ScanFinding[], gate: ScanGate): GateVerdict {
  const all: ScanFinding[] = [];
  const gating: ScanFinding[] = [];
  let withheldByFloor = 0;
  let withheldByBaseline = 0;
  let withheldAsSeeded = 0;
  for (const f of findings) {
    const reason = withheldReasonFor(f, gate);
    if (reason === 'baseline') withheldByBaseline += 1;
    else if (reason === 'fail-on') withheldByFloor += 1;
    else if (reason === 'seeded') withheldAsSeeded += 1;
    const stamped = reason ? { ...f, withheld: reason } : f;
    all.push(stamped);
    if (!reason) gating.push(stamped);
  }
  return { gating, all, withheldByFloor, withheldByBaseline, withheldAsSeeded };
}

function withheldReasonFor(f: ScanFinding, gate: ScanGate): WithheldReason | null {
  if (f.seeded) return 'seeded';
  if (f.fingerprint && gate.accepted.has(f.fingerprint)) return 'baseline';
  if (gate.failOn && SEVERITY_RANK[f.severity] < SEVERITY_RANK[gate.failOn]) return 'fail-on';
  return null;
}

/**
 * The clause an assertion appends when it withheld findings from its own verdict — D386's
 * *relaxation is never silent*.
 *
 * Returns `''` when nothing was withheld, so the overwhelmingly common line is unchanged and no
 * existing message fixture moves.
 */
export function withheldNote(v: GateVerdict): string {
  const parts: string[] = [];
  if (v.withheldByBaseline) parts.push(`${v.withheldByBaseline} known/accepted`);
  if (v.withheldByFloor) parts.push(`${v.withheldByFloor} below \`--fail-on\``);
  if (v.withheldAsSeeded) parts.push(`${v.withheldAsSeeded} seeded`);
  if (!parts.length) return '';
  return `\n  note: ${parts.join(', ')} — reported, not counted against this assertion.`;
}
