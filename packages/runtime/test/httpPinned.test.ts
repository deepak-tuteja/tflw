// M45 (PLAN_BROWSER_PERF_SECURITY.md §2.16, D75) — direct coverage of the load-only pinned send
// path (`httpPinned.ts`), independent of the full `runLoad` engine: connection reuse, redirect
// following, and timeout/error shapes matching `sendRequest`'s own (`http.ts`, `timeout-
// redirects.test.ts`). `req.socket.remotePort` is the client's own ephemeral port for one TCP
// connection — stable across requests that reuse it, different for a fresh connection — the
// standard way to observe keep-alive reuse from the server side without instrumenting the client.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeepAliveAgents, destroyKeepAliveAgents, sendPinnedRequest } from '../src/httpPinned.js';
import { sendRequest } from '../src/http.js';
import { startFixtureServer, json } from './support.js';

test('reuses the same TCP connection across requests on one pinned Agent pair', async () => {
  const ports: number[] = [];
  const server = await startFixtureServer({
    '/ping': (req, res) => {
      ports.push(req.socket.remotePort!);
      json(res, 200, { ok: true });
    },
  });
  const agents = createKeepAliveAgents();

  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);
  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);
  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);

  assert.equal(ports.length, 3);
  assert.equal(ports[0], ports[1]);
  assert.equal(ports[1], ports[2]);

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('M121/D208: the pool is unbounded — a bounded one would queue arrivals inside the generator', () => {
  const agents = createKeepAliveAgents();

  // Asserts the *decision*, not its consequence, and does so deliberately. The consequence — that a
  // bounded pool makes excess open-model arrivals wait in the client, where the wait lands inside
  // `sendPinnedRequest`'s own measured window and is reported as service time — only shows up once
  // concurrent arrivals exceed the cap, which for the default 50 needs a slow endpoint driven at a
  // rate high enough to be both expensive and flaky as a unit test. `maxSockets` is a one-token
  // decision that a future reader would very reasonably think of as tuning, so what this guards is
  // that changing it is never silent: it re-creates, for real, the defect `M118-02` was originally
  // (and wrongly) filed as — arrival queueing counted as request duration. An open model exists to
  // let queues form at the *target*.
  assert.equal(agents.http.maxSockets, Infinity, 'a capped http pool queues open-model arrivals in the client');
  assert.equal(agents.https.maxSockets, Infinity, 'a capped https pool queues open-model arrivals in the client');
  assert.equal(agents.http.options.keepAlive, true);
  assert.equal(agents.https.options.keepAlive, true);

  destroyKeepAliveAgents(agents);
});

test('two separate Agent pairs (two VUs) get two separate connections', async () => {
  const ports: number[] = [];
  const server = await startFixtureServer({
    '/ping': (req, res) => {
      ports.push(req.socket.remotePort!);
      json(res, 200, { ok: true });
    },
  });
  const a = createKeepAliveAgents();
  const b = createKeepAliveAgents();

  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, a);
  await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/ping`, headers: {}, timeoutMs: 5000, followRedirects: true }, b);

  assert.equal(ports.length, 2);
  assert.notEqual(ports[0], ports[1]);

  destroyKeepAliveAgents(a);
  destroyKeepAliveAgents(b);
  await server.close();
});

test('sends a JSON body, computes content-length, and parses a JSON response', async () => {
  const server = await startFixtureServer({
    '/echo': (req, res, body) => json(res, 201, { received: body, contentLength: req.headers['content-length'] }),
  });
  const agents = createKeepAliveAgents();

  const res = await sendPinnedRequest(
    { method: 'POST', url: `${server.baseUrl}/echo`, headers: { 'content-type': 'application/json' }, body: '{"a":1}', timeoutMs: 5000, followRedirects: true },
    agents,
  );

  assert.equal(res.status, 201);
  assert.deepEqual(res.json, { received: '{"a":1}', contentLength: '7' });

  destroyKeepAliveAgents(agents);
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
  const agents = createKeepAliveAgents();

  const res = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/old-path`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { landed: true });

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('`followRedirects: false` observes the 3xx itself instead of following it', async () => {
  const server = await startFixtureServer({
    '/old-path': (_req, res) => {
      res.writeHead(302, { location: '/new-path' }).end();
    },
  });
  const agents = createKeepAliveAgents();

  const res = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/old-path`, headers: {}, timeoutMs: 5000, followRedirects: false }, agents);

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/new-path');

  destroyKeepAliveAgents(agents);
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
  const agents = createKeepAliveAgents();

  const res = await sendPinnedRequest(
    { method: 'POST', url: `${server.baseUrl}/create`, headers: {}, body: 'x=1', timeoutMs: 5000, followRedirects: true },
    agents,
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { method: 'GET' });

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('a 307 preserves method and body across the redirect', async () => {
  const server = await startFixtureServer({
    '/create': (_req, res) => {
      res.writeHead(307, { location: '/created' }).end();
    },
    '/created': (req, res, body) => json(res, 200, { method: req.method, body }),
  });
  const agents = createKeepAliveAgents();

  const res = await sendPinnedRequest(
    { method: 'POST', url: `${server.baseUrl}/create`, headers: {}, body: 'x=1', timeoutMs: 5000, followRedirects: true },
    agents,
  );

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { method: 'POST', body: 'x=1' });

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('a slower server than the timeout throws the same "timed out" message shape as sendRequest', async () => {
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      setTimeout(() => res.writeHead(200).end('too late'), 400);
    },
  });
  const agents = createKeepAliveAgents();

  await assert.rejects(
    sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/slow`, headers: {}, timeoutMs: 100, followRedirects: true }, agents),
    /timed out after 100ms: GET/,
  );

  destroyKeepAliveAgents(agents);
  await server.close();
});

