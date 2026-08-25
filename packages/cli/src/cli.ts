#!/usr/bin/env node
// testFlow CLI (M1): `tflw run` and `tflw init`. Browser steps (M3), `tflw pick`/`tflw watch` (M5),
// and the reuse-pass `tflw refactor apply` (M6) followed.
//
// `tflw run` pipeline (SPEC §2–3, §13):
//   read tflw.config → parseConfigSource → selectEnv → resolveConfig
//   → buildEnviron (.env overlaid by real env) → missingRequiredEnv gate
//   → for each .tflw: parseSource (abort on diagnostics) → runProgram (shared Redactor)
//   → writeReport(report.html) + writeJunitXml + renderCliSummary → exit code (0 pass / 1 test failure / 2 usage).

import { readFile, readdir, writeFile, access, mkdir, stat } from 'node:fs/promises';
import { watch as fsWatch, existsSync, readFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
// M92b (`B6-09`) — `install-browsers` resolves the consumer's own `playwright` instead of letting
// `npx --yes` fetch an unpinned one from the registry.
import { createRequire } from 'node:module';
import { join, resolve, relative, dirname, basename } from 'node:path';
import {
  parseSource,
  parseConfigSource,
  renderDiagnostics,
  checkProgram,
  checkSessionBody,
  checkAllowHostsCoversBaseUrls,
  identityCensus,
  suggest,
  detectReuse,
  renderCallSiteReplacement,
  importInsertionOffset,
  collectMigrations,
  applyMigrations,
  CLI_FLAGS,
  SPEC_MANIFEST_VERSION,
  specConstructs,
  type Program,
  type Diagnostic,
  type EvidenceLevel,
  type FindingSeverity,
  type LogDestination,
  type LogLevel,
  type SuiteEntry,
  type ReuseOccurrence,
  type TestDecl,
  type Workload,
} from '@tflw/lang';
import {
  runProgram,
  type ReproSink,
  type ReproSubject,
  type ScanDecline,
  parseBaseline,
  renderBaseline,
  staleBaselineEntries,
  MAX_SEEDED_PER_CLASS,
  type ScanFinding,
  type ScanGate,
  type ScanKind,
  type ScanRuleCensus,
  type ScanSink,
  resolveImportedActions,
  resolveMissingFiles,
  checkConfigFiles,
  type ReadText,
  type PathExists,
  runLoadShard,
  mergeLoadShardReports,
  spliceLoadReportIntoRunReport,
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
  redactEvent,
  redactReport,
  SessionCache,
  TlsProber,
  BrowserManager,
  SUPPORTED_BROWSER_ENGINES,
  LOG_LEVEL_ORDER,
  startPickSession,
  mergeSelfDiagnosis,
  finalizeVerdict,
  shutdownMtlsWorker,
  workloadOf,
  type BrowserEngine,
  type RunReport,
  type TestResult,
  type ReportEntry,
  type EventSink,
  type RunEvent,
  type StepResult,
  type ResolvedConfig,
  type PickSessionHandle,
  type LoadShardResult,
  type LoadProgressSnapshot,
  type AuthorizedTarget,
  type SelfDiagnosis,
} from '@tflw/runtime';
import { spawn, fork, type ChildProcess } from 'node:child_process';
import {
  writeReport,
  writeRepros,
  writeJunitXml,
  writeResultsJson,
  writeSarif,
  writeLastRun,
  readLastRun,
  describeRunFilter,
  writeEventsNdjson,
  renderCliSummary,
  describeWorkload,
} from '@tflw/reporter';
import { startServer } from '@tflw/lsp-server';
import { buildEnviron } from './env.js';
import { DOCS_TOPICS } from './docs-data.generated.js';
import { renderTopicIndex } from './docs-index.js';
import {
  DEMO_BASE_URL,
  demoServiceChild,
  startDemoService,
  usesDemoService,
  withDemoBaseUrls,
  type DemoService,
} from './demo-service.js';

const EXIT_OK = 0;
const EXIT_FAIL = 1; // a test failed
const EXIT_USAGE = 2; // usage / config / parse error — could not run
const EXIT_INCONCLUSIVE = 3; // M32/R11 — a `tflw run` with workload-bearing tests only: the
// generator itself saturated, so the measured numbers don't describe the system under test. Takes
// priority over pass/fail — CI must not read an unmeasurable run as "system passed" (or "failed").
const EXIT_ABORTED = 130; // M32/R5 — Ctrl-C during a `tflw run` with workload-bearing tests; the
// standard Unix "died from SIGINT" code (128+2), same convention `tflw watch`'s own SIGINT
// handling documents.

// Set via esbuild `--define` at bundle time (packages/cli/scripts/bundle.mjs, decision 74b) to the
// real package.json version. Undefined under `npm run dev` (unbundled `tsx`), where `getVersion()`
// falls back to reading package.json directly.
declare const __TFLW_VERSION__: string | undefined;

// M154a — the rest of the build stamp `tflw spec` prints, injected by the same `define` mechanism
// and undefined for the same reason under `npm run dev`. `__TFLW_COMMIT__` is the empty string when
// the bundle was built somewhere with no git to ask (a published tarball); `buildStamp()` maps that
// to `null` rather than letting an empty sha look like an answer.
declare const __TFLW_COMMIT__: string | undefined;
declare const __TFLW_DIRTY__: boolean | null | undefined;
declare const __TFLW_BUILD_TIME__: string | undefined;

/** M92c (review `FU-17`) — user-facing surfaces cite `SPEC.md` and its §-numbers, and `SPEC.md` is
 * not in the npm tarball: `docs-data.generated.ts` is cut from it at build time and *is* what ships.
 * The citations are worth keeping — they say where a section came from — but a reader who wants the
 * source had nowhere to go. One constant so the address is stated identically wherever it appears. */
const SPEC_URL = 'https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md';

async function getVersion(): Promise<string> {
  if (typeof __TFLW_VERSION__ === 'string') return __TFLW_VERSION__;
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * Reads the value of a value-taking flag, and refuses the two ways one can go missing silently
 * (M63, review finding A12-04). A bare `argv[++i]` returns `undefined` past the end of argv, and
 * happily swallows the *next flag* otherwise — both without a word. That is a bad default for any
 * flag, and an actively unsafe one for `--evidence`, where a lost argument (a CI YAML fold, a
 * shell-quoting slip) silently ran at `full`, the *least* protective level, and left the pipeline
 * green. Every value-taking flag in every subcommand goes through here, so the rule belongs to the
 * flag, not to one flag.
 *
 * Only `--`-prefixed tokens are rejected as values: a single `-` can legitimately begin one (a
 * negative `--seed`, a `-`-prefixed `--only` name), and `--flag=value` — which never reaches this
 * function — is the escape hatch for a value that really does start with `--`.
 *
 * Thrown, not returned: the top-level `.catch` around `main` already prints `error: <message>` and
 * exits `EXIT_USAGE`, the same shape as every other usage error here.
 */
function flagValue(argv: string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) throw new Error(`${flag} expects a value, but none was given.`);
  if (value.startsWith('--')) throw new Error(`${flag} expects a value, but the next argument is \`${value}\`. Write \`${flag}=${value}\` if that really is the value you meant.`);
  requireNonEmpty(value, flag);
  return value;
}

/**
 * Reads the value out of the `--flag=value` spelling, which never reaches `flagValue` — it is that
 * function's documented escape hatch for a value starting with `--`, so it deliberately skips the
 * next-argument check. It must not skip the *empty* check: `--tag=` and `--tag ""` are the same
 * mistake wearing different quotes (M70, review finding B6-01).
 */
function inlineFlagValue(arg: string, flag: string): string {
  const value = arg.slice(flag.length + 1);
  requireNonEmpty(value, flag);
  return value;
}

/**
 * The third way a flag's value goes missing without a word (M70, B6-01), after M63 closed the two
 * in `flagValue`: the value is *present and empty*. `--tag=` and `--only=` were the dangerous pair
 * — every downstream guard tests them for truthiness (`!args.tags`, `args.only && …`), so an empty
 * string was indistinguishable from the flag not being passed at all, and the run quietly widened
 * from the requested subset to **the entire suite**, exit 0. `--tag nope` errors; `--tag ""` ran
 * everything. Nobody types that by hand — a shell interpolates it (`tflw run --tag "$SUITE_TAGS"`
 * with the variable unset), which is precisely why no test constructed it and why CI is where it
 * bites.
 *
 * Applied to every value-taking flag rather than to those two, on the same reasoning as
 * `flagValue`: no flag here has a meaningful empty value, and an empty `--env`/`--browser`/
 * `--format` would silently fall back to a default in exactly the same shape.
 */
function requireNonEmpty(value: string, flag: string): void {
  if (value.trim() !== '') return;
  throw new Error(
    `${flag} was given an empty value.\n` +
      `  an empty value is not the same as omitting ${flag} — it asks for nothing, so tflw refuses it rather than silently running everything.\n` +
      `  if this came from a shell variable (\`${flag} "$VAR"\`), the variable is unset or empty: set it, or drop the flag.`,
  );
}

/**
 * An unrecognised `--flag` used to be pushed into the file list and surface, several layers later,
 * as a raw Node `ENOENT` naming an absolute path that does not exist — `tflw run --verbos` reported
 * a missing *file* called `--verbos`, and `tflw init --lod` scaffolded silently without the thing
 * the flag asked for (M61, review finding B6-11). A mistyped flag is the most ordinary mistake
 * there is, in a tool whose stated pillar is teaching diagnostics and which already does exactly
 * this for `tflw docs <topic>`.
 *
 * **Rejection needs no list.** A `--`-prefixed token that reaches the fall-through branch of a
 * parser's `if/else` chain is, by construction, one that parser does not know — so there is no
 * second enumeration of accepted flags to drift out of step with the first. Only the *suggestion*
 * needs names, and those come from `CLI_FLAGS`, which `tflw --help` and the docs-site reference
 * page are both already checked against in both directions (`e2e.test.ts`). Single-dash tokens are
 * left alone deliberately, matching `flagValue`: a `-`-prefixed value is legitimate here.
 *
 * Thrown, like every other usage error in this file, so `main`'s `.catch` prints `error: …` and
 * exits `EXIT_USAGE`.
 */
function unknownFlag(command: string, arg: string): never {
  const name = arg.split('=')[0]!;
  const known = CLI_FLAGS.filter((f) => f.command === command || f.command === 'global').flatMap((f) => [...f.flag.matchAll(/(--[a-z][a-z-]*)/g)].map((m) => m[1]!));
  const hint = suggest(name, known);
  throw new Error(
    `unknown flag \`${name}\` for \`tflw ${command}\`.` +
      (hint ? `\n  did you mean \`${hint}\`?` : '') +
      `\n  run \`tflw --help\` for every flag \`tflw ${command}\` takes.`,
  );
}

/**
 * `unknownFlag`'s other half. Every parser's fall-through branch splits two ways — a `--`-prefixed
 * token, which M61 made a usage error, and everything else, which went into the file list
 * unexamined. So the second half kept the whole of the original defect (review finding `B6-11`,
 * cluster C5): the file list is `readFile`d several layers later, and a mistyped path surfaced as a
 * raw Node `ENOENT` naming an absolute path that does not exist, a directory as `EISDIR: illegal
 * operation on a directory, read` — which does not name the directory at all — and `tflw run
 * tflw.config` as a wall of grammar diagnostics against a file that was never a test.
 *
 * In `tflw watch` it was worse than untidy. `runOne`'s promise chain has no `.catch`, so that same
 * `readFile` rejection escaped as an **unhandled rejection**: Node printed a stack trace and killed
 * the process, so `tflw watch a.tflww` died during its first run having never watched anything, and
 * never printed the line that says it is watching. Validating here fixes that too, because a usage
 * error in this function is a *returned* exit code rather than a throw.
 *
 * Checked in one place because `run`, `check`, `migrate` and `watch` all reach their file list
 * through `loadAndValidate` — the same reasoning as `unknownFlag`: the rule belongs to the argument
 * surface, not to one command. Discovery runs only to build the suggestion list, on the error path,
 * so an ordinary `tflw run a.tflw` still stats its one file and walks nothing.
 *
 * A directory is refused rather than descended into: `--help`, the README and SPEC all spell the
 * positional as `[files...]`, and making it mean "files or directories" is grammar-freeze surface,
 * not a diagnostics fix. The message names the `.tflw` files inside it so the refusal is one
 * copy-paste from what the user meant.
 */
async function checkFileArgs(cwd: string, typed: readonly string[], exclude: readonly string[], reportDir?: string): Promise<number | undefined> {
  // `reportDir` passed for the same reason as in `discoverTests`: a repro tflw wrote is not something the
  // user meant to type, so it must not appear in a `did you mean` list either.
  const discovered = async (): Promise<string[]> => (await discoverTests(cwd, exclude, reportDir)).map((f) => relative(cwd, f).split('\\').join('/'));
  for (const arg of typed) {
    const full = resolve(cwd, arg);
    let stats;
    try {
      stats = await stat(full);
    } catch {
      const hint = suggest(arg, await discovered());
      err(
        `no test file \`${arg}\` — nothing exists at that path.` +
          (hint ? `\n  did you mean \`${hint}\`?` : '') +
          `\n  pass no file arguments at all and tflw uses every \`.tflw\` file under the current directory.`,
      );
      return EXIT_USAGE;
    }
    if (stats.isDirectory()) {
      // Walked from the directory itself rather than filtered out of `discovered()`, because that
      // filter computed a different claim than the sentence below makes. `relative(cwd, full)` is
      // `''` for the current directory, so the prefix tested was `/` and no cwd-relative path could
      // ever match it: `tflw check .` answered "no `.tflw` files were found under it" standing in a
      // directory holding six. The same false negative covered every directory *outside* `cwd`
      // (nothing discovered under `cwd` starts with `../`) and every directory the config
      // `exclude`s. `exclude` is deliberately not passed on here: this list answers "what could you
      // have typed instead", and an explicit file arg inside an excluded path still runs (see
      // `discoverTests`) — so an excluded directory's files are exactly the ones worth naming.
      const inside = (await discoverTests(full)).map((f) => relative(cwd, f).split('\\').join('/'));
      err(
        `\`${arg}\` is a directory — tflw takes \`.tflw\` files here, not directories.` +
          (inside.length > 0
            ? `\n  name the files instead: ${inside.slice(0, 3).map((f) => `\`${f}\``).join(' ')}${inside.length > 3 ? ` (and ${inside.length - 3} more)` : ''}`
            : `\n  no \`.tflw\` files were found under it.`) +
          `\n  pass no file arguments at all and tflw uses every \`.tflw\` file under the current directory.`,
      );
      return EXIT_USAGE;
    }
    if (!arg.endsWith('.tflw')) {
      err(
        `\`${arg}\` is not a \`.tflw\` test file.` +
          `\n  tflw would try to parse it as one, and report every line of it as a grammar error.` +
          `\n  test files end in \`.tflw\`; \`tflw.config\` is configuration, not a test.`,
      );
      return EXIT_USAGE;
    }
  }
  return undefined;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'run':
      return runCommand(rest);
    case '--internal-load-worker':
      // M31 (D19) — never invoked directly by a user; `runCommand` forks this exact same script
      // with this as its sole argv token when `--workers N>1` and the file has workload-bearing
      // tests (Phase 2b/D99 — this used to be `loadCommand`'s job before `tflw load` was folded
      // into `tflw run`). Undocumented on purpose (no CLI_FLAGS entry, no --help mention) — it's a
      // process-boundary implementation detail, not user-facing surface.
      return loadWorkerCommand();
    case '__demo-service':
      // M118 (`FU-04`, D200) — the other side of `startDemoService`'s fork, and undocumented for the
      // same reason as the branch above: a process boundary, not user-facing surface. Runs until the
      // IPC channel to the parent closes, so it cannot outlive the run that wanted it.
      return demoServiceChild();
    case 'init':
      return initCommand(rest);
    case 'check':
      return checkCommand(rest);
    case 'docs':
      return docsCommand(rest);
    case 'spec':
      return specCommand(rest);
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
    case 'migrate':
      return migrateCommand(rest);
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
        `unknown command \`${command}\`. Try \`tflw run\`, \`tflw check\`, \`tflw init\`, \`tflw docs\`, \`tflw spec\`, \`tflw lsp\`, \`tflw install-browsers\`, \`tflw pick\`, \`tflw watch\`, \`tflw refactor apply\`, or \`tflw migrate\`.`,
      );
      return EXIT_USAGE;
  }
}

// ---- tflw install-browsers (M3a, D5) ---------------------------------------

/**
 * `playwright` is an optional peer (D5): browser step support only activates once the consuming
 * project installs it themselves (`npm install -D playwright`) and downloads a browser binary via
 * this command. Runs the `playwright` CLI that ships inside that same npm package rather than
 * reaching into any private Playwright API — the well-supported, documented install path.
 *
 * M92b (review `B6-09`) — this used to be `npx --yes playwright install`, and this docblock used to
 * credit `npx` with resolving "the consumer's own installed version". It did not. Run in a project
 * with no `playwright`, `--yes` suppresses npx's install prompt, npx downloads an **unpinned**
 * `playwright` from the registry into its own cache, and that ephemeral copy downloads hundreds of
 * MB of browser builds — exiting **0**. The user is then left with a green install command and a
 * browser test that still fails, because `loadPlaywright()` resolves against *their* project, which
 * still has none. Two commands disagreeing about whether playwright is installed, the expensive one
 * being the one that was wrong.
 *
 * So the resolution happens here, explicitly, against the consumer's own working directory. Note
 * the route: `playwright/cli.js` is deliberately *not* in playwright's `exports` map (resolving it
 * raises `ERR_PACKAGE_PATH_NOT_EXPORTED`), but `playwright/package.json` is — so the manifest's own
 * `bin` field is both the working path and the version-agnostic one, since it is where a future
 * playwright would rename its entry point.
 */
