// The interpreter: walks a parsed Program, executes API-only tests via fetch, and emits the
// event stream that the reporter consumes (SPEC §4–5, §13). Design invariants:
//  - API expects evaluate once against the received response and fail fast (P#15); `wait until
//    api` is the explicit, greppable escape hatch for eventual consistency (SPEC §5.5).
//  - a hard `expect` failure (or any runtime error) ends the test immediately (P#16).
//  - request/response traces stored in the report are redacted; the live values used to send the
//    request and to evaluate assertions are the real ones (P#30).

import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { parseSource, quantifiable, renderDiagnostics, type ActionDecl, type CallExpr } from '@tflw/lang';
import type {
  A11ySeverity,
  ApiBody,
  ApiRequestSpec,
  ApiStep,
  CaptureStmt,
  EvidenceLevel,
  ExpectStmt,
  HookDecl,
  LetStmt,
  Locator as LocatorAst,
  LogStmt,
  NetworkRequestRef,
  Oauth2SessionConfig,
  PathSegment,
  Program,
  RampRpsWorkload,
  RampUsersWorkload,
  Stage,
  RedactPattern,
  SessionDecl,
  Span,
  Step,
  Subject,
  TestDecl,
  ThresholdDecl,
  WaitUntilApiStmt,
  WaitUntilUiStmt,
  Workload,
} from '@tflw/lang';
import { evalValue, interpolatePath, navigate, resolveRef, RuntimeError, stringify, type BrowserAttemptContext, type EvalCtx } from './eval.js';
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
import { headerMatchesRedactPattern, maskDetailValue, pathMatchesRedactPattern, redactFields, redactHeaderFields, redactUrlQuery } from './fieldRedact.js';
import { evaluateSchemaMatch } from './contract.js';
import { evaluateFileMatch } from './binary-match.js';
import { parseCsv } from './csv-parse.js';
import { extractPdfText } from './pdf-text.js';
import { CookieJar } from './cookieJar.js';
import { sendRequest } from './http.js';
import { AllowHostsError, allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { createPinnedAgents, destroyPinnedAgents, sendPinnedRequest, warnPinnedFallback, type PinnedAgents } from './httpPinned.js';
import { hashString, mulberry32, resolveRunClock, resolveRunSeed, subSeed } from './seed.js';
import { inferContentType } from './mime.js';
import { acquireInsecureTls, releaseInsecureTls } from './tls.js';
import type {
  AttemptResult,
  BackOffDiagnosis,
  CookieEvent,
  EventSink,
  LoadDurationStats,
  LoadIterationResult,
  LoadMetrics,
  LoadProgressSnapshot,
  LoadReport,
  LoadScenarioReport,
  LoadShardResult,
  LoadShardScenarioResult,
  LoadThresholdResult,
  LoadWorkloadRampableStage,
  LoadWorkloadReport,
  LoadWorkloadStage,
  ReportEntry,
  SerializedHistogram,
  RequestTrace,
  ResolvedConfig,
  ResponseTrace,
  RunEvent,
  RunReport,
  SelfDiagnosis,
  StepResult,
  TestResult,
  WorkloadTestResult,
} from './types.js';
import { LatencyHistogram } from './histogram.js';
import { Timeline } from './timeline.js';
import { startSelfDiagnosis, mergeSelfDiagnosis } from './selfDiagnosis.js';

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
  /** Phase 2b (D99) — `runProgram` drives this file's workload-bearing `test`s (which a separate
   * `runLoad` entry point used to own, until M91a deleted it as unreachable — `B3-06`); these four
   * fields mirror `LoadOptions`' own and are only consulted
   * when `program.tests` has at least one (`RunOutput.loadReport` stays `undefined` otherwise, same
   * as a file with no workload tests never populating one today). See each field's `LoadOptions`
   * twin for its full rationale — repeated here only where the meaning narrows. */
  readonly onIteration?: (result: LoadIterationResult) => void;
  readonly onProgressTick?: (snapshot: LoadProgressSnapshot) => void;
  readonly abortSignal?: AbortSignal;
  /** This call's striped share of every workload-bearing test's target population/rate (D19,
   * D111) — set by a forked `--workers N>1` shard worker; unset runs the whole share in this one
   * process, unchanged from before Phase 2b. Never affects functional tests (D113: sharding is
   * scoped to workload-bearing tests only). */
  readonly shard?: { readonly index: number; readonly count: number };
}

export interface RunOutput {
  /** M56 (Phase 3, D117): a workload-bearing test's finished result now lives inline in
   * `report.tests` (as a `WorkloadTestResult`, `kind: 'workload'`) alongside functional ones, in
   * file-declaration order — there is no more separate `loadReport` sibling (Phase 2b/D99 had one;
   * Phase 3 folds it in). `report.selfDiagnosis`/`inconclusive`/`aborted`/`abortedMessage` carry
   * what `LoadReport`'s own top-level fields used to, present only when this file had at least one
   * workload-bearing test that got a chance to run. Exception: when `opts.shard` is set (below),
   * any workload entries here are *provisional* — this call only ran its own shard's share, so
   * its metrics/thresholds are meaningless until merged; see `loadShardResult`. */
  readonly report: RunReport;
  /** Phase 2b (D111) — populated when `opts.shard` was set: this call's contribution is only
   * *part* of the eventual load picture (a forked `--workers N>1` worker's share, or the main
   * process's own shard-0 share), in the same compact shape a forked worker already returns — the
   * CLI merges every shard's `loadShardResult` together via `mergeLoadShardReports`, then splices
   * the real, merged result into `report.tests`' provisional workload slots via
   * `spliceLoadReportIntoRunReport` (M56). */
  readonly loadShardResult?: LoadShardResult;
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
  // Phase 2b (D99): `runProgram` drives every workload-bearing `test` in the file — this is the
  // *only* single-process path, since M91a — `expandTestCases` above already
  // skips these (unchanged), so `cases`/`results` below stay purely functional, exactly as before.
  const scenarios: LoadTest[] = filterWorkloadTests(program.tests);
  const hasWorkload = scenarios.length > 0;

  // `cases` is functional-only (`expandTestCases` skips workload-bearing tests), while the final
  // report counts both — so a file holding one workload test and nothing else announced `total: 0`
  // and ended `total: 1`, and a progress consumer rendered "0 tests" then reported a result
  // (M77, review finding B3-07). It is a forecast, not a promise: a *failing* file hook adds one
  // further entry to the report, which is why SPEC §13 says `run:end.total` may exceed this.
  emit({ type: 'run:start', total: cases.length + scenarios.length, env: config.envName });

  const results: ReportEntry[] = [];
  const fileTc: TestCtx = { environ, redactor, emit, lines, baseDir, rng: mulberry32(runSeed), runSeed, runClock, uniqueSeq, sessionCache, browserManager: opts.browserManager, filePath, updateSnapshots };
  const beforeFileOk = await runFileHooks(beforeFile, 'before file', config, fileTc, registry, results, emit);

  // Phase 2b (D109/D111/D112): group `cases` back by originating `TestDecl` — `expandTestCases`
  // walks `program.tests` in order, so every `with each` test's row-cases are always contiguous
  // here, making this grouping exact with one pass (no lookup by identity needed beyond `===`).
  interface FunctionalGroup {
    readonly test: TestDecl;
    readonly startIndex: number;
    readonly cases: TestCase[];
  }
  const functionalGroups = new Map<TestDecl, FunctionalGroup>();
  cases.forEach((kase, i) => {
    let group = functionalGroups.get(kase.test);
    if (!group) {
      group = { test: kase.test, startIndex: i, cases: [] };
      functionalGroups.set(kase.test, group);
    }
    group.cases.push(kase);
  });

  const accumulators: ScenarioAccumulator[] = scenarios.map(newScenarioAccumulator);
  const accumulatorByTest = new Map<TestDecl, ScenarioAccumulator>();
  for (const acc of accumulators) accumulatorByTest.set(acc.scenario, acc);

  // M32 (R5), carried over from `runLoadCore` — a cumulative snapshot roughly once a second for
  // the CLI's live console line; `selfDiag` only exists at all when this file actually has
  // workload-bearing tests (a purely functional file pays nothing extra here, same as before
  // Phase 2b — this whole block is a no-op when `hasWorkload` is false).
  const selfDiag = hasWorkload ? startSelfDiagnosis() : undefined;
  let iterationIndex = 0;
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  if (selfDiag && opts.onProgressTick) {
    const tick = (): void => {
      const iterations = accumulators.reduce((n, acc) => n + acc.histogram.count, 0);
      const failures = accumulators.reduce((n, acc) => n + acc.failures, 0);
      opts.onProgressTick!({ iterations, failures, elapsedMs: Math.round(performance.now() - runStart), selfDiagnosis: selfDiag.peek() });
    };
    progressTimer = setInterval(tick, 1000);
    progressTimer.unref?.();
  }
  // Session establishment for a workload-bearing test stays silent on the live event stream,
  // exactly as `tflw load` always was (`runLoadCore`'s own `tc` below) — Phase 2b unifies
  // *scheduling*, not the console-event surface, which stays a functional-tests-only concern
  // until Phase 3 (reporter) actually has something workload-shaped to render per-step.
  const scenarioCtx: ScenarioRunCtx = {
    config,
    environ,
    redactor,
    runSeed,
    runClock,
    uniqueSeq,
    sessionCache,
    tc: { ...fileTc, emit: () => {} },
    registry,
    beforeEach,
    afterEach,
    runStart,
    nextIterationIndex: () => iterationIndex++,
    onIteration: opts.onIteration,
    abortSignal: opts.abortSignal,
    shard: opts.shard,
  };

  if (beforeFileOk) {
    // Phase 2b (D109): walk `program.tests` in file order, batching consecutive `parallel` tests
    // together; a batch runs as one `Promise.all` group, a singleton batch is awaited directly —
    // today's plain sequential shape is this loop's degenerate case (every test `sequential`, the
    // default, and/or no workload tests at all). Each functional batch member runs every one of
    // its own row-cases sequentially internally (D112's last paragraph); each workload batch
    // member runs its own VU population loop exactly as `runLoadCore` always has.
    const functionalResults: (TestResult | undefined)[] = new Array(cases.length);
    // M88d (review finding `B3-11`): a workload test's finished result, built the instant its own
    // task resolves rather than in the file-order walk below, so its `test:end` can carry the very
    // object the report will hold. The walk then reads from here instead of calling
    // `finalizeScenario` a second time — one finalization per test, and the streamed result is
    // `===` the report entry rather than a look-alike rebuilt from the same accumulator.
    const workloadResults = new Map<TestDecl, WorkloadTestResult>();
    const batches = partitionIntoBatches(program.tests);
    for (const batch of batches) {
      // D114: a multi-member `parallel` batch's live events would otherwise interleave mid-block
      // on the console (two concurrent tests' step lines mixed together, no way to tell which
      // belongs to which) — a singleton batch has nothing to interleave against, so it stays on
      // the unbuffered, immediate-emit path, unchanged from before Phase 2b.
      const isBatched = batch.length > 1;
      // Bug found verifying the concurrency model (post-M53): a workload test's ramp/hold/step/
      // spike schedule (`spawnAt`/`runEnd` in `runScenarioTask`) is computed from `ctx.runStart`.
      // `scenarioCtx.runStart` is stamped once at the top of the whole file's run — fine for batch
      // 1 (its members start at essentially that instant, same as pre-Phase-2b `runLoadCore` where
      // every scenario always started together), but wrong for batch 2+: a `sequential` (the
      // default) workload test declared after any earlier batch inherits a `runStart` that's
      // already stale by however long batch 1 took, so its whole schedule window is already "in
      // the past" the moment it starts — observed as a hard 0 iterations, not degraded metrics.
      // Fix: stamp a fresh start instant per batch and use that for any workload member's ctx —
      // batch 1 sees the same wall-clock instant as before (no behavior change there).
      const batchRunStart = performance.now();
      const batchScenarioCtx: ScenarioRunCtx = { ...scenarioCtx, runStart: batchRunStart };
      const tasks: Promise<void>[] = batch.map((test) => {
        if (test.workload) {
          // M88d (review finding `B3-11`): a workload-bearing test used to emit *nothing* on the
          // live stream — no `test:start`, no `test:end` — while still being counted in
          // `report.total`, so a consumer tailing `--format ndjson` saw a run begin, silence, then
          // a finished report naming a test it had never been told about. `M77` taught this
          // emitter about file *hooks* and stopped there; this is the same defect on the second
          // surface, and worst on the longest-running kind of test, the one where streaming
          // progress is the whole point. SPEC §16.1's guarantee was not *violated* — zero starts
          // match zero ends — which is exactly how it hid; the invariant is now quantified over
          // report rows instead (D-M88-5).
          //
          // Still no `step:end`: a workload iteration's body executes silently by design (D24a/
          // D26 — only aggregate metrics are kept), so there is no step timeline to stream. The
          // pair is what `report.total` promises; the steps were never part of that promise.
          const acc = accumulatorByTest.get(test)!;
          return (async () => {
            // D114's buffering, for the same reason and by the same rule as a functional
            // row-case: inside a multi-member `parallel` batch this test's two events flush
            // together once its result is known, so a concurrent member's lines can't land
            // between a `test:start` and its `test:end`.
            const eventBuffer: RunEvent[] = [];
            const scenarioEmit: EventSink = isBatched ? (event) => eventBuffer.push(event) : emit;
            scenarioEmit({ type: 'test:start', name: test.name.value });
            await runScenarioTask(acc, batchScenarioCtx);
            const result: WorkloadTestResult = { ...finalizeScenario(acc), kind: 'workload', concurrency: test.concurrency };
            workloadResults.set(test, result);
            scenarioEmit({ type: 'test:end', result });
            if (isBatched) for (const event of eventBuffer) emit(event);
          })();
        }
        const group = functionalGroups.get(test);
        if (!group) return Promise.resolve();
        return (async () => {
          for (let j = 0; j < group.cases.length; j++) {
            const kase = group.cases[j]!;
            const globalIndex = testIndexOffset + group.startIndex + j;
            const testSeed = subSeed(runSeed, globalIndex);
            // D114: one row-case's whole event sequence (`test:start`, every `step:end`, the
            // closing `test:end`) is the atomic flush unit — buffered locally as it occurs, then
            // written to the real sink in one go the instant this case's `test:end` is known.
            // A `with each` test's rows still flush one at a time, not as one giant end-of-test
            // block, for the same "don't delay all feedback behind the slowest thing" reason D114
            // rejected withholding a whole batch's output until every member finished.
            const eventBuffer: RunEvent[] = [];
            const caseEmit: EventSink = isBatched ? (event) => eventBuffer.push(event) : emit;
            const tc: TestCtx = { environ, redactor, emit: caseEmit, lines, baseDir, rng: mulberry32(testSeed), runSeed, runClock, uniqueSeq, sessionCache, browserManager: opts.browserManager, filePath, updateSnapshots };
            // Per session *name*, not per test — a test opting into several sessions at once can
            // own the splice for one of them and not another, if some earlier test already
            // claimed a name it also opts into.
            const sessionOwnership: ReadonlyMap<string, boolean> | undefined = opts.sessionSpliceOwners
              ? new Map(kase.test.sessions.map((name) => [name, opts.sessionSpliceOwners!.get(name) === globalIndex] as const))
              : undefined;
            const result = await runTest(kase.test, config, tc, registry, beforeEach, afterEach, testSeed, kase.cells, sessionOwnership);
            functionalResults[group.startIndex + j] = result;
            const endEvent: RunEvent = { type: 'test:end', result };
            if (isBatched) {
              eventBuffer.push(endEvent);
              for (const event of eventBuffer) emit(event);
            } else {
              emit(endEvent);
            }
          }
        })();
      });
      // A singleton batch is awaited directly (D111) — today's exact sequential shape, preserved
      // as the degenerate case; a multi-member `parallel` batch launches every member together.
      if (tasks.length === 1) await tasks[0];
      else await Promise.all(tasks);
    }
    // M56 (Phase 3, D116/D117), formerly D112's "flatten `functionalResults` in place": walk
    // `program.tests` once more, this time interleaving each test's finished result — functional
    // row-cases pulled from `functionalResults` (contiguous per `FunctionalGroup`), a workload
    // test's own finalized `WorkloadTestResult` (`finalizeScenario`, reused from `buildLoadReport`)
    // — into one list in file-declaration order, regardless of kind or which batch member actually
    // finished first. Under `opts.shard`, a workload entry's metrics/thresholds here are only this
    // shard's own partial share (`finalizeScenario` doesn't know it's partial) — deliberately
    // provisional, since the real, merged result only exists once the CLI combines every shard via
    // `mergeLoadShardReports` and splices it in (`spliceLoadReportIntoRunReport`).
    for (const test of program.tests) {
      if (test.workload) {
        // M88d: finalized by this test's own task the moment it finished (above), so what the
        // report holds is the identical object its `test:end` already streamed.
        const result = workloadResults.get(test);
        if (!result) continue;
        results.push(result);
      } else {
        const group = functionalGroups.get(test);
        if (!group) continue;
        for (let j = 0; j < group.cases.length; j++) {
          const r = functionalResults[group.startIndex + j];
          if (r) results.push({ ...r, concurrency: test.concurrency });
        }
      }
    }
    await runFileHooks(afterFile, 'after file', config, fileTc, registry, results, emit);
  }

