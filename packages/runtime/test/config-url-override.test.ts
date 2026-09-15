// `M197` (D1024): the `env NAME default "…"` override is resolved once at config load, from the
// environment `resolveConfig` is handed — the variable when set and non-empty, the literal
// otherwise — and it is NOT a secret. The last claim is the one that decides the construct's
// shape: `env()` registers what it reads with the redactor, and a base URL masked to `•••(NAME)`
// in every request line would make the report unreadable. So a run under the override must
// show the URL in its evidence, verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { parseConfigSource, parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { ConfigError, resolveConfig } from '../src/resolve.js';

const CONFIG = `env local default
  api env TFLW_API_BASE default "http://localhost:4001/v1"
  api inventory env TFLW_INVENTORY_BASE default "http://localhost:4002/v1"
  web env TFLW_WEB_BASE default "http://localhost:8090"
  allow hosts "localhost", "127.0.0.1"
  authorized target env TFLW_API_ORIGIN default "http://localhost:4001" reason "self-hosted"
`;

function resolve(environ: NodeJS.ProcessEnv) {
  const { config, diagnostics } = parseConfigSource(CONFIG);
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), []);
  return resolveConfig(config!, config!.envs[0]!, environ);
}

test('M197 — unset: every URL is its literal', () => {
  const r = resolve({});
  assert.equal(r.apiBaseUrl, 'http://localhost:4001/v1');
  assert.equal(r.services['inventory'], 'http://localhost:4002/v1');
  assert.equal(r.webBaseUrl, 'http://localhost:8090');
  assert.equal(r.authorizedTargets[0]!.target, 'http://localhost:4001');
});

test('M197 — set: the variable replaces the literal, per URL', () => {
  const r = resolve({ TFLW_API_BASE: 'http://localhost:4101/v1', TFLW_API_ORIGIN: 'http://localhost:4101', TFLW_WEB_BASE: 'http://localhost:8190/' });
  assert.equal(r.apiBaseUrl, 'http://localhost:4101/v1');
  assert.equal(r.services['inventory'], 'http://localhost:4002/v1', 'a variable that is not set leaves its URL alone');
  assert.equal(r.webBaseUrl, 'http://localhost:8190', 'the override is trimmed like the literal');
  assert.equal(r.authorizedTargets[0]!.target, 'http://localhost:4101');
});

test('M197 — empty is unset', () => {
  assert.equal(resolve({ TFLW_API_BASE: '' }).apiBaseUrl, 'http://localhost:4001/v1');
});

test('M197 — an override that is not an absolute URL is a ConfigError naming the variable', () => {
  assert.throws(() => resolve({ TFLW_WEB_BASE: 'localhost:8190' }), (e: unknown) => e instanceof ConfigError && /TFLW_WEB_BASE/.test(e.message) && /absolute URL/.test(e.message));
});

test('M197 — the override is not a secret: a run under it shows the URL in its evidence', async () => {
  const server: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const base = `http://127.0.0.1:${port}`;
    const cfg = resolve({ TFLW_API_BASE: base });
    const source = 'test "ping"\n  api GET /ping\n  expect status equals 200\n';
    const { program, diagnostics } = parseSource(source);
    assert.deepEqual(diagnostics, []);
    const { report } = await runProgram(program, cfg, { source, environ: { TFLW_API_BASE: base } });
    const t = report.tests[0]!;
    assert.equal(t.kind, 'functional');
    const step = t.kind === 'functional' ? t.steps.find((s) => s.request) : undefined;
    assert.ok(step?.request, 'the api step carries its request');
    assert.equal(step!.request!.url, `${base}/ping`, 'the URL the override supplied, verbatim — not `•••(TFLW_API_BASE)/ping`');
    assert.equal(JSON.stringify(report).includes('•••'), false, 'nothing in the report is redacted');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
