// `tflw lsp` (PLAN_M13_LSP.md Phase 4): the CLI's own black-box smoke test for the subcommand that
// wires `@tflw/lsp-server`'s `startServer()` to real stdio. Deliberately hand-rolls the
// Content-Length framing instead of pulling in a JSON-RPC client library (unlike
// packages/lsp-server/test/protocol.test.ts's in-memory `vscode-jsonrpc` harness) — the point here
// is proving the *built* `dist/cli.cjs lsp` speaks the wire protocol correctly as a real spawned
// subprocess, the same "run the actual distributable" gap e2e.test.ts already backfills for `run`.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
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

// A spawned `tflw lsp` that answers nothing is the failure this file has to stay legible under,
// so both of its causes get their own accounting below. This bounds the silent-but-alive one.
const READ_DEADLINE_MS = 30_000;

interface ChildState {
  /** Bytes off stdout not yet consumed by a completed frame. Kept per child rather than per call:
   * two messages can land in a single `data` chunk, and a reader that dropped the remainder would
   * discard a response the *next* reader is still waiting for — turning a lost message into a
   * timeout blamed on the server. */
  buf: Buffer;
  /** stderr as it arrives, so a failure below has something to show. A stream stays paused until
   * its first listener attaches, so collecting from here rather than at spawn loses nothing. */
  stderr: string[];
}

const childState = new WeakMap<ChildProcess, ChildState>();

function stateOf(child: ChildProcess): ChildState {
  const existing = childState.get(child);
  if (existing) return existing;
  const fresh: ChildState = { buf: Buffer.alloc(0), stderr: [] };
  childState.set(child, fresh);
  child.stderr?.on('data', (chunk: Buffer) => fresh.stderr.push(chunk.toString('utf8')));
  return fresh;
}

/** Reads exactly one Content-Length-framed JSON-RPC message off the child's `stdout`, buffering
 * across however many `data` chunks it takes to see the full header + body.
 *
 * Bounded, and racing the child's own death — which it was not, and that was a defect in the
 * instrument rather than in `tflw lsp`. What this reader waits on is a *subprocess*, and the two
 * ways that goes wrong both end the same way, with nothing further arriving on the stream: the
 * binary dies before it answers (a throw inside `startServer()`, a stale or missing `dist/`, a bad
 * `require`), or it stays up and answers nothing. A `data`+`error` pair sees neither — a child
 * exiting closes the pipe, and a closed pipe is `end`/`close`, never `error` — so the `await`
 * blocked forever at zero CPU with the two causes indistinguishable from each other and from a
 * healthy run on a slow box.
 *
 * That is pick.test.ts:169's defect in a second file, and it carries the same cost: this suite
 * runs on fedora-box under the whole-box lock, where an unbounded wait holds the machine until
 * something outside kills it and then reports the kill rather than the cause. So each branch below
 * names its own, and every one of them reports what actually arrived — "nothing at all" and "a
 * partial frame" are different bugs, and only the second implicates the framing. */
function readOneMessage(child: ChildProcess, what: string): Promise<Record<string, unknown>> {
  const state = stateOf(child);
  const stdout = child.stdout;
  return new Promise((resolve, reject) => {
    if (!stdout) {
      reject(new Error(`readOneMessage(${what}): this child was spawned without a piped stdout`));
      return;
    }
    const arrived = (): string =>
      state.buf.length === 0
        ? 'nothing arrived on stdout'
        : `${state.buf.length} byte(s) arrived but never completed a frame: ${JSON.stringify(state.buf.toString('utf8').slice(0, 400))}`;
    const fail = (why: string): void => {
      cleanup();
      reject(new Error(`${why}\n${arrived()}\nstderr:\n${state.stderr.join('') || '(none, or not piped)'}`));
    };
    /** Tries to take one whole message off the front of `state.buf`. Returns true once it has
     * settled the promise, either way. */
    const consume = (): boolean => {
      const headerEnd = state.buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return false;
      const header = state.buf.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length: (\d+)/.exec(header);
      if (!match) {
        cleanup();
        reject(new Error(`malformed LSP header while reading ${what}: ${header}`));
        return true;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (state.buf.length < bodyStart + length) return false;
      const body = state.buf.subarray(bodyStart, bodyStart + length).toString('utf8');
      state.buf = state.buf.subarray(bodyStart + length);
      cleanup();
      resolve(JSON.parse(body) as Record<string, unknown>);
      return true;
    };
    const onData = (chunk: Buffer): void => {
      state.buf = Buffer.concat([state.buf, chunk]);
      consume();
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onClose = (): void => fail(`\`tflw lsp\` closed stdout before answering ${what}.`);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      fail(`\`tflw lsp\` exited (code ${code}, signal ${signal}) before answering ${what}.`);
    const timer = setTimeout(
      () => fail(`\`tflw lsp\` did not answer ${what} within ${READ_DEADLINE_MS / 1000}s, and is still running.`),
      READ_DEADLINE_MS,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      stdout.off('data', onData);
      stdout.off('error', onError);
      stdout.off('close', onClose);
      child.off('exit', onExit);
    };
    stdout.on('data', onData);
    stdout.on('error', onError);
    stdout.on('close', onClose);
    child.on('exit', onExit);
    // A previous read may already have left this whole message in the buffer, in which case no
    // further `data` event is coming and waiting for one is the original hang all over again.
    consume();
  });
}

test('`tflw lsp` speaks LSP over stdio: a raw Content-Length-framed `initialize` request gets a well-formed response advertising capabilities', async () => {
  const child: ChildProcessWithoutNullStreams = spawn('node', [cliEntry, 'lsp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const responsePromise = readOneMessage(child, 'the initialize request');
    child.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }));

    const response = await responsePromise;
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);
    const capabilities = (response.result as { capabilities: Record<string, unknown> }).capabilities;
    assert.equal(capabilities.hoverProvider, true);
    assert.equal(capabilities.definitionProvider, true);
    // M122/D219 — `{ prepareProvider: true }`, not a bare `true`. Asserted here as well as in
    // `lsp-server`'s own protocol tests because this is the only test that reaches the capability
    // through the real `tflw lsp` subprocess over real stdio, which is how an editor sees it.
    assert.deepEqual(capabilities.renameProvider, { prepareProvider: true });
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

  const initResponse = readOneMessage(child, 'the initialize request');
  child.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }));
  await initResponse;
  child.stdin.write(frame({ jsonrpc: '2.0', method: 'initialized', params: {} }));

  const shutdownResponse = readOneMessage(child, 'the shutdown request');
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
