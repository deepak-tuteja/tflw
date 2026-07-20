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
  assert.equal(result.capabilities.renameProvider, true);
  assert.ok(result.capabilities.completionProvider);
  assert.ok(result.capabilities.signatureHelpProvider);
  assert.ok(result.capabilities.semanticTokensProvider);
  client.dispose();
});

test('diagnostics: opening a file with an unknown session publishes a TF028 diagnostic', async () => {
  const { client, uri } = await connectServer();
  const text = `test "ok" as nope\n  api GET /health\n`;

  const diagnosticsPromise = new Promise<{ diagnostics: { code: string }[] }>((resolve) => {
    client.onNotification('textDocument/publishDiagnostics', (params) => resolve(params as { diagnostics: { code: string }[] }));
  });
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