  if (progressTimer) clearInterval(progressTimer);

  // M56 (Phase 3, D117): this file's own generator-health envelope, hoisted onto `RunReport`
  // itself now that a workload test's result lives inline in `tests` rather than a sibling
  // `LoadReport`. Only computed when this file actually had a workload-bearing test that got a
  // chance to run (`beforeFileOk`) — a before-file hook failure means nothing ran at all,
  // functional or workload alike, mirroring the pre-M56 `loadReport`'s own "never fabricated"
  // rule. Under `opts.shard`, these values are likewise provisional (this shard's own reading) —
  // `spliceLoadReportIntoRunReport` overwrites them with the merged run's real values.
  let selfDiagnosis: SelfDiagnosis | undefined;
  let inconclusive: boolean | undefined;
  let aborted: boolean | undefined;
  let abortedMessage: string | undefined;
  let loadShardResult: LoadShardResult | undefined;
  if (selfDiag && beforeFileOk) {
    const diagnosis = selfDiag.stop();
    selfDiagnosis = diagnosis;
    inconclusive = diagnosis.saturated;
    if (opts.abortSignal?.aborted) {
      const plannedMs = Math.max(0, ...scenarios.map((s) => totalDurationMs(s.workload) ?? 0));
      aborted = true;
      abortedMessage = formatAbortedMessage(Math.round(performance.now() - runStart), plannedMs);
    }
    // Phase 2b (D111): `opts.shard` set means this call's contribution is only *part* of the
    // eventual load picture (a forked `--workers N>1` worker's share, or the main process's own
    // shard-0 share) — the CLI merges every shard's `loadShardResult` together via
    // `mergeLoadShardReports`, exactly as it already merges forked workers together.
    if (opts.shard) loadShardResult = buildLoadShardResult(accumulators, diagnosis);
  } else {
    selfDiag?.stop();
  }

  const passed = results.filter((r) => r.ok).length;
  const unmaskableSecrets = redactor.unmaskableNames();
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
    evidenceLevel: config.evidenceLevel,
    // `A12-01` — read after every test has run, so a secret registered by the last step still
    // counts. Omitted entirely when empty: the overwhelmingly common run has nothing to say here,
    // and an always-present empty array would push the field into every fixture and artifact.
    ...(unmaskableSecrets.length > 0 ? { unmaskableSecrets } : {}),
    ...(opts.browserManager ? { browserEngine: opts.browserManager.engine } : {}),
    ...(selfDiagnosis ? { selfDiagnosis, inconclusive } : {}),
    ...(aborted ? { aborted, abortedMessage } : {}),
  };
  // Final full-report redaction pass (decision 56, half 2): a secret registered late in this run
  // (or, when `redactor` is shared across files, by a file that ran concurrently/after this one)
  // may not have been known yet when an earlier step's trace was first redacted. Re-redacting the
  // whole report now, with the redactor in its final state, catches anything still unmasked.
  const report = redactReport(rawReport, redactor);
  emit({ type: 'run:end', report });

  return { report, redactor, ...(loadShardResult ? { loadShardResult } : {}) };
}

// ---- Load testing (M29/M30/M31, PLAN_BROWSER_PERF_SECURITY.md §2, D16-D19/D24a/D26/D28/D29/D30) -
//
// A second, dedicated execution model alongside `runProgram` above (D16) — no test cases, no
// retry, no browser support (checker-enforced, `checkScenarios`/TF033); a per-VU loop around the
// same `execSteps` every `test`/`action` body already reuses. M30 (D29) runs every `scenario` in
// the file concurrently rather than just the file's one allowed scenario (M29's restriction); M31
// (D19) layers optional multi-process scaling on top without changing this shape — `runLoadCore`
// (below) is the engine `runLoadShard` (invoked once per forked worker under `--workers N>1`)
// calls, parameterized by an optional `shard`. It had a second caller, `runLoad`, until M91a
// deleted it: a single-process load entry point nothing shipped through (`B3-06`). A scenario's own duration/failure accumulation always goes through a `LatencyHistogram`
// (`histogram.ts`) rather than a raw array — cheap enough that single-process runs pay it too
// (there's exactly one accumulation code path, not a single-process one and a sharded one), and
// it's what lets `runLoadShard`'s results ship compactly across a fork's IPC channel for
// `mergeLoadShardReports` to combine (R4).

export interface LoadOptions {
  /** Source text of the file, for mirroring each step's line (mirrors `RunOptions.source`). */
  readonly source: string;
  readonly baseDir?: string;
  readonly environ?: NodeJS.ProcessEnv;
  readonly seed?: number;
  readonly now?: string;
  /** Fired once per completed iteration — fine-grained progress a consumer can aggregate itself
   * (this file's own tests do). The CLI's live console line uses `onProgressTick` below instead,
   * since that one works identically whether iterations are happening in this process or a forked
   * worker reporting over IPC. */
  readonly onIteration?: (result: LoadIterationResult) => void;
  /** M32 (R5) — fired roughly once a second while the run is in flight with a cumulative snapshot
   * across every scenario this call is driving. The CLI's live console aggregate reads this; a
   * forked `--workers N>1` worker relays each tick to the parent over IPC so the same ~1Hz line
   * covers a multi-process run too, not just single-process. */
  readonly onProgressTick?: (snapshot: LoadProgressSnapshot) => void;
  /** M32 (R5) — when aborted, no *new* iterations start (closed-model VU loops stop looping, open-
   * model arrival scheduling stops scheduling); iterations already in flight are allowed to finish
   * naturally rather than being cut mid-request. The run still returns a full result built from
   * whatever completed — `RunReport.aborted`/`abortedMessage` (R5's "flush a
   * partial report … stamped 'aborted at Ns of Nm planned'") is what the CLI's SIGINT handler
   * relies on to hand back real evidence instead of nothing. */
  readonly abortSignal?: AbortSignal;
  /** M31 (D19) — when set, this call runs only this shard's striped share of every scenario's
   * workload target (`shareOfWorkloadTarget`), and every iteration draws its reproducible sub-seed
   * (P#23) from a globally-unique index across every shard (`globalIterationIndex`) — the two
   * pieces of "no message passing" coordination D19 asks for: each shard only needs its own
   * `index`/`count`, never anything from its siblings. Set by the CLI's forked worker processes
   * under `--workers N>1`; unset (the default) runs the whole file in this one process, unchanged
   * from M29/M30. */
  readonly shard?: { readonly index: number; readonly count: number };
}

/** This shard's share of a workload `target` (a scenario's `users` or `rps`) — split as evenly as
 * an integer split allows, remainder handed to the lowest-indexed shards first. Every shard's
 * share summed back together always equals `target` exactly (D19: "processes stripe … by index").
 * `shard` undefined (single-process) is the identity split — the whole target, one "shard".
 *
 * That exactness is a property of **one** call and guarantees nothing about two composed. A target
 * smaller than `shard.count` gives the higher-indexed shards 0, so striping a second axis over the
 * same `shard` hands work to shards that a first axis already emptied — `B3-01`, where the shared
 * iteration pool was split across shards that had no VU to run it. Callers striping two related
 * axes must reconcile them (see `SharedIterationsWorkload`), not assume the sums compose. */
export function shareOfWorkloadTarget(target: number, shard?: { readonly index: number; readonly count: number }): number {
  if (!shard) return target;
  const base = Math.floor(target / shard.count);
  const remainder = target % shard.count;
  return base + (shard.index < remainder ? 1 : 0);
}

/** The globally-unique iteration index a shard's `localIndex`-th iteration maps to — `id ≡
 * shard.index mod shard.count` (D19) — so two different shards' sub-seeds (`subSeed(runSeed, …)`)
 * never collide without either shard needing to know anything about the other beyond its own
 * `index`/`count`. Single-process (`shard` undefined) is the identity map. */
export function globalIterationIndex(localIndex: number, shard?: { readonly index: number; readonly count: number }): number {
  return shard ? localIndex * shard.count + shard.index : localIndex;
}

/** M52 (Phase 2, PLAN_UNIFIED_TEST_WORKLOAD.md) — this workload's total planned wall-clock span,
 * or `null` for the 2 count-based kinds (D102 — there's no duration to speak of, the VU loop runs
 * until its iteration budget is spent, not a clock). `Ramp`/`Hold` have one duration field each;
 * `Step`/`Spike` sum every stage's own `durationMs`. */
function totalDurationMs(workload: Workload): number | null {
  switch (workload.type) {
    case 'RampUsersWorkload':
    case 'RampRpsWorkload':
      return workload.overMs;
    case 'HoldUsersWorkload':
    case 'HoldRpsWorkload':
      return workload.forMs;
    case 'StepUsersWorkload':
    case 'StepRpsWorkload':
    case 'SpikeUsersWorkload':
    case 'SpikeRpsWorkload':
      return workload.stages.reduce((sum, s) => sum + s.durationMs, 0);
    case 'SharedIterationsWorkload':
    case 'PerVuIterationsWorkload':
      return null;
  }
}

/** M52 — the live target population (VU count or arrival rate, same unit `stages` was declared in)
 * at `elapsedMs` into a `step`/`spike` workload's stage list. A `mode: 'jump'` stage (`step`'s only
 * kind; `spike`'s `hold N for …`) is flat at its own `target` for its whole span. A `mode: 'ramp'`
 * stage (`spike`'s `to N over …`) linearly interpolates from the *previous* stage's ending target
 * (0 before the first stage) to its own `target` across its own span — this is what lets a `spike`
 * ramp back down, not just up: interpolating toward a lower target shrinks the live population
 * exactly like ramping toward a higher one grows it, no separate "ramp down" case needed. Each
 * stage's own `target` is striped by `shard` independently (not just the schedule's overall max),
 * so every shard runs its own even share of *every* stage, not just the busiest one. Fractional
 * (interpolation mid-ramp) — callers compare a 0-based VU index against it, so `i < target` is the
 * right comparison, same as an integer target. */
function stageTargetAt(stages: readonly Stage[], elapsedMs: number, shard?: { readonly index: number; readonly count: number }): number {
  let cursor = 0;
  let prevTarget = 0;
  for (const stage of stages) {
    const stageTarget = shareOfWorkloadTarget(stage.target, shard);
    const stageEnd = cursor + stage.durationMs;
    if (elapsedMs < stageEnd) {
      if (stage.mode === 'jump') return stageTarget;
      const frac = stage.durationMs > 0 ? (elapsedMs - cursor) / stage.durationMs : 1;
      return prevTarget + (stageTarget - prevTarget) * Math.max(0, Math.min(1, frac));
    }
    cursor = stageEnd;
    prevTarget = stageTarget;
  }
  return prevTarget;
}

/** M52 — how often an idle VU (closed) or an idle arrival scheduler (open, target rate 0)
 * re-checks whether it should start working again. Small enough that `hold`/`step`/`spike`'s
 * stage transitions feel responsive in a report's timeline, large enough not to busy-loop. */
const POPULATION_POLL_INTERVAL_MS = 100;

/** M52 — the shared VU engine for `hold`/`step`/`spike`'s closed (users) variants: `maxVus` VU
 * slots each independently loop, for as long as the schedule runs, doing one of two things every
 * tick: if their own 0-based index is currently below `targetUsersAt(elapsedMs)`, run an iteration
 * back-to-back; otherwise idle-poll. This handles a flat target (`hold`), a staircase (`step`), and
 * a mixed jump/ramp schedule in either direction (`spike`, including ramping *down*) uniformly,
 * unlike the fixed spawn-time math `ramp to … users …` uses (D17) — that closed-form schedule only
 * ever grows monotonically once a VU spawns, which a `spike`'s ramp-down leg can't be. A VU that's
 * never active for the whole run (e.g. this shard's share rounded a stage's target below its index)
 * never opens a pinned connection pair at all. */
async function runClosedPopulationVus(
  runStart: number,
  scheduleMs: number,
  maxVus: number,
  targetUsersAt: (elapsedMs: number) => number,
  runIteration: (pinnedAgents?: PinnedAgents) => Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  const scheduleEnd = runStart + scheduleMs;
  const vuPromises: Promise<void>[] = [];
  for (let i = 0; i < maxVus; i++) {
    vuPromises.push(
      (async () => {
        let pinnedAgents: PinnedAgents | undefined;
        try {
          while (performance.now() < scheduleEnd && !abortSignal?.aborted) {
            if (i < targetUsersAt(performance.now() - runStart)) {
              if (!pinnedAgents) pinnedAgents = createPinnedAgents();
              await runIteration(pinnedAgents);
            } else {
              await sleep(POPULATION_POLL_INTERVAL_MS, abortSignal);
            }
          }
        } finally {
          if (pinnedAgents) destroyPinnedAgents(pinnedAgents);
        }
      })(),
    );
  }
  await Promise.all(vuPromises);
}

/** M52 — the shared arrival scheduler for `hold`/`step`/`spike`'s open (rps) variants: repeatedly
 * re-samples the *current* target rate (`targetRpsAt`) and schedules the next arrival `1000/rate`
 * ms later — a self-adjusting approximation of a time-varying-rate arrival process. Unlike `ramp to
 * … rps …`'s closed-form inverse-CDF schedule (D17, exact for one linear ramp from a standing
 * start), this generalizes to a flat rate, a staircase, or a mixed jump/ramp schedule (including a
 * rate that drops) without a different formula per shape, converging to the same aggregate
 * behavior. A rate of 0 (e.g. between a `spike`'s stages, if one is ever written that way) idle-
 * polls rather than dividing by zero. */
async function runOpenPopulationArrivals(
  runStart: number,
  scheduleMs: number,
  targetRpsAt: (elapsedMs: number) => number,
  runIteration: () => Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  const scheduleEnd = runStart + scheduleMs;
  const vuPromises: Promise<void>[] = [];
  let cursor = runStart;
  while (cursor < scheduleEnd && !abortSignal?.aborted) {
    const rps = targetRpsAt(cursor - runStart);
    if (rps <= 0) {
      cursor += POPULATION_POLL_INTERVAL_MS;
      const waitMs = cursor - performance.now();
      if (waitMs > 0) await sleep(waitMs, abortSignal);
      continue;
    }
    cursor += 1000 / rps;
    const waitMs = cursor - performance.now();
    if (waitMs > 0) await sleep(waitMs, abortSignal);
    if (abortSignal?.aborted) break;
    // Fire-and-forget, same reasoning as `RampRpsWorkload`'s own loop: the arrival schedule doesn't
    // wait on an iteration's completion, but its promise is still collected so this scenario's task
    // waits for every fired iteration before returning.
    vuPromises.push(runIteration());
  }
  await Promise.all(vuPromises);
}

