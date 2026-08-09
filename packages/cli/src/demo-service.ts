// M118 (`FU-04`, D198–D203) — the bundled demo service.
//
// `README.md` promised `tflw init` → `tflw run` was "green in seconds" and it never was: the
// scaffold pointed at `http://localhost:3001`, nothing listens there in a fresh directory, and the
// quickstart's headline outcome was `FAIL 0/1 passed`. This is the target that makes the sentence
// true — a real HTTP server, on localhost, started for the run and stopped after it.
//
// It is a **fixture, not a product surface** (D201). One endpoint, no configuration, no persistence:
// the moment a user wants a second one they should be pointing `api` at their own service, which is
// the whole point of the swap the scaffold's comment asks for.

import { createServer, type Server } from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import type { ResolvedConfig } from '@tflw/runtime';

/**
 * The reserved base URL a scaffolded `tflw.config` carries (D199).
 *
 * A real URL with a reserved scheme, deliberately: `api` still takes a string (`parser.ts`), and
 * `new URL('tflw://demo').hostname` still answers, so the config grammar, the checker and the LSP
 * are all untouched by this feature. It is also obviously not a real address — nobody ships
 * `tflw://demo` to staging by accident, which a `http://localhost:3001` default cannot claim.
 */
export const DEMO_BASE_URL = 'tflw://demo';

/** Anything under the reserved scheme — so a typo like `tflw://demoo` is caught by the runtime's
 * guard with a real sentence, rather than reaching `fetch` as an unsupported protocol. */
export const DEMO_SCHEME = 'tflw:';

export interface DemoService {
  /** The concrete `http://127.0.0.1:<port>` the run should actually talk to. */
  readonly baseUrl: string;
  /** Idempotent. Called from `runCommand`'s `finally`, so it runs on every exit path. */
  stop(): void;
}

/**
 * The service itself. `GET /health` → `200 {"status":"ok"}`, everything else a 404 that says what
 * this server is and what to do instead — a stranger who edits `example.tflw` to hit `/users` should
 * learn that from the response, not from a bare 404.
 */
export function createDemoServer(): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const json = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    };
    if (req.method === 'GET' && path === '/health') {
      json(200, { status: 'ok' });
      return;
    }
    json(404, {
      error: `no such endpoint: ${req.method ?? 'GET'} ${path}`,
      hint: "tflw's demo service answers GET /health and nothing else. Point `api` at your own service in tflw.config to test something real.",
    });
  });
}

/**
 * Child-process side of the demo (D200). Binds an **ephemeral** port on the loopback interface,
 * hands it back over the IPC channel, and stays up until that channel closes.
 *
 * The channel is the lifetime. If the parent is killed — `Ctrl-C`, a crash, `kill -9` — the IPC
 * channel closes and this process exits on its own, so a demo server can never outlive the run that
 * wanted it. Same reasoning the `--internal-load-worker` fork (M31/D19) is built on, and the same
 * reason the Fedora box lock is held by an SSH channel rather than a lock file with a timeout.
 */
export function demoServiceChild(): Promise<number> {
  return new Promise((resolvePromise) => {
    const server = createDemoServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      process.send?.({ type: 'demo:ready', port });
    });
    const shutdown = (): void => {
      server.close();
      resolvePromise(0);
    };
    process.on('disconnect', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}

/** How long the parent waits for the child to report its port before giving up. Generous: this is a
 * `server.listen` on loopback, so the only way to spend a second here is a machine already in
 * trouble, and a false timeout would turn a working quickstart into a mystery. */
const DEMO_START_TIMEOUT_MS = 10_000;

/**
 * Parent-process side: fork this same bundled script with the hidden `__demo-service` token and wait
 * for the port it chose.
 *
 * A **child process, not an in-process server** (D200), for a reason that has nothing to do with
 * taste: `--workers N` (D111/D113) forks N generator *processes*, and an in-process server lives in
 * none of them — the quickstart would work and `tflw run --workers 2` would fail to connect. It also
 * keeps a load run's generator and the service it is measuring off the same event loop.
 */
export function startDemoService(): Promise<DemoService> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child: ChildProcess = fork(process.argv[1]!, ['__demo-service'], {
      execArgv: process.execArgv,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let settled = false;
    const stop = (): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      rejectPromise(new Error(`the demo service did not start within ${DEMO_START_TIMEOUT_MS} ms`));
    }, DEMO_START_TIMEOUT_MS);
    timer.unref();
    child.on('message', (msg: unknown) => {
      const m = msg as { type?: string; port?: number };
      if (m?.type !== 'demo:ready' || settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ baseUrl: `http://127.0.0.1:${m.port}`, stop });
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(e);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`the demo service exited before it was ready (code ${code ?? 'null'})`));
    });
  });
}

/** Whether this run needs the demo at all — checked against the *default* `api` and every named
 * service, so `api demo "tflw://demo"` works the same way the bare form does. */
export function usesDemoService(resolved: ResolvedConfig): boolean {
  return resolved.apiBaseUrl === DEMO_BASE_URL || Object.values(resolved.services).includes(DEMO_BASE_URL);
}

/**
 * The same config with every `tflw://demo` replaced by the address the demo actually bound. Applied
 * before anything reads a base URL, so the runtime and the report see one concrete URL and neither
 * needs to know the demo exists.
 *
 * Takes the address rather than a `DemoService` because the **forked load workers need this too**,
 * and they have no handle on the server — `loadWorkerCommand` re-runs `loadAndValidate` itself
 * (M31/D19: no AST is ever serialized, only plain strings), so it reads `tflw://demo` straight off
 * disk and would otherwise fail every iteration in its shard. Measured before the fix: `tflw run
 * load.tflw --workers 2` came out at exactly 50% failures — one shard perfect, one shard dead.
 * The address travels in the start message; a worker must never start a *second* demo, or each
 * shard would be measuring a different server.
 */
export function withDemoBaseUrls(resolved: ResolvedConfig, baseUrl: string): ResolvedConfig {
  const services = Object.fromEntries(
    Object.entries(resolved.services).map(([name, url]) => [name, url === DEMO_BASE_URL ? baseUrl : url]),
  );
  return {
    ...resolved,
    ...(resolved.apiBaseUrl === DEMO_BASE_URL ? { apiBaseUrl: baseUrl } : {}),
    services,
  };
}
