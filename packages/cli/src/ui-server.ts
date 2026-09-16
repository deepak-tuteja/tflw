// `tflw ui` — the local server behind the page for a `.tflw` project (`M192` U1).
//
// The page is a projection of the file and of the report directory, never a second truth
// (`D985`), and this server is the whole of what it may touch: it reads the project (the config,
// the discovered files, the tests in them), it runs `tflw run --format ndjson` as a child and
// relays the stream (`D986` — the page is one more reader of the artefact CI reads), it lists and
// serves report directories, and it cancels a run.
//
// **It writes exactly one kind of thing, through exactly one function** (`M200` `A0-2`, `D1049`).
// Slice 1 had no write path at all and its green condition grepped this file to prove it; `A0`
// makes the page an authoring surface, so that rule is replaced rather than dropped — the grep
// now demands a single `writeFile` call site, inside `writeProjectFile` below, and nothing else.
// A capability that arrives by widening a guard until it admits the new thing leaves no guard;
// one that arrives by narrowing the guard to the new thing's own shape keeps it.
//
// **The server refuses, it does not author.** `@tflw/lang` has no dependencies and no Node
// builtins, so the page runs `parse`/`print`/`format` itself and hands this route a finished
// file. What the route adds is the part a client cannot be trusted with: the bytes on disk must
// still be the bytes the client's edit was computed against (`If-Match`, a content hash), the
// text must parse with no error diagnostic, and `format()` must already be a fixpoint on it. A
// `.tflw` file that does not parse can therefore not be written through this server at all,
// which is what `D985` is protecting — the file is the only truth, so an unreadable file is a
// truth nobody can read.
//
// The run's record is its report directory (§2 q6). `tflw run` writes one directory per project
// (`report dir`, config) and overwrites it, so a run from the page is exactly a run from the
// terminal — same command, same files — and when it ends the server copies the directory aside,
// as `<reportDir>/runs/<id>/`, so the page has a past to open. Copies, not a format: every file
// in a kept run is a file the contract already names. If a second reader ever wants history, it
// becomes a `report keep` key and this copy retires (`D986`'s rule for a need the page finds).
//
// Loopback only. The server binds `127.0.0.1` and that is the boundary (§8): a project's `.env`,
// its report evidence and a `POST /api/run` that spawns a process are not things to put on a LAN.
// Reaching it from another machine is `ssh -L`, which is how the dogfood on the box is used.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir, stat, cp, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, dirname, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { parseSource, parseConfigSource, format, lensesOfTest, lensesOfCrawl, LENSES, type Lens } from '@tflw/lang';
import { resolveConfig, selectEnv } from '@tflw/runtime';
import { discoverTests } from './project.js';

export const UI_DEFAULT_PORT = 4141;

export interface UiServerOptions {
  /** The project directory — where `tflw.config` lives and `tflw run` runs. */
  readonly root: string;
  /** The entry `tflw run` is spawned from: `dist/cli.cjs` in the bundle, `src/cli.ts` under tsx. */
  readonly cliEntry: string;
  /** Node flags the child needs to load the entry — `['--import', 'tsx']` for the source entry,
   * nothing for the bundle. Never the parent's whole `process.execArgv`: under `node --test` that
   * carries `--test` itself, and the child would run as a test runner instead of as tflw. */
  readonly execArgv?: readonly string[];
  /** Where the page's static bundle is; defaults to `ui/` beside `cliEntry`. */
  readonly staticDir?: string;
}

export interface ProjectTest {
  readonly name: string;
  readonly tags: readonly string[];
  readonly line: number;
  readonly workload: boolean;
  /**
   * Which of the four doors this test appears behind (`D1043`), **derived from the constructs it
   * carries** — never from `@load`, `@security` or any other tag, which the runtime has never read.
   * Computed by `lensesOfTest` in `@tflw/lang` so that this server and the page compute it with
   * the same code rather than with two implementations that can disagree.
   *
   * Empty is a real answer: a test of nothing but `let` and `expect {v}` does none of the four
   * kinds of work. Measured over both repositories, 22 of 761 tests are empty here, and three of
   * those are empty because their whole body is one `call` into an action declared in an imported
   * file — evidence one indirection away, which a per-test pure function cannot follow.
   */
  readonly lenses: readonly Lens[];
}

/** A `crawl` declaration — the SCANS door's own, and a sibling to `test` rather than a kind of
 *  one (`D432`). Its lenses are always `['scan']`. */
export interface ProjectCrawl {
  readonly name: string;
  readonly line: number;
  readonly lenses: readonly Lens[];
}

export interface ProjectFile {
  /** Relative to the root, `/`-separated. */
  readonly path: string;
  readonly tests: readonly ProjectTest[];
  readonly crawls: readonly ProjectCrawl[];
  /** Parse diagnostics, counted — the page shows the file as unparseable, the LSP shows why. */
  readonly diagnostics: number;
}