/** A `test` block with a non-null `workload` — what used to be a standalone `ScenarioDecl` before
 * M50 (D93-D95) collapsed `scenario` into `test`, kind inferred from this field's presence. Kept
 * as a local narrowed alias (rather than threading `TestDecl['workload'] | null` checks through
 * every function below) since every load-engine function here only ever receives one that's
 * already been filtered by `test.workload !== null` (`runLoadCore`'s `scenarios` derivation).
 * Covers every workload kind (M52, PLAN_UNIFIED_TEST_WORKLOAD.md Phase 2) — Phase 1b (D97) added
 * grammar/AST for `hold`/`step`/`spike`/the 2 iteration forms; M52 taught this engine to actually
 * run them. Exported for tests that build a `LoadTest` directly rather than filtering a parsed
 * `Program`. */
export type LoadTest = TestDecl & { readonly workload: Workload };

/** Every workload-bearing `test` in `tests`, any kind. */
function filterWorkloadTests(tests: readonly TestDecl[]): LoadTest[] {
  return tests.filter((t): t is LoadTest => t.workload !== null);
}

/** One mutable accumulator per scenario, filled in by that scenario's own `runIteration` closure
 * as its VUs run concurrently with every other scenario's. */
interface ScenarioAccumulator {
  readonly scenario: LoadTest;
  readonly histogram: LatencyHistogram;
  /** M89a (`B3-02`, D-M89-0) — the same durations, recorded only when the iteration **succeeded**;
   * this is what a `threshold pNN duration` clause reads. Kept as a *second* histogram rather than
   * by splitting the first, so `histogram.count` keeps meaning "iterations" everywhere it is
   * already read as one — `buildLoadMetrics`'s `errorRate: failures / histogram.count`, the live
   * progress tick, `LoadShardScenarioResult.iterations`. Splitting the first would have turned that
   * denominator into `failures / successes` silently: 960 failures over 40 successes reports a
   * 2400 % error rate. */
  readonly successHistogram: LatencyHistogram;
  /** M32 (R3/R4) — this scenario's own per-second buckets, feeding `load-report.html`'s timeline
   * charts once shaped into `LoadMetrics.timeline`. */
  readonly timeline: Timeline;
  failures: number;
  /** M34 (D17) — split by which half of the scenario's own wall-clock window (`overMs / 2`) an
   * iteration's *start* landed in, regardless of workload model (only consumed by `computeBackOff`
   * for a closed-model scenario, but cheap enough to track unconditionally rather than branching
   * the recording code on workload type). */
  early: { count: number; sum: number };
  late: { count: number; sum: number };
  /** M43 (D67-D69, R6's per-endpoint axis) — keyed by `apiStepIdentity` (explicit tag or automatic
   * `METHOD path.raw`); filled in as identities are first seen during the run, not pre-seeded from
   * `scenario.body` (a scenario can end every iteration early on a failure before reaching a later
   * step, and that's real data, not a gap to paper over). `buildLoadReportEndpoints` re-orders this
   * into source order and fills in a zero-sample entry for any declared identity never reached. */
  readonly endpoints: Map<string, EndpointAccumulator>;
}

/** M43 (D67-D69) — one endpoint identity's own accumulators. M89a adds `successHistogram`, the
 * per-endpoint half of `B3-02`: a `threshold … for "label"` clause reads that one, and it is the
 * scope `checkout-burst` — the perf arc's own k6 acceptance benchmark — actually thresholds on. */
interface EndpointAccumulator {
  histogram: LatencyHistogram;
  successHistogram: LatencyHistogram;
  timeline: Timeline;
  failures: number;
}

/** M89a — the one place a `ScenarioAccumulator` is born. Both call sites (`runProgramInner`'s
 * unified per-file dispatch and `runLoadCore`) previously open-coded the same 8-line literal, so
 * adding `successHistogram` would have needed both to be edited in step — two copies that must
 * agree, in a milestone whose whole subject is two copies that did not (`B3-03`'s rival
 * `describeWorkload`s). One function instead. */
function newScenarioAccumulator(scenario: LoadTest): ScenarioAccumulator {
  return {
    scenario,
    histogram: new LatencyHistogram(),
    successHistogram: new LatencyHistogram(),
    timeline: new Timeline(),
    failures: 0,
    early: { count: 0, sum: 0 },
    late: { count: 0, sum: 0 },
    endpoints: new Map(),
  };
}

interface LoadCoreResult {
  readonly accumulators: readonly ScenarioAccumulator[];
  readonly selfDiagnosis: SelfDiagnosis;
  readonly runSeed: number;
  readonly runClock: Date;
  readonly startedAt: string;
  readonly runStart: number;
  /** M32 (R5) — whether `opts.abortSignal` was aborted by the time every scenario's VUs finished
   * (Ctrl-C stopped new iterations from starting, then in-flight ones were let finish). */
  readonly aborted: boolean;
  /** The longest scenario's planned `overMs` in this file — "Nm planned" in an aborted run's
   * `abortedMessage`. */
  readonly plannedMs: number;
}

/** Everything one scenario's task (`runScenarioTask` below) needs that isn't specific to that one
 * scenario — shared across every scenario in a `runLoadCore` call (unchanged, all-scenarios-
 * concurrent) or, since Phase 2b (D109/D111), across just one `parallel` batch's workload members
 * in the unified per-file dispatch (`runProgramInner`). `tc` carries the (possibly silent, `emit:
 * () => {}`) context used for session establishment; `nextIterationIndex` is a shared, monotonic
 * counter so every iteration across every scenario in scope still gets its own globally-unique
 * sub-seed (P#23), exactly as `runLoadCore`'s own local `iterationIndex` did before this
 * extraction. */
interface ScenarioRunCtx {
  readonly config: ResolvedConfig;
  readonly environ: NodeJS.ProcessEnv;
  readonly redactor: Redactor;
  readonly runSeed: number;
  readonly runClock: Date;
  readonly uniqueSeq: { next(): number };
  readonly sessionCache: SessionCache;
  readonly tc: TestCtx;
  readonly registry: CallRegistry;
  readonly beforeEach: readonly HookDecl[];
  readonly afterEach: readonly HookDecl[];
  readonly runStart: number;
  readonly nextIterationIndex: () => number;
  readonly onIteration?: (result: LoadIterationResult) => void;
  readonly abortSignal?: AbortSignal;
  readonly shard?: { readonly index: number; readonly count: number };
}

/** Runs one scenario's session establishment + VU scheduling to completion — extracted from
 * `runLoadCore`'s own `scenarioTasks.map(async (acc) => { ... })` callback (M50-era) so the
 * unified per-file dispatch (`runProgramInner`, Phase 2b/D111) can launch a workload-bearing
 * batch member's task the exact same way `runLoadCore` launches every scenario's, without
 * duplicating this logic. `sessionCache` is safe under concurrent `ensure()` calls (dedupes
 * in-flight promises by name), so two scenarios opting into the same session, whether inside one
 * `runLoadCore` call or one `parallel` batch, never race a duplicate login. Scheduling an *open*-
 * workload scenario's arrivals genuinely blocks its own task on real-time sleeps below — that must
 * never block a sibling task in the same batch/call, or concurrent execution wouldn't actually
 * overlap in wall time, defeating the whole point (originally D29, now equally true of D109). */
async function runScenarioTask(acc: ScenarioAccumulator, ctx: ScenarioRunCtx): Promise<void> {
  const scenario = acc.scenario;
  const { config, environ, redactor, runSeed, runClock, uniqueSeq, sessionCache, tc, registry, beforeEach, afterEach, runStart, nextIterationIndex, onIteration, abortSignal, shard } = ctx;

  for (const sessionName of scenario.sessions) {
    const decl = config.sessions.get(sessionName);
    if (!decl) throw new RuntimeError(`unknown session "${sessionName}" — is it declared in tflw.config?`);
    const outcome = await sessionCache.ensure(sessionName, decl, config, tc, true);
    if (!outcome.ok) throw new RuntimeError(`session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`);
  }

  // M45 (D75) — `pinnedAgents` is set only by the closed-model (`RampUsersWorkload`) VU spawn
  // loop below, one pair created per VU and reused across every iteration that VU runs; an
  // open-model (rate-based) arrival has no persistent "VU" to pin a connection to (each arrival
  // is its own fire-and-forget iteration, D75's design sketch cites only the closed-model spawn
  // block), so it stays on `sendRequest`'s unpinned path exactly as before.
  const runIteration = async (pinnedAgents?: PinnedAgents): Promise<void> => {
    const index = globalIterationIndex(nextIterationIndex(), shard);
    const iterTc: TestCtx = { ...tc, rng: mulberry32(subSeed(runSeed, index)), pinnedAgents };
    const scope = new Map<string, unknown>();
    // D44 (M37, PLAN_BROWSER_PERF_SECURITY.md §2.8): every iteration reads each session fresh
    // from the shared cache, instead of cloning a snapshot frozen before the VU loop started.
    // This is the fix for the bug D43 found: `refreshSessions` (below) only ever wrote a
    // reactive 401 refresh into *its own* iteration's headers, never back into a shared
    // snapshot every other iteration cloned from — so once a session's credential first went
    // stale mid-run, every subsequent iteration paid for its own re-login, forever. Reading the
    // cache fresh here means any VU's refresh becomes immediately visible to every other VU's
    // next iteration, and an `oauth2` session's proactive TTL re-check (`ensure()`'s own logic)
    // applies here too, which the old snapshot design never benefited from either.
    const sessionHeaders: Record<string, string> = {};
    const cookieJar = new CookieJar();
    const sessionRefs = new Map<string, SessionRef>();
    for (const sessionName of scenario.sessions) {
      const decl = config.sessions.get(sessionName);
      if (!decl) throw new RuntimeError(`unknown session "${sessionName}" — is it declared in tflw.config?`);
      const outcome = await sessionCache.ensure(sessionName, decl, config, iterTc, false);
      if (!outcome.ok) throw new RuntimeError(`session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`);
      Object.assign(sessionHeaders, outcome.headers);
      cookieJar.mergeFrom(outcome.cookieJar.clone());
      const ref = sessionCache.currentRef(sessionName);
      if (ref !== undefined) sessionRefs.set(sessionName, ref);
    }
    const ctx: EvalCtx = {
      scope,
      environ,
      redactor,
      rng: iterTc.rng,
      runSeed,
      runClock,
      uniqueSeq,
      sessionHeaders,
      sessionNames: scenario.sessions,
      sessionRefs,
      cookieJar,
    };
    const iterStart = performance.now();
    let result: LoadIterationResult;
    // M43 (D67-D69) — the scenario body's own `exec.steps`, captured regardless of whether the
    // iteration goes on to pass or fail (a failed iteration's completed `api` steps are still
    // real per-endpoint samples). Stays `undefined` only when the failure happened before
    // `scenario.body` ever ran (a `before each` hook or session-establishment error) — nothing to
    // attribute in that case.
    let iterSteps: readonly StepResult[] | undefined;
    try {
      for (const hook of beforeEach) {
        const exec = await execSteps(hook.body, config, ctx, iterTc, scenario.name.value, registry);
        if (!exec.ok) throw new RuntimeError(exec.error ?? 'a `before` hook failed');
      }
      const exec = await execSteps(scenario.body, config, ctx, iterTc, scenario.name.value, registry);
      iterSteps = exec.steps;
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
      const pauseMs = exec.steps.filter((s) => s.kind === 'pause').reduce((sum, s) => sum + s.durationMs, 0);
      result = { ok: true, scenario: scenario.name.value, durationMs: Math.max(0, Math.round(performance.now() - iterStart - pauseMs)) };
    } catch (err) {
      const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
      // Pause time isn't tracked on the thrown-error path (no `exec.steps` to inspect) — a
      // negligible skew: a failure that happens after a `pause` still counts that pacing time as
      // part of its own (already-failing, already-excluded-from-percentiles-by-nobody-caring)
      // duration. Only successful iterations feed the duration percentiles that thresholds read.
      result = { ok: false, scenario: scenario.name.value, durationMs: Math.round(performance.now() - iterStart), error: redactor.redact(message) };
    }
    if (!result.ok) acc.failures++;
    acc.histogram.record(result.durationMs);
    // M89a (`B3-02`, D-M89-0) — the line above keeps recording *every* iteration, so `iterations`,
    // `failures` and `errorRate` are unchanged; this one is the population a `threshold pNN
    // duration` clause reads. Until M89a the comment 4 lines up claimed this was already true and
    // the code one line down falsified it — the claim was the correct design, so it is now
    // implemented rather than deleted.
    if (result.ok) acc.successHistogram.record(result.durationMs);
    recordEndpointMetrics(acc, iterSteps, runStart);
    acc.timeline.record((performance.now() - runStart) / 1000, result.durationMs, result.ok);
    // M34 (D17) — which half of the scenario's own wall-clock window this iteration *started*
    // in, by real elapsed time (not request order — see `computeBackOff`'s doc for why an
    // elapsed-time split is the robust choice here). Only ever read back for a closed-model
    // scenario, but recorded unconditionally: cheap, and one fewer branch to keep in sync with
    // `scenario.workload.type` elsewhere. M52: `null` for the 2 count-based kinds (no duration to
    // halve) — the split still has to land somewhere, and `computeBackOff` never reads it back
    // for those kinds anyway (D102), so an all-"early" split is harmless, not just unused.
    const scheduleMs = totalDurationMs(scenario.workload);
    const half = scheduleMs === null || iterStart - runStart < scheduleMs / 2 ? acc.early : acc.late;
    half.count++;
    half.sum += result.durationMs;
    onIteration?.(result);
  };

  const vuPromises: Promise<void>[] = [];
  if (scenario.workload.type === 'RampUsersWorkload') {
    // Closed model (D17): VUs loop continuously once spawned. `users` VUs ramp in linearly over
    // `overMs`; the scenario itself lasts exactly `overMs` (no separate "hold" stage in the
    // grammar). M31: only this shard's striped share of `users` actually spawns here — the loop
    // simply doesn't run when that share is 0 (a small target split across more shards than it
    // has room for), no special-casing needed.
    const { overMs } = scenario.workload;
    const users = shareOfWorkloadTarget(scenario.workload.users, shard);
    const runEnd = runStart + overMs;
    for (let i = 0; i < users; i++) {
      const spawnAt = runStart + (i / users) * overMs;
      vuPromises.push(
        (async () => {
          const waitMs = spawnAt - performance.now();
          if (waitMs > 0) await sleep(waitMs, abortSignal);
          // M45 (D75): one pinned connection pair for this VU's whole lifetime, created after its
          // ramp-in wait (so an idle-waiting VU holds no open socket) and torn down once its loop
          // exits — Ctrl-C or `runEnd`, either way, never left open for the rest of the process.
          const pinnedAgents = createPinnedAgents();
          try {
            // M32 (R5): Ctrl-C stops this VU from *starting* another iteration — whichever
            // iteration it's mid-`runIteration()` on (if any) still runs to completion above.
            while (performance.now() < runEnd && !abortSignal?.aborted) await runIteration(pinnedAgents);
          } finally {
            destroyPinnedAgents(pinnedAgents);
          }
        })(),
      );
    }
  } else if (scenario.workload.type === 'RampRpsWorkload') {
    // Open model (D17): arrivals are scheduled at a target rate that itself ramps linearly from
    // 0 to `rps` over `overMs`, independent of whether earlier iterations have finished — the
    // schedule never waits on completion, so queueing under saturation is real, not smoothed
    // away. Cumulative arrivals by time t (seconds) under a linear ramp: N(t) = rps·t²/(2·overS);
    // solving for the k-th arrival's time inverts that: t_k = √(2k·overS / rps). M31: `rps` here
    // is already this shard's striped share (`shareOfWorkloadTarget`) — every shard schedules
    // its own slice of the file's total arrival rate independently.
    const { overMs } = scenario.workload;
    const rps = shareOfWorkloadTarget(scenario.workload.rps, shard);
    const overS = overMs / 1000;
    const totalArrivals = rps > 0 ? Math.floor((rps * overS) / 2) : 0;
    // M32 (R5): checked both before *and* after the wait — an abort that lands mid-sleep must
    // stop this scenario from scheduling one more arrival once `sleep` returns early, not just
    // catch the next iteration of the loop.
    for (let k = 1; k <= totalArrivals && !abortSignal?.aborted; k++) {
      const scheduledMs = Math.sqrt((2 * k * overS) / rps) * 1000;
      const waitMs = runStart + scheduledMs - performance.now();
      if (waitMs > 0) await sleep(waitMs, abortSignal);
      if (abortSignal?.aborted) break;
      // Fire-and-forget: the arrival schedule doesn't wait on this iteration's completion
      // (that's the whole point of "open") — its promise is still collected so this scenario's
      // own task (and, transitively, the whole run) waits for every fired iteration.
      vuPromises.push(runIteration());
    }
  } else if (scenario.workload.type === 'HoldUsersWorkload') {
    // D97: a flat target for the whole duration, no ramp-in — every VU is live from t=0, so the
    // generic population engine's "am I below the live target" check is trivially true for every
    // spawned VU the whole time (no idle polling actually happens).
    const { users, forMs } = scenario.workload;
    const targetVus = shareOfWorkloadTarget(users, shard);
    vuPromises.push(runClosedPopulationVus(runStart, forMs, targetVus, () => targetVus, runIteration, abortSignal));
  } else if (scenario.workload.type === 'HoldRpsWorkload') {
    // D97: a constant target arrival rate for the whole duration — every inter-arrival gap is
    // `1000/rps`, no ramp.
    const { rps, forMs } = scenario.workload;
    const targetRps = shareOfWorkloadTarget(rps, shard);
    vuPromises.push(runOpenPopulationArrivals(runStart, forMs, () => targetRps, () => runIteration(), abortSignal));
  } else if (scenario.workload.type === 'StepUsersWorkload' || scenario.workload.type === 'SpikeUsersWorkload') {
    // D97: a staircase (`step`, every stage `mode: 'jump'`) or a mixed jump/ramp schedule
    // (`spike`) — `stageTargetAt` handles both uniformly, ramp legs included (up or down).
    const { stages } = scenario.workload;
    const scheduleMs2 = stages.reduce((sum, s) => sum + s.durationMs, 0);
    const maxVus = shareOfWorkloadTarget(Math.max(...stages.map((s) => s.target)), shard);
    vuPromises.push(runClosedPopulationVus(runStart, scheduleMs2, maxVus, (elapsedMs) => stageTargetAt(stages, elapsedMs, shard), runIteration, abortSignal));
  } else if (scenario.workload.type === 'StepRpsWorkload' || scenario.workload.type === 'SpikeRpsWorkload') {
    const { stages } = scenario.workload;
    const scheduleMs2 = stages.reduce((sum, s) => sum + s.durationMs, 0);
    vuPromises.push(runOpenPopulationArrivals(runStart, scheduleMs2, (elapsedMs) => stageTargetAt(stages, elapsedMs, shard), () => runIteration(), abortSignal));
  } else if (scenario.workload.type === 'SharedIterationsWorkload') {
    // D97: `vus` VUs pull from one shared pool of `iterations` total iterations until it's
    // exhausted — no duration, no ramp. Decrementing `remaining` synchronously before the
    // `await runIteration()` below is race-free: Node is single-threaded, so nothing else can
    // observe `remaining` between the check and the decrement.
    const { iterations, vus } = scenario.workload;
    const targetVus = shareOfWorkloadTarget(vus, shard);
    // B3-01 (M79): the iteration pool is striped across the shards that actually *got* a VU, not
    // across all of `shard.count`. Striping both axes independently drops work on the floor
    // whenever `vus < shard.count`: `shareOfWorkloadTarget` hands the whole population to the
    // lowest `vus` shards, so every higher-indexed shard enters this branch with `targetVus === 0`,
    // never runs the loop below, and silently takes its share of `iterations` to the grave —
    // `run 100 iterations across 2 users` executed 50 under `--workers 4` and 26 under `--workers
    // 8`, reporting `✓ PASS`. `shareOfWorkloadTarget`'s "shares always sum back to `target`" is
    // true of one call and says nothing about two composed. Restricting the iteration split to
    // `min(count, vus)` shards makes the two axes agree — the shards with a VU are exactly the
    // shards with iterations — and is a no-op in the `vus >= count` case, which is every run where
    // `--workers` is doing what it's for.
    const iterationShard = shard && { index: shard.index, count: Math.min(shard.count, vus) };
    const targetIterations = targetVus === 0 ? 0 : shareOfWorkloadTarget(iterations, iterationShard);
    let remaining = targetIterations;
    for (let i = 0; i < targetVus; i++) {
      vuPromises.push(
        (async () => {
          const pinnedAgents = createPinnedAgents();
          try {
            while (remaining > 0 && !abortSignal?.aborted) {
              remaining--;
              await runIteration(pinnedAgents);
            }
          } finally {
            destroyPinnedAgents(pinnedAgents);
          }
        })(),
      );
    }
  } else {
    // PerVuIterationsWorkload (D97): each of `vus` VUs runs exactly `iterationsPerVu` iterations,
    // independently of every other VU — no shared pool, no duration.
    const { iterationsPerVu, vus } = scenario.workload;
    const targetVus = shareOfWorkloadTarget(vus, shard);
    for (let i = 0; i < targetVus; i++) {
      vuPromises.push(
        (async () => {
          const pinnedAgents = createPinnedAgents();
          try {
            for (let n = 0; n < iterationsPerVu && !abortSignal?.aborted; n++) await runIteration(pinnedAgents);
          } finally {
            destroyPinnedAgents(pinnedAgents);
          }
        })(),
      );
    }
  }

  await Promise.all(vuPromises);
}

