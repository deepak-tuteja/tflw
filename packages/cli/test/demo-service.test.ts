// M118 (`FU-04`) — the bundled demo service's own behaviour, tested without a CLI in the way.
// The end-to-end claim ("`tflw init` then `tflw run` is green") lives in `e2e.test.ts`; this file
// is about what the server itself answers, and about the substitution that keeps the reserved URL
// out of everything downstream.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createDemoServer, DEMO_BASE_URL, usesDemoService, withDemoBaseUrls } from '../src/demo-service.js';
import type { ResolvedConfig } from '@tflw/runtime';

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = createDemoServer();
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
  const { port } = server.address() as { port: number };
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

/** Only the three fields any of this reads; the rest of `ResolvedConfig` is irrelevant here. */
function config(over: Partial<ResolvedConfig>): ResolvedConfig {
  return { envName: 'local', apiBaseUrl: null, services: {}, ...over } as ResolvedConfig;
}

test('the demo service answers the one endpoint the scaffold tests', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});

test('anything else 404s with a sentence that says what this server is (D201)', async () => {
  // A stranger's first edit to `example.tflw` is to point it at an endpoint they care about. The
  // 404 they get back is the only place that can explain why it does not exist — a bare status code
  // reads as "tflw is broken", not as "you are still talking to the demo".
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/users`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string; hint: string };
    assert.match(body.error, /no such endpoint: GET \/users/);
    assert.match(body.hint, /GET \/health and nothing else/);
    assert.match(body.hint, /tflw\.config/, 'the hint has to name the file the reader must edit');
  });
});

test('a query string does not turn /health into an unknown endpoint', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/health?verbose=1`)).status, 200);
  });
});

test('a write to the one readable endpoint is still a 404, not a 200', async () => {
  // The method is part of the identity: `POST /health` succeeding would teach a first-time reader
  // that tflw's demo accepts writes, and their next test would be written against a fiction.
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
    assert.equal(res.status, 404);
    assert.match(((await res.json()) as { error: string }).error, /POST \/health/);
  });
});

test('usesDemoService sees the reserved URL as a default api and as a named service', () => {
  assert.equal(usesDemoService(config({ apiBaseUrl: DEMO_BASE_URL })), true);
  assert.equal(usesDemoService(config({ services: { billing: DEMO_BASE_URL } })), true);
  assert.equal(usesDemoService(config({ apiBaseUrl: 'http://localhost:3001' })), false);
  assert.equal(usesDemoService(config({})), false);
});

test('substitution replaces every reserved URL and leaves real ones alone', () => {
  const substituted = withDemoBaseUrls(
    config({ apiBaseUrl: DEMO_BASE_URL, services: { demo: DEMO_BASE_URL, real: 'https://api.example.com' } }),
    'http://127.0.0.1:54321',
  );
  assert.equal(substituted.apiBaseUrl, 'http://127.0.0.1:54321');
  assert.equal(substituted.services.demo, 'http://127.0.0.1:54321');
  // The point of the check: a run that mixes the demo with a real service must not have the real
  // one rewritten out from under it.
  assert.equal(substituted.services.real, 'https://api.example.com');
});
