// Unit tests for extension.ts's activate()/deactivate() wiring — the LanguageClient spawn, the
// CodeLens provider registration, and the two `tflw.run*` commands (decision 104 rewrite,
// PLAN_M13_LSP.md Phase 5). Made possible without a real Extension Host by remapping the `vscode`
// and `vscode-languageclient/node` specifiers to local fakes via tsconfig.test.json's `paths`
// (tsx honors tsconfig `paths`, confirmed by experiment) — see test/mocks/*.ts. This is the one
// gap `lib.ts`'s split-out-the-pure-logic strategy deliberately left uncovered until now: the
// glue in activate() itself (command/provider registration, the conditional LanguageClient start)
// had zero test coverage.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as vscodeMock from './mocks/vscode.js';
import * as lcMock from './mocks/vscode-languageclient-node.js';
import { activate, deactivate } from '../src/extension.js';

function makeContext(): { subscriptions: unknown[] } {
  return { subscriptions: [] };
}

function makeTflwProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-ext-test-'));
  writeFileSync(join(dir, 'tflw.config'), '');
  return dir;
}

beforeEach(() => {
  vscodeMock.__reset();
  lcMock.__reset();
});

test('activate registers both commands and the CodeLens provider unconditionally', () => {
  const context = makeContext();
  activate(context as never);

  assert.deepEqual([...vscodeMock.registeredCommands.keys()].sort(), ['tflw.runFile', 'tflw.runTest']);
  assert.notEqual(vscodeMock.registeredCodeLensProvider, undefined);
  // disposables for: codeLens provider, 2 commands, and (only if a client started) its stop hook
  assert.ok(context.subscriptions.length >= 3);
});

test('activate does not construct a LanguageClient when no tflw project root resolves', () => {
  const context = makeContext();
  // no textDocuments, no workspaceFolders — resolveWorkspaceRoot() has nothing to walk from
  activate(context as never);

  assert.equal(lcMock.constructedClients.length, 0);
});

test('activate constructs and starts a LanguageClient scoped to the resolved project root, via an open tflw document', () => {
  const root = makeTflwProject();
  vscodeMock.__setTextDocuments([{ languageId: 'tflw', fileName: join(root, 'tests', 'a.tflw') }]);

  const context = makeContext();
  activate(context as never);

  assert.equal(lcMock.constructedClients.length, 1);
  const client = lcMock.constructedClients[0]!;
  assert.equal(client.id, 'tflw');
  assert.equal((client.serverOptions as { command: string }).command, 'tflw');
  assert.deepEqual((client.serverOptions as { args: string[] }).args, ['lsp']);
  assert.equal((client.serverOptions as { transport: unknown }).transport, lcMock.TransportKind.stdio);
  assert.equal((client.serverOptions as { options: { cwd: string } }).options.cwd, root);
  assert.deepEqual((client.clientOptions as { documentSelector: unknown }).documentSelector, [{ language: 'tflw' }]);
  assert.equal(client.started, true);
});

test('activate falls back to a workspace folder when no tflw document is open', () => {
  const root = makeTflwProject();
  vscodeMock.__setWorkspaceFolders([{ uri: { fsPath: root } }]);

  activate(makeContext() as never);

  assert.equal(lcMock.constructedClients.length, 1);
  assert.equal((lcMock.constructedClients[0]!.serverOptions as { options: { cwd: string } }).options.cwd, root);
});

test('deactivate stops the running LanguageClient', async () => {
  const root = makeTflwProject();
  vscodeMock.__setWorkspaceFolders([{ uri: { fsPath: root } }]);
  activate(makeContext() as never);

  const client = lcMock.constructedClients[0]!;
  assert.equal(client.stopped, false);
  await deactivate();
  assert.equal(client.stopped, true);
});

test('tflw.runFile with no open file and no active editor shows a warning instead of throwing', () => {
  activate(makeContext() as never);
  const runFile = vscodeMock.registeredCommands.get('tflw.runFile')!;

  runFile(undefined);

  assert.deepEqual(vscodeMock.shownWarnings, ['tflw: no .tflw file to run — open one first.']);
  assert.equal(vscodeMock.terminals.length, 0);
});

test('tflw.runFile against a file outside any tflw project warns instead of sending a bogus command', () => {
  activate(makeContext() as never);
  const runFile = vscodeMock.registeredCommands.get('tflw.runFile')!;
  const outsideDir = mkdtempSync(join(tmpdir(), 'tflw-ext-test-outside-'));

  runFile({ fsPath: join(outsideDir, 'a.tflw') });

  assert.deepEqual(vscodeMock.shownWarnings, ['tflw: no tflw.config found above this file — not a tflw project.']);
  assert.equal(vscodeMock.terminals.length, 0);
});

test('tflw.runFile sends a `tflw run` command in an integrated terminal, cd\'d into the project root', () => {
  const root = makeTflwProject();
  activate(makeContext() as never);
  const runFile = vscodeMock.registeredCommands.get('tflw.runFile')!;

  runFile({ fsPath: join(root, 'tests', 'a.tflw') });

  assert.equal(vscodeMock.terminals.length, 1);
  const terminal = vscodeMock.terminals[0]!;
  assert.equal(terminal.shown, true);
  assert.equal(terminal.sent.length, 1);
  assert.equal(terminal.sent[0], `cd ${JSON.stringify(root)} && tflw run "tests/a.tflw"`);
});

test('tflw.runTest passes --only with the given test name', () => {
  const root = makeTflwProject();
  activate(makeContext() as never);
  const runTest = vscodeMock.registeredCommands.get('tflw.runTest')!;

  runTest({ fsPath: join(root, 'a.tflw') }, 'my test');

  const terminal = vscodeMock.terminals[0]!;
  assert.equal(terminal.sent[0], `cd ${JSON.stringify(root)} && tflw run "a.tflw" --only "my test"`);
});

test('a second run reuses the same named terminal instead of creating a new one', () => {
  const root = makeTflwProject();
  activate(makeContext() as never);
  const runFile = vscodeMock.registeredCommands.get('tflw.runFile')!;

  runFile({ fsPath: join(root, 'a.tflw') });
  runFile({ fsPath: join(root, 'a.tflw') });

  assert.equal(vscodeMock.terminals.length, 1);
  assert.equal(vscodeMock.terminals[0]!.sent.length, 2);
});
