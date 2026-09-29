// Real in-memory JSON-RPC smoke tests (PLAN_M13_LSP.md Phase 3, decision 17.8) — a cross-wired
// `stream.PassThrough` pair drives `startServer()` exactly the way `tflw lsp` would over real
// stdio, but in-process: a `vscode-jsonrpc` client on one end, the server on the other, speaking
// the actual LSP wire protocol (not calling any internal function directly). One test per
// capability, proving each is reachable outside VS Code (the concrete payoff decision 17.2/17.4
// implies) without needing a real editor or a spawned subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc/node';
import { startServer } from '../src/server.js';
import { parseSource, displayAnchor } from '@tflw/lang';

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

function positionAt(text: string, offset: number): LspPosition {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
}

function offsetAt(text: string, pos: LspPosition): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < pos.line; i++) offset += lines[i]!.length + 1;
  return offset + pos.character;
}

/** Wires a client-side `MessageConnection` to a fresh `startServer()` instance over a pair of
 * in-memory streams, performs the standard `initialize`/`initialized` handshake, and returns the
 * client plus a ready-to-use document URI under a throwaway (non-existent-on-disk) directory —
 * none of these tests reference `tflw.config`, so no real project directory is needed. */
async function connectServer(): Promise<{ client: MessageConnection; uri: string }> {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  startServer({ input: clientToServer, output: serverToClient });

  const client = createMessageConnection(serverToClient, clientToServer);
  client.listen();
  await client.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {} });
  client.sendNotification('initialized', {});

  const uri = pathToFileURL(join('/tmp/tflw-lsp-protocol-test', 'doc.tflw')).href;
  return { client, uri };
}

function openDocument(client: MessageConnection, uri: string, text: string): void {
  client.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'tflw', version: 1, text } });
}

test('initialize: advertises capabilities for every LSP feature this server implements', async () => {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  startServer({ input: clientToServer, output: serverToClient });
  const client = createMessageConnection(serverToClient, clientToServer);
  client.listen();

  const result = (await client.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {} })) as {
    capabilities: Record<string, unknown>;
  };
  assert.equal(result.capabilities.hoverProvider, true);
  assert.equal(result.capabilities.definitionProvider, true);
  // M122/D219 — an object with `prepareProvider`, not a bare `true`: without the prepare step the
  // client guesses the rename range with its own generic word pattern, which does not know tflw's
  // identifier rule, and nothing can reject an invalid position before the rename box opens.
  assert.deepEqual(result.capabilities.renameProvider, { prepareProvider: true });
  assert.ok(result.capabilities.completionProvider);
  assert.ok(result.capabilities.signatureHelpProvider);
  assert.ok(result.capabilities.semanticTokensProvider);
  assert.equal(result.capabilities.documentFormattingProvider, true);
  assert.equal(result.capabilities.documentSymbolProvider, true);
  assert.equal(result.capabilities.referencesProvider, true);
  assert.equal(result.capabilities.foldingRangeProvider, true);
  assert.deepEqual(result.capabilities.codeActionProvider, { codeActionKinds: ['quickfix', 'refactor.extract'] });
  client.dispose();
});

test('diagnostics: opening a file with an unknown session publishes a TF028 diagnostic', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok" as nope\n  api GET /health\n`;

  // Via `nextDiagnostics` (below) rather than a bare promise: an unbounded wait here does not fail
  // this test, it cancels every test after it in the file (M122, `M122-02`).
  const diagnosticsPromise = nextDiagnostics(client, 'a file with an unknown session');
  openDocument(client, uri, text);
  const { diagnostics } = await diagnosticsPromise;

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'TF028');
  client.dispose();
});

test('hover: a matcher keyword returns spec-data.ts markdown', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  openDocument(client, uri, text);

  const position = positionAt(text, text.indexOf('equals') + 1);
  const result = (await client.sendRequest('textDocument/hover', { textDocument: { uri }, position })) as {
    contents: { value: string };
  } | null;

  assert.ok(result);
  assert.match(result!.contents.value, /equals/);
  client.dispose();
});

test('definition: a variable ref jumps to its let-bound def in the same file', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok"\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  openDocument(client, uri, text);

  const position = positionAt(text, text.indexOf('{orderId}') + 2);
  const result = (await client.sendRequest('textDocument/definition', { textDocument: { uri }, position })) as {
    uri: string;
    range: { start: LspPosition; end: LspPosition };
  } | null;

  assert.ok(result);
  assert.equal(result!.uri, uri);
  const defText = text.slice(offsetAt(text, result!.range.start), offsetAt(text, result!.range.end));
  assert.equal(defText, 'orderId');
  client.dispose();
});

