// tflw VS Code extension (decision 94, 2026-07-07) — supersedes decision 76's "highlight-only in
// v0.1" deferral. Three features, all built on top of the CLI (child-process, not an LSP — no
// hover/completion/go-to-def):
//   1. Diagnostics: on save/open of a .tflw file, spawn `tflw check --format json <file>` and
//      publish the result as VS Code Diagnostics.
//   2. Run: a CodeLens above every `test "..."` line ("Run test" via `--only`, "Run file" without
//      it), both sending the command to a shared integrated terminal.
//   3. Snippets: contributed separately in snippets/tflw.json (declarative, no code needed here).
//
// The vscode-independent logic (project-root walking, binary resolution, span math, test-line
// parsing) lives in lib.ts, unit-tested there — `vscode` only exists inside a running extension
// host, so nothing that imports it can be exercised by a headless `node --test` run.

import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { dirname, relative } from 'node:path';
import { findProjectRoot, resolveTflwBin, spanToZeroBasedRange, parseTestDeclarationLine, type RawDiagnostic } from './lib.js';

let diagnostics: vscode.DiagnosticCollection;
let warnedMissingBinary = false;

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection('tflw');
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(updateDiagnostics),
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
    vscode.languages.registerCodeLensProvider({ language: 'tflw' }, new TflwCodeLensProvider()),
    vscode.commands.registerCommand('tflw.runFile', (uri?: vscode.Uri) => runInTerminal(resolveTargetUri(uri))),
    vscode.commands.registerCommand('tflw.runTest', (uri: vscode.Uri, testName: string) => runInTerminal(uri, testName)),
  );

  for (const doc of vscode.workspace.textDocuments) updateDiagnostics(doc);
}

export function deactivate(): void {
  // Nothing to tear down beyond `context.subscriptions`, which VS Code disposes automatically.
}

function resolveTargetUri(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  return uri ?? vscode.window.activeTextEditor?.document.uri;
}

function isTflwTestFile(doc: vscode.TextDocument): boolean {
  // `tflw.config` shares the `tflw` language (for highlighting) but is a different dialect —
  // `tflw check --format json` expects a *test* file, not the config, so it's excluded here.
  return doc.languageId === 'tflw' && doc.fileName.endsWith('.tflw');
}

async function updateDiagnostics(doc: vscode.TextDocument): Promise<void> {
  if (!isTflwTestFile(doc)) return;
  const root = findProjectRoot(dirname(doc.fileName));
  if (!root) {
    diagnostics.delete(doc.uri);
    return;
  }
  const raw = await runCheckJson(root, doc.fileName);
  if (raw === undefined) return; // couldn't run tflw at all — leave whatever diagnostics were there
  diagnostics.set(doc.uri, raw.map(toVscodeDiagnostic));
}

function toVscodeDiagnostic(d: RawDiagnostic): vscode.Diagnostic {
  const r = spanToZeroBasedRange(d.span);
  const range = new vscode.Range(r.startLine, r.startCol, r.endLine, r.endCol);
  const message = d.hint ? `${d.message} (${d.hint})` : d.message;
  const severity = d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.code = d.code;
  diagnostic.source = 'tflw';
  return diagnostic;
}

/** Returns the parsed `Diagnostic[]`, or `undefined` if `tflw` couldn't be run at all (not
 * installed, or crashed before producing JSON) — distinct from a successful run with zero
 * diagnostics (`[]`), so the caller knows whether to trust the (lack of) result. */
function runCheckJson(root: string, absFile: string): Promise<RawDiagnostic[] | undefined> {
  const bin = resolveTflwBin(root);
  const relFile = relative(root, absFile);
  return new Promise((resolve) => {
    const child = spawn(bin, ['check', '--format', 'json', relFile], { cwd: root, shell: process.platform === 'win32' });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.on('error', () => {
      if (!warnedMissingBinary) {
        warnedMissingBinary = true;
        void vscode.window.showWarningMessage(`tflw: could not run "${bin}" — install tflw (npm install tflw) to get inline diagnostics.`);
      }
      resolve(undefined);
    });
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout.trim() || '[]') as RawDiagnostic[]);
      } catch {
        resolve(undefined);
      }
    });
  });
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