export interface ProjectView {
  readonly root: string;
  readonly envs: readonly { name: string; isDefault: boolean }[];
  readonly reportDir: string;
  readonly files: readonly ProjectFile[];
  /** Whether `/trace/` serves Playwright's trace viewer — true when `playwright-core` resolves
   * from the project (`M192` U3). The page shows *open trace* when it does and the
   * `npx playwright show-trace` line when it does not. */
  readonly traceViewer: boolean;
  /** `D1047`'s scratch file, and whether git will ignore it (`M200` `A1-5`).
   *
   * The path is fixed so that exploring an endpoint always overwrites one file rather than
   * littering a project. `scratchIgnored` is an **exact-line** check against `.gitignore`, which
   * is the same shape `tflw init` writes with — so it is right for every project `init` made and
   * a *false negative* for a project whose ignore rule is spelled another way (`*.tflw`, a
   * directory rule, a global excludes file). A false negative costs a notice the author can
   * dismiss; the alternative — shelling out to `git check-ignore` — puts a subprocess behind a
   * read route for a line of advice. */
  readonly scratchPath: string;
  readonly scratchIgnored: boolean;
  /**
   * The env's `web` base, or `null` when it declares none (`M200` `A3-6`).
   *
   * The BROWSER door reads it for two things: composing the URL `tflw pick` opens, and knowing
   * whether picking is possible at all. A project with no `web` base cannot run a browser test
   * either — `TF0..`'s *every browser step in this env would be refused before it navigates* — so
   * saying it once on the door is better than saying it per step in a terminal.
   */
  readonly webBaseUrl: string | null;
  /**
   * The active env's authorization facts, so the page's `tflw check` preview can run
   * `checkAuthorizedTargets` (`M200` `A2-3`).
   *
   * **`D1052` said the form shows what `tflw check` will say, and for SCANS it could not.**
   * `diagnose` ran `checkProgram` with no options, and `TF060` — the one diagnostic certain to
   * fire on a fresh scan project, and the whole reason `D1053`'s scaffold exists — needs the
   * env's declarations and base URL. The page had no way to learn either, so the SCANS door
   * would have previewed a clean file and written one that fails in a terminal: exactly the
   * surprise `D1052` exists to prevent, on the one door where it is guaranteed rather than
   * possible.
   *
   * Read off `resolved`, like the rest of this function, because `resolve.ts` has already
   * composed `defaults` + `env` — a second composition here is the two-copies-of-one-rule shape
   * this file keeps warning about. Shaped as `EnvAuthorizedTargets` so the page hands it to the
   * checker unchanged rather than translating, which is where a second account would creep in.
   */
  readonly authorization: {
    readonly envName: string;
    /**
     * `resolved.authorizedTargets` verbatim — **including the `probe` opt-ins**, which the first
     * draft of this type left out. They travel on the wire whether the type names them or not, so
     * omitting them would have been a type that under-describes its own JSON; and they are not
     * noise here, because `probe mutating` is what lets `has no authorization violations` re-issue
     * a write, and a SCANS form has a use for knowing it.
     */
    readonly targets: readonly {
      readonly target: string;
      readonly reason: string;
      readonly probeMutating: boolean;
      readonly probeOversized: boolean;
      readonly probeTraversal: boolean;
      readonly probeCiphers: boolean;
    }[];
    readonly apiBaseUrl: string | null;
    readonly services: readonly { readonly name: string; readonly url: string }[];
  };
}

/** Where `Send` writes. One file, overwritten, never merged — it is an exploration, not a suite. */
export const SCRATCH_PATH = 'scratch.tflw';

/**
 * Every file `tflw init` can write, under any flag — what `runInit` reports as `created`.
 *
 * A door's scaffold belongs here the day the CLI learns to write it; `A2-4` added `--scan` and
 * this list did not move for four commits. See `runInit` for why it is an allow-list and not a
 * directory read.
 */
export const SCAFFOLDED = ['tflw.config', 'example.tflw', 'load.tflw', 'scan.tflw', '.env.example', 'package.json'] as const;

/** What `tflw run` is asked for. Every field maps to one CLI flag, and nothing else reaches the
 * argv: the page cannot run anything a terminal could not. */
export interface RunRequest {
  readonly files?: readonly string[];
  readonly tags?: readonly string[];
  readonly only?: string;
  readonly env?: string;
  readonly workers?: number;
  /** `--evidence LEVEL` (`M200` `A1-5`) — `D1047`'s Send needs `full`, because that is the level
   *  at which a step record carries its `request` and `response` (§1). Raw text, validated by
   *  `runCommand` against `EVIDENCE_LEVELS` exactly as a terminal's `--evidence` is: the page
   *  cannot ask for a level a terminal could not. */
  readonly evidence?: string;
}

export type RunStatus = 'running' | 'done' | 'cancelled';

export interface RunRecord {
  readonly id: string;
  readonly startedAt: string;
  readonly request: RunRequest;
  readonly argv: readonly string[];
  status: RunStatus;
  exitCode: number | null;
  /** The signal the child died of, when it did — `null` for a plain exit. */
  signal: string | null;
  endedAt: string | null;
  /** Where the run's report directory was kept, relative to the root, once it ended. */
  kept: string | null;
}

export interface ReportEntry {
  readonly id: string;
  readonly path: string;
  readonly at: string;
  readonly files: readonly string[];
  readonly summary: { ok: boolean; total: number; passed: number; failed: number } | null;
}

/** The argv `tflw run` gets for a request — pure, so a test can hold the mapping still. */
export function runArgv(req: RunRequest): string[] {
  const argv = ['run', '--format', 'ndjson', '--no-color'];
  if (req.env) argv.push('--env', req.env);
  if (req.workers !== undefined) argv.push('--workers', String(req.workers));
  // One `--tag a,b`, the CLI's own spelling (comma-joined, AND across the list).
  if (req.tags && req.tags.length > 0) argv.push('--tag', req.tags.join(','));
  if (req.only) argv.push('--only', req.only);
  if (req.evidence) argv.push('--evidence', req.evidence);
  for (const f of req.files ?? []) argv.push(f);
  return argv;
}

