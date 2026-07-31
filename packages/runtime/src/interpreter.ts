// The interpreter: walks a parsed Program, executes API-only tests via fetch, and emits the
// event stream that the reporter consumes (SPEC §4–5, §13). Design invariants:
//  - API expects evaluate once against the received response and fail fast (P#15); `wait until
//    api` is the explicit, greppable escape hatch for eventual consistency (SPEC §5.5).
//  - a hard `expect` failure (or any runtime error) ends the test immediately (P#16).
//  - request/response traces stored in the report are redacted; the live values used to send the
//    request and to evaluate assertions are the real ones (P#30).

import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { parseSource, renderDiagnostics, type ActionDecl, type CallExpr } from '@tflw/lang';
import type {
  A11ySeverity,
  ApiBody,
  ApiRequestSpec,
  CaptureStmt,
  ExpectStmt,
  HookDecl,
  LetStmt,
  Locator as LocatorAst,
  LogStmt,
  NetworkRequestRef,
  Oauth2SessionConfig,
  PathSegment,
  Program,
  RedactPattern,
  ScenarioDecl,
  SessionDecl,
  Span,
  Step,
  Subject,
  TestDecl,
  ThresholdDecl,
  WaitUntilApiStmt,
  WaitUntilUiStmt,
} from '@tflw/lang';
import { evalValue, interpolatePath, navigate, RuntimeError, stringify, type BrowserAttemptContext, type EvalCtx } from './eval.js';
import { evalMatcher, evalRequestMatcher, repr, type MatchOutcome } from './matcher.js';
import { evalUiMatcherOnce } from './uiMatcher.js';
import { runA11yScan } from './a11y.js';
import { filterBySeverity, type Finding } from './finding.js';
import {
  BrowserPageState,
  captureFailureScreenshot,
  describeLocator,
  performCheck,
  performClick,
  performDrag,
  performDropFile,
  performFill,
  performHover,
  performOpen,
  performPressOnLocator,
  performPressOnPage,
  performScreenshot,
  performScrollIntoView,
  performSelect,
  performSnapshotCapture,
  performStub,
  performUncheck,
  requireSingleMatch,
  resolveLocator,
  resolveLocatorSnapshot,
  type BrowserManager,
  type CapturedNetworkRequest,
  type PWLocator,
  type PWPage,
  type ResolvedLocator,
} from './browser.js';
import { evaluateSnapshot, snapshotPaths } from './snapshot.js';
import { camelCaseName, loadHelperModule } from './helpers.js';
import { loadTableRows, type RowCell } from './dataTable.js';
import { Redactor, redactReport } from './redact.js';
import { maskDetailValue, pathMatchesRedactPattern, redactFields } from './fieldRedact.js';
import { evaluateSchemaMatch } from './contract.js';
import { evaluateFileMatch } from './binary-match.js';
import { parseCsv } from './csv-parse.js';
import { extractPdfText } from './pdf-text.js';
import { CookieJar } from './cookieJar.js';
import { sendRequest } from './http.js';
import { hashString, mulberry32, resolveRunClock, resolveRunSeed, subSeed } from './seed.js';
import { inferContentType } from './mime.js';
import { acquireInsecureTls, releaseInsecureTls } from './tls.js';
import type {
  AttemptResult,
  EventSink,
  LoadDurationStats,
  LoadIterationResult,
  LoadMetrics,
  LoadReport,
  LoadScenarioReport,
  LoadThresholdResult,
  RequestTrace,
  ResolvedConfig,
  ResponseTrace,
  RunReport,
  StepResult,
  TestResult,
} from './types.js';

/** A JS/TS helper export, called `(ctx, ...args)` — "test context in, values out" (P#11). */
type HelperFn = (ctx: { readonly env: NodeJS.ProcessEnv }, ...args: unknown[]) => unknown;

/** Resolved `action`/`use` callables for one file's run — built once, shared by every test (and
 * every nested action call) in it (P#17, P#11). */
interface CallRegistry {
  readonly actions: ReadonlyMap<string, ActionDecl>;
  readonly helpers: ReadonlyMap<string, HelperFn>;
}

const WAIT_POLL_INTERVAL_MS = 300;

export interface RunOptions {
  /** Source text of the file, for mirroring each step's line in the report timeline. */
  readonly source: string;
  /** Directory the `.tflw` file lives in — file-backed bodies/uploads resolve relative to it. */
  readonly baseDir?: string;
  readonly environ?: NodeJS.ProcessEnv;
  readonly emit?: EventSink;
  /** Reuse a redactor across files so all secrets are known everywhere. */
  readonly redactor?: Redactor;
  /** `--seed <n>`, or omitted to mint a fresh one (stamped on the report either way, P#23). */
  readonly seed?: number;
  /** `--now <iso>`, or omitted to use the real current instant (stamped on the report either way,
   * decision 52). Assumed already-validated (mirrors `seed`'s contract — the CLI is the usage-
   * error boundary, P#46). */
  readonly now?: string;
  /** Global test-index offset when running several files under one `--seed` (so sub-seeds don't
   * repeat across files); the caller accumulates this from each call's `report.total`. */
  readonly testIndexOffset?: number;
  /** Shared across every file in a run so `unique(...)` stays globally distinct, not just per-file. */
  readonly uniqueSeq?: { next(): number };
  /** Shared across every file in a run so each `session` block executes at most once (SPEC §3.3,
   * P#42); the caller creates one and reuses it across every `runProgram` call in the run. */
  readonly sessionCache?: SessionCache;
  /** Precomputed, deterministic answer to "which globally-indexed test case owns each session's
   * step-splicing" (session name → that case's global test index, `testIndexOffset`-relative) —
   * the CLI computes this up front, across every file, in sorted-file/declaration order, so it
   * doesn't depend on which file's first opting-in test happens to race `SessionCache.ensure()`
   * first under `--workers N>1` (decision 53). Omitted by single-`runProgram`-call callers (e.g.
   * test helpers), where there is no cross-call race and the original first-caller-wins behavior
   * applies instead. */
  readonly sessionSpliceOwners?: ReadonlyMap<string, number>;
  /** One shared browser process for the whole `tflw run` invocation (M3a, D13) — the CLI creates
   * it once and passes the same instance to every file's `runProgram` call, closing it after all
   * of them finish. Omitted entirely means no browser step can run this call (a clear internal
   * error, not a crash) — the case for every existing API-only test harness/fixture. */
  readonly browserManager?: BrowserManager;
  /** This file's own identity for `snapshots/<file>/<test>/<name>.png` (M4b, D15) — unlike
   * `report.tests[].file` (stamped post-hoc, purely a display concern, `cli.ts`), a snapshot
   * baseline's path is needed *during* execution, so it has to come in through `RunOptions`
   * itself. Falls back to a fixed label when omitted (a test harness driving `runProgram` from an
   * in-memory source string, with no real file at all). */
  readonly filePath?: string;
  /** `--update-snapshots` (M4b, D15) — writes/overwrites baselines instead of just comparing
   * against them. Defaults to `false` (compare-only), same as every prior milestone's behavior. */
  readonly updateSnapshots?: boolean;
}

export interface RunOutput {
  readonly report: RunReport;
  readonly redactor: Redactor;
}

export async function runProgram(program: Program, config: ResolvedConfig, opts: RunOptions): Promise<RunOutput> {
  // Ref-counted (tls.ts): safe even when several files share this same `insecure` config and run
  // concurrently under `--workers N>1` — only the first acquire sets it, only the last release
  // restores it, so one file finishing early can never silently re-enable verification for another
  // file still mid-run (decision 78).
  if (config.insecure) acquireInsecureTls();
  try {
    return await runProgramInner(program, config, opts);
  } finally {
    if (config.insecure) releaseInsecureTls();
  }
}

async function runProgramInner(program: Program, config: ResolvedConfig, opts: RunOptions): Promise<RunOutput> {
  const environ = opts.environ ?? process.env;
  const redactor = opts.redactor ?? new Redactor();
  // Pre-register every `require env` variable up front (decision 56, half 1) — closes most of the
  // redaction ordering window before it can open: previously a secret was only registered the
  // first time its `env(NAME)` was *evaluated*, so a secret first read late in a run wouldn't mask
  // an earlier step whose trace already contained that value. The other half is the final
  // full-report redaction pass this function does just before returning, below.
  for (const name of config.requiredEnv) {
    const value = environ[name];
    if (value !== undefined) redactor.register(name, value);
  }
  const emit = opts.emit ?? (() => {});
  const baseDir = opts.baseDir ?? process.cwd();
  const lines = opts.source.split('\n');
  const startedAt = new Date().toISOString();
  const runStart = performance.now();
  const runSeed = resolveRunSeed(opts.seed);
  const runClock = resolveRunClock(opts.now);
  const uniqueSeq = opts.uniqueSeq ?? makeUniqueSeq();
  const testIndexOffset = opts.testIndexOffset ?? 0;
  const sessionCache = opts.sessionCache ?? new SessionCache();
  const filePath = opts.filePath ?? 'inline';
  const updateSnapshots = opts.updateSnapshots ?? false;
  const registry = await buildRegistry(program, baseDir);
  const beforeFile = program.hooks.filter((h) => h.scope === 'file' && h.when === 'before');
  const afterFile = program.hooks.filter((h) => h.scope === 'file' && h.when === 'after');
  const beforeEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'before');
  const afterEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'after');
  const cases = await expandTestCases(program, baseDir);

  emit({ type: 'run:start', total: cases.length, env: config.envName });

  const results: TestResult[] = [];
  const fileTc: TestCtx = { environ, redactor, emit, lines, baseDir, rng: mulberry32(runSeed), runSeed, runClock, uniqueSeq, sessionCache, browserManager: opts.browserManager, filePath, updateSnapshots };
  const beforeFileOk = await runFileHooks(beforeFile, 'before file', config, fileTc, registry, results, emit);

  if (beforeFileOk) {
    for (const [i, kase] of cases.entries()) {
      const globalIndex = testIndexOffset + i;
      const testSeed = subSeed(runSeed, globalIndex);
      const tc: TestCtx = { environ, redactor, emit, lines, baseDir, rng: mulberry32(testSeed), runSeed, runClock, uniqueSeq, sessionCache, browserManager: opts.browserManager, filePath, updateSnapshots };
      // Per session *name*, not per test — a test opting into several sessions at once can own
      // the splice for one of them and not another, if some earlier test already claimed a name
      // it also opts into.
      const sessionOwnership: ReadonlyMap<string, boolean> | undefined = opts.sessionSpliceOwners
        ? new Map(kase.test.sessions.map((name) => [name, opts.sessionSpliceOwners!.get(name) === globalIndex] as const))
        : undefined;
      const result = await runTest(kase.test, config, tc, registry, beforeEach, afterEach, testSeed, kase.cells, sessionOwnership);
      results.push(result);
      emit({ type: 'test:end', result });
    }
    await runFileHooks(afterFile, 'after file', config, fileTc, registry, results, emit);
  }

  const passed = results.filter((r) => r.ok).length;
  const rawReport: RunReport = {
    ok: results.every((r) => r.ok),
    env: config.envName,
    startedAt,
    durationMs: Math.round(performance.now() - runStart),
    total: results.length,
    passed,
    failed: results.length - passed,
    tests: results,
    seed: runSeed,
    now: runClock.toISOString(),
    insecure: config.insecure,
    ...(opts.browserManager ? { browserEngine: opts.browserManager.engine } : {}),
  };
  // Final full-report redaction pass (decision 56, half 2): a secret registered late in this run
  // (or, when `redactor` is shared across files, by a file that ran concurrently/after this one)
  // may not have been known yet when an earlier step's trace was first redacted. Re-redacting the
  // whole report now, with the redactor in its final state, catches anything still unmasked.
  const report = redactReport(rawReport, redactor);
  emit({ type: 'run:end', report });
  return { report, redactor };
}

// ---- Load testing (M29/M30, PLAN_BROWSER_PERF_SECURITY.md §2, D16-D19/D24a/D26/D29/D30) -------
//
// A second, dedicated execution model alongside `runProgram` above (D16) — no test cases, no
// retry, no browser support (checker-enforced, `checkScenarios`/TF033); a per-VU loop around the
// same `execSteps` every `test`/`action` body already reuses. Single-process throughout — M30
// (D29) runs every `scenario` in the file concurrently rather than just the file's one allowed
// scenario (M29's restriction); multi-process scaling (M31, D19) is a later milestone layered on
// top of this without changing this shape.

export interface LoadOptions {
  /** Source text of the file, for mirroring each step's line (mirrors `RunOptions.source`). */
  readonly source: string;
  readonly baseDir?: string;
  readonly environ?: NodeJS.ProcessEnv;
  readonly seed?: number;
  readonly now?: string;
  /** Fired once per completed iteration — the CLI's live console progress (M32 formalizes a real
   * `LoadReport` live view; this is enough for a running iteration/error-rate counter). */
  readonly onIteration?: (result: LoadIterationResult) => void;
}

/** Runs every `scenario` in the file (M30/D29 — names unique, checker-enforced, `checkScenarios`/
 * TF033) as one concurrent load test: each ramps its own VUs/arrival-rate per its own workload
 * (D17), runs its body once per iteration via `execSteps` (the same engine `test`/`action` bodies
 * use, D16's reuse framing), and its `threshold`s are evaluated once against *its own*
 * accumulated metrics (D24a) — never throws for an iteration failure (D18: an `expect` inside a
 * scenario aborts *that iteration*, counted toward its error rate, never the run) — only a setup
 * failure (bad session, zero scenarios) throws. All scenarios share one process, one `uniqueSeq`,
 * and one `SessionCache` (a session named by two scenarios establishes once, reused by both —
 * same run-lifetime cache `test … as <session>` uses); each keeps its own duration/failure
 * accumulators so R6's combined-vs-per-scenario split falls out of how results are pooled at the
 * end, not out of separate runs. */
