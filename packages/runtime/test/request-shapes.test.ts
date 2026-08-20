// Backfill: three request shapes that parse (and are spec'd) but were never runtime-exercised —
// query strings on the path, PATCH end-to-end, and a user header winning over the default
// content-type. Found via /grill-me, 2026-07-05.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a query string on the path reaches the server verbatim', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "query string"
  api GET /orders?state=open&limit=5
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  assert.ok(server.received.has('/orders?state=open&limit=5'));
  assert.equal(server.received.get('/orders?state=open&limit=5')!.length, 1);

  await server.close();
});

test('PATCH sends a partial-update body and is asserted like any other verb', async () => {
  const server = await startFixtureServer({
    '/orders/42': (_req, res) => json(res, 200, { id: 42, status: 'shipped' }),
  });

  const source = `test "patch"
  api PATCH /orders/42 body { status: "shipped" }
  expect status equals 200
  expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const received = server.received.get('/orders/42')![0]!;
  assert.equal(received.headers['content-type'], 'application/json');
  assert.equal(received.body, '{"status":"shipped"}');

  await server.close();
});

test('a user-supplied Content-Type header wins over the inline-body default', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 201, { ok: true }),
  });

  const source = `test "content-type override"
  api POST /orders body { name: "Widget" }
    header "Content-Type" is "application/vnd.api+json"
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const received = server.received.get('/orders')![0]!;
  assert.equal(received.headers['content-type'], 'application/vnd.api+json');
  assert.equal(received.body, '{"name":"Widget"}');

  await server.close();
});

test('a header override is case-insensitive: it replaces, not duplicates, a differently-cased header (P#46)', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 201, { ok: true }),
  });
  const parsedConfig = parseConfigSource(`env test default\n  api "${server.baseUrl}"\n  header "Content-Type" is "application/json"\n`);
  assert.deepEqual(parsedConfig.diagnostics, []);
  const configWithDefault = resolveConfig(parsedConfig.config, selectEnv(parsedConfig.config, {}));

  const source = `test "override with different casing"
  api POST /orders body { name: "Widget" }
    header "content-type" is "application/vnd.api+json"
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, configWithDefault, { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  const headerKeys = Object.keys(apiStep.request!.headers).filter((k) => k.toLowerCase() === 'content-type');
  assert.equal(headerKeys.length, 1, `expected exactly one content-type header entry, got: ${JSON.stringify(apiStep.request!.headers)}`);
  assert.equal(apiStep.request!.headers[headerKeys[0]!], 'application/vnd.api+json');

  await server.close();
});

// `body text` response subject (PLAN decision 51) — was documented ✅ and pointed to by two
// runtime error messages ("use `body text` for non-JSON"), but had no parser/AST/interpreter
// support at all before this fix; asserting on a non-JSON response was impossible.
test('`expect body text` and `check body text` assert on a non-JSON response', async () => {
  const server = await startFixtureServer({
    '/health.txt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('service is healthy');
    },
  });

  const source = `test "asserts on a plain-text response"
  api GET /health.txt
  expect body text equals "service is healthy"
  check body text contains "healthy"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`capture body text as x` binds the raw response text for later use', async () => {
  const server = await startFixtureServer({
    '/health.txt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('service is healthy');
    },
    '/echo': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "captures body text and reuses it"
  api GET /health.txt
  capture body text as raw
  api POST /echo body { note: "{raw}" }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const received = server.received.get('/echo')![0]!;
  assert.equal(received.body, '{"note":"service is healthy"}');

  await server.close();
});

test('a `body.<path>` expect on a non-JSON response still fails fast with the `body text` hint', async () => {
  const server = await startFixtureServer({
    '/health.txt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('service is healthy');
    },
  });

  const source = `test "wrong subject for a non-JSON body"
  api GET /health.txt
  expect body.status equals "ok"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /use `body text` for non-JSON/);

  await server.close();
});

test('a response with two `Set-Cookie` headers keeps both — the last no longer silently wins (decision 61)', async () => {
  const server = await startFixtureServer({
    '/login': (_req, res) => {
      res.setHeader('Set-Cookie', ['session=abc123; Path=/', 'csrf=xyz789; Path=/']);
      json(res, 200, { ok: true });
    },
  });

  const source = `test "captures every Set-Cookie value"
  api GET /login
  capture header "set-cookie" as cookies
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const captureStep = report.tests[0]!.steps.find((s) => s.kind === 'capture')!;
  assert.match(captureStep.detail ?? '', /session=abc123/);
  assert.match(captureStep.detail ?? '', /csrf=xyz789/);

  await server.close();
});

