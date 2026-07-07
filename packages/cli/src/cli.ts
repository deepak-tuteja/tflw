#!/usr/bin/env node
// testFlow CLI (M1): `tflw run` and `tflw init`. API-only for now — watch/pick/refactor and the
// browser binding arrive in later milestones.
//
// `tflw run` pipeline (SPEC §2–3, §13):
//   read tflw.config → parseConfigSource → selectEnv → resolveConfig
//   → buildEnviron (.env overlaid by real env) → missingRequiredEnv gate
//   → for each .tflw: parseSource (abort on diagnostics) → runProgram (shared Redactor)
//   → writeReport(report.html) + writeJunitXml + renderCliSummary → exit code (0 pass / 1 test failure / 2 usage).

import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import {
  parseSource,
  parseConfigSource,
  renderDiagnostics,
  checkServices,
  checkSessionServices,
  checkDataTables,
  checkSessions,
  checkUnknownVariables,
  type Program,
} from '@tflw/lang';
import {
  runProgram,
  resolveConfig,
  selectEnv,
  missingRequiredEnv,
  makeUniqueSeq,
  countTestCases,
  findSessionUsages,
  resolveRunSeed,
  resolveRunClock,
  ConfigError,
  Redactor,
  redactReport,
  SessionCache,
  type RunReport,
  type TestResult,
  type EventSink,
  type RunEvent,
} from '@tflw/runtime';
import { writeReport, writeJunitXml, renderCliSummary } from '@tflw/reporter';
import { buildEnviron } from './env.js';

const EXIT_OK = 0;
const EXIT_FAIL = 1; // a test failed
const EXIT_USAGE = 2; // usage / config / parse error — could not run

// Set via esbuild `--define` at bundle time (packages/cli/scripts/bundle.mjs, decision 74b) to the
// real package.json version. Undefined under `npm run dev` (unbundled `tsx`), where `getVersion()`
// falls back to reading package.json directly.
declare const __TFLW_VERSION__: string | undefined;

async function getVersion(): Promise<string> {
  if (typeof __TFLW_VERSION__ === 'string') return __TFLW_VERSION__;
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'run':
      return runCommand(rest);
    case 'init':
      return initCommand(rest);
    case 'check':
      return checkCommand(rest);
    case '--version':
    case '-v':
      process.stdout.write(`${await getVersion()}\n`);
      return EXIT_OK;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      printUsage();
      return command === undefined ? EXIT_USAGE : EXIT_OK;
    default:
      err(`unknown command \`${command}\`. Try \`tflw run\`, \`tflw check\`, or \`tflw init\`.`);
      return EXIT_USAGE;
  }
}

// ---- tflw run --------------------------------------------------------------

interface RunArgs {
  readonly files: string[];
  readonly env?: string | undefined;
  /** Raw `--seed` text, validated in `runCommand` (a non-numeric value is a usage error, not a
   * silent NaN→0 coercion, P#46). */
  readonly seedRaw?: string | undefined;
  /** Raw `--now` text, validated in `runCommand` (an unparseable date/time is a usage error,
   * decision 52). */
  readonly nowRaw?: string | undefined;
  readonly tag?: string | undefined;
  /** Raw `--workers` text, validated in `runCommand` (P#47). */
  readonly workersRaw?: string | undefined;
  readonly noColor: boolean;
  /** `--verbose`: prints one line per step, not just per test (no `-v` short form — `-v` is already
   * `--version` at the top-level `main()` dispatch). */
  readonly verbose: boolean;
}

