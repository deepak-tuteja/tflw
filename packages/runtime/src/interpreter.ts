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
  ApiBody,
  ApiRequestSpec,
  CaptureStmt,
  ExpectStmt,
  HookDecl,
  LetStmt,
  Oauth2SessionConfig,
  PathSegment,
  Program,
  SessionDecl,
  Span,
  Step,
  Subject,
  TestDecl,
  WaitUntilApiStmt,
} from '@tflw/lang';
import { evalValue, interpolatePath, navigate, RuntimeError, stringify, type EvalCtx } from './eval.js';
import { evalMatcher, evalRequestMatcher, repr, type MatchOutcome } from './matcher.js';
import { camelCaseName, loadHelperModule } from './helpers.js';
import { loadTableRows, type RowCell } from './dataTable.js';
import { Redactor, redactReport } from './redact.js';
import { redactFields } from './fieldRedact.js';
import { evaluateSchemaMatch } from './contract.js';
import { CookieJar } from './cookieJar.js';
import { sendRequest } from './http.js';
import { hashString, mulberry32, resolveRunClock, resolveRunSeed, subSeed } from './seed.js';
import { acquireInsecureTls, releaseInsecureTls } from './tls.js';
import type { AttemptResult, EventSink, RequestTrace, ResolvedConfig, ResponseTrace, RunReport, StepResult, TestResult } from './types.js';

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
  const registry = await buildRegistry(program, baseDir);
  const beforeFile = program.hooks.filter((h) => h.scope === 'file' && h.when === 'before');
  const afterFile = program.hooks.filter((h) => h.scope === 'file' && h.when === 'after');
  const beforeEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'before');
  const afterEach = program.hooks.filter((h) => h.scope === 'each' && h.when === 'after');
  const cases = await expandTestCases(program, baseDir);

  emit({ type: 'run:start', total: cases.length, env: config.envName });

  const results: TestResult[] = [];
  const fileTc: TestCtx = { environ, redactor, emit, lines, baseDir, rng: mulberry32(runSeed), runSeed, runClock, uniqueSeq, sessionCache };
  const beforeFileOk = await runFileHooks(beforeFile, 'before file', config, fileTc, registry, results, emit);

  if (beforeFileOk) {
    for (const [i, kase] of cases.entries()) {
      const globalIndex = testIndexOffset + i;
      const testSeed = subSeed(runSeed, globalIndex);
      const tc: TestCtx = { environ, redactor, emit, lines, baseDir, rng: mulberry32(testSeed), runSeed, runClock, uniqueSeq, sessionCache };
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
  };
  // Final full-report redaction pass (decision 56, half 2): a secret registered late in this run
  // (or, when `redactor` is shared across files, by a file that ran concurrently/after this one)
  // may not have been known yet when an earlier step's trace was first redacted. Re-redacting the
  // whole report now, with the redactor in its final state, catches anything still unmasked.
  const report = redactReport(rawReport, redactor);
  emit({ type: 'run:end', report });
  return { report, redactor };
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
    attemptResults.push({ attempt: attempts, ok: result.ok, durationMs: result.durationMs, steps: result.steps, ...(result.error !== undefined ? { error: result.error } : {}) });
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
  const evalCtx: EvalCtx = { ...nameCtx, sessionHeaders, sessionNames: test.sessions, cookieJar };

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
          result = await execExpect(step, lastResponse, lastConnectionError, ctx, src, stepStart, config);
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
        case 'CaptureStmt': {
          result = execCapture(step, lastResponse, ctx, src, stepStart, tc.redactor);
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
      const failed = mkStep(stepKind(step), src, step.span, false, stepStart, redacted);
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
      const form = new FormData();
      form.append(fieldName, new Blob([new Uint8Array(buf)]), basename(abs));
      const traceParts = [`${fieldName}=${basename(abs)}`];
      for (const field of body.extra) {
        const value = stringify(evalValue(field.value, ctx));
        form.append(field.key, value);
        traceParts.push(`${field.key}=${value}`);
      }
      return { sendBody: form, traceText: `[multipart form: ${traceParts.join(', ')}]` };
    }
  }
}

async function execExpect(step: ExpectStmt, response: ResponseTrace | null, connectionError: string | null, ctx: EvalCtx, src: string, start: number, config: ResolvedConfig): Promise<StepResult> {
  const outcome = await evaluateExpect(step, response, connectionError, ctx, config);
  return mkStep(step.soft ? 'check' : 'expect', src, step.span, outcome.ok, start, ctx.redactor.redact(outcome.message));
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

function execCapture(step: CaptureStmt, response: ResponseTrace | null, ctx: EvalCtx, src: string, start: number, redactor: Redactor): StepResult {
  const { value } = resolveSubject(step.subject, response);
  ctx.scope.set(step.name, value);
  return mkStep('capture', src, step.span, true, start, redactor.redact(`${step.name} = ${repr(value)} (captured)`));
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
    const outcomes = await Promise.all(step.expects.map((e) => evaluateExpect(e, trace.response, null, ctx, config)));
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

async function evaluateExpect(step: ExpectStmt, response: ResponseTrace | null, connectionError: string | null, ctx: EvalCtx, config: ResolvedConfig): Promise<MatchOutcome> {
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
  return evalMatcher(label, value, step.matcher, ctx);
}

/** `any`/`all` over an array found by walking the body path (P#14, SPEC §6.3): navigate segments
 * until a value is an array, then apply the remaining segments per element. */
function evaluateQuantified(step: ExpectStmt, response: ResponseTrace | null, ctx: EvalCtx): MatchOutcome {
  if (!response) throw new RuntimeError('no response yet — an `api` step must run before this assertion');
  if (response.json === undefined) throw new RuntimeError('`any`/`all` need a JSON response body (use `body text` for non-JSON)');
  if (step.subject.type !== 'BodySubject') throw new RuntimeError('`any`/`all` only apply to a `body.<path>` subject');
  if (step.matcher.name === 'matchesSchema') {
    throw new RuntimeError('`any`/`all` cannot be combined with `matches schema` — validate the whole array element by element isn\'t supported for contract matching');
  }
  const path = step.subject.path;

  let current: unknown = response.json;
  let i = 0;
  while (i < path.length && !Array.isArray(current)) {
    current = navigate(current, path[i]!, pathLabel(path.slice(0, i + 1)));
    i++;
  }
  if (!Array.isArray(current)) {
    throw new RuntimeError(`\`${step.quantifier}\` needs an array somewhere in \`body${pathLabel(path)}\`, but never found one`);
  }
  const arrayLabel = `body${pathLabel(path.slice(0, i))}`;
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

function redactResponse(res: ResponseTrace, r: Redactor, config: ResolvedConfig): ResponseTrace {
  const statusText = r.redact(res.statusText);
  if (config.evidenceLevel === 'none') {
    return { status: res.status, statusText, headers: {}, bodyText: EVIDENCE_OMITTED_BODY, durationMs: res.durationMs };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k] = r.redact(v);
  if (config.evidenceLevel === 'headers-only') {
    return { status: res.status, statusText, headers, bodyText: EVIDENCE_OMITTED_BODY, durationMs: res.durationMs };
  }
  const bodyText = redactFields(r.redact(res.bodyText), config.redactPatterns);
  return { status: res.status, statusText, headers, bodyText, durationMs: res.durationMs };
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
    case 'WaitUntilApiStmt':
      return 'wait';
    case 'GiveStmt':
      return 'give';
    case 'HeaderStmt':
      return 'header';
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