/** D109 (Phase 2b) — a maximal run of consecutive `concurrency: 'parallel'` tests forms one batch
 * that executes concurrently (`Promise.all`, D111); every `'sequential'` test (the default) is its
 * own singleton batch, awaited alone. Batches themselves always run in file order — batch N+1
 * never starts before batch N fully finishes — declaration order still anchors everything (D109
 * supersedes D100's "never batched" wording, not D101's file-order backbone). A lone `'parallel'`
 * test with no adjacent `'parallel'` neighbor is still a singleton batch — tagging it `parallel`
 * only matters once it actually has a neighbor to run alongside. */
function partitionIntoBatches(tests: readonly TestDecl[]): TestDecl[][] {
  const batches: TestDecl[][] = [];
  for (const test of tests) {
    const last = batches[batches.length - 1];
    if (test.concurrency === 'parallel' && last && last[0]!.concurrency === 'parallel') {
      last.push(test);
    } else {
      batches.push([test]);
    }
  }
  return batches;
}

/** The engine behind `runLoadShard` — everything through "every scenario's VUs have finished,"
 * before the caller shapes the accumulators into a compact, IPC-ready `LoadShardResult`. It had a
 * second caller, `runLoad`, which shaped them into a full `LoadReport` instead; M91a deleted that
 * one (`B3-06` — no production path went through it). Never throws for an iteration failure (D18: an `expect`
 * inside a scenario aborts *that iteration*, counted toward its error rate, never the run) — only
 * a setup failure (bad session, zero scenarios) throws. All scenarios in one call share one
 * process, one `uniqueSeq`, and one `SessionCache` (a session named by two scenarios establishes
 * once, reused by both — same run-lifetime cache `test … as <session>` uses). */
async function runLoadCore(program: Program, config: ResolvedConfig, opts: LoadOptions): Promise<LoadCoreResult> {
  // M50 (D93-D95): a "scenario" is now any `test` block whose `workload` is non-null — `scenario`
  // no longer exists as its own keyword/array. `tflw load` (this function's caller) only ever
  // wants the workload-bearing subset of a file's `program.tests`.
  const scenarios: LoadTest[] = filterWorkloadTests(program.tests);
  if (scenarios.length === 0) {
    // `B3-08` (M90c): this used to name `tflw load`, a command M53 removed — and naming `tflw run`
    // instead would be a second lie in the same sentence, because `tflw run` on such a file does
    // not error, it runs the functional tests. It is a *library* precondition, so it names no
    // command at all. `B5-13` recorded the sharper half the row understated: the message is
    // unreachable in the shipped product, and its only test drove it through `runLoad`, an entry
    // point production never called. M91a (`D-M91-3`) closed that half — `runLoad` is deleted, and
    // the guard's one surviving caller is `runLoadShard`, which is where the test drives it now.
    // Still unreachable for a user (`cli.ts` checks `hasWorkload` before forking a shard), and the
    // guard still stays: it is `runLoadShard`'s documented precondition, and a future third caller
    // deserves it.
    throw new RuntimeError('this program has no workload-bearing `test` — a load run needs at least one `ramp to …` line, found 0');
  }
  const selfDiag = startSelfDiagnosis();
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
  // (P#23) regardless of which scenario spawned it — mirrors the single-scenario counter M29 used;
  // `globalIterationIndex` (M31) turns this shard-local counter into a cross-shard-unique id.
  let iterationIndex = 0;

  const accumulators: ScenarioAccumulator[] = scenarios.map(newScenarioAccumulator);

  // M32 (R5) — a cumulative snapshot roughly once a second, for the CLI's live console line.
  // `unref()` so a tick left pending never keeps the process alive on its own (mirrors
  // `startSelfDiagnosis`'s own timer, `selfDiagnosis.ts`).
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  if (opts.onProgressTick) {
    const tick = (): void => {
      const iterations = accumulators.reduce((n, acc) => n + acc.histogram.count, 0);
      const failures = accumulators.reduce((n, acc) => n + acc.failures, 0);
      opts.onProgressTick!({ iterations, failures, elapsedMs: Math.round(performance.now() - runStart), selfDiagnosis: selfDiag.peek() });
    };
    progressTimer = setInterval(tick, 1000);
    progressTimer.unref?.();
  }

  const scenarioCtx: ScenarioRunCtx = {
    config,
    environ,
    redactor,
    runSeed,
    runClock,
    uniqueSeq,
    sessionCache,
    tc,
    registry,
    beforeEach,
    afterEach,
    runStart,
    nextIterationIndex: () => iterationIndex++,
    onIteration: opts.onIteration,
    abortSignal: opts.abortSignal,
    shard: opts.shard,
  };
  // Batch by each test's own `parallel`/`sequential` field (D109), same as the unified
  // `runProgramInner` dispatch — `runLoadCore` used to `Promise.all` every scenario unconditionally
  // (pre-Phase-2b, when "every scenario in the file" and "every scenario declared `parallel`" were
  // the same thing by definition). Left unconditional here, a `sequential` scenario would ignore
  // its own declared ordering under `--workers N>1` (this engine is also `runLoadShard`'s core):
  // shard 0 (the unified path) would correctly keep two `sequential` scenarios apart, while every
  // forked shard 1..N-1 raced them together, an inconsistency the user's own `--parallel`/`--workers`
  // resolution explicitly ruled out ("make sure all of it also respect tests own parallel/sequential
  // keyword"). Batching (and each batch's own fresh `runStart`, same fix as `runProgramInner`'s)
  // restores that — a functional member of a mixed batch is simply not in `scenarios`/`accumulatorByTest`
  // and is skipped, exactly as before (D113: no functional test ever runs inside this engine).
  const accumulatorByTest = new Map<TestDecl, ScenarioAccumulator>();
  for (const acc of accumulators) accumulatorByTest.set(acc.scenario, acc);
  for (const batch of partitionIntoBatches(program.tests)) {
    const members = batch.filter((t): t is LoadTest => t.workload !== null);
    if (members.length === 0) continue;
    const batchScenarioCtx: ScenarioRunCtx = { ...scenarioCtx, runStart: performance.now() };
    const tasks = members.map((scenario) => runScenarioTask(accumulatorByTest.get(scenario)!, batchScenarioCtx));
    if (tasks.length === 1) await tasks[0];
    else await Promise.all(tasks);
  }
  if (progressTimer) clearInterval(progressTimer);
  const selfDiagnosis = selfDiag.stop();
  // M52: a count-based scenario contributes 0 — there's no way to predict its wall-clock length in
  // advance (D102), so it simply doesn't influence "how long the file's run was meant to take."
  const plannedMs = Math.max(0, ...scenarios.map((s) => totalDurationMs(s.workload) ?? 0));

  return { accumulators, selfDiagnosis, runSeed, runClock, startedAt, runStart, aborted: opts.abortSignal?.aborted ?? false, plannedMs };
}

/** M89a — one histogram's complete IPC form (buckets + the exact scalars `fromBuckets` needs).
 * Paired with `deserializeHistogram` so the four successful-only sites (scenario/endpoint ×
 * send/receive) cannot drift apart the way the four hand-written copies of this same shape already
 * had to be kept in step. */
function serializeHistogram(h: LatencyHistogram): SerializedHistogram {
  return { iterations: h.count, sum: h.sum, min: h.min, max: h.max, histogram: h.toBuckets() };
}

function deserializeHistogram(s: SerializedHistogram): LatencyHistogram {
  return LatencyHistogram.fromBuckets(s.histogram, { count: s.iterations, sum: s.sum, min: s.min, max: s.max });
}

function summarizeHistogram(h: LatencyHistogram): LoadDurationStats {
  return { min: h.min, max: h.max, avg: h.avg, p50: h.percentile(50), p90: h.percentile(90), p95: h.percentile(95), p99: h.percentile(99) };
}

/** M32 (R3/R4) — shapes one accumulated histogram+timeline into a full `LoadMetrics`, used for
 * every metrics-shaped view a `LoadReport` has (each scenario's own, and the combined pool) —
 * exactly one place decides what a "metrics" object contains. */
function buildLoadMetrics(histogram: LatencyHistogram, successHistogram: LatencyHistogram, failures: number, timeline: Timeline): LoadMetrics {
  return {
    // M89a: still the *all*-iterations histogram, so `iterations` and the `errorRate` denominator
    // below keep their exact prior meaning. This is the trap the milestone was most likely to walk
    // into — had the split been done by narrowing this histogram instead of adding a second one,
    // `errorRate` would silently have become `failures / successes` (960/40 = 2400 %).
    iterations: histogram.count,
    failures,
    errorRate: histogram.count > 0 ? failures / histogram.count : 0,
    durations: summarizeHistogram(histogram),
    histogram: histogram.toBuckets(),
    timeline: timeline.toSeries(),
    successful: {
      iterations: successHistogram.count,
      durations: summarizeHistogram(successHistogram),
      histogram: successHistogram.toBuckets(),
    },
  };
}

