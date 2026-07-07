// Shared runtime types: the resolved config the interpreter runs against, the event stream it
// emits (SPEC §13 — the reporter is a pure consumer of these), and the aggregated run report.

import type { SessionDecl, Value } from '@tflw/lang';

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
  /** Resolved from `timeout expect` but **inert in the API-only tool** — nothing in `interpreter.ts`
   * reads it yet. Kept in the grammar so it stays additive-only past publish (PLAN decision 58);
   * it starts doing something once auto-retrying UI expects land (M3, SPEC §3.1). Do not read it
   * from here without also updating SPEC §3.1's note. */
  readonly expect: number;
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
}

export const DEFAULT_TIMEOUTS: ResolvedTimeouts = { step: 30_000, expect: 5_000, wait: 30_000 };

// ---- Traces & results ------------------------------------------------------

export type StepKind = 'api' | 'expect' | 'check' | 'let' | 'capture' | 'wait' | 'call' | 'give' | 'header';

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
  /** Parsed JSON if the body parsed as JSON, else undefined. */
  readonly json?: unknown;
  readonly durationMs: number;
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
}

/** One `retry` attempt's outcome — captured so a flaky pass's earlier failing evidence survives
 * into the report instead of being discarded (SPEC §4.4, PLAN decision 86). `attempt` is 1-based. */
export interface AttemptResult {
  readonly attempt: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly steps: readonly StepResult[];
  readonly error?: string;
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
}

// ---- Event stream ----------------------------------------------------------

export type RunEvent =
  | { readonly type: 'run:start'; readonly total: number; readonly env: string }
  | { readonly type: 'test:start'; readonly name: string }
  | { readonly type: 'step:end'; readonly test: string; readonly step: StepResult }
  | { readonly type: 'test:end'; readonly result: TestResult }
  | { readonly type: 'run:end'; readonly report: RunReport };

export type EventSink = (event: RunEvent) => void;