function parseRunArgs(argv: string[]): RunArgs {
  const files: string[] = [];
  let env: string | undefined;
  let seedRaw: string | undefined;
  let nowRaw: string | undefined;
  let tag: string | undefined;
  let workersRaw: string | undefined;
  let noColor = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a.startsWith('--env=')) env = a.slice('--env='.length);
    else if (a === '--seed') seedRaw = argv[++i];
    else if (a.startsWith('--seed=')) seedRaw = a.slice('--seed='.length);
    else if (a === '--now') nowRaw = argv[++i];
    else if (a.startsWith('--now=')) nowRaw = a.slice('--now='.length);
    else if (a === '--tag') tag = argv[++i];
    else if (a.startsWith('--tag=')) tag = a.slice('--tag='.length);
    else if (a === '--workers') workersRaw = argv[++i];
    else if (a.startsWith('--workers=')) workersRaw = a.slice('--workers='.length);
    else if (a === '--no-color') noColor = true;
    else if (a === '--verbose') verbose = true;
    else files.push(a);
  }
  return { files, env, seedRaw, nowRaw, tag, workersRaw, noColor, verbose };
}

/** Parsed + checker-clean state shared by `tflw run` and `tflw check` (decision 75) — everything
 * `tflw run` needs before it actually executes anything. */
interface ValidatedProject {
  readonly resolved: ReturnType<typeof resolveConfig>;
  readonly parsedConfig: ReturnType<typeof parseConfigSource>;
  readonly environ: NodeJS.ProcessEnv;
  readonly parsedFiles: { file: string; source: string; program: Program }[];
}

/** Config parse/resolve + per-file parse/check pipeline (P#46, decisions 57/66): a parse/check
 * error anywhere is a usage error and printed diagnostics, never a partial run. Returns the exit
 * code on failure (already printed), or the validated project on success. Shared by `runCommand`
 * (which then also gates on secrets and actually executes) and `checkCommand` (which stops here —
 * lint-only, no execution, so it never needs real secrets or a live API, decision 75). */
async function loadAndValidate(cwd: string, filesArg: string[], envFlag: string | undefined, color: boolean): Promise<ValidatedProject | number> {
  // 1. Load + parse tflw.config (declaration-only dialect).
  const configPath = join(cwd, 'tflw.config');
  let configText: string;
  try {
    configText = await readFile(configPath, 'utf8');
  } catch {
    err(`no \`tflw.config\` found in ${cwd}. Run \`tflw init\` to scaffold one.`);
    return EXIT_USAGE;
  }
  const parsedConfig = parseConfigSource(configText);
  if (parsedConfig.diagnostics.length > 0) {
    process.stderr.write(renderDiagnostics(parsedConfig.diagnostics, configText, { filename: 'tflw.config', color }) + '\n');
    return EXIT_USAGE;
  }

  // 2. Select the active env and resolve the concrete settings.
  let resolved;
  try {
    const envBlock = selectEnv(parsedConfig.config, { flag: envFlag, envVar: process.env.TFLW_ENV });
    resolved = resolveConfig(parsedConfig.config, envBlock);
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return EXIT_USAGE;
    }
    throw e;
  }

  // 3. Build the runtime environment (.env overlaid by the real process env) — reading it is
  //    harmless (no network, no gate) so both commands can share this; only `runCommand` gates on
  //    `missingRequiredEnv`, since `check` never touches a live API and shouldn't require secrets.
  const environ = await buildEnviron(cwd);

  // Validate `api <service>` references inside `session` blocks against the active env's declared
  // services (decision 66) — a config-level check, done once (not per test file, unlike the
  // per-file `checkServices` below), since `session` blocks live in `tflw.config`, not a test file.
  const sessionServiceDiags = checkSessionServices(parsedConfig.config.sessions, Object.keys(resolved.services));
  if (sessionServiceDiags.length > 0) {
    process.stderr.write(renderDiagnostics(sessionServiceDiags, configText, { filename: 'tflw.config', color }) + '\n');
    return EXIT_USAGE;
  }

  // 4. Discover the test files.
  const files = filesArg.length > 0 ? filesArg.map((f) => resolve(cwd, f)) : await discoverTests(cwd);
  if (files.length === 0) {
    err('no `.tflw` test files given or found (looked for *.tflw under the current directory).');
    return EXIT_USAGE;
  }

  // Validate every file before running any (P#46): a parse/check error in one file must never
  // let the others execute with real side effects. Parse+check each file up front; only start
  // running once every file is clean.
  const knownSessions = Array.from(resolved.sessions.keys());
  const parsedFiles: { file: string; source: string; program: Program }[] = [];
  let hadErrors = false;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const parsed = parseSource(source);
    const serviceDiags = checkServices(parsed.program, Object.keys(resolved.services));
    const tableDiags = checkDataTables(parsed.program);
    const sessionDiags = checkSessions(parsed.program, knownSessions);
    const variableDiags = checkUnknownVariables(parsed.program);
    const diagnostics = [...parsed.diagnostics, ...serviceDiags, ...tableDiags, ...sessionDiags, ...variableDiags];
    if (diagnostics.length > 0) {
      process.stderr.write(renderDiagnostics(diagnostics, source, { filename: relative(cwd, file), color }) + '\n');
      hadErrors = true;
      continue;
    }
    parsedFiles.push({ file, source, program: parsed.program });
  }
  if (hadErrors) return EXIT_USAGE;

  return { resolved, parsedConfig, environ, parsedFiles };
}

