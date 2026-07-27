#!/usr/bin/env node
// testFlow CLI (M1): `tflw run` and `tflw init`. Browser steps (M3), `tflw pick`/`tflw watch` (M5),
// and the reuse-pass `tflw refactor apply` (M6) followed.
//
// `tflw run` pipeline (SPEC §2–3, §13):
//   read tflw.config → parseConfigSource → selectEnv → resolveConfig
//   → buildEnviron (.env overlaid by real env) → missingRequiredEnv gate
//   → for each .tflw: parseSource (abort on diagnostics) → runProgram (shared Redactor)
//   → writeReport(report.html) + writeJunitXml + renderCliSummary → exit code (0 pass / 1 test failure / 2 usage).

import { readFile, readdir, writeFile, access, mkdir } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';
import {
  parseSource,
  parseConfigSource,
  renderDiagnostics,
  checkServices,
  checkSessionServices,
  checkDataTables,
  checkSessions,
  checkUnknownVariables,
  checkRequestAssertions,
  suggest,
  detectReuse,
  renderCallSiteReplacement,
  importInsertionOffset,
  type Program,
  type Diagnostic,
  type EvidenceLevel,
  type SuiteEntry,
  type ReuseOccurrence,
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
  BrowserManager,
  SUPPORTED_BROWSER_ENGINES,
  startPickSession,
  type BrowserEngine,
  type RunReport,
  type TestResult,
  type EventSink,
  type RunEvent,
  type ResolvedConfig,
  type PickSessionHandle,
} from '@tflw/runtime';
import { spawn } from 'node:child_process';
import {
  writeReport,
  writeJunitXml,
  writeResultsJson,
  writeLastRun,
  readLastRun,
  writeEventsNdjson,
  renderCliSummary,
} from '@tflw/reporter';
import { startServer } from '@tflw/lsp-server';
import { buildEnviron } from './env.js';
import { DOCS_TOPICS } from './docs-data.generated.js';

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
    case 'docs':
      return docsCommand(rest);
    case 'lsp':
      return lspCommand(rest);
    case 'install-browsers':
      return installBrowsersCommand(rest);
    case 'pick':
      return pickCommand(rest);
    case 'watch':
      return watchCommand(rest);
    case 'refactor':
      return refactorCommand(rest);
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
      err(
        `unknown command \`${command}\`. Try \`tflw run\`, \`tflw check\`, \`tflw init\`, \`tflw docs\`, \`tflw lsp\`, \`tflw install-browsers\`, \`tflw pick\`, \`tflw watch\`, or \`tflw refactor apply\`.`,
      );
      return EXIT_USAGE;
  }
}

// ---- tflw install-browsers (M3a, D5) ---------------------------------------

/**
 * `playwright` is an optional peer (D5): browser step support only activates once the consuming
 * project installs it themselves (`npm install -D playwright`) and downloads a browser binary via
 * this command. Shells out to the `playwright` CLI that ships inside that same npm package (via
 * `npx`, so it resolves the consumer's own installed version) rather than reaching into any
 * private Playwright API — the well-supported, documented install path.
 */
async function installBrowsersCommand(argv: string[]): Promise<number> {
  let browser: string = 'chromium'; // D11: Chromium default
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--browser') browser = argv[++i] ?? browser;
    else if (a.startsWith('--browser=')) browser = a.slice('--browser='.length);
  }
  if (!(SUPPORTED_BROWSER_ENGINES as readonly string[]).includes(browser)) {
    err(`unknown --browser \`${browser}\` — expected one of: ${SUPPORTED_BROWSER_ENGINES.join(', ')}.`);
    return EXIT_USAGE;
  }
  const code = await new Promise<number>((resolvePromise) => {
    const child = spawn('npx', ['--yes', 'playwright', 'install', browser], { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (e) => {
      err(`could not run \`npx playwright install ${browser}\`: ${e.message}\n  make sure \`playwright\` is installed (\`npm install -D playwright\`) and \`npx\` is on PATH.`);
      resolvePromise(EXIT_USAGE);
    });
    child.on('exit', (exitCode) => resolvePromise(exitCode ?? EXIT_USAGE));
  });
  return code === 0 ? EXIT_OK : EXIT_USAGE;
}

// ---- tflw pick <url> (M5, SPEC §12) -----------------------------------------

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Opens a real, visible browser at `<url>` and prints one verified tflw locator per click
 * (`startPickSession` in `@tflw/runtime` — every printed locator is confirmed to resolve to
 * exactly the clicked element, D6/D7, not a guess). Runs until the window is closed or Ctrl+C.
 * No `tflw.config` involved — this command has no notion of a `web` base URL, so `<url>` must be
 * absolute (unlike `open "/path"` inside a `.tflw` file, which resolves against one). */
async function pickCommand(argv: string[]): Promise<number> {
  let url: string | undefined;
  let browserRaw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--browser') browserRaw = argv[++i];
    else if (a.startsWith('--browser=')) browserRaw = a.slice('--browser='.length);
    else if (url === undefined) url = a;
    else {
      err(`unexpected argument \`${a}\`. Usage: tflw pick <url> [--browser chromium|firefox|webkit]`);
      return EXIT_USAGE;
    }
  }
  if (!url) {
    err('tflw pick needs a URL. Usage: tflw pick <url> [--browser chromium|firefox|webkit]');
    return EXIT_USAGE;
  }
  if (!ABSOLUTE_URL_RE.test(url)) {
    err(`\`${url}\` isn't an absolute URL — include a scheme, e.g. http://localhost:3000${url.startsWith('/') ? url : `/${url}`}`);
    return EXIT_USAGE;
  }
  let engine: BrowserEngine = 'chromium';
  if (browserRaw !== undefined) {
    if (!(SUPPORTED_BROWSER_ENGINES as readonly string[]).includes(browserRaw)) {
      err(`--browser expects one of ${SUPPORTED_BROWSER_ENGINES.join(', ')}, got "${browserRaw}"`);
      return EXIT_USAGE;
    }
    engine = browserRaw as BrowserEngine;
  }

  process.stdout.write(`opening ${url} — click any element to print its locator. Close the window or press Ctrl+C to stop.\n`);

  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((res) => {
    resolveClosed = res;
  });

  let session: PickSessionHandle;
  try {
    session = await startPickSession(
      url,
      engine,
      (picked) => process.stdout.write(`${picked.syntax}\n`),
      () => resolveClosed(),
    );
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return EXIT_USAGE;
  }

  const onSigint = (): void => void session.close();
  process.on('SIGINT', onSigint);
  await closed;
  process.off('SIGINT', onSigint);
  return EXIT_OK;
}