test('a captured value containing URL-special characters is percent-encoded in the path (decision 62)', async () => {
  const raw = 'a&b#c d';
  const encoded = encodeURIComponent(raw);
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { name: raw }),
    [`/search/${encoded}`]: (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "percent-encodes an interpolated path segment"
  api GET /orders
  capture body.name as name
  api GET /search/{name}
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  assert.ok(server.received.has(`/search/${encoded}`), `expected the encoded path among: ${[...server.received.keys()]}`);
  assert.equal(server.received.get(`/search/${encoded}`)!.length, 1);
  // literal, unencoded special characters must never reach the wire.
  assert.ok(![...server.received.keys()].some((k) => k.includes(raw)));

  await server.close();
});

// M147d (`A3-12`, D639) — the array body end to end, and the consequence the row never named.
//
// The row was written as an ergonomics complaint: a shape that parses everywhere else is refused
// here. Running the workaround is what makes it more than that. Before D639 the only way to send a
// top-level JSON array was `body text "[1,2]"`, and `prepareBody`'s `TextBody` arm sets no
// `contentType` — by design, since a raw payload is not necessarily JSON.
//
// **Measured, because the prediction was wrong.** The expectation written first was that the
// request would arrive with no `Content-Type` at all; it arrives with
// `text/plain;charset=UTF-8`, which `undici` supplies for a string `BodyInit` when the caller
// names nothing. That is worse than absent: a JSON API that dispatches on the header answers a
// `body text` array with a 415, so the pre-D639 workaround did not merely lose a header, it sent a
// request the server was entitled to refuse — while `check` and the report both said the file was
// fine.
//
// Both halves are asserted here. The text form's `text/plain` is a negative control, not a defect
// to fix: `body text` promises to set no JSON content-type (SPEC §5.2) and it keeps that promise.
test('an inline top-level array body is sent as JSON, with the JSON content-type', async () => {
  const server = await startFixtureServer({
    '/orders/bulk': (_req, res) => json(res, 201, { accepted: 2 }),
  });

  const source = `test "bulk create"
  api POST /orders/bulk body [{ name: "Widget" }, { name: "Sprocket" }]
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const received = server.received.get('/orders/bulk')![0]!;
  assert.equal(received.headers['content-type'], 'application/json');
  assert.equal(received.body, '[{"name":"Widget"},{"name":"Sprocket"}]');

  await server.close();
});

// NEGATIVE — the pre-D639 workaround, kept as a measurement rather than a memory. If this ever
// starts sending `application/json`, `body text` has stopped being the raw-payload form.
test('`body text` with the same array is sent as text/plain — the workaround D639 replaces', async () => {
  const server = await startFixtureServer({
    '/orders/bulk': (_req, res) => json(res, 201, { accepted: 2 }),
  });

  const source = `test "bulk create, the old way"
  api POST /orders/bulk body text "[{\\"name\\":\\"Widget\\"}]"
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const received = server.received.get('/orders/bulk')![0]!;
  assert.equal(received.headers['content-type'], 'text/plain;charset=UTF-8');
  assert.equal(received.body, '[{"name":"Widget"}]');

  await server.close();
});

// The generators and `{var}` interpolations that make an inline body worth having reach an array
// element exactly as they reach an object field — `evalValue` was always the shared path, and D639
// only stopped the caller from pre-flattening it into fields.
test('an array body evaluates its elements, not just its literals', async () => {
  const server = await startFixtureServer({
    '/tags': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "array of interpolations"
  let a = "alpha"
  api POST /tags body ["{a}", "beta"]
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  assert.equal(server.received.get('/tags')![0]!.body, '["alpha","beta"]');

  await server.close();
});