async function installBrowsersCommand(argv: string[]): Promise<number> {
  let browser: string = 'chromium'; // D11: Chromium default
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--browser') browser = flagValue(argv, ++i, a);
    else if (a.startsWith('--browser=')) browser = inlineFlagValue(a, '--browser');
    // This loop had no `else` at all, so an unknown flag was silently dropped — the quiet variant
    // of B6-11, and worse than the noisy one: `tflw install-browsers --browsr firefox` downloaded
    // Chromium and exited 0. The command takes no positional argument either, so a bare word here
    // is just as certainly a mistake (`tflw install-browsers firefox`).
    else if (a.startsWith('--')) unknownFlag('install-browsers', a);
    else {
      err(`unexpected argument \`${a}\`. Usage: tflw install-browsers [--browser ${SUPPORTED_BROWSER_ENGINES.join('|')}]`);
      return EXIT_USAGE;
    }
  }
  if (!(SUPPORTED_BROWSER_ENGINES as readonly string[]).includes(browser)) {
    err(`unknown --browser \`${browser}\` — expected one of: ${SUPPORTED_BROWSER_ENGINES.join(', ')}.`);
    return EXIT_USAGE;
  }
  let playwright: { cli: string; version: string };
  try {
    playwright = resolvePlaywrightCli();
  } catch {
    // The same sentence `loadPlaywright()` gives when a browser step runs without the peer, in this
    // command's voice — a user can hit this wall from either direction and reads one explanation.
    // Nothing is downloaded: refusing is the whole point of the change.
    err(
      `\`playwright\` isn't installed in this project, so there is nothing to download browsers for.\n` +
        `  Install the optional peer first, then re-run this command:\n` +
        `    npm install -D playwright\n` +
        `    tflw install-browsers${browser === 'chromium' ? '' : ` --browser ${browser}`}`,
    );
    return EXIT_USAGE;
  }
  const code = await new Promise<number>((resolvePromise) => {
    const child = spawn(process.execPath, [playwright.cli, 'install', browser], { stdio: 'inherit' });
    child.on('error', (e) => {
      err(`could not run \`playwright install ${browser}\`: ${e.message}\n  resolved the playwright CLI to ${playwright.cli}.`);
      resolvePromise(EXIT_USAGE);
    });
    child.on('exit', (exitCode) => resolvePromise(exitCode ?? EXIT_USAGE));
  });
  // `FU-03`/D204 — tflw opens and closes; Playwright's own progress output stays in between. Before
  // M118 this command printed **zero bytes on both streams** when the binary was already present
  // (measured: exit 0, 0 bytes out, 0 bytes err), which is indistinguishable from a no-op, a hang,
  // or a command that does not exist. The `playwright <version>` on the success line is not
  // decoration: it names *which* playwright now has a browser, which is exactly the confusion M92b
  // (`B6-09`) existed to end — an unpinned npx copy downloading binaries the project never sees.
  if (code === 0) {
    process.stdout.write(
      `${browser} is ready — playwright ${playwright.version} in this project can launch it.\n\n` +
        `next:\n  add a browser step (e.g. \`open "/login"\`) to a .tflw file, then \`tflw run\`\n`,
    );
    return EXIT_OK;
  }
  // D205 — exit 2, not 1: `EXIT_FAIL` means a test failed, and nothing here was tested. Playwright's
  // raw error (a stack dump, usually repeated once per retry) has already gone to the inherited
  // stderr above; this is the sentence tflw owes beside it.
  err(
    `could not download the ${browser} browser binary — \`playwright install ${browser}\` exited ${code}.\n` +
      `  Playwright's own output is above. This is nearly always one of:\n` +
      `    · a proxy or firewall in front of the download host — set HTTPS_PROXY, or point\n` +
      `      PLAYWRIGHT_DOWNLOAD_HOST at an internal mirror\n` +
      `    · no network route at all\n` +
      `    · not enough disk space for the browser cache\n` +
      `  Nothing was installed; re-running is safe.`,
  );
  return EXIT_USAGE;
}

/** The consumer's own `playwright` CLI entry point and its version, or a throw. Resolved from
 * `process.cwd()` rather than from this bundle's location: `tflw` is normally a project-local
 * devDependency, but it is also legitimately run via a global install or `npx tflw`, and in both of
 * those the peer that matters is still the *project's*. Throws rather than returning undefined so
 * the one caller can't accidentally treat "not installed" as a path.
 *
 * The version comes from the same manifest read that finds the bin — it is the success line's proof
 * that the browser landed in the playwright this project will actually import (M118/`FU-03`). */
function resolvePlaywrightCli(): { cli: string; version: string } {
  const requireFrom = createRequire(join(process.cwd(), 'noop.js'));
  const manifestPath = requireFrom.resolve('playwright/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
    version?: string;
  };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.playwright;
  if (!bin) throw new Error(`playwright's package.json at ${manifestPath} declares no \`playwright\` bin`);
  return { cli: join(dirname(manifestPath), bin), version: manifest.version ?? 'unknown version' };
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
    if (a === '--browser') browserRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--browser=')) browserRaw = inlineFlagValue(a, '--browser');
    // Before the `url === undefined` case, or a mistyped flag becomes the URL and is reported as
    // "isn't an absolute URL" — B6-11's third shape.
    else if (a.startsWith('--')) unknownFlag('pick', a);
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

  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((res) => {
    resolveClosed = res;
  });

  // M105 (`PLAN_M105_PICK_INTERRUPT.md`, review `M104-02`) — the handler goes on **before** the
  // banner and before the launch, and `interrupted` is what the failure path consults.
  //
  // Previously it attached only once `startPickSession` had resolved — real browser launched, real
  // page navigated — which left the whole launch uncovered. Two windows, both measured:
  //
  //   * before Playwright spawns its browser (and so before *its* SIGINT handler exists): no
  //     listener at all, so Node's default killed the process outright.
  //   * after that, mid-`newPage`/`goto`: Playwright's handler tore the browser down, the in-flight
  //     promise rejected, and the `catch` below reported it as `EXIT_USAGE` — the code documented
  //     as "could not run" — with a red `error: page.goto: net::ERR_ABORTED` naming a Playwright
  //     internal. tflw told the user their own deliberate Ctrl+C was a usage error.
  //
  // Attaching a listener is what suppresses Node's default kill, so the handler must also
  // `resolveClosed()`: without it the first window stops crashing and starts *hanging* — the launch
  // continues, a window the user just cancelled opens anyway, and `await closed` never returns.
  //
  // `interrupted`, not the error text. Whether the user pressed Ctrl+C is answerable here exactly;
  // whether a Playwright message "looks like a teardown" is a guess that decays with every release.
  // The distinction is load-bearing in the other direction too: a genuine launch failure (no browser
  // installed, connection refused, no display) must still print and still exit `EXIT_USAGE`.
  //
  // Every way an interrupt can land, measured against this build rather than reasoned about
  // (decision 189) — the flag fits five of the six, and the sixth is handled on its own line:
  //
  //   1. before this handler is attached (Node's own startup). Irreducible, and now milliseconds
  //      rather than the seconds a browser launch takes. Node's default kill still applies.
  //   2. attached, before Playwright's launch installs *its* handler → flag set, launch continues,
  //      resolves or rejects into 5/6 below.
  //   3. after Playwright's handler exists → **Playwright exits the process itself (130) and none
  //      of the code below runs at all.** Observed 3/3 in the pre-spawn window. Fine, not a hole:
  //      it closes what it spawned, and 130 satisfies this command's contract as squarely as 0.
  //   4. mid-`goto` → the launch rejects, `catch` sees `interrupted` and stays silent. Observed 3/3.
  //   5. after the session is up → `session.close()`, the path that already worked.
  //   6. the launch *resolves* despite the interrupt → the `if (interrupted)` below. Never observed
  //      (0/6 runs across both windows), kept because it is two lines and it is the only thing
  //      standing between a Playwright behavior change and a genuinely orphaned window.
  //
  // The one case the flag does **not** fit is a second Ctrl+C. Attaching a listener removed Node's
  // default kill, and with it the user's ability to escalate when a shutdown is wedged — so an
  // impatient second press has to do explicitly what Node used to do implicitly. Not covered by a
  // test: forcing a wedged teardown means stubbing Playwright, and a test that cannot reach the
  // branch it names is worse than an honest comment saying so.
  let interrupted = false;
  let session: PickSessionHandle | undefined;
  const onSigint = (): void => {
    if (interrupted) process.exit(EXIT_ABORTED); // second Ctrl+C — the escape hatch, restored
    interrupted = true;
    void session?.close();
    resolveClosed();
  };
  process.on('SIGINT', onSigint);

  // Two lines, each true when it prints (decision 188). The first is *also* the guarantee that the
  // handler above is installed, which is why it prints here rather than before `process.on`.
  process.stdout.write(`opening ${url} — press Ctrl+C to stop.\n`);

  try {
    session = await startPickSession(
      url,
      engine,
      (picked) => process.stdout.write(`${picked.syntax}\n`),
      () => resolveClosed(),
    );
    // Ctrl+C landed mid-launch and the launch nevertheless completed: nobody is waiting on this
    // browser, so close it here or it is genuinely orphaned. Not currently reachable — Playwright
    // closes its browsers on SIGINT, so an interrupted launch rejects rather than resolves — and
    // deliberately left unproved rather than covered by a test that cannot fail (decision 190).
    if (interrupted) void session.close();
    else process.stdout.write('ready — click any element to print its locator. Close the window or press Ctrl+C to stop.\n');
  } catch (e) {
    // The rejection *is* the interrupt when the user asked for it — reporting it would be tflw
    // blaming the user for pressing the key the line above told them to press.
    if (!interrupted) {
      process.off('SIGINT', onSigint);
      err(e instanceof Error ? e.message : String(e));
      return EXIT_USAGE;
    }
  }

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
    if (a === '--env') env = flagValue(argv, ++i, a);
    else if (a.startsWith('--env=')) env = inlineFlagValue(a, '--env');
    else if (a === '--browser') browserRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--browser=')) browserRaw = inlineFlagValue(a, '--browser');
    else if (a === '--seed') seedRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--seed=')) seedRaw = inlineFlagValue(a, '--seed');
    else if (a === '--no-color') noColor = true;
    else if (a.startsWith('--')) unknownFlag('watch', a);
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

  // Up front, and not only inside `loadAndValidate` (M82, C5). `runOne` discards `runCommand`'s
  // exit code — it has to, since a failing test must not stop the watcher — so a usage error there
  // would print and then be followed by "watching for changes", with the watcher live on a
  // predicate no saved file can ever satisfy (`watchFiles` non-empty, nothing matching it). That is
  // review finding `B6-02`'s companion line, false in exactly the case it matters. `exclude` is
  // unavailable this early (no config is loaded until the first run) and only widens the suggestion
  // pool, which is harmless here.
  const badWatchFile = await checkFileArgs(cwd, args.files, []);
  if (badWatchFile !== undefined) return badWatchFile;

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
  /** Raw `--parallel` text, validated in `runCommand` (P#47) — how many *files* run concurrently
   * in this one process (`runWithConcurrency`). Renamed from `--workers` (Phase 2b, user
   * direction during the D111/D113 grill-me): `--workers` now exclusively means load-generation
   * *process* forking (below), a completely different axis that happened to share a flag name
   * with this one before the command unification made them coexist on `run`. Defaults to
   * `resolved.workers` (the `tflw.config` `workers N` key, unchanged name/meaning) when omitted. */
  readonly parallelRaw?: string | undefined;
  /** Raw `--workers` text, validated in `runCommand` (mirrors the pre-Phase-2b `tflw load
   * --workers`'s own validation, P#47) — how many *processes* fork to generate one file's
   * workload-bearing tests' load (D111/D19), scoped to those tests only (D113); has no config-file
   * default (unlike `--parallel` above), matching `tflw load --workers`'s own no-default-fallback
   * before this unification. Meaningless (and a non-fatal no-op warning, D113) on a file with zero
   * workload-bearing tests. */
  readonly workersRaw?: string | undefined;
  /** `--skip-workload` (D110, renamed from the originally-proposed `--skip-load` now that
   * `tflw load` no longer exists as its own command) — skips every workload-bearing test in every
   * file this invocation runs, regardless of which `parallel`/`sequential` batch it's declared in;
   * for fast iteration on a file's functional tests without also paying for its load run. */
  readonly skipWorkload: boolean;
  readonly noColor: boolean;
  /** `--verbose`: prints one line per step, not just per test (no `-v` short form — `-v` is already
   * `--version` at the top-level `main()` dispatch). */
  readonly verbose: boolean;
  /** `--forbid-insecure` (PLAN decision 101b, enterprise arc cluster 2): fail before any test runs
   * if the active env has `insecure true` in effect — a CI policy gate against accidentally
   * shipping a TLS-verification bypass. No config representation, `run` only. */
  readonly forbidInsecure: boolean;
  /** `--allow-public-target <origin>` (M131a, D340) — D21 §3.2(3)'s affirmation that an
   * originating scan may point at a host outside the private address ranges.
   *
   * **Repeatable, origin-valued, and with no `tflw.config` representation, which is the entire
   * point of it.** `authorized target` is the declaration layer and lives in config; this is the
   * layer that says a *committed* config can never by itself make CI scan the internet, so a
   * config key here would delete the control. Origin-valued rather than a bare boolean because a
   * boolean affirms a category and would survive any later edit of the config, silently covering
   * whatever new host somebody points the suite at — `TF061`'s argument reused: nobody can affirm
   * the scope of a target they have not named. No `--reason`: D291 already puts that in config,
   * where it travels with the report artifact, and a second reason on the command line could only
   * duplicate or contradict it with no defined winner. */
  readonly allowPublicTargets: readonly string[];
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
  /** Raw `--log-output` text (M27, PLAN_LOG.md decision 121), validated in `runCommand` against
   * `LOG_OUTPUT_VALUES` — overrides `tflw.config`'s `log destination` key for this run's *bare*
   * `log "…"` calls only; an explicit per-statement `to console`/`to html`/`to both` always wins.
   * `none` is a CLI-only value (not a valid `to` target in the grammar) — a global kill-switch for
   * bare calls. */
  readonly logOutputRaw?: string | undefined;
  /** Raw `--log-level` text (M27, PLAN_LOG.md decision 122), validated in `runCommand` against
   * `LOG_LEVELS` — overrides `tflw.config`'s `log level` key (the minimum level a `log` step must
   * clear to be rendered) for this run only. */
  readonly logLevelRaw?: string | undefined;
  /** `--fail-on <severity>` (M134b, D386) — scan findings below this severity are reported but do
   *  not fail the assertion that produced them. **Relaxes only**: it withholds findings from a
   *  verdict, it never narrows the rule pack and it never applies to a negated assertion, so it
   *  cannot turn a green run red. Absent means the file's own claim stands. */
  readonly failOnRaw?: string | undefined;
  /** `--baseline <file>` (M134b, D387) — accepted fingerprints. Listed findings still render, marked
   *  known/accepted, and do not fail the build. */
  readonly baseline?: string | undefined;
  /** `--baseline-write <file>` (M134b, D387) — write this run's findings out as the accepted set.
   *  Ships with `--baseline` rather than after it: R8 fingerprints are hashes, and a feature whose
   *  adoption step is hand-transcribing forty of them is not adoptable. */
  readonly baselineWrite?: string | undefined;
  /** `--probe-seeded <n>` (M134b, D369/D388) — `n` generated payloads per **already-granted**
   *  mutation class, on top of the fixed corpus. Its findings are reported and never gate, because
   *  R8 excludes the seed from a fingerprint and a finding that appears under one seed and vanishes
   *  under the next would either churn a baseline or fail a build on a coin flip. It cannot widen
   *  what `authorized target` permitted. */
  readonly probeSeededRaw?: string | undefined;
}

/** `--evidence LEVEL`'s vocabulary, which **keeps the hyphen** the language dropped in `M147b`
 * (`D623`/`D628`). `evidence headers only` is two bare words in a `tflw.config` because tflw
 * identifiers have no `-`; a CLI argument is typed into a shell, where a space would need quoting
 * and where this lexer never runs. Same value, two surfaces, and the surface decides the spelling —
 * as `--log-output console|html|both|none` and `--fail-on minor|…` already do. */
const EVIDENCE_LEVELS = ['full', 'headers-only', 'none'] as const;
/** M27, PLAN_LOG.md decisions 121/122 — `LOG_OUTPUT_VALUES` adds `none` (a CLI-only global
 * kill-switch for bare `log` calls, decision 121) on top of the DSL grammar's own three `to`
 * targets; `LOG_LEVELS` mirrors the DSL's four level keywords for `--log-level` validation. Small
 * literal duplicates of `packages/lang/src/parser.ts`'s own arrays, matching how `EVIDENCE_LEVELS`
 * above already duplicates rather than imports its parser-side counterpart. */
const LOG_OUTPUT_VALUES = ['console', 'html', 'both', 'none'] as const;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function parseRunArgs(argv: string[]): RunArgs {
  const files: string[] = [];
  let env: string | undefined;
  let seedRaw: string | undefined;
  let nowRaw: string | undefined;
  let tagRaw: string | undefined;
  let only: string | undefined;
  let parallelRaw: string | undefined;
  let workersRaw: string | undefined;
  let skipWorkload = false;
  let noColor = false;
  let verbose = false;
  let forbidInsecure = false;
  const allowPublicTargets: string[] = [];
  let evidenceRaw: string | undefined;
  let failed = false;
  let bail = false;
  let formatRaw: string | undefined;
  let noTimestamps = false;
  let logFile: string | undefined;
  let browserRaw: string | undefined;
  let headed = false;
  let updateSnapshots = false;
  let logOutputRaw: string | undefined;
  let logLevelRaw: string | undefined;
  let failOnRaw: string | undefined;
  let baseline: string | undefined;
  let baselineWrite: string | undefined;
  let probeSeededRaw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = flagValue(argv, ++i, a);
    else if (a.startsWith('--env=')) env = inlineFlagValue(a, '--env');
    else if (a === '--seed') seedRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--seed=')) seedRaw = inlineFlagValue(a, '--seed');
    else if (a === '--now') nowRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--now=')) nowRaw = inlineFlagValue(a, '--now');
    else if (a === '--tag') tagRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--tag=')) tagRaw = inlineFlagValue(a, '--tag');
    else if (a === '--only') only = flagValue(argv, ++i, a);
    else if (a.startsWith('--only=')) only = inlineFlagValue(a, '--only');
    else if (a === '--parallel') parallelRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--parallel=')) parallelRaw = inlineFlagValue(a, '--parallel');
    else if (a === '--workers') workersRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--workers=')) workersRaw = inlineFlagValue(a, '--workers');
    else if (a === '--skip-workload') skipWorkload = true;
    else if (a === '--no-color') noColor = true;
    else if (a === '--verbose') verbose = true;
    else if (a === '--forbid-insecure') forbidInsecure = true;
    // Repeatable (D340): each occurrence names exactly one origin. No comma-separated form and no
    // wildcard, for `TF061`'s reason — a list is one string an author can extend without rereading,
    // and a wildcard is a claim whose scope its author could not have known when they wrote it.
    else if (a === '--allow-public-target') allowPublicTargets.push(flagValue(argv, ++i, a));
    else if (a.startsWith('--allow-public-target=')) allowPublicTargets.push(inlineFlagValue(a, '--allow-public-target'));
    else if (a === '--evidence') evidenceRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--evidence=')) evidenceRaw = inlineFlagValue(a, '--evidence');
    else if (a === '--failed') failed = true;
    else if (a === '--bail') bail = true;
    else if (a === '--format') formatRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--format=')) formatRaw = inlineFlagValue(a, '--format');
    else if (a === '--no-timestamps') noTimestamps = true;
    else if (a === '--log-file') logFile = flagValue(argv, ++i, a);
    else if (a.startsWith('--log-file=')) logFile = inlineFlagValue(a, '--log-file');
    else if (a === '--browser') browserRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--browser=')) browserRaw = inlineFlagValue(a, '--browser');
    else if (a === '--headed') headed = true;
    else if (a === '--update-snapshots') updateSnapshots = true;
    else if (a === '--log-output') logOutputRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--log-output=')) logOutputRaw = inlineFlagValue(a, '--log-output');
    else if (a === '--log-level') logLevelRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--log-level=')) logLevelRaw = inlineFlagValue(a, '--log-level');
    else if (a === '--fail-on') failOnRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--fail-on=')) failOnRaw = inlineFlagValue(a, '--fail-on');
    else if (a === '--baseline') baseline = flagValue(argv, ++i, a);
    else if (a.startsWith('--baseline=')) baseline = inlineFlagValue(a, '--baseline');
    else if (a === '--baseline-write') baselineWrite = flagValue(argv, ++i, a);
    else if (a.startsWith('--baseline-write=')) baselineWrite = inlineFlagValue(a, '--baseline-write');
    else if (a === '--probe-seeded') probeSeededRaw = flagValue(argv, ++i, a);
    else if (a.startsWith('--probe-seeded=')) probeSeededRaw = inlineFlagValue(a, '--probe-seeded');
    else if (a.startsWith('--')) unknownFlag('run', a);
    else files.push(a);
  }
  // A `--tag` value made only of separators (`,,`, ` , `) survives the empty check in
  // `requireNonEmpty` but still names zero tags, and used to collapse to `undefined` — the same
  // silent widening to the whole suite that B6-01 is about, one step further along. Refuse it here
  // rather than in the flag layer, since only `--tag` has a list to be empty.
  const tagList = tagRaw
    ?.split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tagList && tagList.length === 0) {
    throw new Error(
      `--tag was given \`${tagRaw}\`, which names no tags.\n` +
        `  write the tags as a comma-separated list (\`--tag smoke,api\`), or drop the flag to run everything.`,
    );
  }
  const tags = tagList && tagList.length > 0 ? tagList : undefined;
  return {
    files,
    env,
    seedRaw,
    nowRaw,
    tags,
    only,
    parallelRaw,
    workersRaw,
    skipWorkload,
    noColor,
    verbose,
    forbidInsecure,
    allowPublicTargets,
    evidenceRaw,
    failed,
    bail,
    formatRaw,
    noTimestamps,
    logFile,
    browserRaw,
    headed,
    updateSnapshots,
    logOutputRaw,
    logLevelRaw,
    failOnRaw,
    baseline,
    baselineWrite,
    probeSeededRaw,
  };
}