// ---- tflw watch (M5, SPEC §12) ----------------------------------------------
//
// Save → the affected test re-runs headed (`runCommand` under the hood, via `RunCommandWatchOptions`
// above), one shared headed browser process for the *whole watch session* (not one per triggered
// run — `runCommand` would otherwise construct-then-close a fresh one every single save, which is
// both slow and defeats "the browser stays open"). One seed, resolved once at startup and reused
// for every run for the life of the session (`--seed` if given, else freshly minted the same way
// `tflw run` would) — since it never changes, a run that just failed and the next run after a fix
// are trivially using "the same seed the last failing run used" (the milestone's own phrasing),
// with no extra bookkeeping needed to specifically detect and carry forward *only* a failing seed.
//
// Scope, deliberately: saving a `.tflw` file re-runs *that file* (not a suite-wide dependency
// graph — actions/imports aren't statically traced here); saving `tflw.config` re-runs everything,
// since every file's resolved settings could have changed. A save of anything else (a `.ts` helper
// behind `use "…"`, e.g.) is not watched — cross-file impact analysis is future work, not promised
// by this milestone.

interface WatchArgs {
  readonly files: string[];
  readonly env?: string | undefined;
  readonly browserRaw?: string | undefined;
  readonly seedRaw?: string | undefined;
  readonly noColor: boolean;
}

function parseWatchArgs(argv: string[]): WatchArgs {
  const files: string[] = [];
  let env: string | undefined;
  let browserRaw: string | undefined;
  let seedRaw: string | undefined;
  let noColor = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a.startsWith('--env=')) env = a.slice('--env='.length);
    else if (a === '--browser') browserRaw = argv[++i];
    else if (a.startsWith('--browser=')) browserRaw = a.slice('--browser='.length);
    else if (a === '--seed') seedRaw = argv[++i];
    else if (a.startsWith('--seed=')) seedRaw = a.slice('--seed='.length);
    else if (a === '--no-color') noColor = true;
    else files.push(a);
  }
  return { files, env, browserRaw, seedRaw, noColor };
}

async function watchCommand(argv: string[]): Promise<number> {
  const args = parseWatchArgs(argv);
  const cwd = process.cwd();

  let seedArg: number | undefined;
  if (args.seedRaw !== undefined) {
    seedArg = Number(args.seedRaw);
    if (!Number.isFinite(seedArg)) {
      err(`--seed expects a number, got "${args.seedRaw}"`);
      return EXIT_USAGE;
    }
  }
  let engine: BrowserEngine = 'chromium';
  if (args.browserRaw !== undefined) {
    if (!(SUPPORTED_BROWSER_ENGINES as readonly string[]).includes(args.browserRaw)) {
      err(`--browser expects one of ${SUPPORTED_BROWSER_ENGINES.join(', ')}, got "${args.browserRaw}"`);
      return EXIT_USAGE;
    }
    engine = args.browserRaw as BrowserEngine;
  }
  const seed = resolveRunSeed(seedArg);
  // Normalized the same way `runCommand`'s own file args eventually are (`resolve(cwd, f)`) so a
  // watch event's cwd-relative `filename` compares equal regardless of how the user typed it
  // (`./foo.tflw`, `foo.tflw`, an absolute path, …).
  const watchFiles = args.files.map((f) => resolve(cwd, f));

  process.stdout.write(`tflw watch — seed ${seed} (pass \`--seed ${seed}\` to \`tflw run\` to reproduce outside watch)\n`);

  let browserManager: BrowserManager | undefined;
  let stopped = false;

  const runOne = async (target: string | 'all'): Promise<void> => {
    const label = target === 'all' ? 'the full suite' : relative(cwd, target);
    process.stdout.write(`\n[watch] running ${label}…\n`);
    const runArgv = [
      ...(target === 'all' ? args.files : [target]),
      '--headed',
      '--seed',
      String(seed),
      '--browser',
      engine,
      ...(args.env ? ['--env', args.env] : []),
      ...(args.noColor ? ['--no-color'] : []),
    ];
    await runCommand(runArgv, {
      browserManager,
      onBrowserManagerReady: (bm) => {
        browserManager = bm;
      },
      keepBrowserOpen: true,
    });
    if (!stopped) process.stdout.write(`\n[watch] watching for changes — save a .tflw file to re-run, Ctrl+C to stop\n`);
  };

  // A tiny queue-of-one: `runChain` is a promise chain that serializes every triggered run, so a
  // save arriving mid-run is never dropped, but a burst of saves collapses into exactly one
  // trailing re-run (`queuedTarget`, coalesced — `all` always wins over a specific file, since a
  // config change makes any single-file target stale) rather than one run per keystroke's autosave.
  let queuedTarget: string | 'all' | null = 'all'; // the initial run, kicked off below
  let debounceTimer: NodeJS.Timeout | undefined;
  let runChain: Promise<void> = Promise.resolve();

  const flushQueued = (): void => {
    runChain = runChain.then(async () => {
      if (stopped || queuedTarget === null) return;
      const target = queuedTarget;
      queuedTarget = null;
      await runOne(target);
    });
  };

  const watcher = fsWatch(cwd, { recursive: true }, (_event, filename) => {
    if (!filename || stopped) return;
    const absPath = resolve(cwd, filename);
    let target: string | 'all' | null = null;
    if (basename(filename) === 'tflw.config') target = 'all';
    else if (filename.endsWith('.tflw')) {
      if (watchFiles.length > 0 && !watchFiles.includes(absPath)) return; // outside the requested set
      target = absPath;
    } else {
      return;
    }
    queuedTarget = queuedTarget === 'all' ? 'all' : target;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushQueued, 200);
  });

  return new Promise<number>((resolveExit) => {
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      await runChain;
      await browserManager?.close();
      resolveExit(EXIT_OK);
    };
    // Once a browser has launched, Playwright installs its own SIGINT handler (to kill its spawned
    // subprocess on Ctrl+C) alongside this one — Node invokes every registered listener, so both
    // run, and Playwright's typically wins the race to actually terminate the process, producing
    // the standard Unix "died from signal" exit code (128+SIGINT=130) instead of `EXIT_OK` below.
    // Either outcome is a clean stop (the browser is closed either way) — this handler's own
    // graceful shutdown still matters for the no-browser-yet case (an API-only suite, or Ctrl+C
    // before the very first run's first browser step).
    process.on('SIGINT', () => void stop());
    flushQueued(); // the initial full run
  });
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
  /** `--tag a,b,c` (decision 97, closes TFLW-GAPS.md gap #14): comma-separated, OR semantics — a
   * test runs if it carries *any* listed tag. No exclusion syntax (`--tag !x`), scoped out. Still
   * combines with `--only` as AND (unchanged). */
  readonly tags?: string[] | undefined;
  /** `--only "<exact test name>"` (decision 94) — runs a single test by its exact declared name,
   * for the VS Code extension's per-test "Run test" CodeLens (`--tag` alone can't target one test,
   * since tags aren't required/unique). Combines with `--tag` (both must match, AND not OR) rather
   * than being mutually exclusive, since that's the least surprising behavior if a future caller
   * ever passes both — no extra validation needed for a combination that's simply more selective. */
  readonly only?: string | undefined;
  /** Raw `--workers` text, validated in `runCommand` (P#47). */
  readonly workersRaw?: string | undefined;
  readonly noColor: boolean;
  /** `--verbose`: prints one line per step, not just per test (no `-v` short form — `-v` is already
   * `--version` at the top-level `main()` dispatch). */
  readonly verbose: boolean;
  /** `--forbid-insecure` (PLAN decision 101b, enterprise arc cluster 2): fail before any test runs
   * if the active env has `insecure true` in effect — a CI policy gate against accidentally
   * shipping a TLS-verification bypass. No config representation, `run` only. */
  readonly forbidInsecure: boolean;
  /** Raw `--evidence` text, validated in `runCommand` against `EVIDENCE_LEVELS` (decision 101c) —
   * overrides `tflw.config`'s `evidence` key for this run only. */
  readonly evidenceRaw?: string | undefined;
  /** `tflw run --failed` (PLAN decision 111, M17) — replay only the previous run's failing tests,
   * read from `report/.last-run.json`. Composes with `--tag`/`--only` as AND, same as they
   * already compose with each other. */
  readonly failed: boolean;
  /** `--bail` (PLAN decision 111, M17) — stop the run after the first failing test's final
   * (post-retry) verdict. Under `--workers > 1`, stops the pool from pulling new files; files
   * already in flight finish normally. */
  readonly bail: boolean;
  /** Raw `--format` text (PLAN decision 111, M17) — only `ndjson` is recognized for `run` (a
   * separate feature from `check --format json`, see decision 111.4). */
  readonly formatRaw?: string | undefined;
  /** `--no-timestamps` (PLAN decision 111, M17) — timestamps are on by default; this opts out,
   * symmetric to `--no-color`. */
  readonly noTimestamps: boolean;
  /** `--log-file <path>` (PLAN decision 111, M17) — duplicates console output to a file, always
   * plain text (ANSI stripped) regardless of stdout's own color state. */
  readonly logFile?: string | undefined;
  /** Raw `--browser` text (M3c, D11), validated in `runCommand` against `SUPPORTED_BROWSER_ENGINES`
   * — switches the whole run's browser steps to one engine (chromium default). Independent of
   * `tflw install-browsers --browser`'s own flag of the same name (that one just downloads a
   * binary; this one picks which already-downloaded binary a real run launches). */
  readonly browserRaw?: string | undefined;
  /** `--headed` (M3c) — headless by default; this opts into a visible browser window (only
   * meaningful locally, never in CI). */
  readonly headed: boolean;
  /** `--update-snapshots` (M4b, D15) — writes/overwrites `matches snapshot` baselines instead of
   * just comparing against them. Off by default, same as every prior milestone's behavior. */
  readonly updateSnapshots: boolean;
}

