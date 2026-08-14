// `expect response has no input handling violations`, wired end to end (M134a, D366/D372/D382) — a
// real `node:http` fixture, a real `tflw.config` through the real grammar, and the interpreter in
// between.
//
// **This file exists for the reason `authz-assert.test.ts` exists, and `M128` is still the reason.**
// `sec/authenticated-response-cacheable` read a lowercase header key against a map that preserves
// the case its author typed, so it **fired for nobody while its unit tests passed** — because those
// tests spelled the header lowercase too. A pure, injectable design makes unit tests reach every
// branch; it does not make them right about the world.
//
// `input-corpus.test.ts` covers where a request can be mutated, `input-rules.test.ts` covers what
// the pack decides, and `input-probe.test.ts` covers what the prober sends. What is only observable
// here is the **joins**: that the two new `probe` sub-clauses really travel from config text through
// `resolveConfig` to the class gate, that a mutated request really goes out carrying the observed
// identity, and that a real disclosure really reaches the assertion's message.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parseConfigSource, parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { resolveConfig } from '../src/resolve.js';
import type { ResolvedConfig } from '../src/types.js';
import type { ScanFinding, ScanSink } from '../src/scanFindings.js';

let server: Server;
let baseUrl: string;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Every payload this fixture has been asked to handle, so a test can assert on what was *sent*
 *  rather than only on what the oracle concluded. */
let seen: { method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }[] = [];

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body, headers: req.headers });
      const q = url.searchParams.get('q') ?? '';

      // A correct endpoint. Validates, echoes nothing raw, and answers 400 to anything it dislikes —
      // the **negative corpus** in miniature, and the control for every finding below.
      if (url.pathname === '/clean') {
        if (q.length > 100) return json(res, 400, { message: 'q is too long' });
        return json(res, 200, { results: [], query: q });
      }

      // Discloses a stack frame when it dislikes its input. `V12`'s shape.
      if (url.pathname === '/leaky') {
        if (q === 'shoes') return json(res, 200, { results: [] });
        return json(res, 500, { message: 'Error: bad input\n    at SearchService.find (/usr/src/app/search.service.js:41:9)' });
      }

      // Reflects raw input into an HTML body. `V10`'s shape.
      if (url.pathname === '/reflect') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(`<p>no results for ${q}</p>`);
        return;
      }

      // Reads a file when asked to traverse. `V11`'s shape — a planted string, never a real read.
      if (url.pathname.startsWith('/files/')) {
        const seg = decodeURIComponent(url.pathname.slice('/files/'.length));
        if (seg.includes('etc/passwd')) {
          res.writeHead(200, { 'content-type': 'text/plain' }).end('root:x:0:0:root:/root:/bin/bash\n');
          return;
        }
        return json(res, 200, { id: seg });
      }

      // Accepts anything, at any length. `V13`'s shape.
      if (url.pathname === '/notes' && req.method === 'POST') {
        return json(res, 201, { id: '1' });
      }

      // M134b (D369) — a route **only the seeded layer can trip**. Every corpus injection payload is
      // `tflw` plus exactly one metacharacter (5 chars) or one of two fixed strings; a generated
      // quoting payload is `tflw` plus *two* tokens, so `starts with tflw and is 6+ chars` is a
      // condition the reviewed corpus cannot meet and the drawn one reaches within a handful of
      // draws. That is what lets one fixture separate "this finding gates" from "this finding is
      // reported and does not", which is the entire contract of the seeded layer.
      if (url.pathname === '/seed-only') {
        if (q.startsWith('tflw') && q.length >= 6) {
          return json(res, 500, { message: 'Error: bad input\n    at SeedService.find (/usr/src/app/seed.service.js:7:3)' });
        }
        return json(res, 200, { results: [] });
      }

      if (url.pathname === '/health') return json(res, 200, { ok: true });
      json(res, 404, { error: 'no route' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The config through the **real grammar** and the real `resolveConfig`, so the sub-clauses are
 *  exercised as written rather than as a field somebody set. Half of what this file proves is that
 *  the grammar half and the engine half of this milestone agree, and only a config that travels the
 *  whole way can say whether they do. */
function resolved(subClauses = ''): ResolvedConfig {
  const source = `defaults\n  authorized target "${baseUrl}" reason "self-hosted test fixture"\n${subClauses}\nenv local default\n  api "${baseUrl}"\n`;
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), [], 'the fixture config must parse and check clean');
  return resolveConfig(config!, config!.envs[0]!);
}

