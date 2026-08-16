// Shared runtime types: the resolved config the interpreter runs against, the event stream it
// emits (SPEC §13 — the reporter is a pure consumer of these), and the aggregated run report.

import type { EvidenceLevel, LogDestination, LogLevel, RedactPattern, SessionDecl, Value } from '@tflw/lang';
// Re-exported so downstream packages that only depend on `@tflw/runtime` (e.g. `packages/reporter`,
// which has no direct `@tflw/lang` dependency) can still type a `logLevelThreshold`/`logDestination`
// parameter without adding one (M27, PLAN_LOG.md).
export type { LogDestination, LogLevel } from '@tflw/lang';
import type { BrowserEngine } from './browser.js';
import type { SnapshotDiffAsset } from './snapshot.js';
import type { ScanFinding, ScanKind } from './scanFindings.js';
import type { HistogramBucket } from './histogram.js';
import type { SerializedTimelineBucket, TimelinePoint } from './timeline.js';
export type { TimelinePoint, SerializedTimelineBucket } from './timeline.js';
export type { HistogramBucket } from './histogram.js';

// ---- Resolved config -------------------------------------------------------

export interface ResolvedHeader {
  readonly name: string;
  /** Kept unevaluated so `env(…)` taint is recorded at request-build time, not config load. */
  readonly value: Value;
  /** null = applies to every service. */
  readonly service: string | null;
}

/** One `authorized target "<url>" reason "<text>"` declaration (M128b, D291). Both halves are kept:
 * the reason is not commentary on the config, it is what gets printed in the run summary and
 * embedded in the report so every artifact records the claim that let the scan run. */
export interface AuthorizedTarget {
  readonly target: string;
  readonly reason: string;
  /** The indented `probe mutating` sub-clause (M130b, D311/D330) — may an authorization probe
   * re-issue a mutating request under another principal against this host?
   *
   * **Accumulates by OR, not by last-writer.** Two declarations of the same target where either
   * says `probe mutating` mean the opt-in holds: the clause is a claim about permission, and
   * permission does not un-grant by repetition. */
  readonly probeMutating: boolean;
  /** `probe oversized` (M134a, D372) — may an input-handling scan send a 64 KiB value at this
   * host's inputs? Opt-in because D21 layer 4 names **resource exhaustion** by that name.
   *
   * Accumulates by OR, exactly as `probeMutating` does and for the same reason. */
  readonly probeOversized: boolean;
  /** `probe traversal` (M134a, D372) — may an input-handling scan send `../`-shaped payloads at
   * this host's inputs? Detection-oriented (it attempts a read, never a write), but still an
   * attempt at unauthorized access, which is the other class D21 layer 4 names. */
  readonly probeTraversal: boolean;
}

export interface ResolvedTimeouts {
  readonly step: number;
  /** `timeout expect` — the retry budget for a UI `expect`/`check` (M3a, `execUiExpect` in
   * `interpreter.ts`, SPEC §3.1/§9.4). Still inert for a plain API `expect`, which evaluates once
   * and fails fast by design (P#15) rather than retrying. */
  readonly expect: number;
  /** `timeout wait` — the retry budget for `wait until api` (P#15) and, since M3b, `wait until
   * <ui condition>` (`execWaitUntilUi` in `interpreter.ts`, SPEC §9.5) — the UI sibling for a
   * condition that can legitimately outlast the ordinary `timeout expect` budget. */
  readonly wait: number;
}

export interface ResolvedConfig {
  readonly envName: string;
  /** Default (bare `api`) base URL, or null if the env declares none. */
  readonly apiBaseUrl: string | null;
  /** Named services → base URL (P#29). */
  readonly services: Readonly<Record<string, string>>;
  readonly webBaseUrl: string | null;
  readonly headers: readonly ResolvedHeader[];
  readonly timeouts: ResolvedTimeouts;
  readonly reportDir: string;
  readonly workers: number;
  /** `insecure true` — disables TLS certificate verification for the whole run (decision 78). A
   * corporate-QA escape hatch for self-signed/private-CA staging APIs; explicit and greppable. */
  readonly insecure: boolean;
  readonly requiredEnv: readonly string[];
  /** `exclude "<path>"[, "<path>"...]` — paths, relative to this config's own directory, that bare
   * (no-file-args) discovery must never descend into (SPEC §3, D127, PLAN_DISCOVERY_EXCLUDE.md).
   * `[]` = never declared, no exclusion. Doesn't affect explicit file args. */
  readonly exclude: readonly string[];
  /** `session <name> ... ` blocks declared in `tflw.config`, by name (SPEC §3.3, P#42). */
  readonly sessions: ReadonlyMap<string, SessionDecl>;
  /** `cert`/`key` — per-env mTLS client certificate paths, resolved relative to the config file's
   * directory at request time (SPEC §3.5, decision 3b, enterprise arc). `null` when neither is
   * set; `resolveConfig` rejects one without the other. */
  readonly mtls: { readonly certPath: string; readonly keyPath: string } | null;
  /** `allow hosts "…"` — a request whose URL hostname matches none of these is refused before any
   * network I/O (SPEC §3.7, PLAN decision 101a, enterprise arc cluster 2). `null` = never
   * declared, no enforcement (backward compatible). Accumulates across `defaults` + `env`, unlike
   * the override-semantics fields above. */
  readonly allowHosts: readonly string[] | null;
  /** `authorized target "…" reason "…"` — D21's declaration layer (M128b, D291, SPEC §3.10).
   * Accumulates across `defaults` + `env` exactly as `allowHosts` does.
   *
   * `[]` rather than `null` for the absent case, unlike `allowHosts`, and the difference is real:
   * an empty `allowHosts` would mean "enforce nothing", so the two states have to be told apart. An
   * empty list here means "no security assertion in this suite is permitted to run", which is the
   * same thing the absent case means. There is nothing to distinguish. */
  readonly authorizedTargets: readonly AuthorizedTarget[];
  /** `--allow-public-target <origin>`, repeatable — D21 §3.2(3)'s affirmation (M131a, D340).
   *
   * **The one field on this object that no `tflw.config` key can ever set, and that is the whole
   * feature.** `resolveConfig` always produces `[]` here; only the CLI overlays real values, from
   * the command line. Anything that lets a committed file populate this has deleted the control it
   * implements — the layer exists precisely so that a config, which is a thing you can merge into
   * `main`, cannot by itself point a scanner at the internet.
   *
   * Empty means "nothing was affirmed", which is the same thing absent would mean, so unlike
   * `allowHosts` there is no `null` case to distinguish. */
  readonly allowPublicTargets: readonly string[];
  /** `evidence full|headers-only|none` — how much of the request/response trace lands in the
   * report-only trace (SPEC §13, PLAN decision 101c). Override semantics (env wins), default
   * `'full'` (today's unchanged behavior). `--evidence` overrides this again for one run. */
  readonly evidenceLevel: EvidenceLevel;
  /** `redact body.email, body.*.address` — JSON field paths masked with `[redacted]` in the
   * report-only trace (SPEC §3.4, PLAN decision 101d). Accumulates across `defaults` + `env`. */
  readonly redactPatterns: readonly RedactPattern[];
  /** `viewport <width> <height>` — browser window size in px (M3c, SPEC §9, D11). `null` = let
   * Playwright use its own default (1280×720). `defaults`-only, like `workers`/`report`. */
  readonly viewport: { readonly width: number; readonly height: number } | null;
  /** `log destination "…"` — the default a bare `log "…"` (no `to` clause) resolves to (M27,
   * PLAN_LOG.md decision 116). Override semantics like `evidence` (env wins over `defaults`),
   * default `'both'`. `'none'` is reachable only via `--log-output none` overriding this for a
   * whole run (decision 121) — never a value `LogDestinationDecl` itself can carry, since `'none'`
   * isn't a valid `log … to <destination>` grammar target either (a global kill-switch for bare
   * calls only, not a per-statement one). */
  readonly logDestination: LogDestination | 'none';
  /** `log level "…"` — the minimum level a `log` step must clear to be *rendered* (console text,
   * `report.html`); never affects whether it's *recorded* (M27, PLAN_LOG.md decision 122).
   * Default `'debug'` (show everything). */
  readonly logLevel: LogLevel;
}