async function runCommand(argv: string[]): Promise<number> {
  const args = parseRunArgs(argv);
  const color = args.noColor ? false : process.stdout.isTTY === true;
  const cwd = process.cwd();

  // 0. Validate numeric flags up front — a usage error, never a silent bad-value coercion (P#46).
  let seedArg: number | undefined;
  if (args.seedRaw !== undefined) {
    seedArg = Number(args.seedRaw);
    if (!Number.isFinite(seedArg)) {
      err(`--seed expects a number, got "${args.seedRaw}"`);
      return EXIT_USAGE;
    }
  }
  let workersArg: number | undefined;
  if (args.workersRaw !== undefined) {
    workersArg = Number(args.workersRaw);
    if (!Number.isInteger(workersArg) || workersArg < 1) {
      err(`--workers expects a positive integer, got "${args.workersRaw}"`);
      return EXIT_USAGE;
    }
  }
  let nowArg: string | undefined;
  if (args.nowRaw !== undefined) {
    if (Number.isNaN(new Date(args.nowRaw).getTime())) {
      err(`--now expects an ISO 8601 date/time, got "${args.nowRaw}"`);
      return EXIT_USAGE;
    }
    nowArg = args.nowRaw;
  }

  const loaded = await loadAndValidate(cwd, args.files, args.env, color);
  if (typeof loaded === 'number') return loaded;
  const { resolved, parsedFiles, environ } = loaded;

  // Gate on secrets required to actually run (`check` never reaches this — no execution, no need
  // for real credentials).
  const missing = missingRequiredEnv(resolved, environ);
  if (missing.length > 0) {
    err(`missing required environment ${missing.length > 1 ? 'variables' : 'variable'}: ${missing.join(', ')}\n  set ${missing.length > 1 ? 'them' : 'it'} in your environment or a local .env file (see \`require env\` in tflw.config).`);
    return EXIT_USAGE;
  }

  // 5. Run files against a shared redactor (every secret masked everywhere), a shared session
  //    cache (each `session` block runs at most once, P#42), and one seed + one run-clock for the
  //    whole invocation (P#23, decision 52): explicit `--seed`/`--now`, or freshly minted ones
  //    stamped on the report so a failing run can be reproduced with `tflw run --seed <n> --now
  //    <iso>`. Resolved once here (not per-file) so every file shares the exact same seed *and*
  //    the exact same instant — otherwise each file's `runProgram` would mint its own `new Date()`
  //    a few milliseconds apart. `uniqueSeq` is shared across files so `unique(...)` stays
  //    globally distinct.
  const redactor = new Redactor();
  const sessionCache = new SessionCache();
  const seed = resolveRunSeed(seedArg);
  const now = resolveRunClock(nowArg).toISOString();
  const uniqueSeq = makeUniqueSeq();

  // Apply `--tag` filtering once, up front — a file with no matching test is dropped entirely; if
  // *no* file anywhere carries the tag, that's a hard usage error, not a silent green CI (P#46).
  const runnable = parsedFiles
    .map(({ file, source, program: fileProgram }) => ({
      file,
      source,
      program: args.tag ? { ...fileProgram, tests: fileProgram.tests.filter((t) => t.tags.includes(args.tag!)) } : fileProgram,
    }))
    .filter((f) => !args.tag || f.program.tests.length > 0);
  if (args.tag && runnable.length === 0) {
    err(`no test anywhere carries the tag \`${args.tag}\`.`);
    return EXIT_USAGE;
  }

  // Precompute each file's test-index offset from this (sorted) file order *before* running any
  // of them — required so per-test `random` sub-seeds are stable regardless of worker concurrency
  // (P#47): once files can run in parallel, an offset can no longer be accumulated sequentially
  // from each file's actual `report.total` after the fact. Same pass also picks, for every
  // `session` name referenced anywhere, the single case with the smallest *global* index as its
  // deterministic splice-owner — the case whose report shows the session's steps, independent of
  // which file's first opting-in test actually wins the `--workers N>1` race to establish it
  // (decision 53).
  const offsets: number[] = [];
  const sessionSpliceOwners = new Map<string, number>();
  {
    let offset = 0;
    for (const { file, program } of runnable) {
      offsets.push(offset);
      const dir = dirname(file);
      const usages = await findSessionUsages(program, dir);
      for (const u of usages) {
        const globalIndex = offset + u.localIndex;
        const current = sessionSpliceOwners.get(u.session);
        if (current === undefined || globalIndex < current) sessionSpliceOwners.set(u.session, globalIndex);
      }
      offset += await countTestCases(program, dir);
    }
  }

  const workers = workersArg ?? resolved.workers;

  // Live console output (P#4/#5's event stream, consumed here — never the report's data source,
  // decision 86): the shared ticker always runs now — a failing test's diff is surfaced live
  // unconditionally (not gated on an interactive TTY or `--verbose`), while a passing test's tick
  // line stays gated on `color`/`--verbose` so a plain CI/piped run stays exactly as terse as
  // before on green suites (see `formatEvent`). `--verbose` additionally needs per-step lines,
  // which under `--workers > 1` would interleave illegibly across concurrent files with no way to
  // tell them apart (no file id on any `RunEvent`, and `runWithConcurrency` is a real in-process
  // concurrent pool, not just sequential-looking async) — so in that combination each file gets
  // its own buffered sink instead, flushed as one contiguous block once that file finishes, and
  // the shared live sink is skipped entirely.
  const useBufferedVerbose = args.verbose && workers > 1;
  const sharedEmit = useBufferedVerbose ? undefined : liveEmit(color, args.verbose);

  const reports = await runWithConcurrency(runnable, workers, async ({ file, source, program }, i) => {
    const buffered = useBufferedVerbose ? bufferedEmit(color, args.verbose) : undefined;
    const fileEmit = buffered?.sink ?? sharedEmit;
    try {
      const { report } = await runProgram(program, resolved, {
        source,
        baseDir: dirname(file),
        environ,
        redactor,
        sessionCache,
        seed,
        now,
        uniqueSeq,
        testIndexOffset: offsets[i]!,
        sessionSpliceOwners,
        ...(fileEmit ? { emit: fileEmit } : {}),
      });
      buffered?.flush();
      // Stamp each test with the relative file it came from (report.html's per-file grouping,
      // decision 92) — done here, once, after the fact, rather than threading a new `RunOptions`
      // field through the whole interpreter, since `file` is a display concern only.
      const fileLabel = relative(cwd, file);
      return { ...report, tests: report.tests.map((t) => ({ ...t, file: fileLabel })) };
    } catch (e) {
      buffered?.flush();
      // A runtime throw in this file (e.g. a bad `import`/`use` path) must never sink the whole
      // run silently — other files' reports still get merged and written (P#46: "always write the
      // report for tests that ran").
      const message = e instanceof Error ? e.message : String(e);
      const fileLabel = relative(cwd, file);
      const crashed: RunReport = {
        ok: false,
        env: resolved.envName,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        total: 1,
        passed: 0,
        failed: 1,
        tests: [{ name: `${fileLabel} (crashed)`, ok: false, durationMs: 0, steps: [], error: redactor.redact(message), file: fileLabel }],
        seed,
        now,
        insecure: resolved.insecure,
      };
      return crashed;
    }
  });

  // 6. Merge reports, write report.html + junit.xml, print the summary. A second full-report
  //    redaction pass (decision 56) here — on top of the one each `runProgram` call already did on
  //    its own file's report — closes the *cross-file* half of the ordering window: a secret first
  //    registered by one file (e.g. running later, or concurrently under `--workers`) can still
  //    retroactively mask an earlier file's already-built report once everything is merged.
  const merged = redactReport(mergeReports(reports, resolved.envName, seed, now, resolved.insecure), redactor);
  const outPath = await writeReport(merged, join(cwd, resolved.reportDir));
  await writeJunitXml(merged, join(cwd, resolved.reportDir));
  process.stdout.write('\n' + renderCliSummary(merged, color) + '\n');
  process.stdout.write(`\n${dim(color, 'report:')} ${relative(cwd, outPath)}\n`);

  return merged.ok ? EXIT_OK : EXIT_FAIL;
}