test('completion: a step-position prefix returns matching keyword candidates', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok"\n  e`;
  openDocument(client, uri, text);

  const position = positionAt(text, text.length);
  const result = (await client.sendRequest('textDocument/completion', { textDocument: { uri }, position })) as { label: string }[];

  assert.deepEqual(
    result.map((c) => c.label),
    ['expect'],
  );
  client.dispose();
});

test('signatureHelp: unique(...) reports its fixed one-param signature', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok"\n  let x = unique("ord")\n  api GET /health\n  expect status equals 200\n`;
  openDocument(client, uri, text);

  const position = positionAt(text, text.indexOf('"ord"') + 1);
  const result = (await client.sendRequest('textDocument/signatureHelp', { textDocument: { uri }, position })) as {
    signatures: { label: string; parameters: { label: string }[] }[];
    activeParameter: number;
  } | null;

  assert.ok(result);
  assert.equal(result!.signatures[0]!.label, 'unique(prefix)');
  assert.deepEqual(
    result!.signatures[0]!.parameters.map((p) => p.label),
    ['prefix'],
  );
  client.dispose();
});

test('rename: renaming a captured variable edits every ref in the file', async () => {
  const { client, uri } = await connectServer();
  const text = `test "a"\n  let token = unique("t")\n  api GET /health\n  let copy = token\n`;
  openDocument(client, uri, text);

  const position = positionAt(text, text.indexOf('token') + 1);
  const result = (await client.sendRequest('textDocument/rename', { textDocument: { uri }, position, newName: 'authToken' })) as {
    changes: Record<string, { range: unknown; newText: string }[]>;
  } | null;

  assert.ok(result);
  const edits = result!.changes[uri];
  assert.equal(edits?.length, 2);
  assert.ok(edits!.every((e) => e.newText === 'authToken'));
  client.dispose();
});

test('semanticTokens/full: returns a well-formed, non-empty token stream for a representative file', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok"\n  api POST /orders body { rating: 5 }\n  expect status equals 200\n`;
  openDocument(client, uri, text);

  const result = (await client.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri } })) as { data: number[] } | null;

  assert.ok(result);
  // 5 ints per token (deltaLine, deltaStart, length, tokenType, tokenModifiers) — never a partial group.
  assert.equal(result!.data.length % 5, 0);
  assert.ok(result!.data.length > 0);
  client.dispose();
});

// ---------------------------------------------------------------------------------------------
// M122 — `B5-06` (an unsaved buffer silently gets no language support at all).
//
// VS Code routes an unsaved document here as `untitled:Untitled-1`, because
// `packages/vscode/src/extension.ts` registers `{ language: 'tflw' }` with no `scheme`. Before
// M122, `onDidOpen` called `fileURLToPath` on that URI unconditionally and it threw
// `ERR_INVALID_URL_SCHEME` — inside a *notification* handler, so vscode-jsonrpc swallowed the throw
// and the client saw nothing at all. These tests are written against the wire, not against
// `DocumentStore`, because that swallowing is the whole defect: any test that called the store
// directly would have passed on the pre-fix code.
// ---------------------------------------------------------------------------------------------

const UNTITLED = 'untitled:Untitled-1';

/** Waits for the next `publishDiagnostics`, **with a live timer**, and that detail is the point.
 *
 * A bare `new Promise((resolve) => client.onNotification(…))` is the obvious way to write this and
 * it makes the suite lie. When the server never analyzes the document, nothing keeps the event loop
 * alive, node:test resolves the loop and cancels every remaining test in the file with
 * `failureType: 'cancelledByParent'` — reported as `# fail 0`, `# cancelled 9`, with the process
 * still exiting 1. The run is red, no assertion ever ran, and tests for an unrelated row go red
 * alongside it. Measured on M122's own `untitled-uri-back-to-filepath` mutation: nine `not ok`
 * lines, zero failures, and four of the nine belonged to `B5-07`.
 *
 * The pending `setTimeout` holds the loop open long enough for the rejection to be *this* test's,
 * with a message that says what did not happen (`M119`: an instrument can be wrong in a direction
 * that looks like a result). */