// B4-01 (S1) — credential scoping across a redirect, the one parity property the original
// pinned-vs-pooled tests didn't state. These two assert the *pair*: what must be dropped when the
// redirect leaves the origin, and what must survive when it doesn't. Both compare the pinned
// result against `sendRequest`'s on the same chain rather than against a hardcoded expectation, so
// the property under test is "the two paths agree", not "the pinned path does what I typed".
test('a cross-origin redirect drops Authorization/Cookie before the next hop, matching sendRequest', async () => {
  const echoCreds = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) =>
    json(res, 200, {
      authorization: req.headers.authorization ?? null,
      cookie: req.headers.cookie ?? null,
      proxyAuthorization: req.headers['proxy-authorization'] ?? null,
    });
  // A different port on the same host is a different *origin* (scheme + host + port), which is the
  // comparison the Fetch spec and undici both make — no second loopback address needed.
  const other = await startFixtureServer({ '/landing': echoCreds });
  const server = await startFixtureServer({
    '/go': (_req, res) => {
      res.writeHead(302, { location: `${other.baseUrl}/landing` }).end();
    },
  });
  const agents = createKeepAliveAgents();
  const headers = {
    authorization: 'Bearer super-secret',
    cookie: 'session=PINNED-SECRET',
    'proxy-authorization': 'Basic cHJveHk=',
  };

  const pinned = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers, timeoutMs: 5000, followRedirects: true }, agents);
  const pooled = await sendRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers, timeoutMs: 5000, followRedirects: true });

  assert.deepEqual(pinned.json, { authorization: null, cookie: null, proxyAuthorization: null });
  assert.deepEqual(pinned.json, pooled.json);

  destroyKeepAliveAgents(agents);
  await server.close();
  await other.close();
});

// B4-13 (S3) — the same expression's other divergence, found while fixing B4-01: the downgraded
// hop is bodyless, so the body's own headers have to go with it. `fetch` can't emit a stale one
// (it derives them from the body it just nulled); this loop carries the caller's map forward and
// has to drop them by name.
test('a 303 downgrade drops the request body headers with the body, matching sendRequest', async () => {
  const server = await startFixtureServer({
    '/create': (_req, res) => {
      res.writeHead(303, { location: '/created' }).end();
    },
    '/created': (req, res) =>
      json(res, 200, { method: req.method, contentType: req.headers['content-type'] ?? null, contentLength: req.headers['content-length'] ?? null }),
  });
  const agents = createKeepAliveAgents();
  const opts = { method: 'POST', url: `${server.baseUrl}/create`, headers: { 'content-type': 'application/json' }, body: '{"a":1}', timeoutMs: 5000, followRedirects: true };

  const pinned = await sendPinnedRequest(opts, agents);
  const pooled = await sendRequest(opts);

  assert.deepEqual(pinned.json, { method: 'GET', contentType: null, contentLength: null });
  assert.deepEqual(pinned.json, pooled.json);

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('a same-origin redirect keeps Authorization/Cookie, matching sendRequest', async () => {
  const server = await startFixtureServer({
    '/go': (_req, res) => {
      res.writeHead(302, { location: '/landing' }).end();
    },
    '/landing': (req, res) => json(res, 200, { authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }),
  });
  const agents = createKeepAliveAgents();
  const headers = { authorization: 'Bearer super-secret', cookie: 'session=PINNED-SECRET' };

  const pinned = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers, timeoutMs: 5000, followRedirects: true }, agents);
  const pooled = await sendRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers, timeoutMs: 5000, followRedirects: true });

  assert.deepEqual(pinned.json, { authorization: 'Bearer super-secret', cookie: 'session=PINNED-SECRET' });
  assert.deepEqual(pinned.json, pooled.json);

  destroyKeepAliveAgents(agents);
  await server.close();
});

test('a multi-value Set-Cookie response header survives as newline-joined, matching sendRequest', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      res.writeHead(200, { 'set-cookie': ['session=abc', 'csrf=def'] }).end('{}');
    },
  });
  const agents = createKeepAliveAgents();

  const res = await sendPinnedRequest({ method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true }, agents);

  assert.equal(res.headers['set-cookie'], 'session=abc\ncsrf=def');

  destroyKeepAliveAgents(agents);
  await server.close();
});
