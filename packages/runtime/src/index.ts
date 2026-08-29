// @tflw/runtime — public API. Interprets a parsed Program over the fetch binding, emitting the
// event stream the reporter consumes. M3a adds the Playwright-backed browser step driver.

export * from './types.js';
export { MIN_REDACTABLE_LENGTH, Redactor, redactEvent, redactReport } from './redact.js';
export { RuntimeError } from './eval.js';
export { ConfigError, selectEnv, resolveConfig, missingRequiredEnv, type EnvSelection } from './resolve.js';
export { runProgram, makeUniqueSeq, countTestCases, findSessionUsages, SessionCache, type RunOptions, type RunOutput } from './interpreter.js';
// M130b (D331/D332) — the run-level collector and the facts it collects. Exported for the CLI, which
// owns the sink for a whole invocation, and for `@tflw/reporter`'s repro emitter.
//
// M137d (D474) widened the payload into a discriminated union and renamed the sink to match: it was
// `AuthzSink` while authorization was the only scan emitting repros. `ReproSubject` is the union the
// emitter switches on, and it is the *only* one of these the reporter should destructure blindly —
// reaching for an arm directly is how a third scan's arm gets forgotten at one of two call sites.
export type { ReproSink, ReproSubject, AuthzFinding, InputHandlingFinding } from './interpreter.js';
// M134b (D385/D386/D387) — the report-facing finding, its stable identity, and the gate.
export {
  BASELINE_VERSION,
  OPEN_GATE,
  SCAN_KIND_LABEL,
  WITHHELD_LABEL,
  fingerprintOf,
  judge,
  parseBaseline,
  renderBaseline,
  staleBaselineEntries,
  toScanFinding,
  withheldNote,
} from './scanFindings.js';
export type { Baseline, BaselineEntry, GateVerdict, ScanCensus, ScanDecline, ScanFinding, ScanGate, ScanKind, ScanSink, WithheldReason } from './scanFindings.js';
// M135a (D409) — the three packs' rule ids, exported as closed tuples and as the union they form.
// `@tflw/reporter` keys the remediation KB on `ScanRuleId`, which is what makes a rule shipping
// without an entry a `tsc` failure rather than an alert that quietly carries no fix.
export { SECURITY_RULE_IDS, type SecurityRuleId } from './securityRules.js';
export { AUTHZ_RULE_IDS, type AuthzRuleId } from './authzRules.js';
export { INPUT_RULE_IDS, type InputRuleId } from './inputCorpus.js';
export { SCAN_RULE_IDS, SCAN_RULE_SEVERITY, type ScanRuleId } from './scanRuleIds.js';
// M135b (D413) — the reporter joins an authorization finding to its repro file on
// `(rule, endpoint, principal)`, and `endpoint` is this function's output on both sides. Exported so
// the join is the *same computation* rather than two spellings of it.
export { templateEndpoint } from './inputCorpus.js';
// M137d (D472) — the other half of that join, for an *input-handling* finding. The reporter turns a
// finding's detector label back into an assertable pattern; `inputRules.ts` owns both the label and
// the rule it names, so this keeps the emitted assertion and the detector that fired one definition.
export { DETECTOR_PATTERNS } from './inputRules.js';
// The finding severity vocabulary itself — four levels, `@tflw/lang`'s `FindingSeverity` under the
// runtime's name for it. Exported here so `@tflw/reporter` can key a table on it (D406) without
// taking a dependency on the language package to name four strings.
export type { Severity } from './finding.js';
// M134b (D369/D388) — the seeded layer. `MAX_SEEDED_PER_CLASS` is exported because the CLI validates
// `--probe-seeded` against it before a run starts: a usage error belongs on the command line, not on
// an assertion three minutes in (P#46).
export { MAX_SEEDED_PER_CLASS, SEEDED_ID_PREFIX, seededIds, seededPayloads } from './inputSeeded.js';
export { TlsProber, type TlsProbePolicy } from './tlsProbe.js';
export { runLoadShard, mergeLoadShardReports, spliceLoadReportIntoRunReport, type LoadOptions } from './interpreter.js';
// M89b (D-M89-5) — the CLI's pre-run `scenario "…" — <description>` line formats *this* value
// through the reporter's one `describeWorkload`, instead of switching over the AST itself.
export { workloadOf } from './interpreter.js';
export { resolveImportedActions, resolveMissingFiles, checkConfigFiles, type ImportResolution, type ReadText, type PathExists } from './imports.js';
export { mergeSelfDiagnosis } from './selfDiagnosis.js';
export { finalizeVerdict, noVerdictReason, type NoVerdictReason } from './run-verdict.js';
export { shutdownMtlsWorker } from './mtlsWorker.js';
// `M160`/`D809` — rounding at the render boundary, for every consumer that prints a duration.
export { roundDurationMs, formatDurationMs } from './duration.js';
export { resolveRunSeed, resolveRunClock } from './seed.js';
export { BrowserManager, SUPPORTED_BROWSER_ENGINES, type BrowserEngine, type BrowserManagerOptions } from './browser.js';
export { startPickSession, wirePickSession, type PickedLocator, type PickLocatorKind, type PickSessionHandle } from './browser.js';
export type { SnapshotDiffAsset } from './snapshot.js';