/** Parsed + checker-clean state shared by `tflw run` and `tflw check` (decision 75) — everything
 * `tflw run` needs before it actually executes anything. */
interface ValidatedProject {
  readonly resolved: ReturnType<typeof resolveConfig>;
  readonly parsedConfig: ReturnType<typeof parseConfigSource>;
  /** `tflw.config`'s own source lines (`M111`, `FU-06`) — carried out beside `resolved` because
   * this is the one place the config's *text* is read, and the runtime needs it to render a
   * `session` step's source from the document that step's span actually indexes. Without it the
   * runtime has only the test file's lines and slices session steps out of that. */
  readonly configLines: readonly string[];
  readonly environ: NodeJS.ProcessEnv;
  readonly parsedFiles: { file: string; source: string; program: Program }[];
  /** How many `severity: 'warning'` diagnostics were printed on the way here (M97e, D147). Carried
   * out because `checkCommand`'s summary line is otherwise written from `parsedFiles.length` alone
   * and says `no problems found` — which, the first time a shipped diagnostic actually took the
   * warning branch, printed that sentence to stdout directly above a warning on stderr. */
  readonly warningCount: number;
}

/** Config parse/resolve + per-file parse/check pipeline (P#46, decisions 57/66): a parse/check
 * error anywhere is a usage error and printed diagnostics, never a partial run. Returns the exit
 * code on failure (already printed), or the validated project on success. Shared by `runCommand`
 * (which then also gates on secrets and actually executes) and `checkCommand` (which stops here —
 * lint-only, no execution, so it never needs real secrets or a live API, decision 75).
 *
 * `onFileDiagnostics`, when given, redirects a *per-file* diagnostic batch (the common case — a
 * syntax/checker error in the `.tflw` file itself, not `tflw.config`) to the callback instead of
 * `renderDiagnostics`+stderr — used by `tflw check --format json` (decision 94) to recover the
 * structured diagnostics, and by `tflw migrate` to find deprecations to splice. It fires once for
 * every file checked, including clean ones (with an empty batch, M70/B6-07): stderr has nothing to
 * print for a clean file, but a structured consumer must be able to tell "checked, clean" from
 * "not checked at all". Config-level failures (a broken
 * `tflw.config`, an unknown session service) still print text and return an exit code the same as
 * always — out of scope for a per-file editor check, since they aren't this file's problem. */
async function loadAndValidate(
  cwd: string,
  filesArg: string[],
  envFlag: string | undefined,
  color: boolean,
  onFileDiagnostics?: (file: string, source: string, diagnostics: readonly Diagnostic[]) => void,
  /** `--allow-public-target` values this invocation carried (M131a, D340/D345), for `TF065`/`TF066`.
   *  Trailing and defaulted rather than threaded through every caller, because it is the one input
   *  here that comes from the command line rather than from the project: `migrate` and the load
   *  worker have no such affirmation to pass, and `[]` states that truthfully. */
  allowPublicTargets: readonly string[] = [],
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
    writeStderr(renderDiagnostics(parsedConfig.diagnostics, configText, { filename: 'tflw.config', color }) + '\n');
    return EXIT_USAGE;
  }

  // 2. Select the active env and resolve the concrete settings.
  let resolved;
  let activeEnvBlock;
  try {
    const envBlock = selectEnv(parsedConfig.config, { flag: envFlag, envVar: process.env.TFLW_ENV });
    activeEnvBlock = envBlock;
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
  // `allow hosts` vs. the active env's own base URLs (M85, `TF036`) joins it for the same reason
  // and with the same scope — it is a `tflw.config` rule about the env that was just selected, not
  // about every env the file happens to declare (see `checkAllowHostsCoversBaseUrls`).
  //
  // M116 (D148, D151) adds two things here. `envBaseUrls` is what `TF051` decides against — two
  // booleans read off the env that was just selected, not the URLs themselves (see `EnvBaseUrls`).
  // And `collectConfigFileReferences` brings `cert`/`key` and a `session` body's own paths under
  // `TF043`, resolved against the *config's* directory rather than any test file's.
  const envBaseUrls = { envName: resolved.envName, api: resolved.apiBaseUrl !== null, web: resolved.webBaseUrl !== null };
  // M124/D236 — `TF055`'s config half, resolved here for the same reason and read the same way: one
  // number off the env that was just selected, not the whole `timeouts` record, because the rule
  // compares against exactly one budget.
  const envTimeouts = { envName: resolved.envName, wait: resolved.timeouts.wait };
  // M125b1/D263 — `TF058`'s config half. Read off the **resolved** config rather than re-walked from
  // the `defaults`/`env` blocks, because `resolve.ts:96` already accumulates the two the way SPEC
  // §3.7 says they compose (`allowHosts = [...(allowHosts ?? []), ...entry.hosts]`), and a second
  // accumulation here is the "two copies of a matching rule" that `checkAllowHostsCoversBaseUrls`
  // has a paragraph warning about one function away.
  //
  // `?? []` is load-bearing and is the opposite of the usual defaulting: `resolved.allowHosts` is
  // `null` when no env or `defaults` block declared the key, which is *exactly* the state `TF058`
  // reports. Passing `undefined` through here would say "nobody resolved a config" about a config
  // this function has, by that point, definitely read.
  const envAllowHosts = { envName: resolved.envName, hosts: resolved.allowHosts ?? [] };
  // M128b/D291 — `TF060`'s config half. Read off the resolved config for the same reason
  // `envAllowHosts` is: `resolve.ts` already accumulates `defaults` + `env` the way SPEC §3.7 says
  // they compose, and a second accumulation here is the "two copies of a matching rule" that
  // `checkAllowHostsCoversBaseUrls` has a paragraph warning about.
  //
  // The base URL is passed as the *literal* the env declared, not a normalized one, so the
  // diagnostic quotes back the string the author actually wrote. `resolved.apiBaseUrl` is already
  // interpolation-resolved, which is what makes an `api "https://{API_HOST}/v1"` env checkable here
  // at all rather than skipped — the interpolation happened before this line.
  //
  // M131a/D343 adds `services`, and it is the field that closes the hole this milestone found while
  // scoping: `TF060` gated only the default `api` base, so a scan against a declared `@service`
  // origin required no declaration and no affirmation — a different host, entirely ungated. Read
  // off `resolved.services` for the same reason the rest of this object is read off `resolved`:
  // `resolve.ts` has already composed `defaults` + `env`, and a second composition here is the
  // "two copies of a matching rule" this file keeps warning about.
  const envAuthorizedTargets = {
    envName: resolved.envName,
    targets: resolved.authorizedTargets,
    apiBaseUrl: resolved.apiBaseUrl,
    services: Object.entries(resolved.services).map(([name, url]) => ({ name, url })),
  };
  const configEnvDiags = [
    // **`resolved.sessions`, not `parsedConfig.config.sessions` — this is the line `M137f-02` is
    // about** (`M147d`, D642). A `session` body names services, and services are per-env, so
    // checking *every* declared session against *this* env's service map is what forced a session's
    // origin into env blocks that never touch it: `TF026` before a single assertion ran, and then
    // `TF060` and `TF065` behind it, because declaring the service made the file checkable in an env
    // that had not affirmed the target. Reading the env-filtered roster means a session scoped
    // elsewhere is not this env's business, which is the whole repair.
    ...checkSessionBody(Array.from(resolved.sessions.values()), Object.keys(resolved.services), envBaseUrls, envTimeouts),
    ...checkAllowHostsCoversBaseUrls(parsedConfig.config, activeEnvBlock),
    ...(await checkConfigFiles(parsedConfig.config, cwd)),
  ];
  // **Gate on errors, not on "any diagnostic".** This branch used to `return EXIT_USAGE` for
  // anything at all, which was correct while every config diagnostic was an error and became a
  // latent `A4-05` the moment one was not. `TF043`'s run tier is exactly that case (D147): a
  // `cert` a `before all` hook creates is a *prediction*, and a prediction must not make a valid
  // suite unrunnable. Same rule the per-file stage below already applies, now stated in both.
  const configEnvErrors = configEnvDiags.filter((d) => d.severity === 'error');
  if (configEnvDiags.length > 0) {
    writeStderr(renderDiagnostics(configEnvDiags, configText, { filename: 'tflw.config', color }) + '\n');
    if (configEnvErrors.length > 0) return EXIT_USAGE;
  }

  // 4. Discover the test files. Anything named explicitly is checked first (M82, C5/`B6-11`) —
  //    every path below this line assumes a readable `.tflw`, and the `readFile` that finds out
  //    otherwise is 15 lines down with no handler above it.
  if (filesArg.length > 0) {
    const bad = await checkFileArgs(cwd, filesArg, resolved.exclude, resolved.reportDir);
    if (bad !== undefined) return bad;
  }
  const files = filesArg.length > 0 ? filesArg.map((f) => resolve(cwd, f)) : await discoverTests(cwd, resolved.exclude, resolved.reportDir);
  if (files.length === 0) {
    err('no `.tflw` test files given or found (looked for *.tflw under the current directory).');
    return EXIT_USAGE;
  }

  // Validate every file before running any (P#46): a parse/check error in one file must never
  // let the others execute with real side effects. Parse+check each file up front; only start
  // running once every file is clean.
  const knownSessions = Array.from(resolved.sessions.keys());
  // M130b/D307 — the subset, derived from the same map the roster comes from so the two cannot
  // disagree about which sessions exist.
  const privilegedSessions = knownSessions.filter((name) => resolved.sessions.get(name)?.privileged === true);
  const parsedFiles: { file: string; source: string; program: Program }[] = [];
  let hadErrors = false;
  // Seeded with the config stage's own warnings (M116/D151), not zeroed: a `cert` that is not
  // there is a warning the run summary has to count, or `1 warning` printed above a `no problems
  // found` summary — the exact inconsistency `TF043`'s first tier was reviewed for.
  let warningCount = configEnvDiags.length - configEnvErrors.length;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const parsed = parseSource(source);
    // `M147c`/`M140-03` — resolved once and *both* of its answers used. This call already read and
    // parsed every imported file; until now the caller took the actions and threw away the fact
    // that one of them had not parsed, which is how `tflw check` came to print `no problems found`
    // for a file whose `import` target cannot parse. `importsWithErrors` carries that fact to
    // `TF073` the same way `missingFiles` carries `resolveMissingFiles`'s to `TF043`.
    const imports = await resolveImportedActions(file, parsed.program);
    // One composed pass list, shared with the language server and the docs-site editor demo (M60)
    // — those two used to assemble their own shorter lists and silently drifted behind this one.
    const checkDiags = checkProgram(parsed.program, {
      knownServices: Object.keys(resolved.services),
      knownSessions,
      privilegedSessions,
      outOfScopeSessions: { envName: resolved.envName, declaredElsewhere: resolved.sessionsOutOfScope },
      importedActions: imports.actions,
      importsWithErrors: imports.unparseable,
      // `TF043` (M97c, D144, `A4-07`) — the `stat`s happen here, in the caller, for the same reason
      // `importedActions` does: `@tflw/lang` does no I/O. Before this, `tflw check` printed `no
      // problems found` for a file whose `import` named nothing, and `tflw run` then printed
      // `✗ t.tflw (crashed) (0 ms)` and not one word more, `--verbose` included.
      //
      // **The past tense covers the missing-file trigger only.** A helper that *exists* and then
      // throws on load still prints exactly `✗ t.tflw (crashed)` and nothing else, under `--verbose`
      // as well; "could not load JS helper module … <the real message>" reaches `report/results.json`
      // and no stream. `TF043` cannot help — the file is there. Tracked as `M144-04`, and it is a
      // report-honesty defect rather than a checker one, which is why it did not close with `A4-07`.
      missingFiles: await resolveMissingFiles(file, parsed.program),
      // M116/D148 — the same two booleans the config stage above computed once. `TF051` is the
      // only rule here that can be wrong about a *whole suite* at once, which is why it is
      // derived from the resolved env rather than re-read per file.
      envBaseUrls,
      // M124/D236 — `TF055`. Derived from the resolved env, once, like `envBaseUrls` above: the
      // hold window is written per step but the budget it has to fit inside is a whole-suite fact.
      envTimeouts,
      // M125b1/D263 — `TF057`/`TF058`. Same shape and the same once-per-run derivation, and the
      // same reason: which hosts a suite may reach is a whole-suite fact that a per-step diagnostic
      // has to be told.
      envAllowHosts,
      // M131a/D340 — `TF065`/`TF066`. The one option in this list that describes the *invocation*
      // rather than the project, which is exactly what D21 §3.2(3) asks for: the affirmation has to
      // come from somewhere a committed `tflw.config` cannot reach.
      allowPublicTargets,
      // M128b/D291 — `TF060`. Same derivation and the same reason again: whether this suite is
      // permitted to scan its target is a whole-suite fact, and the per-assertion diagnostic that
      // reports it has to be told.
      envAuthorizedTargets,
    });
    const diagnostics = [...parsed.diagnostics, ...checkDiags];
    // Only `severity: 'error'` blocks a file from running — a `'warning'` (decision 38's
    // deprecation notices, `tflw migrate`'s own input) is advisory: printed/handed to the caller,
    // but the file still runs. This branch used to be documented here as unreachable in practice,
    // no shipped diagnostic having used `'warning'`. **`TF043`'s run tier is its first real user**
    // (D147): a file a *step* opens may be created by an earlier step, so "not there at check time"
    // is a prediction, and a prediction must not make a valid suite unrunnable. Worth noting what
    // that means for the code below — it had never once executed against a real diagnostic before
    // the tests added in D147, so it was scaffolding believed to work, not scaffolding known to.
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    warningCount += warnings.length;
    if (errors.length > 0) {
      if (onFileDiagnostics) onFileDiagnostics(file, source, diagnostics);
      else writeStderr(renderDiagnostics(diagnostics, source, { filename: relative(cwd, file), color }) + '\n');
      hadErrors = true;
      continue;
    }
    if (warnings.length > 0) {
      if (onFileDiagnostics) onFileDiagnostics(file, source, warnings);
      else writeStderr(renderDiagnostics(warnings, source, { filename: relative(cwd, file), color }) + '\n');
    } else if (onFileDiagnostics) {
      // A clean file reaches the callback too, with an empty batch (M70, B6-07). It has nothing to
      // print, which is why the stderr side stays silent — but a *structured* consumer needs to
      // know the file was checked and found clean, or it cannot clear the diagnostics it drew last
      // time. "Absent" and "clean" have to be distinguishable in a machine contract.
      onFileDiagnostics(file, source, []);
    }
    parsedFiles.push({ file, source, program: parsed.program });
  }
  if (hadErrors) return EXIT_USAGE;

  return { resolved, parsedConfig, configLines: configText.split(/\r?\n/), environ, parsedFiles, warningCount };
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

/**
 * The repository root at or above `from`, or `undefined` if there is none.
 *
 * `M135b`, for D405's `%SRCROOT%`. SARIF anchors an alert by matching `artifactLocation.uri` against
 * the repository tree, so the URI has to be relative to the root — and the only path tflw records is
 * relative to wherever it was invoked, which is a different directory the moment a corpus with its
 * own `tflw.config` is run from its own folder.
 *
 * `.git` is tested with `existsSync` rather than as a directory on purpose: a worktree and a
 * submodule both have it as a *file*, and a check for a directory would walk straight past the root
 * of either and keep climbing. Returning `undefined` outside a repository is the honest answer —
 * `%SRCROOT%` has no meaning there, and the exporter's fallback is to emit what it already had.
 */
