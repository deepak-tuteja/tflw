// The interpreter: walks a parsed Program, executes API-only tests via fetch, and emits the
// event stream that the reporter consumes (SPEC §4–5, §13). Design invariants:
//  - API expects evaluate once against the received response and fail fast (P#15); `wait until
//    api` is the explicit, greppable escape hatch for eventual consistency (SPEC §5.5).
//  - a hard `expect` failure (or any runtime error) ends the test immediately (P#16).
//  - request/response traces stored in the report are redacted; the live values used to send the
//    request and to evaluate assertions are the real ones (P#30).

import { readFile } from 'node:fs/promises';
import { basename, join, resolve as resolvePath } from 'node:path';
import { isAbsoluteUrl, parseSource, quantifiable, renderDiagnostics, type ActionDecl, type CallExpr } from '@tflw/lang';
import type {
  FindingSeverity,
  ApiBody,
  ApiRequestSpec,
  ApiStep,
  CaptureStmt,
  CsrfStmt,
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
  CrawlDecl,
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
import { filterBySeverity, SEVERITY_RANK, type Finding } from './finding.js';
import { judge, OPEN_GATE, toScanFinding, withheldNote, type GateVerdict, type ScanGate, type ScanKind, type ScanSink } from './scanFindings.js';
import { runSecurityScan, SECURITY_RULES, type Observation, type ScanResult, type TlsObservation } from './securityRules.js';
import { TlsProber } from './tlsProbe.js';
import { extractResourceIds, judgeable, PROBE_OUTCOME_LABEL, runAuthzScan, type AuthzScanResult, type ProbeResult } from './authzRules.js';
import { ANONYMOUS, AuthzProber, isSafeMethod, mayProbeMutating, probeOrder, type ProbePolicy, type ProbePrincipal, type ProbeSender } from './authzProbe.js';
import { INPUT_CORPUS, mutationSites, templateEndpoint, type MutationSite } from './inputCorpus.js';
import { grantedClasses, InputProber, planProbes, withheldClasses, type InputProbePolicy, type InputProbeSender } from './inputProbe.js';
import { seededIds, seededPayloads } from './inputSeeded.js';
import { MUTATION_OUTCOME_LABEL, runInputScan, type InputScanResult, type MutationOutcome, type MutationResult } from './inputRules.js';
import {
  BrowserPageState,
  captureFailureScreenshot,
  describeLocator,
  diagnoseMissingLocator,
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
  type LocatorScope,
  type PWLocator,
  type PWPage,
  type ResolvedLocator,
} from './browser.js';
import { evaluateSnapshot, snapshotPaths } from './snapshot.js';
import { camelCaseName, interceptTypelessModuleWarning, loadHelperModule } from './helpers.js';
import { loadTableRows, type RowCell } from './dataTable.js';
import { Redactor, redactReport } from './redact.js';
import { headerMatchesRedactPattern, maskDetailValue, pathMatchesRedactPattern, redactFields, redactHeaderFields, redactUrlQuery } from './fieldRedact.js';
import { evaluateSchemaMatch, loadOpenApiDocumentForCrawl } from './contract.js';
// M137c (D435/D436) — the crawl engine. Everything it touches in the world is injected from here, so
// this file keeps sole ownership of how a request is built and a crawl can never disagree with an
// `api` step about what a request is.
import { runCrawl, type CrawlDeps, type CrawlRequest } from './crawl.js';
import { evaluateFileMatch } from './binary-match.js';
import { parseCsv } from './csv-parse.js';
import { extractPdfText } from './pdf-text.js';
import { CookieJar } from './cookieJar.js';
import { sendRequest } from './http.js';
import { absoluteUrlNeedsAllowHosts, AllowHostsError, allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { createKeepAliveAgents, destroyKeepAliveAgents, sendPinnedRequest, warnPinnedFallback, type KeepAliveAgents } from './httpPinned.js';
import { hashString, mulberry32, resolveRunClock, resolveRunSeed, subSeed } from './seed.js';
import { inferContentType } from './mime.js';
import { acquireInsecureTls, releaseInsecureTls } from './tls.js';
import { finalizeVerdict } from './run-verdict.js';
import type {
  AttemptResult,
  BackOffDiagnosis,
  CookieEvent,
  CrawlResult,
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
  /** Directory `tflw.config` lives in (`M97c-03`). Relative paths declared in the *config* —
   * a `session` body's `body from`/`upload`/`matches file`, and per-env mTLS `cert`/`key` — resolve
   * against this, not against `baseDir`. The two are the same directory in the common flat layout,
   * which is why the difference stayed invisible: it only shows up once a suite puts its `.tflw`
   * files in a subdirectory, or once two files in *different* directories opt into one session.
   *
   * Defaults to `process.cwd()` because that is not a guess — `cli.ts` reads the config from
   * exactly `join(cwd, 'tflw.config')`, so cwd *is* the config's directory on every real run. */
  readonly configDir?: string;
  /**
   * `tflw.config`'s own source lines (`M111`, review row `FU-06`) — the document a `session`
   * block's spans point into, exactly as `source` above is the document a test's spans point into.
   *
   * A step's reported `source` is sliced out of a line array by line number, and until M111 there
   * was only one such array per run: the *test file's*. A session is declared in `tflw.config`, so
   * every session step was rendered by taking its `tflw.config` line number and reading that line
   * out of whichever `.tflw` file happened to trigger the session first — text from one document
   * at coordinates from another.
   *
   * Optional, defaulting to `[]`, because `runProgram` is a library entry point plenty of callers
   * reach with no config file at all. `[]` renders a session step's source as empty, which is the
   * honest answer when the config's text was never supplied — never a line of unrelated text.
   */
  readonly configLines?: readonly string[];
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
  /** M128c (D288) — shared across every file in a run so the TLS probe opens **one** handshake per
   * `host:port` for the whole run, not one per file. Same contract as `sessionCache` directly above,
   * and shared for the same reason: a per-file prober would satisfy the letter of "cached" while a
   * 30-file suite still paid 30 handshakes. Omitted by single-`runProgram`-call callers, which then
   * get their own. */
  readonly tlsProber?: TlsProber;
  /** M130b (D331/D332) — where every authorization finding and decline is accumulated across the
   *  whole run, for the run summary's declines block and the repro emitter. Shared across every
   *  `runProgram` call in a run, like `sessionCache` and `tlsProber` and for the same reason: the
   *  numbers are the run's, not the file's, and the repro files are written once, after everything
   *  has finished. Omitted by single-call callers, which then simply collect nothing. */
  readonly authzSink?: AuthzSink;
  /** M134b (D385) — where **every** scan's findings are accumulated for `RunReport.findings`, across
   *  all three tiers. Shared for `authzSink`'s reason and beside it rather than folded into it: that
   *  one feeds D332's repro emitter, which needs a principal and owner ids that two of the three
   *  scans do not have. Omitted by single-call callers, which then simply collect nothing. */
  readonly scanSink?: ScanSink;
  /** M134b (D386/D387) — `--fail-on` and `--baseline`, applied inside each scan assertion before its
   *  pass/fail decision. Omitted means `OPEN_GATE`: every finding gates, which is the default and
   *  the behaviour every run had before this milestone. */
  readonly scanGate?: ScanGate;
  /** M134b (D369/D388) — `--probe-seeded <n>`: extra generated payloads per **already-granted**
   *  class. Omitted or `0` means the seeded layer is off and the run sends byte-for-byte the requests
   *  it sent before this milestone. It cannot widen what `authorized target` permitted. */
  readonly probeSeeded?: number;
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
  const configDir = opts.configDir ?? process.cwd();
  const configLines = opts.configLines ?? [];
  const lines = opts.source.split('\n');
  const startedAt = new Date().toISOString();
  const runStart = performance.now();
  const runSeed = resolveRunSeed(opts.seed);
  const runClock = resolveRunClock(opts.now);
  const uniqueSeq = opts.uniqueSeq ?? makeUniqueSeq();
  const testIndexOffset = opts.testIndexOffset ?? 0;
  const sessionCache = opts.sessionCache ?? new SessionCache();
  const tlsProber = opts.tlsProber ?? new TlsProber();
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
  // M137c (D432/D435). `crawls` is absent on every program written before this milestone (`ast.ts`
  // keeps the field off the node rather than emitting `[]`), so `?? []` is the whole compatibility
  // story. The traffic sink is created only when some crawl in this file asks for it — see
  // `TestCtx.trafficSink`.
  const crawls = program.crawls ?? [];
  const traffic: RequestTrace[] = [];
  const capturesTraffic = crawls.some((c) => c.seeds.some((seed) => seed.type === 'TrafficSeed'));

  // `cases` is functional-only (`expandTestCases` skips workload-bearing tests), while the final
  // report counts both — so a file holding one workload test and nothing else announced `total: 0`
  // and ended `total: 1`, and a progress consumer rendered "0 tests" then reported a result
  // (M77, review finding B3-07). It is a forecast, not a promise: a *failing* file hook adds one
  // further entry to the report, which is why SPEC §13 says `run:end.total` may exceed this.
  // M137c — crawls are counted in the forecast for the reason `M88d` made a workload test emit its
  // pair at all: an entry that reaches `report.total` without ever being announced makes a consumer
  // tailing the stream see a run begin, then a finished report naming something it was never told
  // about.
  emit({ type: 'run:start', total: cases.length + scenarios.length + crawls.length, env: config.envName });

  const results: ReportEntry[] = [];
  const fileTc: TestCtx = { environ, redactor, emit, lines, baseDir, configDir, configLines, rng: mulberry32(runSeed), runSeed, runClock, uniqueSeq, sessionCache, tlsProber, ...(opts.authzSink ? { authzSink: opts.authzSink } : {}), ...(opts.scanSink ? { scanSink: opts.scanSink } : {}), ...(opts.scanGate ? { scanGate: opts.scanGate } : {}), ...(opts.probeSeeded ? { probeSeeded: opts.probeSeeded } : {}), ...(capturesTraffic ? { trafficSink: traffic } : {}), browserManager: opts.browserManager, filePath, updateSnapshots };
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
            const tc: TestCtx = { environ, redactor, emit: caseEmit, lines, baseDir, configDir, configLines, rng: mulberry32(testSeed), runSeed, runClock, uniqueSeq, sessionCache, tlsProber, ...(opts.authzSink ? { authzSink: opts.authzSink } : {}), ...(opts.scanSink ? { scanSink: opts.scanSink } : {}), ...(opts.scanGate ? { scanGate: opts.scanGate } : {}), ...(opts.probeSeeded ? { probeSeeded: opts.probeSeeded } : {}), ...(capturesTraffic ? { trafficSink: traffic } : {}), browserManager: opts.browserManager, filePath, updateSnapshots };
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
    // M137c (D468) — **after every test in the file, before the after-file hooks.** Not in
    // file-declaration order, which is `D101`/`D112`'s rule for tests and deliberately not this one's:
    // a crawl's `seed traffic` is the traffic the run itself produced, so running it in the position an
    // author happened to type it in would make *what it discovers* depend on where the declaration
    // sits. Before the after-file hooks because those are where a suite tears its fixtures down, and a
    // crawl walking a surface whose data has just been deleted would report the teardown as findings.
    for (const crawl of crawls) {
      results.push(await runCrawlDecl(crawl, config, fileTc, traffic));
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
  const rawReport: RunReport = finalizeVerdict({
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
  });
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
  /** `M97c-03` — see `RunOptions.configDir`. A load run establishes sessions and presents mTLS
   * client certs exactly like a functional one, so it needs the same distinction. */
  readonly configDir?: string;
  /** `M111` (`FU-06`) — see `RunOptions.configLines`. A load run establishes sessions the same
   * way, so its session steps are sliced out of the same wrong document without this. */
  readonly configLines?: readonly string[];
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
  runIteration: (pinnedAgents?: KeepAliveAgents) => Promise<void>,
  abortSignal?: AbortSignal,
): Promise<void> {
  const scheduleEnd = runStart + scheduleMs;
  const vuPromises: Promise<void>[] = [];
  for (let i = 0; i < maxVus; i++) {
    vuPromises.push(
      (async () => {
        let pinnedAgents: KeepAliveAgents | undefined;
        try {
          while (performance.now() < scheduleEnd && !abortSignal?.aborted) {
            if (i < targetUsersAt(performance.now() - runStart)) {
              if (!pinnedAgents) pinnedAgents = createKeepAliveAgents();
              await runIteration(pinnedAgents);
            } else {
              await sleep(POPULATION_POLL_INTERVAL_MS, abortSignal);
            }
          }
        } finally {
          if (pinnedAgents) destroyKeepAliveAgents(pinnedAgents);
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

  // M45 (D75) — `pinnedAgents` carries this iteration's keep-alive pair down to `execApi`. The
  // closed-model spawn blocks below create one pair per VU and reuse it across every iteration that
  // VU runs.
  //
  // M121 (`M118-02`, D206/D207) corrects what this comment used to say. It read: an open-model
  // arrival "has no persistent VU to pin a connection to … so it stays on `sendRequest`'s unpinned
  // path exactly as before." The premise is true and the conclusion did not follow — it rules out
  // per-VU *pinning*, not *pooling*, and the two were being treated as the same decision. The cost
  // was not a missed optimisation: the unpinned path is `fetch`, and on Node 26 a `fetch` issued
  // from a timer callback that the issuing loop does not await (exactly an open arrival's shape) has
  // its completion deferred to about the next timer tick, so the reported duration tracked the
  // *inter-arrival gap* rather than the service time. The two models disagreed by ~100x about one
  // endpoint. Open scenarios now share one pair for the whole scenario (`openArrival` below).
  const runIteration = async (pinnedAgents?: KeepAliveAgents): Promise<void> => {
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
    const sessionCsrfHeaders: Record<string, string> = {};
    const cookieJar = new CookieJar();
    const sessionFindings: Finding[] = [];
    const sessionRefs = new Map<string, SessionRef>();
    for (const sessionName of scenario.sessions) {
      const decl = config.sessions.get(sessionName);
      if (!decl) throw new RuntimeError(`unknown session "${sessionName}" — is it declared in tflw.config?`);
      const outcome = await sessionCache.ensure(sessionName, decl, config, iterTc, false);
      if (!outcome.ok) throw new RuntimeError(`session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`);
      Object.assign(sessionHeaders, outcome.headers);
      Object.assign(sessionCsrfHeaders, outcome.csrfHeaders);
      sessionFindings.push(...outcome.securityFindings);
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
      sessionCsrfHeaders,
      sessionNames: scenario.sessions,
      sessionFindings,
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

  // M121 (D207) — one pair for every arrival this scenario ever fires, created on the first arrival
  // (a shard whose striped share rounds to no arrivals, or a `0 rps` stage that never fires one,
  // opens no socket at all — the same laziness `runClosedPopulationVus` gives an idle VU) and
  // destroyed once the last one settles. Created *here*, in one place shared by all three open
  // branches below, rather than inside each: "every arrival in this scenario uses the same pair" is
  // then structural rather than a property three call sites have to keep agreeing on. A pair per
  // arrival would put a fresh TCP handshake in front of every sample and be worse than the `fetch`
  // path this replaces — see D207.
  let openAgents: KeepAliveAgents | undefined;
  const openArrival = (): Promise<void> => runIteration((openAgents ??= createKeepAliveAgents()));

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
          const pinnedAgents = createKeepAliveAgents();
          try {
            // M32 (R5): Ctrl-C stops this VU from *starting* another iteration — whichever
            // iteration it's mid-`runIteration()` on (if any) still runs to completion above.
            while (performance.now() < runEnd && !abortSignal?.aborted) await runIteration(pinnedAgents);
          } finally {
            destroyKeepAliveAgents(pinnedAgents);
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
      vuPromises.push(openArrival());
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
    vuPromises.push(runOpenPopulationArrivals(runStart, forMs, () => targetRps, openArrival, abortSignal));
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
    vuPromises.push(runOpenPopulationArrivals(runStart, scheduleMs2, (elapsedMs) => stageTargetAt(stages, elapsedMs, shard), openArrival, abortSignal));
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
          const pinnedAgents = createKeepAliveAgents();
          try {
            while (remaining > 0 && !abortSignal?.aborted) {
              remaining--;
              await runIteration(pinnedAgents);
            }
          } finally {
            destroyKeepAliveAgents(pinnedAgents);
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
          const pinnedAgents = createKeepAliveAgents();
          try {
            for (let n = 0; n < iterationsPerVu && !abortSignal?.aborted; n++) await runIteration(pinnedAgents);
          } finally {
            destroyKeepAliveAgents(pinnedAgents);
          }
        })(),
      );
    }
  }

  // M121 (D207) — the open pair outlives the arrival *schedule* and dies with the last arrival, so
  // the teardown belongs here and not in any branch above. A narrow `finally` is sufficient rather
  // than one wrapping the whole dispatch: nothing in the branches above can throw before this line.
  // The only `await` any of them performs on this task's own stack is `sleep`, which never rejects
  // (it resolves on abort rather than throwing, see its definition), and `runIteration` reports a
  // failed iteration instead of propagating one.
  try {
    await Promise.all(vuPromises);
  } finally {
    if (openAgents) destroyKeepAliveAgents(openAgents);
  }
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
  const configDir = opts.configDir ?? process.cwd();
  const configLines = opts.configLines ?? [];
  const lines = opts.source.split('\n');
  const runSeed = resolveRunSeed(opts.seed);
  const runClock = resolveRunClock(opts.now);
  const uniqueSeq = makeUniqueSeq();
  const sessionCache = new SessionCache();
  const tlsProber = new TlsProber();
  const registry = await buildRegistry(program, baseDir);
  const beforeEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'before');
  const afterEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'after');
  const tc: TestCtx = { environ, redactor, emit: () => {}, lines, baseDir, configDir, configLines, rng: mulberry32(runSeed), runSeed, runClock, uniqueSeq, sessionCache, tlsProber, filePath: baseDir, updateSnapshots: false };

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

/**
 * M107b (`M107-01`, D-M107-1) — does this workload hold **one** concurrency level for its whole
 * window? The back-off ratio compares the first half's mean iteration duration to the second
 * half's, and that comparison only means "the target slowed down" if nothing else about the two
 * halves differs. Under a rising target the halves differ by construction — a `ramp to N users
 * over M` runs its second half at roughly 3× the concurrency of its first — and any system with a
 * finite service rate answers more concurrent work more slowly. Little's law, not degradation.
 *
 * **Measured, 8 runs per cell, three fixture targets** (flat/infinite-capacity, a healthy
 * single-queue service of finite capacity, and a genuinely leaking one whose service time grows
 * with elapsed time regardless of load):
 *
 *                        ramp to 5 users over 1500ms      hold 5 users for 1500ms
 *     flat (∞ capacity)  0/8 warned   ratio 0.000         0/8 warned   ratio ≤0.012
 *     healthy queue      8/8 warned   ratio 0.569–0.589   0/8 warned   ratio ≤0.005
 *     leaking (real)     8/8 warned   ratio 0.334–0.348   8/8 warned   ratio 0.359–0.381
 *
 * The healthy service under `ramp` does not merely trip the threshold — **it scores higher than
 * the genuinely degrading one does under either shape**. There is no threshold that admits the
 * leak (≤0.33) and rejects the healthy queue (≥0.56), so this was never a tuning problem. Under
 * `hold` the same three targets separate perfectly, by two orders of magnitude, with the existing
 * 0.2 threshold sitting in the middle of an empty gap.
 *
 * **Normalising by live VU count was rejected on the same numbers, not on taste.** A ramp's halves
 * average `users/4` and `3·users/4` VUs, so the normalised ratio is `1 − 3·earlyMean/lateMean`;
 * feeding the measured means through it clamps *every* cell above to 0 — including the leaking one.
 * It does not correct the ramp diagnostic, it silently disables it, which is strictly worse than
 * saying so.
 *
 * **And for `ramp` specifically the question is unanswerable, not merely hard**: the grammar gives
 * a ramp no plateau (SPEC — "the scenario itself lasts exactly `overMs`, no separate hold stage"),
 * so no two windows of the run ever share a concurrency level. There is no like-for-like comparison
 * to make. That is why this returns `undefined` rather than a softened number, exactly as D17
 * already does for the open model and D102 for the count-based kinds: *"a report never implies 'we
 * checked and it's fine' for a model where the question doesn't apply."* This applies that existing
 * rule to a case it had been getting wrong, rather than inventing a new one.
 *
 * A `step` or `spike` whose stages all name the same target and never ramp is a `hold` written
 * long-hand, and stays eligible — the two existing D98 fixtures are exactly that shape.
 */
function hasConstantConcurrency(w: Workload): boolean {
  switch (w.type) {
    case 'HoldUsersWorkload':
      return true;
    case 'RampUsersWorkload':
      return false;
    case 'StepUsersWorkload':
    case 'SpikeUsersWorkload':
      return w.stages.every((s) => s.mode === 'jump' && s.target === w.stages[0]!.target);
    default:
      return false;
  }
}

/** M34 (D17), extended by M52/D98 to every closed (`users`) kind — see `BackOffDiagnosis`'s doc
 * (types.ts) for the full design and why an early-half vs. late-half mean comparison was chosen
 * over an extremal-percentile "ideal pace" baseline. `undefined` for an open-model (`…RpsWorkload`)
 * or count-based scenario, or when either half has too few iterations to trust its own mean. */
export function computeBackOff(scenario: LoadTest, early: { readonly count: number; readonly sum: number }, late: { readonly count: number; readonly sum: number }): BackOffDiagnosis | undefined {
  if (!CLOSED_USERS_KINDS.has(scenario.workload.type)) return undefined;
  // M107b (`M107-01`, D-M107-1) — a rising target makes the two halves incomparable. See
  // `hasConstantConcurrency` for the 8-runs-per-cell measurement that settled this.
  if (!hasConstantConcurrency(scenario.workload)) return undefined;
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
  // `M114` — `inconclusive`/`aborted` arrive *here*, after `runProgram` already stamped this
  // report's `ok`, so the verdict has to be re-derived rather than carried over (`M111-01`).
  return finalizeVerdict({
    ...report,
    tests,
    selfDiagnosis: loadReport.selfDiagnosis,
    inconclusive: loadReport.inconclusive,
    ...(loadReport.aborted ? { aborted: true, abortedMessage: loadReport.abortedMessage } : {}),
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
  // The only window in which Node can emit `MODULE_TYPELESS_PACKAGE_JSON` (M125b2, `FU-15`, D259):
  // installed here rather than at CLI start so `tflw watch`'s long-lived process doesn't accumulate
  // handlers, and skipped entirely when there is nothing to load.
  const restoreWarnings = program.uses.length > 0 ? interceptTypelessModuleWarning() : undefined;
  try {
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
  } finally {
    // `process.emitWarning` defers to the nextTick queue, so the warning for the *last* module can
    // still be in flight when the loop's final `await` resumes. One `setImmediate` drains it while
    // our handler is still installed — without it the interception is correct for every helper but
    // the last, and it fails the way this whole row is about: silently, back to raw Node output.
    if (restoreWarnings) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      restoreWarnings();
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
  /** `M97c-03` — see `RunOptions.configDir`. Carried on every `TestCtx` (rather than threaded to
   * the two sites that need it) because a session's establishment run *derives* a `TestCtx` from
   * whichever caller triggered it, and that derivation is where the rebase happens. */
  readonly configDir: string;
  /** `M111` (`FU-06`) — see `RunOptions.configLines`. Carried here for the same reason `configDir`
   * is: `sessionCtx` is where a session's context is derived from its caller's, and that is the one
   * place that can swap `lines` for the document a session's spans actually index. */
  readonly configLines: readonly string[];
  readonly rng: () => number;
  readonly runSeed: number;
  readonly runClock: Date;
  readonly uniqueSeq: { next(): number };
  readonly sessionCache: SessionCache;
  /** M128c (D288) — the run-lifetime TLS probe cache. Threaded on `TestCtx` exactly as
   * `sessionCache` is, and for the same reason: D288 says *once per `host:port` per run*, and a
   * prober created per file would re-handshake per file while still calling itself a run-level
   * cache. A session's derived context inherits it through `sessionCtx`'s spread. */
  readonly tlsProber: TlsProber;
  /** M130b (D331/D332) — where every authorization finding and every decline is accumulated for the
   *  run summary and the repro emitter. Optional: a helper driving one assertion in isolation still
   *  gets its answer, it just has nothing collecting the run-level view. */
  readonly authzSink?: AuthzSink;
  /** M134b (D385/D386) — the run-level finding collector and the gate, threaded exactly as
   *  `authzSink` is. Both optional for its reason: a helper driving one assertion in isolation still
   *  gets its answer, and an absent gate is the open one every run had before this milestone. */
  readonly scanSink?: ScanSink;
  readonly scanGate?: ScanGate;
  /** M134b (D388) — `--probe-seeded`'s value; `undefined`/`0` is the layer off. */
  readonly probeSeeded?: number;
  /** M137c (D435) — `crawl … seed traffic`'s source: every `api` step's own request, in the order the
   *  run made them, accumulated across the whole file.
   *
   *  **Present only when a crawl in this file actually declares the seed**, which is why it is optional
   *  rather than always-on: keeping every request of every run would put a growing array behind a
   *  feature most suites never use, and a `--workers N` run has one of these per file already. Absent
   *  is the same thing empty means, so nothing has to distinguish them.
   *
   *  Deliberately fed from `ApiStep` only. `wait until api` re-issues one request until it passes, so
   *  the interesting member of that sequence is ambiguous, and a session's establishment requests are
   *  a credential's own traffic rather than the suite's. */
  readonly trafficSink?: RequestTrace[];
  readonly browserManager?: BrowserManager;
  /** M4b, D15 — see `RunOptions.filePath`/`updateSnapshots`. */
  readonly filePath: string;
  readonly updateSnapshots: boolean;
  /** M45 (D75) — the `node:http`/`node:https` keep-alive pair this iteration sends over, set only
   * on a load iteration's own `iterTc` (`runLoadCore` below): one pair per VU in the closed model,
   * and since M121 (D207) one pair per *scenario*, shared by every arrival, in the open one.
   * Undefined everywhere else (a plain `tflw run`, a session's own establishment run, `wait until
   * api` outside a load context) — those keep using `sendRequest`'s unpinned `fetch()`. */
  readonly pinnedAgents?: KeepAliveAgents;
}

export interface SessionOutcome {
  /** Headers this session's `header` steps captured, already evaluated + stringified. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * M137b (D433) — headers this credential attaches to **mutating requests only**, captured out of
   * its own establishment response by `csrf from … send as header "…"`. `{}` for a session that
   * declares no clause, which is every session that existed before this milestone.
   *
   * **Its own field rather than more entries in `headers`**, which is the one structural decision in
   * `M137b`. `headers` is `Object.assign`'d onto every outgoing request at five sites, and a CSRF
   * token is verb-conditional — but the binding reason is `D434`: `sec/csrf-not-enforced` probes a
   * derived principal defined as *this credential minus its CSRF headers*, and that subtraction is
   * only expressible while the engine can still tell which headers those are. Merged into `headers`,
   * the derivation could not distinguish the token from the `Authorization` header next to it, and
   * withholding both measures authentication rather than CSRF.
   */
  readonly csrfHeaders: Readonly<Record<string, string>>;
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
  /** M128b/D287 — what the security pack found in this session's own login responses, scanned once
   * here rather than re-derived at every assertion. Deduplicated by rule id + detail: a session
   * whose body makes three requests to the same host would otherwise report one `hsts-missing` per
   * request, and the finding is about the host, not about how many times the session called it. */
  readonly securityFindings: readonly Finding[];
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
  // M111 (`FU-06`) — derive the session's context *before* the split, not inside one arm of it.
  // The `oauth2` arm used to be handed the caller's raw `tc`, so M97c-03's rebase never reached it
  // at all: an `oauth2` session's step was rendered from the caller's text, and its `baseDir` and
  // `filePath` were the caller's too. Nothing in `sessionCtx` is specific to a hand-written body —
  // both arms declare their steps in `tflw.config` and both report them, which is the whole reason
  // the rebase exists. Applying it once, above the branch, is what makes that structural.
  const sessionTc = sessionCtx(decl.name, tc);
  if (decl.oauth2) return runOauth2Session(decl.name, decl.oauth2, config, sessionTc);
  const headerSink: Record<string, string> = {};
  const csrfSink: Record<string, string> = {};
  const scope = new Map<string, unknown>();
  const cookieJar = new CookieJar();
  const securitySink: Observation[] = [];
  const ctx: EvalCtx = { scope, environ: tc.environ, redactor: tc.redactor, rng: sessionTc.rng, runSeed: tc.runSeed, runClock: tc.runClock, uniqueSeq: tc.uniqueSeq, sessionHeaders: {}, sessionNames: [], headerSink, csrfSink, cookieJar, securitySink };
  const emptyRegistry: CallRegistry = { actions: new Map(), helpers: new Map() };
  const exec = await execSteps(decl.body, config, ctx, sessionTc, `session ${decl.name}`, emptyRegistry);
  return {
    headers: headerSink,
    csrfHeaders: csrfSink,
    cookieJar,
    ok: exec.ok,
    ...(exec.error ? { error: exec.error } : {}),
    steps: exec.steps,
    securityFindings: scanSessionObservations(decl.name, securitySink),
  };
}

/**
 * The `TestCtx` a session's own establishment run executes under (`M97c-03`).
 *
 * `SessionCache.ensure()` hands `runSession` the `TestCtx` of whichever test happened to trigger
 * the session first, and most of that context is exactly what a session body wants — the same
 * environment, the same redactor, the same run seed and clock. Two fields are not: `baseDir` and
 * `filePath` describe *the caller's test file*, and a session is not declared in a test file at
 * all. It is declared in `tflw.config` and shared by every file that says `as <name>`.
 *
 * Left as the caller's, they made a shared declaration mean different things depending on run
 * order: `body from "./creds.json"` resolved against `dirname(<whichever file won>)`, and a
 * session's snapshot baseline landed under that file's `snapshots/` tree. Rebasing both onto the
 * config's own directory is the only answer that does not depend on the race — and it is the answer
 * the person who wrote the path was looking at.
 *
 * This is decision 53's rule applied to the two fields it left behind: that decision re-seeded a
 * session's `rng` from the session's own *name* for exactly this reason, noting `tc.rng` "belongs
 * to whichever test's `TestCtx` happened to win the race to establish the session first". Anything
 * on a session's context that is derived from the caller rather than from the session is a bug
 * waiting for a second test file to expose it.
 *
 * **`lines` was a third such field, and M111 (`FU-06`) is that sentence coming true.** M97c-03
 * rebased `baseDir` and `filePath` and left `lines` — the caller's *text*, kept alongside a
 * `filePath` that now truthfully said `tflw.config`. A step's reported `source` is
 * `lines[span.start.line - 1]`, so every session step was rendered by reading a `tflw.config` line
 * number out of a `.tflw` file: text from one document at coordinates from another. What that
 * prints depends entirely on how long the caller's file is — a plausible wrong line when it is long
 * enough, an empty string when it is not. Measured on the `FU-06` repro, an `api` step's `source`
 * read `expect status equals 200`: one record whose `kind` and whose text disagreed about what kind
 * of statement it even was.
 *
 * It is visible on failure and wrong on success too, in every report tflw has ever written.
 */
function sessionCtx(name: string, tc: TestCtx): TestCtx {
  return { ...tc, lines: tc.configLines, baseDir: tc.configDir, filePath: join(tc.configDir, 'tflw.config'), rng: mulberry32(subSeed(tc.runSeed, hashString(name))) };
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
    securityFindings: [],
    headers: {},
    csrfHeaders: {},
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
    // M137b (D433) — always empty here, and structurally so rather than by omission: an `oauth2`
    // session's body is a fixed sugar shape (`token url`/`client id`/`client secret`/`scope`), so
    // there is no position in the grammar where a `csrf from` clause could be written. It would also
    // have nothing to protect — this credential travels as a bearer header and sends no cookie, which
    // is exactly the contrast `shopperBearer` is declared to demonstrate (D356).
    csrfHeaders: {},
    cookieJar,
    ok: true,
    steps: [mkStep('api', src, oauth2.span, true, start, detail, redactedRequest, redactedResponse)],
    // D287 applies to an `oauth2` session exactly as it does to a hand-written one: the token
    // endpoint's response is a login response, and it is the one this session actually made. Scanned
    // from the *live* `request`/`response` above rather than the redacted pair one line up, for the
    // reason `toObservation` gives.
    securityFindings: scanSessionObservations(name, [toObservation(request, response)]),
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
    // M137b (D433) — the refreshed CSRF token has to land with the refreshed identity, on the same
    // in-place-mutation path and for a sharper reason than symmetry. A re-established session that
    // kept its old token would send a *stale* token with a *fresh* cookie, and the app would answer
    // `403` — indistinguishable at a glance from the CSRF defence working, on the retry that was
    // supposed to fix the problem. Merged rather than replaced, so a same-named header updates.
    if (ctx.sessionCsrfHeaders) Object.assign(ctx.sessionCsrfHeaders as Record<string, string>, outcome.csrfHeaders);
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
  const sessionCsrfHeaders: Record<string, string> = {};
  const cookieJar = new CookieJar();
  const sessionFindings: Finding[] = [];
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
    Object.assign(sessionCsrfHeaders, outcome.csrfHeaders);
    sessionFindings.push(...outcome.securityFindings);
    // Clone, not the live shared instance (SPEC §3.3) — this test's own subsequent cookie updates
    // must never leak back into the session cache or a concurrently-running sibling test.
    cookieJar.mergeFrom(outcome.cookieJar.clone());
  }
  const evalCtx: EvalCtx = {
    ...nameCtx,
    sessionHeaders,
    sessionCsrfHeaders,
    sessionNames: test.sessions,
    sessionFindings,
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

// ---- crawl (M137c, D432/D435/D436) -----------------------------------------
//
// This function is the crawl's *identity* half — the sessions it runs as, the requests it composes,
// the assertions it runs — and `crawl.ts` is its *policy* half. The split is `D323`'s prober seam,
// kept for the same two reasons: the policy is then testable without a network, and the composition
// of a request stays in the one file that already owns it, so a crawl cannot come to disagree with an
// `api` step about what a request is.

/**
 * One `crawl` declaration, run.
 *
 * Its session establishment is `runTestAttemptBody`'s, deliberately line-for-line: `as peer, shopper`
 * on a crawl means exactly what it means on a test — those principals are the **owner**, their
 * headers and cookies fold together in declared order, and Tier 2 differentiates against everyone
 * *else* declared. A crawl walks its surface **once**, not once per principal. Sending it per owner
 * would multiply the traffic by the number of names in the `as` list and would make one keyword mean
 * two different things in two places, which is the cost `D432` avoided by reusing the syntax at all.
 */
async function runCrawlDecl(crawl: CrawlDecl, config: ResolvedConfig, tc: TestCtx, traffic: readonly RequestTrace[]): Promise<CrawlResult> {
  const crawlStart = performance.now();
  const name = crawl.name.value;
  tc.emit({ type: 'test:start', name });
  const steps: StepResult[] = [];
  const noSurface = { discovered: 0, withheld: 0, sent: 0, reached: 0, seeds: [] };
  const fail = (error: string): CrawlResult => ({ kind: 'crawl', name, ok: false, durationMs: Math.round(performance.now() - crawlStart), steps, error, surface: noSurface });

  const sessionHeaders: Record<string, string> = {};
  const sessionCsrfHeaders: Record<string, string> = {};
  const cookieJar = new CookieJar();
  const sessionFindings: Finding[] = [];
  for (const sessionName of crawl.sessions) {
    const decl = config.sessions.get(sessionName);
    if (!decl) return fail(tc.redactor.redact(`unknown session "${sessionName}" — is it declared in tflw.config?`));
    const outcome = await tc.sessionCache.ensure(sessionName, decl, config, tc, false);
    steps.push(...outcome.steps);
    if (!outcome.ok) return fail(`session "${sessionName}" failed to establish: ${outcome.error ?? 'a step failed'}`);
    Object.assign(sessionHeaders, outcome.headers);
    Object.assign(sessionCsrfHeaders, outcome.csrfHeaders);
    sessionFindings.push(...outcome.securityFindings);
    cookieJar.mergeFrom(outcome.cookieJar.clone());
  }

  const ctx: EvalCtx = {
    scope: new Map<string, unknown>(),
    environ: tc.environ,
    redactor: tc.redactor,
    rng: tc.rng,
    runSeed: tc.runSeed,
    runClock: tc.runClock,
    uniqueSeq: tc.uniqueSeq,
    sessionHeaders,
    sessionCsrfHeaders,
    sessionNames: crawl.sessions,
    sessionFindings,
    cookieJar,
  };

  // Read once for the whole crawl, like `execApi` reads it once per request off the same cache.
  // **Carried, unlike `authzSenderFor`'s probe**, and the asymmetry is the point: a probe deliberately
  // holds no client certificate because it is a *different* identity and failing to connect is the
  // safe answer for it. A crawl's request is the owner's own, so withholding the owner's certificate
  // would make every route on an mTLS target unreachable and report the surface as unjudgeable.
  const mtls = await loadMtlsCreds(config, tc.configDir);

  const emitStep = (spec: { kind: 'seed' | 'api'; source: string; ok: boolean; detail: string; start: number; evidence?: { request: RequestTrace; response: ResponseTrace; endpoint: string } }): StepResult => {
    // Redaction happens here rather than in `crawl.ts` so that the policy half never holds a decision
    // about secrets: it is handed the live exchange (the prober needs the real credential) and the
    // report copy is made at this boundary, exactly as `execApi` returns `trace` and `redacted` side
    // by side. The span is the crawl's own header — a synthesized request has no source line, and a
    // reader clicking the step should land on the declaration that caused it.
    const result = mkStep(
      spec.kind,
      spec.source,
      crawl.span,
      spec.ok,
      spec.start,
      tc.redactor.redact(spec.detail),
      spec.evidence ? redactRequest(spec.evidence.request, tc.redactor, config) : undefined,
      spec.evidence ? redactResponse(spec.evidence.response, tc.redactor, config) : undefined,
      spec.evidence?.endpoint,
    );
    // Streamed as it happens, not collected and flushed at the end. A crawl is the longest-running
    // thing in a run by construction, so it is the one entry where a reader watching the console needs
    // to see progress rather than a finished list (`M88d`'s reasoning, on the surface that most needs
    // it).
    tc.emit({ type: 'step:end', test: name, step: result });
    return result;
  };

  const deps: CrawlDeps = {
    loadDocument: (source) => loadOpenApiDocumentForCrawl(source, config),
    capturedTraffic: () => traffic,
    send: async (request: CrawlRequest) => {
      // `resolveBaseUrl(null, …)`/`isAbsoluteUrl` — `api GET /path`'s own rule, so a traffic-seeded
      // request keeps the origin it was captured from instead of being silently retargeted at the
      // default service. Every gate an authored step passes is applied here and in this order,
      // because `checkHostAllowed` refusing *before* any I/O is the property, not the check itself.
      const url = isAbsoluteUrl(request.path) ? guardDemoUrl(request.path) : resolveBaseUrl(null, config) + ensureLeadingSlash(request.path);
      // **`requireAllowHostsForAbsolute` is deliberately absent, and that is `D469`.** `D246` made
      // writing an absolute URL opt a suite into declaring where it may reach, because *an author
      // typing one* is the one form that can send a request somewhere the config never mentions. A
      // crawl's absolute URL is never typed: it is a URL from `seed traffic`, i.e. a request this same
      // run already sent and which already passed that gate when it was authored. Applying an
      // authoring rule to a derived URL would refuse to re-issue a request the suite just made
      // successfully — and the affirmation a crawl actually needs is `authorized target`, which
      // `TF060` requires for the origin either way.
      //
      // `checkHostAllowed` stays, and it is the one that matters: a declared `allow hosts` is a
      // transport rule, and it refuses before any I/O rather than after.
      checkHostAllowed(url, config);
      const headers: Record<string, string> = {};
      for (const h of config.headers) {
        if (h.service === null) setHeader(headers, h.name, stringify(evalValue(h.value, ctx)));
      }
      for (const [k, v] of Object.entries(ctx.sessionHeaders)) setHeader(headers, k, v);
      // M137b (D433) — a `csrf from` token on mutating requests only, the same condition `execApi`
      // applies, reusing the same `isSafeMethod` so a crawl-composed write and an authored one cannot
      // disagree about whether a token belonged on it.
      if (!isSafeMethod(request.method)) {
        for (const [k, v] of Object.entries(ctx.sessionCsrfHeaders ?? {})) setHeader(headers, k, v);
      }
      const jarCookie = ctx.cookieJar.serialize(originOf(url));
      if (jarCookie) setHeader(headers, 'Cookie', jarCookie);
      if (request.contentType !== undefined) setHeader(headers, 'content-type', request.contentType);
      const trace: RequestTrace = { method: request.method, url, headers, ...(request.body !== undefined ? { body: request.body } : {}) };
      const response = await sendRequest({
        method: request.method,
        url,
        headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        timeoutMs: config.timeouts.step,
        followRedirects: true,
        allowHosts: config.allowHosts,
        ...(mtls ? { mtls } : {}),
      });
      // Per hop, as `execApi` does (`B4-15`): a login-shaped redirect sets its cookie on the 302, and
      // a crawl that walked past that would send every subsequent request unauthenticated while its
      // 401s looked like findings.
      ctx.cookieJar.applyCookieEvents(response.cookieEvents);
      return { request: trace, response };
    },
    judge: async (request, response) => {
      const out: StepResult[] = [];
      const ownerIdentity = ownerIdentityFor(ctx, request.url);
      for (const step of crawl.body) {
        // `TF070` has already refused anything else at check time; this is the runtime's own reading of
        // the same rule, for the file run without a check pass — the same relationship `TF039`'s
        // runtime half has to `checkResponseScopes`.
        if (step.type !== 'ExpectStmt') continue;
        const src = (tc.lines[step.span.start.line - 1] ?? '').trim();
        const stepStart = performance.now();
        try {
          const result =
            step.matcher.name === 'hasNoAuthzViolations'
              ? await execAuthzExpect(step, request, response, ownerIdentity, ctx, src, stepStart, config, tc)
              : step.matcher.name === 'hasNoInputHandlingViolations'
                ? await execInputHandlingExpect(step, request, response, ctx, src, stepStart, config, tc)
                : await execSecurityExpect(step, request, response, ctx, src, stepStart, config, tc);
          out.push(result);
          tc.emit({ type: 'step:end', test: name, step: result });
        } catch (err) {
          // One route's assertion throwing must not end the crawl. A `RuntimeError` here is a
          // per-exchange refusal — `TF062`'s runtime half on a request carrying an unowned credential,
          // `TF063`'s on a crawl with no `as` — and it is a failure of *this* assertion, reported as
          // one, while the remaining routes are still worth walking.
          const result = mkStep(step.soft ? 'check' : 'expect', src, step.span, false, stepStart, tc.redactor.redact(err instanceof Error ? err.message : String(err)));
          out.push(result);
          tc.emit({ type: 'step:end', test: name, step: result });
        }
      }
      return out;
    },
    // `D436`'s reachability channel, into the field `M136a` renamed for holding more than one tier's
    // facts. One decline **per scan family in the body**, because the denominators differ per scan and
    // a route this crawl could not judge is a gap in each of the questions it was asked to answer.
    // `ScanKind` deliberately gains no fourth member for this: a crawl is not a scan, it is a source of
    // requests for the three that exist (`D450`).
    decline: (subject, reason) => reportDeclines2(crawlScans(crawl), subject, reason, tc),
    step: (kind, source, ok, detail, evidence) => emitStep({ kind, source, ok, detail, start: performance.now(), evidence }),
  };

  const outcome = await runCrawl(crawl, config, deps);
  steps.push(...outcome.steps);
  const result: CrawlResult = {
    kind: 'crawl',
    name,
    ok: outcome.ok,
    durationMs: Math.round(performance.now() - crawlStart),
    steps,
    ...(outcome.error ? { error: outcome.error } : {}),
    surface: outcome.surface,
  };
  tc.emit({ type: 'test:end', result });
  return result;
}

/** The scans a crawl's body actually asks about — `TF070` guarantees the body holds only these three
 *  matchers, so this is a complete reading of it rather than a best effort. A crawl body that somehow
 *  reached the runtime with no assertion at all declines under `security`, so a route it could not
 *  reach is still recorded somewhere rather than nowhere. */
function crawlScans(crawl: CrawlDecl): readonly ScanKind[] {
  const scans = new Set<ScanKind>();
  for (const step of crawl.body) {
    if (step.type !== 'ExpectStmt') continue;
    if (step.matcher.name === 'hasNoAuthzViolations') scans.add('authorization');
    else if (step.matcher.name === 'hasNoInputHandlingViolations') scans.add('input-handling');
    else if (step.matcher.name === 'hasNoSecurityViolations') scans.add('security');
  }
  return scans.size > 0 ? [...scans] : ['security'];
}

/** `reportDeclines` with the arguments the other way round — one subject, many scans, rather than one
 *  scan and many subjects. Its own function rather than a loop at the call site so that both shapes go
 *  through `tc.scanSink?.decline` and neither can grow a second way of recording the same fact. */
function reportDeclines2(scans: readonly ScanKind[], subject: string, reason: string, tc: TestCtx): void {
  for (const scan of scans) reportDeclines(scan, [{ subject, reason }], tc);
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
  /** Set alongside `error` when a *hard* failure came up through one or more `action` frames
   * (M97d, D141) — the unframed root message plus the frames it has passed so far, so `execCall`
   * can add its own frame to a bounded array instead of prefixing a string that never stops
   * growing. Absent when the failure happened directly in this block's own steps: `execCall` then
   * starts the path with itself. */
  readonly failure?: { readonly root: string; readonly path: readonly string[] };
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

/** Exported for the same reason `resolveBaseUrl` and `checkHostAllowed` beside it are (M125b1): the
 *  `FU-18` rule is one line of composition whose defect was invisible from outside, and a test that
 *  can only reach it by driving a browser is a test nobody writes. */
export function resolveWebUrl(path: string, config: ResolvedConfig): string {
  // M125b1 (`FU-18`, D245) — this line is the row's worst half. It used to be unconditional, so
  // `open "https://example.com/x"` against a configured `web` base navigated to
  // `http://localhost:5173/https://example.com/x` — a page that *loads* on any SPA with a catch-all
  // route, so the run went on and failed later on an assertion about content, or passed. `M125a`
  // reproduced exactly that: 5.5s, a page served, and a failure attributed to the wrong step.
  //
  // Checked before the `web`-base requirement below, not after, because an absolute URL needs no
  // base — demanding one is the other half of what the row filed.
  if (isAbsoluteUrl(path)) {
    requireAllowHostsForAbsolute(path, path, config);
    checkHostAllowed(path, config);
    return path;
  }
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
  // M128b — the security pack's `authenticated-response-cacheable` rule has to know whether the
  // *request* carried credentials, so the pair travels together. Tracked here rather than reached
  // for out of the step result, because `result` holds the **redacted** copy and a rule that reads
  // a redacted `authorization` header would judge the mask instead of the request.
  let lastRequest: RequestTrace | null = null;
  // M130b/D328 — the identity the *owning sessions* contributed to `lastRequest`, snapshotted as
  // that request went out rather than read back at the assertion. `refreshSessions` mutates
  // `ctx.sessionHeaders` in place on a 401, so an assertion-time read would see a token that did
  // not exist when the request was built and report the refresh as a step naming its own credential.
  let lastOwnerIdentity: OwnerIdentity = {};
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
          // `B3-18` — the origin this endpoint's latency sample is measured from, which stays
          // `stepStart` for the ~all steps that never see a 401 (byte-identical numbers to
          // before). A reactive re-establish is a *different* endpoint's work — a whole login —
          // and it already reports itself as its own step below; billing it a second time to
          // whichever endpoint happened to trigger it puts a login inside the sample that
          // `recordEndpointMetrics` feeds to this endpoint's percentiles and to any
          // `threshold … for "label"` clause reading them. Same defect shape as `B3-02`, one
          // indirection further out: a duration percentile reading something other than the
          // endpoint's own latency. Declared outside the `try` because the connection-error path
          // below reports a duration too, and a retry that fails to connect must not bill this
          // endpoint for the refresh that preceded it either.
          let billFrom = stepStart;
          try {
            let { trace, redacted, retryAfterAttempts, retryAfterWaitedMs, cookieScopeNote } = await execApi(step, config, ctx, tc.redactor, tc.baseDir, tc.configDir, tc.pinnedAgents);
            // Auto re-establish on 401 (SPEC §3.3, decision 3a, enterprise arc) — any session (not
            // just `oauth2`) gets this: a revoked/expired-early credential shouldn't fail every
            // remaining step of a test that's otherwise unrelated to auth. Retried at most once per
            // step, so a server that genuinely, persistently 401s still fails fast instead of
            // looping. `ctx.sessionNames` is `[]` for an anonymous test, so this is a no-op there.
            if (trace.response.status === 401 && ctx.sessionNames.length > 0) {
              const firstAttemptMs = performance.now() - stepStart;
              const refresh = await refreshSessions(ctx, ctx.sessionNames, config, tc, src, step.span);
              results.push(...refresh.steps);
              if (refresh.ok) {
                // The retry is the attempt that carries this endpoint's real latency, and it is
                // the one k6 keeps: it records the 401 and the retry as two samples and excludes
                // the first, so measuring from here is what makes the two threshold populations
                // comparable (`D-M89-8`, which is where this row was found).
                billFrom = performance.now();
                ({ trace, redacted, retryAfterAttempts, retryAfterWaitedMs, cookieScopeNote } = await execApi(step, config, ctx, tc.redactor, tc.baseDir, tc.configDir, tc.pinnedAgents));
              } else {
                // No retry happened, so the 401 attempt *is* this step's sample — but the failed
                // re-establish still cost real time, and it is no more this endpoint's latency
                // than a successful one would have been. Re-basing the origin excludes exactly
                // that interval and leaves the first attempt's own duration standing.
                billFrom = performance.now() - firstAttemptMs;
              }
            }
            lastResponse = trace.response;
            lastRequest = trace.request;
            lastOwnerIdentity = ownerIdentityFor(ctx, trace.request.url);
            // D287's first half. Live trace, not `redacted` — the report copy carries `cookieEvents: []`
            // at every evidence level, and that is the field every cookie rule reads.
            ctx.securitySink?.push(toObservation(trace.request, trace.response));
            // M137c (D435) — `seed traffic`'s capture point. The live trace, like the line above and
            // for the same reason: the crawl re-issues this request, so it needs the request that was
            // actually sent rather than the report's copy of it.
            tc.trafficSink?.push(trace.request);
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
            result = mkStep('api', src, step.span, true, billFrom, `${step.method} ${redacted.request.url} → ${trace.response.status} (${trace.response.durationMs}ms)${retrySuffix}${cookieSuffix}`, redacted.request, redacted.response, apiStepIdentity(step));
          } catch (err) {
            // Not opted in (no `request connects`/`fails` assertion follows this request, decision
            // 18.2) — rethrow unchanged, caught by this function's own outer `catch` below exactly
            // like every request always has (P#16's unconditional fail-fast), zero behavior change
            // for the ~500 existing tests across both repos that never use this feature.
            if (!catchConnectionError) throw err;
            const message = err instanceof RuntimeError ? err.message : `${(err as Error).message}`;
            const redactedMessage = tc.redactor.redact(message);
            lastResponse = null;
            lastRequest = null;
            lastOwnerIdentity = {};
            lastConnectionError = redactedMessage;
            // Reported `ok: true` on the `api` line itself (like every other request, whatever
            // status code it got back) — this step's job is just to attempt the request; the
            // following `expect`/`check request connects`/`fails` step is what judges the outcome.
            result = mkStep('api', src, step.span, true, billFrom, `${step.method} ${step.path.raw} → connection failed: ${redactedMessage}`, undefined, undefined, apiStepIdentity(step));
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
                  : step.subject.type === 'ResponseSubject'
                    ? // M130b/D304, M134a/D366 — three matchers on one subject now, dispatched by
                      // name. Deliberately not folded: each tier must keep meaning exactly what it
                      // meant before the next one landed, and what changes each time is that
                      // `response` answers one more question rather than that its question grew.
                      step.matcher.name === 'hasNoAuthzViolations'
                      ? await execAuthzExpect(step, lastRequest, lastResponse, lastOwnerIdentity, ctx, src, stepStart, config, tc)
                      : step.matcher.name === 'hasNoInputHandlingViolations'
                        ? await execInputHandlingExpect(step, lastRequest, lastResponse, ctx, src, stepStart, config, tc)
                        : await execSecurityExpect(step, lastRequest, lastResponse, ctx, src, stepStart, config, tc)
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
          const waited = await execWaitUntilApi(step, config, ctx, tc.redactor, tc.baseDir, tc.configDir, src, stepStart, tc.pinnedAgents);
          lastResponse = waited.response;
          lastRequest = waited.request;
          lastOwnerIdentity = waited.request ? ownerIdentityFor(ctx, waited.request.url) : {};
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
          const name = String(evalValue(step.name, ctx)); // A4-OS-11/M102 — see `applyHeaders`
          const value = stringify(evalValue(step.value, ctx));
          if (ctx.headerSink) ctx.headerSink[name] = value;
          result = mkStep('header', src, step.span, true, stepStart, tc.redactor.redact(`header "${name}" is ${JSON.stringify(value)}`));
          break;
        }
        case 'CsrfStmt': {
          result = execCsrf(step, lastResponse, ctx, src, stepStart, tc.redactor);
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
      // Carry the failure's structure up alongside the rendered string (M97d). A host refusal
      // deliberately drops it: `refusalDuring` replaces the message entirely, so the frames that
      // came with the original error no longer describe what is being reported.
      const failure = refusalDuring === null && err instanceof RuntimeError && err.actionPath.length > 0
        ? { root: tc.redactor.redact(err.rootMessage), path: err.actionPath }
        : undefined;
      return { steps: results, ok: false, error: redacted, giveValue, ...(failure ? { failure } : {}) };
    }
  }

  if (softFailures.length > 0) {
    return { steps: results, ok: false, soft: true, error: softFailures.join('\n'), giveValue };
  }
  return { steps: results, ok: true, giveValue };
}

/** How many `action` frames a failure message names before it elides the middle. The call path is
 * already bounded — every recursion is refused, so no action appears on the stack twice — but a
 * suite is free to nest twenty actions deep legitimately, and a reader gets nothing from frames
 * eleven through nineteen. Elision keeps the ends, which are the two that identify the failure:
 * where it surfaced and where it actually happened. */
const MAX_NAMED_FRAMES = 6;

/** Render an action-call failure once, from the root message and the frames it passed through.
 * Single-frame output is exactly what it was before M97d — `action "x" failed: <reason>` — because
 * that is the overwhelmingly common case and there was nothing wrong with it. */
function renderActionFailure(path: readonly string[], root: string): string {
  const head = `action "${path[0]}" failed: ${root}`;
  if (path.length === 1) return head;
  const shown = path.length <= MAX_NAMED_FRAMES
    ? path
    : [...path.slice(0, MAX_NAMED_FRAMES - 2), `… ${path.length - (MAX_NAMED_FRAMES - 1)} more`, path[path.length - 1]!];
  return `${head} (call path ${shown.join(' → ')})`;
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
    // D141's residue guard. `TF044` rejects a cycle whose every action is declared in one file;
    // this catches the rest — a cycle that leaves the file through an `import` and comes back,
    // which the checker cannot see because `KnownAction` discards imported bodies. A name already
    // on the stack means this action reaches itself, and with no conditionals in the language that
    // never terminates, so failing here loses nothing a longer run would have produced. Detecting
    // the repeat rather than counting to a depth limit means the message can name the actual cycle,
    // and that it fires at frame 2 instead of frame 671.
    const callerStack = callerCtx.callStack ?? [];
    const repeatedAt = callerStack.indexOf(call.name);
    if (repeatedAt !== -1) {
      const cycle = [...callerStack.slice(repeatedAt), call.name].join(' → ');
      throw new RuntimeError(`this call completes a cycle: \`${cycle}\` — an action that reaches itself never terminates`);
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
      // M137b (D433) — inherited for `sessionHeaders`' reason, and it has to be spelled out because
      // the compiler cannot ask for it: `sessionCsrfHeaders` is optional, so omitting it here would
      // have typechecked and silently dropped the token for every mutating `api` step written inside
      // an `action`. That failure would have surfaced as a `403` from the app — a CSRF defence
      // apparently working — on precisely the requests a reuse-minded suite extracts into actions.
      ...(callerCtx.sessionCsrfHeaders ? { sessionCsrfHeaders: callerCtx.sessionCsrfHeaders } : {}),
      sessionNames: callerCtx.sessionNames,
      ...(callerCtx.sessionFindings ? { sessionFindings: callerCtx.sessionFindings } : {}),
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
      callStack: [...callerStack, call.name],
    };
    const exec = await execSteps(action.body, config, actionCtx, tc, `${call.name}(...)`, registry);
    // A hard failure inside the action (a failing `expect`, or a thrown error) still aborts the
    // caller immediately — but a *soft* one (`exec.soft`, decision 55) must propagate as soft, not
    // silently harden into a caller-aborting throw: `check`→`check` stays uniform even through an
    // imported action, per §6.4's closed soft-assertion semantics.
    if (!exec.ok && !exec.soft) {
      // D141's other half. This line used to be `action "x" failed: ${exec.error}`, and `exec.error`
      // was itself the previous frame's already-prefixed string — so the message grew by one prefix
      // per level with nothing bounding it. The frames now travel as an array and the string is
      // rendered once, from the root message, at whatever depth it finally surfaces.
      const inner = exec.failure ?? { root: exec.error ?? 'a step failed', path: [] };
      const path = [call.name, ...inner.path];
      throw new RuntimeError(renderActionFailure(path, inner.root), path, inner.root);
    }
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

async function execApi(spec: ApiRequestSpec, config: ResolvedConfig, ctx: EvalCtx, redactor: Redactor, baseDir: string, configDir: string, pinnedAgents?: KeepAliveAgents): Promise<ApiExec> {
  const path = interpolatePath(spec.path.raw, ctx, true);
  // M125b1 (`FU-18`, D245) — an absolute target IS the address; there is no base to prepend and no
  // base that needs to exist. Decided after interpolation, not before, so `https://{host}/x` is
  // absolute for the same reason `https://a.example/x` is: what leaves the machine is what is
  // judged. `guardDemoUrl` still applies, because `tflw://demo` reaching the runtime is a bug on
  // every path into it (M118, `FU-04`), and this is a new path into it.
  //
  // A named service and an absolute URL together is refused by the checker (`TF059`, D266) rather
  // than resolved here: one of the two is dead text, and picking a winner silently is the failure
  // this row is filed about.
  const url = isAbsoluteUrl(path) ? guardDemoUrl(path) : resolveBaseUrl(spec.service, config) + ensureLeadingSlash(path);
  requireAllowHostsForAbsolute(url, path, config);
  checkHostAllowed(url, config);

  const headers: Record<string, string> = {};
  for (const h of config.headers) {
    if (h.service === null || h.service === spec.service) setHeader(headers, h.name, stringify(evalValue(h.value, ctx)));
  }
  for (const [k, v] of Object.entries(ctx.sessionHeaders)) setHeader(headers, k, v);
  // M137b (D433) — a `csrf from` clause's token, on **mutating requests only**, which is the whole
  // reason it travels in its own channel instead of in `sessionHeaders` above. `isSafeMethod` is
  // `authzProbe`'s, deliberately reused rather than respelled: it is an allowlist (`GET`/`HEAD`/
  // `OPTIONS`) so an unrecognised method counts as mutating, and one definition of "changes state"
  // for the prober and the sender means a probe can never disagree with the request it is derived
  // from about whether a token should have been there.
  //
  // Applied before the per-step headers below for the cookie jar's reason: an explicit `header
  // "X-CSRF-Token" is …` on the step still wins, which is what makes a hand-written negative test
  // (send the wrong token deliberately) still expressible on a session that declares the clause.
  if (!isSafeMethod(spec.method)) {
    for (const [k, v] of Object.entries(ctx.sessionCsrfHeaders ?? {})) setHeader(headers, k, v);
  }
  // Cookie jar (SPEC §3.3, P#33): applied before any per-step header, so an explicit `header
  // "Cookie" is …` on this step still wins (setHeader replaces, it never sits alongside).
  // …and scoped to this request's own origin since M88c2 (`B4-06`, D-M88-7): a cookie set by the
  // app under test is no longer replayed to every other service the suite talks to.
  const requestOrigin = originOf(url);
  const jarCookie = ctx.cookieJar.serialize(requestOrigin);
  if (jarCookie) setHeader(headers, 'Cookie', jarCookie);
  const cookieScopeNote = jarCookie ? undefined : cookieScopeNoteFor(ctx, requestOrigin);
  // Both operands go through `evalValue` (A4-OS-11/M102). Until then this line read the name
  // literally and the value as a value — one statement, two identical `StringLit`s, one evaluated.
  for (const h of spec.headers) setHeader(headers, String(evalValue(h.name, ctx)), stringify(evalValue(h.value, ctx)));

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
  // `M97c-03`: `cert`/`key` are `tflw.config` keys (SPEC §3.6), so they resolve against the
  // config's directory — unlike `baseDir` just above, which is this *test file's* and is the right
  // base for a `body from`/`upload` the test itself wrote.
  const mtls = await loadMtlsCreds(config, configDir);
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

/** `B4-08` — the live-DOM "nearest candidate" diagnosis (SPEC §9.3), on the assertion path.
 *
 * It used to fire only on the action path, because it lived at `resolveLocator`'s throw site and
 * the assertion path deliberately never throws on zero matches (`is hidden` and `has count 0` must
 * be able to pass against nothing). The result was that one typo produced two different qualities
 * of failure: `click button "Add to Crat"` named the real button as a ready-to-paste locator,
 * while `expect button "Add to Crat" is visible` said only *"but got no matching element"* — the
 * one place the author most needs the suggestion, since a suite asserts far more than it clicks.
 *
 * Two conditions, both load-bearing. **Only on the final failure**: this is an extra whole-DOM
 * scan and a retrying expect polls until its deadline, so running it per-poll would pay the scan
 * dozens of times to print it once. **Only when nothing matched at all**: with an element actually
 * resolved, the failure is about that element's *state* (`is enabled` against a disabled button),
 * and a list of other elements whose names look similar would point away from the real cause. A
 * `css`/`xpath` locator has no semantic name to match against and is dropped by the scan itself.
 *
 * Returns '' when there is nothing worth saying, so callers can concatenate unconditionally. */
async function diagnoseIfNothingMatched(scope: LocatorScope, locatorAst: LocatorAst, name: string, count: number): Promise<string> {
  if (count !== 0) return '';
  return diagnoseMissingLocator(scope, locatorAst.kind, name);
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
      const message = outcome.message + (outcome.ok ? '' : await diagnoseIfNothingMatched(scope, subject.locator, name, count));
      return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(message));
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
  // The *parser* cannot catch it — `timeout wait` comes from config and is not in the file. The
  // **checker** can and now does (M124, `TF055`), through the resolved-by-the-caller channel M116
  // built for `TF051`; this throw is the backstop for a run whose config the checker was never
  // given. It is a warning there and a hard error here on purpose (D147): the checker predicts
  // against one env, and a suite whose CI env raises `timeout wait` is correct.
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
      const held = holdMs === null ? outcome.message : `${outcome.message} (${detail})`;
      const message = held + (await diagnoseIfNothingMatched(scope, subject.locator, name, count));
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
  const label = networkSubjectLabel(subject, urlPattern, ctx);
  if (subject.type === 'NetworkRequestSubject') {
    // Existence-only; `wasMade` is the only matcher meaningful here. As of M97b the checker rejects
    // this before the run (`TF042`, D140) — it is decidable from the AST, and this comment used to
    // cite SPEC §1's "stays a runtime concern", which was true when written and is no longer. The
    // throw stays: `checkMatcherSubjects` is the checker's half of one rule, and the runtime does
    // not assume it ran (a `tflw run` on a suite is not obliged to have passed `tflw check` first).
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
  const { value } = resolveNetworkSubjectValue(subject, matched, ctx);
  return evalMatcher(label, value, step.matcher, ctx);
}

function resolveNetworkSubjectValue(subject: Subject, matched: CapturedNetworkRequest, ctx: EvalCtx): { value: unknown; label: string } {
  switch (subject.type) {
    case 'StatusSubject':
      return { value: matched.status, label: 'status' };
    case 'HeaderSubject': {
      const name = String(evalValue(subject.name, ctx)); // A4-OS-11/M102, as in `resolveSubject`
      return { value: matched.responseHeaders[name.toLowerCase()], label: `header "${name}"` };
    }
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

function networkSubjectLabel(subject: Subject, urlPattern: string, ctx: EvalCtx): string {
  const base = `request to ${JSON.stringify(urlPattern)}`;
  switch (subject.type) {
    case 'StatusSubject':
      return `status of ${base}`;
    case 'HeaderSubject':
      // A4-OS-11/M102 — the label has to name the header actually looked up, or a failure message
      // sends the reader hunting for a header spelled the way the source is, not the way it ran.
      return `header ${JSON.stringify(String(evalValue(subject.name, ctx)))} of ${base}`;
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
  const floor = step.matcher.severityFloor ?? null;
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
function describeA11yOutcome(step: ExpectStmt, floor: FindingSeverity | null, violations: readonly Finding[]): MatchOutcome {
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

// ---------------------------------------------------------------------------
// `expect`/`check response has no [<severity>] security violations` (M128b, D283-D290, SPEC §9.10)
// ---------------------------------------------------------------------------

/** Flattens an observed request/response pair into the only thing `securityRules.ts` is allowed to
 * see. Kept here rather than in that module so the rule pack stays free of `ResponseTrace` — the
 * same boundary `a11y.ts` keeps against `PWPage`.
 *
 * **`cookieEvents`, not `headers['set-cookie']`.** The header map is `Record<string, string>`, so a
 * response setting three cookies arrives there as one `\n`-joined string; the cookie rules report
 * one finding per cookie and cannot do that from the joined form. `cookieEvents` keeps every hop's
 * lines unjoined for exactly this reason (M88c1) — including hops *earlier in a redirect chain*,
 * which is where the commonest login shape actually sets its session cookie. */
/**
 * D287's first half — scan every response a `session` block's own steps observed, once, at
 * establishment, and label each finding with the session it came from.
 *
 * **No severity floor here.** The floor belongs to the assertion, which has not been written yet at
 * establishment time and may differ between two tests using the same session. Scanning unfiltered
 * and letting each assertion filter is the only order that lets one cached session serve both
 * `has no security violations` and `has no critical security violations` honestly.
 *
 * Deduplicated on rule id + detail: a session body that makes three calls to the same host produces
 * three identical `hsts-missing` findings, and the finding is about the host, not about how many
 * requests the login happened to take.
 *
 * **The TLS rules are deliberately not fed through this channel (M128c, D297).** `o.tls` is left
 * absent here, so `sec/tls-version-old` and `sec/tls-weak-cipher` report not-applicable for every
 * session observation. D287's argument is cookie-shaped and does not generalize: a login response's
 * `Set-Cookie` is a fact *only that response* carries, which is why it has to be carried forward,
 * while a TLS protocol version is a property of the **host** that any assertion pointed at that host
 * rediscovers directly. Probing here would therefore report the same finding twice — once prefixed
 * `session "x" login —` and once not — for a host the assertion was already judging.
 *
 * What that gives up, stated rather than hidden: a suite whose session logs in over one host and
 * asserts against another never has the login host's TLS examined. That is D286's accepted gap (an
 * unasserted endpoint is unscanned) rather than a new one, and the fix for it is an assertion.
 */
function scanSessionObservations(sessionName: string, observations: readonly Observation[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const o of observations) {
    for (const f of runSecurityScan(o).findings) {
      const key = `${f.id}\u0000${f.detail}`;
      if (!seen.has(key)) seen.set(key, { ...f, detail: `session "${sessionName}" login — ${f.detail}` });
    }
  }
  return [...seen.values()];
}

function toObservation(request: RequestTrace, response: ResponseTrace, tls?: TlsObservation): Observation {
  return {
    url: response.finalUrl,
    ...(tls ? { tls } : {}),
    headers: response.headers,
    setCookie: response.cookieEvents.flatMap((e) => e.setCookie),
    // **Request headers are lowercased here; response headers already are.** The asymmetry is real
    // and easy to miss: `http.ts` normalizes what comes back, but `setHeader` deliberately preserves
    // the case an author *wrote* on the way out (`header "Authorization" is …` stays `Authorization`)
    // so the report shows the request as typed. A rule doing a bare `requestHeaders['authorization']`
    // lookup therefore misses every real bearer-auth suite in existence while still passing a test
    // that happens to spell the header in lower case — which is exactly how this was found.
    requestHeaders: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])),
  };
}

/**
 * D288's connection, made only when it can tell us something.
 *
 * Plaintext responses are skipped outright rather than probed-and-refused: `undefined` here means
 * *nobody looked*, which is the honest state for an http response and the one the two TLS rules
 * report as a plain not-applicable. Sending a probe at an http URL just to receive a refusal would
 * manufacture an `ok: false` — "the probe ran and could not answer" — for a response where nothing
 * was ever worth asking.
 *
 * `timeouts.step` is the budget, not a constant of its own. A probe is a connection to the same host
 * the step just talked to, so the step's own patience is the number that already describes how long
 * this suite is willing to wait on that host; a second knob would be one more thing to keep in sync
 * for no new information.
 */
async function probeTlsFor(finalUrl: string, floor: FindingSeverity | null, config: ResolvedConfig, prober: TlsProber): Promise<TlsObservation | undefined> {
  if (!finalUrl.startsWith('https:')) return undefined;
  // **Not probed when the floor has already discarded both rules that read it.** D296 narrows the
  // pack *before* applicability, so `expect response has no critical security violations` never
  // consults a TLS rule at all — and opening a handshake whose answer is then thrown away is a
  // connection the assertion did not ask for. That is a small cost and a large principle: this whole
  // milestone's safety story is that tflw's second connection is deliberate, declared and needed, and
  // one made for an assertion that cannot use it is none of the three.
  //
  // Derived from the pack rather than from a hardcoded `'serious'`, so re-grading either rule cannot
  // silently leave this reading the old severity.
  if (floor && !SECURITY_RULES.some((r) => r.id.startsWith('sec/tls-') && SEVERITY_RANK[r.severity] >= SEVERITY_RANK[floor])) return undefined;
  return prober.probe(finalUrl, {
    timeoutMs: config.timeouts.step,
    insecure: config.insecure,
    allowHosts: config.allowHosts,
    authorizedTargets: config.authorizedTargets,
  });
}

/**
 * Runs the pack and turns the result into a step outcome.
 *
 * **No retry, unlike `execA11yExpect` directly above.** That one re-scans a live DOM on every poll
 * because a page still hydrating can legitimately fix its own accessibility gaps inside the
 * assertion's budget. This judges a response that has already been received in full: re-polling
 * cannot change a header that already arrived, so a retry loop would only turn a fast failure into
 * a slow one. Determinable, not grilled — D290 records it.
 */
/**
 * M134b (D385/D386) — lift a scan's generic findings into their report-facing form, hand every one
 * to the run's collector, and decide which of them are still allowed to fail the assertion.
 *
 * **One function for all three scans, on purpose.** A per-tier copy is how `--fail-on` would come to
 * mean a different thing depending on which matcher a file used, which is the accidental contract
 * D383 gave this milestone its own number to avoid.
 *
 * Every finding reaches the sink, including the withheld ones. A finding withheld from a verdict is
 * still a finding; dropping it here would make the report agree with the gate instead of describing
 * the run, and a baseline you cannot see the contents of is not reviewable.
 */
/** Shared empty map for the two scans that send no payloads, so neither allocates one per assertion
 * and neither can be handed a mutable default that a later call could have written into. */
const EMPTY_SEEDED: ReadonlyMap<string, string> = new Map();

function gateScan(
  scan: ScanKind,
  findings: readonly Finding[],
  endpoint: string | null,
  step: ExpectStmt,
  tc: TestCtx,
  /** M134b (D369) — payload id → the value this run generated for it. A finding whose payload is in
   * this map was drawn from the seed rather than reviewed, so it is un-fingerprintable and cannot
   * gate. Empty (the default) for the two scans that send no payloads and for every run that did not
   * ask for the layer. Membership is the test, not the id's prefix: a *corpus* payload someone names
   * `seeded/...` is still reviewed and still gates. */
  seeded: ReadonlyMap<string, string> = EMPTY_SEEDED,
): GateVerdict {
  const lifted = findings.map((f) => {
    const drawn = f.payload === undefined ? undefined : seeded.get(f.payload);
    return toScanFinding(scan, f, endpoint, {
      ...(drawn === undefined ? {} : { seeded: { seed: tc.runSeed, payload: drawn } }),
      ...(tc.filePath !== undefined ? { file: tc.filePath } : {}),
      line: step.span.start.line,
    });
  });
  const verdict = judge(lifted, tc.scanGate ?? OPEN_GATE);
  for (const f of verdict.all) tc.scanSink?.finding(f);
  return verdict;
}

/**
 * M134b (D389) — report what this assertion's pack applied and what it stood down, for
 * `RunReport.scanCoverage`.
 *
 * Called on **every** scan assertion, passing or failing, which is `M128-01`'s whole point: a rule
 * that stands down produces nothing, so the only run in which the information exists to be captured
 * is the one where nobody is looking at a failure message.
 *
 * Generic over the three packs' result shapes by taking the two lists rather than the result, so a
 * fourth tier joins by calling it rather than by widening a union.
 */
function reportCensus(
  scan: ScanKind,
  applied: readonly { readonly id: string }[],
  notApplicable: readonly { readonly rule: { readonly id: string }; readonly because: string }[],
  tc: TestCtx,
): void {
  tc.scanSink?.census({
    scan,
    applied: applied.map((r) => r.id),
    notApplicable: notApplicable.map((n) => ({ rule: n.rule.id, because: n.because })),
  });
}

/**
 * `M136a` (D418a) — report the subjects this assertion could not put its question to.
 *
 * Called beside `reportCensus` on **every** scan assertion for the same reason it is: a subject that
 * went unasked produces no finding by definition, so the only run in which the fact exists to be
 * captured is the one nobody is reading a failure message for.
 *
 * Generic over the two probing tiers' result shapes by taking `(subject, reason)` pairs rather than
 * the probe list, so a fourth tier joins by mapping its own outcomes rather than by widening a
 * union — the same shape `reportCensus` takes, and for the same reason.
 */
function reportDeclines(scan: ScanKind, declined: readonly { readonly subject: string; readonly reason: string }[], tc: TestCtx): void {
  for (const d of declined) tc.scanSink?.decline({ scan, subject: d.subject, reason: d.reason });
}

/**
 * Whether the plain form of a scan assertion passes, and the clause it appends when it withheld
 * findings from its own verdict.
 *
 * **The gate is not applied to the negated form, and that is D386 rather than an omission.** `not
 * has no … violations` asserts that something *is* wrong, so there findings cause success — and a
 * gate that discounted them would turn a green assertion red. `--fail-on` and `--baseline` may only
 * ever relax; the one place that rule could be violated by accident is exactly here.
 */
function gatedPass(verdict: GateVerdict, negated: boolean, noneFound: boolean): { readonly ok: boolean; readonly note: string } {
  if (negated) return { ok: !noneFound, note: '' };
  return { ok: verdict.gating.length === 0, note: withheldNote(verdict) };
}

async function execSecurityExpect(
  step: ExpectStmt,
  request: RequestTrace | null,
  response: ResponseTrace | null,
  ctx: EvalCtx,
  src: string,
  start: number,
  config: ResolvedConfig,
  tc: TestCtx,
): Promise<StepResult> {
  if (step.matcher.name !== 'hasNoSecurityViolations') {
    throw new RuntimeError(`\`${step.matcher.name}\` isn't valid against \`response\` — only \`has no [<severity>] security violations\` (SPEC §9.10)`);
  }
  // `TF039`'s runtime half. `checkResponseScopes` already rejects this statically (`readsResponse`
  // lists `ResponseSubject`), so reaching here means the file was run without a check pass.
  if (!response || !request) {
    throw new RuntimeError('no response yet — an `api` step must run before `expect response has no … security violations`');
  }
  const floor = step.matcher.severityFloor ?? null;
  const tls = await probeTlsFor(response.finalUrl, floor, config, tc.tlsProber);
  const result = runSecurityScan(toObservation(request, response, tls), floor);
  // D287's second half. The session's own login response was scanned at establishment, unfiltered;
  // this assertion's floor is applied to those findings now, so one cached session can serve a
  // `has no security violations` in one test and a `has no critical security violations` in another
  // without either being told the other's answer.
  const sessionFindings = filterBySeverity(ctx.sessionFindings ?? [], floor);
  // The session's own findings are gated alongside this response's — they are findings about the
  // same suite and a baseline that could not accept one would be a baseline with a hole in it.
  const verdict = gateScan('security', [...sessionFindings, ...result.findings], templateEndpoint(request.method, response.finalUrl), step, tc);
  reportCensus('security', result.applicable, result.notApplicable, tc);
  const outcome = describeSecurityOutcome(step, floor, result, sessionFindings, verdict);
  return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
}

/**
 * **No silent caps (M128c).** A rule that stood down because its *precondition* is unmet needs no
 * announcement — that is the ordinary, expected third state, and listing seven of them on every
 * green line would bury the counts. A rule that stood down because the instrument it depends on
 * **failed** is a different thing: the assertion did less work than it was asked to, and reporting
 * only "not applicable" for that is the shape `REVIEW_FINDINGS.md` keeps re-filing — a control that
 * reports success over something it silently skipped.
 *
 * Only the TLS rules can produce this today (a refused handshake, a timeout, a certificate the run
 * declines to trust, a target no `authorized target` covers), and grouping by reason means the usual
 * case — both rules blocked by one connection failure — is one line rather than two.
 *
 * Deliberately appended to the **passing** message too. A green `expect response has no security
 * violations` whose TLS probe never connected is exactly the assertion a reader would otherwise
 * believe had checked the protocol version.
 */
function degradedNote(result: ScanResult): string {
  const byReason = new Map<string, string[]>();
  for (const n of result.notApplicable) {
    // The static text means "the precondition did not hold", which is not a degradation. Anything
    // else is a rule reporting that it *could not find out*.
    if (n.because === n.rule.appliesWhen) continue;
    const list = byReason.get(n.because) ?? [];
    list.push(n.rule.id);
    byReason.set(n.because, list);
  }
  if (byReason.size === 0) return '';
  return [...byReason].map(([because, ids]) => `\n  note: ${ids.join(', ')} could not be evaluated — ${because}`).join('');
}

/** The three-count line D292 requires, in M126's shape — every count on the same line as its
 * denominator, so nobody has to hold two numbers from two places in their head to know what the
 * assertion actually did. */
function scanCounts(result: ScanResult): string {
  return `${result.considered} rule${result.considered === 1 ? '' : 's'} — ${result.applicable.length} applicable, ${result.notApplicable.length} not applicable, ${result.findings.length} violation${result.findings.length === 1 ? '' : 's'}`;
}

/**
 * **D285 — zero applicable rules is a failure, not a pass.**
 *
 * This is `M127`'s "an empty shard is an error, not an early return" applied one layer up, against
 * what `REVIEW_FINDINGS.md` calls its oldest recurring shape: a control that reports success over
 * nothing. An assertion where every rule stood down had no power to fail, so greening it would
 * teach a reader that this endpoint was checked and found clean when it was never checked at all.
 *
 * It is also what makes the target choice self-enforcing. `expect response has no critical security
 * violations` against a plain JSON GET that sets no cookie and carries no CORS header engages
 * nothing whatsoever (D296 narrows the pack by the floor first) — and rather than collect a green
 * there, the author is told which preconditions went unmet, which is the sentence that explains
 * both what is wrong and what to write instead.
 */
function describeSecurityOutcome(
  step: ExpectStmt,
  floor: FindingSeverity | null,
  result: ScanResult,
  sessionFindings: readonly Finding[],
  verdict: GateVerdict,
): MatchOutcome {
  const kind = floor ? `${floor} security violation` : 'security violation';
  const counts = scanCounts(result);
  const findings = [...sessionFindings, ...result.findings];
  // D285 is about *this response's* scan having no power to fail — but a session finding is a real
  // failure this assertion is entitled to report, so it takes precedence over the no-power verdict.
  // Ordering these the other way round would let a suite whose session cookie lacks `HttpOnly`
  // escape with a "nothing applied" message, which is the exact miss D287 exists to prevent.
  if (result.applicable.length === 0 && findings.length === 0) {
    // Deliberately fails in the negated case too. `check response has not no … violations` is a
    // strange thing to write, but if someone writes it, "nothing applied" is still the answer, and
    // an assertion with no power to fail also has no power to succeed at finding something.
    const why = result.notApplicable.map((n) => `  - ${n.rule.id} applies when: ${n.because}`);
    return {
      ok: false,
      message:
        `this assertion had no power to fail: no ${floor ? `\`${floor}\`-or-worse ` : ''}security rule applied to this response (${counts}).\n` +
        `${why.join('\n')}\n` +
        `  Point it at a response one of these rules can judge${floor ? ', or lower the severity floor' : ''} (SPEC §9.10, D285).`,
    };
  }
  const negated = step.matcher.negated;
  const noneFound = findings.length === 0;
  const gate = gatedPass(verdict, negated, noneFound);
  const ok = gate.ok;
  const note = `${degradedNote(result)}${gate.note}`;
  // No truncation, unlike the a11y listing directly above, and the difference is the pack size: a
  // real page can carry dozens of instances of one axe rule, while this pack is twelve rules and can
  // physically produce only a handful more findings than that. Cutting at five here would hide a
  // finding for no benefit.
  const listing = (): string => findings.map((v) => `  - [${v.severity}] ${v.id}: ${v.description} (${v.detail})`).join('\n');
  if (ok) {
    const state = negated ? `has ${findings.length} ${kind}${findings.length === 1 ? '' : 's'}` : `has no ${kind}s`;
    // **A passing *negated* assertion lists what it found (M128c).** `not has no … violations` means
    // "something must be wrong here", so a green line saying only `has 2 critical security
    // violations` withholds the one fact the assertion exists to establish — and the report is then
    // the only record, so nothing downstream can recover it either. It is the same silent-coverage
    // shape D300 closes for a blocked rule, one state over. The plain form's pass has nothing to
    // list, by construction.
    return { ok: true, message: `response ${state} — ${counts}${findings.length > 0 ? `:\n${listing()}` : ''}${note}` };
  }
  if (negated) {
    return { ok: false, message: `expected response to have at least one ${kind}, but found none — ${counts}${note}` };
  }
  return { ok: false, message: `expected response to have no ${kind}s, but found ${findings.length} — ${counts}:\n${listing()}${note}` };
}

// ---------------------------------------------------------------------------
// M130b — `expect|check response has no [<severity>] authorization violations`.
// ---------------------------------------------------------------------------

/**
 * One authorization finding, as the run accumulates it (D331 part 2, D332).
 *
 * Kept beside the assertion's own message rather than parsed back out of it, because two consumers
 * need the facts and not the prose: the run summary aggregates them, and the repro emitter writes a
 * runnable `.tflw` from them. A reporter that had to read them out of a rendered sentence would
 * break the first time the sentence was reworded — which is the shape `M125e` filed against a
 * display label derived from an identity key.
 */
export interface AuthzFinding {
  readonly rule: string;
  readonly principal: string;
  readonly method: string;
  /** The observed request's URL, verbatim — the address a repro has to dial. */
  readonly url: string;
  readonly ids: readonly string[];
  readonly owners: readonly string[];
}

/** The run-level accumulator, threaded on `TestCtx` exactly as `tlsProber` is. Optional, so a test
 *  helper that drives one assertion in isolation needs no collector to get an answer.
 *
 *  **`decline` used to live here and moved to `ScanSink` in `M136a` (D418a).** D331 part 2 put the
 *  turned-down work beside the findings because at the time only Tier 2 had any; Tier 3 then grew
 *  the identical fact about payload classes, and a second copy of a channel is how one report comes
 *  to describe the same blind spot in two vocabularies. This sink kept the job it is named for:
 *  facts a repro emitter needs, which are facts about a *principal*. */
export interface AuthzSink {
  finding(f: AuthzFinding): void;
}

/**
 * The identity headers the *owning sessions* contributed to a request, read at the moment that
 * request went out (D328's runtime half).
 *
 * **Snapshotted per request rather than read at the assertion**, and that is the whole point. A
 * session can re-establish mid-test — a 401-triggered refresh, an `oauth2` TTL — and `refreshSessions`
 * mutates `ctx.sessionHeaders` in place. Comparing the observed request against the *assertion-time*
 * contribution would then read a token refresh that happened between the `api` step and its
 * assertion as "this step named its own credential", refusing a correct file for a reason that has
 * nothing to do with the rule.
 */
interface OwnerIdentity {
  readonly authorization?: string;
  readonly cookie?: string;
}

function ownerIdentityFor(ctx: EvalCtx, url: string): OwnerIdentity {
  const auth = Object.entries(ctx.sessionHeaders).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  let cookie: string | undefined;
  try {
    cookie = ctx.cookieJar.serialize(originOf(url)) || undefined;
  } catch {
    cookie = undefined;
  }
  return { ...(auth !== undefined ? { authorization: auth } : {}), ...(cookie !== undefined ? { cookie } : {}) };
}

/** Case-insensitive lookup over a header map that deliberately preserves the case its author typed
 *  (`setHeader`) — the same assumption `M128`'s `sec/authenticated-response-cacheable` got wrong. */
function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/**
 * `TF062`'s runtime half — the observed request carries an identity header no owning session
 * supplied (D328).
 *
 * **A comparison, not a heuristic.** Both operands are known: what actually went out, and what the
 * sessions contributed as of that request. So this catches the cases the checker structurally
 * cannot — a credential written inside an `action` body, or applied by a `use`d file — without ever
 * guessing. Returns the header's name, or null.
 */
function stepNamedOwnCredential(request: RequestTrace, owner: OwnerIdentity): string | null {
  const auth = headerValue(request.headers, 'authorization');
  if (auth !== undefined && auth !== owner.authorization) return 'Authorization';
  const cookie = headerValue(request.headers, 'cookie');
  if (cookie !== undefined && cookie !== owner.cookie) return 'Cookie';
  return null;
}

/**
 * D310/D327 — who gets probed.
 *
 * Declared order from `tflw.config` (a `Map` preserves insertion order, which is declaration
 * order), minus every session the test named — the *union*, since `test … as admin, shopper` sends
 * admin's `Authorization` and shopper's `Cookie` at once and both are owners — minus every session
 * declared `privileged`, plus the built-in `anonymous`, last (D326).
 */
function probeSetFor(config: ResolvedConfig, owners: readonly string[]): { readonly names: readonly string[]; readonly privileged: readonly string[] } {
  const ownerSet = new Set(owners);
  const names: string[] = [];
  const privileged: string[] = [];
  for (const [name, decl] of config.sessions) {
    if (ownerSet.has(name)) continue;
    if (decl.privileged) {
      privileged.push(name);
      continue;
    }
    names.push(name);
  }
  return { names: [...names, ANONYMOUS], privileged };
}

/**
 * The real probe sender (D323's seam, filled).
 *
 * **Two things it deliberately does not inherit, and both fail in the safe direction.** Client
 * certificates: a probe carries none, so an mTLS-only target refuses every probe, every outcome is
 * `not probed`, and D285 fails the assertion loudly rather than greening it — which is the correct
 * answer, because this tier genuinely cannot judge that target yet. And `without redirects`: the
 * probe follows, because the question is what the *other principal ultimately gets*, and a 302 to
 * the resource is a leak whatever the owner's step chose to observe.
 */
function authzSenderFor(config: ResolvedConfig): ProbeSender {
  return (req) =>
    sendRequest({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      ...(req.body !== undefined ? { body: req.body } : {}),
      timeoutMs: req.timeoutMs,
      followRedirects: true,
      allowHosts: config.allowHosts,
    });
}

/** Establishes one probe principal, lazily (D312). A session that will not establish becomes an
 *  `unavailable` principal rather than a thrown error: one broken credential must not abort an
 *  assertion that four other principals could still answer, and `not probed` is a state the counts
 *  line already carries. */
async function probePrincipalFor(name: string, config: ResolvedConfig, tc: TestCtx): Promise<ProbePrincipal> {
  if (name === ANONYMOUS) return { name, headers: {} };
  const decl = config.sessions.get(name);
  if (!decl) return { name, headers: {}, unavailable: `no \`session ${name}\` is declared` };
  try {
    const outcome = await tc.sessionCache.ensure(name, decl, config, tc, false);
    if (!outcome.ok) return { name, headers: {}, unavailable: `session "${name}" failed to establish: ${outcome.error ?? 'a step failed'}` };
    return { name, headers: outcome.headers, csrfHeaders: outcome.csrfHeaders, cookieJar: outcome.cookieJar };
  } catch (err) {
    return { name, headers: {}, unavailable: `session "${name}" failed to establish: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * `sec/csrf-not-enforced`'s principals (M137b, D434/D457): each **owner** session that declared a
 * `csrf from` clause, repeated with its CSRF headers emptied.
 *
 * **Derived from the owners, which is why it cannot come from `probeSetFor`.** That function exists to
 * exclude the owners — for authorization, re-issuing the owner's own request under the owner's own
 * identity demonstrates nothing. This rule asks the opposite question: *can the owner themselves make
 * this request without the token the app issued them*, and only the owner's credential can ask it.
 *
 * A session with no clause contributes nothing, so a suite that has not adopted `csrf from` gets an
 * empty list here and sends exactly the probes it sent before this milestone.
 */
async function csrfPrincipalsFor(owners: readonly string[], config: ResolvedConfig, tc: TestCtx): Promise<ProbePrincipal[]> {
  const derived: ProbePrincipal[] = [];
  for (const name of owners) {
    const decl = config.sessions.get(name);
    if (!decl) continue;
    const base = await probePrincipalFor(name, config, tc);
    if (base.unavailable !== undefined) continue;
    if (Object.keys(base.csrfHeaders ?? {}).length === 0) continue;
    derived.push({
      // Named as derived (D434's stated consequence) so nobody reads this in a counts line and goes
      // looking for a `session` block that was never written.
      name: `${name} (csrf token withheld)`,
      derivedFrom: name,
      headers: base.headers,
      // The subtraction, and the whole of it: same identity, same jar, no token.
      csrfHeaders: {},
      ...(base.cookieJar ? { cookieJar: base.cookieJar } : {}),
    });
  }
  return derived;
}

/**
 * Runs the probes and the pack, and turns the result into a step outcome.
 *
 * **No retry, for `execSecurityExpect`'s reason and one more.** That one judges a response already
 * received in full. This one *sends*, and a retry loop would send the whole probe set again — so a
 * transient `429` would be answered by the one thing guaranteed to make it worse.
 */
async function execAuthzExpect(
  step: ExpectStmt,
  request: RequestTrace | null,
  response: ResponseTrace | null,
  ownerIdentity: OwnerIdentity,
  ctx: EvalCtx,
  src: string,
  start: number,
  config: ResolvedConfig,
  tc: TestCtx,
): Promise<StepResult> {
  // `TF039`'s runtime half, as for the security matcher — `checkResponseScopes` already rejects
  // this statically, so reaching here means the file was run without a check pass.
  if (!response || !request) {
    throw new RuntimeError('no response yet — an `api` step must run before `expect response has no … authorization violations`');
  }
  // `TF063`'s runtime backstop (D329). The checker stays silent inside an `action` body and a bare
  // `before`/`after` hook because the executing test is a late-bound fact; here it is in hand.
  if (ctx.sessionNames.length === 0) {
    throw new RuntimeError(
      '`authorization violations` needs an owner, and the running test declares none — the oracle re-issues this request under every *other* declared principal and compares, so with no `as <session>` there is nothing to compare against (SPEC §3.3, `TF063`)',
    );
  }
  // `TF062`'s runtime half (D328), and it runs **before any probe is sent**: a request carrying a
  // credential no owning session supplied must not be re-issued at all, because the finding either
  // way would be about two identities the run cannot name.
  const named = stepNamedOwnCredential(request, ownerIdentity);
  if (named) {
    throw new RuntimeError(
      `the \`api\` step this asserts on carries a \`${named}\` header that none of its owning session${ctx.sessionNames.length === 1 ? '' : 's'} (${ctx.sessionNames.join(', ')}) supplied — move the credential into a \`session\` block and name it with \`as <session>\` (SPEC §3.3, \`TF062\`)`,
    );
  }

  const floor = step.matcher.severityFloor ?? null;
  const ownerIds = extractResourceIds(response.json);
  const { names, privileged } = probeSetFor(config, ctx.sessionNames);
  const principals: ProbePrincipal[] = [];
  for (const name of names) principals.push(await probePrincipalFor(name, config, tc));
  // M137b (D434/D457) — the withheld-token principals, derived from the *owners* and therefore
  // assembled after `probeSetFor`, which exists to exclude them.
  const csrfPrincipals = await csrfPrincipalsFor(ctx.sessionNames, config, tc);

  const policy: ProbePolicy = {
    timeoutMs: config.timeouts.step,
    allowHosts: config.allowHosts,
    insecure: config.insecure,
    probeMutating: mayProbeMutating(request.url, config.authorizedTargets),
    // M131a/D340 — from the command line, never from `config`'s own file contents: `resolveConfig`
    // hard-codes `[]` and `cli.ts` overlays the flag's values onto the resolved object.
    allowPublicTargets: config.allowPublicTargets,
    // M137b (D433) — every CSRF header name this assertion could involve, from the owner's live view
    // and from each probe principal's establishment, so `withoutIdentityHeaders` strips the owner's
    // token out of the observed request before any principal's own is applied. Read off the
    // established outcomes rather than the declarations, so an interpolated header name is covered.
    csrfHeaderNames: [
      ...new Set([
        ...Object.keys(ctx.sessionCsrfHeaders ?? {}),
        ...principals.flatMap((p) => Object.keys(p.csrfHeaders ?? {})),
      ]),
    ],
  };
  const prober = new AuthzProber(authzSenderFor(config));
  const probes = await prober.probeAll(request, ownerIds, probeOrder(principals), policy);
  // Sent through the same prober and the same `policy`, so `probe mutating` (D330) and every D21
  // layer gate a withheld-token probe exactly as they gate any other. A rule that could send an
  // unopted write is the one defect this arc's safety model exists to prevent.
  const csrfProbes = csrfPrincipals.length ? await prober.probeAll(request, ownerIds, csrfPrincipals, policy) : [];

  const result = runAuthzScan(
    { owner: { request, response }, ownerPrincipals: ctx.sessionNames, ownerIds, probes, ...(csrfProbes.length ? { csrfProbes } : {}) },
    floor,
  );
  // D418a — the blind spot moved from `AuthzSink` to `ScanSink` when Tier 3 grew the same fact.
  // `AuthzSink` writes runnable repros and needs a principal; two of the three scans have none.
  reportDeclines(
    'authorization',
    // M137b (D434) — the derived principals declare their declines here too, and this is the field
    // that decision names: a withheld-token probe refused by `probe mutating` is a mutating surface
    // this run did not judge, which is exactly what the blind-spot channel is for. Leaving them out
    // would have made an unopted target read as *CSRF is enforced* rather than as *not measured*.
    [...probes, ...csrfProbes]
      .filter((p) => p.outcome.kind === 'not-probed' || p.outcome.kind === 'inconclusive')
      .map((p) => ({ subject: p.principal, reason: (p.outcome as { readonly reason: string }).reason })),
    tc,
  );
  for (const probe of probes) {
    if (probe.outcome.kind === 'leaked') {
      for (const rule of result.applicable) {
        tc.authzSink?.finding({ rule: rule.id, principal: probe.principal, method: request.method, url: request.url, ids: probe.outcome.ids, owners: ctx.sessionNames });
      }
    }
  }

  const verdict = gateScan('authorization', result.findings, templateEndpoint(request.method, request.url), step, tc);
  reportCensus('authorization', result.applicable, result.notApplicable, tc);
  const outcome = describeAuthzOutcome(step, floor, result, probes, privileged, verdict);
  return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
}

/** D316's probe line, in `scanCounts`' shape: every count beside its denominator, so nobody holds
 *  two numbers from two places in their head to know what the assertion did. */
function probeCounts(probes: readonly ProbeResult[]): string {
  const by = new Map<string, number>();
  for (const p of probes) by.set(p.outcome.kind, (by.get(p.outcome.kind) ?? 0) + 1);
  const parts = [...by].map(([kind, n]) => `${n} ${PROBE_OUTCOME_LABEL[kind as ProbeResult['outcome']['kind']]}`);
  return `${probes.length} principal${probes.length === 1 ? '' : 's'} probed — ${parts.join(', ')}`;
}

/**
 * **`degradedNote`'s discipline, one matcher over (D324).** A state that means *could not find out*
 * is announced on the **passing** line too, because a green `expect response has no authorization
 * violations` whose entire probe set was refused before authorization was consulted is exactly the
 * assertion a reader would otherwise believe had tested the boundary.
 *
 * `inconclusive` and `not probed` each get their own grouped line with the principal named, since
 * the fix differs: an inconclusive cookie-borne principal wants a bearer session (D325), a
 * not-probed mutating step wants `probe mutating` on the target.
 */
function probeNote(probes: readonly ProbeResult[], privileged: readonly string[]): string {
  const lines: string[] = [];
  for (const p of probes) {
    if (p.outcome.kind === 'inconclusive' || p.outcome.kind === 'not-probed') {
      lines.push(`\n  note: \`${p.principal}\` ${PROBE_OUTCOME_LABEL[p.outcome.kind]} — ${p.outcome.reason}`);
    }
  }
  // Announced even though nothing went wrong: `privileged` removes a principal from the probe set,
  // and a reader comparing two suites' green lines has no other way to see that one of them tested
  // fewer identities than the other.
  if (privileged.length > 0) {
    lines.push(`\n  note: not probed as ${privileged.map((p) => `\`${p}\``).join(', ')} — declared \`privileged\` (SPEC §3.3)`);
  }
  return lines.join('');
}

/**
 * **D285 — an assertion with no power to fail is a failure, not a pass**, and this matcher has two
 * doors into it rather than Tier 1's one.
 *
 * The pack can find no applicable rule because the owner's `2xx` body is a shape the oracle refuses
 * to guess at (D321), *or* because no principal produced a judgeable response (D324) — a probe set
 * that was entirely rate-limited, refused for CSRF, or never sent. Both are "nothing was actually
 * tested here", and `runAuthzScan` routes both through the same not-applicable path so this function
 * needs one branch rather than two.
 */
function describeAuthzOutcome(
  step: ExpectStmt,
  floor: FindingSeverity | null,
  result: AuthzScanResult,
  probes: readonly ProbeResult[],
  privileged: readonly string[],
  verdict: GateVerdict,
): MatchOutcome {
  const kind = floor ? `${floor} authorization violation` : 'authorization violation';
  const counts = `${result.considered} rule${result.considered === 1 ? '' : 's'} — ${result.applicable.length} applicable, ${result.notApplicable.length} not applicable, ${result.findings.length} violation${result.findings.length === 1 ? '' : 's'}`;
  const probeLine = probeCounts(probes);
  const note = probeNote(probes, privileged);
  const findings = result.findings;

  // **Two doors, one verdict.** The pack can find nothing applicable because the owner's `2xx` body
  // is a shape the oracle refuses to guess at (D321), or because no principal produced a judgeable
  // response (D324) — a probe set entirely rate-limited, refused for CSRF, or never sent.
  // `runAuthzScan` routes both through the same not-applicable path, which is what lets this stay
  // one condition; naming it is what stops a reader taking it for Tier 1's single door.
  const nothingApplied = result.applicable.length === 0 && findings.length === 0;
  if (nothingApplied) {
    const why = result.notApplicable.map((n) => `  - ${n.rule.id} applies when: ${n.because}`);
    return {
      ok: false,
      message:
        `this assertion had no power to fail: no ${floor ? `\`${floor}\`-or-worse ` : ''}authorization rule applied (${counts}; ${probeLine}).\n` +
        `${why.join('\n')}\n` +
        `  Point it at a response whose body carries a root \`id\`, and at a probe set that can answer${floor ? ', or lower the severity floor' : ''} (SPEC §9.11, D285).${note}`,
    };
  }

  const negated = step.matcher.negated;
  const noneFound = findings.length === 0;
  const gate = gatedPass(verdict, negated, noneFound);
  const ok = gate.ok;
  const listing = (): string => findings.map((v) => `  - [${v.severity}] ${v.id}: ${v.description} (${v.detail})`).join('\n');
  if (ok) {
    const state = negated ? `has ${findings.length} ${kind}${findings.length === 1 ? '' : 's'}` : `has no ${kind}s`;
    return { ok: true, message: `response ${state} — ${counts}; ${probeLine}${findings.length > 0 ? `:\n${listing()}` : ''}${note}${gate.note}` };
  }
  if (negated) {
    return { ok: false, message: `expected response to have at least one ${kind}, but found none — ${counts}; ${probeLine}${note}` };
  }
  return { ok: false, message: `expected response to have no ${kind}s, but found ${findings.length} — ${counts}; ${probeLine}:\n${listing()}${note}` };
}

/**
 * The real mutation-probe sender (D374's seam, filled).
 *
 * `authzSenderFor`'s two deliberate non-inheritances, and both fail in the safe direction here too.
 * Client certificates: a probe carries none, so an mTLS-only target refuses every probe, every
 * outcome is `not probed`, and D285 fails the assertion loudly rather than greening it. And
 * `without redirects`: the probe follows, because the question is what the application *ultimately*
 * does with the payload, and a 302 into a handler that discloses is still a disclosure.
 */
function inputSenderFor(config: ResolvedConfig): InputProbeSender {
  return (req) =>
    sendRequest({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      ...(req.body !== undefined ? { body: req.body } : {}),
      timeoutMs: req.timeoutMs,
      followRedirects: true,
      allowHosts: config.allowHosts,
    });
}

/**
 * Runs the mutation matrix and the pack, and turns the result into a step outcome (M134a, D366).
 *
 * **No retry, for `execAuthzExpect`'s reason.** That one sends; so does this, and a great deal more
 * of it — a retry loop would re-send the whole matrix, so a transient `429` would be answered by the
 * one thing guaranteed to make it worse.
 *
 * **No owner, and no session machinery at all** — the clearest single difference from Tier 2. This
 * tier changes no identity (D370), so there is nothing to establish, nothing to strip, no probe set
 * to assemble and no `TF062`/`TF063` analogue to enforce. It reads one request and re-sends it.
 */
async function execInputHandlingExpect(
  step: ExpectStmt,
  request: RequestTrace | null,
  response: ResponseTrace | null,
  ctx: EvalCtx,
  src: string,
  start: number,
  config: ResolvedConfig,
  tc: TestCtx,
): Promise<StepResult> {
  // `TF039`'s runtime half, as for the other two scan matchers — `checkResponseScopes` already
  // rejects this statically, so reaching here means the file was run without a check pass.
  if (!response || !request) {
    throw new RuntimeError('no response yet — an `api` step must run before `expect response has no input handling violations`');
  }

  const floor = step.matcher.severityFloor ?? null;
  const classes = grantedClasses(request.url, config.authorizedTargets);
  // D388 — the seeded layer is handed the classes the target **already** granted, so there is no
  // argument `--probe-seeded` could carry that reaches a class the config withheld. The generated
  // payloads join the corpus for planning and are judged by the same rules; only their standing
  // afterwards differs, and that is decided at the report boundary from this map.
  const drawn = seededPayloads(classes, tc.probeSeeded ?? 0, tc.runSeed);
  const plan = planProbes(request, classes, [...INPUT_CORPUS, ...drawn]);
  const sites = mutationSites(request);

  const policy: InputProbePolicy = {
    timeoutMs: config.timeouts.step,
    allowHosts: config.allowHosts,
    insecure: config.insecure,
    probeMutating: mayProbeMutating(request.url, config.authorizedTargets),
    classes,
    // M131a/D340 — from the command line, never from `config`'s own file contents.
    allowPublicTargets: config.allowPublicTargets,
  };
  const probes = await new InputProber(inputSenderFor(config)).probeAll(request, plan, policy);

  const withheld = withheldClasses(classes);
  const result = runInputScan({ observed: { request, response }, probes, sites, disabledClasses: withheld }, floor);
  const verdict = gateScan('input-handling', result.findings, templateEndpoint(request.method, request.url), step, tc, seededIds(drawn));
  reportCensus('input-handling', result.applicable, result.notApplicable, tc);
  // D418a — Tier 3's blind spot reached `mutationNote` and stopped there, so a run whose entire
  // matrix was refused before it left the process produced a `results.json` indistinguishable from
  // one that probed everything.
  //
  // **The subject is the endpoint, not the payload class**, and the reason is a measurement rather
  // than a preference. `planProbes` filters the corpus to the granted classes *before* any probe is
  // planned, so a withheld class never becomes a `MutationResult` at all — it is already reported,
  // as a not-applicable rule with a reason, through `reportCensus` above. What is left un-asked here
  // is refused for facts about the **request**: it changes state and no `probe mutating` covers the
  // target, the origin is public and unaffirmed, the allowlist declined it, the transport failed, the
  // host answered 429. Keying those on the class would emit one identical row per class for one
  // fact, which is the noise `mutationNote`'s own comment refuses when it groups by reason.
  reportDeclines(
    'input-handling',
    probes
      .filter((p) => p.outcome.kind === 'not-probed' || p.outcome.kind === 'inconclusive')
      .map((p) => ({ subject: templateEndpoint(request.method, request.url), reason: (p.outcome as { readonly reason: string }).reason })),
    tc,
  );
  const outcome = describeInputOutcome(step, floor, result, probes, sites, withheld, verdict);
  return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
}

/**
 * D381's cost line, in `probeCounts`' shape — **sites probed / requests sent / mean requests per
 * site**, every count beside its denominator.
 *
 * Printed rather than asserted, which is the lesson `M132b` paid for: Tier 2's cost line updated
 * itself when the probe set changed, because the grader prints what it measured instead of naming a
 * constant somebody has to remember to edit. Tier 3 sends far more, so the number matters more.
 */
function mutationCounts(probes: readonly MutationResult[], sites: readonly MutationSite[]): string {
  const sent = probes.filter((p) => p.outcome.kind !== 'not-probed').length;
  const mean = sites.length ? (sent / sites.length).toFixed(1) : '0.0';
  const by = new Map<string, number>();
  for (const p of probes) by.set(p.outcome.kind, (by.get(p.outcome.kind) ?? 0) + 1);
  const parts = [...by].map(([kind, n]) => `${n} ${MUTATION_OUTCOME_LABEL[kind as MutationOutcome['kind']]}`);
  return `${sites.length} site${sites.length === 1 ? '' : 's'}, ${sent} request${sent === 1 ? '' : 's'} sent, ${mean} per site — ${parts.join(', ')}`;
}

/**
 * **`degradedNote`'s discipline, one matcher further on.** A state that means *could not find out* is
 * announced on the **passing** line too, because a green `expect response has no input handling
 * violations` whose entire matrix was refused before it left the process is exactly the assertion a
 * reader would otherwise believe had tested something.
 *
 * Grouped by reason rather than listed per probe, and that is not cosmetic: a matrix is dozens of
 * entries wide, and `13 not probed — POST changes state, and no \`probe mutating\` covers this
 * target` is the sentence a reader can act on, where thirteen copies of it is the sentence they
 * scroll past.
 */
function mutationNote(probes: readonly MutationResult[], withheld: readonly string[]): string {
  const reasons = new Map<string, number>();
  for (const p of probes) {
    if (p.outcome.kind === 'not-probed' || p.outcome.kind === 'inconclusive') {
      reasons.set(p.outcome.reason, (reasons.get(p.outcome.reason) ?? 0) + 1);
    }
  }
  const lines = [...reasons].map(([reason, n]) => `\n  note: ${n} probe${n === 1 ? '' : 's'} — ${reason}`);
  // Announced even though nothing went wrong, exactly as `probeNote` announces a `privileged`
  // exclusion: a class that was never sent is a class that could not have found anything, and a
  // reader comparing two green runs has no other way to see that one of them tested less. This is
  // the half of `M128-01` this milestone can afford to answer — not *which rules stood down* in
  // general, but *which of mine did, and what would turn them on*.
  if (withheld.length > 0) {
    lines.push(`\n  note: not probed for ${withheld.join(' or ')} — add ${withheld.map((w) => `\`probe ${w}\``).join(' / ')} under that \`authorized target\` (SPEC §9.12)`);
  }
  return lines.join('');
}

/**
 * **D285 — an assertion with no power to fail is a failure, not a pass**, and this matcher has the
 * same two doors as Tier 2 with different names on them.
 *
 * The pack can find no applicable rule because the request offered **no mutable input** (`TF067`'s
 * runtime twin — the checker catches the literal cases, this catches every case), or because nothing
 * the matrix sent came back readable. `runInputScan` routes both through the same not-applicable
 * path, so this needs one branch rather than two.
 */
function describeInputOutcome(
  step: ExpectStmt,
  floor: FindingSeverity | null,
  result: InputScanResult,
  probes: readonly MutationResult[],
  sites: readonly MutationSite[],
  withheld: readonly string[],
  verdict: GateVerdict,
): MatchOutcome {
  const kind = floor ? `${floor} input-handling violation` : 'input-handling violation';
  const counts = `${result.considered} rule${result.considered === 1 ? '' : 's'} — ${result.applicable.length} applicable, ${result.notApplicable.length} not applicable, ${result.findings.length} violation${result.findings.length === 1 ? '' : 's'}`;
  const probeLine = mutationCounts(probes, sites);
  const note = mutationNote(probes, withheld);
  const findings = result.findings;

  // Named differently from `describeAuthzOutcome`'s identical condition on purpose, and the reason
  // is mechanical rather than stylistic: `scripts/mutate.mjs` anchors each mutation on a source
  // snippet that must appear **exactly once** in its file. Two D285 doors spelled the same way
  // leaves neither of them independently mutable — the m130b entry went ambiguous the moment this
  // function was written, and a Tier 3 entry could not have been added at all. The harness caught
  // it, which is the harness working; keeping the names distinct is what stops it recurring.
  const noInputRuleApplied = result.applicable.length === 0 && findings.length === 0;
  if (noInputRuleApplied) {
    const why = result.notApplicable.map((n) => `  - ${n.rule.id} applies when: ${n.because}`);
    // `TF067` is named only when it is actually the reason. A matrix that had sites and sent
    // requests and still applied no rule is a different situation with a different repair, and
    // citing a code for it would send the reader to a reference entry that does not describe them.
    const repair = sites.length
      ? 'Point it at a request whose inputs this corpus can reach, and at a target that grants the classes it needs'
      : 'Assert it on a step whose request takes an id, a query parameter or a JSON body (`TF067`)';
    return {
      ok: false,
      message:
        `this assertion had no power to fail: no ${floor ? `\`${floor}\`-or-worse ` : ''}input-handling rule applied (${counts}; ${probeLine}).\n` +
        `${why.join('\n')}\n` +
        `  ${repair}${floor ? ', or lower the severity floor' : ''} (SPEC §9.12, D285).${note}`,
    };
  }

  const negated = step.matcher.negated;
  const noneFound = findings.length === 0;
  const gate = gatedPass(verdict, negated, noneFound);
  const ok = gate.ok;
  const listing = (): string => findings.map((v) => `  - [${v.severity}] ${v.id}: ${v.description} (${v.detail})`).join('\n');
  if (ok) {
    const state = negated ? `has ${findings.length} ${kind}${findings.length === 1 ? '' : 's'}` : `has no ${kind}s`;
    return { ok: true, message: `response ${state} — ${counts}; ${probeLine}${findings.length > 0 ? `:\n${listing()}` : ''}${note}${gate.note}` };
  }
  if (negated) {
    return { ok: false, message: `expected response to have at least one ${kind}, but found none — ${counts}; ${probeLine}${note}` };
  }
  return { ok: false, message: `expected response to have no ${kind}s, but found ${findings.length} — ${counts}; ${probeLine}:\n${listing()}${note}` };
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
  const redactMasks = subjectMatchesRedactPattern(step.subject, config.redactPatterns, ctx);
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

/**
 * `csrf from <subject> send as header "<name>"` (M137b, D433) — reads the token out of the session's
 * own establishment response and records which header will carry it on mutating requests.
 *
 * **This is where `D443`'s `TF069` went** (D456). A path that resolves to nothing throws here, and the
 * throw is the whole safety property: it fails the session, so every test that says `as <name>` fails
 * with it and no probe runs at all. `D443`'s fear was a mis-typed path degrading silently into a
 * mutating surface reported as `inconclusive` — nothing reaches `inconclusive`, because nothing gets
 * that far. `execCapture` below has failed the identical way since `A4-06`, and for the same reason:
 * binding `undefined` here would send the literal text `"undefined"` as the token, which an app
 * rejects for the *right* reason by accident, making a broken clause look like a working defence.
 *
 * The token is registered as a captured secret unconditionally, unlike `capture`'s `redact`-pattern
 * check: a CSRF token is a credential by construction, so there is no configuration under which
 * printing it into a report is wanted, and no pattern should have to be written to say so.
 */
function execCsrf(step: CsrfStmt, response: ResponseTrace | null, ctx: EvalCtx, src: string, start: number, redactor: Redactor): StepResult {
  const header = String(evalValue(step.header, ctx)); // A4-OS-11/M102 — see `applyHeaders`
  const { value, label } = resolveSubject(step.subject, response, ctx);
  if (value === undefined) {
    throw new RuntimeError(
      `no CSRF token at ${label} — this session's establishment response carried no such value, so \`csrf from\` would attach the literal text "undefined" as \`${header}\` on every mutating request this credential makes (an app rejecting that reads as a working CSRF defence, which is the false negative this failure exists to prevent)`,
    );
  }
  const token = stringify(value);
  if (ctx.csrfSink) ctx.csrfSink[header] = token;
  registerCapturedSecret(`csrf:${header}`, token, redactor);
  // The header *name* is the useful half of this line and the token is never printed — see the note
  // above. `capture`'s detail shows its value because a later step reads it back by name; nothing
  // reads this one back, so there is nothing a reader gains from seeing it.
  return mkStep('csrf', src, step.span, true, start, redactor.redact(`csrf token → ${header} (on mutating requests)`));
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
  const redactMasked = subjectMatchesRedactPattern(step.subject, config.redactPatterns, ctx);
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
function subjectMatchesRedactPattern(subject: Subject, patterns: readonly RedactPattern[], ctx: EvalCtx): boolean {
  if (subject.type === 'BodySubject') return pathMatchesRedactPattern(subject.path, patterns);
  // A4-OS-11/M102, and the one site here with a security consequence: matched against the *literal*
  // name, a `redact` pattern written for the interpolated header would miss, and a value the suite
  // declared secret would print. Interpolate first, then match.
  if (subject.type === 'HeaderSubject') return headerMatchesRedactPattern(String(evalValue(subject.name, ctx)), patterns);
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
  configDir: string,
  src: string,
  start: number,
  pinnedAgents?: KeepAliveAgents,
): Promise<{ result: StepResult; response: ResponseTrace | null; request: RequestTrace | null }> {
  const deadline = performance.now() + config.timeouts.wait;
  let attempt = 0;
  let last: { redacted: ApiExec['redacted']; response: ResponseTrace; request: RequestTrace; message: string } | null = null;
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
        request: last.request,
      };
    }
    attempt++;
    // Clamp this poll's own request timeout to what's left of the wait deadline (decision 67) — the
    // outer deadline was previously only checked *after* `execApi` returned, so a single slow poll
    // could hang for up to the request's own (much larger) `config.timeouts.step` default, blowing
    // way past a short `wait <N>ms` budget.
    const requestTimeout = Math.max(1, Math.min(step.request.timeoutMs ?? config.timeouts.step, remainingMs));
    const request = { ...step.request, timeoutMs: requestTimeout };
    const { trace, redacted } = await execApi(request, config, ctx, redactor, baseDir, configDir, pinnedAgents);
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
        request: trace.request,
      };
    }
    const lastMessage = outcomes.find((o) => !o.ok)!.message;
    last = { redacted, response: trace.response, request: trace.request, message: lastMessage };
    if (performance.now() >= deadline) {
      const detail = `timed out after ${config.timeouts.wait}ms (${attempts}): ${lastMessage}`;
      return {
        result: mkStep('wait', src, step.span, false, start, redactor.redact(detail), redacted.request, redacted.response),
        response: trace.response,
        request: trace.request,
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
  //
  // The path goes through `evalValue`, so `{var}` holes interpolate (`A4-OS-09`, D174). It read
  // `.value` for eleven milestones, which made this the one file operand in the language that did
  // not — `body from`, `upload` and `drop file` have always called `evalValue` on the very same
  // `StringLit` type. Nothing about a matcher justified the difference; it was an omission, and it
  // read as deliberate only because the one corpus site that wanted it had written a comment
  // explaining the workaround.
  if (step.matcher.name === 'matchesFile') {
    if (!(value instanceof Uint8Array)) {
      throw new RuntimeError('`matches file` is only valid on a `body bytes` subject');
    }
    const filePath = String(evalValue(step.matcher.filePath!, ctx));
    return evaluateFileMatch(label, Buffer.from(value), filePath, baseDir, step.matcher.negated);
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
  // M128b, same shape one subject over: `execSecurityExpect` intercepts every `ResponseSubject`
  // expect/check, so this is reached only via `capture response as x`. Named separately from `page`
  // rather than folded in with it, because the useful half of the message is different — a reader
  // who wrote this wanted *part* of the response, and the parts have names.
  if (subject.type === 'ResponseSubject') {
    throw new RuntimeError(
      '`response` is not a capturable value — only `expect`/`check response has no … security violations` (SPEC §9.10). To bind part of it, name the part: `capture body.…`, `capture status`, `capture header "…"`',
    );
  }
  if (!response) throw new RuntimeError('no response yet — an `api` step must run before this assertion/capture');
  switch (subject.type) {
    case 'StatusSubject':
      return { value: response.status, label: 'status' };
    case 'DurationSubject':
      return { value: response.durationMs, label: 'duration' };
    case 'HeaderSubject': {
      // A4-OS-11/M102: the name is a `StringLit` the checker binds `{var}`s in, so it is a value.
      // Case-fold *after* interpolating — the interpolated text is what names the header.
      const name = String(evalValue(subject.name, ctx));
      return { value: response.headers[name.toLowerCase()], label: `header "${name}"` };
    }
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

/**
 * M125b1 (`FU-18`, D246) — writing an absolute URL opts the suite into declaring where it may
 * reach, and with nothing declared the step is refused.
 *
 * This exists because `isHostAllowed` answers `true` for **everything** when no allowlist is
 * configured (`allowHosts.ts:30`), which is the correct default for a suite written entirely
 * against its env's base URL — that base is the declaration. An absolute URL is the case where that
 * stops being true: it is the one form that can send a request somewhere the config never mentions,
 * and `tflw.config` is the only place a reader would look to find out where a suite talks to.
 *
 * The tier is D147 and the same split `M124` shipped for `TF055`. Here the runtime has resolved the
 * config and is looking at the actual URL about to be fetched, so it *observes* and may refuse. The
 * checker only *predicts* — `allow hosts` differs per env, and a suite whose CI env declares one is
 * correct — so it warns (`TF058`) and never errors.
 *
 * `AllowHostsError` rather than a bare `RuntimeError`, because the three layers between here and the
 * reporter each re-frame what they catch as "request failed: …", and this is not a failed request:
 * nothing was sent. That distinction is carried by the type, exactly as `allowHosts.ts` describes.
 */
export function requireAllowHostsForAbsolute(url: string, target: string, config: ResolvedConfig): void {
  if (!isAbsoluteUrl(target)) return;
  if (config.allowHosts && config.allowHosts.length > 0) return;
  throw new AllowHostsError(absoluteUrlNeedsAllowHosts(url));
}

export function resolveBaseUrl(service: string | null, config: ResolvedConfig): string {
  if (service === null) {
    if (!config.apiBaseUrl) throw new RuntimeError(`env "${config.envName}" declares no default \`api\` base URL`);
    return guardDemoUrl(config.apiBaseUrl);
  }
  const url = config.services[service];
  if (!url) {
    const known = Object.keys(config.services);
    throw new RuntimeError(`unknown api service "${service}"${known.length ? ` (known: ${known.join(', ')})` : ''}`);
  }
  return guardDemoUrl(url);
}

/**
 * M118 (`FU-04`) — belt and braces for the one URL the runtime must never see.
 *
 * `tflw run` swaps `tflw://demo` for the real `http://127.0.0.1:<port>` before any of this executes
 * (`startDemoService` in the CLI), so reaching here means either a typo under the reserved scheme
 * (`tflw://demoo`) or a caller that skipped the substitution. Left alone, both arrive as `fetch
 * failed` with an unsupported-protocol cause, which names neither the scheme nor the fix.
 */
function guardDemoUrl(url: string): string {
  if (!url.startsWith('tflw://')) return url;
  throw new RuntimeError(
    `\`${url}\` is not a real base URL — \`tflw://demo\` is the only address under the reserved \`tflw://\` scheme, ` +
      `and it is tflw's built-in demo service (started by \`tflw run\`). Fix the spelling, or point \`api\` at your own service.`,
  );
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
    case 'CsrfStmt':
      return 'csrf';
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
