// Test-only HTTP fixture server + config builder, shared by the M2 runtime interpreter tests.
// No mocking of fetch — tests hit a real loopback server so body-encoding, redirects, and
// timeouts are exercised exactly as they run against a real API (dogfood-style, just local).

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { DEFAULT_TIMEOUTS, type ResolvedConfig, type ResolvedTimeouts } from '../src/types.js';

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
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    // `fetch`'s keep-alive sockets would otherwise keep the server (and the test process) alive
    // indefinitely — force-drop connections so `close()` resolves promptly.
    close: () =>
      new Promise<void>((resolve, reject) => {
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
    sessions: new Map(),
    mtls: null,
    allowHosts: null,
    evidenceLevel: 'full',
    redactPatterns: [],
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' }).end(text);
}