function sourceRootOf(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * `M111` (`B6-05`) — the wrapper exists so the log file is closed on **every** exit path, not just
 * the one that reaches the end of a run. `runCommandCore` returns early from a dozen places (a
 * parse error, a missing secret, a bad flag), and each of those is precisely the case a user keeps
 * a log for. The content is already on disk either way — the writes are synchronous — but the
 * descriptor and the module-level mirror have to be released, or `tflw watch`, which calls this
 * once per file change, would accumulate one of each per keystroke.
 */
async function runCommand(argv: string[], watchOpts?: RunCommandWatchOptions): Promise<number> {
  try {
    return await runCommandCore(argv, watchOpts);
  } finally {
    activeLog?.close();
    // M118 (`FU-04`, D203) rides the same reasoning one line up: a run returns early from a dozen
    // places, and each of those is exactly when a forked server would be left behind. `tflw watch`
    // calls this once per save, so a leak here would be one stray process per keystroke.
    activeDemo?.stop();
    activeDemo = undefined;
  }
}

/** The console currently mirroring to `--log-file`, so the wrapper above can close it whatever
 * happens. `undefined` for a run without `--log-file`, which is the overwhelming majority. */
let activeLog: { close: () => void } | undefined;

/** The demo service forked for this run (M118, `FU-04`), so the same wrapper can kill it whatever
 * happens. `undefined` for every run whose config points at a real service — which is every run
 * past a user's first five minutes. */
let activeDemo: DemoService | undefined;

async function runCommandCore(argv: string[], watchOpts?: RunCommandWatchOptions): Promise<number> {
  const args = parseRunArgs(argv);
  const color = args.noColor ? false : process.stdout.isTTY === true;
  // `M111` (`B6-05`, case 4) — `err()` used to emit ANSI red no matter what. `--no-color` is the
  // user saying "this output is going somewhere that does not render escapes", and it has to mean
  // that for the error lines too, not only for everything else.
  if (args.noColor) stderrColor = false;
  const cwd = process.cwd();
  // `M111` (`B6-05`, case 1) — the log file is opened *here*, before a single test runs, so an
  // unusable path fails at the one moment `EXIT_USAGE`'s own definition ("could not run") is true.
  // It used to be written after the summary and every artifact, where an `ENOENT` turned a fully
  // passing suite into exit 2.
  let out: { write: (text: string) => void; close: () => void };
  try {
    out = makeConsole(args.logFile);
    activeLog = args.logFile === undefined ? undefined : out;
  } catch (e) {
    err(`--log-file ${args.logFile}: ${(e as Error).message}`);
    return EXIT_USAGE;
  }

  // 0. Validate numeric flags up front — a usage error, never a silent bad-value coercion (P#46).
  let seedArg: number | undefined;
  if (args.seedRaw !== undefined) {
    seedArg = Number(args.seedRaw);
    if (!Number.isFinite(seedArg)) {
      err(`--seed expects a number, got "${args.seedRaw}"`);
      return EXIT_USAGE;
    }
  }
  let parallelArg: number | undefined;
  if (args.parallelRaw !== undefined) {
    parallelArg = Number(args.parallelRaw);
    if (!Number.isInteger(parallelArg) || parallelArg < 1) {
      err(`--parallel expects a positive integer, got "${args.parallelRaw}"`);
      return EXIT_USAGE;
    }
  }
  // D111/D113 — process-level scaling of one file's own workload-bearing tests' load generation
  // (forked child processes, mirrors pre-Phase-2b `tflw load --workers`); unrelated to `--parallel`
  // above (in-process file concurrency). No config-file default (matches `tflw load`'s own
  // always-1-unless-flagged behavior) — defaulted to `1` below, after `runnable` is known, so the
  // D113 "no workload-bearing tests" warning can name the affected file(s).
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
  let logOutputArg: LogDestination | 'none' | undefined;
  if (args.logOutputRaw !== undefined) {
    if (!(LOG_OUTPUT_VALUES as readonly string[]).includes(args.logOutputRaw)) {
      err(`--log-output expects one of ${LOG_OUTPUT_VALUES.join(', ')}, got "${args.logOutputRaw}"`);
      return EXIT_USAGE;
    }
    logOutputArg = args.logOutputRaw as LogDestination | 'none';
  }
  let logLevelArg: LogLevel | undefined;
  if (args.logLevelRaw !== undefined) {
    if (!(LOG_LEVELS as readonly string[]).includes(args.logLevelRaw)) {
      err(`--log-level expects one of ${LOG_LEVELS.join(', ')}, got "${args.logLevelRaw}"`);
      return EXIT_USAGE;
    }
    logLevelArg = args.logLevelRaw as LogLevel;
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

  const loaded = await loadAndValidate(cwd, args.files, args.env, color, undefined, args.allowPublicTargets);
  if (typeof loaded === 'number') return loaded;
  const { parsedFiles, environ, configLines } = loaded;
  // `--evidence`/`--log-output`/`--log-level` each override one `tflw.config` key for this run
  // only (decisions 101c/121/122); `resolved` shadows `loaded.resolved` from here down so every
  // downstream use (the `runProgram` calls, the report write) sees the effective values with no
  // separate threading needed. `--log-output` only ever reaches a bare `log "…"` call — `execLog`
  // (`interpreter.ts`) only falls back to `config.logDestination` when the statement itself gave
  // no `to …` clause, so an explicit per-statement destination is never touched here.
  const configured: ResolvedConfig = {
    ...loaded.resolved,
    // M131a/D340 — the only path by which this field is ever non-empty. `resolveConfig` hard-codes
    // `[]` because its input is a file; the affirmation has to arrive from the command line or the
    // control it implements does not exist.
    allowPublicTargets: args.allowPublicTargets,
    ...(evidenceArg !== undefined ? { evidenceLevel: evidenceArg } : {}),
    ...(logOutputArg !== undefined ? { logDestination: logOutputArg } : {}),
    ...(logLevelArg !== undefined ? { logLevel: logLevelArg } : {}),
  };

  // `--forbid-insecure` (decision 101b): a CI policy gate — fail before any test runs, not partway
  // through, if `insecure true` is active for the env actually running.
  if (args.forbidInsecure && configured.insecure) {
    err(`--forbid-insecure was set and env "${configured.envName}" has \`insecure true\` active — refusing to run.`);
    return EXIT_USAGE;
  }

  // Gate on secrets required to actually run (`check` never reaches this — no execution, no need
  // for real credentials).
  const missing = missingRequiredEnv(configured, environ);
  if (missing.length > 0) {
    err(`missing required environment ${missing.length > 1 ? 'variables' : 'variable'}: ${missing.join(', ')}\n  set ${missing.length > 1 ? 'them' : 'it'} in your environment or a local .env file (see \`require env\` in tflw.config).`);
    return EXIT_USAGE;
  }

  // M118 (`FU-04`, D198/D203) — the scaffolded `api "tflw://demo"` becomes a real server here, and
  // **only here**: `tflw check` does no I/O by contract (P#75), which is the whole reason it runs in
  // CI without secrets or a live API, so it must never start one. `tflw watch` gets this for free —
  // it calls `runCommand`.
  //
  // Deliberately after both gates above: a run that is about to refuse for a missing secret should
  // not have forked a server first. `resolved` shadows `configured` from here down, carrying the
  // concrete `http://127.0.0.1:<port>`, so the runtime, the forked load workers and the report all
  // see one ordinary URL and none of them need to know the demo exists.
  const usingDemo = usesDemoService(configured);
  if (usingDemo) {
    try {
      activeDemo = await startDemoService();
    } catch (e) {
      err(
        `could not start tflw's demo service (\`api "${DEMO_BASE_URL}"\` in tflw.config): ${(e as Error).message}\n` +
          `  point \`api\` at a service of your own, or re-run \`tflw init\` in an empty directory.`,
      );
      return EXIT_USAGE;
    }
  }
  const resolved: ResolvedConfig = activeDemo ? withDemoBaseUrls(configured, activeDemo.baseUrl) : configured;

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
  // M128c (D288) — one prober for the whole run, alongside the one session cache, so the TLS probe
  // opens a single handshake per `host:port` across every file rather than one per file.
  const tlsProber = new TlsProber();
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
      // `FU-23`/D250 — say what is being replayed, and say when "the last run" was not the whole
      // suite. Without the second clause, `tflw run --tag smoke` followed by `tflw run --failed`
      // quietly redefines `--failed` to mean "failed among the smoke tests", which is how a
      // failure watched minutes earlier can vanish from a replay with nothing printed about it.
      if (!ndjsonActive) {
        const n = lastRun.failed.length;
        const scope = lastRun.filter ? ` — which was filtered by \`${lastRun.filter}\`, not the whole suite` : '';
        out.write(withTimestamps(`re-running ${n} test${n === 1 ? '' : 's'} that failed in the last run${scope}`, !args.noTimestamps) + '\n');
      }
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
      // M137c — the same three filters over `crawls`, and they have to be the same three. A crawl is a
      // named top-level declaration that sends traffic, so `--only "one test"` leaving every crawl in
      // the file running would be a filter that quietly widens what a run does; `--failed` finds one
      // by name in `last-run.json` exactly as it finds a test; and SPEC §9.15 already promises `--tag`
      // reaches a crawl, because its tags sit above the header the way a test's do. `--skip-workload`
      // is the one that does not apply: a crawl has no workload clause to skip.
      const keep = <T extends { readonly tags: readonly string[]; readonly name: { readonly value: string } }>(d: T): boolean =>
        (!args.tags || args.tags.some((tag) => d.tags.includes(tag))) &&
        (!args.only || d.name.value === args.only) &&
        (!failedSet || failedSet.has(`${relFile}::${d.name.value}`));
      // Destructured out of the spread rather than overwritten in it: `crawls` is absent-when-empty
      // (`ast.ts`), so a program whose every crawl was filtered away has to be shaped like one that
      // never had any — and `...fileProgram` would otherwise put the unfiltered list back.
      const { crawls: declaredCrawls, ...programRest } = fileProgram;
      const crawls = (declaredCrawls ?? []).filter(keep);
      return {
        file,
        source,
        program: {
          ...programRest,
          ...(crawls.length > 0 ? { crawls } : {}),
          tests: fileProgram.tests
            .filter(keep)
            // D110 (`--skip-workload`, renamed from the originally-proposed `--skip-load`): drops
            // every workload-bearing test regardless of which `parallel`/`sequential` batch it's
            // declared in — a file mixing functional and workload tests still runs its functional
            // ones normally.
            .filter((t) => !args.skipWorkload || t.workload === null),
        },
      };
    })
    .filter((f) => (!args.tags && !args.only && !failedSet) || f.program.tests.length > 0 || (f.program.crawls ?? []).length > 0);
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

  const parallel = parallelArg ?? resolved.workers;
  // D111/D113: process-level load-generation scaling, scoped to workload-bearing tests only — no
  // legitimate use forking processes over a purely functional test (no population/rate to stripe,
  // no percentile aggregate to merge). `loadWorkers` defaults to `1` (no forking) unlike `parallel`
  // above, matching `tflw load --workers`'s own pre-Phase-2b default.
  const loadWorkers = workersArg ?? 1;
  const anyWorkload = runnable.some(({ program }) => program.tests.some((t) => t.workload !== null));
  if (loadWorkers > 1) {
    for (const { file, program } of runnable) {
      if (!program.tests.some((t) => t.workload !== null)) {
        out.write(withTimestamps(`\`--workers\` has no effect — ${relative(cwd, file)} has no workload-bearing tests`, !args.noTimestamps) + '\n');
      }
    }
  }
  // D99: same pre-run "scenario … — …" preview `tflw load` always printed for its one file, now
  // printed once up front for every file in this invocation that has at least one workload-bearing
  // test (a purely functional invocation prints nothing new here, unchanged from before Phase 2b).
  if (anyWorkload && !ndjsonActive) {
    for (const { program } of runnable) {
      for (const test of program.tests) {
        if (test.workload) out.write(withTimestamps(`scenario "${test.name.value}" — ${describeWorkload(workloadOf(test.workload))}`, !args.noTimestamps) + '\n');
      }
    }
  }
  // M32 (R5), carried over from `tflw load`: first Ctrl-C requests a graceful stop for any
  // in-flight workload-bearing test (no new iterations; its `loadReport.aborted` flushes whatever
  // completed); a second one before that resolves force-quits immediately. Only installed when
  // this invocation actually has a workload-bearing test anywhere — a purely functional run keeps
  // today's default Node SIGINT behavior (immediate exit) unchanged, since functional execution has
  // no notion of a graceful mid-test abort to offer instead.
  const abortController = new AbortController();
  let interrupted = false;
  const onSigint = (): void => {
    if (interrupted) {
      process.stdout.write('\n' + dim(color, 'second Ctrl-C — exiting immediately') + '\n');
      process.exit(EXIT_ABORTED);
    }
    interrupted = true;
    abortController.abort();
    process.stdout.write('\n' + dim(color, 'aborting… flushing a partial report (Ctrl-C again to force-quit)') + '\n');
  };
  if (anyWorkload) process.on('SIGINT', onSigint);
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
  const useBufferedVerbose = !ndjsonActive && args.verbose && parallel > 1;
  const sharedHumanEmit = !ndjsonActive && !useBufferedVerbose ? liveEmit(out, color, args.verbose, githubActions, timestamps, resolved.logLevel) : undefined;
  const ndjsonCollected: RunEvent[] = [];
  const sharedNdjsonEmit = ndjsonActive ? ndjsonEmit(out, ndjsonCollected) : undefined;

  // One shared browser process for the whole invocation (M3a, D13) — lazily launched on the first
  // browser step anywhere in the run; closed unconditionally below even if nothing ever used it —
  // unless `watchOpts` says otherwise (M5, `RunCommandWatchOptions` above). Engine (`--browser`,
  // D11) and headed mode (`--headed`, M3c) are run-level, resolved once here; `viewport` comes from
  // `tflw.config` (M3c).
  const browserManager = watchOpts?.browserManager ?? new BrowserManager({ engine: browserEngine, headless: !args.headed, viewport: resolved.viewport });
  watchOpts?.onBrowserManagerReady?.(browserManager);

  // M130b (D331/D332) — one collector for the whole invocation, beside `sessionCache` and
  // `tlsProber` and shared for their reason: the declines are the *run's* number, not any one
  // file's, and the repro files are written once, after everything has finished, so `--workers N`
  // and shards cannot interleave partial ones.
  // M137d (D474) — the sink carries a discriminated union now that Tier 3 emits repros too, so this
  // holds every subject and the consumers narrow. `writeRepros` dispatches on `kind`; SARIF's
  // `reproIndex` still wants the authorization arm alone, because its join key is the principal.
  const reproSubjects: ReproSubject[] = [];
  const reproSink: ReproSink = { finding: (f) => reproSubjects.push(f) };
  // D418a — the declines moved to the shared `ScanSink` below, because Tier 3 has the same fact
  // about payload classes that Tier 2 has about principals.
  const scanDeclines: ScanDecline[] = [];

  // M134b (D386/D387) — the gate, resolved once for the invocation. Built before any file runs so a
  // malformed `--baseline` is an error the run reports instead of a suppression that silently
  // matched nothing: every failure mode of a baseline file makes the build *greener*, and the one
  // thing this feature must never do is make a build greener than the evidence.
  const failOn = args.failOnRaw === undefined ? null : parseFailOn(args.failOnRaw);
  const baselineDoc = args.baseline === undefined ? null : parseBaseline(await readFile(resolve(cwd, args.baseline), 'utf8'), args.baseline);
  const scanGate: ScanGate | undefined =
    failOn === null && baselineDoc === null ? undefined : { failOn, accepted: new Map((baselineDoc?.accepted ?? []).map((e) => [e.fingerprint, e])) };
  // Validated here for the same reason and at the same moment: a bad `--probe-seeded` is a usage
  // error, and a usage error belongs on the command line rather than on an assertion three minutes
  // into a suite (P#46).
  const probeSeeded = args.probeSeededRaw === undefined ? undefined : parseProbeSeeded(args.probeSeededRaw);

  // M134b (D385/D389) — the same shape one tier wider: every scan's findings and every scan's rule
  // census, collected once for the whole invocation.
  const scanFindings: ScanFinding[] = [];
  const censusByScan = new Map<ScanKind, { applied: Set<string>; notApplicable: Map<string, Set<string>> }>();
  const scanSink: ScanSink = {
    finding: (f) => scanFindings.push(f),
    census: (c) => {
      const bucket = censusByScan.get(c.scan) ?? { applied: new Set<string>(), notApplicable: new Map<string, Set<string>>() };
      for (const id of c.applied) bucket.applied.add(id);
      for (const n of c.notApplicable) {
        const reasons = bucket.notApplicable.get(n.rule) ?? new Set<string>();
        reasons.add(n.because);
        bucket.notApplicable.set(n.rule, reasons);
      }
      censusByScan.set(c.scan, bucket);
    },
    decline: (d) => scanDeclines.push(d),
  };

  interface FileRunResult {
    readonly report: RunReport;
  }

  const fileResults = await runWithConcurrency(
    runnable,
    parallel,
    async ({ file, source, program }, i): Promise<FileRunResult> => {
      const fileLabel = relative(cwd, file);
      const buffered = useBufferedVerbose ? bufferedEmit(out, color, args.verbose, githubActions, timestamps, resolved.logLevel) : undefined;
      const rawSink = buffered?.sink ?? sharedHumanEmit ?? sharedNdjsonEmit;
      const fileEmit = rawSink ? withFileTag(rawSink, fileLabel) : undefined;
      let previousTick: LoadProgressSnapshot | undefined;
      const printProgress = (snapshot: LoadProgressSnapshot): void => {
        if (process.stdout.isTTY && !ndjsonActive) process.stdout.write(`\r${renderLoadProgressLine(snapshot, previousTick, plannedMsFor(program), color)}   `);
        previousTick = snapshot;
      };
      try {
        const hasWorkload = program.tests.some((t) => t.workload !== null);
        // D111: process-level scaling forks `loadWorkers - 1` additional children as shards
        // 1..N-1, each running only this file's workload-bearing subset (`runLoadShard`, unchanged
        // since before Phase 2b); the main process contributes its own striped shard-0 share via
        // the exact same unified `runProgram` call that already runs this file's functional tests
        // — a functional test never runs inside a forked shard worker (D113).
        let report: RunReport;
        if (hasWorkload && loadWorkers > 1) {
          if (!ndjsonActive) out.write(withTimestamps(`running across ${loadWorkers} generator processes…`, timestamps) + '\n');
          // M32 (R5), carried over from `tflw load`: each shard (the main process's own shard-0,
          // and every forked child) ticks independently — the live line always reflects the sum of
          // the latest snapshot heard from every shard, not a lockstep round.
          const latestByShard = new Map<number, LoadProgressSnapshot>();
          const printShardProgress = (shardIndex: number, snapshot: LoadProgressSnapshot): void => {
            latestByShard.set(shardIndex, snapshot);
            printProgress(combineProgressSnapshots([...latestByShard.values()]));
          };
          const [main, ...children] = await Promise.all([
            runProgram(program, resolved, {
              source,
              baseDir: dirname(file),
              // `M97c-03` — `tflw.config` is read from exactly `join(cwd, 'tflw.config')` above, so cwd
              // *is* its directory. Config-declared relative paths (a `session` body's files, mTLS
              // `cert`/`key`) resolve against this rather than against the test file's own directory.
              configDir: cwd,
              // `M111` (`FU-06`) — the document a `session` step's span indexes. Without it the
              // runtime renders those steps out of `source` above, which is this test file.
              configLines,
              environ,
              redactor,
              sessionCache,
              tlsProber,
              reproSink,
              scanSink,
              ...(scanGate ? { scanGate } : {}),
              ...(probeSeeded ? { probeSeeded } : {}),
              browserManager,
              seed,
              now,
              uniqueSeq,
              testIndexOffset: offsets[i]!,
              sessionSpliceOwners,
              filePath: fileLabel,
              updateSnapshots: args.updateSnapshots,
              abortSignal: abortController.signal,
              onProgressTick: (snapshot) => printShardProgress(0, snapshot),
              shard: { index: 0, count: loadWorkers },
              ...(fileEmit ? { emit: fileEmit } : {}),
            }),
            ...Array.from({ length: loadWorkers - 1 }, (_unused, i2) =>
              runShardInChildProcess({ cwd, file, env: args.env, seedRaw: String(seed), nowRaw: now, demoBaseUrl: activeDemo?.baseUrl, allowPublicTargets: args.allowPublicTargets }, i2 + 1, loadWorkers, {
                abortSignal: abortController.signal,
                onProgress: (snapshot) => printShardProgress(i2 + 1, snapshot),
              }),
            ),
          ]);
          // M56 (Phase 3, D117): `main.report`'s own workload entries are only shard-0's partial
          // share (`runProgramInner`'s own doc comment) — splice in the real, merged result (and
          // hoist the merged selfDiagnosis/inconclusive/aborted) once every shard is combined.
          const mergedLoadReport = mergeLoadShardReports(program, [main.loadShardResult!, ...children], {
            startedAt: main.report.startedAt,
            durationMs: main.report.durationMs,
            seed,
            now,
            aborted: abortController.signal.aborted,
          });
          report = spliceLoadReportIntoRunReport(main.report, mergedLoadReport);
        } else {
          const out2 = await runProgram(program, resolved, {
            source,
            baseDir: dirname(file),
            configDir: cwd,
            configLines,
            environ,
            redactor,
            sessionCache,
            tlsProber,
            reproSink,
            scanSink,
            ...(scanGate ? { scanGate } : {}),
            ...(probeSeeded ? { probeSeeded } : {}),
            browserManager,
            seed,
            now,
            uniqueSeq,
            testIndexOffset: offsets[i]!,
            sessionSpliceOwners,
            filePath: fileLabel,
            updateSnapshots: args.updateSnapshots,
            abortSignal: abortController.signal,
            onProgressTick: printProgress,
            ...(fileEmit ? { emit: fileEmit } : {}),
          });
          report = out2.report;
        }
        if (hasWorkload && process.stdout.isTTY && !ndjsonActive) process.stdout.write('\r' + ' '.repeat(90) + '\r');
        buffered?.flush();
        // Stamp each test with the relative file it came from (report.html's per-file grouping,
        // decision 92) — done here, once, after the fact. `filePath` above is a *separate* threading
        // of the same relative label: `RunOptions.filePath` is needed live, during execution, for a
        // `matches snapshot` step's `snapshots/<file>/…` path (M4b) — this stamp remains the
        // display-only one `report.tests[].file` has always been, kept as its own assignment rather
        // than merged into the two so neither concern's rationale gets confused for the other's.
        return { report: { ...report, tests: report.tests.map((t) => ({ ...t, file: fileLabel })) } };
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
          tests: [{ kind: 'functional', name: `${fileLabel} (crashed)`, ok: false, durationMs: 0, steps: [], error: redactor.redact(message), file: fileLabel }],
          seed,
          now,
          insecure: resolved.insecure,
          evidenceLevel: resolved.evidenceLevel,
        };
        // The crash reaches `results.json`, `report.html` and `junit.xml` — but it used to reach
        // the event stream nowhere at all (M77, review finding B5-03). This `RunReport` is built
        // inside the catch, after `runProgram`'s own emitter has gone, so a file that threw before
        // emitting produced *no event of any kind*: `--format ndjson` showed a run with the
        // crashed file simply absent. A CI job parsing the documented streaming contract saw
        // nothing wrong; only the exit code disagreed.
        //
        // Emitted here as the sequence `runProgram` would have produced, so the stream stays
        // well-formed: one file, one test, a `test:end` for the `test:start`, and a `run:end`
        // whose report is the same `ok: false` one every other sink gets.
        if (fileEmit) {
          const crashResult: TestResult = { kind: 'functional', name: `${fileLabel} (crashed)`, ok: false, durationMs: 0, steps: [], error: redactor.redact(message), file: fileLabel };
          fileEmit({ type: 'run:start', total: 1, env: resolved.envName });
          fileEmit({ type: 'test:start', name: crashResult.name });
          fileEmit({ type: 'test:end', result: crashResult });
          fileEmit({ type: 'run:end', report: crashed });
        }
        return { report: crashed };
      }
    },
    // `--bail` (decision 111/M17): stop pulling new files once any in-flight one reports a
    // failure. `TestResult.ok` is already the final, post-retry verdict (same one `flaky` uses),
    // so a mid-retry failing attempt never trips this early.
    args.bail ? (r: FileRunResult) => !r.report.ok : undefined,
  );
  process.removeListener('SIGINT', onSigint);
  const reports = fileResults.map((r) => r.report);

  // 6. Merge reports — M56 (Phase 3, D117/D118): a workload test's result now lives inline in
  //    `RunReport.tests` and `selfDiagnosis`/`inconclusive`/`aborted` are top-level `RunReport`
  //    fields, so merging across files (`mergeReports`) already covers the load side too — no more
  //    separate `LoadReport` artifact, and no more "only the first file's load results are kept"
  //    limitation. Write report.html + junit.xml + results.json (decision 111.1) + .last-run.json
  //    (decision 111.2, always overwritten — unconditional, not just under --failed) +
  //    events.ndjson (decision 111.4, only under --format ndjson), print the summary. A second
  //    full-report redaction pass (decision 56) here — on top of the one each `runProgram` call
  //    already did on its own file's report — closes the *cross-file* half of the ordering window:
  //    a secret first registered by one file (e.g. running later, or concurrently under
  //    `--workers`) can still retroactively mask an earlier file's already-built report once
  //    everything is merged.
  // D331 — the census is computed over `parsedFiles`, the whole **discovered** suite, and never
  // over `runnable`, which `--tags`/`--only`/`--failed` may have narrowed. That is deliberate and
  // the label says so: this is the *suite's* bound on what the tier can judge, not this run's, and
  // a number whose base moved with the filter would be a different sentence every invocation.
  const census = parsedFiles.reduce(
    (acc, { program }) => {
      const c = identityCensus(program);
      return { apiSteps: acc.apiSteps + c.apiSteps, withOwner: acc.withOwner + c.withOwner };
    },
    { apiSteps: 0, withOwner: 0 },
  );
  const scanBlindSpot = buildScanBlindSpot(census, scanDeclines);
  const scanCoverage = buildScanCoverage(censusByScan);
  const merged = redactReport(
    mergeReports(reports, resolved.envName, resolved.authorizedTargets, seed, now, resolved.insecure, browserEngine, resolved.evidenceLevel, usingDemo, scanBlindSpot, {
      findings: scanFindings,
      coverage: scanCoverage,
    }),
    redactor,
  );
  // D332 — written after the run, from the collected findings, so `--workers N` and shards cannot
  // interleave partial files.
  await writeRepros(reproSubjects, join(cwd, resolved.reportDir));
  // M134b (D387) — written from the **redacted** merged report, not from the raw sink, so a
  // fingerprint can never be accompanied in the file by a value the run took care to mask
  // everywhere else. The document holds hashes and endpoints; that is all it needs.
  if (args.baselineWrite !== undefined) {
    const target = resolve(cwd, args.baselineWrite);
    await writeFile(target, renderBaseline(merged.findings ?? []), 'utf8');
    out.write(`${withTimestamps(`baseline written to ${relative(cwd, target)} — ${(merged.findings ?? []).filter((f) => f.fingerprint).length} accepted`, timestamps)}\n`);
  }
  const reportDir = join(cwd, resolved.reportDir);
  const outPath = await writeReport(merged, reportDir, resolved.logLevel);
  await writeJunitXml(merged, reportDir);
  await writeResultsJson(merged, reportDir);
  // M135b (D403/D404) — `findings.sarif`, from the same redacted report and **only when the run
  // actually scanned**. There is no flag: a fourth artifact behaving unlike the other three, gated
  // on something nobody passes, is a feature nobody has. The condition is the artifact-level form of
  // this arc's three-state rule — an empty `results` array makes `upload-sarif` resolve every
  // existing alert, so a functional-only run must produce no file rather than an empty one.
  // D405's repo-relative URI. `ScanFinding.file` is `relative(cwd, file)` — relative to the
  // *invocation*, which is the repository root only when someone happened to run from there — so the
  // exporter needs the root itself to re-base against. Undefined when there is no repository, which
  // leaves the old pass-through shape rather than guessing a root.
  const sourceRoot = sourceRootOf(cwd);
  await writeSarif(merged, reportDir, {
    version: await getVersion(),
    reproSubjects,
    ...(sourceRoot ? { sourceRoot, fileBase: cwd } : {}),
  });
  // D250 — the record now carries how this run was narrowed, so the *next* `--failed` can say what
  // it is replaying. Still unconditional and still always overwritten: not writing on a filtered
  // run was rejected for introducing a second silence (run `--tag smoke`, then `--failed`, and
  // replay something unrelated to what you just watched fail).
  await writeLastRun(merged, reportDir, describeRunFilter({ tags: args.tags, only: args.only, failed: args.failed }));
  // M63 (V2-02): the persisted event log gets the same final redaction pass as every other
  // artifact. It is written after the whole run, so — unlike the live stdout stream, which is gone
  // by the time a late `env()` reveals a secret — the redactor here is fully populated. Skipping
  // this left the file masking a value in its `run:end` line while printing it raw in the
  // `step:end`/`test:end` lines above it, in the one output mode built to be machine-consumed
  // somewhere else.
  if (ndjsonActive) await writeEventsNdjson(ndjsonCollected.map((e) => redactEvent(e, redactor)), reportDir);

  if (!ndjsonActive) {
    out.write(withTimestamps('\n' + renderCliSummary(merged, color), timestamps) + '\n');
    out.write(withTimestamps(`\n${dim(color, 'report:')} ${relative(cwd, outPath)}`, timestamps) + '\n');
  }

  out.close(); // the wrapper closes it too; `close()` is idempotent, and flushing here keeps the
  // log complete before the browser teardown below can throw.
  if (!watchOpts?.keepBrowserOpen) await browserManager.close(); // no-op if no test in this run ever used a browser step

  // Exit-code priority mirrors `tflw load`'s own (aborted > inconclusive > ok), now read straight
  // off the merged `RunReport` (D117) — an aborted or inconclusive run outranks a merely-failing
  // report, same as it always outranked a load run's own thresholds.
  if (merged.aborted) return EXIT_ABORTED;
  if (merged.inconclusive) return EXIT_INCONCLUSIVE;
  return merged.ok ? EXIT_OK : EXIT_FAIL;
}