// ---- tflw check -------------------------------------------------------------

interface CheckArgs {
  readonly files: string[];
  readonly env?: string | undefined;
  readonly noColor: boolean;
}

function parseCheckArgs(argv: string[]): CheckArgs {
  const files: string[] = [];
  let env: string | undefined;
  let noColor = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a.startsWith('--env=')) env = a.slice('--env='.length);
    else if (a === '--no-color') noColor = true;
    else files.push(a);
  }
  return { files, env, noColor };
}

/** Validate-only: the exact same parse+checker pipeline `tflw run` runs before it executes
 * anything (decision 75) — teaching diagnostics, no HTTP traffic, no secrets required. For CI/
 * pre-commit: lint a suite without touching a live API. */
async function checkCommand(argv: string[]): Promise<number> {
  const args = parseCheckArgs(argv);
  const color = args.noColor ? false : process.stdout.isTTY === true;
  const cwd = process.cwd();

  const loaded = await loadAndValidate(cwd, args.files, args.env, color);
  if (typeof loaded === 'number') return loaded;

  const n = loaded.parsedFiles.length;
  process.stdout.write(`${n} file${n === 1 ? '' : 's'} checked, no problems found.\n`);
  return EXIT_OK;
}

/**
 * Run `items` with at most `limit` in flight at once, preserving each result at its original
 * index regardless of completion order (P#47: in-process promise pool, per-file granularity — a
 * file itself always runs sequentially inside, only *different* files run concurrently).
 */
