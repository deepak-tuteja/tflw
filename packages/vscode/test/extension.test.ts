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
  // The absence of a `scheme` is load-bearing, not an omission (M122, `B5-06`, D213). Without one
  // this selector also matches `untitled:` buffers, which is what routes an unsaved tab to the
  // server at all. Adding `scheme: 'file'` would compile, read as a tidy-up, and silently take
  // language support away from every new scratch file — the exact state `B5-06` describes, just
  // reached deliberately. The server handles pathless documents; this stays as it is.
  // **Both dialects since `M136b`** (D427): `tflw.config` has its own language id now, and a
  // selector naming only `tflw` would leave every config buffer with no diagnostics, no completion
  // and no hover — the silent breakage D428 is written against.
  assert.deepEqual((client.clientOptions as { documentSelector: unknown }).documentSelector, [{ language: 'tflw' }, { language: 'tflw-config' }]);
  assert.equal(client.started, true);
});

// -- M136b (D427a): the extension-side half of the language-id split -------------------------

test('activate resolves a project root from a `tflw.config` buffer as the only open document (M136b, D427a)', () => {
  // Before the split this document carried the `tflw` id and satisfied `resolveWorkspaceRoot`'s
  // check. Opening just the config file — the file you open to add a service or fix a session — is
  // ordinary, and with no workspace folder set there is no fallback beneath it: matching one id
  // means no root, so no client, so no language support, with nothing reporting a failure.
  const root = makeTflwProject();
  vscodeMock.__setTextDocuments([{ languageId: 'tflw-config', fileName: join(root, 'tflw.config') }]);

  activate(makeContext() as never);

  assert.equal(lcMock.constructedClients.length, 1, 'a config-only window must still start a language client');
  assert.equal((lcMock.constructedClients[0]!.serverOptions as { options: { cwd: string } }).options.cwd, root);
});

test('the CodeLens provider stays registered for the test dialect only (M136b, D427a)', () => {
  // Deliberate, not an oversight. `TflwCodeLensProvider` emits a lens only where
  // `parseTestDeclarationLine` matches, and `TF021` bans `test` from the config dialect — so a
  // config buffer has produced zero lenses since the provider was written. Pinned because three of
  // the six sites that name a language id widened and this one did not, and a later reader finding
  // that asymmetry should find a decision rather than infer a missed edit.
  activate(makeContext() as never);
  assert.deepEqual(vscodeMock.registeredCodeLensSelector, { language: 'tflw' });
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
