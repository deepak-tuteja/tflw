// tflw VS Code extension (decision 94, 2026-07-07; decision 104 rewrite, PLAN_M13_LSP.md Phase 5) —
// two features now:
//   1. Language features: a `LanguageClient` spawns `tflw lsp` (decision 17.2/17.4) and talks LSP
//      over its stdio — diagnostics, hover, go-to-def, completion, rename, and signature help all
//      come from the real server now, replacing the old save-triggered `tflw check --format json`
//      spawn-and-parse path. The selector names **both** language ids (`M136b`, D427) — decision A
//      means the config buffer gets real diagnostics too, so there's no exclusion filter to write
//      here, but since `tflw.config` stopped sharing the `tflw` id it has to be asked for by name.
//   2. Run: a Test Explorer controller (`M251` `C`, `D1368`) runs a file or a test as `tflw run`
//      with `--format ndjson` and shows each verdict where the test is; the CodeLens above every
//      `test "..."` line ("Run test" via `--only`, "Run file" without it) delegates to it, and
//      `tflw.runFailed` is `--failed`. Client-side only (decision 17.3).
//   3. Snippets: contributed separately in snippets/tflw.json (declarative, no code needed here).
//
// **`tflw.config` has its own language id (`tflw-config`) since `M136b`** — a TextMate grammar binds
// to a language, and the config dialect's own vocabulary could not be coloured without one. Three of
// this file's selectors follow the split and one does not; D427a has the full table, and the reason
// the CodeLens registration below stays test-only is written where it is registered. The half of
// that split with no code in this file at all is `package.json`'s `activationEvents`, which is the
// site where getting it wrong means none of the above ever runs.
//
// The vscode-independent logic (project-root walking, binary resolution, test-line parsing) lives
// in lib.ts, unit-tested there — `vscode` only exists inside a running extension host, so nothing
// that imports it can be exercised by a headless `node --test` run.

import * as vscode from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { dirname, relative, sep, join } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findProjectRoot, resolveTflwBin, parseTestDeclarationLine, testsInText, runArgs, spawnSpec, LineReader, parseExplorerEvent, reportDirOf, type Verdict } from './lib.js';

let client: LanguageClient | undefined;
let explorer: Explorer | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // Test dialect only, and deliberately so (`M136b`, D427a). `TflwCodeLensProvider` emits a lens
    // only on a line `parseTestDeclarationLine` matches, and `TF021` bans `test` from the config
    // dialect — so a `tflw.config` buffer has produced zero lenses since this provider was written.
    // Narrowing the selector to what the split now makes explicit changes no observable behaviour;
    // widening it would register a provider that is guaranteed to return an empty array.
    vscode.languages.registerCodeLensProvider({ language: 'tflw' }, new TflwCodeLensProvider()),
    vscode.commands.registerCommand('tflw.runFile', (uri?: vscode.Uri) => runFromLens(resolveTargetUri(uri))),
    vscode.commands.registerCommand('tflw.runTest', (uri: vscode.Uri, testName: string) => runFromLens(uri, testName)),
    vscode.commands.registerCommand('tflw.runFailed', () => runFailed()),
  );
  explorer = createExplorer(context);

  const root = resolveWorkspaceRoot();
  if (!root) return; // no tflw.config found anywhere open — CodeLens/run commands still work, no LSP to start

  const bin = resolveTflwBin(root);
  const serverOptions: ServerOptions = { command: bin, args: ['lsp'], transport: TransportKind.stdio, options: { cwd: root } };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: 'tflw' }, { language: 'tflw-config' }],
    initializationOptions: { env: vscode.workspace.getConfiguration('tflw').get<string>('env') },
    synchronize: { configurationSection: 'tflw' },
  };
  client = new LanguageClient('tflw', 'tflw Language Server', serverOptions, clientOptions);
  void client.start();
  context.subscriptions.push({ dispose: () => void client?.stop() });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

/** Picks the project root the `LanguageClient` should be launched from: prefers the directory of
 * an already-open document in **either** dialect (the common case, since `onLanguage:tflw` /
 * `onLanguage:tflw-config` is what activates this extension in the first place) and falls back to
 * walking up from each open workspace folder — a single client covers the common
 * single-tflw-project-per-window case, matching every other root-resolving call site in this
 * codebase (none of which support multi-root either).
 *
 * **Both ids, since `M136b` (D427a).** A window whose only open document is a `tflw.config` is an
 * ordinary thing — it is the file a user opens to add a service or fix a session — and before the
 * split that document carried the `tflw` id and satisfied this check. Matching one id would leave
 * such a window on the workspace-folder fallback, which is usually equivalent and is *not*
 * equivalent for a config file opened outside any folder: no root, so no client, so no diagnostics,
 * with nothing anywhere reporting a failure. */