function nextDiagnostics(
  client: MessageConnection,
  whatFor: string,
): Promise<{ uri: string; diagnostics: { code: string; range: { start: LspPosition; end: LspPosition } }[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no publishDiagnostics arrived for ${whatFor} within 5s — the server never analyzed the document`)), 5_000);
    client.onNotification('textDocument/publishDiagnostics', (params) => {
      clearTimeout(timer);
      resolve(params as { uri: string; diagnostics: { code: string; range: { start: LspPosition; end: LspPosition } }[] });
    });
  });
}

test('B5-06: an unsaved (untitled:) buffer is analyzed and gets diagnostics, not silence', { timeout: 15_000 }, async () => {
  const { client } = await connectServer();
  const text = `test "ok" as nope\n  api GET /health\n`;

  const published = nextDiagnostics(client, 'the untitled buffer');
  openDocument(client, UNTITLED, text);
  const params = await published;

  assert.equal(params.uri, UNTITLED);
  assert.equal(params.diagnostics.length, 1);
  assert.equal(params.diagnostics[0]!.code, 'TF028');
  client.dispose();
});

test('B5-06: an unsaved buffer answers hover and semantic tokens like any other document', async () => {
  const { client } = await connectServer();
  const text = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  openDocument(client, UNTITLED, text);

  const hover = (await client.sendRequest('textDocument/hover', {
    textDocument: { uri: UNTITLED },
    position: positionAt(text, text.indexOf('equals') + 1),
  })) as { contents: { value: string } } | null;
  assert.ok(hover, 'hover returned null for an unsaved buffer');
  assert.match(hover!.contents.value, /equals/);

  const tokens = (await client.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: UNTITLED } })) as { data: number[] } | null;
  assert.ok(tokens, 'semanticTokens returned null for an unsaved buffer');
  assert.ok(tokens!.data.length > 0);
  client.dispose();
});

test('B5-06: an unsaved buffer keeps answering after an edit — the store does not go permanently deaf', { timeout: 15_000 }, async () => {
  // The half of this row that outlived the initial failure. `store.update` and
  // `store.scheduleDiagnostics` both begin `if (!doc) return`, so a document that never got opened
  // stayed dead for the life of the session: every subsequent keystroke was a silent no-op too.
  const { client } = await connectServer();
  openDocument(client, UNTITLED, `test "ok" as nope\n  api GET /health\n`);
  await nextDiagnostics(client, 'the initial open of the untitled buffer');

  const afterEdit = nextDiagnostics(client, 'the untitled buffer after an edit');
  client.sendNotification('textDocument/didChange', {
    textDocument: { uri: UNTITLED, version: 2 },
    contentChanges: [{ text: `test "ok" as alsoNope\n  api GET /health\n` }],
  });
  const params = await afterEdit;

  assert.equal(params.uri, UNTITLED);
  assert.equal(params.diagnostics[0]!.code, 'TF028');
  client.dispose();
});

test('B5-06: an in-file rename works in an unsaved buffer', async () => {
  const { client } = await connectServer();
  const text = `test "a"\n  let token = unique("t")\n  api GET /health\n  let copy = token\n`;
  openDocument(client, UNTITLED, text);

  const result = (await client.sendRequest('textDocument/rename', {
    textDocument: { uri: UNTITLED },
    position: positionAt(text, text.indexOf('token') + 1),
    newName: 'authToken',
  })) as { changes: Record<string, { newText: string }[]> } | null;

  assert.ok(result);
  assert.equal(result!.changes[UNTITLED]?.length, 2);
  client.dispose();
});

test('B5-06: an unresolvable import in an unsaved buffer is not reported missing (D214)', { timeout: 15_000 }, async () => {
  // The reason `absPath` is `undefined` rather than a synthetic stand-in path. With a made-up path,
  // `resolveMissingFiles` would stat a directory that does not exist and squiggle every `import` in
  // a scratch buffer red. The `file:` control proves the pass still fires where a path does exist —
  // without it, this test would also pass if `TF043` had simply been deleted.
  const { client, uri: fileUri } = await connectServer();
  const text = `import "./nope.tflw"\n\ntest "a"\n  api GET /health\n  expect status equals 200\n`;

  const untitledDiags = nextDiagnostics(client, 'the untitled buffer with an import');
  openDocument(client, UNTITLED, text);
  assert.deepEqual((await untitledDiags).diagnostics.map((d) => d.code), []);

  const fileDiags = nextDiagnostics(client, 'the file: control');
  openDocument(client, fileUri, text);
  assert.deepEqual((await fileDiags).diagnostics.map((d) => d.code), ['TF043']);
  client.dispose();
});

// ---------------------------------------------------------------------------------------------
// M122 — `B5-07` (LSP rename accepts any string, including the empty one).
// ---------------------------------------------------------------------------------------------

const RENAME_FIXTURE = `test "a"\n  let token = unique("t")\n  api GET /health\n  let copy = token\n`;

async function renameTo(client: MessageConnection, uri: string, newName: string): Promise<{ ok: true; edits: { newText: string }[] } | { ok: false; message: string }> {
  try {
    const result = (await client.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position: positionAt(RENAME_FIXTURE, RENAME_FIXTURE.indexOf('token') + 1),
      newName,
    })) as { changes: Record<string, { newText: string }[]> };
    return { ok: true, edits: result.changes[uri] ?? [] };
  } catch (e) {
    return { ok: false, message: (e as { message: string }).message };
  }
}

test('B5-07: an unusable newName is refused with an explanatory error and edits nothing', async () => {
  const { client, uri } = await connectServer();
  openDocument(client, uri, RENAME_FIXTURE);

  // Every one of these used to come back as two edits carrying the string verbatim, leaving a file
  // that no longer parses — and for a `crossFile` symbol, every file in the project along with it.
  // `'  ok  '` is the one that does not look like the others. It lexes to a single clean `ident`
  // with no diagnostics, because the lexer reads leading whitespace as indentation and drops
  // trailing whitespace — so a validator that only asked "exactly one ident token?" would accept it
  // and splice the padding into every span, including interpolations (`{orderId}` → `{  ok  }`).
  for (const newName of ['', '   ', '123abc', 'has space', 'has-dash', 'a\nb', '{{x}}', '"q"', '  ok  ', 'ok\t']) {
    const outcome = await renameTo(client, uri, newName);
    assert.equal(outcome.ok, false, `rename accepted ${JSON.stringify(newName)}`);
    assert.match((outcome as { message: string }).message, /a name (cannot be empty|starts with a letter)/);
  }
  client.dispose();
});

test('B5-07: a contextual keyword is a legal name and is still accepted (D217)', async () => {
  // The obvious companion rule — reject keywords — would be wrong. tflw's keywords are contextual,
  // the lexer emits `ident` for all of them, and `let status = unique("t")` checks clean, so a
  // blocklist would refuse renames the language itself accepts.
  const { client, uri } = await connectServer();
  openDocument(client, uri, RENAME_FIXTURE);

  for (const newName of ['let', 'status', 'expect', 'ok_name', '_x']) {
    const outcome = await renameTo(client, uri, newName);
    assert.equal(outcome.ok, true, `rename refused ${JSON.stringify(newName)}`);
    assert.equal((outcome as { edits: { newText: string }[] }).edits.length, 2);
    assert.ok((outcome as { edits: { newText: string }[] }).edits.every((e) => e.newText === newName));
  }
  client.dispose();
});

test('B5-07: prepareRename reports the occurrence under the cursor and its current name', async () => {
  const { client, uri } = await connectServer();
  openDocument(client, uri, RENAME_FIXTURE);

  // The *second* occurrence (`let copy = token`), not the definition — the editor pre-selects the
  // range it is given, so answering with the symbol's first span would move the user's selection.
  const offset = RENAME_FIXTURE.lastIndexOf('token') + 1;
  const result = (await client.sendRequest('textDocument/prepareRename', {
    textDocument: { uri },
    position: positionAt(RENAME_FIXTURE, offset),
  })) as { range: { start: LspPosition; end: LspPosition }; placeholder: string } | null;

  assert.ok(result, 'prepareRename was Unhandled before M122');
  assert.equal(result!.placeholder, 'token');
  assert.equal(offsetAt(RENAME_FIXTURE, result!.range.start), RENAME_FIXTURE.lastIndexOf('token'));
  assert.equal(RENAME_FIXTURE.slice(offsetAt(RENAME_FIXTURE, result!.range.start), offsetAt(RENAME_FIXTURE, result!.range.end)), 'token');
  client.dispose();
});

test('B5-07: prepareRename returns null where nothing is renameable', async () => {
  const { client, uri } = await connectServer();
  openDocument(client, uri, RENAME_FIXTURE);

  const result = await client.sendRequest('textDocument/prepareRename', {
    textDocument: { uri },
    position: positionAt(RENAME_FIXTURE, RENAME_FIXTURE.indexOf('"a"') + 1),
  });

  assert.equal(result, null);
  client.dispose();
});

// ---------------------------------------------------------------------------------------------
// M136b — D427/D428: the config dialect got its own VS Code language id (`tflw-config`).
//
// The failure mode of a language-id split is silence, not an error: the client attaches to nothing
// and every feature disappears at once while every test that exercises the *server* stays green.
// These two are written over the wire, with the new id on the `didOpen`, because that is the only
// place the split is observable from this package — and they assert what the split can break
// (diagnostics arriving at all) before what the row asked for (colour).
//
// The reassuring half, and the measurement that made this milestone low-risk: the server never
// reads `languageId`. `documentStore.ts`'s `classify` branches on the **filename**, so the dialect
// the parser and the colouring pass see cannot disagree with each other, and cannot be desynced by
// a client that sends the wrong id. These tests pin that property rather than assume it.

/** `openDocument` with the config dialect's language id and a `tflw.config` file name. */
function openConfigDocument(client: MessageConnection, uri: string, text: string): void {
  client.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'tflw-config', version: 1, text } });
}

const CONFIG_URI = pathToFileURL(join('/tmp/tflw-lsp-protocol-test', 'tflw.config')).href;

test('M136b/D428: a `tflw.config` buffer opened under the new language id still receives diagnostics', { timeout: 15_000 }, async () => {
  const { client } = await connectServer();
  // `test` is banned in the declaration-only dialect (TF021) — a diagnostic only the config parser
  // produces, so its arrival proves the buffer was analyzed *as a config* and not merely analyzed.
  const text = 'test "not allowed here"\n';

  const published = nextDiagnostics(client, 'the tflw.config buffer');
  openConfigDocument(client, CONFIG_URI, text);
  const params = await published;

  assert.equal(params.uri, CONFIG_URI);
  assert.equal(params.diagnostics.length, 1);
  assert.equal(params.diagnostics[0]!.code, 'TF021');
  client.dispose();
});

test('M136b/D427: semanticTokens/full colors config-only vocabulary in a `tflw.config` buffer', async () => {
  const { client } = await connectServer();
  const text = 'defaults\n  allow hosts "api.example.com"\n  evidence headers only\n';
  openConfigDocument(client, CONFIG_URI, text);

  const result = (await client.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: CONFIG_URI } })) as { data: number[] } | null;

  assert.ok(result);
  assert.equal(result!.data.length % 5, 0);
  // `defaults` alone would satisfy a non-empty check — it is in the shared wordlist and was colored
  // before this milestone. Six tokens is the claim: `defaults`, plus `allow`/`hosts`/`evidence`,
  // none of which the server could color until it was told which dialect it was looking at, plus
  // `headers`/`only` — the evidence level, which `M147b` turned from a string into two bare
  // keywords and which `M142` had recorded as unreachable by any wordlist while it was a string.
  assert.equal(result!.data.length / 5, 6, 'expected `defaults`, the three config-only keywords, and both words of the level');
  client.dispose();
});

// ---------------------------------------------------------------------------------------------
// `M147e-6` / `M106-01` — the CLI and the editor point at the same place.
//
// The row asked whether they are allowed to disagree about where an error *is*. `M140-3` measured
// them over stdio and found them disagreeing on three of the four shapes it names: a bare `test`
// with a trailing newline, one followed by a comment line, one followed by trailing whitespace, and
// one with no trailing newline. The LSP published `d.span` verbatim — line 1 character 0, on the
// phantom last line `split('\n')` manufactures — while the CLI published `displayAnchor`'s
// re-anchored 1:9.
//
// **`D624` said the fix was for the LSP to adopt `displayAnchor`, and that is not what closed it.**
// `M147e-5` moved the eleven "this X has no Y" rules onto their construct's header span, and the
// re-anchoring those four shapes depended on went to zero across the whole corpus (410 → 0). All
// four now agree, and none of them publishes a zero-width range any more — which also retires the
// question `D197` parked the row on, what VS Code draws for a zero-width range past the last line,
// because no rule produces one.
//
// Asserted here rather than left as a measurement, because agreement reached from the producer side
// is agreement nothing is holding: a future rule that anchors past its construct reopens `M106-01`
// silently in the editor, where nobody is looking. This is the test that notices.
// ---------------------------------------------------------------------------------------------

test('M147e/M106-01: the LSP range and the CLI caret agree on every end-of-source shape', { timeout: 15_000 }, async () => {
  const shapes: readonly (readonly [string, string])[] = [
    ['a trailing newline', 'test "x"\n'],
    ['a comment line after it', 'test "x"\n  # TODO: add the steps\n'],
    ['trailing whitespace', 'test "x"   \n'],
    ['no trailing newline', 'test "x"'],
    ['mid-file (the control)', 'test "x"\n  api GET\n'],
  ];
  for (const [what, text] of shapes) {
    const { client, uri } = await connectServer();
    const published = nextDiagnostics(client, what);
    openDocument(client, uri, text);
    const params = await published;
    assert.ok(params.diagnostics.length > 0, `${what}: expected a diagnostic`);

    const local = parseSource(text).diagnostics[0]!;
    const cli = displayAnchor(local.span, text);
    assert.deepEqual(
      params.diagnostics[0]!.range.start,
      { line: cli.line - 1, character: cli.column - 1 },
      `${what}: the editor's squiggle starts where the CLI caret does not`,
    );

    // The line the range sits on must be a line the file actually has. This is the half `M106-01`
    // was really about: a range on the phantom last line is not merely in the wrong column, it is
    // outside the document, and what an editor does with that was never measured.
    assert.ok(
      params.diagnostics[0]!.range.end.line < text.split('\n').length,
      `${what}: the range ends past the last line of the document`,
    );
    client.dispose();
  }
});

