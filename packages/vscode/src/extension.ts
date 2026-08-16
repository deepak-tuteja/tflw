// tflw VS Code extension (decision 94, 2026-07-07; decision 104 rewrite, PLAN_M13_LSP.md Phase 5) —
// two features now:
//   1. Language features: a `LanguageClient` spawns `tflw lsp` (decision 17.2/17.4) and talks LSP
//      over its stdio — diagnostics, hover, go-to-def, completion, rename, and signature help all
//      come from the real server now, replacing the old save-triggered `tflw check --format json`
//      spawn-and-parse path. The selector names **both** language ids (`M136b`, D427) — decision A
//      means the config buffer gets real diagnostics too, so there's no exclusion filter to write
//      here, but since `tflw.config` stopped sharing the `tflw` id it has to be asked for by name.
//   2. Run: a CodeLens above every `test "..."` line ("Run test" via `--only`, "Run file" without
//      it), both sending the command to a shared integrated terminal — unchanged, client-side only
//      (decision 17.3), untouched by this rewrite.
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
import { dirname, relative } from 'node:path';
import { findProjectRoot, resolveTflwBin, parseTestDeclarationLine } from './lib.js';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // Test dialect only, and deliberately so (`M136b`, D427a). `TflwCodeLensProvider` emits a lens
    // only on a line `parseTestDeclarationLine` matches, and `TF021` bans `test` from the config
    // dialect — so a `tflw.config` buffer has produced zero lenses since this provider was written.
    // Narrowing the selector to what the split now makes explicit changes no observable behaviour;
    // widening it would register a provider that is guaranteed to return an empty array.
    vscode.languages.registerCodeLensProvider({ language: 'tflw' }, new TflwCodeLensProvider()),
    vscode.commands.registerCommand('tflw.runFile', (uri?: vscode.Uri) => runInTerminal(resolveTargetUri(uri))),
    vscode.commands.registerCommand('tflw.runTest', (uri: vscode.Uri, testName: string) => runInTerminal(uri, testName)),
  );

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

function getOrCreateTerminal(): vscode.Terminal {
  return vscode.window.terminals.find((t) => t.name === 'tflw') ?? vscode.window.createTerminal('tflw');
}

function runInTerminal(uri: vscode.Uri | undefined, testName?: string): void {
  if (!uri) {
    void vscode.window.showWarningMessage('tflw: no .tflw file to run — open one first.');
    return;
  }
  const root = findProjectRoot(dirname(uri.fsPath));
  if (!root) {
    void vscode.window.showWarningMessage('tflw: no tflw.config found above this file — not a tflw project.');
    return;
  }
  const bin = resolveTflwBin(root);
  const relFile = relative(root, uri.fsPath);
  const args = [bin, 'run', JSON.stringify(relFile)];
  if (testName !== undefined) args.push('--only', JSON.stringify(testName));
  const terminal = getOrCreateTerminal();
  terminal.show(true);
  terminal.sendText(`cd ${JSON.stringify(root)} && ${args.join(' ')}`);
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