async function runWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runNext(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  }
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runNext()));
  return results;
}

/** Combine per-file reports into one run report, in original file order regardless of the
 * per-file worker concurrency that produced them (P#47). */
function mergeReports(reports: readonly RunReport[], envName: string, seed: number, now: string, insecure: boolean): RunReport {
  const tests: TestResult[] = reports.flatMap((r) => r.tests);
  const passed = tests.filter((t) => t.ok).length;
  return {
    ok: tests.every((t) => t.ok),
    env: envName,
    startedAt: reports[0]?.startedAt ?? new Date().toISOString(),
    durationMs: reports.reduce((sum, r) => sum + r.durationMs, 0),
    total: tests.length,
    passed,
    failed: tests.length - passed,
    tests,
    seed,
    now,
    insecure,
  };
}

function tick(color: boolean, ok: boolean): string {
  if (!color) return ok ? '✓' : '✗';
  return ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
}

/** Maps one `RunEvent` to the text block it produces on the console, or `undefined` if this event
 * prints nothing — shared by the live ticker and the buffered-per-file collector below so both
 * stay in lockstep (the console consumes the same event stream the report is built from, per
 * decision 86, but never becomes the report's own data source).
 *
 * `test:end`, failing: always prints — `✗ name` plus each failing step's already-capped/
 * subset-aware `detail` (gap #8's `truncate()`/`subsetMismatches()`, baked into `StepResult.detail`
 * by the time it gets here) indented underneath, live, with no flag and no TTY requirement, so a
 * failure is diagnosable without opening report.html even in a piped/CI run.
 *
 * `test:end`, passing: only a cosmetic `✓ name` tick, gated on `color` (today's existing
 * interactive-only ticker) or `--verbose` — a plain CI/piped green run stays exactly as terse as
 * before this change.
 *
 * Verbose (`--verbose`): additionally prints a header line per test (`test:start`) and one
 * indented line per step, pass or fail (`step:end`), using the step's existing `detail`/
 * `durationMs` — no new computation. */
