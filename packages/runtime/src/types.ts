// Shared runtime types: the resolved config the interpreter runs against, the event stream it
// emits (SPEC §13 — the reporter is a pure consumer of these), and the aggregated run report.

import type { EvidenceLevel, LogDestination, LogLevel, RedactPattern, SessionDecl, Value } from '@tflw/lang';
// Re-exported so downstream packages that only depend on `@tflw/runtime` (e.g. `packages/reporter`,
// which has no direct `@tflw/lang` dependency) can still type a `logLevelThreshold`/`logDestination`
// parameter without adding one (M27, PLAN_LOG.md).
export type { LogDestination, LogLevel } from '@tflw/lang';
import type { BrowserEngine } from './browser.js';
import type { SnapshotDiffAsset } from './snapshot.js';
import type { HistogramBucket } from './histogram.js';

// ---- Resolved config -------------------------------------------------------

export interface ResolvedHeader {
  readonly name: string;
  /** Kept unevaluated so `env(…)` taint is recorded at request-build time, not config load. */
  readonly value: Value;
  /** null = applies to every service. */
  readonly service: string | null;
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
  | 'think';

export interface RequestTrace {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
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
}

export interface RunReport {
  readonly ok: boolean;
  readonly env: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly tests: readonly TestResult[];
  /** The `random`/`unique` run seed — reproduce this exact run with `tflw run --seed <n>` (P#23). */
  readonly seed: number;
  /** The run clock (ISO 8601) that `today`/`now`/date generators derived from — reproduce the
   * exact same absolute dates alongside `--seed` with `tflw run --seed <n> --now <iso>`
   * (decision 52). */
  readonly now: string;
  /** True when this run had `insecure true` active (TLS verification disabled) — surfaced as a
   * visible warning in the CLI summary and report header, never silently (decision 78). */
  readonly insecure: boolean;
  /** The Playwright engine this run's browser steps ran against (M3c, D11: "engine is a run-level
   * property in the report header"). Undefined only for a run given no `BrowserManager` at all
   * (a hand-built test harness, never a real `tflw run` invocation, which always supplies one). */
  readonly browserEngine?: BrowserEngine;
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
  | { readonly type: 'test:end'; readonly result: TestResult; readonly file?: string }
  | { readonly type: 'run:end'; readonly report: RunReport; readonly file?: string };

export type EventSink = (event: RunEvent) => void;

// ---- Load testing (M29/M30/M31, PLAN_BROWSER_PERF_SECURITY.md D24a/D29/D19/D28, R4/R6) --------
//
// Deliberately minimal — a "reporter stub" (M29/M30/M31's own scope), not the full `LoadReport`
// design (`PLAN_REPORTS_PERF_SECURITY.md` R1-R6/R11: independent HTML view, live per-second
// buckets, partial-on-SIGINT) that M32 builds. This is enough to run every `scenario` in a file
// concurrently, optionally across multiple processes (M31), and get a pass/fail verdict + a
// metrics JSON, combined and broken down per scenario (R6) plus a generator self-diagnosis
// (M31/D28) — no `report/load-report.html`, no junit mapping yet, and no per-endpoint breakdown
// (R6's other axis — needs per-request endpoint tagging M32 adds).

/** One completed VU iteration's outcome, as fed to `LoadOptions.onIteration` for live progress. */
export interface LoadIterationResult {
  readonly ok: boolean;
  /** Which `scenario` this iteration belongs to (M30 — a run may interleave several concurrently). */
  readonly scenario: string;
  /** Wall-clock duration of this iteration's steps, **excluding** any `think` time (ast.ts's
   * `ThinkStmt` doc: think models pacing, not system latency — including it would let a scenario
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
  /** Active (think-excluded) iteration duration, ms — see `LoadIterationResult.durationMs`. */
  readonly durations: LoadDurationStats;
}

export interface LoadThresholdResult {
  /** Human-readable label, e.g. `p95 duration` / `error rate`, for console/report display. */
  readonly label: string;
  readonly op: 'lessThan' | 'greaterThan';
  /** ms for a duration threshold, a 0-1 fraction for an error-rate threshold — same units as `actual`. */
  readonly target: number;
  readonly actual: number;
  readonly ok: boolean;
}

/** One scenario's own slice of a `tflw load` run (R6's "per-scenario" axis) — every field scoped
 * to just this scenario's iterations, computed exactly the way a single-scenario M29 report was. */
export interface LoadScenarioReport {
  readonly name: string;
  readonly workload: { readonly kind: 'users' | 'rps'; readonly target: number; readonly overMs: number };
  readonly metrics: LoadMetrics;
  readonly thresholds: readonly LoadThresholdResult[];
  /** Every threshold *this scenario* declared passed (vacuously `true` when it declares none). */
  readonly ok: boolean;
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

export interface LoadReport {
  /** Every scenario's `ok` (vacuously `true` for a scenario with no `threshold`s). */
  readonly ok: boolean;
  /** One entry per `scenario` in the file, source order, all run concurrently (M30, D29). */
  readonly scenarios: readonly LoadScenarioReport[];
  /** R6's "combined" axis — every scenario's iterations pooled into one set of metrics, the
   * quotable run-wide numbers. Has no thresholds of its own: `threshold` is always declared, and
   * evaluated, per scenario (a scenario's pass/fail must not depend on what else shares the run). */
  readonly combined: LoadMetrics;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly seed: number;
  readonly now: string;
  /** M31/D28 — this run's own generator health (single-process: one process; `--workers N`: the
   * merge of all N, `mergeSelfDiagnosis`). */
  readonly selfDiagnosis: SelfDiagnosis;
}

// ---- Multi-process load generator (M31, D19/R4) ----------------------------------------------
//
// `tflw load --workers N` (N>1) forks N OS processes rather than scaling in-process — load
// generation is CPU-bound (TLS, JSON parse, ajv, redaction scanning) and Node caps at one core per
// process. Each forked worker runs `runLoadShard` for an equal (±1) striped share of every
// scenario's workload target and reports back a compact `LoadShardResult` (histograms, not raw
// samples — R4) over the fork's built-in IPC channel; the parent merges every shard's result via
// `mergeLoadShardReports` into the exact same `LoadReport` shape `runLoad` itself returns, so
// nothing downstream (CLI rendering, `load-metrics.json`) needs to know how many processes ran.

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
}

/** What one forked worker process sends back to the parent once its striped share of the run
 * finishes. */
export interface LoadShardResult {
  readonly scenarios: readonly LoadShardScenarioResult[];
  readonly selfDiagnosis: SelfDiagnosis;
}