// ---- Load-generation process forking (M29-M32/D16-D19/D24a/D28/D29, unified into `tflw run`'s
// own dispatch by Phase 2b/D99 — `tflw load` no longer exists as its own command). -------------

/** What the parent sends a freshly-forked `--internal-load-worker` child once it signals `ready`
 * (M31, D19) — everything the child needs to independently re-parse/re-validate the same file and
 * run its own striped shard; no AST is ever serialized, only these plain strings/numbers. */
interface LoadWorkerStartMessage {
  readonly type: 'start';
  readonly cwd: string;
  readonly file: string;
  readonly env?: string;
  readonly seedRaw?: string;
  readonly nowRaw?: string;
  readonly shardIndex: number;
  readonly shardCount: number;
  /** M118 (`FU-04`) — the address of the demo service the *parent* already started, when the config
   * says `api "tflw://demo"`. The child re-loads that config from disk and would otherwise resolve
   * the reserved URL itself; it must never start a second server, or each shard would be measuring
   * a different one. Absent for every run against a real service. */
  readonly demoBaseUrl?: string;
  /** M131a/D340 — the parent's `--allow-public-target` values. The child re-validates the same file
   * from disk, so without this it would run `checkPublicTargets` with an empty affirmation list and
   * refuse a file the parent had just accepted. **The affirmation belongs to the invocation, and a
   * forked shard is the same invocation**; this is the IPC equivalent of the flag not living in
   * config, not an exception to it — nothing here reads it from a file. */
  readonly allowPublicTargets?: readonly string[];
}

/** M32 (R5) — sent by the parent once its own `abortSignal` fires (Ctrl-C), so a running child
 * stops spawning new iterations and reports back whatever it already has instead of the parent
 * relying solely on the terminal's own SIGINT-to-process-group propagation (not guaranteed on every
 * platform, and gives no chance to relay the partial result cleanly over IPC first). */
type LoadWorkerFromParentMessage = LoadWorkerStartMessage | { readonly type: 'abort' };

type LoadWorkerToParentMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'progress'; readonly snapshot: LoadProgressSnapshot }
  | { readonly type: 'done'; readonly result: LoadShardResult }
  | { readonly type: 'error'; readonly message: string };

/** The `--internal-load-worker` branch (M31, D19) — runs inside a process `loadCommand` forked via
 * `child_process.fork(process.argv[1], ['--internal-load-worker'], …)`. Never reads `argv`; every
 * piece of run-specific data (file, env, seed, its own shard index/count) arrives over the fork's
 * built-in IPC channel as one `LoadWorkerStartMessage`, once the parent hears this process's own
 * `ready` — avoids any risk of the parent's `send()` racing ahead of this process installing its
 * `message` listener. stdout/stderr are suppressed here (`loadCommand` sets `stdio: ['ignore',
 * 'ignore', 'ignore', 'ipc']`) — the parent already printed the file's scenario listing once;
 * N workers doing it again would just be noise. `message` stays a persistent listener (not `once`,
 * M32) so an `abort` message arriving after `start` is still handled — it flips the same
 * `AbortController` `runLoadShard`'s own VU loops already check. */
async function loadWorkerCommand(): Promise<number> {
  return new Promise<number>((resolvePromise) => {
    const controller = new AbortController();
    let started = false;
    process.on('message', (msg: LoadWorkerFromParentMessage) => {
      if (msg.type === 'abort') {
        controller.abort();
        return;
      }
      if (started) return;
      started = true;
      void (async () => {
        try {
          let seedArg: number | undefined;
          if (msg.seedRaw !== undefined) seedArg = Number(msg.seedRaw);
          const loaded = await loadAndValidate(msg.cwd, [msg.file], msg.env, false, undefined, msg.allowPublicTargets ?? []);
          if (typeof loaded === 'number') {
            process.send?.({ type: 'error', message: `worker failed to load ${msg.file}` } satisfies LoadWorkerToParentMessage);
            resolvePromise(EXIT_USAGE);
            return;
          }
          const { parsedFiles, environ, configLines } = loaded;
          // M118 (`FU-04`) — the parent's already-running demo, not one of this shard's own.
          const resolved = msg.demoBaseUrl ? withDemoBaseUrls(loaded.resolved, msg.demoBaseUrl) : loaded.resolved;
          const { file, source, program } = parsedFiles[0]!;
          const result = await runLoadShard(program, resolved, {
            source,
            baseDir: dirname(file),
            configDir: msg.cwd,
            configLines,
            seed: seedArg,
            now: msg.nowRaw,
            shard: { index: msg.shardIndex, count: msg.shardCount },
            abortSignal: controller.signal,
            onProgressTick: (snapshot) => process.send?.({ type: 'progress', snapshot } satisfies LoadWorkerToParentMessage),
            // Same fix as the single-process path above (M34 acceptance-milestone finding) — each
            // forked worker re-runs `loadAndValidate` independently (it never inherits the
            // parent's already-built `environ`, by design: `msg.cwd` lets a worker be pointed at
            // a different directory in principle), so it needs its own `.env`-merged environ
            // passed through here too, not just the parent's single-process call site.
            environ,
          });
          process.send?.({ type: 'done', result } satisfies LoadWorkerToParentMessage);
          resolvePromise(EXIT_OK);
        } catch (e) {
          process.send?.({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies LoadWorkerToParentMessage);
          resolvePromise(EXIT_FAIL);
        }
      })();
    });
    process.send?.({ type: 'ready' } satisfies LoadWorkerToParentMessage);
  });
}

/** Forks one `--internal-load-worker` child for shard `index` of `count` and resolves with its
 * `LoadShardResult` once it reports `done` (M31, D19) — rejects on `error`, a non-IPC-reporting
 * crash, or an unexpected exit before either. M32: relays each `progress` tick to `onProgress`, and
 * sends `{type:'abort'}` to the child the moment `abortSignal` fires so it can wind down and still
 * report a partial `done` rather than being killed mid-flight. */
function runShardInChildProcess(
  start: Omit<LoadWorkerStartMessage, 'type' | 'shardIndex' | 'shardCount'>,
  index: number,
  count: number,
  opts: { readonly onProgress?: (snapshot: LoadProgressSnapshot) => void; readonly abortSignal?: AbortSignal } = {},
): Promise<LoadShardResult> {
  return new Promise((resolvePromise, reject) => {
    const child: ChildProcess = fork(process.argv[1]!, ['--internal-load-worker'], { execArgv: process.execArgv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let settled = false;
    const onAbort = (): void => {
      child.send({ type: 'abort' } satisfies LoadWorkerFromParentMessage);
    };
    opts.abortSignal?.addEventListener('abort', onAbort);
    const cleanup = (): void => opts.abortSignal?.removeEventListener('abort', onAbort);
    child.once('message', (readyMsg: LoadWorkerToParentMessage) => {
      if (readyMsg.type !== 'ready') return;
      child.send({ type: 'start', ...start, shardIndex: index, shardCount: count } satisfies LoadWorkerStartMessage);
    });
    child.on('message', (msg: LoadWorkerToParentMessage) => {
      if (msg.type === 'progress') {
        opts.onProgress?.(msg.snapshot);
      } else if (msg.type === 'done') {
        settled = true;
        cleanup();
        resolvePromise(msg.result);
      } else if (msg.type === 'error') {
        settled = true;
        cleanup();
        reject(new Error(`load worker (shard ${index + 1}/${count}) failed: ${msg.message}`));
      }
    });
    child.once('error', (e) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(e);
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`load worker (shard ${index + 1}/${count}) exited unexpectedly (code ${code})`));
      }
    });
  });
}

/** M52 — this workload's planned wall-clock span for the "aborted at Ns of Nm planned" message, or
 * `0` for the 2 count-based kinds (D102 — no duration to predict in advance). */
function workloadPlannedMs(workload: Workload): number {
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
      return 0;
  }
}

/** Phase 2b — this program's own longest workload-bearing test's planned span, for that file's
 * live progress line's "Ns/Nm planned" (mirrors `tflw load`'s single-file `plannedMs`, now
 * computed per file since one `tflw run` invocation can process several). `0` for a file with no
 * workload-bearing tests (the progress line itself never renders in that case). */
function plannedMsFor(program: Program): number {
  const scenarios = program.tests.filter((t): t is TestDecl & { workload: Workload } => t.workload !== null);
  return Math.max(0, ...scenarios.map((s) => workloadPlannedMs(s.workload)));
}


/** M32 (R5) — pools every forked worker's latest progress tick into one snapshot for the live
 * console line, the same shape `mergeLoadShardReports` uses for the final report: sum
 * iterations/failures, take the furthest-along `elapsedMs`, OR/average the self-diagnoses
 * (`mergeSelfDiagnosis` — a single saturated worker is reason enough to flag the whole run live,
 * not just once at the end). */
function combineProgressSnapshots(snapshots: readonly LoadProgressSnapshot[]): LoadProgressSnapshot {
  return {
    iterations: snapshots.reduce((n, s) => n + s.iterations, 0),
    failures: snapshots.reduce((n, s) => n + s.failures, 0),
    elapsedMs: Math.max(0, ...snapshots.map((s) => s.elapsedMs)),
    selfDiagnosis: mergeSelfDiagnosis(snapshots.map((s) => s.selfDiagnosis)),
  };
}

/** M32 (R5) — "active VUs / current rps, error rate, rolling p95, elapsed vs. planned phase" from
 * the plan's own wording, minus rolling p95 (deliberately: `LoadProgressSnapshot` carries no
 * percentile data — computing one on every ~1Hz tick would defeat the point of a lightweight tick,
 * see its own doc comment). `rps` here is windowed (this tick vs. the last), not an average since
 * start, so it actually reflects "current" load the way the plan asks. */
function renderLoadProgressLine(current: LoadProgressSnapshot, previous: LoadProgressSnapshot | undefined, plannedMs: number, color: boolean): string {
  const windowMs = previous && current.elapsedMs > previous.elapsedMs ? current.elapsedMs - previous.elapsedMs : current.elapsedMs;
  const windowIterations = previous ? Math.max(0, current.iterations - previous.iterations) : current.iterations;
  const rps = windowMs > 0 ? (windowIterations / windowMs) * 1000 : 0;
  const errorRate = current.iterations > 0 ? (current.failures / current.iterations) * 100 : 0;
  const elapsedS = (current.elapsedMs / 1000).toFixed(1);
  const plannedS = (plannedMs / 1000).toFixed(1);
  const stats = `iterations: ${current.iterations}  failures: ${current.failures}  rps: ${rps.toFixed(1)}  error rate: ${errorRate.toFixed(2)}%  ${elapsedS}s/${plannedS}s planned`;
  if (!current.selfDiagnosis.saturated) return dim(color, stats);
  const warning = `⚠ ${stats}  — generator saturated`;
  return color ? `\x1b[33m${warning}\x1b[0m` : warning;
}

// M56 (Phase 3, D121/D122): the old `renderLoadSummary`/`renderLoadMetricsLine`/
// `renderSelfDiagnosisLine` final-summary trio is gone — a workload test's console lines now come
// from `renderCliSummary` itself (reporter package), folded in alongside functional ones. The
// *live*, mid-run ticker just above (`renderLoadProgressLine`) is unchanged; only the final
// summary unified.

// ---- tflw check -------------------------------------------------------------