/** Ordinal ranking for `ResolvedConfig.logLevel` / `--log-level` threshold comparisons (M27,
 * PLAN_LOG.md decision 122) — shared by the CLI console formatter and `report.html`'s renderer so
 * both filter identically. */
export const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export const DEFAULT_TIMEOUTS: ResolvedTimeouts = { step: 30_000, expect: 5_000, wait: 30_000 };

// ---- Traces & results ------------------------------------------------------

export type StepKind =
  | 'api'
  | 'expect'
  | 'check'
  | 'let'
  | 'capture'
  | 'log'
  | 'wait'
  | 'call'
  | 'give'
  | 'header'
  | 'open'
  | 'click'
  | 'fill'
  | 'select'
  | 'checkbox'
  | 'uncheckbox'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'within'
  | 'dialog'
  | 'switchTab'
  | 'closeTab'
  | 'download'
  | 'drag'
  | 'dropFile'
  | 'screenshot'
  | 'stub'
  | 'pause';

export interface RequestTrace {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** One response in this request's redirect chain that carried `Set-Cookie` — the final response
 * included, every earlier hop too (M88c1, `B4-15`/D-M88-11).
 *
 * Until M88c1 only the *final* response's headers survived the chain, every earlier hop being
 * drained and discarded, so the commonest login shape there is — `POST /login` → `302` carrying
 * `Set-Cookie` → `GET /dashboard` — lost its session cookie outright, and (headers being fixed once,
 * before the chain starts) the hop to the protected page went out unauthenticated. Nothing in the
 * run said so: the 200 from `/dashboard` looked like a successful login.
 *
 * `origin` is the origin of the response that set it, not of the request the step named — which is
 * the same distinction, and matters for the same reason, as `Set-Cookie` scoping in a browser: a
 * chain can end somewhere other than where it started, and a cookie handed over by host A must not
 * be replayed to host B (D-M88-7/D-M88-8; the jar that consumes this lands in M88c2). */
export interface CookieEvent {
  /** `scheme://host:port` — `URL.origin`, so a default port normalizes away and the key is the same
   * string whichever client produced it. */
  readonly origin: string;
  /** This hop's `Set-Cookie` values, one array entry per header line — never joined. The `\n`-joined
   * form in `headers['set-cookie']` exists because a header map is `Record<string, string>`; here
   * there is no such constraint, and a jar wants the lines anyway. */
  readonly setCookie: readonly string[];
}

export interface ResponseTrace {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  /** Raw, untouched response body bytes (gap #17) — `bodyText` is derived from this buffer, not
   * from a separate `res.text()` read, so both stay consistent with what was actually received. */
  readonly bodyBytes: Buffer;
  /** Parsed JSON if the body parsed as JSON, else undefined. */
  readonly json?: unknown;
  readonly durationMs: number;
  /** Where the chain actually ended — equal to the requested URL whenever nothing redirected.
   *
   * Reported, never addressable (D-M88-13): no `url` subject exists in SPEC §5.3 and none is added,
   * because the question it would answer is already answered better by `without redirects` +
   * `expect header "location"`, which asserts a *specific* hop instead of the terminus of an opaque
   * chain. This is for the report and for diagnostics — and it is *not* how a cookie finds its
   * origin, which is `cookieEvents`' job precisely because the terminus is the wrong answer for a
   * cookie set three hops earlier. */
  readonly finalUrl: string;
  /** Every hop of this chain that carried `Set-Cookie`, in the order they arrived. Empty for the
   * overwhelming majority of responses.
   *
   * Required, not optional, on purpose: four client paths have to produce this and D-M88-1 makes
   * them conform to one another, so a path that forgets should fail to compile rather than quietly
   * return a jar-shaped hole. Transport plumbing, not evidence — the report copy carries `[]` at
   * every evidence level (`interpreter.ts#redactResponse`), since these are raw credentials with a
   * redacted `headers['set-cookie']` already standing in for them. */
  readonly cookieEvents: readonly CookieEvent[];
}

/** A captured page screenshot (M3c, SPEC §13) — raw PNG bytes, base64-encoded. Never redacted (the
 * redaction pass only walks text fields, `redact.ts`'s header comment) — a known, accepted
 * limitation shared with every other visual-testing tool; a page that renders a secret on screen
 * shows it in the screenshot the same as it would to a real user looking at it. */
export interface ScreenshotAsset {
  readonly base64: string;
}

/** A Playwright trace archive (M3c, D12) — a `.zip` (time-travel DOM + network + console), raw
 * bytes base64-encoded. Always written out as a `report/assets/` file by the reporter, never
 * inlined into `report.html` (too large/binary to usefully embed). */
export interface TraceAsset {
  readonly base64: string;
}

export interface StepResult {
  readonly kind: StepKind;
  /** The original source line, for the report timeline (mirrors source, SPEC §13). */
  readonly source: string;
  readonly line: number;
  readonly ok: boolean;
  readonly durationMs: number;
  /** One-line human summary: `status = 200`, `orderId = 42 (captured)`, or a failure reason. */
  readonly detail?: string;
  readonly request?: RequestTrace;
  readonly response?: ResponseTrace;
  /** Set only on a `kind: 'api'` result (M43, D67/D68) — this request's stable endpoint identity:
   * its `ApiStep.tag` (`as "label"`) when present, else the automatic `METHOD path.raw` derived
   * from the *source template*, not `request.url` (which is the resolved, interpolated URL and
   * would fragment identity across otherwise-identical requests, the exact normalization problem
   * this field exists to avoid). Read by the per-scenario endpoint accumulator to build
   * `LoadScenarioReport.endpoints`; unused (but harmless, negligible size) outside a load run. */
  readonly endpoint?: string;
  /** Set on an explicit `screenshot "<name>"` step, or best-effort on any step that failed while a
   * browser page existed for this test attempt (M3c, D12's "failure-first capture"). */
  readonly screenshot?: ScreenshotAsset;
  /** Set on a `matches snapshot "<name>"` step whenever there's something worth showing — a new or
   * updated baseline, a mismatch, or a platform-key error — but omitted on a clean pass against an
   * unchanged baseline (M4b, D15: the same "don't inflate the report on success" restraint D12
   * already applied to screenshot-per-step). */
  readonly snapshotDiff?: SnapshotDiffAsset;
  /** Set only on a `kind: 'log'` step (M27, PLAN_LOG.md decision 117) — the statement's own level
   * and its *effective* destination (per-statement `to …` if given, else the resolved
   * `logDestination` config/CLI default at the time this step ran, decision 116/121). Always
   * present on every `log` step regardless of that destination — a step whose destination excludes
   * a given renderer is still recorded, only not displayed there (decision 119). */
  readonly level?: LogLevel;
  readonly destination?: LogDestination | 'none';
}

/** One `retry` attempt's outcome — captured so a flaky pass's earlier failing evidence survives
 * into the report instead of being discarded (SPEC §4.4, PLAN decision 86). `attempt` is 1-based. */
export interface AttemptResult {
  readonly attempt: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly steps: readonly StepResult[];
  readonly error?: string;
  /** Present when this attempt used a browser and either failed or was itself a retry (M3c, D12:
   * "trace on failure and on every retry attempt") — a clean single-attempt pass never captures
   * one. */
  readonly trace?: TraceAsset;
}

export interface TestResult {
  /** M56 (Phase 3, D116) — discriminates a `ReportEntry` from a `WorkloadTestResult`. Always
   * `'functional'`; every construction site sets it explicitly (or inherits it via `{ ...result }`
   * spread from one that did) so a plain `test.ok` narrows correctly wherever `ReportEntry` is
   * consumed, without a duck-typed guess (e.g. "does it have `.metrics`?"). */
  readonly kind: 'functional';
  readonly name: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly steps: readonly StepResult[];
  /** The `.tflw` file this test came from, relative to the run's cwd — stamped by the CLI once all
   * of a file's tests are back from `runProgram` (report.html groups by this, per-test tabs,
   * TFLW-GAPS.md-adjacent UX ask). Optional so every existing fixture/report built directly
   * against `TestResult` (unit tests across `runtime`/`reporter`) keeps compiling unchanged; a
   * report with no `file` groups every test under one untitled group. */
  readonly file?: string;
  /** The fatal error that ended the test early, if any. */
  readonly error?: string;
  /** `true` when this test failed at least once before passing on a `retry` attempt — reported
   * as passed but flagged, never silently green (SPEC §4.4, P#10). */
  readonly flaky?: boolean;
  /** Every attempt actually run, in order, only present when more than one attempt ran. A
   * single-attempt test has no `attempts` field at all — same shape as before this field existed.
   * When present, `attempts[attempts.length - 1].steps === steps` (SPEC §4.4, PLAN decision 86). */
  readonly attempts?: readonly AttemptResult[];
  /** This test's own kept (last) attempt's trace, mirroring `AttemptResult.trace` the same way
   * `steps` mirrors the last attempt's `steps` (M3c). */
  readonly trace?: TraceAsset;
  /** `parallel`/`sequential` (D105-D107/D115) — this test's own declared relation to its file
   * neighbors, threaded through purely for `report.html`'s badge (M56); never affects scheduling
   * here, that's the interpreter's job. Undefined for a report built without this field (every
   * pre-M56 fixture/unit test), rendered the same as `'sequential'` (no badge). */
  readonly concurrency?: 'parallel' | 'sequential';
}

/** M56 (Phase 3, D116/D117) — one workload-bearing `test`'s finished result, the exact same shape
 * `LoadScenarioReport` (below) already had, now a first-class member of `RunReport.tests` instead
 * of living in a separate `LoadReport.scenarios` array. `name`/`workload`/`metrics`/`thresholds`/
 * `ok`/`backOff`/`endpoints` are unchanged from `LoadScenarioReport` — kept as one shared shape
 * (`WorkloadTestResult extends LoadScenarioReport`) rather than duplicated, since `runLoadShard`'s
 * multi-process merge machinery (`mergeLoadShardReports`) still produces a `LoadReport` internally
 * before its scenarios get spliced into the final `RunReport` (`spliceLoadReportIntoRunReport`,
 * interpreter.ts). No `durationMs`/`steps` — a workload test has no single "this took Nms" figure
 * (its declared span is *planned*, not an outcome, and two of the five shapes declare none) and no step timeline (D24a/D26: a
 * workload iteration's body executes silently, only aggregate metrics are kept). */
export interface WorkloadTestResult extends LoadScenarioReport {
  readonly kind: 'workload';
  readonly file?: string;
  readonly concurrency?: 'parallel' | 'sequential';
}

/** M56 (Phase 3, D116) — one `program.tests` entry's outcome, in file-declaration order alongside
 * every other entry regardless of kind (D101/D112) — `report.html`/`junit.xml` render whichever
 * layout `entry.kind` calls for; `RunReport.total/passed/failed` count both kinds identically
 * (`entry.ok`, vacuously `true` for a workload test declaring zero `threshold`s, same as it always
 * was inside `LoadScenarioReport.ok`). */
export type ReportEntry = TestResult | WorkloadTestResult;

/**
 * M134b (D389) — one scan's rule census for the run: what applied, and what stood down and why.
 *
 * Merged across every assertion of that scan in the run, because the question `M128-01` asks is
 * about the *report*, not about one line of one file. A rule that applied anywhere is `applied`; a
 * rule that never applied is `notApplicable` and carries the reasons it gave, deduplicated — a suite
 * with forty assertions must not print the same sentence forty times to say one thing.
 */
export interface ScanRuleCensus {
  readonly scan: ScanKind;
  readonly applied: readonly string[];
  readonly notApplicable: readonly { readonly rule: string; readonly because: readonly string[] }[];
}

export interface RunReport {
  /** **Did this run pass?** — not "did nothing that ran fail", which is `failed === 0` one line
   * down. A run that never reached a verdict is `ok: false` even with an empty `failed` count:
   * `aborted` (Ctrl-C before the planned duration) and `inconclusive` (tflw's own generator
   * saturated) each say which kind of no-verdict it was. `M114` (review row `M111-01`) — until then
   * an aborted run's `results.json` read `{"ok": true, "failed": 0, "aborted": true}`, and a CI job
   * branching on the field named for exactly this question read a clean pass off a run cut short.
   *
   * Derived in exactly one place, `finalizeVerdict` (`run-verdict.ts`), by every producer. */
  readonly ok: boolean;
  readonly env: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly tests: readonly ReportEntry[];
  /** The `random`/`unique` run seed — reproduce this exact run with `tflw run --seed <n>` (P#23). */
  readonly seed: number;
  /** The run clock (ISO 8601) that `today`/`now`/date generators derived from — reproduce the
   * exact same absolute dates alongside `--seed` with `tflw run --seed <n> --now <iso>`
   * (decision 52). */
  readonly now: string;
  /** True when this run had `insecure true` active (TLS verification disabled) — surfaced as a
   * visible warning in the CLI summary and report header, never silently (decision 78). */
  readonly insecure: boolean;
  /** True when this run's `api` was tflw's bundled demo service (`tflw://demo`, M118/`FU-04`/D202),
   * not a service of the user's. Surfaced in the CLI summary and the report header for `insecure`'s
   * reason: a green `PASS 1/1` from the quickstart must never be mistakable for evidence about a
   * real system. Optional and omitted when false, so every existing fixture keeps compiling. */
  readonly demo?: boolean;
  /** The `authorized target` declarations in force for this run (M128b, D291). Recorded here so
   * that the claim which *permitted* a security scan travels in the same artifact as the scan's
   * findings — a report showing security results with no record of who said the scan was allowed is
   * half a document, and the half it is missing is the one an auditor asks for.
   *
   * Emitted whenever the config declares any, not only when a security assertion ran: a declaration
   * is a claim its author made, and the run either honoured it or had no use for it. Optional and
   * omitted when empty, so every existing `RunReport` fixture keeps compiling. */
  readonly authorizedTargets?: readonly AuthorizedTarget[];
  /**
   * M130b (D331) — what an `authorization violations` assertion could **not** reach, in two numbers
   * that answer two different questions, printed beside the `authorized target` reason above.
   *
   * `coverage` is a fact about the *suite*, computed by the checker over every discovered file
   * before anything runs: how many `api` steps sit in a test that declares an owner. It is the
   * sentence that stops *we probed everything we asserted on* being read as *we probed everything*,
   * and it replaces D316's own blind-spot count, which as specified could only ever be zero — it
   * named `TF062`/`TF063` sites, and those are errors, so no run containing one executes.
   *
   * `declines` is a fact about *this run*: work an assertion actually met and turned down — a
   * mutating step with no `probe mutating`, a session that would not establish, a probe that
   * answered without answering. Aggregated by reason across the whole run.
   *
   * The two are deliberately separate rather than one number. `M126`'s rule is that a denominator
   * travels on the same line as its count, and these have different denominators: a static one over
   * the suite, a dynamic one over the assertions that ran. Folding them would produce a percentage
   * whose base changed depending on `--tags`.
   */
  /**
   * M134b (D376/D385) — every finding all three security scans produced this run, in the order they
   * were raised, each carrying R8's stable `fingerprint`.
   *
   * **Findings the gate withheld are here too**, stamped with `withheld`. That is deliberate and it
   * is the property the whole feature rests on: a baseline whose contents you cannot see is not
   * reviewable, and a report that agreed with the gate would describe the gate rather than the run.
   *
   * Redacted with the same pass every other field gets — `detail` carries response excerpts. The one
   * exception D376 states is the *payload*: in Tier 3 it is attacker-controlled input rather than
   * leaked data, it is safe to print in full, and it must be, because it is the repro.
   *
   * Optional and omitted when empty, so a run with no security assertion adds nothing to the report
   * and every existing `RunReport` fixture keeps compiling.
   */
  readonly findings?: readonly ScanFinding[];
  /**
   * M134b (D389) — which rules each scan applied and which stood down, with the reason.
   *
   * This is `M128-01`'s fix. That row is about a report which can name its not-applicable rules only
   * inside D285's *no power to fail* message — a message that prints when **zero** rules applied, so
   * for the two Tier 1 rules that apply unconditionally it can never print at all. The facts existed
   * every run and were thrown away at this boundary; the row's own suggested fix is "the rule ids in
   * the JSON report regardless of what the terminal prints", which is exactly this field.
   *
   * Keyed by scan, so Tier 3's four rules and Tier 1's twelve do not have to share a namespace to be
   * counted. Optional for the reason every other addition here is.
   */
  readonly scanCoverage?: readonly ScanRuleCensus[];
  /**
   * `M136a` (D418a) — what the scans could not put a question to, as opposed to `scanCoverage`
   * above, which is what their rules declined to judge.
   *
   * **Renamed from `authzBlindSpot`, and the rename is the decision.** The field shipped in `M130b`
   * carrying Tier 2's turned-down principals, and Tier 3 has had the identical fact about payload
   * classes ever since `M134a` — announced on the console by `mutationNote` and then dropped on the
   * floor, so a run whose whole matrix was refused before it left the process wrote a `results.json`
   * indistinguishable from one that probed everything. A field named for one tier that carries two
   * is `M134a-01`'s defect expressed in a type, so it is named for what it holds.
   *
   * `coverage` stays authorization-only and is not generalised: it counts `api` steps in a test that
   * declares an owner, which is a fact about the *suite* rather than about this run, and no other
   * tier has an equivalent — Tier 3 asserts on any request with mutable input and needs no `as`.
   *
   * `declines` is keyed by `scan` + `subject`. A subject is a **principal** for Tier 2, because its
   * refusals are per-identity, and an **endpoint** for Tier 3, because its are per-request — a write
   * with no `probe mutating`, an unaffirmed public origin, a 429. Not a payload class: `planProbes`
   * filters the corpus to the granted classes before planning, so a withheld class produces no probe
   * outcome at all and is already reported as a not-applicable *rule* by `scanCoverage`. Tier 1 has
   * no inhabitant by construction — it judges one observed response and sends nothing, so there is
   * no question it can fail to ask.
   */
  readonly scanBlindSpot?: {
    readonly coverage?: { readonly apiSteps: number; readonly withOwner: number };
    readonly declines?: readonly { readonly scan: ScanKind; readonly subject: string; readonly reason: string; readonly count: number }[];
  };
  /** Names declared secret — via `env(NAME)`/`require env`, or a `capture` whose subject a `redact`
   * pattern covers — whose value was too short for `MIN_REDACTABLE_LENGTH` to mask safely, so it
   * ships in the clear (review finding `A12-01`). Surfaced as a warning beside `insecure`'s, for
   * the same reason: the run declining to protect a value it was told was a secret is exactly the
   * kind of trade-off that must not be silent. Optional and omitted when empty, so the common case
   * adds nothing to the report and every existing `RunReport` fixture keeps compiling. */
  readonly unmaskableSecrets?: readonly string[];
  /** FS-01 (review finding V2-01) — the `evidence` level this run actually ran at, carried into the
   * report so `report.html`'s footer can describe what the file contains instead of asserting a
   * fixed claim about it. The reporter cannot infer this from the contents alone: "no screenshots"
   * is equally true of a clean API-only run at `evidence full` and a browser run at `evidence none`,
   * and those two deserve different sentences. Optional so every fixture built directly against
   * `RunReport` (unit tests across `runtime`/`reporter`) keeps compiling; absent is rendered as
   * `full`, the default. */
  readonly evidenceLevel?: EvidenceLevel;
  /** The Playwright engine this run's browser steps ran against (M3c, D11: "engine is a run-level
   * property in the report header"). Undefined only for a run given no `BrowserManager` at all
   * (a hand-built test harness, never a real `tflw run` invocation, which always supplies one). */
  readonly browserEngine?: BrowserEngine;
  /** M56 (Phase 3, D117) — this run's own generator health, hoisted from the old standalone
   * `LoadReport.selfDiagnosis` now that load reporting lives inside `RunReport`. Present only when
   * at least one file in this run had a workload-bearing test that got a chance to run (mirrors
   * `LoadReport.selfDiagnosis`'s old always-present-when-a-`LoadReport`-existed-at-all rule, just
   * optional here since a purely functional run never had one). Merged across files, when more
   * than one contributed, via the same `mergeSelfDiagnosis` shard-merge already used within one
   * file (`cli.ts`'s `mergeReports`). */
  readonly selfDiagnosis?: SelfDiagnosis;
  /** M56 (Phase 3, D117) — `selfDiagnosis.saturated` lifted to run level, `true` if *any*
   * contributing file's generator saturated (a saturated generator anywhere invalidates that
   * file's own workload numbers, and CI must not read the merged run as a trustworthy "system
   * passed" while that's true). Always `false`/absent on a purely functional run. */
  readonly inconclusive?: boolean;
  /** M56 (Phase 3, D117) — `true` if Ctrl-C stopped any file's workload-bearing test before its
   * planned duration elapsed; every workload entry in `tests` still reflects whatever iterations
   * completed. Absent (not merely `false`) on a run with no abort. */
  readonly aborted?: boolean;
  /** Human-readable "aborted at Ns of Nm planned" for the (first) file that was aborted — only
   * present alongside `aborted: true`. */
  readonly abortedMessage?: string;
}

// ---- Event stream ----------------------------------------------------------

// `file` is optional and unset by the interpreter itself — `runProgram` runs one file per call
// and has no reason to know its own path (a display concern, same precedent as `TestResult.file`
// below). The CLI tags it onto every event by wrapping the `EventSink` it passes in (PLAN decision
// 111/M17) — needed so a machine consumer (`--format ndjson`) can tell concurrent files' events
// apart under `--workers > 1`, the same ambiguity that already forces `--verbose` to buffer
// per-file instead of interleaving (see `cli.ts`'s `bufferedEmit`).
export type RunEvent =
  | { readonly type: 'run:start'; readonly total: number; readonly env: string; readonly file?: string }
  | { readonly type: 'test:start'; readonly name: string; readonly file?: string }
  | { readonly type: 'step:end'; readonly test: string; readonly step: StepResult; readonly file?: string }
  // `ReportEntry`, not `TestResult` (M88d, review finding `B3-11`): a workload-bearing test is a
  // row in `report.tests` like any other, so it emits a `test:start`/`test:end` pair like any
  // other, and the result it carries is the same `WorkloadTestResult` the report will hold —
  // metrics and evaluated thresholds instead of a step timeline. Every consumer of this field has
  // to branch on `result.kind` for the same reason `RunReport.tests`' consumers already do.
  | { readonly type: 'test:end'; readonly result: ReportEntry; readonly file?: string }
  | { readonly type: 'run:end'; readonly report: RunReport; readonly file?: string };

export type EventSink = (event: RunEvent) => void;

// ---- Load testing (M29-M32, PLAN_BROWSER_PERF_SECURITY.md D24a/D29/D19/D28, R1-R6/R11) --------
//
// M32 fills in the rest of `PLAN_REPORTS_PERF_SECURITY.md`'s design on top of M29-M31's engine:
// every `LoadMetrics` now carries its own `histogram`/`timeline` (R3/R4 — what `load-report.html`'s
// inline-SVG charts render from), `LoadReport` gains `inconclusive` (R11 — `selfDiagnosis.saturated`
// lifted to a top-level verdict the CLI maps to a distinct exit code and junit maps to `skipped`)
// and `aborted`/`abortedMessage` (R5 — a Ctrl-C'd run's partial results, flushed rather than lost).
// M43 (`PLAN_BROWSER_PERF_SECURITY.md` §2.14, D67-D72) finally fills in R6's third axis:
// `LoadScenarioReport.endpoints` below. The normalized-identity blocker this comment used to cite
// turned out to already be solved for free — `PathExpr.raw` (`lang/src/ast.ts`) is the literal,
// un-interpolated path template as written in source, stable at parse time, no SARIF-style
// runtime-value normalization needed. Identity is `(service, method, path.raw)`, or an explicit
// `ApiStep.tag` (`as "label"`) when present, which *replaces* rather than merely relabels it.

/** One completed VU iteration's outcome, as fed to `LoadOptions.onIteration` for live progress. */
export interface LoadIterationResult {
  readonly ok: boolean;
  /** Which `scenario` this iteration belongs to (M30 — a run may interleave several concurrently). */
  readonly scenario: string;
  /** Wall-clock duration of this iteration's steps, **excluding** any `pause` time (ast.ts's
   * `PauseStmt` doc: pacing is not system latency — including it would let a load test
   * satisfy a duration threshold merely by sleeping more). */
  readonly durationMs: number;
  readonly error?: string;
}

export interface LoadDurationStats {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

export interface LoadMetrics {
  readonly iterations: number;
  readonly failures: number;
  /** `failures / iterations`, `0` when `iterations === 0`. */
  readonly errorRate: number;
  /** Active (pause-excluded) iteration duration, ms — see `LoadIterationResult.durationMs`. */
  readonly durations: LoadDurationStats;
  /** M32 (R4) — this metric's own duration distribution, bucketed (not raw samples) — small enough
   * to inline into `report.html` for the response-time distribution histogram chart, and reused
   * verbatim by `results.json` consumers that want the full distribution rather than just the five
   * summary percentiles in `durations`. */
  readonly histogram: readonly HistogramBucket[];
  /** M32 (R3/R4) — one point per second of wall-clock run time this metric's iterations landed in
   * (`durations`' scope: combined = every scenario, a scenario report = just that scenario's own
   * iterations) — the timeline SVGs (latency-over-time, throughput, error-rate) are built from
   * this, sorted ascending by `offsetSeconds`. Empty for a run with zero iterations. */
  readonly timeline: readonly TimelinePoint[];
  /** M89a (`B3-02`, D-M89-0/D-M89-3) — the **successful-only** duration population, which is what a
   * `threshold pNN duration` clause actually reads. `durations`/`histogram` above stay
   * all-iterations and keep their exact prior meaning, so this field is purely additive: a
   * `results.json` consumer that never looked here sees no change.
   *
   * The split exists because a failing request is usually *fast* — it 4xx/5xxs or refuses the
   * connection long before a healthy one finishes — so mixing failures into the percentiles pulls
   * them **down**, and a latency threshold then passes *because* the target is broken. The probe
   * that filed `B3-02` reported `p95 2ms ✓ < 100ms` at a 96 % error rate.
   *
   * `iterations` here is the successful count, so `failures + successful.iterations === iterations`
   * holds at every scope. Note deliberately **no `timeline`**: the timeline charts are about the
   * whole run's shape over time, error rate included, and a successful-only series would make the
   * error-rate chart unplottable from its own metrics object. */
  readonly successful: {
    readonly iterations: number;
    readonly durations: LoadDurationStats;
    readonly histogram: readonly HistogramBucket[];
  };
}

export interface LoadThresholdResult {
  /** Human-readable label, e.g. `p95 duration` / `error rate`, for console/report display. */
  readonly label: string;
  readonly op: 'lessThan' | 'greaterThan';
  /** ms for a duration threshold, a 0-1 fraction for an error-rate threshold — same units as `actual`. */
  readonly target: number;
  /** M89a (D-M89-1) — `null` when a **duration** threshold had **no successful iterations** to
   * measure: there is no percentile, and saying so is the only honest answer. Such a threshold is
   * never `ok`.
   *
   * `actual: 0` was rejected precisely because it reads as a passing 0 ms p95 that never happened,
   * and a consumer holding only this field could not tell the difference. Passing was rejected for
   * the same reason at the boundary: `LatencyHistogram.percentile` returns `0` on an empty
   * histogram (`histogram.ts:85`), so `0 < 100ms` would reintroduce `B3-02`'s exact trap in the
   * one case where *everything* failed. An error-rate threshold is never `null` — a 0-iteration run
   * has a genuine, defined error rate of 0. */
  readonly actual: number | null;
  readonly ok: boolean;
}

/** D17's back-off / coordinated-omission diagnostic (M34, acceptance milestone — designed and
 * built here; D17 named it but no M29-M32 milestone actually implemented it). Only meaningful for
 * a **closed**-model (`ramp to N users`) scenario: its VUs loop continuously, so when the system
 * under test slows down they don't report degraded throughput directly — they simply complete
 * fewer iterations, silently. This is exactly "coordinated omission" (ast.ts's `RampUsersWorkload`
 * doc): the load backs off precisely when it matters most, and a percentile computed only from the
 * iterations that *did* complete understates how bad things really got.
 *
 * `ratio` compares the scenario's own mean iteration duration in the **first half** of its run
 * against the **second half**: `1 - earlyMeanMs / lateMeanMs`, clamped to `[0, ∞)`. Near 0 when a
 * scenario's pace stayed roughly constant throughout (healthy); climbs toward 1 as the second
 * half's iterations run much longer than the first half's — direct evidence the target system
 * slowed down partway through the run, not just ordinary sample-to-sample noise. This was chosen
 * over comparing against an extremal percentile (e.g. p10) as an "ideal pace" baseline — that
 * approach is systematically biased: p10 is *always* faster than a run's typical iteration by
 * construction, so it flags "backing off" even on a perfectly healthy target (caught by a real,
 * non-simulated test against a uniformly-fast fixture server during this diagnostic's own
 * development). Comparing two same-shape aggregates (mean vs. mean, each drawn from a
 * representative half of the run) has no such structural bias. `warning` is `ratio` past
 * `BACK_OFF_WARNING_THRESHOLD` (interpreter.ts), gated on a minimum iteration count in *each* half
 * so a handful of samples can't manufacture a spurious warning either way.
 *
 * Deliberately **not** an open-model (`ramp to N rps`) field — arrival-rate scheduling doesn't
 * "back off": queues build under saturation instead of iterations silently disappearing, which is
 * D17's whole reason the open model "honestly validates an SLA." `undefined` there, not `false` /
 * a zeroed-out ratio, so a report never implies "we checked and it's fine" for a model where the
 * question doesn't apply.
 *
 * **M107b (`M107-01`, D-M107-1) — and, for the same reason, not a rising-target field either.**
 * The early/late comparison only reads as "the target slowed down" if the two halves are otherwise
 * alike, and under a rising target they are not: a `ramp to N users over M` runs its second half at
 * roughly 3× the concurrency of its first, and every finite-capacity system answers more concurrent
 * work more slowly. Measured against a *healthy* single-queue service, `ramp` warned 8 runs out of
 * 8 at ratio 0.569-0.589 — **higher than a genuinely leaking service scores under either shape**
 * (0.334-0.381), so no threshold separates them and this was never a tuning problem. For `ramp` the
 * question is not hard but unanswerable: the grammar gives it no plateau, so no two windows of the
 * run share a concurrency level and there is no like-for-like comparison to make. Eligible kinds
 * are therefore `hold users`, and a `step`/`spike users` whose stages all name one target and never
 * ramp — a `hold` written long-hand. To measure degradation under a rising load, hold at the level
 * you care about; a ramp measures capacity, not deterioration. See `hasConstantConcurrency`
 * (interpreter.ts) for the full 3×2 measurement and why normalising by live VU count was rejected
 * on the same numbers. Report-only (like a saturated generator's warning): unlike `inconclusive`
 * (R11), a back-off warning never flips `LoadThresholdResult.ok` or a junit verdict — D17 only
 * asks the report to warn, not to invalidate a scenario's own threshold verdicts. */
export interface BackOffDiagnosis {
  readonly ratio: number;
  readonly warning: boolean;
}

/** M89b (`B3-03`, D-M89-4) — how a scenario's declared workload appears in the report, and the
 * one value every description of it is formatted from (`describeWorkload`, in the reporter).
 *
 * **Breaking change to `results.json`.** This replaced a flat `{ kind: 'users'|'rps', target,
 * overMs }` that could describe only `ramp`, so the other 8 kinds were squeezed into it and lost:
 * `hold 3 users for 600ms` and `ramp to 3 users over 600ms` serialized to *byte-identical* JSON,
 * as did `step` vs `spike` at the same peak, and the two count-based kinds — which have no
 * duration at all — reported `overMs: 0` and rendered as `ramp to 2 users over 0ms`, a workload
 * the grammar cannot express. The union exists so that string is **unrepresentable**, not so it
 * can be spelled better: `M85`'s state-the-rule-once and `M88d`'s one-finalization move.
 *
 * `model` is absent from `iterations` deliberately — `run N iterations across M users` has no
 * `rps` form, so a `model` field there could only ever hold `'closed'` and would be a field
 * carrying no information. A consumer asking "is this open-model?" writes
 * `w.shape !== 'iterations' && w.model === 'open'`. Adding a constant field back later is
 * additive; removing one is not.
 *
 * `stages` is per-stage, not the old peak-and-total summary. `step` stages have no `ramped` flag
 * because the grammar gives them none — `parseStepStage` only ever produces `mode: 'jump'` (a
 * `step` stage saying `over` is a parse error suggesting `spike`), while `spike` produces both,
 * and that flag is exactly what `stageTargetAt` branches on when it schedules them. */
export type LoadWorkloadReport =
  | { readonly shape: 'ramp'; readonly model: 'closed' | 'open'; readonly target: number; readonly overMs: number }
  | { readonly shape: 'hold'; readonly model: 'closed' | 'open'; readonly target: number; readonly forMs: number }
  | { readonly shape: 'step'; readonly model: 'closed' | 'open'; readonly stages: readonly LoadWorkloadStage[] }
  | { readonly shape: 'spike'; readonly model: 'closed' | 'open'; readonly stages: readonly LoadWorkloadRampableStage[] }
  | { readonly shape: 'iterations'; readonly iterations: number; readonly vus: number; readonly perVu: boolean };

/** One `step` stage: an instant jump to `target`, held for `durationMs`. */
export interface LoadWorkloadStage {
  readonly target: number;
  readonly durationMs: number;
}

/** One `spike` stage — a `step` stage plus the flag that says whether it ramps to `target` from
 * the previous stage's level (`to N over <dur>`) or jumps straight to it (`hold N for <dur>`). */
export interface LoadWorkloadRampableStage extends LoadWorkloadStage {
  readonly ramped: boolean;
}

/** One scenario's own slice of a `tflw load` run (R6's "per-scenario" axis) — every field scoped
 * to just this scenario's iterations, computed exactly the way a single-scenario M29 report was. */
export interface LoadScenarioReport {
  readonly name: string;
  readonly workload: LoadWorkloadReport;
  readonly metrics: LoadMetrics;
  readonly thresholds: readonly LoadThresholdResult[];
  /** Every threshold *this scenario* declared passed (vacuously `true` when it declares none). */
  readonly ok: boolean;
  /** M34 (D17) — present only for a `RampUsersWorkload` scenario; see `BackOffDiagnosis`. */
  readonly backOff?: BackOffDiagnosis;
  /** M43 (R6's per-endpoint axis, D67-D69) — this scenario's iterations broken down by `api` step
   * identity (explicit `as "label"` tag, or automatic `METHOD path.raw`). Each entry's `metrics`
   * covers only that one step's own `durationMs` across every iteration, e.g. `checkout-burst`'s
   * `for "checkout"` scoped threshold reads from the `"checkout"` entry here, not the scenario's
   * whole-iteration `metrics` above (which still sums every `api` step, unchanged). Additive field
   * — existing `results.json` consumers are unaffected. Ordered by first appearance in source. */
  readonly endpoints: readonly { readonly identity: string; readonly metrics: LoadMetrics }[];
}

/** A generator process's read on its own health while it drove a `load` run (M31,
 * `PLAN_BROWSER_PERF_SECURITY.md` D19/D28's "generator self-diagnosis" — event-loop lag and CPU
 * saturation tracked alongside the metrics the same worker loop already collects). `saturated` is
 * the "tflw itself is the bottleneck" verdict: when true, the measured latency/throughput reflects
 * tflw's own generator process contending with itself, not the system under test, and the report
 * says so rather than silently reporting numbers that understate real load. */
export interface SelfDiagnosis {
  readonly avgEventLoopLagMs: number;
  readonly maxEventLoopLagMs: number;
  /** Percent of one CPU core consumed over the run's wall-clock duration — can exceed 100 on a
   * multi-threaded workload (libuv's thread pool), though a single generator process's own
   * JS-thread-bound work rarely does. */
  readonly cpuPercent: number;
  readonly saturated: boolean;
}

/**
 * The `--workers N>1` shard-merge carrier: `mergeLoadShardReports` builds one, and
 * `spliceLoadReportIntoRunReport` immediately unpacks it into the `RunReport` that actually ships.
 * Not a user-visible artifact and no longer an entry point's return type — `M91a` deleted
 * `runLoad` (review finding `B3-06`), leaving this shape with exactly one producer and one
 * consumer, both internal.
 *
 * `M91a` also deleted its `combined` field (review finding `B3-19`, `D-M91-1`): "R6's combined
 * axis" was computed twice — once here, once in the now-deleted `buildLoadReport` — and read
 * nowhere. `spliceLoadReportIntoRunReport` dropped it, no reporter or CLI code ever referenced it,
 * and its documented consumer (`load-results.json`) stopped existing when M53/M56 folded load
 * reporting into the unified run. Pooled run-wide numbers, if they are ever wanted again, belong
 * on `RunReport` where something can render them.
 */
export interface LoadReport {
  /** Every scenario's `ok` (vacuously `true` for a scenario with no `threshold`s). Independent of
   * `inconclusive` below — a saturated generator doesn't flip passing thresholds to failing, it
   * just means this verdict shouldn't be trusted (R11: CI reads `inconclusive` first). */
  readonly ok: boolean;
  /** One entry per `scenario` in the file, source order, all run concurrently (M30, D29). */
  readonly scenarios: readonly LoadScenarioReport[];
  readonly startedAt: string;
  readonly durationMs: number;
  readonly seed: number;
  readonly now: string;
  /** M31/D28 — this run's own generator health (single-process: one process; `--workers N`: the
   * merge of all N, `mergeSelfDiagnosis`). */
  readonly selfDiagnosis: SelfDiagnosis;
  /** M32 (R11) — `selfDiagnosis.saturated` lifted to the top level: the measured numbers reflect
   * tflw's own generator process, not the system under test, so `ok` isn't a trustworthy verdict
   * this run. The CLI maps this to a distinct exit code and junit marks every threshold `skipped`
   * rather than passed/failed (R11: "CI must not read an unmeasurable run as 'system passed'"). */
  readonly inconclusive: boolean;
  /** M32 (R5) — set when Ctrl-C stopped the run before its planned duration elapsed; every metric
   * above still reflects whatever iterations completed before the abort, not a full run. Absent
   * (not merely `false`) on a run that reached its planned end normally. */
  readonly aborted?: boolean;
  /** Human-readable "aborted at Ns of Nm planned" — only present alongside `aborted: true`. */
  readonly abortedMessage?: string;
}

// ---- Multi-process load generator (M31, D19/R4) ----------------------------------------------
//
// `tflw load --workers N` (N>1) forks N OS processes rather than scaling in-process — load
// generation is CPU-bound (TLS, JSON parse, ajv, redaction scanning) and Node caps at one core per
// process. Each forked worker runs `runLoadShard` for an equal (±1) striped share of every
// scenario's workload target and reports back a compact `LoadShardResult` (histograms, not raw
// samples — R4) over the fork's built-in IPC channel; the parent merges every shard's result via
// `mergeLoadShardReports` into one `LoadReport` and splices it into the run's `RunReport`
// (`spliceLoadReportIntoRunReport`), so nothing downstream (CLI rendering, `results.json`) needs
// to know how many processes actually ran.

/** One `scenario`'s contribution from a single shard (worker process) — a compact, IPC-safe
 * summary (a histogram's buckets are at most a few hundred entries regardless of how many
 * iterations that shard ran, R4) rather than every raw duration. */
export interface LoadShardScenarioResult {
  readonly name: string;
  readonly workload: LoadScenarioReport['workload'];
  readonly iterations: number;
  readonly failures: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly histogram: readonly HistogramBucket[];
  /** M89a (`B3-02`) — this shard's own successful-only duration population, shipped as its own
   * bucket set + exact scalars exactly like the all-iterations one above. It has to cross the IPC
   * boundary rather than being re-derived parent-side: the parent has the merged counts but not
   * *which* durations belonged to successful iterations, and a threshold evaluated on a
   * reconstruction would silently differ from the single-process answer. `mergeLoadShardReports`
   * merges it with the same `merge first, derive second` order as everything else here. */
  readonly successful: SerializedHistogram;
  /** M32 (R3/R4) — this shard's own per-second buckets; `Timeline.merge` combines them across
   * shards the same way the histogram merges, so the parent's timeline charts cover the whole run,
   * not just one shard's slice of it. */
  readonly timeline: readonly SerializedTimelineBucket[];
  /** M34 (D17) — this shard's own contribution to `BackOffDiagnosis`: iteration count and summed
   * duration for this scenario's first half of wall-clock time vs. its second half (split at the
   * scenario's own `overMs / 2`). The parent sums every shard's `early`/`late` before recomputing
   * `ratio` from the *merged* totals, the same "merge first, derive second" order every other
   * aggregate field in this file already follows. Both stay `{ count: 0, sum: 0 }` for an
   * open-model scenario — nothing populates them, mirroring `BackOffDiagnosis` itself being absent
   * there. */
  readonly early: { readonly count: number; readonly sum: number };
  readonly late: { readonly count: number; readonly sum: number };
  /** M43 (D67-D69) — this shard's own per-endpoint contribution, same IPC-safe bucket shape as the
   * scenario-level fields above; `mergeLoadShardReports` merges each identity's histogram/timeline
   * across shards the same way it already merges the scenario-level ones. */
  readonly endpoints: readonly {
    readonly identity: string;
    readonly iterations: number;
    readonly failures: number;
    readonly sum: number;
    readonly min: number;
    readonly max: number;
    readonly histogram: readonly HistogramBucket[];
    readonly timeline: readonly SerializedTimelineBucket[];
    /** M89a — the per-endpoint half of the same split; a `threshold … for "label"` clause reads it. */
    readonly successful: SerializedHistogram;
  }[];
}

/** M89a — one `LatencyHistogram`'s complete IPC-safe form: bucket counts plus the exact running
 * scalars `LatencyHistogram.fromBuckets` needs to reconstruct `avg`/`min`/`max` without re-deriving
 * them from rounded bucket keys. Named because the successful-only population now ships alongside
 * the all-iterations one at both scenario and endpoint scope — four sites that must agree. */
export interface SerializedHistogram {
  readonly iterations: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly histogram: readonly HistogramBucket[];
}

/** What one forked worker process sends back to the parent once its striped share of the run
 * finishes. */
export interface LoadShardResult {
  readonly scenarios: readonly LoadShardScenarioResult[];
  readonly selfDiagnosis: SelfDiagnosis;
}

/** M32 (R5) — a coarse, cheap-to-compute cumulative snapshot fired roughly once a second while a
 * workload run is in flight, for the CLI's live console line. Deliberately not the
 * same shape as `LoadMetrics` (no percentiles here — computing one on every tick would defeat the
 * point of a lightweight tick); the CLI derives `rps`/`error rate` itself by diffing consecutive
 * snapshots. */
export interface LoadProgressSnapshot {
  readonly iterations: number;
  readonly failures: number;
  readonly elapsedMs: number;
  /** A live `startSelfDiagnosis().peek()` read as of this tick (R5: "surfaces the D19 generator
   * self-diagnosis live, so a saturating generator is visible mid-run" — not just in the final
   * report). */
  readonly selfDiagnosis: SelfDiagnosis;
}
