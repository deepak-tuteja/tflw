// Unit tests for extension.ts's activate()/deactivate() wiring — the LanguageClient spawn, the
// CodeLens provider registration, and the two `tflw.run*` commands (decision 104 rewrite,
// PLAN_M13_LSP.md Phase 5). Made possible without a real Extension Host by remapping the `vscode`
// and `vscode-languageclient/node` specifiers to local fakes via tsconfig.test.json's `paths`
// (tsx honors tsconfig `paths`, confirmed by experiment) — see test/mocks/*.ts. This is the one
// gap `lib.ts`'s split-out-the-pure-logic strategy deliberately left uncovered until now: the
// glue in activate() itself (command/provider registration, the conditional LanguageClient start)
// had zero test coverage.
//
// What the mock buys is also what it costs: these tests prove we hand VS Code the right wiring,
// never that VS Code does anything with it. Nothing here (or in CI) starts a real Extension Host.
// The checks that need a human are written down in test/MANUAL.md.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from 'node:fs';
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

  assert.deepEqual([...vscodeMock.registeredCommands.keys()].sort(), ['tflw.runFailed', 'tflw.runFile', 'tflw.runTest']);
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

// ---- `M251` `C` (`D1368`): the Test Explorer ------------------------------------------------
//
// A fake `tflw` stands in the project's `node_modules/.bin`, where `resolveTflwBin` looks first.
// It records its argv and replays `results.json`-shaped entries as `--format ndjson` events —
// `test:start`, then `test:end` carrying the entry — filtered by `--only`, the shape the real CLI
// streams. The controller's verdicts are then read back off the mock run.

const RESULTS = [
  { kind: 'functional', name: 'lists products', ok: true, durationMs: 12, steps: [], file: 'shop.tflw' },
  {
    kind: 'functional', name: 'adds to cart', ok: false, durationMs: 30, file: 'shop.tflw',
    steps: [
      { ok: true, source: 'api POST /cart', line: 6, file: 'shop.tflw' },
      { ok: false, source: '  expect status equals 201', detail: 'expected status to equal 201, but got 500', line: 7, file: 'shop.tflw' },
    ],
  },
  { kind: 'functional', name: 'checks out', ok: true, skipped: 'payments are down', durationMs: 0, steps: [], file: 'shop.tflw' },
];
const SHOP = ['test "lists products"', '  api GET /products', '', 'test "adds to cart"', '  api GET /health', '  api POST /cart', '  expect status equals 201', '', 'test "checks out"', '  api POST /checkout', ''].join('\n');