export async function runLoad(program: Program, config: ResolvedConfig, opts: LoadOptions): Promise<LoadReport> {
  if (program.scenarios.length === 0) {
    throw new RuntimeError('`tflw load` needs at least one `scenario` in this file, found 0');
  }
  const scenarios = program.scenarios;
  const environ = opts.environ ?? process.env;
  const redactor = new Redactor();
  for (const name of config.requiredEnv) {
    const value = environ[name];
    if (value !== undefined) redactor.register(name, value);
  }
  const baseDir = opts.baseDir ?? process.cwd();
  const lines = opts.source.split('\n');
  const runSeed = resolveRunSeed(opts.seed);
  const runClock = resolveRunClock(opts.now);
  const uniqueSeq = makeUniqueSeq();
  const sessionCache = new SessionCache();
  const registry = await buildRegistry(program, baseDir);
  const beforeEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'before');
  const afterEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'after');
  const tc: TestCtx = { environ, redactor, emit: () => {}, lines, baseDir, rng: mulberry32(runSeed), runSeed, runClock, uniqueSeq, sessionCache, filePath: baseDir, updateSnapshots: false };

  const startedAt = new Date().toISOString();
  const runStart = performance.now();
  // Shared across every scenario's VUs so each iteration still gets its own reproducible sub-seed
  // (P#23) regardless of which scenario spawned it — mirrors the single-scenario counter M29 used.
  let iterationIndex = 0;

  // One mutable accumulator per scenario, filled in by that scenario's own `runIteration` closure
  // (below) as its VUs run concurrently with every other scenario's, and read back into a
  // `LoadScenarioReport` only once every scenario's task has finished.
  interface ScenarioAccumulator {
    readonly scenario: ScenarioDecl;
    readonly durationsMs: number[];
    failures: number;
  }
  const accumulators: ScenarioAccumulator[] = scenarios.map((scenario) => ({ scenario, durationsMs: [], failures: 0 }));
  const combinedDurationsMs: number[] = [];
  let combinedFailures = 0;

  // Each scenario's own session establishment + VU scheduling runs as one independent async task
  // (`sessionCache` is safe under concurrent `ensure()` calls — it dedupes in-flight promises by
  // name, so two scenarios opting into the same session never race a duplicate login). Scheduling
  // an *open*-workload scenario's arrivals genuinely blocks its own task on real-time sleeps
  // (below) — that must never block a *different* scenario's task, or two `scenario`s in one file
  // wouldn't actually overlap in wall time, defeating D29's entire point.
  const scenarioTasks = accumulators.map(async (acc) => {
    const scenario = acc.scenario;
    // Sessions establish once per scenario, before its VU loop starts — never per iteration (same
    // run-lifetime cache `test … as <session>` uses, SPEC §3.3) — and their headers/cookies seed
    // every iteration's own starting state (cloned per iteration below so concurrent VUs, even
    // across different scenarios, can never race on one shared cookie jar).
    const baseSessionHeaders: Record<string, string> = {};
    const baseCookieJar = new CookieJar();
    for (const sessionName of scenario.sessions) {
      const decl = config.sessions.get(sessionName);
      if (!decl) throw new RuntimeError(`unknown session "${sessionName}" — is it declared in tflw.config?`);
      const outcome = await sessionCache.ensure(sessionName, decl, config, tc, true);
      if (!outcome.ok) throw new RuntimeError(`session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`);
      Object.assign(baseSessionHeaders, outcome.headers);
      baseCookieJar.mergeFrom(outcome.cookieJar.clone());
    }

    const runIteration = async (): Promise<void> => {
      const index = iterationIndex++;
      const iterTc: TestCtx = { ...tc, rng: mulberry32(subSeed(runSeed, index)) };
      const scope = new Map<string, unknown>();
      const ctx: EvalCtx = {
        scope,
        environ,
        redactor,
        rng: iterTc.rng,
        runSeed,
        runClock,
        uniqueSeq,
        sessionHeaders: { ...baseSessionHeaders },
        sessionNames: scenario.sessions,
        cookieJar: baseCookieJar.clone(),
      };
      const iterStart = performance.now();
      let result: LoadIterationResult;
      try {
        for (const hook of beforeEach) {
          const exec = await execSteps(hook.body, config, ctx, iterTc, scenario.name.value, registry);
          if (!exec.ok) throw new RuntimeError(exec.error ?? 'a `before` hook failed');
        }
        const exec = await execSteps(scenario.body, config, ctx, iterTc, scenario.name.value, registry);
        if (!exec.ok) throw new RuntimeError(exec.error ?? 'a step failed');
        // D26: `after each` is skipped by default per iteration under load (running it every
        // iteration would double request volume and pollute the very latency metrics this run
        // exists to measure) — `cleanup` (ast.ts) opts a scenario back into it.
        if (scenario.cleanup) {
          for (const hook of afterEach) {
            const afterExec = await execSteps(hook.body, config, ctx, iterTc, scenario.name.value, registry);
            if (!afterExec.ok) throw new RuntimeError(afterExec.error ?? 'an `after` hook failed');
          }
        }
        const thinkMs = exec.steps.filter((s) => s.kind === 'think').reduce((sum, s) => sum + s.durationMs, 0);
        result = { ok: true, scenario: scenario.name.value, durationMs: Math.max(0, Math.round(performance.now() - iterStart - thinkMs)) };
      } catch (err) {
        const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
        // Think time isn't tracked on the thrown-error path (no `exec.steps` to inspect) — a
        // negligible skew: a failure that happens after a `think` still counts that pacing time as
        // part of its own (already-failing, already-excluded-from-percentiles-by-nobody-caring)
        // duration. Only successful iterations feed the duration percentiles that thresholds read.
        result = { ok: false, scenario: scenario.name.value, durationMs: Math.round(performance.now() - iterStart), error: redactor.redact(message) };
      }
      if (!result.ok) {
        acc.failures++;
        combinedFailures++;
      }
      acc.durationsMs.push(result.durationMs);
      combinedDurationsMs.push(result.durationMs);
      opts.onIteration?.(result);
    };

    const vuPromises: Promise<void>[] = [];
    if (scenario.workload.type === 'RampUsersWorkload') {
      // Closed model (D17): VUs loop continuously once spawned. `users` VUs ramp in linearly over
      // `overMs`; the scenario itself lasts exactly `overMs` (no separate "hold" stage in the
      // grammar).
      const { users, overMs } = scenario.workload;
      const runEnd = runStart + overMs;
      for (let i = 0; i < users; i++) {
        const spawnAt = runStart + (i / users) * overMs;
        vuPromises.push(
          (async () => {
            const waitMs = spawnAt - performance.now();
            if (waitMs > 0) await sleep(waitMs);
            while (performance.now() < runEnd) await runIteration();
          })(),
        );
      }
    } else {
      // Open model (D17): arrivals are scheduled at a target rate that itself ramps linearly from
      // 0 to `rps` over `overMs`, independent of whether earlier iterations have finished — the
      // schedule never waits on completion, so queueing under saturation is real, not smoothed
      // away. Cumulative arrivals by time t (seconds) under a linear ramp: N(t) = rps·t²/(2·overS);
      // solving for the k-th arrival's time inverts that: t_k = √(2k·overS / rps).
      const { rps, overMs } = scenario.workload;
      const overS = overMs / 1000;
      const totalArrivals = Math.floor((rps * overS) / 2);
      for (let k = 1; k <= totalArrivals; k++) {
        const scheduledMs = Math.sqrt((2 * k * overS) / rps) * 1000;
        const waitMs = runStart + scheduledMs - performance.now();
        if (waitMs > 0) await sleep(waitMs);
        // Fire-and-forget: the arrival schedule doesn't wait on this iteration's completion
        // (that's the whole point of "open") — its promise is still collected so this scenario's
        // own task (and, transitively, `runLoad`) waits for every fired iteration.
        vuPromises.push(runIteration());
      }
    }

    await Promise.all(vuPromises);
  });

  await Promise.all(scenarioTasks);

  const scenarioReports: LoadScenarioReport[] = accumulators.map(({ scenario, durationsMs, failures }) => {
    const sorted = [...durationsMs].sort((a, b) => a - b);
    const metrics: LoadMetrics = {
      iterations: durationsMs.length,
      failures,
      errorRate: durationsMs.length > 0 ? failures / durationsMs.length : 0,
      durations: summarizeDurations(sorted),
    };
    const thresholdResults = evaluateThresholds(scenario.thresholds, metrics, sorted);
    const workload: LoadScenarioReport['workload'] =
      scenario.workload.type === 'RampUsersWorkload'
        ? { kind: 'users', target: scenario.workload.users, overMs: scenario.workload.overMs }
        : { kind: 'rps', target: scenario.workload.rps, overMs: scenario.workload.overMs };
    return { name: scenario.name.value, workload, metrics, thresholds: thresholdResults, ok: thresholdResults.every((t) => t.ok) };
  });

  const combinedSorted = [...combinedDurationsMs].sort((a, b) => a - b);
  const combined: LoadMetrics = {
    iterations: combinedDurationsMs.length,
    failures: combinedFailures,
    errorRate: combinedDurationsMs.length > 0 ? combinedFailures / combinedDurationsMs.length : 0,
    durations: summarizeDurations(combinedSorted),
  };

  return {
    ok: scenarioReports.every((s) => s.ok),
    scenarios: scenarioReports,
    combined,
    startedAt,
    durationMs: Math.round(performance.now() - runStart),
    seed: runSeed,
    now: runClock.toISOString(),
  };
}

/** Sorted ascending. Nearest-rank percentile (same simple method every other load tool starts
 * with) — M31's multi-process histogram merge (R4) is where this gets replaced by an HDR
 * histogram; single-process M29 just sorts the raw array. */
function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function summarizeDurations(sorted: readonly number[]): LoadDurationStats {
  if (sorted.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    p50: percentileOf(sorted, 50),
    p90: percentileOf(sorted, 90),
    p95: percentileOf(sorted, 95),
    p99: percentileOf(sorted, 99),
  };
}

function evaluateThresholds(thresholds: readonly ThresholdDecl[], metrics: LoadMetrics, sortedDurations: readonly number[]): LoadThresholdResult[] {
  return thresholds.map((t) => {
    const actual = t.metric.kind === 'errorRate' ? metrics.errorRate : percentileOf(sortedDurations, t.metric.percentile);
    const label = t.metric.kind === 'errorRate' ? 'error rate' : `p${t.metric.percentile} duration`;
    const ok = t.op === 'lessThan' ? actual < t.value : actual > t.value;
    return { label, op: t.op, target: t.value, actual, ok };
  });
}

export function makeUniqueSeq(): { next(): number } {
  let n = 0;
  return { next: () => n++ };
}

/** One reportable case: a plain `TestDecl` runs once (`cells: null`); a `with each` test expands
 * into one case per row, each carrying that row's (unevaluated, for inline tables) cell bindings
 * (SPEC §4.3). */
interface TestCase {
  readonly test: TestDecl;
  readonly cells: readonly RowCell[] | null;
}

/**
 * How many reportable cases `runProgram` will produce for this program (after `with each` row
 * expansion), without running anything. The CLI uses this to precompute each file's per-test
 * sub-seed offset *before* running — required so `--seed` replay is identical at any worker
 * concurrency (P#47): offsets can no longer be accumulated sequentially from each file's actual
 * `report.total` once files run in parallel.
 */
export async function countTestCases(program: Program, baseDir: string): Promise<number> {
  return (await expandTestCases(program, baseDir)).length;
}

/**
 * For every expanded case in this file that opts into a `session` (`as <name>[, <name>...]`), one
 * entry per session name it opts into (a case opting into several independent sessions at once
 * contributes one entry per name, same local index each time) — its local index (0-based, within
 * *this* program's cases only) and the session name. The CLI combines this with each file's
 * precomputed test-index offset to compute a *global* index per case, then — across every file —
 * picks the smallest global index per session name as that session's deterministic splice-owner
 * (decision 53), before any file actually runs.
 */
export async function findSessionUsages(program: Program, baseDir: string): Promise<readonly { readonly session: string; readonly localIndex: number }[]> {
  const cases = await expandTestCases(program, baseDir);
  const usages: { session: string; localIndex: number }[] = [];
  cases.forEach((kase, localIndex) => {
    for (const session of kase.test.sessions) usages.push({ session, localIndex });
  });
  return usages;
}

async function expandTestCases(program: Program, baseDir: string): Promise<TestCase[]> {
  const cases: TestCase[] = [];
  for (const test of program.tests) {
    if (!test.table) {
      cases.push({ test, cells: null });
      continue;
    }
    const rows = await loadTableRows(test.table, baseDir);
    for (const cells of rows) cases.push({ test, cells });
  }
  return cases;
}

/** Resolve this file's own `action`s + every `import`ed file's `action`s, and load every `use`d
 * JS/TS helper module (P#11, P#17). Duplicate action/export names are a hard error — actions are
 * file-scoped by design, and a silent last-one-wins would be a confusing way to find that out. */