function formatEvent(ev: RunEvent, color: boolean, verbose: boolean): string | undefined {
  if (verbose && ev.type === 'test:start') return ev.name;
  if (verbose && ev.type === 'step:end') {
    const label = ev.step.detail ?? ev.step.kind;
    return `  ${tick(color, ev.step.ok)} ${label} (${ev.step.durationMs}ms)`;
  }
  if (ev.type === 'test:end') {
    const durSuffix = verbose ? ` (${ev.result.durationMs}ms)` : '';
    if (!ev.result.ok) {
      // Always surfaced, live, regardless of `--verbose`/TTY color — a failing test's diff
      // shouldn't require an interactive terminal or opening report.html to see (the CLI
      // ergonomics ask this track exists for).
      const lines = [`${tick(color, false)} ${ev.result.name}${durSuffix}`];
      for (const step of ev.result.steps) {
        if (!step.ok && step.detail) lines.push(`    ${step.detail}`);
      }
      return lines.join('\n');
    }
    // A passing test's tick line is cosmetic — keep it gated on `color` (today's existing
    // interactive-only ticker) or `--verbose`, so a plain CI/piped green run stays exactly as
    // terse as before.
    if (verbose || color) return `${tick(color, true)} ${ev.result.name}${durSuffix}`;
    return undefined;
  }
  return undefined;
}

/** The default live ticker: writes straight to stdout as events arrive. Safe to share across every
 * concurrently-running file when `--verbose` is off (only `test:end` prints, and today's existing
 * cross-file interleaving of those lines is pre-existing, unchanged behavior) — but never used for
 * verbose output under `--workers > 1`, see `bufferedEmit` below. */
function liveEmit(color: boolean, verbose: boolean): EventSink {
  return (ev) => {
    const line = formatEvent(ev, color, verbose);
    if (line !== undefined) process.stdout.write(line + '\n');
  };
}

/** One buffered sink per concurrently-running file: collects its formatted lines instead of
 * writing them, so `flush()` (called once that file's `runProgram` resolves) prints them as a
 * single contiguous block — concurrent files' verbose step logs can never interleave line-by-line. */
function bufferedEmit(color: boolean, verbose: boolean): { sink: EventSink; flush: () => void } {
  const lines: string[] = [];
  const sink: EventSink = (ev) => {
    const line = formatEvent(ev, color, verbose);
    if (line !== undefined) lines.push(line);
  };
  return {
    sink,
    flush: () => {
      if (lines.length > 0) process.stdout.write(lines.join('\n') + '\n');
    },
  };
}

async function discoverTests(cwd: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.tflw')) found.push(full);
    }
  };
  await walk(cwd);
  return found.sort();
}

// ---- tflw init -------------------------------------------------------------