/**
 * `tflw init [--load|--scan]` for a door — `M200` `A0-5` (`D1051`), amended by `A2-4` (`D1053`).
 *
 * The door decides what a new project is scaffolded with, which is the second half of `D1042`'s
 * "a door decides where you land and what the new-test button scaffolds, and nothing else".
 *
 * **`D1051` said "what it decides with is one flag, because `tflw init` has one flag", and `A2-4`
 * gave it a second.** That sentence is amended here rather than deleted, because the shape it
 * described was right and only its arithmetic moved: SCANS now gets `--scan` and therefore a
 * `scan.tflw` plus the commented `authorized target` `D1053` argues for. BROWSER still has no
 * scaffold of its own and still gets the plain project — stated rather than papered over, because
 * a door that pretended otherwise would be a brochure.
 */
/**
 * The absolute URL `tflw pick` opens for a path the author typed — `M200` `A3-6` (`D1055`).
 *
 * **`tflw pick` reads no config and requires an absolute URL, by its own design.** Its doc comment
 * says so: it *"has no notion of a `web` base URL"*, unlike `open "/path"` inside a `.tflw` file,
 * which resolves against one. So the gap between what an author types in a browser form — a path,
 * because that is what `open` takes — and what the command needs has to be closed by somebody, and
 * closing it here is the same shape as `A2-3`'s `authorization` block: the server hands the page a
 * fact composed from the config it already read, rather than the page assembling a second account
 * of what the config says.
 *
 * `null` when the env declares no `web` base, which is not a failure to report but a question to
 * answer: there is no page to pick from, and the door says so instead of spawning a browser at a
 * URL it invented.
 */
export function pickUrl(webBaseUrl: string | null, path: string): string | null {
  if (webBaseUrl === null) return null;
  const trimmed = path.trim();
  // Already absolute: the author pasted a whole URL, which `pick` takes verbatim. Anything else is
  // a path and joins the base, with exactly one slash between them however either was written.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `${webBaseUrl.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
}

/** What `tflw pick` gets — one URL and nothing else, so the page cannot ask for a session a
 *  terminal could not open. */
export function pickArgv(url: string): string[] {
  return ['pick', url];
}

export function initArgv(door: Lens): string[] {
  if (door === 'load') return ['init', '--load'];
  if (door === 'scan') return ['init', '--scan'];
  return ['init'];
}

/** The project as the page sees it: config envs, the discovered files, the tests in each. */
export async function readProject(root: string): Promise<ProjectView> {
  const configText = await readFile(join(root, 'tflw.config'), 'utf8');
  const parsed = parseConfigSource(configText);
  const envs = parsed.config.envs.map((e) => ({ name: e.name, isDefault: e.isDefault }));
  // The default env's view of `exclude` and `report dir` — both are `defaults`-only keys, so any
  // env gives the same answer; the default is the one a bare `tflw run` would take.
  const env = selectEnv(parsed.config, { envVar: process.env.TFLW_ENV });
  const resolved = resolveConfig(parsed.config, env); // the page reads `exclude`/`report dir` only — a URL override does not change either
  const files: ProjectFile[] = [];
  for (const file of await discoverTests(root, resolved.exclude, resolved.reportDir)) {
    const source = await readFile(file, 'utf8');
    const { program, diagnostics } = parseSource(source);
    files.push({
      path: relative(root, file).split(sep).join('/'),
      tests: program.tests.map((t) => ({
        name: t.name.value,
        tags: t.tags,
        line: t.span.start.line,
        workload: t.workload !== null,
        lenses: lensesOfTest(t),
      })),
      // `crawls` is absent, not empty, on a program that declares none (`ast.ts:44` — it keeps
      // 31 parser goldens asserting what they were written to assert).
      crawls: (program.crawls ?? []).map((c) => ({ name: c.name.value, line: c.span.start.line, lenses: lensesOfCrawl(c) })),
      diagnostics: diagnostics.length,
    });
  }
  const authorization = {
    envName: resolved.envName,
    targets: resolved.authorizedTargets,
    apiBaseUrl: resolved.apiBaseUrl,
    services: Object.entries(resolved.services).map(([name, url]) => ({ name, url })),
  };
  return { root, envs, reportDir: resolved.reportDir, files, traceViewer: traceViewerDir(root) !== null, scratchPath: SCRATCH_PATH, scratchIgnored: scratchIsIgnored(root), authorization, webBaseUrl: resolved.webBaseUrl ?? null };
}

/**
 * Whether `.gitignore` carries the scratch path as a line of its own (`A1-5`).
 *
 * The same exact-line test `tflw init`'s own `ensureGitignore` writes with, and deliberately no
 * more: a project whose rule is `*.tflw` or a directory pattern gets a **false negative**, which
 * costs a dismissible notice. The accurate answer is `git check-ignore`, and putting a subprocess
 * behind a read route to render one line of advice is a worse trade than being wrong quietly in
 * the safe direction.
 */
function scratchIsIgnored(root: string): boolean {
  try {
    const text = readFileSync(join(root, '.gitignore'), 'utf8');
    return text.split('\n').some((line) => line.trim() === SCRATCH_PATH);
  } catch {
    return false;
  }
}

/** Playwright's own trace viewer — the static page `npx playwright show-trace` serves — resolved
 * through the project the traces belong to, which is where its `playwright` is (`M192` U3, §2
 * q8: the archive is handed to Playwright's viewer, not to a viewer of tflw's). Served by this
 * process under `/trace/` so that a page reached over `ssh -L` opens a trace in the reader's own
 * browser, and nothing is spawned; the viewer fetches the archive from `/api/reports/…`, the same
 * origin. `null` when the project has no `playwright-core`, which is also a project that could
 * not have written a trace. */