test('formatting: one whole-document edit with `tflw fmt`\'s text, and none when the file is already formatted or does not lex (M191)', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok"\n    api POST /o body {a:1}\n`;
  openDocument(client, uri, text);
  const opts = { tabSize: 2, insertSpaces: true };
  const edits = (await client.sendRequest('textDocument/formatting', { textDocument: { uri }, options: opts })) as { range: unknown; newText: string }[];
  assert.equal(edits.length, 1);
  assert.equal(edits[0]!.newText, 'test "ok"\n  api POST /o body { a: 1 }\n');
  client.dispose();

  const clean = await connectServer();
  openDocument(clean.client, clean.uri, 'test "ok"\n  api POST /o body { a: 1 }\n');
  assert.deepEqual(await clean.client.sendRequest('textDocument/formatting', { textDocument: { uri: clean.uri }, options: opts }), []);
  clean.client.dispose();

  const broken = await connectServer();
  openDocument(broken.client, broken.uri, 'test "ok"\n  api GET /x $\n');
  assert.deepEqual(await broken.client.sendRequest('textDocument/formatting', { textDocument: { uri: broken.uri }, options: opts }), []);
  broken.client.dispose();
});

// ---- `M251` `A` (`D1366`): the outline, the folds, find-all-references -------------------------