interface CheckArgs {
  readonly files: string[];
  readonly env?: string | undefined;
  readonly noColor: boolean;
  /** `--format json` (decision 94) — only `json` is recognized; anything else is a usage error. */
  readonly format?: string | undefined;
  /** `--allow-public-target <origin>`, repeatable — the same flag `run` takes, and `check` takes it
   * for a reason that is not ceremony (D345): `check` answers *"will this run?"*, and after D342
   * the answer genuinely depends on it. Without it a project legitimately scanning a public staging
   * host could never get a clean `tflw check`, which would train everyone to ignore its output —
   * and an output everyone ignores is the failure mode this whole arc's diagnostics exist against.
   * Refused for `migrate`, like `--format`: migrate rewrites source and runs no checker pass whose
   * verdict this could change. */
  readonly allowPublicTargets: readonly string[];
}

/** Shared by `tflw check` and `tflw migrate`, which take *almost* the same flags — `command` is
 * passed so an unknown one is reported against the subcommand the user actually typed, and so
 * `--format` can be refused for `migrate` (D-M90-8/`B5-12`). It was accepted there, ignored, *and*
 * unvalidated: `tflw migrate --format xml` exited 0 having done nothing with the flag, while
 * `tflw check --format xml` rejects it. Migrate's output is a report of *edits*, a different shape
 * from `check`'s diagnostics array; inventing that JSON contract with no consumer asking is the
 * mistake that produced this cluster. `CLI_FLAGS` has never listed `--format` under `migrate`, so
 * `--help` and the docs-site reference already agreed with this — only the parser didn't. */
function parseCheckArgs(argv: string[], command: 'check' | 'migrate'): CheckArgs {
  const files: string[] = [];
  let env: string | undefined;
  let noColor = false;
  let format: string | undefined;
  const allowPublicTargets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env') env = flagValue(argv, ++i, a);
    else if (a.startsWith('--env=')) env = inlineFlagValue(a, '--env');
    else if (a === '--no-color') noColor = true;
    else if (a === '--format' || a.startsWith('--format=')) {
      if (command !== 'check') unknownFlag(command, a);
      format = a === '--format' ? flagValue(argv, ++i, a) : inlineFlagValue(a, '--format');
    } else if (a === '--allow-public-target' || a.startsWith('--allow-public-target=')) {
      if (command !== 'check') unknownFlag(command, a);
      allowPublicTargets.push(a === '--allow-public-target' ? flagValue(argv, ++i, a) : inlineFlagValue(a, '--allow-public-target'));
    } else if (a.startsWith('--')) unknownFlag(command, a);
    else files.push(a);
  }
  return { files, env, noColor, format, allowPublicTargets };
}

/** Validate-only: the exact same parse+checker pipeline `tflw run` runs before it executes
 * anything (decision 75) — teaching diagnostics, no HTTP traffic, no secrets required. For CI/
 * pre-commit: lint a suite without touching a live API. */
async function checkCommand(argv: string[]): Promise<number> {
  const args = parseCheckArgs(argv, 'check');
  const cwd = process.cwd();

  if (args.format !== undefined && args.format !== 'json') {
    err(`unknown --format \`${args.format}\` — only \`json\` is supported.`);
    return EXIT_USAGE;
  }

  if (args.format === 'json') {
    // Structured output for editor and CI integrations (decision 94): redirect each file's
    // diagnostics into `collected` instead of stderr text. Config-level failures (broken
    // tflw.config, unknown session service) still print text to stderr and return exit 2 as
    // always — they aren't any one file's problem.
    //
    // One entry per file checked, in discovery order, each naming its own file (M70, B6-07/A4-12).
    // The shape used to be a flat `Diagnostic[]` concatenated across every file, and `Diagnostic`
    // carries a span but no file — so two files with an error on the same line produced two
    // byte-identical entries and a consumer had no way to tell them apart. It only ever worked
    // when exactly one file was named, which nothing enforced and `--help` did not say. Decision
    // 94 wrote the contract for the single-file case the VS Code extension used, and that consumer
    // is gone (the LSP replaced it), leaving a machine-readable surface that was broken for its
    // documented use and about to freeze that way.
    //
    // Listing clean files too is what makes it a report of the *invocation* rather than a bag of
    // problems: an editor can clear stale diagnostics, and a top-level `[]` now means "nothing was
    // checked" (a config-level failure) instead of being ambiguous with "everything was clean".
    // Paths are relative to the cwd and POSIX-separated — text output matches the platform, a
    // machine contract should not.
    const collected: { file: string; diagnostics: Diagnostic[] }[] = [];
    const loaded = await loadAndValidate(
      cwd,
      args.files,
      args.env,
      false,
      (file, _source, diagnostics) => {
        collected.push({ file: relative(cwd, file).split('\\').join('/'), diagnostics: [...diagnostics] });
      },
      args.allowPublicTargets,
    );
    process.stdout.write(JSON.stringify(collected) + '\n');
    return typeof loaded === 'number' ? loaded : EXIT_OK;
  }

  const color = args.noColor ? false : process.stdout.isTTY === true;
  const loaded = await loadAndValidate(cwd, args.files, args.env, color, undefined, args.allowPublicTargets);
  if (typeof loaded === 'number') return loaded;

  const n = loaded.parsedFiles.length;
  // `no problems found` is only true when none were. Until D147 no shipped diagnostic used
  // `'warning'`, so this line had never been reachable in a state it described wrongly — the first
  // real warning printed it to stdout immediately below a `warning[TF043]` on stderr, which is the
  // report-honesty defect class this review has been closing everywhere else.
  const w = loaded.warningCount;
  process.stdout.write(w === 0 ? `${n} file${n === 1 ? '' : 's'} checked, no problems found.\n` : `${n} file${n === 1 ? '' : 's'} checked, ${w} warning${w === 1 ? '' : 's'}.\n`);

  // The reuse pass (M6, P#2) — advisory only, never affects the exit code: `tflw check` already
  // established every file is individually clean, and a reuse hint is a suggestion, not a defect.
  // Scanned over exactly the file set this invocation checked (`--format json` skips this — it's a
  // suggestion carrying a diff preview, not a diagnostic anchored to a span, so it has no place in
  // a per-file `diagnostics` array — which stays true now that the JSON shape covers every file).
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

  // Every byte this command would write, built in memory first — nothing reaches disk above the
  // re-check below (`B5-02` half 3, M97c/D143).
  const pending = new Map<string, string>([[actionFileAbs, hint.actionSource]]);
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

    pending.set(abs, source);
    changedFiles.push(path);
  }

  const rejected = await checkPendingRewrite(pending, loaded, color);
  if (rejected !== undefined) return rejected;

  await mkdir(dirname(actionFileAbs), { recursive: true });
  for (const [abs, source] of pending) await writeFile(abs, source, 'utf8');

  process.stdout.write(`applied ${hint.id}: extracted \`action ${hint.actionName}(${hint.params.join(', ')})\` into ${hint.actionFile}\n`);
  process.stdout.write(`  updated: ${changedFiles.sort().join(', ')}\n`);
  return EXIT_OK;
}

/**
 * Run the whole per-file checker over a rewrite that exists only in memory, and refuse it if the
 * result would not check (`B5-02` half 3, M97c/D143). Returns an exit code when the rewrite is
 * rejected — diagnostics already printed — or `undefined` when it is safe to write.
 *
 * **Why `refactor apply` owes this and `check` alone does not.** Half 1 (`TF035` widened to the
 * imported case) and half 2 (`dedupeName` seeded with the suite's existing actions) each remove a
 * way to *generate* a colliding extraction. Neither makes the tool verify its own output, and this
 * is the only command besides `migrate` that mutates source. `B5-01` — an **S1** — was this command
 * writing a suite that no longer checked, through reference channels the ledger enumerated as three
 * and turned out to be five; `M81` fixed it by making the reuse pass share the checker's *walk*.
 * This makes it share the checker's **verdict**, which is the only thing that covers the channel
 * nobody has enumerated yet. Enumerating this command's failure modes has already been wrong once,
 * at S1.
 *
 * It is refuse-*before*-write rather than write-then-rollback because that is already this
 * command's doctrine: it refuses at exit 2 with nothing written when the id is unknown, and again
 * when `shared/<name>.tflw` already exists. `migrate` splices, writes, then re-checks — the
 * opposite order, correctly, because a file it is asked to fix is broken *before* it starts.
 *
 * Both overlays matter and neither is optional. `readText` answers imports out of `pending`, since
 * the extracted `shared/<name>.tflw` is not on disk yet — without it every rewritten file reports
 * the new action as an unknown call. `exists` does the same for `TF043` (M97c's own new rule),
 * which would otherwise flag the `import` line this command just wrote.
 */
async function checkPendingRewrite(pending: ReadonlyMap<string, string>, loaded: ValidatedProject, color: boolean): Promise<number | undefined> {
  const cwd = process.cwd();
  const knownServices = Object.keys(loaded.resolved.services);
  const knownSessions = Array.from(loaded.resolved.sessions.keys());
  const privilegedSessions = knownSessions.filter((name) => loaded.resolved.sessions.get(name)?.privileged === true);
  const readPending: ReadText = async (absPath) => pending.get(absPath) ?? (await readFile(absPath, 'utf8'));
  const existsPending: PathExists = async (absPath) => pending.has(absPath) || (await exists(absPath));

  let rejected = false;
  for (const [abs, source] of pending) {
    const parsed = parseSource(source);
    // `M147c`/`M140-03` — same one-resolution-two-answers shape as `checkCommand`. A refactor that
    // would leave a suite importing an unparseable file is refused here for the same reason it is
    // refused for any other error, and it could not be before, because this call discarded the
    // only evidence that the import was broken.
    const imports = await resolveImportedActions(abs, parsed.program, readPending);
    const diagnostics = [
      ...parsed.diagnostics,
      ...checkProgram(parsed.program, {
        knownServices,
        knownSessions,
        privilegedSessions,
        outOfScopeSessions: { envName: loaded.resolved.envName, declaredElsewhere: loaded.resolved.sessionsOutOfScope },
        importedActions: imports.actions,
        importsWithErrors: imports.unparseable,
        missingFiles: await resolveMissingFiles(abs, parsed.program, existsPending),
      }),
    ].filter((d) => d.severity === 'error');
    if (diagnostics.length === 0) continue;
    rejected = true;
    writeStderr(renderDiagnostics(diagnostics, source, { filename: relative(cwd, abs), color }) + '\n');
  }
  if (!rejected) return undefined;

  err('applying this hint would leave a suite that does not check, so nothing was written. The diagnostics above are against the rewrite that was refused, not against your files on disk.');
  return EXIT_USAGE;
}

// ---- tflw migrate (P#38, decision 45's 1.0-gate deliverable, SPEC §12) -----

/**
 * Mechanically rewrites a suite past every checker-flagged deprecation (decision 38): a diagnostic
 * carrying a `deprecation.replacement` gets its exact source span spliced with that replacement,
 * file by file, the same widest-first ordering `refactorCommand` already uses for its own edits.
 * Unlike `refactor apply <id>`, there is no id to pick — every deprecation the checker finds
 * across the discovered files is applied in one pass (a deprecation is never something to leave
 * half-migrated on purpose).
 *
 * `loadAndValidate`'s own `onFileDiagnostics` hook is how this sees diagnostics: it fires for every
 * file checked, whatever the severity, so a plain `tflw migrate` run needs no separate checker
 * invocation of its own.
 *
 * **Best-effort, then re-check (D-M90-1, `B5-11`).** This used to return the moment
 * `loadAndValidate` reported a failure — before the splice loop and before any output — so a file
 * containing *any* checker error produced **zero bytes on stdout, zero on stderr, and exit 2**. Not
 * just a file containing removed syntax: an ordinary typo. On a clean file migrate explained itself
 * politely; on a broken file, the only kind it exists for, it said nothing at all. The cause was
 * that `onFileDiagnostics` *replaces* rendering rather than supplementing it, and this command's
 * hook only filled a `Map`.
 *
 * So: splice everything that has a payload, write, then **re-run the whole pipeline against what is
 * now on disk** and let it render whatever remains. Two rejected alternatives, both worse:
 * all-or-nothing-per-file would make a tool whose purpose is unbreaking a file refuse *because* the
 * file is broken (`B5-05` restated); splicing and then telling the user to run `tflw check` would
 * print carets against pre-splice offsets, and most replacements change length — two of the three
 * keyword renames do, and every `M147b` config payload does, since it drops a pair of quotes —
 * (`scenario`→`test` is −4, `uncheck`→`untick` is −1), so those carets would underline the wrong
 * text. Re-checking is the only way residual diagnostics point at the bytes the user will open.
 *
 * Exit contract: `0` when the file is clean afterwards, `2` when errors remain — **including when
 * migrate successfully did work and the file still fails.** Unusual, correct, and documented in
 * SPEC §12: migrate's job is the rewrite, not the verdict.
 */
async function migrateCommand(argv: string[]): Promise<number> {
  const args = parseCheckArgs(argv, 'migrate');
  const cwd = process.cwd();
  const color = args.noColor ? false : process.stdout.isTTY === true;

  const changedFiles = new Set<string>();
  let residualFiles = new Map<string, { source: string; diagnostics: Diagnostic[] }>();
  let clean = false;
  let hitCap = false;

  // `tflw.config` FIRST, and outside the loop below — `M147b`, and a promise this command could not
  // otherwise keep.
  //
  // `loadAndValidate` renders a config-level failure itself and returns before the per-file hook has
  // fired even once, so `byFile` comes back empty and the loop below returns immediately. Measured
  // rather than assumed: with `D623`'s retirement diagnostic in place, `tflw migrate` on a config
  // holding `log level "warn"` printed the diagnostic, exited 2 and **left the file exactly as it
  // was** — while the diagnostic's own help line said "`tflw migrate` rewrites this for you". The
  // first three real deprecations the grammar has ever had are all config directives, and the
  // command that exists to answer them could not see the file they live in.
  //
  // A pre-pass rather than a change to `loadAndValidate`: every other caller wants a config that
  // does not parse to be a hard stop, and only this one wants to fix it. Single-pass by
  // construction — a config directive's payload replaces a quoted string with a bare keyword, which
  // no rule refuses, so there is nothing a second pass could find.
  //
  // It runs whatever files were named, including none, because `tflw.config` is not a discovered
  // file — it is the thing that makes discovery possible, and a retired spelling in it blocks every
  // other file in the suite. Rewriting it is reported like any other change (`migrated 1 file:`),
  // so `tflw migrate one.tflw` touching the config is visible rather than a surprise.
  const configPath = join(cwd, 'tflw.config');
  try {
    const configText = await readFile(configPath, 'utf8');
    const edits = collectMigrations(parseConfigSource(configText).diagnostics, configText);
    if (edits.length > 0) {
      await writeFile(configPath, applyMigrations(configText, edits), 'utf8');
      changedFiles.add(relative(cwd, configPath));
    }
  } catch {
    // No `tflw.config` here at all. Not this pre-pass's business to say so: `loadAndValidate` below
    // reports it with the `tflw init` advice, and reporting it twice would be worse than once.
  }

  // Repeat until a pass finds nothing left to rewrite (M90b). The plan predicted one pass would
  // always suffice — "recovery is not a problem, `recoverTopLevel()` resyncs cleanly" — and a probe
  // disproved it: `recoverTopLevel()` skips the *entire* offending block, so a `think` inside a
  // `scenario` is invisible to the parser until `scenario` itself is fixed. One pass rewrote
  // `scenario`→`test` and exited 2 pointing at a `think` it had not been able to see. That is
  // honest, and it is still a tool that does half its job and tells you to run it again.
  //
  // Termination is structural rather than a hope: every edit replaces a retired spelling with a live
  // one, the supply of retired spellings in a file is finite, and no rewrite can introduce one. That
  // property is asserted rather than argued — `stepKeywords.test.ts` holds every `REFUSED_WORDS`
  // replacement to being live grammar, and `M147b`'s config-directive payloads replace a quoted
  // string with the bare keyword the parser now wants, which nothing refuses. The cap is a backstop
  // for a future rule that breaks that property, not the mechanism.
  const MAX_PASSES = 10;
  for (let pass = 0; ; pass++) {
    const byFile = new Map<string, { source: string; diagnostics: Diagnostic[] }>();
    const loaded = await loadAndValidate(cwd, args.files, args.env, color, (file, source, diagnostics) => {
      byFile.set(file, { source, diagnostics: [...diagnostics] });
    });
    // A config-level failure — no `tflw.config`, an unresolvable env, a named file that isn't there,
    // nothing discovered — is not something a splice can help with, and `loadAndValidate` has
    // already printed it in full (the hook only intercepts *per-file* batches). `byFile` is the
    // discriminator: the hook fires once for every file checked, clean or not, so an empty map
    // alongside a numeric return means the run never reached a file at all.
    if (typeof loaded === 'number' && byFile.size === 0) return loaded;

    // Whatever this pass saw describes the bytes currently on disk, since the hook is handed the
    // source `loadAndValidate` just read. Keeping it is what lets the report below render residual
    // diagnostics at post-splice offsets without parsing everything a second time.
    residualFiles = byFile;
    clean = typeof loaded !== 'number';
    if (pass >= MAX_PASSES) {
      hitCap = true;
      break;
    }

    let edited = 0;
    for (const [file, { source, diagnostics }] of byFile) {
      const edits = collectMigrations(diagnostics, source);
      if (edits.length === 0) continue;
      await writeFile(file, applyMigrations(source, edits), 'utf8');
      changedFiles.add(relative(cwd, file));
      edited++;
    }
    if (edited === 0) break;
  }


  if (changedFiles.size > 0) {
    const names = [...changedFiles].sort();
    process.stdout.write(`migrated ${names.length} file${names.length === 1 ? '' : 's'}:\n`);
    process.stdout.write(`  ${names.join('\n  ')}\n`);
  } else {
    process.stdout.write('no deprecated syntax found — nothing to migrate.\n');
  }

  if (clean) {
    if (changedFiles.size > 0) process.stdout.write('the rewritten suite checks clean.\n');
    return EXIT_OK;
  }

  // Residual diagnostics, against what is on disk now. Rendered from the last pass rather than by
  // re-running the pipeline: same bytes, same offsets, one fewer parse of the whole suite.
  for (const [file, { source, diagnostics }] of residualFiles) {
    if (diagnostics.length === 0) continue;
    writeStderr(renderDiagnostics(diagnostics, source, { filename: relative(cwd, file), color }) + '\n');
  }
  process.stdout.write(
    hitCap
      ? `\nstopped after ${MAX_PASSES} passes with rewrites still pending — that should be impossible, so please report it.\n`
      : changedFiles.size > 0
        ? '\nevery rewrite migrate had was applied, and the suite still has errors — the diagnostics above are against the rewritten files.\n'
        : '\nthe errors above are not deprecations, so migrate has no rewrite for them.\n',
  );
  return EXIT_USAGE;
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
    process.stdout.write(renderTopicIndex(topics));
    process.stdout.write(`\nrun \`tflw docs <topic>\` to read one, e.g. \`tflw docs matchers\`.\n`);
    // M92c (`FU-17`) — this is the one place that names SPEC.md *and* has room to say where it is.
    // The npm package doesn't ship SPEC.md (`files: ["dist", "THIRD-PARTY-NOTICES.md"]`), so before
    // this a reader who wanted the source these sections are cut from had nowhere to go.
    process.stdout.write(`the full SPEC lives at ${SPEC_URL}.\n`);
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

// ---- tflw spec (M154a, PLAN_M154_DOGFOOD_CONFORMANCE.md, D736-D738) ---------

/**
 * `tflw spec [--json]` — print the construct manifest of *this build*: every step keyword, matcher,
 * generator, locator, config word and diagnostic code the parser dispatches, plus a build stamp.
 *
 * ## Why a command and not a file
 *
 * `testFlow-tests` is this language's conformance target, and until `M154` nothing joined the set
 * of constructs tflw ships to the set the dogfood exercises. The measured cost
 * (`PLAN_M154_DOGFOOD_CONFORMANCE.md` §2): seven step keywords with **zero** occurrences across 126
 * `.tflw` files, fourteen more appearing exactly once in exactly one file, and four of the six
 * workload shapes never executed by anything. That happened because no gate could ask the question
 * — the sibling repo's only tflw dependency is a self-contained bundled tarball with no `@tflw/*`
 * packages to import, so a coverage gate there has no module to read `STEP_KEYWORDS` out of. A
 * subcommand is the one surface it *does* have.
 *
 * ## The build stamp, and the row it closes (`M153b-01`)
 *
 * On 2026-08-25 a local `npm run check:acceptance` in `testFlow-tests` reported `probe ciphers` as
 * unknown grammar. It was not: `M137g` had shipped it nine days earlier. `check-acceptance.mjs`
 * grades the **vendored** `node_modules/tflw` (`resolveTflw('released')`), which `npm run
 * refresh-tflw` re-vendors and a plain `npm run build` in tflw does not — so the red was a
 * nine-day-old binary, indistinguishable in its output from a real grammar gap. The wrong
 * conclusion reached a pull-request body before CI contradicted it.
 *
 * So the stamp is not decoration. `version`/`commit`/`builtAt` are what let a consumer say *which*
 * tflw it just graded, and `M154b` wires that into `check-acceptance.mjs` and the coverage gate.
 * **This milestone makes the information available; it does not yet close the row** — the row's
 * condition is that a stale copy cannot produce a red that reads as a grammar failure, and nothing
 * reads the stamp until the sibling side lands.
 *
 * `commit` is `null` rather than invented when there is no git to ask (an `npm pack` from a
 * published tarball, a vendored checkout) — a fabricated sha would be worse than none, because it
 * would be believed. `source: 'dev'` marks the unbundled `npm run dev` path, where the esbuild
 * `define`s do not exist and the answer is honestly "this is not a build".
 */
async function specCommand(argv: string[]): Promise<number> {
  let json = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    // `--format json` is deliberately *not* accepted as a second spelling (D738). `run --format
    // ndjson` and `check --format json` name a member of an open set of renderings; `spec` has one
    // machine format and one human one, so the flag is the boolean it looks like. Two spellings for
    // one thing is the drift this repository keeps paying for elsewhere.
    else if (a.startsWith('--')) unknownFlag('spec', a);
    else {
      err(`unexpected argument \`${a}\`. Usage: tflw spec [--json]`);
      return EXIT_USAGE;
    }
  }

  const manifest = {
    manifest: SPEC_MANIFEST_VERSION,
    build: await buildStamp(),
    constructs: specConstructs(),
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return EXIT_OK;
  }

  const { build, constructs } = manifest;
  const lines: string[] = [
    `tflw ${build.version} — ${constructs.length} constructs, manifest v${manifest.manifest}`,
    `  build: ${describeBuild(build)}`,
    '',
  ];
  // Grouped by family then group, in manifest order, so the human rendering and `--json` present
  // the same thing in the same sequence — a reader comparing the two is comparing one list.
  let heading = '';
  for (const c of constructs) {
    const key = c.family === c.group ? c.family : `${c.family} / ${c.group}`;
    if (key !== heading) {
      heading = key;
      lines.push(`${key}:`);
    }
    lines.push(`  ${c.name}${c.status === 'planned' ? '  (planned)' : ''}`);
  }
  lines.push('', 'machine-readable: `tflw spec --json`', `the full SPEC lives at ${SPEC_URL}.`, '');
  process.stdout.write(lines.join('\n'));
  return EXIT_OK;
}