export function traceViewerDir(root: string): string | null {
  try {
    const manifest = createRequire(join(root, 'package.json')).resolve('playwright-core/package.json');
    const dir = join(dirname(manifest), 'lib', 'vite', 'traceViewer');
    return existsSync(join(dir, 'index.html')) ? dir : null;
  } catch {
    return null;
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.sarif': 'application/json; charset=utf-8',
  '.tflw': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8',
  // The trace viewer's own files (`M192` U3).
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** A path under `base`, or null when the request escapes it — the one check every file route
 * runs, written once. `resolve` normalises `..`; the prefix test is on the separator boundary so
 * `report-evil/` cannot pass as `report/`. */
export function safeJoin(base: string, requested: string): string | null {
  const full = resolve(base, requested);
  const root = resolve(base);
  return full === root || full.startsWith(root + sep) ? full : null;
}

/** The identity of a file's bytes, for `If-Match`. A content hash and not an mtime: two writes
 *  inside one filesystem timestamp tick are indistinguishable by mtime, and a hash also survives
 *  a checkout that rewrites timestamps without changing content. Short because it is compared,
 *  never searched. */
export function etagOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export interface FileWriteRefusal {
  readonly status: 400 | 404 | 409 | 422;
  readonly error: string;
  /** The diagnostic that stopped it, when the refusal is `422` and the text does not parse. */
  readonly code?: string;
  readonly line?: number;
}

/**
 * Resolve a client-supplied project-relative path to a `.tflw` file inside the root.
 *
 * Three refusals, each for its own reason: outside the root (the boundary this whole server is),
 * not a `.tflw` file (this route exists to write tests, and `tflw.config` or a `.env` reached
 * through it would be a different capability wearing this one's clothes), and an absolute or
 * drive-qualified path (which `resolve` would honour rather than join).
 */
export function resolveWritablePath(root: string, requested: string): string | FileWriteRefusal {
  if (requested.length === 0) return { status: 400, error: 'no path' };
  if (requested.includes('\0')) return { status: 400, error: 'not a path' };
  const full = safeJoin(root, requested);
  if (full === null) return { status: 400, error: 'outside the project' };
  if (extname(full) !== '.tflw') return { status: 400, error: 'only a .tflw file can be written here' };
  return full;
}

/**
 * The only function in this file that writes. Everything it refuses, it refuses *before* opening
 * anything for writing, so a rejected request leaves the file exactly as it was.
 *
 * `ifMatch` is the hash the client's edit was computed against: `null` means "this file should
 * not exist yet", which is how a new test file is created and how two pages racing to create the
 * same one are separated. A mismatch is `409` and carries the current hash, so the client can
 * re-read and re-apply rather than guess.
 *
 * The write itself goes to a sibling temp file and is renamed over the target. `rename` within a
 * directory is atomic on every filesystem tflw runs on, so a reader — `tflw run` in another
 * terminal, most likely — sees either the old file or the new one and never a half-written one.
 */
export async function writeProjectFile(
  root: string,
  requested: string,
  text: string,
  ifMatch: string | null,
): Promise<{ readonly path: string; readonly etag: string } | FileWriteRefusal> {
  const resolved = resolveWritablePath(root, requested);
  if (typeof resolved !== 'string') return resolved;

  // Parse before anything else: the page is the author, and this is the claim the page cannot be
  // trusted to make about itself.
  const { diagnostics } = parseSource(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) {
    return { status: 422, error: error.message, code: error.code, line: error.span.start.line };
  }
  // And it must already be what `format` would write. Not a courtesy: it means the bytes the page
  // holds and the bytes on disk are the same bytes, so the next `If-Match` the page sends is
  // computed over something that exists. A server that silently reformatted would hand back an
  // etag for a file the page has never seen.
  const formatted = format(text);
  if (!formatted.ok) return { status: 422, error: formatted.reason ?? 'the text cannot be formatted' };
  if (formatted.formatted !== text) return { status: 422, error: 'the text is not formatted — run format() before sending it' };

  let current: string | null;
  try {
    current = await readFile(resolved, 'utf8');
  } catch {
    current = null;
  }
  if (current === null && ifMatch !== null) return { status: 404, error: 'no such file — omit If-Match to create it' };
  if (current !== null && ifMatch === null) return { status: 409, error: 'the file already exists — send its If-Match to replace it' };
  if (current !== null && etagOf(current) !== ifMatch) {
    return { status: 409, error: 'the file changed on disk since it was read' };
  }

  await mkdir(dirname(resolved), { recursive: true });
  const temp = `${resolved}.tflw-ui-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, resolved);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
  return { path: relative(root, resolved).split(sep).join('/'), etag: etagOf(text) };
}

/**
 * `[Discard]` removes the scratch file — `M200` `A2-6`, closing §7's oldest open fork (`D1054`).
 *
 * **`A1-5` emptied it, and the measurement says emptying is not dropping.** An emptied
 * `scratch.tflw` is still a file, so `discoverTests` still finds it, so `readProject` still
 * returns it and the landing's footer still counts it: a project with one test reads
 * `2 files` forever after somebody explores an endpoint once and changes their mind. Nothing
 * clears it, because nothing else writes that path. Measured on a scaffolded project — `files=1`
 * before Send, `files=2` after, and **still `files=2` after Discard**.
 *
 * The fork was argued from the server's write surface and never from what the author sees, which
 * is how it came out wrong. `D1049`'s gate is *one `writeFile` call site*, and it stands here
 * untouched: this route does not write, and it takes **no path** — `SCRATCH_PATH` is a constant
 * of this module, so there is no parameter to point somewhere else. A general `DELETE /api/file`
 * would have been the widening `D1049` refuses; a verb that can only ever drop the scratch buffer
 * is the same guard narrowed to the new capability's own shape.
 *
 * `ifMatch` is kept for the reason `A1-5` had it: a scratch file that changed under the page is a
 * run in another terminal, and dropping it silently would be the one destructive surprise this
 * route can produce. Absent is success, not `404` — Discard's promise is that the file is gone,
 * and it is.
 */
export async function dropScratch(
  root: string,
  ifMatch: string | null,
): Promise<{ readonly removed: boolean } | FileWriteRefusal> {
  const resolved = resolveWritablePath(root, SCRATCH_PATH);
  // Unreachable — `SCRATCH_PATH` is a `.tflw` constant — but the refusal is relayed rather than
  // asserted away, so a future change to that constant fails loudly instead of deleting elsewhere.
  if (typeof resolved !== 'string') return resolved;

  let current: string | null;
  try {
    current = await readFile(resolved, 'utf8');
  } catch {
    current = null;
  }
  if (current === null) return { removed: false };
  if (ifMatch !== null && etagOf(current) !== ifMatch) {
    return { status: 409, error: 'the file changed on disk since it was read' };
  }
  await unlink(resolved);
  return { removed: true };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function sendFile(res: ServerResponse, path: string): Promise<boolean> {
  let s;
  try {
    s = await stat(path);
  } catch {
    return false;
  }
  if (!s.isFile()) return false;
  const body = await readFile(path);
  res.writeHead(200, { 'content-type': contentType(path), 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
  return true;
}

const REPORT_MEMBERS = ['results.json', 'report.html', 'junit.xml', 'events.ndjson', 'findings.sarif', '.last-run.json'];

interface LiveRun {
  readonly record: RunRecord;
  readonly child: ChildProcess;
  /** Every stdout line so far — a subscriber that arrives late replays from here. */
  readonly lines: string[];
  readonly stderr: string[];
  readonly subscribers: Set<ServerResponse>;
  ended: Promise<void>;
}

export class UiServer {
  readonly server: Server;
  private readonly runs = new Map<string, LiveRun>();
  private readonly staticDir: string;

  constructor(private readonly opts: UiServerOptions) {
    this.staticDir = opts.staticDir ?? join(dirname(opts.cliEntry), 'ui');
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (!res.headersSent) json(res, 500, { error: message });
        else res.end();
      });
    });
  }

  listen(port: number): Promise<number> {
    return new Promise((resolvePort, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        const address = this.server.address();
        if (address === null || typeof address === 'string') return reject(new Error('expected a TCP address'));
        resolvePort(address.port);
      });
    });
  }

  async close(): Promise<void> {
    for (const run of this.runs.values()) if (run.record.status === 'running') run.child.kill('SIGINT');
    this.server.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => this.server.close((e) => (e ? reject(e) : resolveClose())));
  }

  /** The run's argv and its report directory, for the record and the copy. */
  private reportDirFor(): Promise<string> {
    return readProject(this.opts.root).then((p) => resolve(this.opts.root, p.reportDir));
  }

  /**
   * Run `tflw init` in the project root and report what it made.
   *
   * Everything it says is the CLI's own words — the created-file list on success, the refusal on
   * failure — because the page's account of what a project is has to be the tool's account or it
   * is a second one.
   */
  async runInit(door: Lens): Promise<{ readonly ok: boolean; readonly created: readonly string[]; readonly output: string; readonly exitCode: number | null }> {
    const argv = initArgv(door);
    const child = spawn(process.execPath, [...(this.opts.execArgv ?? []), this.opts.cliEntry, ...argv], {
      cwd: this.opts.root,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (c: string) => { output += c; });
    child.stderr!.on('data', (c: string) => { output += c; });
    const exitCode = await new Promise<number | null>((done) => child.on('close', (code) => done(code)));
    // What is on disk afterwards, not what the child claimed: the page is a projection of the
    // files (`D985`), and that holds for the files it just asked for as much as for any other.
    //
    // **`SCAFFOLDED` IS THE LIST OF EVERY NAME `tflw init` CAN WRITE, AND IT IS A LIST BECAUSE
    // THIS ROUTINE MUST NOT REPORT ARBITRARY FILES.** `A2-6` found it holding four of five: the
    // names were written in `A0-5` when `load.tflw` was the only door-specific scaffold, `A2-4`
    // taught the CLI `--scan` without adding `scan.tflw` here, and so the SCANS door wrote the
    // file and told the page it had not — a projection reading the disk through a list that had
    // stopped describing it. Reading the *directory* instead was the obvious repair and is the
    // wrong one: `init` runs in a directory the author may already keep files in, and `created`
    // would start naming them. So the list stays, and the gate on it is that a door's scaffold is
    // asserted **on disk** before it is asserted here (`ui-server.test.ts`), which is the order
    // that can tell "not written" from "not reported".
    const created: string[] = [];
    for (const name of SCAFFOLDED) {
      if (existsSync(join(this.opts.root, name))) created.push(name);
    }
    return { ok: exitCode === 0, created, output: output.trim(), exitCode };
  }

  async startRun(request: RunRequest): Promise<RunRecord> {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const argv = runArgv(request);
    const child = spawn(process.execPath, [...(this.opts.execArgv ?? []), this.opts.cliEntry, ...argv], {
      cwd: this.opts.root,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record: RunRecord = { id, startedAt: new Date().toISOString(), request, argv, status: 'running', exitCode: null, signal: null, endedAt: null, kept: null };
    const live: LiveRun = { record, child, lines: [], stderr: [], subscribers: new Set(), ended: Promise.resolve() };
    this.runs.set(id, live);

    let buffered = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buffered += chunk;
      let nl = buffered.indexOf('\n');
      while (nl !== -1) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (line.length > 0) this.emit(live, line);
        nl = buffered.indexOf('\n');
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => live.stderr.push(chunk));

    live.ended = new Promise<void>((done) => {
      child.on('close', (code, signal) => {
        if (buffered.length > 0) this.emit(live, buffered);
        record.exitCode = code;
        record.signal = signal;
        record.endedAt = new Date().toISOString();
        // `cancelled` is the server's own knowledge — `cancel()` marked it before signalling — and
        // not inferred from the signal: a child killed from outside (an OOM, a `kill` in a shell)
        // is `done` with its signal recorded, which is a different fact from the page asking.
        if (record.status === 'running') record.status = 'done';
        this.keep(live)
          .catch((e: unknown) => live.stderr.push(`could not keep the report directory: ${e instanceof Error ? e.message : String(e)}\n`))
          .finally(() => {
            for (const res of live.subscribers) {
              res.write(`event: end\ndata: ${JSON.stringify({ status: record.status, exitCode: record.exitCode, kept: record.kept })}\n\n`);
              res.end();
            }
            live.subscribers.clear();
            done();
          });
      });
    });
    return record;
  }

  private emit(live: LiveRun, line: string): void {
    live.lines.push(line);
    for (const res of live.subscribers) res.write(`data: ${line}\n\n`);
  }

  /** Copy the report directory aside as `runs/<id>/` — the run's record, kept. Only the members
   * the contract names and the directories beside them; `runs/` itself is never copied into
   * itself. Skipped when the run wrote nothing (a usage error exits before any artefact) —
   * judged by `results.json`'s mtime against the run's start, not by its presence: a directory the
   * previous run left is present too, and `M192` U7's gate kept one as the record of a run that
   * had refused its own argv, then opened it as that run's report. */
  private async keep(live: LiveRun): Promise<void> {
    const reportDir = await this.reportDirFor();
    let written: Date;
    try {
      written = (await stat(join(reportDir, 'results.json'))).mtime;
    } catch {
      return;
    }
    if (written.getTime() < Date.parse(live.record.startedAt)) return;
    const dest = join(reportDir, 'runs', live.record.id);
    await mkdir(dest, { recursive: true });
    // Entry by entry rather than one `cp` of the directory: `fs.cp` refuses a destination inside
    // its source (`ERR_FS_CP_EINVAL`), and `runs/` is inside `report/` by design.
    for (const entry of await readdir(reportDir, { withFileTypes: true })) {
      if (entry.name === 'runs') continue;
      await cp(join(reportDir, entry.name), join(dest, entry.name), { recursive: true });
    }
    live.record.kept = relative(this.opts.root, dest).split(sep).join('/');
  }

  cancel(id: string): boolean {
    const live = this.runs.get(id);
    if (!live || live.record.status !== 'running') return false;
    live.record.status = 'cancelled';
    // SIGINT, the terminal's own gesture — `tflw run` handles it (EXIT_ABORTED, D-M32) and still
    // writes what it has, which is what makes the cancelled run's record openable.
    live.child.kill('SIGINT');
    return true;
  }

  private async listReports(): Promise<ReportEntry[]> {
    const reportDir = await this.reportDirFor();
    const entries: ReportEntry[] = [];
    const describe = async (id: string, dir: string): Promise<ReportEntry | null> => {
      const present: string[] = [];
      for (const m of REPORT_MEMBERS) if (existsSync(join(dir, m))) present.push(m);
      if (present.length === 0) return null;
      let summary: ReportEntry['summary'] = null;
      let at = '';
      try {
        const resultsPath = join(dir, 'results.json');
        at = (await stat(resultsPath)).mtime.toISOString();
        const r = JSON.parse(await readFile(resultsPath, 'utf8')) as { ok: boolean; total: number; passed: number; failed: number };
        summary = { ok: r.ok, total: r.total, passed: r.passed, failed: r.failed };
      } catch {
        // A directory with a report.html and no results.json is still a report; it just has no summary.
      }
      return { id, path: relative(this.opts.root, dir).split(sep).join('/'), at, files: present, summary };
    };
    const current = await describe('current', reportDir);
    if (current) entries.push(current);
    let kept: string[] = [];
    try {
      kept = (await readdir(join(reportDir, 'runs'))).sort().reverse();
    } catch {
      // no runs kept yet
    }
    for (const id of kept) {
      const e = await describe(id, join(reportDir, 'runs', id));
      if (e) entries.push(e);
    }
    return entries;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === '/api/project' && method === 'GET') {
      // "There is no project here" is a different answer from "this project is broken", and the
      // landing has to tell them apart to know whether to offer to create one (`M200` `A0-5`).
      // Until now both arrived as a 400 carrying a raw `ENOENT` with an absolute path in it,
      // which is neither a usable signal nor a sentence to show anyone.
      if (!existsSync(join(this.opts.root, 'tflw.config'))) {
        return json(res, 404, { error: 'no tflw.config here — this directory is not a tflw project yet', noProject: true, root: this.opts.root });
      }
      try {
        return json(res, 200, await readProject(this.opts.root));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // `GET /api/file?path=x.tflw` — the source and its etag. Slice 1 never served a file's text
    // (`readProject` reads every file and returns only its tests), so the page had nothing to
    // edit and nothing to compute an edit against.
    if (path === '/api/file' && method === 'GET') {
      const requested = url.searchParams.get('path') ?? '';
      const resolved = resolveWritablePath(this.opts.root, requested);
      if (typeof resolved !== 'string') return json(res, resolved.status, { error: resolved.error });
      let text: string;
      try {
        text = await readFile(resolved, 'utf8');
      } catch {
        return json(res, 404, { error: `no ${requested}` });
      }
      return json(res, 200, { path: relative(this.opts.root, resolved).split(sep).join('/'), text, etag: etagOf(text) });
    }

    if (path === '/api/file' && method === 'PUT') {
      let request: { path?: unknown; text?: unknown };
      try {
        request = JSON.parse(await readBody(req)) as { path?: unknown; text?: unknown };
      } catch {
        return json(res, 400, { error: 'the write request is not JSON' });
      }
      if (typeof request.path !== 'string' || typeof request.text !== 'string') {
        return json(res, 400, { error: 'a write needs `path` and `text`' });
      }
      // `If-Match: *` is not accepted. HTTP reads it as "any current representation", which is
      // precisely the check this route exists to make — a client that cannot name the version it
      // edited has not read the file, and letting it through would make the 409 unreachable.
      const header = req.headers['if-match'];
      const ifMatch = typeof header === 'string' && header !== '*' ? header.replaceAll('"', '') : null;
      if (header === '*') return json(res, 400, { error: 'If-Match must name a version, not `*`' });
      const result = await writeProjectFile(this.opts.root, request.path, request.text, ifMatch);
      if ('status' in result) {
        const { status, ...rest } = result;
        return json(res, status, rest);
      }
      return json(res, 200, result);
    }

    // `GET /api/pick?path=…` — a `tflw pick` session, streamed (`M200` `A3-6`, `D1055`).
    //
    // **ONE ROUTE, AND THE STREAM *IS* THE SESSION.** The obvious shape was three — start, stream,
    // stop — with a registry of live picks keyed by id. This is one, because binding the child's
    // life to the connection makes two whole classes of bug unconstructible rather than handled:
    // there is no id to leak, and **an orphan is impossible**, since a session that is never
    // streamed is never started. That property is worth more here than anywhere else in this
    // server: `tflw pick` opens a REAL, VISIBLE browser, and an orphaned one is a process somebody
    // has to find and kill on a machine they may be sharing.
    //
    // The response is `text/event-stream` and the body is the child's stdout, a line at a time,
    // unclassified. Which lines are locators is the page's question, and it has `@tflw/lang` to
    // answer it with — `pick` prints two banner lines and then one bare locator per click, and a
    // server that filtered by matching the banner text would be coupled to that wording.
    if (path === '/api/pick' && method === 'GET') {
      if (!existsSync(join(this.opts.root, 'tflw.config'))) return json(res, 404, { error: 'not a tflw project here', noProject: true });
      let view: ProjectView;
      try {
        view = await readProject(this.opts.root);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
      const target = pickUrl(view.webBaseUrl, url.searchParams.get('path') ?? '');
      if (target === null) {
        return json(res, 409, { error: `env \`${view.authorization.envName}\` declares no \`web\` base, so there is no page to pick from — add \`web "http://localhost:3000"\` to tflw.config` });
      }

      const child = spawn(process.execPath, [...(this.opts.execArgv ?? []), this.opts.cliEntry, ...pickArgv(target)], {
        cwd: this.opts.root,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });

      let buffered = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        buffered += chunk;
        let nl = buffered.indexOf('\n');
        while (nl !== -1) {
          res.write(`data: ${JSON.stringify(buffered.slice(0, nl))}\n\n`);
          buffered = buffered.slice(nl + 1);
          nl = buffered.indexOf('\n');
        }
      });
      // stderr is the command's own diagnosis — no browser installed, no display, a URL it will
      // not take — and is the only thing the page can show when a session never starts. It goes
      // through as a named event rather than mixed into the locator lines.
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (chunk: string) => res.write(`event: problem\ndata: ${JSON.stringify(chunk)}\n\n`));
      child.on('close', (code) => {
        res.write(`event: end\ndata: ${JSON.stringify({ exitCode: code })}\n\n`);
        res.end();
      });
      // **`SIGINT`, not `SIGKILL`** — `pick` installs a handler that closes the browser session
      // (`M105`), so the signal the page sends is the one a terminal sends, and the window goes
      // with it. Killing the process outright would leave the browser it launched behind, which is
      // the exact failure this route's shape exists to prevent.
      req.on('close', () => {
        if (child.exitCode === null) child.kill('SIGINT');
      });
      return;
    }

    // `DELETE /api/scratch` — drop `D1047`'s scratch buffer (`M200` `A2-6`, `D1054`).
    //
    // No path, by construction: the one file this verb can reach is `SCRATCH_PATH`. See
    // `dropScratch` for why that is what keeps `D1049` intact rather than widened.
    if (path === '/api/scratch' && method === 'DELETE') {
      const header = req.headers['if-match'];
      if (header === '*') return json(res, 400, { error: 'If-Match must name a version, not `*`' });
      const ifMatch = typeof header === 'string' ? header.replaceAll('"', '') : null;
      const result = await dropScratch(this.opts.root, ifMatch);
      if ('status' in result) {
        const { status, ...rest } = result;
        return json(res, status, rest);
      }
      return json(res, 200, result);
    }

    // `POST /api/init` — create a project here (`M200` `A0-5`, `D1051`).
    //
    // **Spawned, not written.** This server writes through exactly one call site (`D1049`) and
    // that one writes `.tflw` files; a project is a `tflw.config`, an example, a `.env.example`
    // and a `package.json`. Rather than widen the write gate until it admits all of those, the
    // page asks the CLI to do it — the same way running is `tflw run` spawned — so the scaffolds
    // the page creates are byte-for-byte the scaffolds a terminal creates, and there is one
    // implementation of what a tflw project is.
    //
    // It needs no guard of its own against overwriting: `tflw init` refuses when a `tflw.config`
    // is already there and exits non-zero, and that refusal is relayed verbatim.
    if (path === '/api/init' && method === 'POST') {
      let request: { door?: unknown };
      try {
        request = JSON.parse(await readBody(req)) as { door?: unknown };
      } catch {
        return json(res, 400, { error: 'the init request is not JSON' });
      }
      if (typeof request.door !== 'string' || !LENSES.includes(request.door as Lens)) {
        return json(res, 400, { error: `a door is one of ${LENSES.join(', ')}` });
      }
      const result = await this.runInit(request.door as Lens);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (path === '/api/run' && method === 'POST') {
      let request: RunRequest;
      try {
        const body = await readBody(req);
        request = body.length === 0 ? {} : (JSON.parse(body) as RunRequest);
      } catch {
        return json(res, 400, { error: 'the run request is not JSON' });
      }
      const record = await this.startRun(request);
      return json(res, 202, record);
    }

    if (path === '/api/runs' && method === 'GET') {
      return json(res, 200, [...this.runs.values()].map((r) => r.record).reverse());
    }

    const runMatch = /^\/api\/runs\/([^/]+)\/(events|cancel|stderr)$/.exec(path);
    if (runMatch) {
      const [, id, verb] = runMatch;
      const live = this.runs.get(id!);
      if (!live) return json(res, 404, { error: `no run ${id}` });
      if (verb === 'cancel' && method === 'POST') return json(res, 200, { cancelled: this.cancel(id!) });
      if (verb === 'stderr' && method === 'GET') return json(res, 200, { stderr: live.stderr.join('') });
      if (verb === 'events' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        for (const line of live.lines) res.write(`data: ${line}\n\n`);
        if (live.record.status !== 'running') {
          res.write(`event: end\ndata: ${JSON.stringify({ status: live.record.status, exitCode: live.record.exitCode, kept: live.record.kept })}\n\n`);
          res.end();
          return;
        }
        live.subscribers.add(res);
        req.on('close', () => live.subscribers.delete(res));
        return;
      }
      return json(res, 405, { error: `${method} ${path}` });
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(res, 200, await this.listReports());
    }

    const reportFile = /^\/api\/reports\/([^/]+)\/(.+)$/.exec(path);
    if (reportFile && method === 'GET') {
      const id = decodeURIComponent(reportFile[1]!);
      const rest = reportFile[2]!;
      const reportDir = await this.reportDirFor();
      // The id is one path segment under `runs/`, or `current`; decoded first so that an encoded
      // `../` is judged as what it decodes to, not as a harmless literal that happens not to exist.
      if (id !== 'current' && (id.includes('/') || id.includes('\\') || safeJoin(join(reportDir, 'runs'), id) !== join(reportDir, 'runs', id))) {
        return json(res, 400, { error: 'not a report id' });
      }
      const base = id === 'current' ? reportDir : join(reportDir, 'runs', id);
      const file = safeJoin(base, decodeURIComponent(rest));
      if (file === null) return json(res, 400, { error: 'outside the report directory' });
      if (await sendFile(res, file)) return;
      return json(res, 404, { error: `no ${rest} in ${id}` });
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: `no route ${method} ${path}` });

    // Playwright's trace viewer, from the project's own `playwright-core` (`traceViewerDir`).
    if (path === '/trace' || path.startsWith('/trace/')) {
      const dir = traceViewerDir(this.opts.root);
      if (dir === null) return json(res, 404, { error: 'no playwright-core resolves from the project, so there is no trace viewer to serve; `npx playwright show-trace <archive>` opens one' });
      const wanted = path === '/trace' || path === '/trace/' ? 'index.html' : path.slice('/trace/'.length);
      const file = safeJoin(dir, decodeURIComponent(wanted));
      if (file === null) return json(res, 400, { error: 'outside the trace viewer' });
      if (await sendFile(res, file)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }

    // The page. A request for a path with no extension is the app's own routing, and gets
    // index.html; everything else is a file under the bundle or a 404.
    if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: `${method} ${path}` });
    const wanted = path === '/' || extname(path) === '' ? 'index.html' : path.slice(1);
    const file = safeJoin(this.staticDir, wanted);
    if (file !== null && (await sendFile(res, file))) return;
    if (wanted === 'index.html') {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`tflw ui: the page's bundle is not built (looked in ${this.staticDir}). \`npm run build\` in the tflw checkout produces it.\n`);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
  }
}

/** `tflw ui [dir] [--port N] [--no-open]` — parsed here so the mapping is testable without a
 * socket; returns the exit code for a usage error, or the options. */
export function parseUiArgs(argv: readonly string[], cwd: string): { root: string; port: number; open: boolean } | { usage: string } {
  let root = cwd;
  let port = UI_DEFAULT_PORT;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) > 65535) return { usage: `--port takes a number 0-65535, got ${v ?? 'nothing'}` };
      port = Number(v);
    } else if (a === '--no-open') {
      open = false;
    } else if (a.startsWith('--')) {
      return { usage: `unknown flag \`${a}\` for \`tflw ui\`` };
    } else {
      root = resolve(cwd, a);
    }
  }
  return { root, port, open };
}

/** Open the URL in the machine's browser — best effort, never awaited, never fatal. */
export function openInBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try {
    spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // no browser to open is not an error the server should die of
  }
}