async function buildRegistry(program: Program, baseDir: string): Promise<CallRegistry> {
  const actions = new Map<string, ActionDecl>();
  const addAction = (a: ActionDecl, from: string): void => {
    if (actions.has(a.name)) throw new RuntimeError(`duplicate action "${a.name}"${from ? ` (imported from "${from}")` : ''} — actions are file-scoped; rename one`);
    actions.set(a.name, a);
  };
  for (const a of program.actions) addAction(a, '');
  for (const imp of program.imports) {
    const abs = resolvePath(baseDir, imp.path.value);
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch (err) {
      throw new RuntimeError(`could not read imported file "${imp.path.value}" (resolved ${abs}): ${(err as Error).message}`);
    }
    const parsed = parseSource(text);
    if (parsed.diagnostics.length > 0) {
      throw new RuntimeError(`imported file "${imp.path.value}" has parse errors:\n${renderDiagnostics(parsed.diagnostics, text, { filename: imp.path.value })}`);
    }
    for (const a of parsed.program.actions) addAction(a, imp.path.value);
  }

  const helpers = new Map<string, HelperFn>();
  for (const u of program.uses) {
    const abs = resolvePath(baseDir, u.path.value);
    let mod: Record<string, unknown>;
    try {
      mod = await loadHelperModule(abs);
    } catch (err) {
      throw new RuntimeError(`could not load JS helper module "${u.path.value}" (resolved ${abs}): ${(err as Error).message}`);
    }
    for (const [exportName, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function') continue;
      if (helpers.has(exportName)) throw new RuntimeError(`duplicate JS helper export "${exportName}" (from "${u.path.value}")`);
      helpers.set(exportName, fn as HelperFn);
    }
  }
  return { actions, helpers };
}

interface TestCtx {
  readonly environ: NodeJS.ProcessEnv;
  readonly redactor: Redactor;
  readonly emit: EventSink;
  readonly lines: readonly string[];
  readonly baseDir: string;
  readonly rng: () => number;
  readonly runSeed: number;
  readonly runClock: Date;
  readonly uniqueSeq: { next(): number };
  readonly sessionCache: SessionCache;
  readonly browserManager?: BrowserManager;
  /** M4b, D15 — see `RunOptions.filePath`/`updateSnapshots`. */
  readonly filePath: string;
  readonly updateSnapshots: boolean;
}

interface SessionOutcome {
  /** Headers this session's `header` steps captured, already evaluated + stringified. */
  readonly headers: Readonly<Record<string, string>>;
  /** Cookies accumulated from every response this session's own steps saw (SPEC §3.3, P#33) — a
   * *clone* is handed to each test opting in via `as <session>`, never this live instance
   * (`runTestAttempt` clones it), so a test's own subsequent cookie updates can never leak back
   * into this shared, run-lifetime-cached jar. */
  readonly cookieJar: CookieJar;
  readonly ok: boolean;
  readonly error?: string;
  readonly steps: readonly StepResult[];
  /** Epoch ms after which this outcome is stale and must be re-established (decision 3a/3c,
   * enterprise arc) — set from an `oauth2` session's `expires_in`, undefined for a hand-written
   * session (which has no built-in expiry concept; it still gets *reactive* refresh-on-401). */
  readonly expiresAt?: number;
}

/**
 * Runs each `session` block's steps at most once for the lifetime of the cache — shared across
 * every file in a run (SPEC §3.3, P#42: "once per run per worker; results are cached"). One test
 * opting in via `as <session>` gets the session's own steps spliced into its report (same pattern
 * as an action call, P#17); every other user of the same session gets the cached headers silently,
 * without re-showing steps that already ran.
 */
export class SessionCache {
  private readonly promises = new Map<string, Promise<SessionOutcome>>();
  private readonly shown = new Set<string>();

  /**
   * `isOwner` is the caller's resolved answer to "does *this* attempt's report get the session's
   * steps spliced in" — the CLI precomputes it deterministically up front across every file, in
   * sorted-file/declaration order, so it doesn't depend on a `--workers N>1` race to be the first
   * caller (decision 53). Single-`runProgram`-call callers (test helpers) that don't precompute it
   * resolve it via `claimShown` instead — but always *once per test*, not once per retry attempt
   * (decision 68): resolving it fresh on every `ensure()` call meant a retried test's first attempt
   * (discarded once the report keeps only the last attempt, SPEC §4.4) claimed the one-time "shown"
   * slot, leaving the attempt that actually survives into the report with `steps: []` — headers
   * took effect with zero evidence a login ever happened.
   */
  async ensure(name: string, decl: SessionDecl, config: ResolvedConfig, tc: TestCtx, isOwner: boolean): Promise<SessionOutcome> {
    let p = this.promises.get(name);
    if (p) {
      // A TTL'd outcome (from an `oauth2` session's `expires_in`, decision 3c) past its expiry is
      // treated exactly like a cache miss — re-run it, same as decision 54's failed-establishment
      // eviction below. Guarded by identity so a concurrent caller's fresher promise is never
      // clobbered by this one discovering staleness after the fact.
      const cached = await p;
      if (cached.ok && cached.expiresAt !== undefined && Date.now() >= cached.expiresAt && this.promises.get(name) === p) {
        this.promises.delete(name);
        p = undefined;
      }
    }
    if (!p) {
      p = runSession(decl, config, tc);
      this.promises.set(name, p);
    }
    const outcome = await p;
    // Only a *successful* establishment is cached (decision 54): a transient auth blip must not
    // permanently fail every `as <session>` test for the rest of the run, and — critically — must
    // not stop `retry N` from ever re-establishing it, since retry attempts share this same cache.
    // Guarded by identity (`this.promises.get(name) === p`) so we never clobber a newer attempt
    // that another caller may have already installed while this one was in flight.
    if (!outcome.ok && this.promises.get(name) === p) this.promises.delete(name);
    return isOwner ? outcome : { ...outcome, steps: [] };
  }

  /** Force the next `ensure()` call for this session name to re-run `runSession`, regardless of
   * TTL (decision 3a, enterprise arc) — used when an api step gets a 401 while using this
   * session's cached headers, so a revoked/expired-early credential doesn't silently keep failing
   * for the rest of the run. Guarded by identity isn't needed here (unlike the two internal evict
   * sites above): invalidating a session that's already been superseded by a fresher promise is a
   * safe no-op, not a lost update, since we always evict by name, never overwrite by identity. */
  invalidate(name: string): void {
    this.promises.delete(name);
  }

  /** First-caller-wins claim of "shown" status for a session name, resolved once per test (not
   * per retry attempt) by callers that don't get a precomputed splice-owner from the CLI. */
  claimShown(name: string): boolean {
    if (this.shown.has(name)) return false;
    this.shown.add(name);
    return true;
  }
}

/** A session has no file scope of its own (it's declared in `tflw.config`, not a `.tflw` file), so
 * it runs with an empty call registry — no `action`/`use` calls inside a session body in v1. Its
 * `random`-family generators are seeded from the session's own name (not `tc.rng`, which belongs
 * to whichever test's `TestCtx` happened to win the race to establish the session first under
 * `--workers N>1`) so the values a session's steps generate are deterministic regardless of that
 * race (decision 53); `unique(...)`'s run-wide counter stays as-is — it was never seed-reproducible
 * by design (§7.4). */
async function runSession(decl: SessionDecl, config: ResolvedConfig, tc: TestCtx): Promise<SessionOutcome> {
  if (decl.oauth2) return runOauth2Session(decl.name, decl.oauth2, config, tc);
  const headerSink: Record<string, string> = {};
  const scope = new Map<string, unknown>();
  const sessionRng = mulberry32(subSeed(tc.runSeed, hashString(decl.name)));
  const cookieJar = new CookieJar();
  const ctx: EvalCtx = { scope, environ: tc.environ, redactor: tc.redactor, rng: sessionRng, runSeed: tc.runSeed, runClock: tc.runClock, uniqueSeq: tc.uniqueSeq, sessionHeaders: {}, sessionNames: [], headerSink, cookieJar };
  const emptyRegistry: CallRegistry = { actions: new Map(), helpers: new Map() };
  const exec = await execSteps(decl.body, config, ctx, tc, `session ${decl.name}`, emptyRegistry);
  return { headers: headerSink, cookieJar, ok: exec.ok, ...(exec.error ? { error: exec.error } : {}), steps: exec.steps };
}

/** `session <name> oauth2 ...` — POSTs the client-credentials grant to `tokenUrl` and turns the
 * response into the same shape a hand-written session produces: an `Authorization: Bearer`
 * header, plus (when the server sends `expires_in`) a TTL for the cache (SPEC §3.3, decision 3c,
 * enterprise arc). Reuses `sendRequest`/`mkStep`/`redactRequest`/`redactResponse` so the token
 * request shows up in the report exactly like an ordinary `api` step would, secret-redacted the
 * same way — no separate, invisible auth path (P#5's reporting-first ethos). */
async function runOauth2Session(name: string, oauth2: Oauth2SessionConfig, config: ResolvedConfig, tc: TestCtx): Promise<SessionOutcome> {
  const scope = new Map<string, unknown>();
  const sessionRng = mulberry32(subSeed(tc.runSeed, hashString(name)));
  const cookieJar = new CookieJar();
  const ctx: EvalCtx = { scope, environ: tc.environ, redactor: tc.redactor, rng: sessionRng, runSeed: tc.runSeed, runClock: tc.runClock, uniqueSeq: tc.uniqueSeq, sessionHeaders: {}, sessionNames: [], cookieJar };
  const start = performance.now();
  const src = (tc.lines[oauth2.span.start.line - 1] ?? '').trim();

  const fail = (error: string, request?: RequestTrace, response?: ResponseTrace): SessionOutcome => ({
    headers: {},
    cookieJar,
    ok: false,
    error,
    steps: [mkStep('api', src, oauth2.span, false, start, error, request, response)],
  });

  const tokenUrl = String(evalValue(oauth2.tokenUrl, ctx));
  const clientId = String(evalValue(oauth2.clientId, ctx));
  const clientSecret = String(evalValue(oauth2.clientSecret, ctx));
  const scopeValue = oauth2.scope ? String(evalValue(oauth2.scope, ctx)) : undefined;
  const params = new URLSearchParams();
  params.set('grant_type', 'client_credentials');
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (scopeValue !== undefined) params.set('scope', scopeValue);
  const body = params.toString();
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  const request: RequestTrace = { method: 'POST', url: tokenUrl, headers, body };

  let response: ResponseTrace;
  try {
    checkHostAllowed(tokenUrl, config);
    response = await sendRequest({ method: 'POST', url: tokenUrl, headers, body, timeoutMs: config.timeouts.step, followRedirects: true });
  } catch (err) {
    const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
    return fail(tc.redactor.redact(message), redactRequest(request, tc.redactor, config));
  }
  const redactedRequest = redactRequest(request, tc.redactor, config);
  const redactedResponse = redactResponse(response, tc.redactor, config);
  if (response.status < 200 || response.status >= 300) {
    return fail(`oauth2 token request failed: ${response.status} ${response.statusText}`, redactedRequest, redactedResponse);
  }
  const json = response.json as Record<string, unknown> | undefined;
  const accessToken = json && typeof json.access_token === 'string' ? json.access_token : undefined;
  if (!accessToken) {
    return fail('oauth2 token response has no string `access_token` field', redactedRequest, redactedResponse);
  }
  const expiresIn = json && typeof json.expires_in === 'number' ? json.expires_in : undefined;
  // Refresh a little before the token actually expires (2s, or half the TTL for a very
  // short-lived one) so a request that starts just under the wire doesn't land mid-flight on an
  // already-expired token.
  const expiresAt = expiresIn !== undefined ? Date.now() + Math.max(0, expiresIn * 1000 - Math.min(2000, expiresIn * 500)) : undefined;
  const detail = `oauth2 token request → ${response.status} (${response.durationMs}ms)`;
  return {
    headers: { Authorization: `Bearer ${accessToken}` },
    cookieJar,
    ok: true,
    steps: [mkStep('api', src, oauth2.span, true, start, detail, redactedRequest, redactedResponse)],
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

interface SessionRefreshResult {
  readonly ok: boolean;
  readonly steps: readonly StepResult[];
}

/** Invalidate + re-establish every named session, in declared order, folding fresh
 * headers/cookies into `ctx` in place (SPEC §3.3, decision 3a, enterprise arc). Safe to mutate:
 * `ctx.sessionHeaders`/`ctx.cookieJar` are fresh objects built once per test attempt
 * (`runTestAttempt`), never the session cache's own — mutating them here can't leak into a
 * concurrently-running sibling test or the shared cache. Stops at the first session that fails to
 * re-establish, returning `ok: false` so the caller doesn't retry the api step against headers
 * that are still stale or absent; either way, a synthetic step records what happened so a 401
 * retry is visible evidence in the report, never a silent, invisible extra round-trip (P#5/P#16). */
async function refreshSessions(
  ctx: EvalCtx,
  names: readonly string[],
  config: ResolvedConfig,
  tc: TestCtx,
  src: string,
  span: Span,
): Promise<SessionRefreshResult> {
  const steps: StepResult[] = [];
  for (const name of names) {
    const start = performance.now();
    const decl = config.sessions.get(name);
    if (!decl) {
      steps.push(mkStep('header', src, span, false, start, `401 response → can't re-establish unknown session "${name}"`));
      return { ok: false, steps };
    }
    tc.sessionCache.invalidate(name);
    const outcome = await tc.sessionCache.ensure(name, decl, config, tc, false);
    if (!outcome.ok) {
      steps.push(mkStep('header', src, span, false, start, `401 response → re-establishing session "${name}" failed: ${outcome.error ?? 'a step failed'}`));
      return { ok: false, steps };
    }
    Object.assign(ctx.sessionHeaders as Record<string, string>, outcome.headers);
    ctx.cookieJar.mergeFrom(outcome.cookieJar.clone());
    steps.push(mkStep('header', src, span, true, start, `401 response → session "${name}" re-established, retrying`));
  }
  return { ok: true, steps };
}

/** Run `before file`/`after file` hooks (own scope, isolated from any test), in declaration
 * order. A failure aborts — for `before file`, the tests never run at all (nothing was set up);
 * either way the failure surfaces as its own synthetic `TestResult` (P#16: never swallowed). */
async function runFileHooks(
  hooks: readonly HookDecl[],
  label: 'before file' | 'after file',
  config: ResolvedConfig,
  tc: TestCtx,
  registry: CallRegistry,
  results: TestResult[],
  emit: EventSink,
): Promise<boolean> {
  if (hooks.length === 0) return true;
  const scope = new Map<string, unknown>();
  const ctx: EvalCtx = { scope, environ: tc.environ, redactor: tc.redactor, rng: tc.rng, runSeed: tc.runSeed, runClock: tc.runClock, uniqueSeq: tc.uniqueSeq, sessionHeaders: {}, sessionNames: [], cookieJar: new CookieJar() };
  const start = performance.now();
  emit({ type: 'test:start', name: label });
  for (const hook of hooks) {
    const exec = await execSteps(hook.body, config, ctx, tc, label, registry);
    if (!exec.ok) {
      const result: TestResult = { name: label, ok: false, durationMs: Math.round(performance.now() - start), steps: exec.steps, error: exec.error ?? `a \`${label}\` hook failed` };
      results.push(result);
      emit({ type: 'test:end', result });
      return false;
    }
  }
  return true;
}

/** Runs a test, retrying up to `test.retry` more times on failure (SPEC §4.4, P#10). Every
 * attempt gets a fresh scope but the *same* seed (re-derived from `testSeed` each time) — an
 * identical draw of generated values on every attempt is what makes a real environmental flake
 * distinguishable from data-dependent behavior. A pass on any attempt after the first is reported
 * `flaky: true`, never silently green; `durationMs` covers every attempt actually run. */
async function runTest(
  test: TestDecl,
  config: ResolvedConfig,
  tc: TestCtx,
  registry: CallRegistry,
  beforeEach: readonly HookDecl[],
  afterEach: readonly HookDecl[],
  testSeed: number,
  cells: readonly RowCell[] | null,
  sessionOwnership: ReadonlyMap<string, boolean> | undefined,
): Promise<TestResult> {
  // Resolve session ownership once for the whole test, not once per retry attempt (decision 68) —
  // otherwise a fresh `claimShown` call on every attempt hands the one-time "shown" slot to
  // whichever attempt happens to call `ensure()` first, which is never guaranteed to be the last
  // (kept) attempt once retries are in play. Resolved per session *name*: a precomputed answer
  // (from the CLI's up-front, sorted-file-order pass) is used verbatim; anything not precomputed
  // (a single-`runProgram`-call caller, e.g. a test helper) falls back to `claimShown` per name.
  const resolvedSessionOwnership = new Map<string, boolean>(
    test.sessions.map((name) => [name, sessionOwnership?.get(name) ?? tc.sessionCache.claimShown(name)] as const),
  );
  const maxAttempts = 1 + Math.max(0, test.retry);
  const runStart = performance.now();
  const attemptResults: AttemptResult[] = [];
  let attempts = 0;
  let result: TestResult;
  for (;;) {
    attempts++;
    const attemptTc: TestCtx = { ...tc, rng: mulberry32(testSeed) };
    result = await runTestAttempt(test, config, attemptTc, registry, beforeEach, afterEach, cells, attempts === 1, resolvedSessionOwnership);
    attemptResults.push({
      attempt: attempts,
      ok: result.ok,
      durationMs: result.durationMs,
      steps: result.steps,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.trace !== undefined ? { trace: result.trace } : {}),
    });
    if (result.ok || attempts >= maxAttempts) break;
  }
  const durationMs = Math.round(performance.now() - runStart);
  const flaky = result.ok && attempts > 1;
  return {
    ...result,
    durationMs,
    ...(flaky ? { flaky: true } : {}),
    ...(attemptResults.length > 1 ? { attempts: attemptResults } : {}),
  };
}

async function runTestAttempt(
  test: TestDecl,
  config: ResolvedConfig,
  tc: TestCtx,
  registry: CallRegistry,
  beforeEach: readonly HookDecl[],
  afterEach: readonly HookDecl[],
  cells: readonly RowCell[] | null,
  isFirstAttempt: boolean,
  sessionOwnership: ReadonlyMap<string, boolean> | undefined,
): Promise<TestResult> {
  const scope = new Map<string, unknown>();
  const nameCtx: EvalCtx = { scope, environ: tc.environ, redactor: tc.redactor, rng: tc.rng, runSeed: tc.runSeed, runClock: tc.runClock, uniqueSeq: tc.uniqueSeq, sessionHeaders: {}, sessionNames: [], cookieJar: new CookieJar() };
  const testStart = performance.now();
  const steps: StepResult[] = [];

  let name: string;
  try {
    if (cells) for (const cell of cells) scope.set(cell.name, 'expr' in cell ? evalValue(cell.expr!, nameCtx) : cell.value);
    name = evalValue(test.name, nameCtx) as string;
  } catch (err) {
    const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
    const redacted = tc.redactor.redact(message);
    if (isFirstAttempt) tc.emit({ type: 'test:start', name: test.name.value });
    return { name: test.name.value, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error: redacted };
  }
  if (isFirstAttempt) tc.emit({ type: 'test:start', name });

  // Fresh browser context+page per test *attempt* (M3a, D13 — a retried test gets a clean slate,
  // never a failed attempt's leftover UI state). Cheap to create even for an API-only test: no
  // real browser process/page exists until a browser step actually calls `ensurePage()`. Ended via
  // `finish()` below on every exit path, including every early `return` already in this function
  // (session failure, `before` hook failure, …) — the `finally`'s plain `close()` is only a
  // defensive fallback for the (never-expected) case that something threw before `finish()` ran;
  // `close()` is a no-op once `finish()` already cleared `context` (both methods idempotent).
  const browserPageState = tc.browserManager ? new BrowserPageState() : undefined;
  try {
    const result = await runTestAttemptBody(test, config, tc, registry, beforeEach, afterEach, sessionOwnership, name, nameCtx, testStart, steps, browserPageState);
    if (!browserPageState) return result;
    // Trace on failure and on every retry attempt (M3c, D12) — a clean, single-attempt pass never
    // captures one; a retry attempt does even if it ultimately passes (the flaky path is exactly
    // the evidence worth keeping).
    const trace = await browserPageState.finish(!isFirstAttempt || !result.ok);
    return trace ? { ...result, trace } : result;
  } finally {
    if (browserPageState) await browserPageState.close();
  }
}

async function runTestAttemptBody(
  test: TestDecl,
  config: ResolvedConfig,
  tc: TestCtx,
  registry: CallRegistry,
  beforeEach: readonly HookDecl[],
  afterEach: readonly HookDecl[],
  sessionOwnership: ReadonlyMap<string, boolean> | undefined,
  name: string,
  nameCtx: EvalCtx,
  testStart: number,
  steps: StepResult[],
  browserPageState: BrowserPageState | undefined,
): Promise<TestResult> {
  // Several independent, unrelated sessions can be opted into at once (`as admin, userA`) — each
  // one's headers/cookies fold into this test's starting state in declared order, later-listed
  // session winning any header/cookie-name conflict against an earlier one (same "later source
  // replaces" rule the whole precedence chain already follows, SPEC §3.3). In practice this rarely
  // collides at all: different sessions are usually different auth transports (a bearer
  // `Authorization` header vs. a cookie), so "independent, unrelated" holds for the common case;
  // the rule is defined regardless, for whenever it doesn't.
  const sessionHeaders: Record<string, string> = {};
  const cookieJar = new CookieJar();
  for (const sessionName of test.sessions) {
    const decl = config.sessions.get(sessionName);
    if (!decl) {
      const error = tc.redactor.redact(`unknown session "${sessionName}" — is it declared in tflw.config?`);
      return { name, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error };
    }
    const outcome = await tc.sessionCache.ensure(sessionName, decl, config, tc, sessionOwnership?.get(sessionName) ?? false);
    steps.push(...outcome.steps);
    if (!outcome.ok) {
      const error = `session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`;
      return { name, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error };
    }
    Object.assign(sessionHeaders, outcome.headers);
    // Clone, not the live shared instance (SPEC §3.3) — this test's own subsequent cookie updates
    // must never leak back into the session cache or a concurrently-running sibling test.
    cookieJar.mergeFrom(outcome.cookieJar.clone());
  }
  const evalCtx: EvalCtx = {
    ...nameCtx,
    sessionHeaders,
    sessionNames: test.sessions,
    cookieJar,
    ...(tc.browserManager && browserPageState ? { browser: { manager: tc.browserManager, page: browserPageState, scope: null } } : {}),
  };

  for (const hook of beforeEach) {
    const exec = await execSteps(hook.body, config, evalCtx, tc, name, registry);
    steps.push(...exec.steps);
    if (!exec.ok) {
      return { name, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error: exec.error ?? 'a `before` hook failed' };
    }
  }

  const exec = await execSteps(test.body, config, evalCtx, tc, name, registry);
  steps.push(...exec.steps);
  let ok = exec.ok;
  let error = exec.error;

  for (const hook of afterEach) {
    const afterExec = await execSteps(hook.body, config, evalCtx, tc, name, registry);
    steps.push(...afterExec.steps);
    if (!afterExec.ok) {
      ok = false;
      error = error ? `${error}\n${afterExec.error ?? 'an `after` hook failed'}` : (afterExec.error ?? 'an `after` hook failed');
    }
  }

  return { name, ok, durationMs: Math.round(performance.now() - testStart), steps, ...(error ? { error } : {}) };
}

interface StepsExec {
  readonly steps: StepResult[];
  readonly ok: boolean;
  readonly error?: string;
  /** `true` only when `ok` is `false` *purely* because of accumulated soft-`check` failures (the
   * end-of-block branch below) — never for a hard `expect` failure or a thrown error, which both
   * return immediately instead. Lets `execCall` (decision 55) tell an action's soft failures apart
   * from a real one: soft failures propagate back to the caller as soft (accumulate, don't throw),
   * keeping `check`→`check` even through an action call, never silently `check`→`expect`. */
  readonly soft?: boolean;
  /** The value of this block's `give`, or undefined if it never ran one (a plain test, or an
   * action whose steps failed before reaching `give`). */
  readonly giveValue: unknown;
}

/** Execute a step sequence — a test's body, or an action's body when it's called. Actions get
 * their own scope and their own `lastResponse` (calling one never clobbers the caller's last api
 * response); their step results are still appended into the *same* report so a manual QA can see
 * exactly what an action did (P#5's reporting-first philosophy extends to composed actions). */
/** Which `ApiStep` indices should catch a connection-level error instead of letting it crash the
 * whole test (SPEC §6.2.2, PLAN decision 18) — exactly those immediately followed by a
 * contiguous run of `expect`/`check` steps containing a `request` assertion. `checkRequestAssertions`
 * (lang checker, TF031) already guarantees such a run is *only* `request` assertions, so no other
 * step's behavior anywhere in that run is affected. Computed once per `execSteps` call, not per
 * step, since it needs to look ahead of the step currently executing. */
function findRequestAssertionApiIndices(steps: readonly Step[]): ReadonlySet<number> {
  const indices = new Set<number>();
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.type !== 'ApiStep') continue;
    for (let j = i + 1; j < steps.length && steps[j]!.type === 'ExpectStmt'; j++) {
      if ((steps[j] as ExpectStmt).subject.type === 'RequestSubject') {
        indices.add(i);
        break;
      }
    }
  }
  return indices;
}