interface BuildStamp {
  readonly version: string;
  /** `bundle` — built by `packages/cli/scripts/bundle.mjs`, which is what the npm tarball ships and
   *  what a consumer vendors. `dev` — run unbundled through `tsx`, where the `define`s do not
   *  exist. A consumer grading a build should refuse `dev`: it has no provenance to check. */
  readonly source: 'bundle' | 'dev';
  readonly commit: string | null;
  /** Whether the working tree had uncommitted changes at bundle time. Its own field rather than a
   *  `-dirty` suffix on `commit`, so a consumer comparing shas does not have to strip it first. */
  readonly dirty: boolean | null;
  readonly builtAt: string | null;
}

async function buildStamp(): Promise<BuildStamp> {
  const version = await getVersion();
  if (typeof __TFLW_BUILD_TIME__ !== 'string') {
    return { version, source: 'dev', commit: null, dirty: null, builtAt: null };
  }
  const commit = typeof __TFLW_COMMIT__ === 'string' && __TFLW_COMMIT__ !== '' ? __TFLW_COMMIT__ : null;
  return {
    version,
    source: 'bundle',
    commit,
    // Restated here rather than trusted from the `define`, because the two can only be got wrong
    // together: with no commit there is nothing for `dirty` to be relative to, and a `false` would
    // read as "the tree was clean" when in fact nobody looked.
    dirty: commit === null ? null : typeof __TFLW_DIRTY__ === 'boolean' ? __TFLW_DIRTY__ : null,
    builtAt: __TFLW_BUILD_TIME__,
  };
}

/** One line naming a build, shared by `tflw spec`'s human rendering and reused by anything else
 * that needs to say which tflw is speaking. Says `unknown commit` out loud rather than omitting the
 * field: a stamp that silently drops what it could not learn reads as a complete answer. */
function describeBuild(b: BuildStamp): string {
  if (b.source === 'dev') return 'dev (unbundled — no provenance)';
  const sha = b.commit ? `${b.commit}${b.dirty ? '-dirty' : ''}` : 'unknown commit';
  return `${sha}, built ${b.builtAt}`;
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
 * decision 111/M17, `--bail` under `--parallel > 1`: no hard-abort/cancellation-token plumbing into
 * `runProgram`, just stop starting new work). Items never claimed are simply absent from the
 * returned array, not `undefined` holes. `--parallel`, not `--workers` — this pool is the *file*
 * concurrency axis; `--workers` forks load-generation processes and never reaches here (`B5-04`).
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

/**
 * D331 — the two blind-spot numbers, assembled for the report.
 *
 * **Two fields rather than one percentage**, and the reason is `M126`'s rule that a denominator
 * travels on the same line as its count. `coverage` counts over the whole discovered suite, before
 * any filter; `declines` counts over the assertions that actually ran. A single combined figure
 * would have a base that moved with `--tags`, which is the shape this ledger keeps re-filing.
 *
 * Returns `undefined` when there is nothing to say — a suite with no `api` step at all and no
 * decline — so an ordinary run's report and summary are byte-for-byte unchanged.
 */
/**
 * M134b (D389) — collapse the per-assertion censuses into `RunReport.scanCoverage`, which is
 * `M128-01`'s fix.
 *
 * **A rule that applied anywhere is applied.** The row is about a report that cannot say which rules
 * stood down; a rule that judged one response and had nothing to say about another did not stand
 * down, and listing it under both headings would answer the question with a contradiction. So
 * `applied` wins, and only rules that applied *nowhere* in the run are reported as not applicable —
 * with every distinct reason they gave, deduplicated, because a forty-assertion suite must not print
 * one sentence forty times to say one thing.
 *
 * Sorted, so two runs of the same suite produce a byte-identical block and a diff of two reports
 * shows a real change rather than a hash-order shuffle.
 */
/**
 * M134b (D386) — `--fail-on`'s value, validated against the one severity vocabulary.
 *
 * Rejects rather than defaults, and names the four values, because every wrong spelling here fails
 * in the dangerous direction: a `--fail-on high` silently read as "no floor" produces a run that
 * gates on everything when its author asked for less, and a `--fail-on` silently read as "gate on
 * nothing" produces a green build nobody asked for. Neither is discoverable from the output.
 */
function parseFailOn(raw: string): FindingSeverity {
  const value = raw.trim().toLowerCase();
  if (!(FAIL_ON_VALUES as readonly string[]).includes(value)) {
    throw new Error(`--fail-on was given \`${raw}\`, which is not a severity.\n  write one of: ${FAIL_ON_VALUES.join(', ')}`);
  }
  return value as FindingSeverity;
}

const FAIL_ON_VALUES = ['minor', 'moderate', 'serious', 'critical'] as const;

/**
 * M134b (D388) — `--probe-seeded`'s value.
 *
 * `Number(raw)` alone would accept `1e3`, ` 12 `, `0x10` and `Infinity`, and reject none of them in a
 * way the operator would notice — a run that quietly drew a thousand payloads per class against a
 * strictly sequential prober is a suite that looks hung. The pattern is checked before the parse, and
 * the bound is `MAX_SEEDED_PER_CLASS`'s so there is one number rather than two that can disagree.
 *
 * Refused rather than clamped: a clamp makes the run quieter than the flag the operator typed, and
 * the whole argument for this layer is that its output is read rather than trusted.
 */
function parseProbeSeeded(raw: string): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`--probe-seeded was given \`${raw}\`, which is not a whole number of payloads per class.\n  write a number from 0 to ${MAX_SEEDED_PER_CLASS}`);
  }
  const n = Number(value);
  if (n > MAX_SEEDED_PER_CLASS) {
    throw new Error(
      `--probe-seeded ${n} exceeds the ${MAX_SEEDED_PER_CLASS}-per-class bound.\n` +
        '  probes are strictly sequential (one in flight), so this is wall-clock a single assertion pays —\n' +
        '  narrow the run with `--tags` rather than widening the corpus',
    );
  }
  return n;
}

function buildScanCoverage(byScan: ReadonlyMap<ScanKind, { applied: Set<string>; notApplicable: Map<string, Set<string>> }>): ScanRuleCensus[] {
  const out: ScanRuleCensus[] = [];
  for (const [scan, bucket] of [...byScan].sort((a, b) => a[0].localeCompare(b[0]))) {
    const notApplicable = [...bucket.notApplicable]
      .filter(([rule]) => !bucket.applied.has(rule))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([rule, reasons]) => ({ rule, because: [...reasons].sort() }));
    out.push({ scan, applied: [...bucket.applied].sort(), notApplicable });
  }
  return out;
}

function buildScanBlindSpot(
  census: { apiSteps: number; withOwner: number },
  declines: readonly ScanDecline[],
): RunReport['scanBlindSpot'] | undefined {
  // Aggregated by scan + subject + reason, because the useful unit is *what could not be judged and
  // for whom*: five assertions all declining `shopper` for the same CSRF-shaped 403 is one fact with
  // a count, not five lines — and Tier 3, whose matrix is dozens wide, would otherwise contribute
  // one row per payload it never sent.
  //
  // D418a — `scan` joins the **key**, not merely the value. Two tiers can name the same subject
  // (`anonymous` is a principal today, and nothing stops a payload class being called that), and a
  // key that collapsed them would report one count for two unrelated facts.
  const counts = new Map<string, { scan: ScanKind; subject: string; reason: string; count: number }>();
  for (const d of declines) {
    const key = `${d.scan}\u0000${d.subject}\u0000${d.reason}`;
    const row = counts.get(key);
    if (row) row.count++;
    else counts.set(key, { scan: d.scan, subject: d.subject, reason: d.reason, count: 1 });
  }
  const aggregated = [...counts.values()].sort((a, b) => b.count - a.count || a.scan.localeCompare(b.scan) || a.subject.localeCompare(b.subject));
  if (census.apiSteps === 0 && aggregated.length === 0) return undefined;
  return {
    ...(census.apiSteps > 0 ? { coverage: census } : {}),
    ...(aggregated.length > 0 ? { declines: aggregated } : {}),
  };
}

/** Combine per-file reports into one run report, in original file order regardless of the
 * per-file worker concurrency that produced them (P#47). M56 (Phase 3, D118): also merges each
 * file's own `selfDiagnosis`/`inconclusive`/`aborted` (present only for a file that had a
 * workload-bearing test) — `inconclusive`/`aborted` become "true if any contributing file's was,"
 * `selfDiagnosis` merges via the same N-way `mergeSelfDiagnosis` already used for shard merging. */
function mergeReports(
  reports: readonly RunReport[],
  envName: string,
  authorizedTargets: readonly AuthorizedTarget[],
  seed: number,
  now: string,
  insecure: boolean,
  browserEngine: BrowserEngine,
  evidenceLevel: EvidenceLevel,
  demo: boolean,
  scanBlindSpot?: RunReport['scanBlindSpot'],
  /** M134b (D385/D389) — the run's scan findings and rule census, collected across every file by the
   *  one shared `ScanSink` rather than merged out of per-file reports: like the authz declines
   *  beside them, these are the *run's* numbers, and `--workers N` finishes files out of order. */
  scan?: { readonly findings: readonly ScanFinding[]; readonly coverage: readonly ScanRuleCensus[] },
): RunReport {
  const tests: ReportEntry[] = reports.flatMap((r) => r.tests);
  const passed = tests.filter((t) => t.ok).length;
  const diagnoses = reports.map((r) => r.selfDiagnosis).filter((d): d is SelfDiagnosis => d !== undefined);
  const abortedReport = reports.find((r) => r.aborted);
  // `A12-01`: union, not first-wins. The CLI shares one `Redactor` across every file, so in practice
  // each file's report already carries the whole set — but a file that finished before a later one
  // registered a short secret snapshotted an earlier state, and under `--workers N` the finishing
  // order is not the starting order. Deduplicated, insertion-ordered.
  const unmaskableSecrets = [...new Set(reports.flatMap((r) => r.unmaskableSecrets ?? []))];
  // `M114` (`M111-01`) — `ok` is stamped by the one shared derivation, not by this expression: a
  // merged run whose `aborted`/`inconclusive` came from *some other* file still has to come out
  // `ok: false`, and `tests.every(...)` alone cannot see that.
  return finalizeVerdict({
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
    evidenceLevel,
    browserEngine,
    // Omitted rather than `false` for an ordinary run (M118/D202): the flag exists to mark the
    // unusual case, and every pre-M118 `RunReport` fixture stays valid without it.
    ...(demo ? { demo: true } : {}),
    // D291 — omitted rather than `[]` for the same reason `demo` is: the field marks the unusual
    // case (a suite that scans something), and every pre-M128b fixture stays valid without it.
    ...(authorizedTargets.length > 0 ? { authorizedTargets } : {}),
    // D331 — omitted entirely for a suite with no authorization assertion and no `api` step, so a
    // pre-M130b fixture stays valid and an ordinary run gains no line. D418a renamed the field when
    // Tier 3 joined it; the omission rule is unchanged.
    ...(scanBlindSpot ? { scanBlindSpot } : {}),
    // D385/D389 — omitted rather than `[]` for `authorizedTargets`' reason: a run with no security
    // assertion gains no line, and every pre-M134b fixture stays valid without them.
    ...(scan && scan.findings.length > 0 ? { findings: scan.findings } : {}),
    ...(scan && scan.coverage.length > 0 ? { scanCoverage: scan.coverage } : {}),
    ...(unmaskableSecrets.length > 0 ? { unmaskableSecrets } : {}),
    ...(diagnoses.length > 0 ? { selfDiagnosis: mergeSelfDiagnosis(diagnoses), inconclusive: reports.some((r) => r.inconclusive) } : {}),
    ...(abortedReport ? { aborted: true, abortedMessage: abortedReport.abortedMessage } : {}),
  });
}

function tick(color: boolean, ok: boolean): string {
  if (!color) return ok ? '✓' : '✗';
  return ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
}

/** `debug` dim, `info` plain, `warn` yellow, `error` red — same ANSI palette `tick`'s ✓/✗ already
 * uses (32 green / 31 red), extended with 2 (dim) and 33 (yellow) for the two levels that aren't
 * pass/fail-shaped (M27, PLAN_LOG.md). */
const LOG_LEVEL_ANSI: Readonly<Record<LogLevel, string>> = { debug: '\x1b[2m', info: '', warn: '\x1b[33m', error: '\x1b[31m' };

/** A `log` step's console line (M27, PLAN_LOG.md decisions 118/119/122): unconditional whenever
 * its effective destination includes console and its level clears `logLevelThreshold` — never
 * gated on `--verbose` or the enclosing test's pass/fail, unlike every other step kind. Returns
 * `undefined` when the destination excludes console (`'html'`/`'none'`) or the level falls below
 * threshold, so `formatEvent` treats a filtered-out log step exactly like any other step that
 * prints nothing this run — the step is still fully recorded in `results.json`/ndjson regardless
 * (decision 119/122), only console *display* is skipped here. */
function formatLogLine(step: StepResult, color: boolean, logLevelThreshold: LogLevel): string | undefined {
  const destination = step.destination ?? 'both';
  if (destination === 'html' || destination === 'none') return undefined;
  const level = step.level ?? 'info';
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[logLevelThreshold]) return undefined;
  const label = level.toUpperCase();
  const prefix = color && LOG_LEVEL_ANSI[level] ? `${LOG_LEVEL_ANSI[level]}[${label}]\x1b[0m` : `[${label}]`;
  return `  ${prefix} ${step.detail ?? ''}`;
}