/** M43 (D70) — `threshold … for "label"` reads from that one endpoint's own histogram/failures
 * instead of the scenario's whole-iteration ones. An unknown scope (shouldn't happen — TF034
 * catches it at check time) falls back to an empty histogram (`errorRate` reads as 0 on zero
 * samples; a duration reads as `null` per D-M89-1), never a crash.
 *
 * M89a (`B3-02`, D-M89-0/D-M89-1) — the two metric kinds read **different populations**, and that
 * asymmetry is the whole point:
 *
 * - a **duration** percentile reads `successHistogram`, because a failing request is usually fast
 *   (an instant 5xx, a refused connection) and mixing failures in drags the percentile *down* — so
 *   a latency threshold passes *because* the target is broken. The probe that filed `B3-02` hit
 *   `p95 2ms ✓ < 100ms` at a 96 % error rate.
 * - an **error rate** reads the all-iterations count as its denominator, unchanged. It is the
 *   metric whose entire job is to see the failures.
 *
 * With no successful samples there is no percentile to state, so `actual` is `null` and the
 * threshold fails (D-M89-1) — `percentile()` returns `0` on an empty histogram, which would
 * otherwise make "everything failed" the one case that passes a latency threshold most easily. */
function evaluateThresholds(
  thresholds: readonly ThresholdDecl[],
  whole: { readonly histogram: LatencyHistogram; readonly successHistogram: LatencyHistogram; readonly failures: number },
  endpoints: ReadonlyMap<string, { readonly histogram: LatencyHistogram; readonly successHistogram: LatencyHistogram; readonly failures: number }>,
): LoadThresholdResult[] {
  const empty = new LatencyHistogram();
  return thresholds.map((t) => {
    const scope = t.scope?.value;
    const source = scope === undefined ? whole : (endpoints.get(scope) ?? { histogram: empty, successHistogram: empty, failures: 0 });
    const actual =
      t.metric.kind === 'errorRate'
        ? source.histogram.count > 0
          ? source.failures / source.histogram.count
          : 0
        : source.successHistogram.count > 0
          ? source.successHistogram.percentile(t.metric.percentile)
          : null;
    const baseLabel = t.metric.kind === 'errorRate' ? 'error rate' : `p${t.metric.percentile} duration`;
    const label = scope !== undefined ? `${baseLabel} for "${scope}"` : baseLabel;
    const ok = actual === null ? false : t.op === 'lessThan' ? actual < t.value : actual > t.value;
    return { label, op: t.op, target: t.value, actual, ok };
  });
}

/** M43 (D67/D68) — every `api` step's own endpoint identity within a scenario, in first-appearance
 * source order (not run-time discovery order, which would vary run to run under concurrent VUs).
 * Only walks `scenario.body` itself (plus `within`/`switch to new tab`/`download` sub-blocks) — a
 * `call` into an `action` isn't resolved, the same conservative limit `checkThresholdScopes`
 * (lang's checker, TF034) already accepts. */
function scenarioEndpointIdentities(scenario: LoadTest): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const walk = (steps: readonly Step[]): void => {
    for (const step of steps) {
      if (step.type === 'ApiStep') {
        const identity = apiStepIdentity(step);
        if (!seen.has(identity)) {
          seen.add(identity);
          ordered.push(identity);
        }
      } else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
        walk(step.body);
      }
    }
  };
  walk(scenario.body);
  return ordered;
}

/** M43 (D67-D69) — `LoadScenarioReport.endpoints`, one entry per identity declared anywhere in
 * `scenario.body`, in source order. An identity the run never actually reached (every iteration
 * failed before getting there) still gets a zero-sample entry rather than being silently absent —
 * `load-report.html`/`load-results.json` consumers can render "0 iterations" instead of needing to
 * special-case a missing row. */
function buildLoadReportEndpoints(
  scenario: LoadTest,
  endpoints: ReadonlyMap<string, EndpointAccumulator>,
): readonly { readonly identity: string; readonly metrics: LoadMetrics }[] {
  return scenarioEndpointIdentities(scenario).map((identity) => {
    const bucket = endpoints.get(identity);
    return {
      identity,
      metrics: bucket
        ? buildLoadMetrics(bucket.histogram, bucket.successHistogram, bucket.failures, bucket.timeline)
        : buildLoadMetrics(new LatencyHistogram(), new LatencyHistogram(), 0, new Timeline()),
    };
  });
}

/** M43 (D67-D69) — records one iteration's own `api`-kind step durations into this scenario's
 * per-endpoint accumulators. Runs on both a successful *and* a failed iteration (`steps` is the
 * scenario body's partial trace either way, see the `iterSteps` doc at its call site) — a failed
 * iteration's completed requests are still real samples.
 *
 * M89a (`B3-12`, `B3-13`) — **which request failed is derived, not read.** An `api` step's
 * `StepResult.ok` is a literal `true` at both of its construction sites: an `api` step's job is
 * only to *attempt* the request, and the following `expect`/`check` is what judges the outcome. So
 * the accurate signal is positional. Execution is fail-fast (P#16, `execSteps`), so a failing step
 * is pushed with `ok: false` and the trace ends there — the nearest **preceding** `api` step is the
 * request that failed.
 *
 * That rule agrees with M43's original "the *last* endpoint reached absorbs the failure" in the
 * ordinary case, and corrects it exactly where a soft **`check`** fails and lets the iteration run
 * on to further requests: M43 billed the last of those, an endpoint that answered perfectly well.
 * An iteration failing before any `api` step, or in an `after each` `cleanup` hook (whose steps
 * never enter `iterSteps`), is now billed to nobody rather than to an innocent endpoint. So
 * per-endpoint failures do **not** sum to the scenario's `failures`, by design: this axis counts
 * **requests**, the scenario axis counts **iterations**. */
function recordEndpointMetrics(acc: ScenarioAccumulator, steps: readonly StepResult[] | undefined, runStart: number): void {
  if (!steps) return;
  // One entry per `api` request this iteration actually made, in order. Built first, recorded
  // second: attribution needs to look *forward* from a request to the step that judged it, which a
  // single record-as-you-go pass cannot do.
  const requests: { readonly endpoint: string; readonly durationMs: number; ok: boolean }[] = [];
  for (const step of steps) {
    if (step.kind === 'api' && step.endpoint) {
      requests.push({ endpoint: step.endpoint, durationMs: step.durationMs, ok: true });
    } else if (!step.ok && requests.length > 0) {
      // Assignment, never `++` — two soft `check`s failing after the same request must bill it
      // once, or that endpoint reports a >100 % error rate against its own request count.
      requests[requests.length - 1]!.ok = false;
    }
  }
  const offsetSeconds = (performance.now() - runStart) / 1000;
  for (const req of requests) {
    let bucket = acc.endpoints.get(req.endpoint);
    if (!bucket) {
      bucket = { histogram: new LatencyHistogram(), successHistogram: new LatencyHistogram(), timeline: new Timeline(), failures: 0 };
      acc.endpoints.set(req.endpoint, bucket);
    }
    bucket.histogram.record(req.durationMs);
    if (req.ok) bucket.successHistogram.record(req.durationMs);
    else bucket.failures++;
    // `B3-13`: this argument was the literal `true`, so `Timeline`'s own failure counter could
    // never increment and every per-endpoint error-rate chart in `report.html` rendered a flat zero
    // regardless of the run.
    bucket.timeline.record(offsetSeconds, req.durationMs, req.ok);
  }
}

/** M34 (D17) — a closed-model scenario's `ratio` must clear this before it's worth calling out as
 * a warning: below it, "the system backed off" isn't distinguishable from ordinary latency
 * variance. 20% mirrors `selfDiagnosis.ts`'s own house style of a single documented round-number
 * threshold rather than a tunable — same reasoning: a v1 diagnostic needs *a* line, and a round
 * number beats false precision an untuned constant can't actually justify. */
const BACK_OFF_WARNING_THRESHOLD = 0.2;

/** Each half needs enough of its own samples for a mean to mean anything — mirrors
 * `selfDiagnosis.ts`'s `MIN_SATURATION_WINDOW_MS` guard, same reasoning: a diagnostic that can
 * fire (or fail to) on statistically meaningless data is worse than one that stays quiet. Checked
 * per half, not as a combined total — an 8-and-1 split shouldn't count as "enough data" just
 * because the sum clears a bar. 10 (not a smaller round number) because a real, non-simulated run
 * against a genuinely healthy localhost fixture during this diagnostic's own development still
 * false-positived at low sample counts (3-5 per half) — ordinary per-request jitter alone was
 * enough to swing a small sample's mean past the warning threshold. 10 gave a stable, repeatable
 * "no warning" result across multiple real runs against the same healthy fixture. */
const MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF = 10;

/** Every closed (`users`) workload kind D98 says the D17 back-off diagnostic applies to — every
 * closed kind *except* the 2 count-based ones (D102, no duration to back off against). */
const CLOSED_USERS_KINDS = new Set<Workload['type']>(['RampUsersWorkload', 'HoldUsersWorkload', 'StepUsersWorkload', 'SpikeUsersWorkload']);

/** M34 (D17), extended by M52/D98 to every closed (`users`) kind — see `BackOffDiagnosis`'s doc
 * (types.ts) for the full design and why an early-half vs. late-half mean comparison was chosen
 * over an extremal-percentile "ideal pace" baseline. `undefined` for an open-model (`…RpsWorkload`)
 * or count-based scenario, or when either half has too few iterations to trust its own mean. */
export function computeBackOff(scenario: LoadTest, early: { readonly count: number; readonly sum: number }, late: { readonly count: number; readonly sum: number }): BackOffDiagnosis | undefined {
  if (!CLOSED_USERS_KINDS.has(scenario.workload.type)) return undefined;
  if (early.count < MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF || late.count < MIN_ITERATIONS_PER_HALF_FOR_BACK_OFF) return undefined;
  const earlyMean = early.sum / early.count;
  const lateMean = late.sum / late.count;
  if (earlyMean <= 0 || lateMean <= 0) return undefined;
  const ratio = Math.max(0, 1 - earlyMean / lateMean);
  return { ratio, warning: ratio > BACK_OFF_WARNING_THRESHOLD };
}

/** M89b (`B3-03`, D-M89-4/D-M89-5) — the AST's 10 workload kinds projected onto the 5 report
 * shapes, losslessly. This is the **only** place a declared workload becomes report data, and
 * `describeWorkload` (reporter) is the only place that value becomes text; exported so the CLI's
 * pre-run line formats the same value through the same formatter rather than switching over the
 * AST a second time. Before M89b the CLI did exactly that, and its rival function was the *correct*
 * one — the report's flat `{ kind, target, overMs }` had nowhere to put the answer, so both the
 * summary and `report.html` open-coded `ramp to …` for all 10 kinds (`B3-03`).
 *
 * The old shape's lossiness was not cosmetic: `Math.max`/`reduce` over `stages` meant a `step` and
 * a `spike` with the same peak and total span produced identical report data, and the count-based
 * kinds reported `overMs: 0`. Per-stage data now survives, which is also what D101's per-stage
 * breakdown will need. */
export function workloadOf(w: Workload): LoadWorkloadReport {
  switch (w.type) {
    case 'RampUsersWorkload':
      return { shape: 'ramp', model: 'closed', target: w.users, overMs: w.overMs };
    case 'RampRpsWorkload':
      return { shape: 'ramp', model: 'open', target: w.rps, overMs: w.overMs };
    case 'HoldUsersWorkload':
      return { shape: 'hold', model: 'closed', target: w.users, forMs: w.forMs };
    case 'HoldRpsWorkload':
      return { shape: 'hold', model: 'open', target: w.rps, forMs: w.forMs };
    case 'StepUsersWorkload':
      return { shape: 'step', model: 'closed', stages: jumpStages(w.stages) };
    case 'StepRpsWorkload':
      return { shape: 'step', model: 'open', stages: jumpStages(w.stages) };
    case 'SpikeUsersWorkload':
      return { shape: 'spike', model: 'closed', stages: rampableStages(w.stages) };
    case 'SpikeRpsWorkload':
      return { shape: 'spike', model: 'open', stages: rampableStages(w.stages) };
    case 'SharedIterationsWorkload':
      return { shape: 'iterations', iterations: w.iterations, vus: w.vus, perVu: false };
    case 'PerVuIterationsWorkload':
      return { shape: 'iterations', iterations: w.iterationsPerVu, vus: w.vus, perVu: true };
  }
}

/** A `step` stage carries no `ramped` flag (it cannot be ramped — see `LoadWorkloadReport`), and
 * the AST `Stage`'s `span` has no business in a report, so neither is copied through. */
function jumpStages(stages: readonly Stage[]): readonly LoadWorkloadStage[] {
  return stages.map((s) => ({ target: s.target, durationMs: s.durationMs }));
}

function rampableStages(stages: readonly Stage[]): readonly LoadWorkloadRampableStage[] {
  return stages.map((s) => ({ target: s.target, durationMs: s.durationMs, ramped: s.mode === 'ramp' }));
}

/** "aborted at Ns of Nm planned" (R5) — `elapsedMs` is what actually ran, `plannedMs` the longest
 * scenario's own `overMs` in the file (§2.3's model: a scenario "lasts exactly `overMs`," so the
 * longest one governs how long the whole file's run was meant to take). */
function formatAbortedMessage(elapsedMs: number, plannedMs: number): string {
  return `aborted at ${Math.round(elapsedMs / 1000)}s of ${Math.round(plannedMs / 1000)}s planned`;
}

/** M56 (Phase 3) — finalizes one scenario's raw accumulator into its `LoadScenarioReport` (metrics,
 * evaluated thresholds, back-off diagnosis, per-endpoint breakdown). Two callers, both live:
 * `runProgramInner`'s unified dispatch builds one `WorkloadTestResult` per workload test directly
 * from it, and `mergeLoadShardReports` builds the `--workers N>1` merged `LoadReport` from it.
 *
 * It used to have a third, `buildLoadReport`, which M91a deleted along with `runLoad` (review
 * finding `B3-06`): a single-process `LoadReport` had no production caller once M56 routed the
 * shipped path through `runProgramInner`. */
function finalizeScenario({ scenario, histogram, successHistogram, timeline, failures, early, late, endpoints }: ScenarioAccumulator): LoadScenarioReport {
  const metrics = buildLoadMetrics(histogram, successHistogram, failures, timeline);
  const thresholdResults = evaluateThresholds(scenario.thresholds, { histogram, successHistogram, failures }, endpoints);
  const backOff = computeBackOff(scenario, early, late);
  const endpointReports = buildLoadReportEndpoints(scenario, endpoints);
  return { name: scenario.name.value, workload: workloadOf(scenario.workload), metrics, thresholds: thresholdResults, ok: thresholdResults.every((t) => t.ok), endpoints: endpointReports, ...(backOff ? { backOff } : {}) };
}

/** M31 (D19) — runs one shard's striped share of every `scenario` in the file (`opts.shard`
 * required) and returns a compact, IPC-safe summary instead of a full `LoadReport`: a shard on its
 * own is not a meaningful pass/fail verdict (its thresholds would be evaluated against a fraction
 * of the intended load), only the parent's `mergeLoadShardReports` — combining every shard —
 * produces one. Invoked by the CLI's forked worker processes under `--workers N>1`. */
/** Shapes a run's `ScenarioAccumulator`s into a compact, IPC-safe `LoadShardResult` — extracted
 * from `runLoadShard`'s own body (M31-era) so the unified per-file dispatch (`runProgramInner`,
 * Phase 2b/D111) can produce the exact same shape for its own shard-0 contribution when
 * `opts.shard` is set, without duplicating this mapping. */
