// `tflw ui` — the local server behind the page for a `.tflw` project (`M192` U1).
//
// The page is a projection of the file and of the report directory, never a second truth
// (`D985`), and this server is the whole of what it may touch: it reads the project (the config,
// the discovered files, the tests in them), it runs `tflw run --format ndjson` as a child and
// relays the stream (`D986` — the page is one more reader of the artefact CI reads), it lists and
// serves report directories, and it cancels a run. **It never writes a `.tflw` file** — slice 1
// has no write path at all, and the green condition greps this file for one.
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
import { readFile, readdir, stat, cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, dirname, extname, sep } from 'node:path';
import { parseSource, parseConfigSource } from '@tflw/lang';
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
}

export interface ProjectFile {
  /** Relative to the root, `/`-separated. */
  readonly path: string;
  readonly tests: readonly ProjectTest[];
  /** Parse diagnostics, counted — the page shows the file as unparseable, the LSP shows why. */
  readonly diagnostics: number;
}

export interface ProjectView {
  readonly root: string;
  readonly envs: readonly { name: string; isDefault: boolean }[];
  readonly reportDir: string;
  readonly files: readonly ProjectFile[];
}

/** What `tflw run` is asked for. Every field maps to one CLI flag, and nothing else reaches the
 * argv: the page cannot run anything a terminal could not. */
export interface RunRequest {
  readonly files?: readonly string[];
  readonly tags?: readonly string[];
  readonly only?: string;
  readonly env?: string;
  readonly workers?: number;
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
  for (const f of req.files ?? []) argv.push(f);
  return argv;
}

/** The project as the page sees it: config envs, the discovered files, the tests in each. */
export async function readProject(root: string): Promise<ProjectView> {
  const configText = await readFile(join(root, 'tflw.config'), 'utf8');
  const parsed = parseConfigSource(configText);
  const envs = parsed.config.envs.map((e) => ({ name: e.name, isDefault: e.isDefault }));
  // The default env's view of `exclude` and `report dir` — both are `defaults`-only keys, so any
  // env gives the same answer; the default is the one a bare `tflw run` would take.
  const env = selectEnv(parsed.config, { envVar: process.env.TFLW_ENV });
  const resolved = resolveConfig(parsed.config, env);
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
      })),
      diagnostics: diagnostics.length,
    });
  }
  return { root, envs, reportDir: resolved.reportDir, files };
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
   * itself. Skipped when the run wrote nothing (a usage error exits before any artefact). */
  private async keep(live: LiveRun): Promise<void> {
    const reportDir = await this.reportDirFor();
    if (!existsSync(join(reportDir, 'results.json'))) return;
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
      try {
        return json(res, 200, await readProject(this.opts.root));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
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