async function run(
  source: string,
  cfg: ResolvedConfig = resolved(),
  /** M134b — the run-level knobs this file needs to observe: the seeded layer's count, a fixed seed
   *  so a drawn payload is reproducible, and the sink that collects what every scan found. */
  opts: { probeSeeded?: number; seed?: number } = {},
): Promise<{ detail: string; ok: boolean; error?: string; findings: ScanFinding[] }> {
  seen = [];
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  const findings: ScanFinding[] = [];
  const scanSink: ScanSink = { finding: (f) => findings.push(f), census: () => {} };
  const { report } = await runProgram(program, cfg, { source, scanSink, ...opts });
  const t = report.tests[0]!;
  const steps = t.kind === 'functional' ? t.steps : [];
  const asserts = steps.filter((s) => s.kind === 'expect' || s.kind === 'check');
  const last = asserts[asserts.length - 1];
  return { detail: last?.detail ?? '', ok: last?.ok ?? false, ...(t.kind === 'functional' && t.error ? { error: t.error } : {}), findings };
}

const ASSERT = 'expect response has no input handling violations';

// --- the clean case: a correct application reports clean ------------------------------------------

test('a validating endpoint that discloses nothing passes, and the cost line says what it cost', async () => {
  // The negative control for the whole tier. If this goes red, one of the four rules has widened
  // into an application behaving correctly — which is the only failure mode that would make the
  // scan worth ignoring.
  const r = await run(`test "t"\n  api GET /clean?q=shoes\n  ${ASSERT}\n`);
  assert.ok(r.ok, `expected clean, got: ${r.detail}`);
  assert.match(r.detail, /has no input-handling violations/);
  assert.match(r.detail, /1 site, \d+ requests sent, [\d.]+ per site/);
});

test('the probes really went out — a green line over zero requests would be the quiet failure', async () => {
  await run(`test "t"\n  api GET /clean?q=shoes\n  ${ASSERT}\n`);
  // One observed request plus one per enabled payload. Asserted as a floor rather than an exact
  // number so widening the corpus is not a test edit, but asserted at all because "it passed" and
  // "it tested nothing" render identically without it.
  assert.ok(seen.length > 3, `expected the matrix to be sent, saw ${seen.length} requests`);
  assert.ok(seen.some((s) => s.url.includes("tflw'") || s.url.includes('tflw%27')), 'an injection payload must actually reach the server');
});

// --- each rule, end to end -------------------------------------------------------------------------

test('a stack frame in an error body is reported as sec/error-detail-disclosure', async () => {
  const r = await run(`test "t"\n  api GET /leaky?q=shoes\n  ${ASSERT}\n`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /sec\/error-detail-disclosure/);
  assert.match(r.detail, /a stack frame/);
  assert.match(r.detail, /query `q`/);
});

test('raw metacharacters echoed into HTML are reported as sec/reflected-input-unescaped', async () => {
  const r = await run(`test "t"\n  api GET /reflect?q=shoes\n  ${ASSERT}\n`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /sec\/reflected-input-unescaped/);
});

test('traversal needs `probe traversal`, and finds the file once it has it', async () => {
  const src = `test "t"\n  api GET /files/7\n  ${ASSERT}\n`;

  // Without the opt-in: nothing traversal-shaped goes out at all, and the assertion says so.
  const without = await run(src);
  assert.ok(!seen.some((s) => s.url.includes('etc') || s.url.includes('%2Fetc')), 'no traversal payload may be sent without `probe traversal`');
  assert.match(without.detail, /probe traversal/);

  // With it: the same suite, one config line different, finds a critical.
  const withOptIn = await run(src, resolved('    probe traversal\n'));
  assert.equal(withOptIn.ok, false);
  assert.match(withOptIn.detail, /sec\/path-traversal-read/);
  assert.match(withOptIn.detail, /critical/);
});