const EVIDENCE_LEVELS = ['full', 'headers-only', 'none'] as const;

function parseRunArgs(argv: string[]): RunArgs {
  const files: string[] = [];
  let env: string | undefined;
  let seedRaw: string | undefined;
  let nowRaw: string | undefined;
  let tagRaw: string | undefined;
  let only: string | undefined;
  let workersRaw: string | undefined;
  let noColor = false;
  let verbose = false;
  let forbidInsecure = false;
  let evidenceRaw: string | undefined;
  let failed = false;
  let bail = false;
  let formatRaw: string | undefined;
  let noTimestamps = false;
  let logFile: string | undefined;
  let browserRaw: string | undefined;
  let headed = false;
  let updateSnapshots = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a.startsWith('--env=')) env = a.slice('--env='.length);
    else if (a === '--seed') seedRaw = argv[++i];
    else if (a.startsWith('--seed=')) seedRaw = a.slice('--seed='.length);
    else if (a === '--now') nowRaw = argv[++i];
    else if (a.startsWith('--now=')) nowRaw = a.slice('--now='.length);
    else if (a === '--tag') tagRaw = argv[++i];
    else if (a.startsWith('--tag=')) tagRaw = a.slice('--tag='.length);
    else if (a === '--only') only = argv[++i];
    else if (a.startsWith('--only=')) only = a.slice('--only='.length);
    else if (a === '--workers') workersRaw = argv[++i];
    else if (a.startsWith('--workers=')) workersRaw = a.slice('--workers='.length);
    else if (a === '--no-color') noColor = true;
    else if (a === '--verbose') verbose = true;
    else if (a === '--forbid-insecure') forbidInsecure = true;
    else if (a === '--evidence') evidenceRaw = argv[++i];
    else if (a.startsWith('--evidence=')) evidenceRaw = a.slice('--evidence='.length);
    else if (a === '--failed') failed = true;
    else if (a === '--bail') bail = true;
    else if (a === '--format') formatRaw = argv[++i];
    else if (a.startsWith('--format=')) formatRaw = a.slice('--format='.length);
    else if (a === '--no-timestamps') noTimestamps = true;
    else if (a === '--log-file') logFile = argv[++i];
    else if (a.startsWith('--log-file=')) logFile = a.slice('--log-file='.length);
    else if (a === '--browser') browserRaw = argv[++i];
    else if (a.startsWith('--browser=')) browserRaw = a.slice('--browser='.length);
    else if (a === '--headed') headed = true;
    else if (a === '--update-snapshots') updateSnapshots = true;
    else files.push(a);
  }
  const tagList = tagRaw
    ?.split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const tags = tagList && tagList.length > 0 ? tagList : undefined;
  return {
    files,
    env,
    seedRaw,
    nowRaw,
    tags,
    only,
    workersRaw,
    noColor,
    verbose,
    forbidInsecure,
    evidenceRaw,
    failed,
    bail,
    formatRaw,
    noTimestamps,
    logFile,
    browserRaw,
    headed,
    updateSnapshots,
  };
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
 * lint-only, no execution, so it never needs real secrets or a live API, decision 75).
 *
 * `onFileDiagnostics`, when given, redirects a *per-file* diagnostic batch (the common case — a
 * syntax/checker error in the `.tflw` file itself, not `tflw.config`) to the callback instead of
 * `renderDiagnostics`+stderr — used only by `tflw check --format json` (decision 94) to recover
 * the structured `Diagnostic[]` for the one file it's checking. Config-level failures (a broken
 * `tflw.config`, an unknown session service) still print text and return an exit code the same as
 * always — out of scope for a per-file editor check, since they aren't this file's problem. */
