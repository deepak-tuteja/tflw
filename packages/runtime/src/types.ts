// Shared runtime types: the resolved config the interpreter runs against, the event stream it
// emits (SPEC §13 — the reporter is a pure consumer of these), and the aggregated run report.

import type { EvidenceLevel, RedactPattern, SessionDecl, Value } from '@tflw/lang';
import type { BrowserEngine } from './browser.js';
import type { SnapshotDiffAsset } from './snapshot.js';

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
}

export const DEFAULT_TIMEOUTS: ResolvedTimeouts = { step: 30_000, expect: 5_000, wait: 30_000 };

// ---- Traces & results ------------------------------------------------------

export type StepKind =
  | 'api'
  | 'expect'
  | 'check'
  | 'let'
  | 'capture'
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
  | 'stub';

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