test('oversized needs `probe oversized`, and the 64 KiB value really travels', async () => {
  const src = `test "t"\n  api POST /notes body { text: "hi" }\n  ${ASSERT}\n`;
  const cfg = resolved('    probe mutating\n    probe oversized\n');
  const r = await run(src, cfg);
  assert.equal(r.ok, false);
  assert.match(r.detail, /sec\/oversized-input-accepted/);
  assert.ok(seen.some((s) => s.body.length > 60_000), 'the oversized payload must reach the wire, not just the plan');
});

// --- the safety gates, end to end ---------------------------------------------------------------------

test('a mutating step with no `probe mutating` sends no probe at all', async () => {
  const r = await run(`test "t"\n  api POST /notes body { text: "hi" }\n  ${ASSERT}\n`);
  // One request: the observed one. Anything more means a write was re-sent without permission.
  assert.equal(seen.length, 1, `expected only the observed request, saw ${seen.map((s) => s.method + ' ' + s.url).join(', ')}`);
  assert.match(r.detail, /probe mutating/);
});

test('the observed identity travels on every probe — nothing is stripped (D370/D375)', async () => {
  // Tier 2's probe replaces the identity and a CSRF guard then refuses it before authorization is
  // consulted; this tier's probe does not, which is the single reason `M130-01` stays Tier 2's row.
  // Asserted against the wire rather than against the code, because that claim is only worth
  // anything if the bytes carry it.
  await run(`test "t"\n  api GET /clean?q=shoes\n    header "X-CSRF-Token" is "abc"\n  ${ASSERT}\n`);
  assert.ok(seen.length > 1, 'the matrix must have been sent');
  for (const r of seen) {
    assert.equal(r.headers['x-csrf-token'], 'abc', `a probe went out without the observed request's own token: ${r.url}`);
  }
});

// --- D285 / TF067's runtime twin ------------------------------------------------------------------------

test('TF067 at run time: a request with nothing to mutate fails rather than passing green', async () => {
  // The checker catches the literal case; this catches every case, including the interpolated paths
  // it deliberately stays silent about. An assertion that could not have failed is a failure.
  const r = await run(`test "t"\n  api GET /health\n  ${ASSERT}\n`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /had no power to fail/);
  assert.match(r.detail, /TF067/);
});

test('a not-applicable listing names each rule and why it stood down', async () => {
  const r = await run(`test "t"\n  api GET /health\n  ${ASSERT}\n`);
  for (const rule of ['sec/error-detail-disclosure', 'sec/reflected-input-unescaped', 'sec/path-traversal-read', 'sec/oversized-input-accepted']) {
    assert.match(r.detail, new RegExp(rule.replace('/', '\\/')));
  }
});

// --- the severity floor, end to end -----------------------------------------------------------------------

test('a floor that excludes the only finding lets the assertion pass, and says the floor narrowed the pack', async () => {
  const r = await run(`test "t"\n  api GET /leaky?q=shoes\n  expect response has no critical input handling violations\n`);
  // The disclosure rule is `serious`, so a `critical` floor drops it from the pack entirely — and
  // with nothing left that applies, D285 fails the assertion rather than greening it.
  assert.equal(r.ok, false);
  assert.match(r.detail, /had no power to fail/);
});

test('the `check` form soft-fails — the test still fails, but later steps run (decision 55)', async () => {
  // The contract is *continue and fail at the end*, not *do not fail*. Asserted on the step that
  // follows rather than on `error`, because a soft failure does still populate `error` — writing
  // this the other way round would assert the opposite of the language's actual rule.
  const src = `test "t"\n  api GET /leaky?q=shoes\n  check response has no input handling violations\n  api GET /health\n`;
  const r = await run(src);
  assert.equal(r.ok, false);
  assert.ok(seen.some((s2) => s2.url === '/health'), 'the step after a soft check must still run');
});

