// `redact body.email, body.*.address` (SPEC §3.4, PLAN decision 101d, enterprise arc cluster 2) —
// masks matching JSON fields with `[redacted]` in the report-only trace. Distinct mechanism from
// `redact.ts`'s taint-based secret redaction (redact.test.ts): this one is path-based and masks a
// field regardless of whether its value ever came from `env(...)`. Same property under test
// throughout as evidence-level.test.ts: masking never affects what `expect`/`capture` can see —
// only what lands in the report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import type { RedactPattern } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('`redact body.email` masks a top-level response field, and the assertion against the real value still passes', async () => {
  const server = await startFixtureServer({ '/user': (_req, res) => json(res, 200, { email: 'a@example.com', name: 'A' }) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'email' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  // The assertion's own source line echoes "a@example.com" too (`StepResult.source` mirrors the
  // raw `.tflw` text verbatim by design) — so the check below is scoped to the `api` step's
  // *trace*, the only place field redaction actually applies, not the whole serialized report.
  const source = `test "reads a user"\n  api GET /user\n  expect status equals 200\n  expect body.email equals "a@example.com"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.response!.bodyText, /a@example\.com/);
  assert.match(apiStep.response!.bodyText, /\[redacted\]/);
  assert.match(apiStep.response!.bodyText, /"name":"A"/, 'an unmatched field must survive untouched');

  await server.close();
});

test('`redact body.*.address` masks a nested field across every element of an array', async () => {
  const server = await startFixtureServer({
    '/users': (_req, res) =>
      json(res, 200, [
        { name: 'A', address: '1 First St' },
        { name: 'B', address: '2 Second St' },
      ]),
  });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'wildcard' }, { kind: 'prop', name: 'address' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  const source = `test "lists users"\n  api GET /users\n  expect status equals 200\n  expect body[0].address equals "1 First St"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.response!.bodyText, /First St|Second St/);
  assert.match(apiStep.response!.bodyText, /"name":"A"/);
  assert.match(apiStep.response!.bodyText, /"name":"B"/);

  await server.close();
});

test('`redact body.password` masks a request body field, not just response bodies', async () => {
  const server = await startFixtureServer({ '/signup': (_req, res) => json(res, 201, { ok: true }) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'password' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  // Same scoping note as the test above: the api step's `source` line echoes "hunter2" verbatim
  // regardless of redaction (it mirrors the `.tflw` text, not the trace) — the check that matters
  // is on `request.body`, the actual field-redaction target.
  const source = `test "signs up"\n  api POST /signup body { email: "a@example.com", password: "hunter2" }\n  expect status equals 201\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.request!.body!, /hunter2/);
  assert.match(apiStep.request!.body!, /\[redacted\]/);
  assert.match(apiStep.request!.body!, /a@example\.com/, 'an unmatched field must survive untouched');

  await server.close();
});

test('a non-JSON body is left untouched — masking is best-effort, never a hard failure', async () => {
  const server = await startFixtureServer({
    '/health': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('email=a@example.com');
    },
  });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'email' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  const source = `test "health check"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.equal(apiStep.response!.bodyText, 'email=a@example.com', 'non-JSON bodies pass through unchanged, no crash');

  await server.close();
});

// Gap #15 (TFLW-GAPS.md): `redact` previously only rewrote the request/response JSON trace above —
// a `capture`/`expect` step's own rendered detail text composed the live value directly, leaking a
// redact-covered field regardless. These prove the detail line is masked too, while the live value
// used for evaluation (what the assertion actually compares, what a later step reads via the
// captured variable) is completely unaffected — same "sees the real value, reports the masked one"
// split `redactFields` already established for the request/response trace.

test('`capture body.phone` on a redact-covered field masks its own detail line, but the captured variable still holds the real value', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { phone: '+1-234-335-0035', name: 'A' }) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'phone' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  const source = `test "reads a profile"\n  api GET /profile\n  expect status equals 200\n  capture body.phone as p\n  expect body.name equals "{p}"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  // `expect body.name equals "{p}"` fails (name is "A", not the phone number) — proves the
  // captured variable really did carry the real, unmasked phone number into a later step, not
  // literally the string "[redacted]".
  assert.equal(report.ok, false);
  const captureStep = report.tests[0]!.steps.find((s) => s.kind === 'capture')!;
  assert.equal(captureStep.detail, 'p = [redacted] (captured)');
  const expectSteps = report.tests[0]!.steps.filter((s) => s.kind === 'expect');
  assert.match(expectSteps[1]!.detail!, /\+1-234-335-0035/, 'the later expect proves the real value, not the mask, was actually used');

  await server.close();
});

test('`capture` on a field not covered by `redact` is unaffected', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { phone: '+1-234-335-0035', name: 'A' }) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'email' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  const source = `test "reads a profile"\n  api GET /profile\n  expect status equals 200\n  capture body.phone as p\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const captureStep = report.tests[0]!.steps.find((s) => s.kind === 'capture')!;
  assert.equal(captureStep.detail, 'p = "+1-234-335-0035" (captured)');

  await server.close();
});