type LspRange = { start: LspPosition; end: LspPosition };
const OUTLINE_FILE = [
  '# a header note',
  '# on two lines',
  'element badge = css ".badge"',
  '',
  'action add item(sku)',
  '  api POST /cart body { sku: {sku} }',
  '  expect status equals 201',
  '',
  'before',
  '  api GET /health',
  '',
  '@smoke',
  'test "adds one"',
  '  let sku = unique("s")',
  '  add item(sku)',
  '  within css ".cart"',
  '    click css ".go"',
  '',
].join('\n');

test('documentSymbol: a file\'s element, action, hook and test in file order, each selecting its name (M251 A)', async () => {
  const { client, uri } = await connectServer();
  openDocument(client, uri, OUTLINE_FILE);
  const result = (await client.sendRequest('textDocument/documentSymbol', { textDocument: { uri } })) as {
    name: string; kind: number; detail?: string; range: LspRange; selectionRange: LspRange;
  }[];
  assert.deepEqual(result.map((s) => [s.name, s.kind]), [['badge', 8], ['add item', 12], ['before', 24], ['adds one', 6]]);
  const test = result.find((s) => s.name === 'adds one')!;
  assert.equal(test.detail, '@smoke');
  assert.equal(OUTLINE_FILE.slice(offsetAt(OUTLINE_FILE, test.selectionRange.start), offsetAt(OUTLINE_FILE, test.selectionRange.end)), '"adds one"');
  const badge = result.find((s) => s.name === 'badge')!;
  assert.equal(OUTLINE_FILE.slice(offsetAt(OUTLINE_FILE, badge.selectionRange.start), offsetAt(OUTLINE_FILE, badge.selectionRange.end)), 'badge');
  for (const s of result) {
    assert.ok(offsetAt(OUTLINE_FILE, s.range.start) <= offsetAt(OUTLINE_FILE, s.selectionRange.start), `${s.name}: selection inside range`);
    assert.ok(offsetAt(OUTLINE_FILE, s.selectionRange.end) <= offsetAt(OUTLINE_FILE, s.range.end), `${s.name}: selection inside range`);
  }
  client.dispose();
});