async function loadAndValidate(
  cwd: string,
  filesArg: string[],
  envFlag: string | undefined,
  color: boolean,
  onFileDiagnostics?: (file: string, source: string, diagnostics: readonly Diagnostic[]) => void,
): Promise<ValidatedProject | number> {
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
    const requestDiags = checkRequestAssertions(parsed.program);
    const diagnostics = [...parsed.diagnostics, ...serviceDiags, ...tableDiags, ...sessionDiags, ...variableDiags, ...requestDiags];
    if (diagnostics.length > 0) {
      if (onFileDiagnostics) onFileDiagnostics(file, source, diagnostics);
      else process.stderr.write(renderDiagnostics(diagnostics, source, { filename: relative(cwd, file), color }) + '\n');
      hadErrors = true;
      continue;
    }
    parsedFiles.push({ file, source, program: parsed.program });
  }
  if (hadErrors) return EXIT_USAGE;

  return { resolved, parsedConfig, environ, parsedFiles };
}

/** `tflw watch`-only knobs (M5) — invisible to the real `tflw run` CLI path (`main()` always calls
 * `runCommand(rest)` with no second argument, so every existing behavior is unchanged by default).
 * `watchCommand` owns one `BrowserManager` for its whole session instead of letting each triggered
 * run construct (and unconditionally close) its own — `browserManager` lets it hand that one in;
 * `onBrowserManagerReady` lets it *capture* the manager the very first time (constructed here, the
 * only place that has `resolved.viewport` to build it with correctly) so every later iteration can
 * pass it back in; `keepBrowserOpen` skips the close this function would otherwise always do at the
 * end, since the whole point of `tflw watch` (SPEC §12) is a real browser window that outlives any
 * one run — including a failing one, so the author can inspect the live DOM. */
interface RunCommandWatchOptions {
  readonly browserManager?: BrowserManager;
  readonly onBrowserManagerReady?: (bm: BrowserManager) => void;
  readonly keepBrowserOpen?: boolean;
}

