// `tflw lsp` (PLAN_M13_LSP.md Phase 4): the CLI's own black-box smoke test for the subcommand that
// wires `@tflw/lsp-server`'s `startServer()` to real stdio. Deliberately hand-rolls the
// Content-Length framing instead of pulling in a JSON-RPC client library (unlike
// packages/lsp-server/test/protocol.test.ts's in-memory `vscode-jsonrpc` harness) — the point here
// is proving the *built* `dist/cli.cjs lsp` speaks the wire protocol correctly as a real spawned
// subprocess, the same "run the actual distributable" gap e2e.test.ts already backfills for `run`.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'cli.cjs');

before(() => {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
});

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

/** Reads exactly one Content-Length-framed JSON-RPC message off `stdout`, buffering across
 * however many `data` chunks it takes to see the full header + body. */
function readOneMessage(stdout: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buf.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length: (\d+)/.exec(header);
      if (!match) {
        cleanup();
        reject(new Error(`malformed LSP header: ${header}`));
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buf.length < bodyStart + length) return;
      const body = buf.subarray(bodyStart, bodyStart + length).toString('utf8');
      cleanup();
      resolve(JSON.parse(body) as Record<string, unknown>);
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      stdout.off('data', onData);
      stdout.off('error', onError);
    };
    stdout.on('data', onData);
    stdout.on('error', onError);
  });
}

test('`tflw lsp` speaks LSP over stdio: a raw Content-Length-framed `initialize` request gets a well-formed response advertising capabilities', async () => {
  const child: ChildProcessWithoutNullStreams = spawn('node', [cliEntry, 'lsp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const responsePromise = readOneMessage(child.stdout);
    child.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }));

    const response = await responsePromise;
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    const capabilities = (response.result as { capabilities: Record<string, unknown> }).capabilities;
    assert.equal(capabilities.hoverProvider, true);
    assert.equal(capabilities.definitionProvider, true);
    assert.equal(capabilities.renameProvider, true);
    assert.ok(capabilities.completionProvider);
    assert.ok(capabilities.signatureHelpProvider);
  } finally {
    child.kill();
  }
});

// `lspCommand`'s own returned promise never resolves (it just keeps the process alive so
// `main()`'s `.then((code) => process.exit(code))` never fires) — process termination is entirely
// `vscode-languageserver`'s `createConnection()` calling `process.exit()` itself, straight from
// `end`/`close` listeners it puts on the input stream: 0 after a proper `shutdown` request + `exit`
// notification handshake, 1 on an abrupt disconnect. Both are worth proving through the real
// spawned binary, since a subtly wrong exit code here is exactly the kind of thing that reads fine
// in-process but breaks a real editor's shutdown flow.
test('`tflw lsp` exits 0 after a clean `shutdown` request + `exit` notification handshake', async () => {
  const child: ChildProcessWithoutNullStreams = spawn('node', [cliEntry, 'lsp'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exitPromise = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));

  const initResponse = readOneMessage(child.stdout);
  child.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }));
  await initResponse;
  child.stdin.write(frame({ jsonrpc: '2.0', method: 'initialized', params: {} }));

  const shutdownResponse = readOneMessage(child.stdout);
  child.stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: null }));
  await shutdownResponse;
  child.stdin.write(frame({ jsonrpc: '2.0', method: 'exit', params: null }));

  assert.equal(await exitPromise, 0);
});

test('`tflw lsp` exits 1 when the pipe closes without a `shutdown` handshake (abrupt disconnect)', async () => {
  const child = spawn('node', [cliEntry, 'lsp'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const exitPromise = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));

  child.stdin.end();
  assert.equal(await exitPromise, 1);
});