test('a passing `expect body.phone equals ...` on a redact-covered field masks the value even though the assertion passed', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { phone: '+1-234-335-0035' }) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'phone' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  const source = `test "reads a profile"\n  api GET /profile\n  expect body.phone equals "+1-234-335-0035"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.doesNotMatch(expectStep.detail!, /\+1-234-335-0035/);
  assert.match(expectStep.detail!, /\[redacted\]/);

  await server.close();
});

test('a failing `expect body.phone equals ...` masks the real (`got`) side, even though the hardcoded `expected` literal in source stays visible (it is already in cleartext on the source line regardless)', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { phone: '+1-234-335-0035' }) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'prop', name: 'phone' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  const source = `test "reads a profile"\n  api GET /profile\n  expect body.phone equals "+1-999-999-9999"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.doesNotMatch(expectStep.detail!, /\+1-234-335-0035/, 'the real response value (the `got` side) must be masked');
  assert.match(expectStep.detail!, /\[redacted\]/);

  await server.close();
});

test('`any`/`all` over a redact-covered path is deliberately left unmasked (documented limitation, gap #15)', async () => {
  const server = await startFixtureServer({ '/users': (_req, res) => json(res, 200, [{ phone: '+1-234-335-0035' }]) });
  const patterns: RedactPattern[] = [{ root: 'body', segments: [{ kind: 'wildcard' }, { kind: 'prop', name: 'phone' }] }];
  const config = { ...testConfig(server.baseUrl), redactPatterns: patterns };

  // `all` (not `any`) deliberately mismatched: only a *failing* per-element outcome's message ever
  // echoes the real value (`evalMatcher`'s own "expected ..., but got ..." text) — a passing
  // quantified check's message never includes element values at all (`"any/all of N matched"`),
  // so it wouldn't prove anything about masking either way.
  const source = `test "lists users"\n  api GET /users\n  expect all body.phone equals "+1-999-999-9999"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.match(expectStep.detail!, /\+1-234-335-0035/, 'quantified assertions are out of scope for this fix — no crash, no (incorrect) masking attempted');

  await server.close();
});

test('no `redact` patterns declared means capture/expect detail text passes through unmasked (existing behavior unchanged)', async () => {
  const server = await startFixtureServer({ '/profile': (_req, res) => json(res, 200, { phone: '+1-234-335-0035' }) });
  const config = testConfig(server.baseUrl); // redactPatterns: [] by default

  const source = `test "reads a profile"\n  api GET /profile\n  capture body.phone as p\n  expect body.phone equals "+1-234-335-0035"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const captureStep = report.tests[0]!.steps.find((s) => s.kind === 'capture')!;
  assert.equal(captureStep.detail, 'p = "+1-234-335-0035" (captured)');
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.match(expectStep.detail!, /\+1-234-335-0035/);

  await server.close();
});

test('no `redact` patterns declared means the body passes through byte-for-byte (no gratuitous reformatting)', async () => {
  const server = await startFixtureServer({ '/user': (_req, res) => json(res, 200, { email: 'a@example.com' }) });
  const config = testConfig(server.baseUrl); // redactPatterns: [] by default

  const source = `test "reads a user"\n  api GET /user\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.equal(apiStep.response!.bodyText, JSON.stringify({ email: 'a@example.com' }));

  await server.close();
});