test('documentSymbol: a tflw.config lists its envs and sessions (M251 A)', async () => {
  const { client } = await connectServer();
  const uri = pathToFileURL(join('/tmp/tflw-lsp-protocol-test', 'tflw.config')).href;
  const text = 'env local default\n  api "http://127.0.0.1:1"\n\nsession shopper\n  api POST /login\n  expect status equals 200\n';
  client.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'tflw-config', version: 1, text } });
  const result = (await client.sendRequest('textDocument/documentSymbol', { textDocument: { uri } })) as { name: string; detail?: string }[];
  assert.deepEqual(result.map((s) => [s.name, s.detail]), [['local', 'default'], ['shopper', undefined]]);
  client.dispose();
});

test('foldingRange: every offside block folds from its header to its last line, nested ones too, and a comment run folds as a comment (M251 A)', async () => {
  const { client, uri } = await connectServer();
  openDocument(client, uri, OUTLINE_FILE);
  const result = (await client.sendRequest('textDocument/foldingRange', { textDocument: { uri } })) as { startLine: number; endLine: number; kind?: string }[];
  assert.deepEqual(result.map((f) => [f.startLine, f.endLine, f.kind ?? 'region']), [
    [0, 1, 'comment'],
    [4, 6, 'region'],
    [8, 9, 'region'],
    [12, 16, 'region'],
    [15, 16, 'region'],
  ]);
  client.dispose();
});