function buildLoadShardResult(accumulators: readonly ScenarioAccumulator[], selfDiagnosis: SelfDiagnosis): LoadShardResult {
  const scenarios: LoadShardScenarioResult[] = accumulators.map(({ scenario, histogram, successHistogram, timeline, failures, early, late, endpoints }) => ({
    name: scenario.name.value,
    workload: workloadOf(scenario.workload),
    iterations: histogram.count,
    failures,
    sum: histogram.sum,
    min: histogram.min,
    max: histogram.max,
    histogram: histogram.toBuckets(),
    successful: serializeHistogram(successHistogram),
    timeline: timeline.toBuckets(),
    early,
    late,
    endpoints: [...endpoints.entries()].map(([identity, e]) => ({
      identity,
      iterations: e.histogram.count,
      failures: e.failures,
      sum: e.histogram.sum,
      min: e.histogram.min,
      max: e.histogram.max,
      histogram: e.histogram.toBuckets(),
      successful: serializeHistogram(e.successHistogram),
      timeline: e.timeline.toBuckets(),
    })),
  }));
  return { scenarios, selfDiagnosis };
}

export async function runLoadShard(program: Program, config: ResolvedConfig, opts: LoadOptions & { readonly shard: { readonly index: number; readonly count: number } }): Promise<LoadShardResult> {
  const { accumulators, selfDiagnosis } = await runLoadCore(program, config, opts);
  return buildLoadShardResult(accumulators, selfDiagnosis);
}

/** M31 (D19/R4) — combines every forked worker's `LoadShardResult` into one `LoadReport`, which
 * `spliceLoadReportIntoRunReport` immediately unpacks into the run's `RunReport`, so nothing
 * downstream (CLI rendering, `results.json`) needs to know how many processes actually ran. Matches shards to `program`'s
 * scenarios by name (the parent parses the same file independently rather than shipping
 * `ThresholdDecl`s over IPC — cheap, and keeps threshold re-evaluation using the exact same
 * `evaluateThresholds` a single-process run does). A shard missing a given scenario entirely is
 * expected, not an error — its striped share of that scenario's workload target may have rounded
 * to 0 (`shareOfWorkloadTarget`). */
export function mergeLoadShardReports(
  program: Program,
  shardResults: readonly LoadShardResult[],
  meta: { readonly startedAt: string; readonly durationMs: number; readonly seed: number; readonly now: string; readonly aborted?: boolean },
): LoadReport {
  if (shardResults.length === 0) throw new RuntimeError('`mergeLoadShardReports` needs at least one shard result');

  const scenarios: LoadTest[] = filterWorkloadTests(program.tests);
  const perScenario = scenarios.map((scenario) => {
    const histogram = new LatencyHistogram();
    const successHistogram = new LatencyHistogram();
    const timeline = new Timeline();
    let iterations = 0;
    let failures = 0;
    const early = { count: 0, sum: 0 };
    const late = { count: 0, sum: 0 };
    const endpoints = new Map<string, EndpointAccumulator>();
    for (const shard of shardResults) {
      const match = shard.scenarios.find((s) => s.name === scenario.name.value);
      if (!match) continue;
      histogram.merge(LatencyHistogram.fromBuckets(match.histogram, { count: match.iterations, sum: match.sum, min: match.min, max: match.max }));
      // M89a — merged, never re-derived: the parent knows how many iterations succeeded but not
      // *which durations* were theirs, so a threshold evaluated on a parent-side reconstruction
      // would quietly differ from the single-process answer for the same run.
      successHistogram.merge(deserializeHistogram(match.successful));
      timeline.merge(Timeline.fromBuckets(match.timeline));
      iterations += match.iterations;
      failures += match.failures;
      early.count += match.early.count;
      early.sum += match.early.sum;
      late.count += match.late.count;
      late.sum += match.late.sum;
      // M43 (D67-D69) — merges each shard's own per-endpoint buckets by identity, same shape as
      // the scenario-level merge just above.
      for (const e of match.endpoints) {
        let bucket = endpoints.get(e.identity);
        if (!bucket) {
          bucket = { histogram: new LatencyHistogram(), successHistogram: new LatencyHistogram(), timeline: new Timeline(), failures: 0 };
          endpoints.set(e.identity, bucket);
        }
        bucket.histogram.merge(LatencyHistogram.fromBuckets(e.histogram, { count: e.iterations, sum: e.sum, min: e.min, max: e.max }));
        bucket.successHistogram.merge(deserializeHistogram(e.successful));
        bucket.timeline.merge(Timeline.fromBuckets(e.timeline));
        bucket.failures += e.failures;
      }
    }
    return { scenario, histogram, successHistogram, timeline, iterations, failures, early, late, endpoints };
  });

  // M34 (D17): `finalizeScenario` recomputes back-off from whatever `early`/`late` totals it's
  // given — here those are the *merged* (shard-summed) totals, not shard-by-shard then averaged,
  // same "merge first, derive second" order R4's histogram/percentile design already established.
  const scenarioReports: LoadScenarioReport[] = perScenario.map((acc) => finalizeScenario(acc));

  // M91a (`B3-19`, D-M91-1): this used to also pool every scenario's histograms and timeline into a
  // `combined` metric — three merged histograms per merge, computed and then dropped by
  // `spliceLoadReportIntoRunReport`, read by no reporter or CLI code, and documented against a
  // `load-results.json` artifact M53/M56 stopped writing.

  const selfDiagnosis = mergeSelfDiagnosis(shardResults.map((s) => s.selfDiagnosis));
  // M52: a count-based scenario contributes 0 — there's no way to predict its wall-clock length in
  // advance (D102), so it simply doesn't influence "how long the file's run was meant to take."
  const plannedMs = Math.max(0, ...scenarios.map((s) => totalDurationMs(s.workload) ?? 0));
  return {
    ok: scenarioReports.every((s) => s.ok),
    scenarios: scenarioReports,
    startedAt: meta.startedAt,
    durationMs: meta.durationMs,
    seed: meta.seed,
    now: meta.now,
    selfDiagnosis,
    inconclusive: selfDiagnosis.saturated,
    ...(meta.aborted ? { aborted: true, abortedMessage: formatAbortedMessage(meta.durationMs, plannedMs) } : {}),
  };
}

/** M56 (Phase 3, D117) — replaces a `RunReport`'s *provisional* workload entries (one shard's own
 * partial share, stamped in by `runProgramInner` when `opts.shard` was set) with the real, merged
 * result once the CLI has combined every shard via `mergeLoadShardReports`, and hoists the merged
 * `selfDiagnosis`/`inconclusive`/`aborted`/`abortedMessage` onto the report. Matches workload
 * entries to `loadReport.scenarios` **by position**, not by name: both are built by mapping over
 * `filterWorkloadTests(program.tests)` in the exact same file-declaration order (`runProgramInner`'s
 * own interleaving loop, and `mergeLoadShardReports`'s `scenarios` derivation), so the k-th
 * workload entry in `report.tests` always corresponds to `loadReport.scenarios[k]`. Only ever
 * called for the main process's own per-file report (never on an already-merged, cross-file
 * report — that merge, `cli.ts`'s `mergeReports`, happens after this). */
export function spliceLoadReportIntoRunReport(report: RunReport, loadReport: LoadReport): RunReport {
  let i = 0;
  const tests: ReportEntry[] = report.tests.map((entry) => {
    if (entry.kind !== 'workload') return entry;
    const merged = loadReport.scenarios[i++];
    if (!merged) return entry;
    const spliced: WorkloadTestResult = { ...merged, kind: 'workload', ...(entry.file !== undefined ? { file: entry.file } : {}), ...(entry.concurrency !== undefined ? { concurrency: entry.concurrency } : {}) };
    return spliced;
  });
  return {
    ...report,
    tests,
    selfDiagnosis: loadReport.selfDiagnosis,
    inconclusive: loadReport.inconclusive,
    ...(loadReport.aborted ? { aborted: true, abortedMessage: loadReport.abortedMessage } : {}),
  };
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
    // M50 (D93-D95): `program.tests` now also holds workload-bearing blocks (formerly a separate
    // `program.scenarios` array `tflw run`'s functional path never saw at all). Those run only
    // under `tflw load`'s per-VU loop (`runLoadCore`), never here as a single-shot case.
    if (test.workload) continue;
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
  /** M45 (D75) — this VU's pinned `node:http`/`node:https` connections, set only on a load
   * iteration's own `iterTc` (`runLoadCore` below). Undefined everywhere else (a plain `tflw run`
   * attempt, a session's own establishment run, `wait until api` outside a load context) — those
   * keep using `sendRequest`'s unpinned `fetch()` exactly as before, unaffected by this milestone. */
  readonly pinnedAgents?: PinnedAgents;
}

export interface SessionOutcome {
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

/** Opaque handle to a `SessionCache` entry (M37, D45) — compared only by `===` identity, never
 * inspected. Lets a caller that read a session's headers at one point in time (a load iteration's
 * per-iteration `ensure()` call) later ask "is what I read still the cache's live entry, or has
 * someone else already refreshed it since" without a separate staleness-tracking mechanism. */
export type SessionRef = Promise<SessionOutcome>;

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

  /** The cache's current live entry for a name, as an opaque `SessionRef` handle — `undefined` if
   * nothing has ever been cached for it. Synchronous: a caller doesn't await this to *read* the
   * cache's current state, only to remember it for a later `reestablish()` identity check (M37,
   * D45). */
  currentRef(name: string): SessionRef | undefined {
    return this.promises.get(name);
  }