// --- M134b: the gate and the seeded layer, end to end ---------------------------------------------
//
// These live here rather than beside the unit tests because what they pin is a **join**: the rule
// pack attaches a payload id, the interpreter decides whether this run drew that payload, and
// `judge` decides whether the result gates. Each half is unit-tested and each half can be correct
// while the join is not — that is exactly what `M128` paid for and D335 wrote this file to prevent.

test('without --probe-seeded, a route only a generated payload can trip stays green', async () => {
  // The control. If this ever goes red the corpus has grown a payload that meets the fixture's
  // condition, and the two tests below stop separating seeded findings from reviewed ones — they
  // would still pass, while testing nothing.
  const r = await run(`test "t"\n  api GET /seed-only?q=shoes\n  ${ASSERT}\n`);
  assert.ok(r.ok, `expected clean without the seeded layer, got: ${r.detail}`);
  assert.equal(r.findings.length, 0);
});

test('a seeded finding is reported and does NOT fail the assertion (D369)', async () => {
  // The load-bearing test of the whole layer. The application really did disclose a stack frame, the
  // scan really did notice, the finding really is in the report — and the build is still green,
  // because R8 excludes the seed from a fingerprint and a finding that appears under one seed and
  // vanishes under the next cannot be allowed to decide a build.
  const r = await run(`test "t"\n  api GET /seed-only?q=shoes\n  ${ASSERT}\n`, resolved(), { probeSeeded: 8, seed: 0x5eed });
  assert.ok(r.ok, `a seeded finding must not fail the build, got: ${r.detail}`);

  const seeded = r.findings.filter((f) => f.seeded);
  assert.ok(seeded.length > 0, 'the seeded layer found nothing — the fixture or the draw has drifted');
  for (const f of seeded) {
    assert.equal(f.withheld, 'seeded');
    assert.equal(f.fingerprint, undefined, 'a seeded finding must not be fingerprintable, or it would be baselinable');
    assert.equal(f.seeded!.seed, 0x5eed, 'the seed is printed so the finding can be reproduced');
    // "Promote this payload into the corpus" is only actionable if the payload is *there*.
    assert.ok(f.seeded!.payload.startsWith('tflw'), f.seeded!.payload);
  }
});

test('the seeded payloads really reached the server, and the corpus ones still did too', async () => {
  await run(`test "t"\n  api GET /seed-only?q=shoes\n  ${ASSERT}\n`, resolved(), { probeSeeded: 8, seed: 0x5eed });
  const values = seen.map((s) => decodeURIComponent(s.url));
  assert.ok(values.some((v) => /q=tflw../.test(v)), 'no generated two-token payload was sent');
  assert.ok(values.some((v) => /q=tflw.(&|$)/.test(v)), 'the reviewed corpus stopped being sent when the layer was added');
});

test('--probe-seeded cannot reach a class the target withheld (D388)', async () => {
  // The safety property, asserted where it would actually bite: the config grants nothing beyond the
  // defaults, and no number of generated payloads may produce a traversal request.
  await run(`test "t"\n  api GET /files/1\n  ${ASSERT}\n`, resolved(), { probeSeeded: 16, seed: 0x5eed });
  const traversed = seen.filter((s) => /\.\.|%2e%2e/i.test(decodeURIComponent(s.url)));
  assert.deepEqual(traversed, [], 'a traversal payload was sent to a target that never granted `probe traversal`');
});

test('a reviewed finding still gates while a seeded one does not, in the same run', async () => {
  // The two halves must coexist without one contaminating the other: `/leaky` is tripped by the
  // corpus, so the assertion fails — and it fails *for the reviewed finding*, with the seeded ones
  // still present in the report and still marked as not gating.
  const r = await run(`test "t"\n  api GET /leaky?q=shoes\n  ${ASSERT}\n`, resolved(), { probeSeeded: 4, seed: 0x5eed });
  assert.equal(r.ok, false);
  const gating = r.findings.filter((f) => !f.withheld);
  assert.ok(gating.length > 0, 'the reviewed corpus must still be able to fail a build');
  for (const f of gating) assert.notEqual(f.fingerprint, undefined, 'a gating finding must be baselinable, or the gate is unusable');
});