async function initCommand(_argv: string[]): Promise<number> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'tflw.config');
  const examplePath = join(cwd, 'example.tflw');
  const envExamplePath = join(cwd, '.env.example');

  if (await exists(configPath)) {
    err(`\`tflw.config\` already exists in ${cwd} — not overwriting.`);
    return EXIT_USAGE;
  }

  await writeFile(configPath, SCAFFOLD_CONFIG, 'utf8');
  const created = ['tflw.config'];
  if (!(await exists(examplePath))) {
    await writeFile(examplePath, SCAFFOLD_TEST, 'utf8');
    created.push('example.tflw');
  }
  // Secrets hygiene from day one (decision 82, restoring decision 36's original promise): a tool
  // whose flagship feature is "secrets never leak into reports" shouldn't leave `.env` committable
  // in its own quickstart.
  if (!(await exists(envExamplePath))) {
    await writeFile(envExamplePath, SCAFFOLD_ENV_EXAMPLE, 'utf8');
    created.push('.env.example');
  }
  if (await ensureGitignore(cwd)) created.push('.gitignore');

  process.stdout.write(`created ${created.join(', ')}\n\nnext:\n  tflw run\n`);
  return EXIT_OK;
}

/** Creates `.gitignore` if missing, or appends only whichever of `.env`/`report/` it doesn't
 * already have — never duplicates a line a user's existing `.gitignore` already carries. Returns
 * whether the file was created or changed at all. */
async function ensureGitignore(cwd: string): Promise<boolean> {
  const gitignorePath = join(cwd, '.gitignore');
  const required = ['.env', 'report/'];
  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf8');
  } catch {
    // no .gitignore yet — the missing-lines path below writes all of `required`
  }
  const lines = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = required.filter((r) => !lines.has(r));
  if (missing.length === 0) return false;
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await writeFile(gitignorePath, existing + sep + missing.join('\n') + '\n', 'utf8');
  return true;
}

const SCAFFOLD_CONFIG = `# testFlow config — declaration-only. Pick the active env with --env, TFLW_ENV, or the
# \`default\` marker below. \`tflw run\` uses \`local\` unless you say otherwise.

env local default
  api "http://localhost:3001"

# A second env, selected with \`tflw run --env staging\`. Secrets come from the environment
# via env(NAME) — a local .env is auto-loaded for dev, real env vars win over it, and their
# values are redacted from reports. Uncomment to use:
#
# env staging
#   api "https://staging.example.com"
#   header "Authorization" is env(API_TOKEN)
#
# require env API_TOKEN
`;

// Matches the commented-out \`staging\` env above: uncomment \`require env API_TOKEN\` there once
// this is filled in. \`.env\` (this file without \`.example\`) is gitignored and auto-loaded for
// local dev; real environment variables always win over it, and every \`env(NAME)\` value is
// redacted from reports automatically.
const SCAFFOLD_ENV_EXAMPLE = `API_TOKEN=
`;

const SCAFFOLD_TEST = `# An API test. \`api\` sends a request; \`expect\` asserts against the last response.

test "health check"
  api GET /health
  expect status equals 200
`;

// ---- helpers ---------------------------------------------------------------

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function err(message: string): void {
  process.stderr.write(`\x1b[31merror\x1b[0m: ${message}\n`);
}

function dim(color: boolean, s: string): string {
  return color ? `\x1b[2m${s}\x1b[0m` : s;
}

function printUsage(): void {
  process.stdout.write(
    [
      'tflw — a testing-only DSL for API tests (.tflw files), reports first.',
      '',
      'usage:',
      '  tflw run [files...] [--env <name>] [--seed <n>] [--now <iso>] [--tag <name>] [--workers <n>] [--no-color] [--verbose]',
      '                                                      run .tflw tests (default: all under cwd)',
      '                                                      --now replays the exact run-clock instant',
      '                                                      alongside --seed, e.g. --seed 42 --now 2026-07-06T00:00:00Z',
      '                                                      --verbose prints one line per step, not just per test',
      '  tflw check [files...] [--env <name>] [--no-color]  validate only — no execution, no secrets needed',
      '  tflw init                                          scaffold tflw.config + example.tflw',
      '  tflw --version, -v                                 print the installed version',
      '  tflw --help, -h                                    show this message',
      '',
    ].join('\n'),
  );
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    err(e instanceof Error ? e.message : String(e));
    process.exit(EXIT_USAGE);
  });