  /** Guarded re-establish (M37, D45): re-runs `runSession` only if the cache's live entry for
   * `name` is still exactly `staleRef` (or `staleRef` is `undefined`, meaning the caller has no
   * fresher-reference tracking at all — the regular `tflw run` path, where this degrades to
   * `invalidate()`+`ensure()`'s old unconditional behavior). If another caller already refreshed
   * this session since `staleRef` was read, `this.promises.get(name)` no longer matches it, so the
   * invalidate is skipped entirely and `ensure()` just returns that already-fresh result — several
   * VUs racing a 401 on the same stale token pay for at most one real re-login between them, not
   * one each. Same identity-guard pattern `ensure()`'s own TTL-eviction (above) already uses. */
  async reestablish(name: string, staleRef: SessionRef | undefined, decl: SessionDecl, config: ResolvedConfig, tc: TestCtx): Promise<SessionOutcome> {
    if (staleRef === undefined || this.promises.get(name) === staleRef) this.invalidate(name);
    return this.ensure(name, decl, config, tc, false);
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
    response = await sendRequest({ method: 'POST', url: tokenUrl, headers, body, timeoutMs: config.timeouts.step, followRedirects: true, allowHosts: config.allowHosts });
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

/** Re-establish every named session, in declared order, folding fresh headers/cookies into `ctx`
 * in place (SPEC §3.3, decision 3a, enterprise arc). Goes through `SessionCache.reestablish`
 * (M37, D45) rather than an unconditional `invalidate()`+`ensure()`: `ctx.sessionRefs`, when
 * present (populated only by a load iteration's per-iteration session read, `runLoadCore` below),
 * lets several VUs racing a 401 on the same stale token dedupe to at most one real re-login
 * between them — a caller with no such tracking (`ctx.sessionRefs` undefined, the regular
 * `tflw run` path) gets today's unconditional-reestablish behavior unchanged. Safe to mutate:
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
    const outcome = await tc.sessionCache.reestablish(name, ctx.sessionRefs?.get(name), decl, config, tc);
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
  results: ReportEntry[],
  emit: EventSink,
): Promise<boolean> {
  if (hooks.length === 0) return true;
  const scope = new Map<string, unknown>();
  const ctx: EvalCtx = { scope, environ: tc.environ, redactor: tc.redactor, rng: tc.rng, runSeed: tc.runSeed, runClock: tc.runClock, uniqueSeq: tc.uniqueSeq, sessionHeaders: {}, sessionNames: [], cookieJar: new CookieJar() };
  const start = performance.now();
  emit({ type: 'test:start', name: label });
  const steps: StepResult[] = [];
  for (const hook of hooks) {
    const exec = await execSteps(hook.body, config, ctx, tc, label, registry);
    steps.push(...exec.steps);
    if (!exec.ok) {
      const result: TestResult = { kind: 'functional', name: label, ok: false, durationMs: Math.round(performance.now() - start), steps, error: exec.error ?? `a \`${label}\` hook failed` };
      results.push(result);
      emit({ type: 'test:end', result });
      return false;
    }
  }
  // Every `test:start` gets a `test:end` (M77, review finding B3-05). Only the failure path emitted
  // one before, so the *happy* path produced a malformed stream and the failure path a well-formed
  // one — exactly backwards, and any consumer pairing the two (a live dashboard, anything counting
  // tests in flight) mis-tracked on every run that used file hooks.
  //
  // A *passing* file hook is still absent from the final report's `tests`, unchanged: a hook that
  // worked is not a test result. So the stream carries a pair the report has no entry for, and that
  // is the contract (SPEC §13) rather than an accident — `run:start.total`/`run:end.total` are how
  // a consumer counts tests; `test:start`/`test:end` are how it tracks work in flight, and a file
  // hook is work.
  emit({ type: 'test:end', result: { kind: 'functional', name: label, ok: true, durationMs: Math.round(performance.now() - start), steps } });
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
    return { kind: 'functional', name: test.name.value, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error: redacted };
  }
  if (isFirstAttempt) tc.emit({ type: 'test:start', name });

  // Fresh browser context+page per test *attempt* (M3a, D13 — a retried test gets a clean slate,
  // never a failed attempt's leftover UI state). Cheap to create even for an API-only test: no
  // real browser process/page exists until a browser step actually calls `ensurePage()`. Ended via
  // `finish()` below on every exit path, including every early `return` already in this function
  // (session failure, `before` hook failure, …) — the `finally`'s plain `close()` is only a
  // defensive fallback for the (never-expected) case that something threw before `finish()` ran;
  // `close()` is a no-op once `finish()` already cleared `context` (both methods idempotent).
  const browserPageState = tc.browserManager ? new BrowserPageState(capturesBinaryEvidence(config), config.allowHosts) : undefined;
  try {
    const result = await runTestAttemptBody(test, config, tc, registry, beforeEach, afterEach, sessionOwnership, name, nameCtx, testStart, steps, browserPageState);
    if (!browserPageState) return result;
    // Trace on failure and on every retry attempt (M3c, D12) — a clean, single-attempt pass never
    // captures one; a retry attempt does even if it ultimately passes (the flaky path is exactly
    // the evidence worth keeping). Below `evidence full` (FS-01) tracing was never started, so
    // `finish` returns `undefined` here whatever this argument says.
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
      return { kind: 'functional', name, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error };
    }
    const outcome = await tc.sessionCache.ensure(sessionName, decl, config, tc, sessionOwnership?.get(sessionName) ?? false);
    steps.push(...outcome.steps);
    if (!outcome.ok) {
      const error = `session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`;
      return { kind: 'functional', name, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error };
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
      return { kind: 'functional', name, ok: false, durationMs: Math.round(performance.now() - testStart), steps, error: exec.error ?? 'a `before` hook failed' };
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

  return { kind: 'functional', name, ok, durationMs: Math.round(performance.now() - testStart), steps, ...(error ? { error } : {}) };
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
            let { trace, redacted, retryAfterAttempts, retryAfterWaitedMs, cookieScopeNote } = await execApi(step, config, ctx, tc.redactor, tc.baseDir, tc.pinnedAgents);
            // Auto re-establish on 401 (SPEC §3.3, decision 3a, enterprise arc) — any session (not
            // just `oauth2`) gets this: a revoked/expired-early credential shouldn't fail every
            // remaining step of a test that's otherwise unrelated to auth. Retried at most once per
            // step, so a server that genuinely, persistently 401s still fails fast instead of
            // looping. `ctx.sessionNames` is `[]` for an anonymous test, so this is a no-op there.
            if (trace.response.status === 401 && ctx.sessionNames.length > 0) {
              const refresh = await refreshSessions(ctx, ctx.sessionNames, config, tc, src, step.span);
              results.push(...refresh.steps);
              if (refresh.ok) {
                ({ trace, redacted, retryAfterAttempts, retryAfterWaitedMs, cookieScopeNote } = await execApi(step, config, ctx, tc.redactor, tc.baseDir, tc.pinnedAgents));
              }
            }
            lastResponse = trace.response;
            lastConnectionError = null;
            // Report visibility for retries is a standing principle here (P#5/P#16, the same one
            // `test … retry N`'s `flaky` badge already follows) — a `retry honoring` step that
            // actually retried says so right in its own report line, not just silently in the
            // final status.
            const retrySuffix = retryAfterAttempts > 0 ? `, retried ${retryAfterAttempts}x honoring Retry-After (waited ${retryAfterWaitedMs}ms total)` : '';
            // D-M88-12 — same channel as `retrySuffix` for the same reason: something the author
            // needs to see about *this* request belongs on this request's own line, not in a
            // separate diagnostic stream.
            const cookieSuffix = cookieScopeNote !== undefined ? `, ${cookieScopeNote}` : '';
            result = mkStep('api', src, step.span, true, stepStart, `${step.method} ${redacted.request.url} → ${trace.response.status} (${trace.response.durationMs}ms)${retrySuffix}${cookieSuffix}`, redacted.request, redacted.response, apiStepIdentity(step));
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
            result = mkStep('api', src, step.span, true, stepStart, `${step.method} ${step.path.raw} → connection failed: ${redactedMessage}`, undefined, undefined, apiStepIdentity(step));
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
          const waited = await execWaitUntilApi(step, config, ctx, tc.redactor, tc.baseDir, src, stepStart, tc.pinnedAgents);
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
        case 'TickStmt': {
          const name = String(evalValue(step.locator.value, ctx));
          const { pwLocator, via } = await resolveForStep(ctx, config, step.locator);
          await performCheck(pwLocator, config.timeouts.step);
          result = mkStep('checkbox', src, step.span, true, stepStart, `check ${locatorDetail(step.locator, name, via)}`);
          break;
        }
        case 'UntickStmt': {
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
          // FS-01: below `evidence full` the shot is not taken at all, and the step says so rather
          // than reporting a capture that isn't in the report. It still *passes* — `screenshot` is
          // an evidence step, never an assertion, so a run that deliberately turned evidence down
          // must not start failing because of it.
          if (!capturesBinaryEvidence(config)) {
            result = mkStep('screenshot', src, step.span, true, stepStart, `screenshot ${JSON.stringify(name)} ${EVIDENCE_OMITTED_SCREENSHOT}`);
            break;
          }
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
        case 'PauseStmt': {
          // A fresh uniform draw per iteration for a ranged `pause`, off `ctx.rng` — reproducible
          // like every other generator (P#23), not `Math.random()`. Excluded from a load test's own
          // `duration` threshold metric by the load engine (`runLoadCore` below, D24a) via this exact
          // step's own `durationMs` — pacing is not system latency.
          const ms = step.maxMs !== null ? step.minMs + Math.floor(ctx.rng() * (step.maxMs - step.minMs + 1)) : step.minMs;
          await sleep(ms);
          result = mkStep('pause', src, step.span, true, stepStart, `paused for ${ms}ms`);
          break;
        }
      }
      // A browser request this step's page tried to make and `allow hosts` refused (M85,
      // `B4-03`). The route handler that refused it runs on Playwright's event loop with no step
      // to fail, so it records and this collects — here, where the step that caused it is still
      // the current one. A step that otherwise "passed" while its page was denied the network did
      // not pass; a blocked XHR would otherwise surface several steps later as an unexplained
      // empty table. Thrown rather than returned so it lands in the `catch` below and picks up the
      // same failure-evidence handling as any other step failure.
      const refusalAfter = ctx.browser?.page.takeHostRefusal();
      if (refusalAfter) throw new AllowHostsError(refusalAfter);
      // Best-effort failure evidence (M3c, D12's "failure-first capture") — attached to whichever
      // step just failed, browser or API (a UI test's API step failing still benefits from seeing
      // page state). `currentPageIfAny()` never creates a browser process for an API-only test that
      // merely happens to share a `BrowserManager` (SPEC §9's "present regardless of whether this
      // test uses a browser step" framing) — only a test that already opened a page gets a shot.
      if (!result.ok && ctx.browser && capturesBinaryEvidence(config)) {
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
      // A blocked *navigation* reaches here as Playwright's own `net::ERR_FAILED` — true, and
      // useless in exactly the way C11/M84 is about. The refusal is the real reason and it is
      // already recorded, so it wins over the transport-level symptom (M85, `B4-03`).
      const refusalDuring = err instanceof AllowHostsError ? null : (ctx.browser?.page.takeHostRefusal() ?? null);
      const message = refusalDuring ?? (err instanceof RuntimeError ? err.message : `${(err as Error).message}`);
      const redacted = tc.redactor.redact(message);
      let failed = mkStep(stepKind(step), src, step.span, false, stepStart, redacted);
      if (ctx.browser && capturesBinaryEvidence(config)) {
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
  /** D-M88-12 — set only when the jar had nothing to send to *this* origin while holding cookies
   * for others, i.e. the one case where "no `Cookie` header" means "scoped elsewhere" rather than
   * "never logged in". Informational: it carries no verdict, so unlike a `tflw check` rule it
   * cannot false-positive on a bearer-auth suite (which is why it is a trace line and not a
   * rule — see the decision). */
  readonly cookieScopeNote?: string;
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

async function execApi(spec: ApiRequestSpec, config: ResolvedConfig, ctx: EvalCtx, redactor: Redactor, baseDir: string, pinnedAgents?: PinnedAgents): Promise<ApiExec> {
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
  // …and scoped to this request's own origin since M88c2 (`B4-06`, D-M88-7): a cookie set by the
  // app under test is no longer replayed to every other service the suite talks to.
  const requestOrigin = originOf(url);
  const jarCookie = ctx.cookieJar.serialize(requestOrigin);
  if (jarCookie) setHeader(headers, 'Cookie', jarCookie);
  const cookieScopeNote = jarCookie ? undefined : cookieScopeNoteFor(ctx, requestOrigin);
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
  // M45 (D75) — a load iteration's own VU-pinned connection is used whenever this request's shape
  // supports it (a string or absent body, no mTLS); `tflw run` never passes `pinnedAgents`, so this
  // is dead code there and `sendRequest`'s `fetch()` path is exactly what it always was.
  const canPin = pinnedAgents !== undefined && !mtls && (sendBody === undefined || typeof sendBody === 'string');
  if (pinnedAgents !== undefined && !canPin) warnPinnedFallback(mtls ? 'mtls' : 'formdata');
  const sendOnce = (): Promise<ResponseTrace> =>
    canPin
      ? sendPinnedRequest({ method: spec.method, url, headers, body: sendBody as string | undefined, timeoutMs, followRedirects: spec.followRedirects, allowHosts: config.allowHosts }, pinnedAgents!)
      : sendRequest({ method: spec.method, url, headers, body: sendBody, timeoutMs, followRedirects: spec.followRedirects, allowHosts: config.allowHosts, ...(mtls ? { mtls } : {}) });
  let response = await sendOnce();

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
      response = await sendOnce();
    }
  }

  // Every `Set-Cookie` this chain carried is folded into the jar here, unconditionally — the next
  // request in this same scope (session block, or this test's own subsequent steps) sees it
  // automatically, with no `capture`/`header` replay needed (SPEC §3.3, P#33). Per *hop*, not per
  // response: the commonest login shape sets its cookie on a 302 (`B4-15`), and after a
  // cross-origin redirect the origin that set a cookie is not the one this step named (D-M88-8).
  ctx.cookieJar.applyCookieEvents(response.cookieEvents);

  return {
    trace: { request, response },
    redacted: { request: redactRequest(request, redactor, config), response: redactResponse(response, redactor, config) },
    retryAfterAttempts,
    retryAfterWaitedMs,
    ...(cookieScopeNote !== undefined ? { cookieScopeNote } : {}),
  };
}

/** The `scheme://host:port` a request is addressed to — the cookie jar's scope key (D-M88-7).
 * Falls back to the whole URL for anything unparseable, which `resolveBaseUrl` + `checkHostAllowed`
 * have already made unreachable in practice; an odd key confines a cookie, it never widens it. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** D-M88-12 — "the jar's silence is shown, not diagnosed". Only speaks when the jar holds cookies
 * for *other* origins, so an ordinary bearer-auth or anonymous suite never sees it; when it does
 * speak, it names the origins and never a value. */
function cookieScopeNoteFor(ctx: EvalCtx, requestOrigin: string): string | undefined {
  const elsewhere = ctx.cookieJar.originsWithCookies().filter((o) => o !== requestOrigin);
  if (elsewhere.length === 0) return undefined;
  return `no cookies for ${requestOrigin} (jar holds cookies for ${elsewhere.join(', ')})`;
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
  const message = maskExpectDetail(step, response, outcome.message, config, ctx);
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
  // FS-01: the baseline/actual/diff PNGs are page pixels like any other screenshot, so they only
  // reach the report at `evidence full`. Unlike the other binary sinks the *capture* is not
  // skippable here — `actualPng` is what the assertion compares — so the comparison, the baseline
  // write, and `outcome.message`'s `N px / N% differed` all behave identically at every level; only
  // the images are withheld. A mismatch below `full` still fails the test and still says by how much.
  if (!capturesBinaryEvidence(config)) return result;
  return outcome.diff ? { ...result, snapshotDiff: outcome.diff } : result;
}

/** `wait until <locator> [not] <matcher> [for <duration>]` (SPEC §9.5, M3b; `for` from FS-05) — the
 * UI sibling of `execUiExpect`: same resolve-fresh-every-poll / `hasCount`-exception logic, but
 * polling `timeout wait` (default 30s, the same clock `wait until api` uses) instead of `timeout
 * expect` (default 5s), for a UI condition that can legitimately take longer to settle than the
 * ordinary UI-expect budget. Always hard-fails on exhaustion — there is no soft/`check` form for
 * `wait until`.
 *
 * With `for <duration>` the condition must hold *continuously* for that long. The hold clock is
 * reset to `null` the moment a poll comes back false, so only an uninterrupted window passes — a
 * toast that flickers into view halfway through starts the count again rather than being averaged
 * away. `timeout wait` still bounds the whole step, so a sustained condition that never gets a
 * clean window fails with the elapsed budget rather than hanging. */