/** Maps one `RunEvent` to the text block it produces on the console, or `undefined` if this event
 * prints nothing — shared by the live ticker and the buffered-per-file collector below so both
 * stay in lockstep (the console consumes the same event stream the report is built from, per
 * decision 86, but never becomes the report's own data source).
 *
 * `test:end`, failing: always prints — `✗ name` plus each failing step's already-capped/
 * subset-aware `detail` (gap #8's `truncate()`/`subsetMismatches()`, baked into `StepResult.detail`
 * by the time it gets here) indented underneath, live, with no flag and no TTY requirement, so a
 * failure is diagnosable without opening report.html even in a piped/CI run. When no step printed
 * anything — a test that died before the first one ran — the test-level `error` takes their place
 * (`M147c`/`A4-18`), so the promise in the sentence before this one holds for every failure and not
 * only for the ones that got far enough to have a step.
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
function formatEvent(ev: RunEvent, color: boolean, verbose: boolean, githubActions: boolean, logLevelThreshold: LogLevel): string | undefined {
  const grouping = verbose && githubActions;
  // A `log` step is unconditional author signal (M27, PLAN_LOG.md decision 118) — checked before
  // the `--verbose`-gated branch below so it never double-prints under `--verbose` and never goes
  // silent without it; `formatLogLine` itself returns `undefined` for a destination/level this
  // step doesn't clear, same "print nothing this event" contract every other branch here follows.
  if (ev.type === 'step:end' && ev.step.kind === 'log') return formatLogLine(ev.step, color, logLevelThreshold);
  if (verbose && ev.type === 'test:start') return grouping ? `::group::${ev.name}` : ev.name;
  if (verbose && ev.type === 'step:end') {
    const label = ev.step.detail ?? ev.step.kind;
    return `  ${tick(color, ev.step.ok)} ${label} (${ev.step.durationMs}ms)`;
  }
  if (ev.type === 'test:end') {
    // M88d (`B3-11`): a workload-bearing test emits a `test:start`/`test:end` pair now, but it
    // renders on the *human* console through two purpose-built surfaces instead of this one — the
    // live `\r`-updated progress line during the run (iterations/error rate/elapsed, which a
    // newline-terminated tick line would land on top of and smear), and `renderCliSummary`'s
    // workload block at the end (metrics, one tick per declared `threshold`, back-off warning,
    // per-endpoint breakdown). A bare `✗ name` says strictly less than either and costs the
    // progress line. The stream itself is unaffected: `--format ndjson` serializes `RunEvent`s
    // directly and never reaches `formatEvent`, and that consumer is the whole of the finding.
    if (ev.result.kind === 'workload') return undefined;
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
      // `M147c`/`A4-18` — the same rule `failureLines` applies in `renderCliSummary` (`M113-02`):
      // a test that died before any step could fail has nothing to iterate, so the loop above
      // printed a name and stopped. `M146a` fixed the summary block and folded its two copies into
      // one function; this is a **third** sink it did not reach, and the live ticker is the one a
      // person is actually watching. Kept as a condition on what *this* surface printed rather than
      // as a call to `failureLines`: that function renders `✗ <source>` per failing step and this
      // one renders the step's detail alone, so their "nothing was said yet" tests are genuinely
      // different — a failing step with no `detail` is silent here and not there. Sharing the
      // rendering would change the live line; sharing the rule is what matters and is what this is.
      if (lines.length === 1 && ev.result.error) {
        for (const line of ev.result.error.split('\n')) lines.push(`    ${line}`);
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

/**
 * Every piece of `tflw run`'s console output goes through this one write path so `--log-file`
 * (PLAN decision 111/M17) can mirror it — always plain text, independent of what stdout itself is
 * doing.
 *
 * **`M111` (review row `B6-05`) rewrote how it writes, because "buffer it all and write once at the
 * end" was the single cause of four separate defects**, each measured:
 *
 *  1. `--log-file logs/run.log` with no `logs/` directory: the run passed, printed
 *     `PASS 1/1 passed`, wrote `report.html` — and then `writeFile` hit `ENOENT`, which reached
 *     `main`'s top-level catch and made the whole invocation **exit 2**. A fully green suite
 *     reported as "usage / config error — could not run". `logs/`, `artifacts/` and `.tflw-logs/`
 *     are the paths a person actually picks.
 *  2. `--log-file ok.log bad.tflw` where `bad.tflw` has a parse error: the run returns from
 *     `loadAndValidate` long before the old `save()`, so **no file was produced at all** — in
 *     exactly the case a user reaches for a log.
 *  3. `err()` and `renderDiagnostics` write straight to `process.stderr` and never passed through
 *     here, so even on a successful run "duplicates console output" meant *stdout only*. Every
 *     error line — the thing a log is kept for — was missing.
 *  4. `err()` hard-coded `\x1b[31m`, ignoring `--no-color` and whether stderr is even a terminal.
 *
 * The fix for all four is the same and is structural rather than four patches: **open the file
 * before the run and write through it.** A path that cannot be opened now fails at exit 2 *before
 * anything runs*, which is the one moment "could not run" is a true statement; a run that returns
 * early has already written everything it printed; and `stderr` is mirrored through the same sink,
 * so the log holds what the terminal held. Ordering stays trivially correct because the writes are
 * synchronous, in the same order as the `process.stdout`/`process.stderr` writes beside them.
 *
 * A write that fails *mid-run* is reported once and then abandoned: by then the run is under way,
 * and a failing side-channel must not be able to rewrite the verdict of the tests themselves.
 */
function makeConsole(logFile: string | undefined): { write: (text: string) => void; close: () => void } {
  if (logFile === undefined) {
    return { write: (text) => void process.stdout.write(text), close: () => {} };
  }

  // Throws to the caller, which turns it into `exit 2` before a single test runs. `mkdir -p` on the
  // parent is deliberate: `--log-file logs/run.log` says where the log goes, and refusing to make
  // one directory would be a distinction without a purpose — `report`'s own output directory is
  // created the same way.
  mkdirSync(dirname(resolve(logFile)), { recursive: true });
  const fd = openSync(logFile, 'w');
  let broken = false;
  let closed = false;

  const mirror = (text: string): void => {
    if (broken) return;
    try {
      writeSync(fd, stripAnsi(text));
    } catch (e) {
      broken = true;
      process.stderr.write(`\x1b[31merror\x1b[0m: --log-file ${logFile} stopped being writable mid-run (${(e as Error).message}); the run itself is unaffected\n`);
    }
  };

  logMirror = mirror;
  return {
    write(text: string) {
      process.stdout.write(text);
      mirror(text);
    },
    close() {
      if (closed) return; // idempotent: the run's own success path and the wrapper both call it
      closed = true;
      logMirror = undefined;
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to say: everything worth logging is already on disk and on the terminal.
      }
    },
  };
}

/**
 * `M111` (`B6-05`) — where `stderr` goes in addition to `stderr`, while a `--log-file` run is in
 * flight. Module-level rather than threaded because `err()` is called from 41 places and
 * `renderDiagnostics` from 6, most of them in commands that have no console object at all; passing
 * a sink to each would be a large diff whose only content is "and also this one".
 *
 * `undefined` outside a `--log-file` run, which is every other command.
 */
let logMirror: ((text: string) => void) | undefined;

/**
 * `M111` (`B6-05`) — whether `err()` emits ANSI. It used to emit red unconditionally: piping
 * `tflw run` to a file or a CI log produced a literal `\x1b[31merror\x1b[0m:` in text that nothing
 * was going to render, and `--no-color` — which every other output path in this file honours — did
 * not reach it. Defaults to what the stream itself reports and is narrowed once flags are parsed.
 */
let stderrColor = process.stderr.isTTY === true;

/** Everything written to stderr goes through here so `--log-file` mirrors it (`B6-05`, case 3). */
function writeStderr(text: string): void {
  process.stderr.write(text);
  logMirror?.(text);
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
function liveEmit(out: { write: (text: string) => void }, color: boolean, verbose: boolean, githubActions: boolean, timestamps: boolean, logLevelThreshold: LogLevel): EventSink {
  return (ev) => {
    const line = formatEvent(ev, color, verbose, githubActions, logLevelThreshold);
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
  logLevelThreshold: LogLevel,
): { sink: EventSink; flush: () => void } {
  const lines: string[] = [];
  const sink: EventSink = (ev) => {
    const line = formatEvent(ev, color, verbose, githubActions, logLevelThreshold);
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

/** `exclude` (SPEC §3, D127, PLAN_DISCOVERY_EXCLUDE.md) — paths relative to `cwd` (== the
 * `tflw.config` directory, see `loadAndValidate`) that this walk skips: a directory is not
 * descended into, a `.tflw` file is not collected. Matched by exact relative-path equality at any
 * depth, not a glob (decision 5) — a no-op for a path that doesn't exist, same tolerance a
 * `.gitignore` line has for a pattern matching nothing (decision 4). Only affects this bare,
 * no-file-args walk — an explicit file arg inside an excluded path is resolved elsewhere and still
 * runs. */
async function discoverTests(cwd: string, exclude: readonly string[] = [], reportDir?: string): Promise<string[]> {
  const found: string[] = [];
  // M137d — tflw's OWN output directory is never a source of tests, and this is a correctness fix
  // rather than tidiness. The repro emitter writes runnable `.tflw` files under `reportDir`
  // (`authz-repro/`, `input-repro/`), so without this the *next* bare `tflw run` in the same project
  // discovers them and runs them as part of the suite — and they are designed to FAIL until the bug is
  // fixed, so a run that found one weakness reports two failures, one of which is tflw's own artifact.
  //
  // **Latent since `M130b`**, not new here: `report/` starts with no dot and is not `node_modules`, so
  // authorization repros have always been discoverable this way. Nothing had triggered it because no
  // test ran twice in one directory with a finding; Tier 3's e2e does exactly that, and it turned up as
  // `FAIL 1/6 passed` where five of the six "tests" were emitted repros.
  //
  // Deliberately not folded into `exclude`: that list is the user's statement about their own tree, it
  // is echoed back in diagnostics, and a path the user never wrote does not belong in it.
  const skipReport = reportDir === undefined ? undefined : relative(cwd, resolve(cwd, reportDir)).split('\\').join('/');
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
      // The equality test used to live inside the `isDirectory()` branch, so a file entry could
      // never match and `exclude "b.tflw"` was a silent no-op (M73, review finding B6-10) — while
      // §3.9 opens by calling these "paths" and a user who wants one known-broken file out of the
      // default sweep has no reason to read that as directories-only. It is checked for both kinds
      // now. Separators are normalised because `relative()` returns them platform-style, and
      // nobody writes `exclude "a\\b"` — that mismatch was the same silent no-op on Windows.
      const rel = relative(cwd, full).split('\\').join('/');
      if (exclude.includes(rel)) continue;
      // `''` would mean the report dir IS `cwd`, which cannot be skipped without discovering nothing —
      // so a project configured that way keeps the old behaviour rather than silently finding no tests.
      if (skipReport !== undefined && skipReport !== '' && rel === skipReport) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.tflw')) found.push(full);
    }
  };
  await walk(cwd);
  return found.sort();
}

// ---- tflw init -------------------------------------------------------------

async function initCommand(argv: string[]): Promise<number> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'tflw.config');
  const examplePath = join(cwd, 'example.tflw');
  const envExamplePath = join(cwd, '.env.example');
  const packageJsonPath = join(cwd, 'package.json');
  // `tflw init --load` (M29, D30) — bundled into the first grammar milestone rather than
  // deferred: it only needs the `ramp`/`threshold` grammar this milestone already builds (M50,
  // D93-D95: written inside an ordinary `test` body, not a separate `scenario` keyword), and
  // scaffolds the **open** (`ramp to N rps`) workload form, matching D17's "docs lead with it".
  // `initCommand` never inspected argv beyond this one `includes`, so `tflw init --lod` scaffolded
  // without `load.tflw` and exited 0 without mentioning the flag (B6-11's quiet variant).
  for (const a of argv) if (a.startsWith('--') && a !== '--load') unknownFlag('init', a);
  const load = argv.includes('--load');
  const loadPath = join(cwd, 'load.tflw');

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
  if (load && !(await exists(loadPath))) {
    await writeFile(loadPath, SCAFFOLD_LOAD, 'utf8');
    created.push('load.tflw');
  }
  // Secrets hygiene from day one (decision 82, restoring decision 36's original promise): a tool
  // whose flagship feature is "secrets never leak into reports" shouldn't leave `.env` committable
  // in its own quickstart.
  if (!(await exists(envExamplePath))) {
    await writeFile(envExamplePath, SCAFFOLD_ENV_EXAMPLE, 'utf8');
    created.push('.env.example');
  }
  // The other half of `FU-15` (M125b2, D259). The documented `.ts` escape hatch loads via Node's
  // native type stripping, and Node warns loudly when it has to *guess* the module type — which it
  // does whenever a `package.json` exists and declares no `"type"`. **Measured, and not what the row
  // implied:** with no `package.json` anywhere above the helper Node emits nothing at all, so the
  // trigger is a manifest without the key, not the absence of a manifest.
  //
  // Which makes the key here mandatory rather than a nicety: `init` writing a `package.json` at all
  // is what creates the condition, so writing one *without* `"type": "module"` would hand a fresh
  // project the exact warning this row is about. Created only when absent, like `.env.example` and
  // `.gitignore` above — a `package.json` a user already has is theirs, and adding a key to it is
  // not `init`'s business.
  if (!(await exists(packageJsonPath))) {
    await writeFile(packageJsonPath, SCAFFOLD_PACKAGE_JSON, 'utf8');
    created.push('package.json');
  }
  if (await ensureGitignore(cwd)) created.push('.gitignore');

  process.stdout.write(`created ${created.join(', ')}\n\nnext:\n  tflw run\n${load ? '  tflw run load.tflw\n' : ''}`);
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
  # tflw's own demo service — a real HTTP server on localhost, started for the run and stopped
  # after it, so \`tflw run\` is green before you have wired anything up. Swap this one line for
  # your service and \`example.tflw\` tests that instead:
  #
  #   api "http://localhost:3001"
  api "${DEMO_BASE_URL}"

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

// `"type": "module"` is the whole point (M125b2, `FU-15`): without it, the first `use "./x.ts"`
// makes Node guess the module type and say so, in four lines, above the results. `private: true`
// because a test suite is not a package anyone publishes, and leaving it off makes an accidental
// `npm publish` in this directory a live possibility.
const SCAFFOLD_PACKAGE_JSON = `{
  "private": true,
  "type": "module"
}
`;

const SCAFFOLD_TEST = `# An API test. \`api\` sends a request; \`expect\` asserts against the last response.

test "health check"
  api GET /health
  expect status equals 200
`;

// `tflw init --load` (M29, D30). The **open** (arrival-rate) workload form — D17's own reasoning
// for leading with it: VUs loop in the closed form, so a slow system just makes VUs back off and
// issue fewer requests (understating latency); the open form keeps arriving on schedule and lets
// queueing show up honestly. Run it with \`tflw run load.tflw\`.
const SCAFFOLD_LOAD = `# A load test. A \`test\` becomes a per-VU loop instead of a single pass as soon as it has a
# \`ramp to …\` workload line — reuses ordinary steps, so anything an \`action\` already does works
# here too.

test "health check under load"
  ramp to 20 rps over 10s
  api GET /health
  expect status equals 200
  threshold p95 duration is less than 500ms
  threshold error rate is less than 1%
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
  const label = stderrColor ? '\x1b[31merror\x1b[0m' : 'error';
  writeStderr(`${label}: ${message}\n`);
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
      '  tflw run [files...] [--env <name>] [--seed <n>] [--now <iso>] [--tag <name>[,<name>...]] [--only <name>] [--parallel <n>] [--no-color] [--verbose]',
      '            [--failed] [--bail] [--format ndjson] [--no-timestamps] [--log-file <path>] [--browser chromium|firefox|webkit] [--headed] [--update-snapshots]',
      '            [--workers <n>] [--skip-workload] [--forbid-insecure] [--allow-public-target <origin>] [--evidence full|headers-only|none]',
      '            [--log-output console|html|both|none]',
      '            [--fail-on minor|moderate|serious|critical] [--baseline <file>] [--baseline-write <file>] [--probe-seeded <n>]',
      '            [--log-level debug|info|warn|error]',
      '                                                      run .tflw tests (default: all under cwd), functional and workload-bearing (a `ramp to …`',
      '                                                      line, or another of the 5 workload shapes) alike, in file declaration order — a `parallel`/',
      '                                                      `sequential` header modifier controls each test\'s concurrency with its file-siblings',
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
      '                                                      --forbid-insecure refuses to run at all if `insecure true` is active for this env (a CI policy gate)',
      '                                                      --evidence <level> how much request/response detail the report keeps: full (default), headers-only, none',
      '                                                      --allow-public-target <origin> affirms an originating scan may reach a host outside the private',
      '                                                      ranges (SPEC §3.10, TF065); repeatable, must match an `authorized target`; no tflw.config key by design',
      '                                                      --log-output <dest> where a bare `log "…"` goes: console|html|both|none',
      '                                                      --fail-on <severity> security findings below this severity are reported but do not fail the',
      '                                                      build (SPEC §9.12); it can only relax the matcher a test wrote, never tighten it',
      '                                                      --baseline <file> accepted findings, matched by fingerprint; they still render, marked known/accepted',
      '                                                      --baseline-write <file> writes this run\'s findings out as the accepted set (stale entries are',
      '                                                      reported, never removed — a --tag run legitimately produces a subset)',
      '                                                      --probe-seeded <n> n generated mutation payloads per already-granted class, on top of the fixed',
      '                                                      corpus; reported and never gating, and it cannot widen what `authorized target` permitted',
      '                                                      --log-level <level> minimum level a `log` step must clear to be rendered: debug|info|warn|error',
      '                                                      --parallel <n> runs up to n *files* concurrently in this process (default: tflw.config\'s `workers`)',
      '                                                      --workers <n> forks n *processes* to generate one file\'s workload-bearing tests\' load;',
      '                                                      a no-op warning on a file with none (unrelated to --parallel; default: 1, no forking)',
      '                                                      --skip-workload skips every workload-bearing test, for fast iteration on functional tests alone',
      '                                                      always written: report/{report.html,junit.xml,results.json,.last-run.json} — workload-bearing',
      '                                                      tests render inline alongside functional ones, no separate load-* artifacts (M56)',
      '                                                      also written when a browser run has one: report/assets/{screenshots,traces}/',
      '                                                      Ctrl-C flushes a partial report; exit 3 = inconclusive (generator saturated), 130 = aborted, else 0/1',
      '  tflw check [files...] [--env <name>] [--no-color] [--format json] [--allow-public-target <origin>]',
      '                                                      validate only — no execution, no secrets needed;',
      '                                                      --format json is for editor integrations (VS Code)',
      '                                                      --allow-public-target <origin> the same affirmation `run` takes, so a suite that legitimately',
      '                                                      scans a public host can still get a clean check (repeatable)',
      '  tflw init [--load]                                 scaffold tflw.config + example.tflw',
      '                                                      --load also scaffolds load.tflw (a workload-bearing `test`, M29/M50)',
      '  tflw docs [topic]                                  print a SPEC.md cheatsheet section; no topic lists them all',
      '  tflw spec [--json]                                 print this build\'s construct manifest — every step keyword, matcher, generator,',
      '                                                      locator, config word and diagnostic code it dispatches, plus a build stamp',
      '                                                      (version, commit, build time). --json is the machine form a conformance gate reads',
      '  tflw lsp                                           run the Language Server over stdio (for editor integrations)',
      '  tflw install-browsers [--browser chromium|firefox|webkit]',
      '                                                      download a browser binary for UI steps (SPEC §9); default chromium.',
      '                                                      Needs the optional `playwright` peer installed first (npm install -D playwright)',
      '  tflw pick <url> [--browser chromium|firefox|webkit]',
      '                                                      click an element in a real browser window, print its best locator (SPEC §12, M5);',
      '                                                      runs until the window is closed or Ctrl+C — <url> must be absolute',
      '  tflw watch [files...] [--env <name>] [--seed <n>] [--browser chromium|firefox|webkit] [--no-color]',
      '                                                      re-run headed on every save, one browser window for the whole session (SPEC §12, M5);',
      '                                                      saving tflw.config re-runs everything; runs until Ctrl+C',
      '  tflw refactor apply <id>                           apply a reuse-pass extraction (SPEC §8/§12, M6);',
      '                                                      `tflw check` prints available ids (RF001, RF002, …) alongside its diagnostics',
      '  tflw migrate [files...] [--env <name>] [--no-color]',
      '                                                      mechanically rewrite past checker-flagged deprecations (decision 38/45, SPEC §12);',
      '                                                      rewrites `scenario`→`test`, `think`→`pause`, `uncheck`→`untick`. Any diagnostic that says',
      '                                                      "run `tflw migrate` to apply this automatically" is one it can act on — bare `check <locator>`',
      '                                                      deliberately is not, since only you can say whether it meant `tick` or an assertion.',
      '                                                      Works on files that do not parse; exits 2 if errors remain after the rewrite',
      '  tflw --version, -v                                 print the installed version',
      '  tflw --help, -h                                    show this message',
      '',
      // M92c (`FU-17`) — several lines above cite SPEC.md and SPEC §-numbers, and the npm package
      // does not ship SPEC.md. Naming the location once here is the whole fix: the citations
      // themselves are provenance ("a SPEC.md cheatsheet section"), which is fine to keep, as long
      // as the reader is told once where the thing being cited actually lives.
      `  the SPEC these §-references point at: ${SPEC_URL}`,
      '',
    ].join('\n'),
  );
}

main(process.argv.slice(2))
  .then(async (code) => {
    // M35c — a no-op if this run never used mTLS (the worker child is only ever spawned lazily,
    // on the first request that needs it); otherwise stops it from outliving the run.
    await shutdownMtlsWorker();
    process.exit(code);
  })
  .catch(async (e) => {
    err(e instanceof Error ? e.message : String(e));
    await shutdownMtlsWorker();
    process.exit(EXIT_USAGE);
  });
