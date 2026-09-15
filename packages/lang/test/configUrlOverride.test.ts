// `M197` (D1024): a config URL may name a non-secret environment override with the literal as its
// default — `api [service] env NAME default "…"`, `web env NAME default "…"`, `authorized target
// env NAME default "…" reason "…"`. This file holds the grammar; the resolution and the
// not-a-secret claim are the runtime's (`config-url-override.test.ts`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkServices, parseConfigSource, parseSource } from '../src/index.js';
import type { ApiServiceDecl, AuthorizedTargetDecl, WebDecl } from '../src/ast.js';

const wrap = (lines: string) => `env local default\n${lines}`;

function entries(lines: string) {
  const { config, diagnostics } = parseConfigSource(wrap(lines));
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), [], lines);
  return config!.envs[0]!.entries;
}

test('M197 — `api env NAME default "…"` carries the name and the literal', () => {
  const [e] = entries('  api env TFLW_API_BASE default "http://localhost:4001/v1"\n') as [ApiServiceDecl];
  assert.equal(e.type, 'ApiServiceDecl');
  assert.equal(e.service, null);
  assert.equal(e.urlFrom, 'TFLW_API_BASE');
  assert.equal(e.url.value, 'http://localhost:4001/v1');
});

test('M197 — a named service takes the override after its name', () => {
  const [e] = entries('  api inventory env TFLW_INVENTORY_BASE default "http://localhost:4002/v1"\n') as [ApiServiceDecl];
  assert.equal(e.service, 'inventory');
  assert.equal(e.urlFrom, 'TFLW_INVENTORY_BASE');
  assert.equal(e.url.value, 'http://localhost:4002/v1');
});

test('M197 — `web` and `authorized target` take the same override', () => {
  const [w, a] = entries(
    '  web env TFLW_WEB_BASE default "http://localhost:8090"\n' +
      '  authorized target env TFLW_API_ORIGIN default "http://localhost:4001" reason "self-hosted"\n',
  ) as [WebDecl, AuthorizedTargetDecl];
  assert.equal(w.urlFrom, 'TFLW_WEB_BASE');
  assert.equal(w.url.value, 'http://localhost:8090');
  assert.equal(a.targetFrom, 'TFLW_API_ORIGIN');
  assert.equal(a.target.value, 'http://localhost:4001');
  assert.equal(a.reason.value, 'self-hosted');
});

test('M197 — CONTROL: the literal-only form is unchanged and carries no override', () => {
  const [e, w] = entries('  api "http://localhost:4001/v1"\n  web "http://localhost:8090"\n') as [ApiServiceDecl, WebDecl];
  assert.equal('urlFrom' in e, false);
  assert.equal('urlFrom' in w, false);
});

test('M197 — CONTROL: a service literally named `env` is still a service', () => {
  // The override is recognised by its three-token shape (`env IDENT default`), not by the word.
  const [e] = entries('  api env "http://localhost:4009/v1"\n') as [ApiServiceDecl];
  assert.equal(e.service, 'env');
  assert.equal('urlFrom' in e, false);
});

test('M197 — the override without its literal is a parse error naming what is expected', () => {
  const { diagnostics } = parseConfigSource(wrap('  api env TFLW_API_BASE default\n'));
  assert.ok(diagnostics.length >= 1, 'a missing default must not parse');
  assert.match(diagnostics[0]!.message, /base URL string/);
});

// D1030 — the document-source qualifier, in the same file because the same milestone put it in
// for the same reason: the port literal it removes from the suite.

test('M197 — `matches schema … from <service> "…"` and `seed openapi <service> "…"` carry the service', () => {
  const { program, diagnostics } = parseSource('test "t"\n  api root GET /w\n  expect body matches schema "W" from root "/openapi.json"\n');
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[1]!;
  assert.equal(step.type, 'ExpectStmt');
  if (step.type === 'ExpectStmt') {
    assert.equal(step.matcher.schemaService, 'root');
    assert.equal(step.matcher.schemaSource!.value, '/openapi.json');
  }
  const crawl = parseSource('crawl "surface"\n  seed openapi root "/openapi.json"\n');
  assert.deepEqual(crawl.diagnostics, []);
  const seed = crawl.program.crawls![0]!.seeds[0]!;
  assert.equal(seed.type, 'OpenApiSeed');
  if (seed.type === 'OpenApiSeed') assert.equal(seed.service, 'root');
});

test('M197 — CONTROL: the unqualified source is unchanged and names no service', () => {
  const { program } = parseSource('test "t"\n  api GET /w\n  expect body matches schema "W" from "/openapi.json"\n');
  const step = program.tests[0]!.body[1]!;
  if (step.type === 'ExpectStmt') assert.equal('schemaService' in step.matcher, false);
});

test('M197 — a source naming an unknown service is TF-unknown-service, like a step naming one', () => {
  const { program } = parseSource('test "t"\n  api GET /w\n  expect body matches schema "W" from roto "/openapi.json"\n');
  const diags = checkServices(program, ['root']);
  assert.equal(diags.length, 1, JSON.stringify(diags));
  assert.match(diags[0]!.message, /unknown api service "roto"/);
  assert.match(diags[0]!.hint ?? '', /root/);
});

test('M197 — `seed spider <service> "…"` carries the service too', () => {
  const crawl = parseSource('crawl "walk"\n  seed spider adminConsole "/"\n');
  assert.deepEqual(crawl.diagnostics, []);
  const seed = crawl.program.crawls![0]!.seeds[0]!;
  assert.equal(seed.type, 'SpiderSeed');
  if (seed.type === 'SpiderSeed') {
    assert.equal(seed.service, 'adminConsole');
    assert.equal(seed.root.value, '/');
  }
});
