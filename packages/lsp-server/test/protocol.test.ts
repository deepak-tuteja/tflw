// Real in-memory JSON-RPC smoke tests (PLAN_M13_LSP.md Phase 3, decision 17.8) — a cross-wired
// `stream.PassThrough` pair drives `startServer()` exactly the way `tflw lsp` would over real
// stdio, but in-process: a `vscode-jsonrpc` client on one end, the server on the other, speaking
// the actual LSP wire protocol (not calling any internal function directly). One test per
// capability, proving each is reachable outside VS Code (the concrete payoff decision 17.2/17.4
// implies) without needing a real editor or a spawned subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc/node';
import { startServer } from '../src/server.js';

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
function nextDiagnostics(client: MessageConnection, whatFor: string): Promise<{ uri: string; diagnostics: { code: string }[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no publishDiagnostics arrived for ${whatFor} within 5s — the server never analyzed the document`)), 5_000);
    client.onNotification('textDocument/publishDiagnostics', (params) => {
      clearTimeout(timer);
      resolve(params as { uri: string; diagnostics: { code: string }[] });
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
  const text = 'defaults\n  allow hosts "api.example.com"\n  evidence "headers-only"\n';
  openConfigDocument(client, CONFIG_URI, text);

  const result = (await client.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri: CONFIG_URI } })) as { data: number[] } | null;

  assert.ok(result);
  assert.equal(result!.data.length % 5, 0);
  // `defaults` alone would satisfy a non-empty check — it is in the shared wordlist and was colored
  // before this milestone. Four tokens is the claim: `defaults`, plus `allow`/`hosts`/`evidence`,
  // none of which the server could color until it was told which dialect it was looking at.
  assert.equal(result!.data.length / 5, 4, 'expected `defaults` plus the three config-only keywords');
  client.dispose();
});