test('references: a variable\'s uses, with and without its declaration (M251 A)', async () => {
  const { client, uri } = await connectServer();
  const text = 'test "a"\n  let token = unique("t")\n  api GET /health\n  let copy = token\n  log "{token}"\n';
  openDocument(client, uri, text);
  const position = positionAt(text, text.indexOf('token') + 1);
  const ask = async (includeDeclaration: boolean) =>
    ((await client.sendRequest('textDocument/references', { textDocument: { uri }, position, context: { includeDeclaration } })) as { uri: string; range: LspRange }[])
      .map((l) => offsetAt(text, l.range.start)).sort((a, b) => a - b);
  const decl = text.indexOf('token');
  const uses = [text.indexOf('token', decl + 1), text.indexOf('{token}') + 1];
  assert.deepEqual(await ask(true), [decl, ...uses]);
  assert.deepEqual(await ask(false), uses);
  client.dispose();
});

test('references: an action is found in the files that import it, and nowhere it is merely spelt alike (M251 A)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tflw-lsp-refs-'));
  try {
    await mkdir(join(root, 'shared'));
    await writeFile(join(root, 'tflw.config'), 'env local default\n  api "http://127.0.0.1:1"\n');
    const shared = 'action add item(sku)\n  api POST /cart body { sku: {sku} }\n  expect status equals 201\n';
    const a = 'import "./shared/cart.tflw"\n\ntest "one"\n  add item("a")\n  add item("b")\n';
    const b = 'import "./shared/cart.tflw"\n\ntest "two"\n  add item("c")\n  log "add item"\n';
    await writeFile(join(root, 'shared', 'cart.tflw'), shared);
    await writeFile(join(root, 'a.tflw'), a);
    await writeFile(join(root, 'b.tflw'), b);
    const { client } = await connectServer();
    const uri = pathToFileURL(join(root, 'a.tflw')).href;
    openDocument(client, uri, a);
    const result = (await client.sendRequest('textDocument/references', {
      textDocument: { uri }, position: positionAt(a, a.indexOf('add item') + 1), context: { includeDeclaration: true },
    })) as { uri: string; range: LspRange }[];
    const byFile = new Map<string, number>();
    for (const l of result) { const f = l.uri.slice(l.uri.lastIndexOf('/') + 1); byFile.set(f, (byFile.get(f) ?? 0) + 1); }
    assert.deepEqual(Object.fromEntries([...byFile].sort()), { 'a.tflw': 2, 'b.tflw': 1, 'cart.tflw': 1 });
    client.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---- `M251` `B` (`D1367`): code actions -----------------------------------------------------

test('codeAction: a diagnostic whose hint says `did you mean` offers the one-word fix, and nothing else is offered for it (M251 B)', async () => {
  const { client, uri } = await connectServer();
  const text = 'test "a"\n  api GET /health\n  expct status equals 200\n';
  const diagnosticsPromise = nextDiagnostics(client, 'a misspelt step');
  openDocument(client, uri, text);
  const { diagnostics } = await diagnosticsPromise;
  const d = diagnostics.find((x) => x.code === 'TF011')!;
  assert.ok(d, 'TF011 for `expct`');
  const actions = (await client.sendRequest('textDocument/codeAction', {
    textDocument: { uri }, range: d.range, context: { diagnostics: [d] },
  })) as { title: string; kind: string; edit: { changes: Record<string, { range: LspRange; newText: string }[]> } }[];
  assert.deepEqual(actions.map((a) => [a.title, a.kind]), [['Change to `expect`', 'quickfix']]);
  const [edit] = actions[0]!.edit.changes[uri]!;
  assert.equal(text.slice(0, offsetAt(text, edit!.range.start)) + edit!.newText + text.slice(offsetAt(text, edit!.range.end)), text.replace('expct', 'expect'));
  // `only` is honoured: asking for refactors alone gets no quick fix.
  const refactorsOnly = (await client.sendRequest('textDocument/codeAction', {
    textDocument: { uri }, range: d.range, context: { diagnostics: [d], only: ['refactor'] },
  })) as unknown[];
  assert.deepEqual(refactorsOnly, []);
  client.dispose();
});

const CLI_ENTRY = fileURLToPath(new URL('../../cli/dist/cli.cjs', import.meta.url));
const REUSE_SUITE = {
  'tflw.config': 'env local default\n  api "http://127.0.0.1:1"\n',
  'orders.tflw': [
    'test "create widget order"',
    '  api POST /orders body { name: "Widget", qty: 3 }',
    '  expect status equals 201',
    '  api GET /health',
    '  expect status equals 200',
    '',
    'test "create gadget order"',
    '  api POST /orders body { name: "Gadget", qty: 3 }',
    '  expect status equals 201',
    '  api GET /health',
    '  expect status equals 200',
    '',
  ].join('\n'),
};

async function tree(dir: string, base = dir): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, await tree(full, base));
    else out[full.slice(base.length + 1).split('\\').join('/')] = await readFile(full, 'utf8');
  }
  return out;
}