function resolveWorkspaceRoot(): string | undefined {
  const tflwDoc = vscode.workspace.textDocuments.find((d) => d.languageId === 'tflw' || d.languageId === 'tflw-config');
  if (tflwDoc) {
    const root = findProjectRoot(dirname(tflwDoc.fileName));
    if (root) return root;
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = findProjectRoot(folder.uri.fsPath);
    if (root) return root;
  }
  return undefined;
}

function resolveTargetUri(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  return uri ?? vscode.window.activeTextEditor?.document.uri;
}

/** The CodeLens commands (`M251` `C`): they delegate to the Test Explorer, so a lens run and an
 * explorer run are one run with one result. The warnings for a missing file or project stay. */
function runFromLens(uri: vscode.Uri | undefined, testName?: string): Promise<void> | undefined {
  if (!uri) {
    void vscode.window.showWarningMessage('tflw: no .tflw file to run — open one first.');
    return undefined;
  }
  const root = findProjectRoot(dirname(uri.fsPath));
  if (!root) {
    void vscode.window.showWarningMessage('tflw: no tflw.config found above this file — not a tflw project.');
    return undefined;
  }
  return explorer?.runFile(root, uri, testName);
}

function runFailed(): Promise<void> | undefined {
  const root = resolveWorkspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage('tflw: no tflw.config found — not a tflw project.');
    return undefined;
  }
  return explorer?.runFailed(root);
}

// ---- `M251` `C` (`D1368`): the Test Explorer ---------------------------------------------------
//
// Items are files and their tests, discovered with the same line scan the CodeLens uses — on
// activation over the workspace, and again for a file on open and on save. A run is `tflw run`
// as a child process with `--format ndjson`: `test:start` marks an item started, `test:end`
// carries the same `ReportEntry` `results.json` holds, which is the verdict and the failure text.
// The run's `report.html` is linked from its output. Nothing here parses `.tflw` beyond the
// declaration line, and nothing here decides a verdict: tflw's own report does.

interface Explorer {
  runFile(root: string, uri: vscode.Uri, only?: string): Promise<void>;
  runFailed(root: string): Promise<void>;
}

const relPath = (root: string, file: string): string => relative(root, file).split(sep).join('/');

