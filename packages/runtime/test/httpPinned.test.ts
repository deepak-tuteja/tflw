// M45 (PLAN_BROWSER_PERF_SECURITY.md §2.16, D75) — direct coverage of the load-only pinned send
// path (`httpPinned.ts`), independent of the full `runLoad` engine: connection reuse, redirect
// following, and timeout/error shapes matching `sendRequest`'s own (`http.ts`, `timeout-
// redirects.test.ts`). `req.socket.remotePort` is the client's own ephemeral port for one TCP
// connection — stable across requests that reuse it, different for a fresh connection — the
// standard way to observe keep-alive reuse from the server side without instrumenting the client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedAgents, destroyPinnedAgents, sendPinnedRequest } from '../src/httpPinned.js';
import { startFixtureServer, json } from './support.js';

test('reuses the same TCP connection across requests on one pinned Agent pair', async () => {
  const ports: number[] = [];
  const server = await startFixtureServer({
    '/ping': (req, res) => {
      ports.push(req.socket.remotePort!);
      json(res, 200, { ok: true });
    },
  });
  const agents = createPinnedAgents();

  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);
  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);
  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);

  assert.equal(ports.length, 3);
  assert.equal(ports[0], ports[1]);
  assert.equal(ports[1], ports[2]);

  destroyPinnedAgents(agents);
  await server.close();
});

test('two separate Agent pairs (two VUs) get two separate connections', async () => {
  const ports: number[] = [];
  const server = await startFixtureServer({
    '/ping': (req, res) => {
      ports.push(req.socket.remotePort!);
      json(res, 200, { ok: true });
    },
  });
  const a = createPinnedAgents();
  const b = createPinnedAgents();

  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, a);
  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, b);

  assert.equal(ports.length, 2);
  assert.notEqual(ports[0], ports[1]);

  destroyPinnedAgents(a);
  destroyPinnedAgents(b);
  await server.close();
});

test('sends a JSON body, computes content-length, and parses a JSON response', async () => {
  const server = await startFixtureServer({
    '/echo': (req, res, body) => json(res, 201, { received: body, contentLength: req.headers['content-length'] }),
  });
  const agents = createPinnedAgents();

  const res = await sendPinnedRequest(
    { method: 'POST', url: `${server.baseUrl}/echo`, headers: { 'content-type': 'application/json' }, body: '{"a":1}', timeoutMs: 5000, followRedirects: true },
    agents,
  );

  assert.equal(res.status, 201);
  assert.deepEqual(res.json, { received: '{"a":1}', contentLength: '7' });

  destroyPinnedAgents(agents);
  await server.close();
});

test('redirects are followed by default, sharing one measured duration across hops', async () => {
  const server = await startFixtureServer({
    '/old-path': (_req, res) => {
      res.writeHead(302, { location: '/new-path' }).end();
    },
    '/new-path': (_req, res) => {
      json(res, 200, { landed: true });
    },
  });
  const agents = createPinnedAgents();

  const res = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/old-path`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { landed: true });

  destroyPinnedAgents(agents);
  await server.close();
});

test('`followRedirects: false` observes the 3xx itself instead of following it', async () => {
  const server = await startFixtureServer({
    '/old-path': (_req, res) => {
      res.writeHead(302, { location: '/new-path' }).end();
    },
  });
  const agents = createPinnedAgents();

  const res = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/old-path`, headers: {}, timeoutMs: 5000, followRedirects: false }, agents);

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/new-path');

  destroyPinnedAgents(agents);
  await server.close();
});

test('a 302 downgrades a POST to a bodyless GET on the redirected hop (matches `fetch`)', async () => {
  const server = await startFixtureServer({
    '/create': (req, res) => {
      res.writeHead(302, { location: '/created' }).end();
    },
    '/created': (req, res) => {
      json(res, 200, { method: req.method });
    },
  });
  const agents = createPinnedAgents();

  const res = await sendPinnedRequest(
    { method: 'POST', url: `${server.baseUrl}/create`, headers: {}, body: 'x=1', timeoutMs: 5000, followRedirects: true },
    agents,
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { method: 'GET' });

  destroyPinnedAgents(agents);
  await server.close();
});

test('a 307 preserves method and body across the redirect', async () => {
  const server = await startFixtureServer({
    '/create': (_req, res) => {
      res.writeHead(307, { location: '/created' }).end();
    },
    '/created': (req, res, body) => json(res, 200, { method: req.method, body }),
  });
  const agents = createPinnedAgents();

  const res = await sendPinnedRequest(
    { method: 'POST', url: `${server.baseUrl}/create`, headers: {}, body: 'x=1', timeoutMs: 5000, followRedirects: true },
    agents,
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { method: 'POST', body: 'x=1' });

  destroyPinnedAgents(agents);
  await server.close();
});

test('a slower server than the timeout throws the same "timed out" message shape as sendRequest', async () => {
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      setTimeout(() => res.writeHead(200).end('too late'), 400);
    },
  });
  const agents = createPinnedAgents();

  await assert.rejects(
    sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/slow`, headers: {}, timeoutMs: 100, followRedirects: true }, agents),
    /timed out after 100ms: GET/,
  );

  destroyPinnedAgents(agents);
  await server.close();
});

test('a multi-value Set-Cookie response header survives as newline-joined, matching sendRequest', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      res.writeHead(200, { 'set-cookie': ['session=abc', 'csrf=def'] }).end('{}');
    },
  });
  const agents = createPinnedAgents();

  const res = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);

  assert.equal(res.headers['set-cookie'], 'session=abc\ncsrf=def');

  destroyPinnedAgents(agents);
  await server.close();
});