/** Applies a `WorkspaceEdit`'s `documentChanges` to disk the way an editor would: a create makes an
 * empty file, a text edit splices its ranges into the file's current text. */
async function applyWorkspaceEdit(edit: { documentChanges: ({ kind: 'create'; uri: string } | { textDocument: { uri: string }; edits: { range: LspRange; newText: string }[] })[] }): Promise<void> {
  for (const change of edit.documentChanges) {
    if ('kind' in change) {
      const path = fileURLToPath(change.uri);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, '');
      continue;
    }
    const path = fileURLToPath(change.textDocument.uri);
    let text = await readFile(path, 'utf8');
    const edits = [...change.edits].sort((a, b) => offsetAt(text, b.range.start) - offsetAt(text, a.range.start));
    for (const e of edits) text = text.slice(0, offsetAt(text, e.range.start)) + e.newText + text.slice(offsetAt(text, e.range.end));
    await writeFile(path, text);
  }
}

test('codeAction: the editor\'s extraction writes the bytes `tflw refactor apply` writes for the same hint — one planner, two writers (M251 B)', async () => {
  const cmd = await mkdtemp(join(tmpdir(), 'tflw-lsp-reuse-cmd-'));
  const ed = await mkdtemp(join(tmpdir(), 'tflw-lsp-reuse-ed-'));
  try {
    for (const dir of [cmd, ed]) for (const [f, t] of Object.entries(REUSE_SUITE)) await writeFile(join(dir, f), t);

    execFileSync(process.execPath, [CLI_ENTRY, 'refactor', 'apply', 'RF001'], { cwd: cmd, encoding: 'utf8' });

    const { client } = await connectServer();
    const uri = pathToFileURL(join(ed, 'orders.tflw')).href;
    openDocument(client, uri, REUSE_SUITE['orders.tflw']);
    const actions = (await client.sendRequest('textDocument/codeAction', {
      textDocument: { uri }, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 2 } }, context: { diagnostics: [] },
    })) as { title: string; kind: string; edit: Parameters<typeof applyWorkspaceEdit>[0] }[];
    const extract = actions.filter((a) => a.kind === 'refactor.extract');
    assert.deepEqual(extract.map((a) => a.title), ['Extract into action `post orders` (RF001)']);
    await applyWorkspaceEdit(extract[0]!.edit);
    client.dispose();

    const [byCommand, byEditor] = [await tree(cmd), await tree(ed)];
    assert.deepEqual(Object.keys(byEditor).sort(), ['orders.tflw', 'shared/post-orders.tflw', 'tflw.config']);
    assert.deepEqual(byEditor, byCommand);
    // Negative control: the edit is not the suite unchanged.
    assert.notEqual(byEditor['orders.tflw'], REUSE_SUITE['orders.tflw']);
  } finally {
    await rm(cmd, { recursive: true, force: true });
    await rm(ed, { recursive: true, force: true });
  }
});