function createExplorer(context: vscode.ExtensionContext): Explorer {
  const controller = vscode.tests.createTestController('tflw', 'tflw');
  context.subscriptions.push(controller);

  const fileItem = (uri: vscode.Uri): vscode.TestItem => {
    const id = uri.fsPath;
    let item = controller.items.get(id);
    if (!item) {
      item = controller.createTestItem(id, relative(findProjectRoot(dirname(uri.fsPath)) ?? dirname(uri.fsPath), uri.fsPath).split(sep).join('/'), uri);
      item.canResolveChildren = true;
      controller.items.add(item);
    }
    return item;
  };

  const refresh = (uri: vscode.Uri, text: string): vscode.TestItem => {
    const file = fileItem(uri);
    const children: vscode.TestItem[] = [];
    for (const t of testsInText(text)) {
      const child = controller.createTestItem(`${uri.fsPath}::${t.name}`, t.name, uri);
      child.range = new vscode.Range(t.line, 0, t.line, 0);
      children.push(child);
    }
    file.children.replace(children);
    return file;
  };

  controller.resolveHandler = async (item) => {
    if (item?.uri) {
      refresh(item.uri, readFileSync(item.uri.fsPath, 'utf8'));
      return;
    }
    for (const uri of await vscode.workspace.findFiles('**/*.tflw', '**/node_modules/**')) fileItem(uri);
  };
  const onDoc = (doc: vscode.TextDocument): void => {
    if (doc.languageId === 'tflw' && doc.uri.scheme === 'file') refresh(doc.uri, doc.getText());
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(onDoc), vscode.workspace.onDidSaveTextDocument(onDoc));
  for (const doc of vscode.workspace.textDocuments as readonly vscode.TextDocument[]) if (doc.uri) onDoc(doc);

  /** Runs `tflw run <args>` in `root` and maps each event onto `items` (by file and test name).
   * With `expectAll`, an item the run never reported is errored with the tail of stderr — a run
   * that died, or a name `--only` did not match; `--failed` runs only what tflw chooses, so there
   * an unreported item is simply one it did not re-run. */
  const execute = (run: vscode.TestRun, root: string, args: string[], items: Map<string, vscode.TestItem>, expectAll: boolean, token?: vscode.CancellationToken): Promise<void> =>
    new Promise((done) => {
      const spec = spawnSpec(resolveTflwBin(root), args);
      const child = spawn(spec.command, spec.args, { cwd: root, shell: spec.shell });
      token?.onCancellationRequested(() => child.kill('SIGINT'));
      const ended = new Set<string>();
      const reader = new LineReader();
      let stderr = '';
      const keyOf = (file: string | undefined, name: string): string | undefined => {
        if (file !== undefined) return `${join(root, file)}::${name}`;
        return [...items.keys()].find((k) => k.endsWith(`::${name}`));
      };
      const onLine = (line: string): void => {
        const e = parseExplorerEvent(line);
        if (!e) return;
        const key = keyOf(e.file, e.name);
        const item = key === undefined ? undefined : items.get(key);
        if (!item) return;
        if (e.kind === 'start') run.started(item);
        else {
          ended.add(key!);
          report(run, item, root, e.verdict);
        }
      };
      child.stdout?.setEncoding('utf8').on('data', (c: string) => reader.push(c).forEach(onLine));
      child.stderr?.setEncoding('utf8').on('data', (c: string) => { stderr += c; });
      child.on('error', (err) => { stderr += String(err); });
      child.on('close', (code) => {
        reader.flush().forEach(onLine);
        for (const [key, item] of items) {
          if (expectAll && !ended.has(key)) run.errored(item, new vscode.TestMessage(`tflw run exited ${code ?? 'on a signal'} before this test reported.\n${stderr.trim().split('\n').slice(-8).join('\n')}`));
        }
        const html = join(root, reportDirOf(safeRead(join(root, 'tflw.config'))), 'report.html');
        run.appendOutput(`tflw: report — ${vscode.Uri.file(html).toString()}\r\n`);
        done();
      });
    });

  const testsOf = (item: vscode.TestItem): vscode.TestItem[] => {
    if (item.children.size === 0) return item.id.includes('::') ? [item] : [];
    const out: vscode.TestItem[] = [];
    item.children.forEach((c) => out.push(c));
    return out;
  };

  /** One run of `request`: a whole file is one `tflw run <file>`, a single test is `--only`. */
  const runHandler = async (request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> => {
    const run = controller.createTestRun(request);
    const roots: vscode.TestItem[] = [];
    if (request.include) roots.push(...request.include);
    else controller.items.forEach((i) => roots.push(i));
    for (const item of roots) {
      if (token.isCancellationRequested || !item.uri) break;
      const root = findProjectRoot(dirname(item.uri.fsPath));
      if (!root) continue;
      const isFile = !item.id.includes('::');
      if (isFile && item.children.size === 0) refresh(item.uri, readFileSync(item.uri.fsPath, 'utf8'));
      const tests = testsOf(item);
      const map = new Map(tests.map((t) => [t.id, t]));
      tests.forEach((t) => run.enqueued(t));
      const args = runArgs({ file: relPath(root, item.uri.fsPath), ...(isFile ? {} : { only: item.label }) });
      await execute(run, root, args, map, true, token);
    }
    run.end();
  };
  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, runHandler, true);

  return {
    async runFile(root, uri, only) {
      const file = refresh(uri, readFileSync(uri.fsPath, 'utf8'));
      const target = only === undefined ? file : file.children.get(`${uri.fsPath}::${only}`) ?? file;
      await runHandler(new vscode.TestRunRequest([target]), new vscode.CancellationTokenSource().token);
    },
    async runFailed(root) {
      // `--failed` re-runs the failing tests (`D1414`), which only tflw knows; every item is a
      // candidate, and the ones the run reports are the ones it re-ran.
      const run = controller.createTestRun(new vscode.TestRunRequest());
      const map = new Map<string, vscode.TestItem>();
      controller.items.forEach((f) => f.children.forEach((t) => map.set(t.id, t)));
      await execute(run, root, runArgs({ failed: true }), map, false);
      run.end();
    },
  };
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function report(run: vscode.TestRun, item: vscode.TestItem, root: string, v: Verdict): void {
  if (v.state === 'passed') return run.passed(item, v.durationMs);
  if (v.state === 'skipped') return run.skipped(item);
  const message = new vscode.TestMessage(v.message ?? 'failed');
  const file = v.file !== undefined ? vscode.Uri.file(join(root, v.file)) : item.uri;
  if (file && v.line !== undefined) message.location = new vscode.Location(file, new vscode.Position(v.line - 1, 0));
  run.failed(item, message, v.durationMs);
}

class TflwCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      const testName = parseTestDeclarationLine(text);
      if (testName === undefined) continue;
      const range = new vscode.Range(line, 0, line, text.length);
      lenses.push(
        new vscode.CodeLens(range, { title: '▶ Run test', command: 'tflw.runTest', arguments: [document.uri, testName] }),
        new vscode.CodeLens(range, { title: '▶ Run file', command: 'tflw.runFile', arguments: [document.uri] }),
      );
    }
    return lenses;
  }
}