// ---- UI / browser step helpers (M3a, SPEC §9) ------------------------------

function requireBrowserCtx(ctx: EvalCtx): BrowserAttemptContext {
  if (!ctx.browser) {
    throw new RuntimeError(
      'a browser step ran but no browser support was initialized for this run (internal: `runProgram` was called without a `browserManager` — every real `tflw run` invocation supplies one; this only happens in a test harness that builds `RunOptions` by hand)',
    );
  }
  return ctx.browser;
}

async function ensurePageForStep(ctx: EvalCtx): Promise<PWPage> {
  const browser = requireBrowserCtx(ctx);
  return browser.page.ensurePage(browser.manager);
}

/** Resolves a locator for an *action* (click/fill/…) — exactly one match required, ambiguity or a
 * persistently-missing element both hard-fail (D7, `resolveLocator` in browser.ts). */
async function resolveForStep(ctx: EvalCtx, config: ResolvedConfig, locatorAst: LocatorAst): Promise<ResolvedLocator> {
  const browser = requireBrowserCtx(ctx);
  const page = await browser.page.ensurePage(browser.manager);
  const scope = browser.scope ?? page;
  return resolveLocator(scope, locatorAst, ctx, config.timeouts.step);
}

function resolveWebUrl(path: string, config: ResolvedConfig): string {
  if (!config.webBaseUrl) {
    throw new RuntimeError('no `web` base URL is configured for the active env — add `web "http://localhost:..."` to `tflw.config` (SPEC §3.1, §9.1)');
  }
  return `${config.webBaseUrl}${ensureLeadingSlash(path)}`;
}

/** `field "Email"` normally; `field "Email" (resolved via placeholder)` when the cascade (D6) had
 * to fall past its first tier — every other locator kind has only one tier, so this never fires
 * for them. */
function locatorDetail(locatorAst: LocatorAst, name: string, via: string): string {
  const base = describeLocator(locatorAst.kind, name);
  const isTier1 = locatorAst.kind !== 'field' || via === 'label';
  return isTier1 ? base : `${base} (resolved via ${via})`;
}