async function runCommand(argv: string[], watchOpts?: RunCommandWatchOptions): Promise<number> {
  const args = parseRunArgs(argv);
  const color = args.noColor ? false : process.stdout.isTTY === true;
  const cwd = process.cwd();
  const out = makeConsole(args.logFile);

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
  let evidenceArg: EvidenceLevel | undefined;
  if (args.evidenceRaw !== undefined) {
    if (!(EVIDENCE_LEVELS as readonly string[]).includes(args.evidenceRaw)) {
      err(`--evidence expects one of ${EVIDENCE_LEVELS.join(', ')}, got "${args.evidenceRaw}"`);
      return EXIT_USAGE;
    }
    evidenceArg = args.evidenceRaw as EvidenceLevel;
  }
  // `--format ndjson` (decision 111/M17) — a separate feature from `check --format json` (decision
  // 111.4), so `run` recognizes a different, single value.
  if (args.formatRaw !== undefined && args.formatRaw !== 'ndjson') {
    err(`unknown --format \`${args.formatRaw}\` — only \`ndjson\` is supported.`);
    return EXIT_USAGE;
  }
  const ndjsonActive = args.formatRaw === 'ndjson';

  // `--browser` (M3c, D11): chromium default, switches the *whole* run's browser steps to one
  // engine; no in-run matrix (CI matrixes three jobs instead, per D11).
  let browserEngine: BrowserEngine = 'chromium';
  if (args.browserRaw !== undefined) {
    if (!(SUPPORTED_BROWSER_ENGINES as readonly string[]).includes(args.browserRaw)) {
      err(`--browser expects one of ${SUPPORTED_BROWSER_ENGINES.join(', ')}, got "${args.browserRaw}"`);
      return EXIT_USAGE;
    }
    browserEngine = args.browserRaw as BrowserEngine;
  }

  const loaded = await loadAndValidate(cwd, args.files, args.env, color);
  if (typeof loaded === 'number') return loaded;
  const { parsedFiles, environ } = loaded;
  // `--evidence` overrides `tflw.config`'s `evidence` key for this run only (decision 101c);
  // `resolved` shadows `loaded.resolved` from here down so every downstream use (the `runProgram`
  // calls, the report write) sees the effective level with no separate threading needed.
  const resolved: ResolvedConfig = evidenceArg !== undefined ? { ...loaded.resolved, evidenceLevel: evidenceArg } : loaded.resolved;

  // `--forbid-insecure` (decision 101b): a CI policy gate — fail before any test runs, not partway
  // through, if `insecure true` is active for the env actually running.
  if (args.forbidInsecure && resolved.insecure) {
    err(`--forbid-insecure was set and env "${resolved.envName}" has \`insecure true\` active — refusing to run.`);
    return EXIT_USAGE;
  }

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

  // `tflw run --failed` (decision 111/M17): replay only the previous run's failing tests. Read
  // the prior state *before* this run's own write overwrites it. No state file, or a prior run
  // with zero failures: fall back to a full run with a note, matching pytest's `--lf` default
  // rather than erroring or silently running nothing (decision 111.2). Suppressed under
  // `--format ndjson` so stdout stays pure JSON lines (decision 111.4).
  let failedSet: Set<string> | undefined;
  if (args.failed) {
    const lastRun = await readLastRun(join(cwd, resolved.reportDir));
    if (lastRun && lastRun.failed.length > 0) {
      failedSet = new Set(lastRun.failed.map((f) => `${f.file}::${f.test}`));
    } else if (!ndjsonActive) {
      out.write(withTimestamps('no failed tests from the last run — running the full suite', !args.noTimestamps) + '\n');
    }
  }

  // Apply `--tag`/`--only`/`--failed` filtering once, up front — a file with no matching test is
  // dropped entirely; if *no* file anywhere has a match, that's a hard usage error, not a silent
  // green CI (P#46). `--tag` itself is OR across its comma-separated list (decision 97: a test
  // runs if it carries *any* listed tag); that OR-list then combines with `--only`/`--failed` as
  // AND, same as `--tag`/`--only` already combined before this.
  const runnable = parsedFiles
    .map(({ file, source, program: fileProgram }) => {
      const relFile = relative(cwd, file);
      return {
        file,
        source,
        program: {
          ...fileProgram,
          tests: fileProgram.tests
            .filter((t) => !args.tags || args.tags.some((tag) => t.tags.includes(tag)))
            .filter((t) => !args.only || t.name.value === args.only)
            .filter((t) => !failedSet || failedSet.has(`${relFile}::${t.name.value}`)),
        },
      };
    })
    .filter((f) => (!args.tags && !args.only && !failedSet) || f.program.tests.length > 0);
  if (args.tags && runnable.length === 0) {
    const tagList = args.tags.map((t) => `\`${t}\``).join(', ');
    err(`no test anywhere carries ${args.tags.length > 1 ? 'any of the tags' : 'the tag'} ${tagList}.`);
    return EXIT_USAGE;
  }
  if (args.only && runnable.length === 0) {
    err(`no test anywhere is named \`${args.only}\`.`);
    return EXIT_USAGE;
  }
  if (failedSet && runnable.length === 0) {
    err('none of the previously-failed tests were found in the current suite — did the files change since the last run?');
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
  const githubActions = process.env.GITHUB_ACTIONS === 'true';
  const timestamps = !args.noTimestamps;

  // Console output (P#4/#5's event stream, consumed here — never the report's data source,
  // decision 86). `--format ndjson` (decision 111/M17) replaces all of this with a pure,
  // file-tagged JSON-line stream instead of human text — safe to pipe straight into a log
  // aggregator or `jq`, and needs no per-file buffering under `--workers > 1` since every line is
  // self-contained (unlike human text, which can't otherwise be told apart across concurrent
  // files — see `withFileTag`). Otherwise: the shared ticker always runs — a failing test's diff
  // is surfaced live unconditionally (not gated on an interactive TTY or `--verbose`), while a
  // passing test's tick line stays gated on `color`/`--verbose` so a plain CI/piped run stays
  // exactly as terse as before on green suites (see `formatEvent`). `--verbose` additionally
  // needs per-step lines, which under `--workers > 1` would interleave illegibly across
  // concurrent files in the human renderer — so in that combination each file gets its own
  // buffered sink instead, flushed as one contiguous block once that file finishes, and the
  // shared live sink is skipped entirely.
  const useBufferedVerbose = !ndjsonActive && args.verbose && workers > 1;
  const sharedHumanEmit = !ndjsonActive && !useBufferedVerbose ? liveEmit(out, color, args.verbose, githubActions, timestamps) : undefined;
  const ndjsonCollected: RunEvent[] = [];
  const sharedNdjsonEmit = ndjsonActive ? ndjsonEmit(out, ndjsonCollected) : undefined;

  // One shared browser process for the whole invocation (M3a, D13) — lazily launched on the first
  // browser step anywhere in the run; closed unconditionally below even if nothing ever used it —
  // unless `watchOpts` says otherwise (M5, `RunCommandWatchOptions` above). Engine (`--browser`,
  // D11) and headed mode (`--headed`, M3c) are run-level, resolved once here; `viewport` comes from
  // `tflw.config` (M3c).
  const browserManager = watchOpts?.browserManager ?? new BrowserManager({ engine: browserEngine, headless: !args.headed, viewport: resolved.viewport });
  watchOpts?.onBrowserManagerReady?.(browserManager);

  const reports = await runWithConcurrency(
    runnable,
    workers,
    async ({ file, source, program }, i) => {
      const fileLabel = relative(cwd, file);
      const buffered = useBufferedVerbose ? bufferedEmit(out, color, args.verbose, githubActions, timestamps) : undefined;
      const rawSink = buffered?.sink ?? sharedHumanEmit ?? sharedNdjsonEmit;
      const fileEmit = rawSink ? withFileTag(rawSink, fileLabel) : undefined;
      try {
        const { report } = await runProgram(program, resolved, {
          source,
          baseDir: dirname(file),
          environ,
          redactor,
          sessionCache,
          browserManager,
          seed,
          now,
          uniqueSeq,
          testIndexOffset: offsets[i]!,
          sessionSpliceOwners,
          filePath: fileLabel,
          updateSnapshots: args.updateSnapshots,
          ...(fileEmit ? { emit: fileEmit } : {}),
        });
        buffered?.flush();
        // Stamp each test with the relative file it came from (report.html's per-file grouping,
        // decision 92) — done here, once, after the fact. `filePath` above is a *separate* threading
        // of the same relative label: `RunOptions.filePath` is needed live, during execution, for a
        // `matches snapshot` step's `snapshots/<file>/…` path (M4b) — this stamp remains the
        // display-only one `report.tests[].file` has always been, kept as its own assignment rather
        // than merged into the two so neither concern's rationale gets confused for the other's.
        return { ...report, tests: report.tests.map((t) => ({ ...t, file: fileLabel })) };
      } catch (e) {
        buffered?.flush();
        // A runtime throw in this file (e.g. a bad `import`/`use` path) must never sink the whole
        // run silently — other files' reports still get merged and written (P#46: "always write
        // the report for tests that ran").
        const message = e instanceof Error ? e.message : String(e);
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
    },
    // `--bail` (decision 111/M17): stop pulling new files once any in-flight one reports a
    // failure. `TestResult.ok` is already the final, post-retry verdict (same one `flaky` uses),
    // so a mid-retry failing attempt never trips this early.
    args.bail ? (r: RunReport) => !r.ok : undefined,
  );

  // 6. Merge reports, write report.html + junit.xml + results.json (decision 111.1) +
  //    .last-run.json (decision 111.2, always overwritten — unconditional, not just under
  //    --failed) + events.ndjson (decision 111.4, only under --format ndjson), print the summary.
  //    A second full-report redaction pass (decision 56) here — on top of the one each
  //    `runProgram` call already did on its own file's report — closes the *cross-file* half of
  //    the ordering window: a secret first registered by one file (e.g. running later, or
  //    concurrently under `--workers`) can still retroactively mask an earlier file's
  //    already-built report once everything is merged.
  const merged = redactReport(mergeReports(reports, resolved.envName, seed, now, resolved.insecure, browserEngine), redactor);
  const reportDir = join(cwd, resolved.reportDir);
  const outPath = await writeReport(merged, reportDir);
  await writeJunitXml(merged, reportDir);
  await writeResultsJson(merged, reportDir);
  await writeLastRun(merged, reportDir);
  if (ndjsonActive) await writeEventsNdjson(ndjsonCollected, reportDir);

  if (!ndjsonActive) {
    out.write(withTimestamps('\n' + renderCliSummary(merged, color), timestamps) + '\n');
    out.write(withTimestamps(`\n${dim(color, 'report:')} ${relative(cwd, outPath)}`, timestamps) + '\n');
  }
  await out.save();
  if (!watchOpts?.keepBrowserOpen) await browserManager.close(); // no-op if no test in this run ever used a browser step

  return merged.ok ? EXIT_OK : EXIT_FAIL;
}

// ---- tflw check -------------------------------------------------------------

interface CheckArgs {
  readonly files: string[];
  readonly env?: string | undefined;
  readonly noColor: boolean;
  /** `--format json` (decision 94) — only `json` is recognized; anything else is a usage error. */
  readonly format?: string | undefined;
}

function parseCheckArgs(argv: string[]): CheckArgs {
  const files: string[] = [];
  let env: string | undefined;
  let noColor = false;
  let format: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = argv[++i];
    else if (a.startsWith('--env=')) env = a.slice('--env='.length);
    else if (a === '--no-color') noColor = true;
    else if (a === '--format') format = argv[++i];
    else if (a.startsWith('--format=')) format = a.slice('--format='.length);
    else files.push(a);
  }
  return { files, env, noColor, format };
}

/** Validate-only: the exact same parse+checker pipeline `tflw run` runs before it executes
 * anything (decision 75) — teaching diagnostics, no HTTP traffic, no secrets required. For CI/
 * pre-commit: lint a suite without touching a live API. */
async function checkCommand(argv: string[]): Promise<number> {
  const args = parseCheckArgs(argv);
  const cwd = process.cwd();

  if (args.format !== undefined && args.format !== 'json') {
    err(`unknown --format \`${args.format}\` — only \`json\` is supported.`);
    return EXIT_USAGE;
  }

  if (args.format === 'json') {
    // Structured output for the VS Code extension (decision 94): redirect the target file's own
    // diagnostics into `collected` instead of stderr text. Config-level failures (broken
    // tflw.config, unknown session service) still print text to stderr and return exit 2 as
    // always — out of scope for a per-file editor check.
    const collected: Diagnostic[] = [];
    const loaded = await loadAndValidate(cwd, args.files, args.env, false, (_file, _source, diagnostics) => {
      collected.push(...diagnostics);
    });
    process.stdout.write(JSON.stringify(collected) + '\n');
    return typeof loaded === 'number' ? loaded : EXIT_OK;
  }

  const color = args.noColor ? false : process.stdout.isTTY === true;
  const loaded = await loadAndValidate(cwd, args.files, args.env, color);
  if (typeof loaded === 'number') return loaded;

  const n = loaded.parsedFiles.length;
  process.stdout.write(`${n} file${n === 1 ? '' : 's'} checked, no problems found.\n`);

  // The reuse pass (M6, P#2) — advisory only, never affects the exit code: `tflw check` already
  // established every file is individually clean, and a reuse hint is a suggestion, not a defect.
  // Scanned over exactly the file set this invocation checked (`--format json` skips this — it's a
  // per-file editor-diagnostics contract, decision 94, not the right shape for a suite-wide hint).
  const entries: SuiteEntry[] = loaded.parsedFiles.map((f) => ({ path: relative(cwd, f.file), source: f.source, program: f.program }));
  const hints = detectReuse(entries);
  if (hints.length > 0) {
    process.stdout.write(`\n${hints.length} reuse ${hints.length === 1 ? 'hint' : 'hints'} found (P#2) — apply with \`tflw refactor apply <id>\`:\n\n`);
    process.stdout.write(hints.map((h) => h.diffPreview).join('\n\n') + '\n');
  }

  return EXIT_OK;
}

// ---- tflw refactor apply <id> (M6, P#2, SPEC §12) --------------------------

/** POSIX-separated relative import path from `fromDir` to `toFileAbs`, always `./`- or `../`-
 * prefixed — matches the `import "./shared/x.tflw"` shape every hand-written import already uses
 * (SPEC §8). */
function toImportPath(fromDir: string, toFileAbs: string): string {
  const rel = relative(fromDir, toFileAbs).split('\\').join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Apply one reuse-pass extraction (P#2): re-run the same deterministic detection `tflw check`
 * would over the whole default suite (no `[files]` argument here — SPEC §12's table gives this
 * command exactly one positional, `<id>`), find the hint with that id, write its extracted
 * `action` into a fresh `shared/<name>.tflw`, and rewrite every occurrence's call site in place.
 * Builds never mutate source (P#2) — only this explicit, user-invoked command does.
 */
async function refactorCommand(argv: string[]): Promise<number> {
  const [sub, id, ...rest] = argv;
  if (sub !== 'apply' || !id || rest.length > 0) {
    err('usage: tflw refactor apply <id>  (e.g. `tflw refactor apply RF001` — run `tflw check` first to see current hint ids)');
    return EXIT_USAGE;
  }

  const cwd = process.cwd();
  const color = process.stdout.isTTY === true;
  const loaded = await loadAndValidate(cwd, [], undefined, color);
  if (typeof loaded === 'number') return loaded;

  const entries: SuiteEntry[] = loaded.parsedFiles.map((f) => ({ path: relative(cwd, f.file), source: f.source, program: f.program }));
  const hints = detectReuse(entries);
  const hint = hints.find((h) => h.id === id);
  if (!hint) {
    const available = hints.map((h) => h.id).join(', ') || '(none)';
    err(`no reuse hint \`${id}\` found. Run \`tflw check\` for current ids (they can shift as the suite changes) — available right now: ${available}.`);
    return EXIT_USAGE;
  }

  const actionFileAbs = join(cwd, hint.actionFile);
  if (await exists(actionFileAbs)) {
    err(`\`${hint.actionFile}\` already exists — remove it or rename the conflicting file, then re-run \`tflw check\` for fresh ids.`);
    return EXIT_USAGE;
  }

  const byPath = new Map<string, ReuseOccurrence[]>();
  for (const occ of hint.occurrences) {
    const list = byPath.get(occ.path) ?? [];
    list.push(occ);
    byPath.set(occ.path, list);
  }

  const changedFiles: string[] = [];
  for (const [path, occs] of byPath) {
    const abs = join(cwd, path);
    const parsedFile = loaded.parsedFiles.find((f) => f.file === abs)!;
    let source = parsedFile.source;

    const edits: { start: number; end: number; text: string }[] = occs.map((occ) => renderCallSiteReplacement(hint.actionName, occ, source));
    const importPath = toImportPath(dirname(abs), actionFileAbs);
    const alreadyImported = parsedFile.program.imports.some((imp) => imp.path.value === importPath);
    if (!alreadyImported) {
      const at = importInsertionOffset(parsedFile.program, source);
      edits.push({ start: at, end: at, text: `import "${importPath}"\n` });
    }

    // Apply widest-first (descending start) so an earlier edit's offset shift never invalidates a
    // later one still expressed in terms of the *original* source.
    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) source = source.slice(0, e.start) + e.text + source.slice(e.end);

    await writeFile(abs, source, 'utf8');
    changedFiles.push(path);
  }

  await mkdir(dirname(actionFileAbs), { recursive: true });
  await writeFile(actionFileAbs, hint.actionSource, 'utf8');

  process.stdout.write(`applied ${hint.id}: extracted \`action ${hint.actionName}(${hint.params.join(', ')})\` into ${hint.actionFile}\n`);
  process.stdout.write(`  updated: ${changedFiles.sort().join(', ')}\n`);
  return EXIT_OK;
}

// ---- tflw docs --------------------------------------------------------------

/** A quick-reference cheatsheet, generated at `npm prepack`/`pack` time from SPEC.md (decision
 * 93) — a static, bundled artifact (`docs-data.generated.ts`, not committed, regenerated by
 * `scripts/gen-docs.mjs`) rather than a live parse at runtime, since SPEC.md itself isn't shipped
 * in the published npm package. No args lists every topic; a topic name prints that section's
 * SPEC.md content (P#/gap-tracking references stripped, kept human-readable). */
async function docsCommand(argv: string[]): Promise<number> {
  const [topic] = argv;
  const topics = Object.keys(DOCS_TOPICS).sort();

  if (topic === undefined) {
    process.stdout.write(`tflw docs <topic> — print a SPEC.md cheatsheet section. Topics:\n\n`);
    for (const t of topics) process.stdout.write(`  ${t}\n`);
    process.stdout.write(`\nrun \`tflw docs <topic>\` to read one, e.g. \`tflw docs matchers\`.\n`);
    return EXIT_OK;
  }

  const entry = DOCS_TOPICS[topic];
  if (!entry) {
    const hint = suggest(topic, topics);
    err(`unknown docs topic \`${topic}\`.${hint ? ` Did you mean \`${hint}\`?` : ''} Run \`tflw docs\` to list every topic.`);
    return EXIT_USAGE;
  }

  process.stdout.write(`${entry.title}\n${'='.repeat(entry.title.length)}\n\n${entry.body}\n`);
  return EXIT_OK;
}

// ---- tflw lsp ---------------------------------------------------------------

/** Speaks the Language Server Protocol over stdio (PLAN_M13_LSP.md Phase 4) — how an editor (VS
 * Code's `LanguageClient`, decision 17.2/17.4) reaches `@tflw/lsp-server`: spawn `tflw lsp` as a
 * child process and talk JSON-RPC over its stdin/stdout. `startServer()` wires every handler
 * synchronously and returns immediately, so this command must not let `main()`'s own
 * `.then((code) => process.exit(code))` run right after — the returned promise simply never
 * resolves, keeping the process alive for as long as the connection is open. Process termination
 * itself isn't this command's job: `vscode-languageserver`'s `createConnection()` (reached via
 * `startServer()`) already registers `end`/`close` handlers directly on the input stream and calls
 * `process.exit()` itself once the client disconnects — 0 after a clean LSP `shutdown` request +
 * `exit` notification handshake, 1 on an abrupt pipe close — so any exit-handling wired up here
 * would just race it and lose. */
async function lspCommand(_argv: string[]): Promise<number> {
  startServer();
  return new Promise<number>(() => {});
}

/**
 * Run `items` with at most `limit` in flight at once, preserving each result at its original
 * index regardless of completion order (P#47: in-process promise pool, per-file granularity — a
 * file itself always runs sequentially inside, only *different* files run concurrently).
 *
 * `shouldBail`, when given, is checked after every result — once it returns `true` the pool stops
 * *pulling new items*, but any file already claimed by a worker still runs to completion (PLAN
 * decision 111/M17, `--bail` under `--workers > 1`: no hard-abort/cancellation-token plumbing into
 * `runProgram`, just stop starting new work). Items never claimed are simply absent from the
 * returned array, not `undefined` holes.
 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldBail?: (result: R) => boolean,
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;
  let bailed = false;
  async function runNext(): Promise<void> {
    for (;;) {
      if (bailed) return;
      const i = next++;
      if (i >= items.length) return;
      const r = await worker(items[i]!, i);
      results[i] = r;
      if (shouldBail?.(r)) bailed = true;
    }
  }
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runNext()));
  return results.filter((r): r is R => r !== undefined);
}

/** Combine per-file reports into one run report, in original file order regardless of the
 * per-file worker concurrency that produced them (P#47). */
function mergeReports(reports: readonly RunReport[], envName: string, seed: number, now: string, insecure: boolean, browserEngine: BrowserEngine): RunReport {
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
    browserEngine,
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
 * `durationMs` — no new computation.
 *
 * `githubActions` (PLAN decision 111/M17): wraps a test's block in `::group::`/`::endgroup::` —
 * only when `verbose` is also on, since non-verbose mode is already one line per test and folding
 * a single line adds a click-to-expand around nothing worth folding (decision 111.8). Not a GitHub
 * annotation (`::error::`) — pure log folding, a different mechanism from the "no GitHub
 * annotations" scope boundary decision 7 already drew. */
function formatEvent(ev: RunEvent, color: boolean, verbose: boolean, githubActions: boolean): string | undefined {
  const grouping = verbose && githubActions;
  if (verbose && ev.type === 'test:start') return grouping ? `::group::${ev.name}` : ev.name;
  if (verbose && ev.type === 'step:end') {
    const label = ev.step.detail ?? ev.step.kind;
    return `  ${tick(color, ev.step.ok)} ${label} (${ev.step.durationMs}ms)`;
  }
  if (ev.type === 'test:end') {
    const durSuffix = verbose ? ` (${ev.result.durationMs}ms)` : '';
    const closeGroup = grouping ? '\n::endgroup::' : '';
    if (!ev.result.ok) {
      // Always surfaced, live, regardless of `--verbose`/TTY color — a failing test's diff
      // shouldn't require an interactive terminal or opening report.html to see (the CLI
      // ergonomics ask this track exists for).
      const lines = [`${tick(color, false)} ${ev.result.name}${durSuffix}`];
      for (const step of ev.result.steps) {
        if (!step.ok && step.detail) lines.push(`    ${step.detail}`);
      }
      return lines.join('\n') + closeGroup;
    }
    // A passing test's tick line is cosmetic — keep it gated on `color` (today's existing
    // interactive-only ticker) or `--verbose`, so a plain CI/piped green run stays exactly as
    // terse as before.
    if (verbose || color) return `${tick(color, true)} ${ev.result.name}${durSuffix}${closeGroup}`;
    return undefined;
  }
  return undefined;
}

/** `HH:MM:SS.mmm` wall-clock — compact, easy to eyeball-correlate against another log stream open
 * side by side (PLAN decision 111/M17). Not full ISO 8601: that only earns its noise when
 * correlating against another *service's* structured logs, not a stated need here. */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Prefixes every physical line of a (possibly multi-line, e.g. a failing test's block) console
 * block with the same instant — the block corresponds to one event that happened once, so one
 * timestamp captured for the whole block, not recomputed per line (PLAN decision 111/M17, on by
 * default; `--no-timestamps` opts out, symmetric to `--no-color`). */
function withTimestamps(block: string, enabled: boolean): string {
  if (!enabled) return block;
  const ts = timestamp();
  // A blank spacer line (report.html summary's blank line before the final tally, or the leading
  // `\n` before the "report:" line) gets no bare timestamp — there's no content to correlate.
  return block
    .split('\n')
    .map((l) => (l.length === 0 ? l : `${ts} ${l}`))
    .join('\n');
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** `--log-file` always writes plain text regardless of stdout's own color state (PLAN decision
 * 111/M17) — a log file with raw ANSI escape codes isn't readable in a plain editor/grep. */
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** Every piece of `tflw run`'s console output goes through this one write path so `--log-file`
 * (PLAN decision 111/M17) can mirror it — always plain text, independent of what stdout itself is
 * doing. Buffers the whole run's output in memory rather than streaming to the file: a run's
 * console output is never large enough to justify a real file stream, and this keeps ordering
 * trivially correct without a second I/O lifecycle to manage. */
function makeConsole(logFile: string | undefined): { write: (text: string) => void; save: () => Promise<void> } {
  const chunks: string[] = [];
  return {
    write(text: string) {
      process.stdout.write(text);
      if (logFile !== undefined) chunks.push(stripAnsi(text));
    },
    async save() {
      if (logFile !== undefined) await writeFile(logFile, chunks.join(''), 'utf8');
    },
  };
}

/** Tags every event a file's `runProgram` call emits with that file's relative path before it
 * reaches any real sink (PLAN decision 111/M17) — `runProgram` itself stays unaware of `file`,
 * same "display concern, stamped by the CLI" precedent as `TestResult.file`. */
function withFileTag(sink: EventSink, file: string): EventSink {
  return (ev) => sink({ ...ev, file });
}

/** The default live ticker: writes straight to stdout as events arrive. Safe to share across every
 * concurrently-running file when `--verbose` is off (only `test:end` prints, and today's existing
 * cross-file interleaving of those lines is pre-existing, unchanged behavior) — but never used for
 * verbose output under `--workers > 1`, see `bufferedEmit` below. */
function liveEmit(out: { write: (text: string) => void }, color: boolean, verbose: boolean, githubActions: boolean, timestamps: boolean): EventSink {
  return (ev) => {
    const line = formatEvent(ev, color, verbose, githubActions);
    if (line !== undefined) out.write(withTimestamps(line, timestamps) + '\n');
  };
}

/** One buffered sink per concurrently-running file: collects its formatted lines instead of
 * writing them, so `flush()` (called once that file's `runProgram` resolves) prints them as a
 * single contiguous block — concurrent files' verbose step logs can never interleave line-by-line. */
function bufferedEmit(
  out: { write: (text: string) => void },
  color: boolean,
  verbose: boolean,
  githubActions: boolean,
  timestamps: boolean,
): { sink: EventSink; flush: () => void } {
  const lines: string[] = [];
  const sink: EventSink = (ev) => {
    const line = formatEvent(ev, color, verbose, githubActions);
    if (line !== undefined) lines.push(withTimestamps(line, timestamps));
  };
  return {
    sink,
    flush: () => {
      if (lines.length > 0) out.write(lines.join('\n') + '\n');
    },
  };
}

/** `--format ndjson` (PLAN decision 111/M17): every `RunEvent` (already file-tagged), one JSON
 * line per event, always full detail regardless of `--verbose` — "how much to show a human" and
 * "what the machine event stream contains" are different concerns. Safe to share unbuffered across
 * concurrent files unlike the human ticker: each line is self-contained, so interleaving across
 * `--workers > 1` needs no special-casing the way verbose human text does. `collected` also feeds
 * `report/events.ndjson` (decision 111.4 — a permanent artifact, not just a live stream). */
function ndjsonEmit(out: { write: (text: string) => void }, collected: RunEvent[]): EventSink {
  return (ev) => {
    collected.push(ev);
    out.write(JSON.stringify(ev) + '\n');
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
      '  tflw run [files...] [--env <name>] [--seed <n>] [--now <iso>] [--tag <name>[,<name>...]] [--only <name>] [--workers <n>] [--no-color] [--verbose]',
      '            [--failed] [--bail] [--format ndjson] [--no-timestamps] [--log-file <path>] [--browser chromium|firefox|webkit] [--headed] [--update-snapshots]',
      '                                                      run .tflw tests (default: all under cwd)',
      '                                                      --now replays the exact run-clock instant',
      '                                                      alongside --seed, e.g. --seed 42 --now 2026-07-06T00:00:00Z',
      '                                                      --verbose prints one line per step, not just per test',
      '                                                      --only runs a single test by its exact declared name',
      '                                                      --tag a,b runs a test carrying any of the listed tags (OR)',
      '                                                      --failed re-runs only the previous run\'s failing tests',
      '                                                      --bail stops after the first failing test',
      '                                                      --format ndjson streams the event log as JSON lines',
      '                                                      --log-file <path> duplicates console output to a file (plain text)',
      '                                                      --browser switches every browser step to one engine (default chromium)',
      '                                                      --headed shows the browser window instead of running headless',
      '                                                      --update-snapshots writes/overwrites `matches snapshot` baselines (SPEC §9.9)',
      '                                                      always written: report/{report.html,junit.xml,results.json,.last-run.json}',
      '                                                      also written when a browser run has one: report/assets/{screenshots,traces}/',
      '  tflw check [files...] [--env <name>] [--no-color] [--format json]',
      '                                                      validate only — no execution, no secrets needed;',
      '                                                      --format json is for editor integrations (VS Code)',
      '  tflw init                                          scaffold tflw.config + example.tflw',
      '  tflw docs [topic]                                  print a SPEC.md cheatsheet section; no topic lists them all',
      '  tflw lsp                                           run the Language Server over stdio (for editor integrations)',
      '  tflw install-browsers [--browser chromium|firefox|webkit]',
      '                                                      download a browser binary for UI steps (SPEC §9); default chromium',
      '  tflw pick <url> [--browser chromium|firefox|webkit]',
      '                                                      click an element in a real browser window, print its best locator (SPEC §12, M5);',
      '                                                      runs until the window is closed or Ctrl+C — <url> must be absolute',
      '  tflw watch [files...] [--env <name>] [--seed <n>] [--browser chromium|firefox|webkit] [--no-color]',
      '                                                      re-run headed on every save, one browser window for the whole session (SPEC §12, M5);',
      '                                                      saving tflw.config re-runs everything; runs until Ctrl+C',
      '  tflw refactor apply <id>                           apply a reuse-pass extraction (SPEC §8/§12, M6);',
      '                                                      `tflw check` prints available ids (RF001, RF002, …) alongside its diagnostics',
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