async function execWaitUntilUi(step: WaitUntilUiStmt, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig): Promise<StepResult> {
  const subject = step.subject;
  const browser = requireBrowserCtx(ctx);
  const page = await browser.page.ensurePage(browser.manager);
  const scope = browser.scope ?? page;
  const name = String(evalValue(subject.locator.value, ctx));
  const holdMs = step.holdMs;
  // A hold window at least as long as the poll budget can never pass — the condition would have to
  // stay true past the deadline that ends the step. That is a written-wrong test, not a slow app,
  // and it would otherwise surface as an ordinary timeout that says nothing about the real cause.
  // The parser cannot catch it: `timeout wait` comes from config and can differ per run.
  if (holdMs !== null && holdMs >= config.timeouts.wait) {
    throw new RuntimeError(
      `\`for ${holdMs}ms\` can never be satisfied — the whole step is bounded by \`timeout wait\` (${config.timeouts.wait}ms), so the hold window has to be shorter than it. Raise \`timeout wait\` in tflw.config, or shorten the hold.`,
    );
  }
  const deadline = performance.now() + config.timeouts.wait;
  let heldSince: number | null = null;
  let longestHoldMs = 0;
  for (;;) {
    const { pwLocator, via, count } = await resolveLocatorSnapshot(scope, subject.locator, ctx);
    if (step.matcher.name !== 'hasCount') await requireSingleMatch(subject.locator, name, { pwLocator, via }, count);
    const label = locatorDetail(subject.locator, name, via);
    const outcome = await evalUiMatcherOnce(label, pwLocator, step.matcher, ctx, count);
    const now = performance.now();
    if (outcome.ok) {
      if (heldSince === null) heldSince = now;
      longestHoldMs = Math.max(longestHoldMs, now - heldSince);
      if (holdMs === null || now - heldSince >= holdMs) {
        const message = holdMs === null ? outcome.message : `${outcome.message}, held for ${holdMs}ms`;
        return mkStep('wait', src, step.span, true, start, ctx.redactor.redact(message));
      }
    } else {
      if (heldSince !== null) longestHoldMs = Math.max(longestHoldMs, now - heldSince);
      heldSince = null;
    }
    if (now >= deadline) {
      // What a held wait fails on is the *interruption*, so report the longest unbroken window
      // rather than only the state at the deadline: without it, a condition that held 1.9s of a
      // required 2s and one that was never true for a single poll produce the same report line.
      const detail = longestHoldMs > 0 ? `longest unbroken hold ${Math.round(longestHoldMs)}ms of ${holdMs}ms` : `never held for ${holdMs}ms`;
      const message = holdMs === null ? outcome.message : `${outcome.message} (${detail})`;
      return mkStep('wait', src, step.span, false, start, ctx.redactor.redact(message));
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
 * they build (`arrayLabel[idx]...`) don't reduce to one resolvable subject value to mask.
 *
 * FS-02 (review finding V2-04) adds the second reason to mask: the configured `evidence` level.
 * Before FS-02, `redactRequest`/`redactResponse` were the *only* functions in this file that read
 * `config.evidenceLevel`, so `evidence none` dropped the response body from the trace and then
 * printed a field out of that same body verbatim one line below it — which is how a failing
 * assertion at `evidence none` still shipped a live JWT into `report.html`, `results.json` and
 * `junit.xml`. See `subjectValueSurvivesEvidenceLevel` for the rule. */
function maskExpectDetail(step: ExpectStmt, response: ResponseTrace | null, message: string, config: ResolvedConfig, ctx: EvalCtx): string {
  if (step.quantifier || !response) return message;
  const evidenceMasks = !subjectValueSurvivesEvidenceLevel(step.subject, config.evidenceLevel);
  const redactMasks = subjectMatchesRedactPattern(step.subject, config.redactPatterns);
  if (!evidenceMasks && !redactMasks) return message;
  const { value } = resolveSubject(step.subject, response, ctx);
  return maskDetailValue(message, repr(value), evidenceMasks ? EVIDENCE_OMITTED_BODY : undefined);
}

/**
 * FS-02 — **a step's detail text never shows what this run's `evidence` level already dropped from
 * the trace.** The rule is read straight off `redactRequest`/`redactResponse` rather than invented
 * separately, so the two can't drift into contradicting each other:
 *
 * - `full` — the trace keeps everything, so detail does too.
 * - `headers-only` — the trace keeps status, URL and headers but drops bodies, so a `header "…"`
 *   subject's value still shows (it is already printed in the header panel above) while every
 *   body-derived subject's does not.
 * - `none` — the trace keeps only method, URL and status, so only `status` and `duration` survive.
 *
 * *What* was compared always survives — the subject label and the matcher are part of the message,
 * not the value — so a failure at `evidence none` still reads `expected body.token to equal "…",
 * but got [omitted by evidence level]`. That is the point of the decision: dropping detail entirely
 * below `full` would make `evidence none` useless for diagnosing a CI failure, which is precisely
 * the situation a user turns evidence down for.
 *
 * UI subjects (`LocatorSubject`, `PageSubject`) are unaffected: they are page state, not part of
 * the request/response trace `evidence` governs, and they never reach this function anyway
 * (`execUiExpect`/`execA11yExpect` intercept them upstream).
 */
function subjectValueSurvivesEvidenceLevel(subject: Subject, level: EvidenceLevel): boolean {
  if (level === 'full') return true;
  switch (subject.type) {
    case 'StatusSubject':
    case 'DurationSubject':
      return true;
    case 'HeaderSubject':
      return level === 'headers-only';
    case 'LocatorSubject':
    case 'PageSubject':
      return true;
    // M96 — a value subject is a `let`/`capture` binding, not part of the request/response trace
    // `evidence` governs, so lowering the evidence level must not blank it out. Same reasoning as
    // the two browser subjects above. (This switch has a `default`, so the compiler did *not* flag
    // the new union member here — it would have silently masked every value assertion's detail at
    // any level below `full`.)
    case 'ValueSubject':
      return true;
    default:
      return false;
  }
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
  const { value, label } = resolveSubject(step.subject, response, ctx);
  // `A4-06` (M95) — the half the checker can never reach. A subject that resolves to nothing
  // (`response.headers[…]` for an absent header, `navigate`'s final segment for an absent JSON key
  // or an out-of-range index) used to bind `undefined` and report `✓`: the run then interpolated
  // the literal text `"undefined"` into every later `{name}`, and a target that answers 200 to
  // `?v=undefined` made the whole suite green. That is a false pass, not a lenient one — the
  // sibling statement has always failed here, since `expect header "X-Missing" equals "1"` compares
  // `undefined` against `"1"` and says so. `null` is deliberately *not* caught: an explicit JSON
  // `null` is a value the response really carried, and capturing it is meaningful.
  if (value === undefined) {
    throw new RuntimeError(
      `nothing to capture at ${label} — the response carried no such value, so \`${step.name}\` would bind \`undefined\` and every later \`{${step.name}}\` would send the literal text "undefined" (an explicit JSON \`null\` is capturable; this is an absent header/field)`,
    );
  }
  ctx.scope.set(step.name, value);
  // Gap #15 (TFLW-GAPS.md): `capture`'s own detail line renders the live value directly — mask it
  // the same way a `redact`-covered field is masked everywhere else, when this capture's subject
  // is one of the configured `body.<path>` patterns. The captured *variable* itself stays the real
  // value (so a later `expect {name} equals ...` still asserts against ground truth) — only this
  // step's own report text changes.
  //
  // FS-02 adds the second, independent reason: a `capture` reads out of the very trace the
  // `evidence` level just trimmed, so `capture body.accessToken as token` printed the whole token
  // on its own line while the response body above it said `[omitted by evidence level]`. Same rule
  // as `maskExpectDetail`'s, from the same helper.
  const evidenceMasked = !subjectValueSurvivesEvidenceLevel(step.subject, config.evidenceLevel);
  const redactMasked = subjectMatchesRedactPattern(step.subject, config.redactPatterns);
  if (redactMasked) registerCapturedSecret(step.name, value, redactor);
  const rendered = evidenceMasked ? EVIDENCE_OMITTED_BODY : redactMasked ? '[redacted]' : repr(value);
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
/** Whether a `capture`/`expect` subject names a position covered by a `redact` pattern (FS-03) —
 * the two subject kinds a pattern can reach, dispatched to their own matchers so a header is never
 * matched as if it were a JSON path. */
function subjectMatchesRedactPattern(subject: Subject, patterns: readonly RedactPattern[]): boolean {
  if (subject.type === 'BodySubject') return pathMatchesRedactPattern(subject.path, patterns);
  if (subject.type === 'HeaderSubject') return headerMatchesRedactPattern(subject.name.value, patterns);
  return false;
}

/**
 * FS-03's second half (review findings V2-03/V2-06) — **`redact` means "this value is a secret",
 * not "this JSON field position is masked".**
 *
 * Before this, the two redaction mechanisms had a hole exactly between them. Path-based `redact`
 * masked one *position* in one trace; taint-based redaction followed a *value* everywhere but only
 * ever learned values that arrived via `env(...)` — there were exactly three `register()` sites and
 * all three were on the env path. So the V2-03 repro
 *
 *     redact body.accessToken          # in tflw.config
 *     capture body.accessToken as token
 *     api GET /session?token={token}
 *
 * masked the token in the login response and then printed it verbatim in the next request's URL,
 * with `redact body.accessToken` sitting in the config the whole time doing nothing about it. This
 * is the fourth `register()` site, and it closes that repro: naming a position now taints whatever
 * flows out of it, so the value is masked in every file sink wherever it later appears — a URL, a
 * log line, another step's detail text — and `redactReport`'s end-of-run pass catches occurrences
 * that were already written before the `capture` ran.
 *
 * Only string and numeric values are registered: substring-replacing an object's
 * `String(value)` (`[object Object]`) would mask unrelated text and hide nothing. The variable's
 * own name becomes the placeholder (`•••(token)`) — the reader should be able to tell which
 * captured value was masked, the same way `•••(API_KEY)` names the env var. `Redactor.register`
 * still applies its `MIN_REDACTABLE_LENGTH` floor (decision 64), so a short captured value is left
 * alone rather than blotting out every coincidental match in the report.
 */
function registerCapturedSecret(name: string, value: unknown, redactor: Redactor): void {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  redactor.register(name, String(value));
}

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
  pinnedAgents?: PinnedAgents,
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
    const { trace, redacted } = await execApi(request, config, ctx, redactor, baseDir, pinnedAgents);
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

/** `signal` (M32, R5) races the timer against an abort — a scheduled sleep (VU spawn stagger,
 * open-model arrival wait) returns immediately once Ctrl-C fires instead of finishing out its full
 * delay, the difference between an abort taking effect this instant vs. up to the longest scheduled
 * sleep in the file (which for a `ramp … over 30s` scenario could be the better part of 30s). Every
 * other call site (pause time, retry backoff, poll intervals) passes no signal and behaves exactly
 * as before. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---- expect evaluation (shared by `expect` and `wait until api`) ----------

async function evaluateExpect(step: ExpectStmt, response: ResponseTrace | null, connectionError: string | null, ctx: EvalCtx, config: ResolvedConfig, baseDir: string): Promise<MatchOutcome> {
  // `request connects`/`fails` (SPEC §6.2.2, PLAN decision 18) judges the connection attempt
  // itself, not the response — bypasses `resolveSubject`/`evalMatcher` entirely, the same way
  // `matchesSchema` below bypasses `evalMatcher` for its own different reason.
  if (step.subject.type === 'RequestSubject') return evalRequestMatcher(step.matcher, connectionError, ctx);
  if (step.quantifier) return evaluateQuantified(step, response, ctx);
  const { value, label } = resolveSubject(step.subject, response, ctx);
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
  if (!quantifiable(step.subject)) {
    throw new RuntimeError('`any`/`all` only apply to a `body.<path>`, `body csv`, or `{variable}` subject');
  }
  // A value subject reads the variable scope, so — unlike the two body roots — it needs no response
  // (M96/D131). The guard therefore moved *below* the subject check rather than staying first.
  if (step.subject.type !== 'ValueSubject' && !response) {
    throw new RuntimeError('no response yet — an `api` step must run before this assertion');
  }
  if (step.matcher.name === 'matchesSchema') {
    throw new RuntimeError('`any`/`all` cannot be combined with `matches schema` — validate the whole array element by element isn\'t supported for contract matching');
  }

  // D19.8 — the root value to walk depends on the subject: JSON body for `body.<path>`, freshly
  // parsed CSV rows for `body csv`, the bound variable for `{name.path}`. Everything from here (walk
  // remaining path, find the first array, map + `evalMatcher` over elements) is already
  // subject-agnostic once it has a root value, exactly as D19.8 predicted when `body csv` was folded
  // in as the second root.
  let current: unknown;
  let path: readonly PathSegment[];
  let subjectLabel: string;
  if (step.subject.type === 'ValueSubject') {
    // The head segment names the variable; the rest is the path to quantify over — which is why
    // D131 requires the array to be reachable *inside* the braces (`{items.price}`).
    const head = step.subject.ref[0]!;
    current = resolveRef([head], ctx);
    path = step.subject.ref.slice(1);
    subjectLabel = head.kind === 'prop' ? head.name : `[${head.index}]`;
  } else if (step.subject.type === 'BodyCsvSubject') {
    current = parseCsv(response!.bodyText);
    path = step.subject.path;
    subjectLabel = 'body csv';
  } else {
    if (response!.json === undefined) throw new RuntimeError('`any`/`all` need a JSON response body (use `body text` for non-JSON)');
    current = response!.json;
    path = step.subject.path;
    subjectLabel = 'body';
  }
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

/** A value subject's label: `orderId`, `items[2].price` — the bare name, **not** `{orderId}`. The
 * braces are interpolation syntax; a failure line reports a value, and every other subject labels
 * itself the way the report reads rather than the way the source was typed (D136). */
function refLabel(ref: readonly PathSegment[]): string {
  return pathLabel(ref).replace(/^\./, '');
}

// ---- subjects --------------------------------------------------------------

function resolveSubject(subject: Subject, response: ResponseTrace | null, ctx: EvalCtx): { value: unknown; label: string } {
  // M96/`FU-11` — a value subject reads the variable scope, not the response, so it resolves
  // *before* the response-null guard below: `expect {orderId} is greater than 0` is legal as a
  // test's first step, and `checkResponseScopes` exempts it for the same reason. `resolveRef`
  // (eval.ts) is the same walk `{orderId}` gets in every other position; an unbound name throws
  // there with the message `TF030` already gave statically.
  if (subject.type === 'ValueSubject') {
    return { value: resolveRef(subject.ref, ctx), label: refLabel(subject.ref) };
  }
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
 * network I/O so a misconfigured test can never actually reach an unlisted host, not even once.
 *
 * The matcher itself moved to `allowHosts.ts` in M85 (C1). It lived here, private, for as long as
 * the interpreter was the only thing that called it — and that is precisely how the guardrail came
 * to cover three call sites out of the six places a run opens a socket: a redirect hop on each of
 * the three clients, and the whole browser half, had no way to reach it. */
export function checkHostAllowed(url: string, config: ResolvedConfig): void {
  if (!isHostAllowed(url, config.allowHosts)) {
    throw new AllowHostsError(allowHostsRefusal(url, config.allowHosts!, { kind: 'request' }));
  }
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

/** The same idea for an explicit `screenshot "<name>"` step below `evidence full` (FS-01) — the
 * step ran and the shot was deliberately not taken, which is a different thing from a capture that
 * silently failed. */
const EVIDENCE_OMITTED_SCREENSHOT = 'not captured (evidence level)';

/**
 * FS-01 (review finding V2-01) — **binary evidence exists only at `evidence full`.** One sentence,
 * no exceptions: trace archives, explicit `screenshot` steps, best-effort failure screenshots and
 * `matches snapshot` diff images are all page *pixels*, and there is no redactor that reaches
 * rendered text. The only promise the tool can keep about a captured screenshot is "we didn't
 * capture it" — so `headers-only`/`none`, the levels a user reaches for precisely when they are
 * about to attach the artifact somewhere, suppress every one of them rather than shipping a
 * hand-wave about cleaning them.
 *
 * Where the capture exists *only* to produce report evidence (trace, failure screenshot, the
 * `screenshot` step) the capture itself is skipped. `matches snapshot` is the one place the pixels
 * are load-bearing for an assertion, so there the comparison still runs and only the images are
 * withheld from the report — the assertion's own pass/fail and its `N px / N% differed` message are
 * unaffected.
 */
function capturesBinaryEvidence(config: ResolvedConfig): boolean {
  return config.evidenceLevel === 'full';
}

/** Builds the **report-only** copy of a request trace: secret redaction (existing, decision
 * P#30) → declarative field redaction (decision 101d) → evidence-level trim (decision 101c), in
 * that order. The raw `trace` returned alongside this by `execApi` is what `expect`/`capture`
 * actually read — this copy never feeds back into the run. */
function redactRequest(req: RequestTrace, r: Redactor, config: ResolvedConfig): RequestTrace {
  // FS-03: `redact query "…"` applies at every evidence level, because the URL itself survives at
  // every level — including `none`, where it is nearly all that survives.
  const url = redactUrlQuery(r.redact(req.url), config.redactPatterns);
  if (config.evidenceLevel === 'none') return { method: req.method, url, headers: {} };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = r.redact(v);
  const masked = redactHeaderFields(headers, config.redactPatterns);
  if (config.evidenceLevel === 'headers-only') return { method: req.method, url, headers: masked };
  const body = req.body !== undefined ? redactFields(r.redact(req.body), config.redactPatterns) : undefined;
  return { method: req.method, url, headers: masked, ...(body !== undefined ? { body } : {}) };
}

// Gap #17: the report-only copy never carries real bytes, at any evidence level — `results.json`
// is `JSON.stringify`'d verbatim (reporter/src/index.ts), and a raw `Buffer` serializes as one
// array entry per byte (`{"type":"Buffer","data":[…]}`), exactly the unreadable-artifact problem
// D17.4 fixed for `repr()`'s failure-message text. This field only exists to satisfy
// `ResponseTrace`'s shape for this report copy — nothing in `packages/reporter` ever reads it back
// (html.ts/junit rendering only ever used `bodyText`); the live, ungutted `response.bodyBytes` used
// by `expect`/`capture` comes from the raw trace `execApi` returns alongside this, never from here.
const NO_REPORT_BODY_BYTES = Buffer.alloc(0);

// M88c1 — the report copy of a chain. `finalUrl` survives at every evidence level for the same
// reason `RequestTrace.url` does (FS-03): it is a URL, it is nearly all that is left at `none`, and
// when it differs from the request's it is the single most useful thing on the trace. `cookieEvents`
// is the opposite — raw `Set-Cookie` values, i.e. credentials, whose place in a report is already
// taken by `headers['set-cookie']` *after* `redactHeaderFields` has masked it. They exist to be
// handed to the jar in-process and nowhere else, so this copy carries none, explicitly, rather than
// relying on a spread not to pick them up (`B4-16` is that mistake made in the other file).
const NO_REPORT_COOKIE_EVENTS: readonly CookieEvent[] = [];

function redactResponse(res: ResponseTrace, r: Redactor, config: ResolvedConfig): ResponseTrace {
  const statusText = r.redact(res.statusText);
  const finalUrl = redactUrlQuery(r.redact(res.finalUrl), config.redactPatterns);
  if (config.evidenceLevel === 'none') {
    return { status: res.status, statusText, headers: {}, bodyText: EVIDENCE_OMITTED_BODY, bodyBytes: NO_REPORT_BODY_BYTES, durationMs: res.durationMs, finalUrl, cookieEvents: NO_REPORT_COOKIE_EVENTS };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k] = r.redact(v);
  // FS-03: the same `redact header "…"` patterns cover the response side — a `Set-Cookie` coming
  // back is as much a credential as an `Authorization` going out.
  const masked = redactHeaderFields(headers, config.redactPatterns);
  if (config.evidenceLevel === 'headers-only') {
    return { status: res.status, statusText, headers: masked, bodyText: EVIDENCE_OMITTED_BODY, bodyBytes: NO_REPORT_BODY_BYTES, durationMs: res.durationMs, finalUrl, cookieEvents: NO_REPORT_COOKIE_EVENTS };
  }
  const bodyText = redactFields(r.redact(res.bodyText), config.redactPatterns);
  return { status: res.status, statusText, headers: masked, bodyText, bodyBytes: NO_REPORT_BODY_BYTES, durationMs: res.durationMs, finalUrl, cookieEvents: NO_REPORT_COOKIE_EVENTS };
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
  endpoint?: string,
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
    ...(endpoint ? { endpoint } : {}),
  };
}

/** M43 (D67/D68) — an `ApiStep`'s stable endpoint identity: its explicit `as "label"` tag when
 * present (replaces the identity entirely, k6-style), else the automatic `METHOD path.raw`. */
function apiStepIdentity(step: ApiStep): string {
  return step.tag ? step.tag.value : `${step.method} ${step.path.raw}`;
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
    case 'TickStmt':
      return 'checkbox';
    case 'UntickStmt':
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
    case 'PauseStmt':
      return 'pause';
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