async function execSteps(steps: readonly Step[], config: ResolvedConfig, ctx: EvalCtx, tc: TestCtx, testName: string, registry: CallRegistry): Promise<StepsExec> {
  const results: StepResult[] = [];
  let lastResponse: ResponseTrace | null = null;
  // Set only by an `ApiStep` opted into catching a connection failure (below); read by
  // `expect`/`check request connects`/`fails` via `evaluateExpect`. Reset to null on every
  // *other* `ApiStep` (including a non-opted-in one), so it can never leak across requests.
  let lastConnectionError: string | null = null;
  let giveValue: unknown;
  const softFailures: string[] = [];
  const requestAssertionApiIndices = findRequestAssertionApiIndices(steps);

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex]!;
    const stepStart = performance.now();
    const src = (tc.lines[step.span.start.line - 1] ?? '').trim();
    try {
      let result: StepResult;
      let callSoftError: string | undefined;
      switch (step.type) {
        case 'ApiStep': {
          const catchConnectionError = requestAssertionApiIndices.has(stepIndex);
          try {
            let { trace, redacted, retryAfterAttempts, retryAfterWaitedMs } = await execApi(step, config, ctx, tc.redactor, tc.baseDir);
            // Auto re-establish on 401 (SPEC §3.3, decision 3a, enterprise arc) — any session (not
            // just `oauth2`) gets this: a revoked/expired-early credential shouldn't fail every
            // remaining step of a test that's otherwise unrelated to auth. Retried at most once per
            // step, so a server that genuinely, persistently 401s still fails fast instead of
            // looping. `ctx.sessionNames` is `[]` for an anonymous test, so this is a no-op there.
            if (trace.response.status === 401 && ctx.sessionNames.length > 0) {
              const refresh = await refreshSessions(ctx, ctx.sessionNames, config, tc, src, step.span);
              results.push(...refresh.steps);
              if (refresh.ok) {
                ({ trace, redacted, retryAfterAttempts, retryAfterWaitedMs } = await execApi(step, config, ctx, tc.redactor, tc.baseDir));
              }
            }
            lastResponse = trace.response;
            lastConnectionError = null;
            // Report visibility for retries is a standing principle here (P#5/P#16, the same one
            // `test … retry N`'s `flaky` badge already follows) — a `retry honoring` step that
            // actually retried says so right in its own report line, not just silently in the
            // final status.
            const retrySuffix = retryAfterAttempts > 0 ? `, retried ${retryAfterAttempts}x honoring Retry-After (waited ${retryAfterWaitedMs}ms total)` : '';
            result = mkStep('api', src, step.span, true, stepStart, `${step.method} ${redacted.request.url} → ${trace.response.status} (${trace.response.durationMs}ms)${retrySuffix}`, redacted.request, redacted.response);
          } catch (err) {
            // Not opted in (no `request connects`/`fails` assertion follows this request, decision
            // 18.2) — rethrow unchanged, caught by this function's own outer `catch` below exactly
            // like every request always has (P#16's unconditional fail-fast), zero behavior change
            // for the ~500 existing tests across both repos that never use this feature.
            if (!catchConnectionError) throw err;
            const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
            const redactedMessage = tc.redactor.redact(message);
            lastResponse = null;
            lastConnectionError = redactedMessage;
            // Reported `ok: true` on the `api` line itself (like every other request, whatever
            // status code it got back) — this step's job is just to attempt the request; the
            // following `expect`/`check request connects`/`fails` step is what judges the outcome.
            result = mkStep('api', src, step.span, true, stepStart, `${step.method} ${step.path.raw} → connection failed: ${redactedMessage}`);
          }
          break;
        }
        case 'ExpectStmt': {
          // `mask <locator>` (M4b, D15) only ever means something alongside `matches snapshot` —
          // syntactically legal after any matcher (parser.ts's `parseSnapshotMasks`), but a stray
          // one elsewhere is a clear authoring mistake, caught here rather than silently ignored.
          if (step.masks.length > 0 && step.matcher.name !== 'matchesSnapshot') {
            throw new RuntimeError('`mask <locator>` only applies alongside `matches snapshot "…"` (SPEC §9.9)');
          }
          // UI locator subjects (SPEC §9.4), network-observation subjects (`request to "…"`/`of
          // request to "…"`, M3d, SPEC §9.7), the `page` a11y subject (M3e, SPEC §9.8), and
          // `matches snapshot "…"` against `page`/a locator (M4b, SPEC §9.9) each get their own
          // dedicated path — the exact opposite of an API expect's evaluate-once/fail-fast (P#15)
          // — so all four are intercepted here rather than inside `execExpect`.
          const networkRef = subjectNetworkRef(step.subject);
          const isSnapshot = step.matcher.name === 'matchesSnapshot' && (step.subject.type === 'LocatorSubject' || step.subject.type === 'PageSubject');
          result = networkRef
            ? await execNetworkExpect(step, networkRef, ctx, src, stepStart, config)
            : isSnapshot
              ? await execSnapshotExpect(step, ctx, src, stepStart, config, tc, testName)
              : step.subject.type === 'LocatorSubject'
                ? await execUiExpect(step, ctx, src, stepStart, config)
                : step.subject.type === 'PageSubject'
                  ? await execA11yExpect(step, ctx, src, stepStart, config)
                  : await execExpect(step, lastResponse, lastConnectionError, ctx, src, stepStart, config, tc.baseDir);
          break;
        }
        case 'LetStmt': {
          if (step.value.type === 'CallExpr') {
            const call = await execCall(step.value, config, ctx, tc, registry, src, stepStart);
            results.push(...call.subSteps);
            ctx.scope.set(step.name, call.value);
            result = call.result;
            callSoftError = call.softError;
          } else {
            result = execLet(step, ctx, src, stepStart, tc.redactor);
          }
          break;
        }
        case 'CallStmt': {
          const call = await execCall(step.call, config, ctx, tc, registry, src, stepStart);
          results.push(...call.subSteps);
          result = call.result;
          callSoftError = call.softError;
          break;
        }
        case 'CaptureStmt': {
          result = execCapture(step, lastResponse, ctx, src, stepStart, tc.redactor, config);
          break;
        }
        case 'LogStmt': {
          result = execLog(step, ctx, src, stepStart, tc.redactor, config);
          break;
        }
        case 'WaitUntilApiStmt': {
          const waited = await execWaitUntilApi(step, config, ctx, tc.redactor, tc.baseDir, src, stepStart);
          lastResponse = waited.response;
          // `wait until api` never opts into catching a connection failure (checker-enforced,
          // decision 18) — reaching here always means a real response came back (a genuine
          // connection failure instead throws out of `execApi`, uncaught, straight to this
          // function's own outer `catch`), so any stale `lastConnectionError` from an earlier
          // opted-in `api` step must not leak into an `expect request …` step that follows this one.
          lastConnectionError = null;
          result = waited.result;
          break;
        }
        case 'GiveStmt': {
          giveValue = evalValue(step.value, ctx);
          result = mkStep('give', src, step.span, true, stepStart, tc.redactor.redact(`give ${repr(giveValue)}`));
          results.push(result);
          tc.emit({ type: 'step:end', test: testName, step: result });
          // `give` ends the block, like a return — but must not erase any soft `check` failures
          // accumulated before it (decision 55): almost every real action ends in `give`, so this
          // is the common path a soft failure has to survive, not an edge case.
          if (softFailures.length > 0) return { steps: results, ok: false, soft: true, error: softFailures.join('\n'), giveValue };
          return { steps: results, ok: true, giveValue };
        }
        case 'HeaderStmt': {
          const name = step.name.value;
          const value = stringify(evalValue(step.value, ctx));
          if (ctx.headerSink) ctx.headerSink[name] = value;
          result = mkStep('header', src, step.span, true, stepStart, tc.redactor.redact(`header "${name}" is ${JSON.stringify(value)}`));
          break;
        }
        case 'OpenStmt': {
          const page = await ensurePageForStep(ctx);
          const url = resolveWebUrl(String(evalValue(step.path, ctx)), config);
          await performOpen(page, url, config.timeouts.step);
          result = mkStep('open', src, step.span, true, stepStart, `open ${url}`);
          break;
        }
        case 'ClickStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performClick(pwLocator, step.kind, config.timeouts.step);
          const verb = step.kind === 'double' ? 'double click' : step.kind === 'right' ? 'right click' : 'click';
          result = mkStep('click', src, step.span, true, stepStart, `${verb} ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'FillStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          const value = stringify(evalValue(step.value, ctx));
          await performFill(pwLocator, value, config.timeouts.step);
          result = mkStep('fill', src, step.span, true, stepStart, tc.redactor.redact(`fill ${locatorDetail(step.locator, name, via)} with ${JSON.stringify(value)}`));
          break;
        }
        case 'FillFormStmt': {
          const details: string[] = [];
          for (const row of step.rows) {
            const fieldLocator: LocatorAst = { type: 'Locator', kind: 'field', value: row.field, span: row.span };
            const { pwLocator, via } = await resolveForStep(ctx, config, fieldLocator);
            const value = stringify(evalValue(row.value, ctx));
            await performFill(pwLocator, value, config.timeouts.step);
            details.push(`${locatorDetail(fieldLocator, row.field.value, via)} = ${JSON.stringify(value)}`);
          }
          result = mkStep('fill', src, step.span, true, stepStart, tc.redactor.redact(`fill form: ${details.join(', ')}`));
          break;
        }
        case 'SelectStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          const value = stringify(evalValue(step.value, ctx));
          await performSelect(pwLocator, value, config.timeouts.step);
          result = mkStep('select', src, step.span, true, stepStart, `select ${JSON.stringify(value)} from ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'CheckStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performCheck(pwLocator, config.timeouts.step);
          result = mkStep('checkbox', src, step.span, true, stepStart, `check ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'UncheckStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performUncheck(pwLocator, config.timeouts.step);
          result = mkStep('uncheckbox', src, step.span, true, stepStart, `uncheck ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'HoverStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performHover(pwLocator, config.timeouts.step);
          result = mkStep('hover', src, step.span, true, stepStart, `hover ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'ScrollStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performScrollIntoView(pwLocator, config.timeouts.step);
          result = mkStep('scroll', src, step.span, true, stepStart, `scroll to ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'PressStmt': {
          const keys = String(evalValue(step.keys, ctx));
          if (step.locator) {
            const name = String(evalValue(step.locator.value, ctx));
            const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
            await performPressOnLocator(pwLocator, keys, config.timeouts.step);
            result = mkStep('press', src, step.span, true, stepStart, `press ${JSON.stringify(keys)} on ${locatorDetail(step.locator, name, via)}`);
          } else {
            const page = await ensurePageForStep(ctx);
            await performPressOnPage(page, keys);
            result = mkStep('press', src, step.span, true, stepStart, `press ${JSON.stringify(keys)}`);
          }
          break;
        }
        case 'AcceptDialogStmt':
        case 'DismissDialogStmt': {
          const browser = requireBrowserCtx(ctx);
          await browser.page.ensurePage(browser.manager); // the dialog handler is wired on page creation
          const which = step.type === 'AcceptDialogStmt' ? 'accept' : 'dismiss';
          browser.page.armedDialog = which;
          result = mkStep('dialog', src, step.span, true, stepStart, `${which} the next dialog`);
          break;
        }
        case 'WithinBlock': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          const browser = requireBrowserCtx(ctx);
          // `within frame` (M3b) crosses into the iframe's own document via `contentFrame()` — a
          // `FrameLocator`, not a `Locator` — before running the nested steps; the ordinary form
          // scopes to `pwLocator` itself, same as M3a. Both are valid `LocatorScope` values.
          const scope = step.frame ? pwLocator.contentFrame() : pwLocator;
          const childCtx: EvalCtx = { ...ctx, browser: { ...browser, scope } };
          const within = await execSteps(step.body, config, childCtx, tc, testName, registry);
          results.push(...within.steps);
          const label = `within ${step.frame ? 'frame ' : ''}${locatorDetail(step.locator, name, via)}`;
          const detail = within.ok ? label : (within.error ?? 'a step inside `within` failed');
          result = mkStep('within', src, step.span, within.ok, stepStart, detail);
          if (within.soft && !within.ok) callSoftError = within.error;
          break;
        }
        case 'SwitchToNewTabBlock': {
          const browser = requireBrowserCtx(ctx);
          let inner: StepsExec | undefined;
          const switched = await browser.page.runNewTabBlock(browser.manager, config.timeouts.step, async () => {
            inner = await execSteps(step.body, config, ctx, tc, testName, registry);
            return inner.ok;
          });
          results.push(...inner!.steps);
          const ok = inner!.ok && switched.opened;
          const detail = switched.error ? tc.redactor.redact(switched.error) : ok ? 'switched to new tab' : (inner!.error ?? 'a step inside `switch to new tab` failed');
          result = mkStep('switchTab', src, step.span, ok, stepStart, detail);
          if (!ok && !switched.error && inner!.soft) callSoftError = inner!.error;
          break;
        }
        case 'SwitchToTabStmt': {
          const browser = requireBrowserCtx(ctx);
          await ensurePageForStep(ctx); // ensure at least the first tab exists before switching
          browser.page.switchToTab(step.index);
          result = mkStep('switchTab', src, step.span, true, stepStart, `switch to tab ${step.index}`);
          break;
        }
        case 'CloseTabStmt': {
          const browser = requireBrowserCtx(ctx);
          await browser.page.closeTab();
          result = mkStep('closeTab', src, step.span, true, stepStart, 'close tab');
          break;
        }
        case 'DownloadBlock': {
          const browser = requireBrowserCtx(ctx);
          let inner: StepsExec | undefined;
          const downloaded = await browser.page.runDownloadBlock(browser.manager, config.timeouts.step, async () => {
            inner = await execSteps(step.body, config, ctx, tc, testName, registry);
            return inner.ok;
          });
          results.push(...inner!.steps);
          if (downloaded.filename !== null) {
            ctx.scope.set(step.name, downloaded.filename);
            result = mkStep('download', src, step.span, true, stepStart, `${step.name} = ${JSON.stringify(downloaded.filename)} (downloaded)`);
          } else {
            const detail = downloaded.error ? tc.redactor.redact(downloaded.error) : (inner!.error ?? 'a step inside `download` failed');
            result = mkStep('download', src, step.span, false, stepStart, detail);
            if (!downloaded.error && inner!.soft) callSoftError = inner!.error;
          }
          break;
        }
        case 'DragStmt': {
          const fromName = String(evalValue(step.from.value, ctx));
          const toName = String(evalValue(step.to.value, ctx));
          const { pwLocator: fromLoc, via: fromVia } = await resolveForStep(ctx, config, step.from);
          const { pwLocator: toLoc, via: toVia } = await resolveForStep(ctx, config, step.to);
          await performDrag(fromLoc, toLoc, config.timeouts.step);
          result = mkStep('drag', src, step.span, true, stepStart, `drag ${locatorDetail(step.from, fromName, fromVia)} to ${locatorDetail(step.to, toName, toVia)}`);
          break;
        }
        case 'DropFileStmt': {
          const filePath = String(evalValue(step.filePath, ctx));
          const abs = resolvePath(tc.baseDir, filePath);
          const page = await ensurePageForStep(ctx);
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performDropFile(page, abs, pwLocator, config.timeouts.step);
          result = mkStep('dropFile', src, step.span, true, stepStart, `drop file ${JSON.stringify(filePath)} onto ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'WaitUntilUiStmt': {
          result = await execWaitUntilUi(step, ctx, src, stepStart, config);
          break;
        }
        case 'ScreenshotStmt': {
          const name = String(evalValue(step.name, ctx));
          const page = await ensurePageForStep(ctx);
          const screenshot = await performScreenshot(page);
          result = { ...mkStep('screenshot', src, step.span, true, stepStart, `screenshot ${JSON.stringify(name)} captured`), screenshot };
          break;
        }
        case 'StubStmt': {
          const urlPattern = String(evalValue(step.urlPattern, ctx));
          const status = step.status.value;
          const body = step.body ? Object.fromEntries(step.body.fields.map((f) => [f.key, evalValue(f.value, ctx)])) : null;
          const page = await ensurePageForStep(ctx);
          await performStub(page, step.method, urlPattern, status, body);
          result = mkStep('stub', src, step.span, true, stepStart, `stub ${step.method} ${JSON.stringify(urlPattern)} → ${status}`);
          break;
        }
        case 'ThinkStmt': {
          // A fresh uniform draw per iteration for a ranged `think`, off `ctx.rng` — reproducible
          // like every other generator (P#23), not `Math.random()`. Excluded from a scenario's own
          // `duration` threshold metric by the load engine (`runLoad` below, D24a) via this exact
          // step's own `durationMs` — think models pacing, not system latency.
          const ms = step.maxMs !== null ? step.minMs + Math.floor(ctx.rng() * (step.maxMs - step.minMs + 1)) : step.minMs;
          await sleep(ms);
          result = mkStep('think', src, step.span, true, stepStart, `thought for ${ms}ms`);
          break;
        }
      }
      // Best-effort failure evidence (M3c, D12's "failure-first capture") — attached to whichever
      // step just failed, browser or API (a UI test's API step failing still benefits from seeing
      // page state). `currentPageIfAny()` never creates a browser process for an API-only test that
      // merely happens to share a `BrowserManager` (SPEC §9's "present regardless of whether this
      // test uses a browser step" framing) — only a test that already opened a page gets a shot.
      if (!result.ok && ctx.browser) {
        const screenshot = await captureFailureScreenshot(ctx.browser.page.currentPageIfAny());
        if (screenshot) result = { ...result, screenshot };
      }
      results.push(result);
      tc.emit({ type: 'step:end', test: testName, step: result });
      if (!result.ok) {
        if (step.type === 'ExpectStmt' && step.soft) {
          // `check` records and continues (P#16) — the test still fails, just not fast.
          softFailures.push(result.detail ?? 'check failed');
        } else if (callSoftError !== undefined) {
          // An action call whose *own* steps failed only via soft `check`s (decision 55) —
          // propagate as soft here too, rather than failing fast like a hard error would.
          softFailures.push(callSoftError);
        } else {
          return { steps: results, ok: false, error: result.detail, giveValue }; // fail fast (P#16)
        }
      }
    } catch (err) {
      const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
      const redacted = tc.redactor.redact(message);
      let failed = mkStep(stepKind(step), src, step.span, false, stepStart, redacted);
      if (ctx.browser) {
        const screenshot = await captureFailureScreenshot(ctx.browser.page.currentPageIfAny());
        if (screenshot) failed = { ...failed, screenshot };
      }
      results.push(failed);
      tc.emit({ type: 'step:end', test: testName, step: failed });
      return { steps: results, ok: false, error: redacted, giveValue };
    }
  }

  if (softFailures.length > 0) {
    return { steps: results, ok: false, soft: true, error: softFailures.join('\n'), giveValue };
  }
  return { steps: results, ok: true, giveValue };
}

interface CallOutcome {
  readonly result: StepResult;
  readonly value: unknown;
  /** Step results produced *inside* the call (an action's own api/expect/... steps) — spliced
   * into the caller's step list so the report shows what actually happened (P#5). */
  readonly subSteps: StepResult[];
  /** Set when the action's steps failed *only* via accumulated soft `check`s (decision 55) — the
   * caller's own `execSteps` must add this to its own `softFailures` and keep going, the same as a
   * `check` failing directly in the caller, instead of failing fast like a hard error would. */
  readonly softError?: string;
}

async function execCall(call: CallExpr, config: ResolvedConfig, callerCtx: EvalCtx, tc: TestCtx, registry: CallRegistry, src: string, start: number): Promise<CallOutcome> {
  const args = call.args.map((a) => evalValue(a, callerCtx));

  const action = registry.actions.get(call.name);
  if (action) {
    if (args.length !== action.params.length) {
      throw new RuntimeError(`action "${call.name}" expects ${action.params.length} argument(s), got ${args.length}`);
    }
    const scope = new Map<string, unknown>();
    action.params.forEach((p, i) => scope.set(p, args[i]));
    const actionCtx: EvalCtx = {
      scope,
      environ: callerCtx.environ,
      redactor: callerCtx.redactor,
      rng: callerCtx.rng,
      runSeed: callerCtx.runSeed,
      runClock: callerCtx.runClock,
      uniqueSeq: callerCtx.uniqueSeq,
      sessionHeaders: callerCtx.sessionHeaders,
      sessionNames: callerCtx.sessionNames,
      // Shares the caller's live jar (by reference, not cloned) — an action's own api steps read
      // and update the same cookies its caller sees on the next step, the same way it shares the
      // caller's `rng`/`redactor`/etc.
      cookieJar: callerCtx.cookieJar,
      // M7 bug fix: an action's own browser steps (open/click/fill/…) need the caller's browser
      // context (manager/page/`within` scope) the same way its api steps need the caller's cookie
      // jar — dropped here, `requireBrowserCtx` throws on the action's very first browser step even
      // when the run genuinely has a `BrowserManager`. Unexercised until M7 wrote the first action
      // whose body is browser steps (M3a-M6 actions were all API-era).
      browser: callerCtx.browser,
    };
    const exec = await execSteps(action.body, config, actionCtx, tc, `${call.name}(...)`, registry);
    // A hard failure inside the action (a failing `expect`, or a thrown error) still aborts the
    // caller immediately — but a *soft* one (`exec.soft`, decision 55) must propagate as soft, not
    // silently harden into a caller-aborting throw: `check`→`check` stays uniform even through an
    // imported action, per §6.4's closed soft-assertion semantics.
    if (!exec.ok && !exec.soft) throw new RuntimeError(`action "${call.name}" failed: ${exec.error ?? 'a step failed'}`);
    const detail = tc.redactor.redact(`${call.name}(${args.map(repr).join(', ')}) = ${repr(exec.giveValue)}`);
    return {
      result: mkStep('call', src, call.span, exec.ok, start, detail),
      value: exec.giveValue,
      subSteps: exec.steps,
      ...(exec.soft && !exec.ok ? { softError: exec.error } : {}),
    };
  }

  const helperFn = registry.helpers.get(camelCaseName(call.name));
  if (helperFn) {
    const value = await helperFn({ env: callerCtx.environ }, ...args);
    const detail = tc.redactor.redact(`${call.name}(${args.map(repr).join(', ')}) = ${repr(value)}`);
    return { result: mkStep('call', src, call.span, true, start, detail), value, subSteps: [] };
  }

  throw new RuntimeError(`unknown call \`${call.name}(...)\` — no action (\`import\`) or JS helper (\`use\`) defines it`);
}

// ---- step executors --------------------------------------------------------

interface ApiExec {
  readonly trace: { request: RequestTrace; response: ResponseTrace };
  readonly redacted: { request: RequestTrace; response: ResponseTrace };
  /** `retry honoring "Retry-After" up to N` (SPEC §5.1, PLAN decision 102b, enterprise arc
   * cluster 3) — how many extra attempts this one request actually took and how long it slept in
   * total honoring the header; both `0` when `spec.retryAfter` is null or never triggered. */
  readonly retryAfterAttempts: number;
  readonly retryAfterWaitedMs: number;
}

/** `cert`/`key` file *contents*, keyed by resolved path pair — read once per run, not once per
 * request (decision 3b, enterprise arc): `execApi` runs per api step, and every step in a run
 * sharing one `mtls` config would otherwise re-read the same two small files from disk every time. */
const mtlsCredCache = new Map<string, Promise<{ cert: string; key: string }>>();

async function loadMtlsCreds(config: ResolvedConfig, baseDir: string): Promise<{ cert: string; key: string } | undefined> {
  if (!config.mtls) return undefined;
  const { certPath, keyPath } = config.mtls;
  const certAbs = resolvePath(baseDir, certPath);
  const keyAbs = resolvePath(baseDir, keyPath);
  const cacheKey = `${certAbs} ${keyAbs}`;
  let p = mtlsCredCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      try {
        const [cert, key] = await Promise.all([readFile(certAbs, 'utf8'), readFile(keyAbs, 'utf8')]);
        return { cert, key };
      } catch (err) {
        throw new RuntimeError(`could not read mTLS \`cert\`/\`key\` (resolved ${certAbs} / ${keyAbs}): ${(err as Error).message}`);
      }
    })();
    mtlsCredCache.set(cacheKey, p);
  }
  return p;
}

async function execApi(spec: ApiRequestSpec, config: ResolvedConfig, ctx: EvalCtx, redactor: Redactor, baseDir: string): Promise<ApiExec> {
  const baseUrl = resolveBaseUrl(spec.service, config);
  const path = interpolatePath(spec.path.raw, ctx, true);
  const url = baseUrl + ensureLeadingSlash(path);
  checkHostAllowed(url, config);

  const headers: Record<string, string> = {};
  for (const h of config.headers) {
    if (h.service === null || h.service === spec.service) setHeader(headers, h.name, stringify(evalValue(h.value, ctx)));
  }
  for (const [k, v] of Object.entries(ctx.sessionHeaders)) setHeader(headers, k, v);
  // Cookie jar (SPEC §3.3, P#33): applied before any per-step header, so an explicit `header
  // "Cookie" is …` on this step still wins (setHeader replaces, it never sits alongside).
  const jarCookie = ctx.cookieJar.serialize();
  if (jarCookie) setHeader(headers, 'Cookie', jarCookie);
  for (const h of spec.headers) setHeader(headers, h.name.value, stringify(evalValue(h.value, ctx)));

  let sendBody: BodyInit | undefined;
  let traceBody: string | undefined;
  if (spec.body) {
    const prepared = await prepareBody(spec.body, ctx, baseDir);
    sendBody = prepared.sendBody;
    traceBody = prepared.traceText;
    if (prepared.contentType && !hasHeader(headers, 'content-type')) setHeader(headers, 'content-type', prepared.contentType);
  }

  const request: RequestTrace = { method: spec.method, url, headers, ...(traceBody !== undefined ? { body: traceBody } : {}) };
  const timeoutMs = spec.timeoutMs ?? config.timeouts.step;
  const mtls = await loadMtlsCreds(config, baseDir);
  let response = await sendRequest({ method: spec.method, url, headers, body: sendBody, timeoutMs, followRedirects: spec.followRedirects, ...(mtls ? { mtls } : {}) });

  // `retry honoring "Retry-After" up to N` (SPEC §5.1, PLAN decision 102b, enterprise arc
  // cluster 3, closes TFLW-GAPS.md gap #5) — re-issues *this one request*, not the whole test
  // (unlike `test … retry N`). Stops the moment the response no longer carries a (parseable)
  // `Retry-After` header, same as today's unchanged single-attempt behavior when the clause is
  // absent entirely.
  let retryAfterAttempts = 0;
  let retryAfterWaitedMs = 0;
  if (spec.retryAfter) {
    while (retryAfterAttempts < spec.retryAfter.max) {
      const headerValue = response.headers['retry-after'];
      if (headerValue === undefined) break;
      const waitMs = parseRetryAfterMs(headerValue);
      if (waitMs === null) break;
      await sleep(waitMs);
      retryAfterWaitedMs += waitMs;
      retryAfterAttempts++;
      response = await sendRequest({ method: spec.method, url, headers, body: sendBody, timeoutMs, followRedirects: spec.followRedirects, ...(mtls ? { mtls } : {}) });
    }
  }

  // Every `Set-Cookie` the *final* response carried is folded into the jar here, unconditionally —
  // the next request in this same scope (session block, or this test's own subsequent steps) sees
  // it automatically, with no `capture`/`header` replay needed (SPEC §3.3, P#33).
  ctx.cookieJar.applySetCookie(response.headers['set-cookie']);

  return {
    trace: { request, response },
    redacted: { request: redactRequest(request, redactor, config), response: redactResponse(response, redactor, config) },
    retryAfterAttempts,
    retryAfterWaitedMs,
  };
}

/** Parses a `Retry-After` header value into a wait duration in ms: all-digits is seconds
 * (per RFC 9110 — whole seconds only), anything else is tried as an HTTP-date. Returns `null`
 * for anything unparseable, meaning "don't retry" — guessing a wait time is worse than not
 * retrying at all. */
function parseRetryAfterMs(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

interface PreparedBody {
  readonly sendBody: BodyInit | undefined;
  /** Human-readable text for the report/redaction; undefined only if there truly is no body. */
  readonly traceText: string | undefined;
  readonly contentType?: string;
}

async function prepareBody(body: ApiBody, ctx: EvalCtx, baseDir: string): Promise<PreparedBody> {
  switch (body.type) {
    case 'InlineBody': {
      const text = JSON.stringify(evalValue(body.object, ctx));
      return { sendBody: text, traceText: text, contentType: 'application/json' };
    }
    case 'TextBody': {
      const text = String(evalValue(body.value, ctx));
      return { sendBody: text, traceText: text };
    }
    case 'FileBody': {
      const filePath = String(evalValue(body.path, ctx));
      const abs = resolvePath(baseDir, filePath);
      let raw: string;
      try {
        raw = await readFile(abs, 'utf8');
      } catch (err) {
        throw new RuntimeError(`could not read \`body from\` file "${filePath}" (resolved ${abs}): ${(err as Error).message}`);
      }
      const text = interpolatePath(raw, ctx);
      return { sendBody: text, traceText: text, contentType: 'application/json' };
    }
    case 'FormBody': {
      const params = new URLSearchParams();
      for (const field of body.fields) params.append(field.key, stringify(evalValue(field.value, ctx)));
      const text = params.toString();
      return { sendBody: text, traceText: text, contentType: 'application/x-www-form-urlencoded' };
    }
    case 'UploadBody': {
      const filePath = String(evalValue(body.filePath, ctx));
      const abs = resolvePath(baseDir, filePath);
      let buf: Buffer;
      try {
        buf = await readFile(abs);
      } catch (err) {
        throw new RuntimeError(`could not read \`upload\` file "${filePath}" (resolved ${abs}): ${(err as Error).message}`);
      }
      const fieldName = String(evalValue(body.fieldName, ctx));
      const contentType = body.contentType ? String(evalValue(body.contentType, ctx)) : inferContentType(abs);
      const form = new FormData();
      form.append(fieldName, new Blob([new Uint8Array(buf)], { type: contentType }), basename(abs));
      const traceParts = [`${fieldName}=${basename(abs)} (${contentType})`];
      for (const field of body.extra) {
        const value = stringify(evalValue(field.value, ctx));
        form.append(field.key, value);
        traceParts.push(`${field.key}=${value}`);
      }
      return { sendBody: form, traceText: `[multipart form: ${traceParts.join(', ')}]` };
    }
  }
}

async function execExpect(step: ExpectStmt, response: ResponseTrace | null, connectionError: string | null, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig, baseDir: string): Promise<StepResult> {
  const outcome = await evaluateExpect(step, response, connectionError, ctx, config, baseDir);
  const message = maskExpectDetail(step, response, outcome.message, config.redactPatterns);
  return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(message));
}

/** UI `expect`/`check` (SPEC §9.4) — auto-retries to `timeouts.expect` (P#15's web-first half;
 * API expects evaluate once, UI expects retry), unlike `execExpect`'s single evaluation. Resolves
 * the locator itself on every poll (rather than once up front) so a state matcher observes the
 * element's *current* state each time, and a genuinely-missing element (zero matches) is a valid
 * observation, not an error — `is hidden`/`has count 0` must be able to pass against nothing. */
async function execUiExpect(step: ExpectStmt, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig): Promise<StepResult> {
  const subject = step.subject as Extract<Subject, { type: 'LocatorSubject' }>;
  const browser = requireBrowserCtx(ctx);
  const page = await browser.page.ensurePage(browser.manager);
  const scope = browser.scope ?? page;
  const name = String(evalValue(subject.locator.value, ctx));
  const deadline = performance.now() + config.timeouts.expect;
  for (;;) {
    const { pwLocator, via, count } = await resolveLocatorSnapshot(scope, subject.locator, ctx);
    // `has count` is the one UI matcher meaningful against more than one element (SPEC §9.4) — for
    // every other matcher, matching several elements is still ambiguous (D7), same as an action.
    if (step.matcher.name !== 'hasCount') await requireSingleMatch(subject.locator, name, { pwLocator, via }, count);
    const label = locatorDetail(subject.locator, name, via);
    const outcome = await evalUiMatcherOnce(label, pwLocator, step.matcher, ctx, count);
    if (outcome.ok || performance.now() >= deadline) {
      return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

/** `expect`/`check page|<locator> matches snapshot "<name>" [mask <locator>]*` (M4b, D15, SPEC
 * §9.9) — unlike every other UI expect, this never retries: a screenshot is one point-in-time
 * capture compared once against a baseline committed to the repo, not a condition that becomes
 * true as the page settles. `target === null` captures the whole page (`PageSubject`); otherwise
 * one element's own bounding box (`LocatorSubject`, D7's usual single-match requirement via
 * `resolveForStep`). Masks resolve the same way, painted over before comparison ever runs. */
async function execSnapshotExpect(step: ExpectStmt, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig, tc: TestCtx, testName: string): Promise<StepResult> {
  const browser = requireBrowserCtx(ctx);
  const page = await browser.page.ensurePage(browser.manager);
  const name = String(evalValue(step.matcher.snapshotName!, ctx));

  const target: PWLocator | null = step.subject.type === 'LocatorSubject' ? (await resolveForStep(ctx, config, step.subject.locator)).pwLocator : null;
  const maskLocators: PWLocator[] = [];
  for (const mask of step.masks) maskLocators.push((await resolveForStep(ctx, config, mask)).pwLocator);

  const actualPng = await performSnapshotCapture(page, target, maskLocators);
  const platformKey = await browser.manager.platformKey();
  const paths = snapshotPaths(tc.baseDir, tc.filePath, testName, name);
  const outcome = await evaluateSnapshot(paths, name, actualPng, platformKey, tc.updateSnapshots, step.matcher.negated);

  const result = mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
  return outcome.diff ? { ...result, snapshotDiff: outcome.diff } : result;
}

/** `wait until <locator> [not] <matcher>` (SPEC §9.5, M3b) — the UI sibling of `execUiExpect`:
 * same resolve-fresh-every-poll / `hasCount`-exception logic, but polling `timeout wait` (default
 * 30s, the same clock `wait until api` uses) instead of `timeout expect` (default 5s), for a UI
 * condition that can legitimately take longer to settle than the ordinary UI-expect budget. Always
 * hard-fails on exhaustion — there is no soft/`check` form for `wait until`. */
async function execWaitUntilUi(step: WaitUntilUiStmt, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig): Promise<StepResult> {
  const subject = step.subject;
  const browser = requireBrowserCtx(ctx);
  const page = await browser.page.ensurePage(browser.manager);
  const scope = browser.scope ?? page;
  const name = String(evalValue(subject.locator.value, ctx));
  const deadline = performance.now() + config.timeouts.wait;
  for (;;) {
    const { pwLocator, via, count } = await resolveLocatorSnapshot(scope, subject.locator, ctx);
    if (step.matcher.name !== 'hasCount') await requireSingleMatch(subject.locator, name, { pwLocator, via }, count);
    const label = locatorDetail(subject.locator, name, via);
    const outcome = await evalUiMatcherOnce(label, pwLocator, step.matcher, ctx, count);
    if (outcome.ok || performance.now() >= deadline) {
      return mkStep('wait', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

/** `expect`/`check request to "…" was made` and `status`/`header`/`body[...]`/`body text` `of
 * request to "…"` (M3d, SPEC §9.7) — auto-retries to `timeout expect` like `execUiExpect`: a
 * network request an earlier click just triggered may still be in flight when this assertion
 * runs. Re-reads `networkRequestsSoFar()` fresh on every poll rather than resolving the match once,
 * so a request that completes mid-poll is picked up on the very next iteration. Redaction here is
 * limited to the universal `ctx.redactor.redact()` pass every step's message already gets — the
 * `redact <path>` config's field-path-specific masking (`maskExpectDetail`, gap #15) stays scoped
 * to API `body.<path>` subjects; extending it to observed network bodies is a separate, unscoped
 * piece of work. */
async function execNetworkExpect(step: ExpectStmt, ref: NetworkRequestRef, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig): Promise<StepResult> {
  if (step.quantifier) {
    throw new RuntimeError('`any`/`all` are not supported against a `request to "…"` subject (SPEC §9.7)');
  }
  const browser = requireBrowserCtx(ctx);
  const urlPattern = String(evalValue(ref.urlPattern, ctx));
  const method = ref.method ? String(evalValue(ref.method, ctx)).toUpperCase() : null;
  const deadline = performance.now() + config.timeouts.expect;
  for (;;) {
    const matched = findLastMatchingRequest(browser.page.networkRequestsSoFar(), urlPattern, method);
    const outcome = evaluateNetworkExpect(step, matched, urlPattern, ctx);
    if (outcome.ok || performance.now() >= deadline) {
      return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

/** Most-recently-completed match wins (SPEC §9.7) — a page can legitimately request the same
 * endpoint more than once (a retry, a polling widget); the latest is the one a test author almost
 * always means. `url.includes(urlPattern)` is a deliberately simple substring match, not
 * Playwright's glob/regex route syntax (that's `stub`'s own, separate concern) — forgiving of
 * query strings and cross-origin absolute URLs alike. */
function findLastMatchingRequest(log: readonly CapturedNetworkRequest[], urlPattern: string, method: string | null): CapturedNetworkRequest | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i]!;
    if (!r.url.includes(urlPattern)) continue;
    if (method && r.method.toUpperCase() !== method) continue;
    return r;
  }
  return undefined;
}

function evaluateNetworkExpect(step: ExpectStmt, matched: CapturedNetworkRequest | undefined, urlPattern: string, ctx: EvalCtx): MatchOutcome {
  const subject = step.subject;
  const label = networkSubjectLabel(subject, urlPattern);
  if (subject.type === 'NetworkRequestSubject') {
    // Existence-only; `wasMade` is the only matcher meaningful here. The checker doesn't statically
    // enforce this (SPEC §1: matcher↔subject compatibility stays a runtime concern, mirroring every
    // other subject) — a mismatched matcher gets a direct, clear error instead of nonsense output.
    if (step.matcher.name !== 'wasMade') {
      throw new RuntimeError(`\`${step.matcher.name}\` isn't valid against \`request to "…"\` — only \`was made\` (SPEC §9.7)`);
    }
    const made = matched !== undefined;
    const ok = step.matcher.negated ? !made : made;
    const verb = made ? 'was made' : 'was not made';
    return ok
      ? { ok: true, message: `${label} ${verb} (as expected)` }
      : { ok: false, message: `expected ${label} to ${step.matcher.negated ? 'not have been made' : 'have been made'}, but it ${made ? 'was' : "wasn't"}` };
  }
  if (!matched) {
    return { ok: false, message: `expected ${label}, but no matching request has been observed yet` };
  }
  const { value } = resolveNetworkSubjectValue(subject, matched);
  return evalMatcher(label, value, step.matcher, ctx);
}

function resolveNetworkSubjectValue(subject: Subject, matched: CapturedNetworkRequest): { value: unknown; label: string } {
  switch (subject.type) {
    case 'StatusSubject':
      return { value: matched.status, label: 'status' };
    case 'HeaderSubject':
      return { value: matched.responseHeaders[subject.name.value.toLowerCase()], label: `header "${subject.name.value}"` };
    case 'BodyTextSubject':
      return { value: matched.responseBodyText, label: 'body text' };
    case 'BodySubject': {
      if (matched.responseJson === undefined) {
        throw new RuntimeError('response body is not JSON — a `body.<path> of request to "…"` subject needs a JSON response (use `body text of request to "…"` for non-JSON)');
      }
      let value: unknown = matched.responseJson;
      for (const seg of subject.path) value = navigate(value, seg, pathLabel(subject.path));
      return { value, label: 'body' + pathLabel(subject.path) };
    }
    default:
      // Unreachable: `execSteps` only routes here when `subjectNetworkRef` found a ref, which is
      // only ever set on these four subject types (checker.ts's `checkSubject`, ast.ts).
      throw new RuntimeError(`\`${subject.type}\` does not support \`of request to "…"\``);
  }
}

function networkSubjectLabel(subject: Subject, urlPattern: string): string {
  const base = `request to ${JSON.stringify(urlPattern)}`;
  switch (subject.type) {
    case 'StatusSubject':
      return `status of ${base}`;
    case 'HeaderSubject':
      return `header ${JSON.stringify(subject.name.value)} of ${base}`;
    case 'BodyTextSubject':
      return `body text of ${base}`;
    case 'BodySubject':
      return `body${pathLabel(subject.path)} of ${base}`;
    default:
      return base;
  }
}

/** Which subjects carry a network-observation ref (M3d, SPEC §9.7) — `NetworkRequestSubject`
 * itself, or the `of request to "…"` clause on the four ordinary response subjects that support
 * it. `null` means "unchanged, last-`api`-step-response-scoped behavior" — routes to
 * `execExpect`/`execUiExpect` exactly as before M3d. */
function subjectNetworkRef(subject: Subject): NetworkRequestRef | null {
  if (subject.type === 'NetworkRequestSubject') return subject.ref;
  if (subject.type === 'StatusSubject' || subject.type === 'HeaderSubject' || subject.type === 'BodySubject' || subject.type === 'BodyTextSubject') {
    return subject.of;
  }
  return null;
}

/** `expect`/`check page has no [<severity>] a11y violations` (M3e, D14, SPEC §9.8) — auto-retries
 * to `timeout expect` like `execUiExpect`/`execNetworkExpect`: a page still hydrating (a label
 * attached once data loads, an async toast) can legitimately fix its own accessibility gaps before
 * the assertion's budget runs out. Re-runs a full `runA11yScan` on every poll rather than caching
 * one result — the same "observe the *current* state every time" shape `execUiExpect` already uses
 * for its locator, not a performance shortcut. */
async function execA11yExpect(step: ExpectStmt, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig): Promise<StepResult> {
  if (step.matcher.name !== 'hasNoA11yViolations') {
    throw new RuntimeError(`\`${step.matcher.name}\` isn't valid against \`page\` — only \`has no [<severity>] a11y violations\` (SPEC §9.8)`);
  }
  const browser = requireBrowserCtx(ctx);
  const page = await browser.page.ensurePage(browser.manager);
  const floor = step.matcher.a11ySeverity ?? null;
  const deadline = performance.now() + config.timeouts.expect;
  for (;;) {
    const violations = filterBySeverity(await runA11yScan(page), floor);
    const outcome = describeA11yOutcome(step, floor, violations);
    if (outcome.ok || performance.now() >= deadline) {
      return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

/** At most 5 violations listed in the failure message (mirrors `matcher.ts`'s `MAX_DIFF_CHARS`
 * truncation in spirit — a large real page can have dozens of instances of the same rule, and the
 * point is "here's enough to start fixing", not a full audit dump); the full axe-core result isn't
 * surfaced anywhere else, unlike a response body, so this is the only place worth being generous
 * with detail per item shown. */
function describeA11yOutcome(step: ExpectStmt, floor: A11ySeverity | null, violations: readonly Finding[]): MatchOutcome {
  const kind = floor ? `${floor} a11y violation` : 'a11y violation';
  const negated = step.matcher.negated;
  const noneFound = violations.length === 0;
  const ok = negated ? !noneFound : noneFound;
  if (ok) {
    const state = negated ? `has ${violations.length} ${kind}${violations.length === 1 ? '' : 's'}` : `has no ${kind}s`;
    return { ok: true, message: `page ${state} (as expected)` };
  }
  if (negated) {
    return { ok: false, message: `expected page to have at least one ${kind}, but found none` };
  }
  const shown = violations.slice(0, 5).map((v) => `  - [${v.severity}] ${v.id}: ${v.description} (${v.detail})`);
  const more = violations.length > 5 ? [`  … and ${violations.length - 5} more`] : [];
  return { ok: false, message: `expected page to have no ${kind}s, but found ${violations.length}:\n${[...shown, ...more].join('\n')}` };
}

/** Gap #15 (TFLW-GAPS.md): a plain (non-quantified) `body.<path>` assertion's own detail text can
 * expose a `redact`-covered field's real value — as the `actual` side of a failing comparison, or
 * (since a passing `equals` necessarily has `actual === expected`) as the literal shown even on
 * success. Quantified (`any`/`all`) assertions are deliberately left alone: the per-element path
 * that actually matched isn't known statically here the way a plain subject's is, and the messages
 * they build (`arrayLabel[idx]...`) don't reduce to one resolvable subject value to mask. */
function maskExpectDetail(step: ExpectStmt, response: ResponseTrace | null, message: string, patterns: readonly RedactPattern[]): string {
  if (step.quantifier || step.subject.type !== 'BodySubject' || !response) return message;
  if (!pathMatchesRedactPattern(step.subject.path, patterns)) return message;
  const { value } = resolveSubject(step.subject, response);
  return maskDetailValue(message, repr(value));
}

function execLet(step: LetStmt, ctx: EvalCtx, src: string, start: number, redactor: Redactor): StepResult {
  const value = evalValue(step.value, ctx);
  ctx.scope.set(step.name, value);
  const tag = generatorTag(step.value.type);
  return mkStep('let', src, step.span, true, start, redactor.redact(`${step.name} = ${repr(value)}${tag}`));
}

/** `qty = 100 (random)` / `sku = "ORD-123" (unique)` — every generated value shown inline (P#23). */
function generatorTag(valueType: string): string {
  if (valueType.startsWith('Random')) return ' (random)';
  if (valueType.startsWith('Unique')) return ' (unique)';
  return '';
}

function execCapture(step: CaptureStmt, response: ResponseTrace | null, ctx: EvalCtx, src: string, start: number, redactor: Redactor, config: ResolvedConfig): StepResult {
  const { value } = resolveSubject(step.subject, response);
  ctx.scope.set(step.name, value);
  // Gap #15 (TFLW-GAPS.md): `capture`'s own detail line renders the live value directly — mask it
  // the same way a `redact`-covered field is masked everywhere else, when this capture's subject
  // is one of the configured `body.<path>` patterns. The captured *variable* itself stays the real
  // value (so a later `expect {name} equals ...` still asserts against ground truth) — only this
  // step's own report text changes.
  const masked = step.subject.type === 'BodySubject' && pathMatchesRedactPattern(step.subject.path, config.redactPatterns);
  const rendered = masked ? '[redacted]' : repr(value);
  return mkStep('capture', src, step.span, true, start, redactor.redact(`${step.name} = ${rendered} (captured)`));
}

/** `log [level] "message" [to destination]` (M27, PLAN_LOG.md decisions 113-121) — unlike every
 * other step, this always succeeds: a `log` call is deliberate author signal, not step-execution
 * plumbing, so it can't itself assert anything (decision 118's console-unconditional treatment
 * only makes sense if the step is never the thing that fails a test). `step.message` is an
 * ordinary `StringLit`, so `evalValue` resolves its `{var}` interpolation the same way `let`/
 * `capture`'s detail lines already do (decision 120) — redacted the same way too, in case an
 * interpolated value is itself a secret. `destination` falls back to the resolved config's
 * `logDestination` (itself already `--log-output`-overridden by the time it reaches here, decision
 * 121) only when the statement omitted its own `to …` clause — an explicit per-statement
 * destination always wins. */
function execLog(step: LogStmt, ctx: EvalCtx, src: string, start: number, redactor: Redactor, config: ResolvedConfig): StepResult {
  const message = String(evalValue(step.message, ctx));
  const destination = step.destination ?? config.logDestination;
  return { ...mkStep('log', src, step.span, true, start, redactor.redact(message)), level: step.level, destination };
}

async function execWaitUntilApi(
  step: WaitUntilApiStmt,
  config: ResolvedConfig,
  ctx: EvalCtx,
  redactor: Redactor,
  baseDir: string,
  src: string,
  start: number,
): Promise<{ result: StepResult; response: ResponseTrace | null }> {
  const deadline = performance.now() + config.timeouts.wait;
  let attempt = 0;
  let last: { redacted: ApiExec['redacted']; response: ResponseTrace; message: string } | null = null;
  for (;;) {
    // If the deadline already passed (e.g. eaten by the previous poll + inter-poll sleep), report the
    // timeout using the last completed poll's result rather than firing off another request — issuing
    // one with a near-zero remaining budget would abort even a healthy fast server (decision 67).
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0 && last) {
      const attempts = `${attempt} attempt${attempt === 1 ? '' : 's'}`;
      const detail = `timed out after ${config.timeouts.wait}ms (${attempts}): ${last.message}`;
      return {
        result: mkStep('wait', src, step.span, false, start, redactor.redact(detail), last.redacted.request, last.redacted.response),
        response: last.response,
      };
    }
    attempt++;
    // Clamp this poll's own request timeout to what's left of the wait deadline (decision 67) — the
    // outer deadline was previously only checked *after* `execApi` returned, so a single slow poll
    // could hang for up to the request's own (much larger) `config.timeouts.step` default, blowing
    // way past a short `wait <N>ms` budget.
    const requestTimeout = Math.max(1, Math.min(step.request.timeoutMs ?? config.timeouts.step, remainingMs));
    const request = { ...step.request, timeoutMs: requestTimeout };
    const { trace, redacted } = await execApi(request, config, ctx, redactor, baseDir);
    // `wait until api` never opts into catching a connection failure (`checkRequestAssertions`
    // statically forbids a `request` assertion here, decision 18) — `connectionError` is always
    // null; a real connection failure still throws out of `execApi` above and crashes the poll
    // loop exactly like today, unchanged.
    const outcomes = await Promise.all(step.expects.map((e) => evaluateExpect(e, trace.response, null, ctx, config, baseDir)));
    const allOk = outcomes.every((o) => o.ok);
    const attempts = `${attempt} attempt${attempt === 1 ? '' : 's'}`;
    if (allOk) {
      const detail = `passed after ${attempts}: ${redacted.request.method} ${redacted.request.url} → ${trace.response.status}`;
      return {
        result: mkStep('wait', src, step.span, true, start, redactor.redact(detail), redacted.request, redacted.response),
        response: trace.response,
      };
    }
    const lastMessage = outcomes.find((o) => !o.ok)!.message;
    last = { redacted, response: trace.response, message: lastMessage };
    if (performance.now() >= deadline) {
      const detail = `timed out after ${config.timeouts.wait}ms (${attempts}): ${lastMessage}`;
      return {
        result: mkStep('wait', src, step.span, false, start, redactor.redact(detail), redacted.request, redacted.response),
        response: trace.response,
      };
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- expect evaluation (shared by `expect` and `wait until api`) ----------

async function evaluateExpect(step: ExpectStmt, response: ResponseTrace | null, connectionError: string | null, ctx: EvalCtx, config: ResolvedConfig, baseDir: string): Promise<MatchOutcome> {
  // `request connects`/`fails` (SPEC §6.2.2, PLAN decision 18) judges the connection attempt
  // itself, not the response — bypasses `resolveSubject`/`evalMatcher` entirely, the same way
  // `matchesSchema` below bypasses `evalMatcher` for its own different reason.
  if (step.subject.type === 'RequestSubject') return evalRequestMatcher(step.matcher, connectionError, ctx);
  if (step.quantifier) return evaluateQuantified(step, response, ctx);
  const { value, label } = resolveSubject(step.subject, response);
  // `matches schema` (SPEC, PLAN decision 102a, enterprise arc cluster 3) fetches an external
  // OpenAPI document, so it's the one matcher `evalMatcher` (pure, synchronous by design, P#13)
  // can't evaluate itself — dispatched here instead, bypassing it entirely.
  if (step.matcher.name === 'matchesSchema') {
    return evaluateSchemaMatch(label, value, step.matcher.schemaName!.value, step.matcher.schemaSource!.value, config, step.matcher.negated);
  }
  // `matches file "<path>"` (gap #17) reads a file off disk — same reason as `matchesSchema`
  // above, bypassing `evalMatcher` (pure, synchronous by design) entirely.
  if (step.matcher.name === 'matchesFile') {
    if (!(value instanceof Uint8Array)) {
      throw new RuntimeError('`matches file` is only valid on a `body bytes` subject');
    }
    return evaluateFileMatch(label, Buffer.from(value), step.matcher.filePath!.value, baseDir, step.matcher.negated);
  }
  return evalMatcher(label, value, step.matcher, ctx);
}

/** `any`/`all` over an array found by walking the body path (P#14, SPEC §6.3): navigate segments
 * until a value is an array, then apply the remaining segments per element. */
function evaluateQuantified(step: ExpectStmt, response: ResponseTrace | null, ctx: EvalCtx): MatchOutcome {
  if (!response) throw new RuntimeError('no response yet — an `api` step must run before this assertion');
  if (step.subject.type !== 'BodySubject' && step.subject.type !== 'BodyCsvSubject') {
    throw new RuntimeError('`any`/`all` only apply to a `body.<path>` or `body csv` subject');
  }
  if (step.matcher.name === 'matchesSchema') {
    throw new RuntimeError('`any`/`all` cannot be combined with `matches schema` — validate the whole array element by element isn\'t supported for contract matching');
  }
  const path = step.subject.path;

  // D19.8 — the root value to walk depends on the subject: JSON body for `body.<path>`, freshly
  // parsed CSV rows for `body csv`. Everything from here (walk remaining path, find the first
  // array, map + `evalMatcher` over elements) is already subject-agnostic once it has a root value.
  let current: unknown;
  if (step.subject.type === 'BodyCsvSubject') {
    current = parseCsv(response.bodyText);
  } else {
    if (response.json === undefined) throw new RuntimeError('`any`/`all` need a JSON response body (use `body text` for non-JSON)');
    current = response.json;
  }
  const subjectLabel = step.subject.type === 'BodyCsvSubject' ? 'body csv' : 'body';
  let i = 0;
  while (i < path.length && !Array.isArray(current)) {
    current = navigate(current, path[i]!, pathLabel(path.slice(0, i + 1)));
    i++;
  }
  if (!Array.isArray(current)) {
    throw new RuntimeError(`\`${step.quantifier}\` needs an array somewhere in \`${subjectLabel}${pathLabel(path)}\`, but never found one`);
  }
  const arrayLabel = `${subjectLabel}${pathLabel(path.slice(0, i))}`;
  const remaining = path.slice(i);

  // A per-element navigation failure (an element missing the remaining path entirely, e.g. a
  // `null`/absent intermediate field) is that element failing to match, not a reason to blow up
  // the whole quantified assertion (P#46) — `any` in particular must be able to say "this one
  // element didn't have it" without crashing out before checking the rest.
  const outcomes = current.map((el, idx) => {
    const label = `${arrayLabel}[${idx}]${pathLabel(remaining)}`;
    try {
      let value: unknown = el;
      for (const seg of remaining) value = navigate(value, seg, label);
      return evalMatcher(label, value, step.matcher, ctx);
    } catch (err) {
      const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
      return { ok: false, message };
    }
  });

  const ok = step.quantifier === 'any' ? outcomes.some((o) => o.ok) : outcomes.every((o) => o.ok);
  if (ok) return { ok: true, message: `${step.quantifier} of ${current.length} element(s) in ${arrayLabel} matched` };
  if (step.quantifier === 'all') return outcomes.find((o) => !o.ok)!;
  return { ok: false, message: `expected any element in ${arrayLabel} to match, but none of ${current.length} did` };
}

function pathLabel(path: readonly PathSegment[]): string {
  return path.map((s) => (s.kind === 'prop' ? `.${s.name}` : `[${s.index}]`)).join('');
}

// ---- subjects --------------------------------------------------------------

function resolveSubject(subject: Subject, response: ResponseTrace | null): { value: unknown; label: string } {
  // A network-observation subject (`request to "…"`/`of request to "…"`, M3d) needs the browser's
  // network log + a retry-until-timeout poll, neither of which this function has access to (it
  // only ever sees the last `api` step's response) — `execSteps`'s `ExpectStmt` case routes those
  // through `execNetworkExpect` instead, before ever reaching here. Reached only via `capture ...
  // of request to "…" as x`, which isn't a defined operation — a clear error beats silently
  // capturing the *unrelated* last-`api`-step response instead.
  if (subjectNetworkRef(subject)) {
    throw new RuntimeError('`capture` does not support a `request to "…"`/`of request to "…"` subject (SPEC §9.7) — only `expect`/`check` against it');
  }
  // Same reasoning, same ordering (before the response-null guard below, which is meaningless for
  // a subject that was never going to read `response` in the first place): `execA11yExpect`
  // intercepts every `PageSubject` expect/check (SPEC §9.8); reached only via `capture page as x`.
  if (subject.type === 'PageSubject') {
    throw new RuntimeError('`page` is not a capturable value — only `expect`/`check page has no … a11y violations` (SPEC §9.8)');
  }
  if (!response) throw new RuntimeError('no response yet — an `api` step must run before this assertion/capture');
  switch (subject.type) {
    case 'StatusSubject':
      return { value: response.status, label: 'status' };
    case 'DurationSubject':
      return { value: response.durationMs, label: 'duration' };
    case 'HeaderSubject':
      return { value: response.headers[subject.name.value.toLowerCase()], label: `header "${subject.name.value}"` };
    case 'BodyTextSubject':
      return { value: response.bodyText, label: 'body text' };
    case 'BodyBytesSubject':
      return { value: response.bodyBytes, label: 'body bytes' };
    case 'BodyCsvSubject': {
      const rows = parseCsv(response.bodyText);
      let value: unknown = rows;
      for (const seg of subject.path) value = navigate(value, seg, pathLabel(subject.path));
      return { value, label: 'body csv' + pathLabel(subject.path) };
    }
    case 'BodyPdfTextSubject':
      return { value: extractPdfText(response.bodyBytes), label: 'body pdf text' };
    case 'BodySubject': {
      if (response.json === undefined) {
        throw new RuntimeError('response body is not JSON — a `body.<path>` subject needs a JSON response (use `body text` for non-JSON)');
      }
      let value: unknown = response.json;
      for (const seg of subject.path) value = navigate(value, seg, pathLabel(subject.path));
      return { value, label: 'body' + pathLabel(subject.path) };
    }
    case 'RequestSubject':
      // `evaluateExpect` bypasses `resolveSubject` entirely for a `RequestSubject` (same as it
      // already does for `matchesSchema`) and dispatches to `evalRequestMatcher` instead — reached
      // here only for a use `checkRequestAssertions` doesn't (yet) statically forbid, e.g.
      // `capture request as x` (SPEC §6.2.2, decision 18: `request` carries no value to capture).
      throw new RuntimeError('`request` is not a capturable/comparable value — only `expect`/`check request connects`/`fails` (SPEC §6.2.2)');
    case 'LocatorSubject':
      // `execUiExpect` intercepts every `LocatorSubject` expect/check before `resolveSubject` is
      // ever called (see the `ExpectStmt` case in `execSteps`) — reached only via `capture
      // button "…" as x`, which isn't a defined operation (SPEC §9.4: locators are asserted, not
      // captured as values).
      throw new RuntimeError('a UI locator is not a capturable value — only `expect`/`check` against it (SPEC §9.4)');
    case 'NetworkRequestSubject':
      // Unreachable in practice — the `subjectNetworkRef` guard above already throws before this
      // switch runs for any network-observation subject. Kept for exhaustiveness.
      throw new RuntimeError('`capture` does not support a `request to "…"` subject (SPEC §9.7) — only `expect`/`check` against it');
    // `PageSubject` is excluded from this switch's domain entirely — the guard above already threw
    // for it, so TS's narrowing means it's not a case this switch needs (or is allowed) to handle.
  }
}

// ---- request/response building & redaction ---------------------------------

/** `allow hosts` (SPEC §3.7, PLAN decision 101a, enterprise arc cluster 2) — rejected before any
 * network I/O so a misconfigured test can never actually reach an unlisted host, not even once. A
 * `null` `allowHosts` means the key was never declared: no enforcement, backward compatible. */
export function checkHostAllowed(url: string, config: ResolvedConfig): void {
  if (!config.allowHosts || config.allowHosts.length === 0) return;
  const hostname = new URL(url).hostname;
  if (!config.allowHosts.some((pattern) => hostMatchesAllowPattern(hostname, pattern))) {
    throw new RuntimeError(`host "${hostname}" is not in \`allow hosts\` (${config.allowHosts.join(', ')}) — refusing to send this request`);
  }
}

/** A pattern starting with `*.` matches that suffix (any subdomain) or the bare domain itself;
 * anything else must match the hostname exactly. */
function hostMatchesAllowPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === pattern;
}

export function resolveBaseUrl(service: string | null, config: ResolvedConfig): string {
  if (service === null) {
    if (!config.apiBaseUrl) throw new RuntimeError(`env "${config.envName}" declares no default \`api\` base URL`);
    return config.apiBaseUrl;
  }
  const url = config.services[service];
  if (!url) {
    const known = Object.keys(config.services);
    throw new RuntimeError(`unknown api service "${service}"${known.length ? ` (known: ${known.join(', ')})` : ''}`);
  }
  return url;
}

/** Placeholder for a body dropped entirely by `evidence headers-only`/`none` (SPEC §13, PLAN
 * decision 101c) — distinguishable in the report from a genuinely empty (e.g. 204) body. */
const EVIDENCE_OMITTED_BODY = '[omitted by evidence level]';

/** Builds the **report-only** copy of a request trace: secret redaction (existing, decision
 * P#30) → declarative field redaction (decision 101d) → evidence-level trim (decision 101c), in
 * that order. The raw `trace` returned alongside this by `execApi` is what `expect`/`capture`
 * actually read — this copy never feeds back into the run. */
function redactRequest(req: RequestTrace, r: Redactor, config: ResolvedConfig): RequestTrace {
  const url = r.redact(req.url);
  if (config.evidenceLevel === 'none') return { method: req.method, url, headers: {} };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = r.redact(v);
  if (config.evidenceLevel === 'headers-only') return { method: req.method, url, headers };
  const body = req.body !== undefined ? redactFields(r.redact(req.body), config.redactPatterns) : undefined;
  return { method: req.method, url, headers, ...(body !== undefined ? { body } : {}) };
}

// Gap #17: the report-only copy never carries real bytes, at any evidence level — `results.json`
// is `JSON.stringify`'d verbatim (reporter/src/index.ts), and a raw `Buffer` serializes as one
// array entry per byte (`{"type":"Buffer","data":[…]}`), exactly the unreadable-artifact problem
// D17.4 fixed for `repr()`'s failure-message text. This field only exists to satisfy
// `ResponseTrace`'s shape for this report copy — nothing in `packages/reporter` ever reads it back
// (html.ts/junit rendering only ever used `bodyText`); the live, ungutted `response.bodyBytes` used
// by `expect`/`capture` comes from the raw trace `execApi` returns alongside this, never from here.
const NO_REPORT_BODY_BYTES = Buffer.alloc(0);

function redactResponse(res: ResponseTrace, r: Redactor, config: ResolvedConfig): ResponseTrace {
  const statusText = r.redact(res.statusText);
  if (config.evidenceLevel === 'none') {
    return { status: res.status, statusText, headers: {}, bodyText: EVIDENCE_OMITTED_BODY, bodyBytes: NO_REPORT_BODY_BYTES, durationMs: res.durationMs };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k] = r.redact(v);
  if (config.evidenceLevel === 'headers-only') {
    return { status: res.status, statusText, headers, bodyText: EVIDENCE_OMITTED_BODY, bodyBytes: NO_REPORT_BODY_BYTES, durationMs: res.durationMs };
  }
  const bodyText = redactFields(r.redact(res.bodyText), config.redactPatterns);
  return { status: res.status, statusText, headers, bodyText, bodyBytes: NO_REPORT_BODY_BYTES, durationMs: res.durationMs };
}

// ---- helpers ---------------------------------------------------------------

function mkStep(
  kind: StepResult['kind'],
  source: string,
  span: Span,
  ok: boolean,
  start: number,
  detail?: string,
  request?: RequestTrace,
  response?: ResponseTrace,
): StepResult {
  return {
    kind,
    source,
    line: span.start.line,
    ok,
    durationMs: Math.round(performance.now() - start),
    ...(detail ? { detail } : {}),
    ...(request ? { request } : {}),
    ...(response ? { response } : {}),
  };
}

function stepKind(step: Step): StepResult['kind'] {
  switch (step.type) {
    case 'ApiStep':
      return 'api';
    case 'ExpectStmt':
      return step.soft ? 'check' : 'expect';
    case 'LetStmt':
      return 'let';
    case 'CaptureStmt':
      return 'capture';
    case 'LogStmt':
      return 'log';
    case 'WaitUntilApiStmt':
    case 'WaitUntilUiStmt':
      return 'wait';
    case 'GiveStmt':
      return 'give';
    case 'CallStmt':
      return 'call';
    case 'HeaderStmt':
      return 'header';
    case 'OpenStmt':
      return 'open';
    case 'ClickStmt':
      return 'click';
    case 'FillStmt':
    case 'FillFormStmt':
      return 'fill';
    case 'SelectStmt':
      return 'select';
    case 'CheckStmt':
      return 'checkbox';
    case 'UncheckStmt':
      return 'uncheckbox';
    case 'PressStmt':
      return 'press';
    case 'HoverStmt':
      return 'hover';
    case 'ScrollStmt':
      return 'scroll';
    case 'WithinBlock':
      return 'within';
    case 'AcceptDialogStmt':
    case 'DismissDialogStmt':
      return 'dialog';
    case 'SwitchToNewTabBlock':
    case 'SwitchToTabStmt':
      return 'switchTab';
    case 'CloseTabStmt':
      return 'closeTab';
    case 'DownloadBlock':
      return 'download';
    case 'DragStmt':
      return 'drag';
    case 'DropFileStmt':
      return 'dropFile';
    case 'ScreenshotStmt':
      return 'screenshot';
    case 'StubStmt':
      return 'stub';
    case 'ThinkStmt':
      return 'think';
  }
}

export function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : '/' + path;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

/** Set a header case-insensitively: HTTP header names are case-insensitive, so a later override
 * naming the same header in different casing (e.g. a per-step `header "content-type" is …`
 * overriding a config-level `header "Content-Type" is …`) must replace it, not sit alongside it
 * as a second, distinct-looking header in the report (P#46). */
function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (existing !== undefined) delete headers[existing];
  headers[name] = value;
}
