// Test-only HTTP fixture server + config builder, shared by the M2 runtime interpreter tests.
// No mocking of fetch — tests hit a real loopback server so body-encoding, redirects, and
// timeouts are exercised exactly as they run against a real API (dogfood-style, just local).

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { after } from 'node:test';
import { DEFAULT_TIMEOUTS, type ResolvedConfig, type ResolvedTimeouts } from '../src/types.js';

// M108 (review row `M107-03`) — every fixture server started but never closed, with the stack that started it.
//
// A listening server is a ref'd handle: the file's test process cannot exit while one is open, and
// `node --test` waits on that child forever. That is exactly what `--test-force-exit` was papering
// over here — four tests across `load.test.ts` and `unified-dispatch.test.ts` had simply forgotten
// their `await server.close()`, and the flag hid it by killing the process mid-report (M107b: the
// same kill silently dropped whichever tests were still reporting).
//
// A WATCHDOG, NOT AN `after` ASSERTION — two wrong shapes were tried first, and why they're wrong
// is the whole design:
//   · Asserting inside a root `after` registered at import time runs *ahead* of the
//     `after(() => server.close())` that `allow-hosts-browser.test.ts`, `browser-steps.test.ts`
//     and `mtls.test.ts` legitimately clean up in (root hooks run in registration order, and this
//     module is imported at the top of the file). It failed 77 passing tests for a leak they
//     don't have.
//   · Registering the same hook lazily, on the first `startFixtureServer()`, is worse: `after()`
//     called while the root test is already running binds to the *current* context, so it fired
//     once per test instead of once per file.
// The timer below has no ordering to get wrong. It is `unref`'d, so in a file that cleans up it
// never fires and costs nothing; a file that leaks *is* still alive when it expires, which is
// exactly the condition worth reporting. It also catches every kind of leaked handle, not just a
// server — `mtls.test.ts` was holding a forked child process, which no server-only check sees.
const openFixtureServers = new Map<Server, string>();
// Generous on purpose. The timer is armed by the *first* root `after` hook, so a file whose own
// teardown is genuinely slow (`browser-steps.test.ts` closes a real Chromium) is still inside its
// hooks when it starts counting — and a false "you leaked" on a loaded 2-core CI runner would be
// the same class of defect this milestone is closing. A healthy run pays nothing for the margin,
// because the timer is `unref`'d and never fires; only a run that is already hung pays it.
const LEAK_WATCHDOG_MS = 30_000;
after(() => {
  const watchdog = setTimeout(() => {
    const sites = [...openFixtureServers.values()];
    process.stderr.write(
      `\n✗ this test file's process was still alive ${LEAK_WATCHDOG_MS / 1000}s after its tests finished — something it started is still open.\n` +
        `  active handles: ${JSON.stringify(process.getActiveResourcesInfo())}\n` +
        (sites.length > 0
          ? `  ${sites.length} fixture server(s) never closed — add the missing \`await server.close()\`:\n` + sites.map((s) => `      ${s}\n`).join('')
          : `  no fixture server is open, so it is something else the file started: a forked child (see \`shutdownMtlsWorker\`), a browser, a socket, a repeating timer.\n`) +
        `  See test/support.ts — this is the guard M108 put in place of \`--test-force-exit\`.\n`,
    );
    process.exit(1);
  }, LEAK_WATCHDOG_MS);
  watchdog.unref();
});

export interface FixtureServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
  /** Raw bodies received per path, latin1-decoded (binary-safe for the small ASCII fixtures used in tests). */
  readonly received: Map<string, { headers: IncomingMessage['headers']; body: string }[]>;
}

export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export async function startFixtureServer(routes: Record<string, Handler>): Promise<FixtureServer> {
  const received: FixtureServer['received'] = new Map();
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const path = req.url ?? '/';
      const list = received.get(path) ?? [];
      list.push({ headers: req.headers, body });
      received.set(path, list);
      const key = Object.keys(routes).find((r) => path === r || path.startsWith(r + '?'));
      const handler = key ? routes[key] : undefined;
      if (!handler) {
        res.writeHead(404).end('not found');
        return;
      }
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  // The caller's own frame, for the `after` hook above to point at if this one is never closed.
  const startedAt = (new Error().stack ?? '').split('\n').find((line) => line.includes('.test.ts'))?.trim() ?? '(no test frame in the stack)';
  openFixtureServers.set(server, startedAt);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    // `fetch`'s keep-alive sockets would otherwise keep the server (and the test process) alive
    // indefinitely — force-drop connections so `close()` resolves promptly.
    close: () =>
      new Promise<void>((resolve, reject) => {
        openFixtureServers.delete(server);
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    received,
  };
}

export function testConfig(baseUrl: string, timeouts: Partial<ResolvedTimeouts> = {}, insecure = false): ResolvedConfig {
  return {
    envName: 'test',
    apiBaseUrl: baseUrl,
    services: {},
    webBaseUrl: null,
    headers: [],
    timeouts: { ...DEFAULT_TIMEOUTS, ...timeouts },
    reportDir: './report',
    workers: 1,
    insecure,
    requiredEnv: [],
    exclude: [],
    sessions: new Map(),
    mtls: null,
    allowHosts: null,
    // M128b — the runtime never reads this (D291 is enforced by the checker, and the CLI is what
    // prints it); it is here so a fixture config is a complete `ResolvedConfig` rather than one that
    // happens to compile.
    authorizedTargets: [],
    evidenceLevel: 'full',
    redactPatterns: [],
    viewport: null,
    logDestination: 'both',
    logLevel: 'debug',
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' }).end(text);
}