function projectWithFakeTflw(opts: { results?: unknown[]; exitWithout?: boolean } = {}): string {
  const root = makeTflwProject();
  writeFileSync(join(root, 'tflw.config'), 'defaults\n  report "./out"\n\nenv local default\n  api "http://127.0.0.1:1"\n');
  writeFileSync(join(root, 'shop.tflw'), SHOP);
  writeFileSync(join(root, 'results.fixture.json'), JSON.stringify(opts.results ?? RESULTS));
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  const bin = join(root, 'node_modules', '.bin', 'tflw');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.writeFileSync('argv.json', JSON.stringify(argv));
${opts.exitWithout ? "process.stderr.write('error: no tflw.config here\\n'); process.exit(2);" : ''}
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
for (const r of JSON.parse(fs.readFileSync('results.fixture.json', 'utf8'))) {
  if (only !== undefined && r.name !== only) continue;
  process.stdout.write(JSON.stringify({ type: 'test:start', name: r.name, file: r.file }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'step:end', test: r.name, step: {} }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'test:end', result: r, file: r.file }) + '\\n');
}
`);
  chmodSync(bin, 0o755);
  return root;
}

const argvOf = (root: string): string[] => JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8'));
const controller = () => vscodeMock.controllers[0]!;
const lastRun = () => controller().runs[controller().runs.length - 1]!;
const verdicts = () => lastRun().calls.filter((c) => c[0] !== 'enqueued' && c[0] !== 'started').map((c) => [c[0], c[1].slice(c[1].indexOf('::') + 2)]);

test('activate creates one `tflw` test controller with a default Run profile, and the workspace\'s files as items (M251 C)', async () => {
  const root = projectWithFakeTflw();
  vscodeMock.__setWorkspaceTflwFiles([join(root, 'shop.tflw')]);
  activate(makeContext() as never);
  assert.equal(vscodeMock.controllers.length, 1);
  assert.deepEqual(controller().profiles.map((p) => [p.label, p.kind, p.isDefault]), [['Run', vscodeMock.TestRunProfileKind.Run, true]]);
  await controller().resolveHandler!();
  const file = controller().items.get(join(root, 'shop.tflw'))!;
  assert.equal(file.label, 'shop.tflw');
  await controller().resolveHandler!(file);
  const names: string[] = [];
  file.children.forEach((c) => names.push(`${c.label}@${(c.range as unknown as { startLine: number }).startLine}`));
  assert.deepEqual(names, ['lists products@0', 'adds to cart@3', 'checks out@8']);
});

test('running a file: one `tflw run <file> --format ndjson`, each test started, then passed, failed at its step, or skipped; the report is linked (M251 C)', async () => {
  const root = projectWithFakeTflw();
  activate(makeContext() as never);
  await vscodeMock.registeredCommands.get('tflw.runFile')!({ fsPath: join(root, 'shop.tflw') });
  assert.deepEqual(argvOf(root), ['run', 'shop.tflw', '--format', 'ndjson', '--no-color']);
  assert.deepEqual(verdicts(), [['passed', 'lists products'], ['failed', 'adds to cart'], ['skipped', 'checks out']]);
  assert.equal(lastRun().calls.filter((c) => c[0] === 'started').length, 3);
  const failed = lastRun().calls.find((c) => c[0] === 'failed')!;
  const message = failed[2] as InstanceType<typeof vscodeMock.TestMessage>;
  assert.equal(message.message, 'expect status equals 201\nexpected status to equal 201, but got 500');
  assert.equal((message.location!.range as InstanceType<typeof vscodeMock.Position>).line, 6, 'the failing step\'s line, 0-based');
  assert.equal((message.location!.uri as { fsPath: string }).fsPath, join(root, 'shop.tflw'));
  assert.match(lastRun().output, new RegExp(`report — file://${join(root, 'out', 'report.html').replace(/[.\\/]/g, '\\$&')}`));
  assert.equal(lastRun().ended, true);
});

test('the Run test lens runs that one test with `--only`, and only it is reported (M251 C)', async () => {
  const root = projectWithFakeTflw();
  activate(makeContext() as never);
  await vscodeMock.registeredCommands.get('tflw.runTest')!({ fsPath: join(root, 'shop.tflw') }, 'adds to cart');
  assert.deepEqual(argvOf(root), ['run', 'shop.tflw', '--only', 'adds to cart', '--format', 'ndjson', '--no-color']);
  assert.deepEqual(verdicts(), [['failed', 'adds to cart']]);
});

test('a run that dies before a test reports errors that test with the tail of stderr, rather than leaving it spinning (M251 C)', async () => {
  const root = projectWithFakeTflw({ exitWithout: true });
  activate(makeContext() as never);
  await vscodeMock.registeredCommands.get('tflw.runTest')!({ fsPath: join(root, 'shop.tflw') }, 'lists products');
  const errored = lastRun().calls.filter((c) => c[0] === 'errored');
  assert.equal(errored.length, 1);
  assert.match((errored[0]![2] as InstanceType<typeof vscodeMock.TestMessage>).message, /exited 2 before this test reported[\s\S]*no tflw\.config here/);
});

test('rerun failed is `tflw run --failed`, and a test it did not re-run is not marked at all (M251 C)', async () => {
  const root = projectWithFakeTflw({ results: [RESULTS[1]] });
  vscodeMock.__setWorkspaceFolders([{ uri: { fsPath: root } }]);
  activate(makeContext() as never);
  await vscodeMock.registeredCommands.get('tflw.runFile')!({ fsPath: join(root, 'shop.tflw') });
  await vscodeMock.registeredCommands.get('tflw.runFailed')!();
  assert.deepEqual(argvOf(root), ['run', '--failed', '--format', 'ndjson', '--no-color']);
  assert.deepEqual(verdicts(), [['failed', 'adds to cart']]);
});
