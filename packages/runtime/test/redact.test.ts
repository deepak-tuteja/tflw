// Taint redaction (redact.ts, P#30). Every `env(NAME)` value is registered and masked wherever it
// later appears in a report/trace. P#46 flagged a gap: a secret containing characters that
// `JSON.stringify` escapes (quotes, backslashes, newlines) would appear in its *escaped* form
// inside a `body { … }` trace and dodge a plain substring match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { Redactor, redactEvent, redactReport } from '../src/redact.js';
import type { RunEvent, RunReport } from '../src/types.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('Redactor.redact masks a registered secret wherever it appears verbatim', () => {
  const r = new Redactor();
  r.register('API_KEY', 'sekret');
  assert.equal(r.redact('Authorization: Bearer sekret'), 'Authorization: Bearer •••(API_KEY)');
});

test('Redactor.redact also masks the JSON-string-escaped form of a secret containing quotes/backslashes (P#46)', () => {
  const r = new Redactor();
  r.register('ADMIN_PW', 'p"w\\word');
  const jsonBody = JSON.stringify({ pass: 'p"w\\word' });
  assert.ok(jsonBody.includes('p\\"w\\\\word'), 'sanity: JSON.stringify really does escape this value');
  assert.doesNotMatch(r.redact(jsonBody), /p"w\\word/);
  assert.match(r.redact(jsonBody), /•••\(ADMIN_PW\)/);
});

test('two env vars sharing the same secret value are both named in the placeholder, not just whichever registered first (decision 72)', () => {
  const r = new Redactor();
  r.register('API_KEY', 'sharedsecret');
  r.register('LEGACY_KEY', 'sharedsecret');
  assert.equal(r.redact('token=sharedsecret'), 'token=•••(API_KEY|LEGACY_KEY)');
  // Registering the same name again for the same value must not duplicate it in the placeholder.
  r.register('API_KEY', 'sharedsecret');
  assert.equal(r.redact('token=sharedsecret'), 'token=•••(API_KEY|LEGACY_KEY)');
});

test('a secret appearing in an early response is masked by the final report pass, even though its `env()` isn\'t evaluated until a later step (decision 56)', async () => {
  // Before decision 56, redaction only happened per-step, using whatever the redactor knew *at
  // that moment* — so a secret first read late in a run could never retroactively mask an earlier
  // step's already-built trace. `whoami` echoes the secret value first; only the second step
  // actually evaluates `env(ADMIN_PW)`, registering it.
  const server = await startFixtureServer({
    '/whoami': (_req, res) => json(res, 200, { note: 'current pw is p@ssw0rd-xyz' }),
    '/login': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "secret surfaces before it's ever read via env()"
  api GET /whoami
  expect status equals 200
  api POST /login body { pass: env(ADMIN_PW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const whoamiStep = report.tests[0]!.steps.find((s) => s.detail?.includes('/whoami'))!;
  assert.doesNotMatch(whoamiStep.response!.bodyText, /p@ssw0rd-xyz/, 'the final report pass must retroactively mask the earlier response');
  assert.match(whoamiStep.response!.bodyText, /•••\(ADMIN_PW\)/);

  await server.close();
});

test('`require env` pre-registers a secret at run start, masking a response that echoes it even when `env()` is never evaluated anywhere in the file (decision 56)', async () => {
  // The only case per-step redaction *and* a trailing full-report pass both miss on their own: a
  // required var that leaks into a response but whose `env(NAME)` is never actually called in this
  // run, so nothing would ever register it — unless it's pre-registered from `require env` alone.
  const server = await startFixtureServer({ '/whoami': (_req, res) => json(res, 200, { note: 'current pw is p@ssw0rd-xyz' }) });

  const source = `test "never calls env() at all"
  api GET /whoami
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['ADMIN_PW'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const whoamiStep = report.tests[0]!.steps.find((s) => s.detail?.includes('/whoami'))!;
  assert.doesNotMatch(whoamiStep.response!.bodyText, /p@ssw0rd-xyz/);
  assert.match(whoamiStep.response!.bodyText, /•••\(ADMIN_PW\)/);

  await server.close();
});

test('an env() secret with a quote in it stays redacted end-to-end through a JSON request body', async () => {
  const server = await startFixtureServer({ '/login': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "login"
  api POST /login body { pass: env(ADMIN_PW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p"w\\word' };
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.request!.body ?? '', /w\\word/);
  assert.match(apiStep.request!.body ?? '', /•••\(ADMIN_PW\)/);

  await server.close();
});

test('the same late-secret run, replayed through the event stream: `redactEvent` masks every event kind, not just the one carrying the report (M63/V2-02)', async () => {
  // The two halves of this proof already existed and had never been put in the same test: the
  // decision-56 test above asserts the *report* is retroactively masked, and
  // reporter/test/events-ndjson.test.ts asserts the *writer* emits one line per event — with
  // hand-authored events, from a run that never happened. Nothing checked that the events a real
  // run produces are masked before they are persisted, which is exactly what V2-02 found leaking.
  const server = await startFixtureServer({
    '/whoami': (_req, res) => json(res, 200, { note: 'current pw is p@ssw0rd-xyz' }),
    '/login': (_req, res) => json(res, 200, { ok: true }),
  });

  const source = `test "secret surfaces before it's ever read via env()"
  api GET /whoami
  expect status equals 200
  api POST /login body { pass: env(ADMIN_PW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const collected: RunEvent[] = [];
  const { redactor } = await runProgram(program, testConfig(server.baseUrl), { source, environ, emit: (e) => collected.push(e) });

  // Sanity: the raw stream really does carry the secret — the `/whoami` events are emitted before
  // `env(ADMIN_PW)` is ever evaluated, so nothing could have masked them at emit time. Without
  // this the assertions below would pass vacuously.
  const raw = collected.map((e) => JSON.stringify(e)).join('\n');
  assert.match(raw, /p@ssw0rd-xyz/, 'sanity: the live event stream is the thing that needs the final pass');

  const persisted = collected.map((e) => redactEvent(e, redactor));
  const kinds = new Set(persisted.map((e) => e.type));
  assert.deepEqual([...kinds].sort(), ['run:end', 'run:start', 'step:end', 'test:end', 'test:start'], 'every event kind must be exercised, or this test stops covering the one that leaks');
  const text = persisted.map((e) => JSON.stringify(e)).join('\n');
  assert.doesNotMatch(text, /p@ssw0rd-xyz/, 'no event may carry the raw secret once the final pass has run');
  assert.match(text, /ADMIN_PW/, 'and the placeholder must be there — an empty stream would also satisfy the line above');

  // Idempotent, the same way `redactReport` is: the CLI re-walks events that were already masked
  // at emit time (the `/login` ones), and re-redacting a placeholder must not mangle it.
  const twice = persisted.map((e) => redactEvent(e, redactor));
  assert.deepEqual(twice, persisted);

  await server.close();
});

test('M88d/B3-11: a workload `test:end` is redacted through the workload branch, not dropped by a functional-only cast', async () => {
  // `RunEvent`'s `test:end` widened from `TestResult` to `ReportEntry` when workload tests started
  // emitting a pair — so `redactEvent` had to make the same `kind` dispatch `redactReport` already
  // makes over `report.tests`. A `WorkloadTestResult` has no `steps`, so the old
  // `redactTestResult` would have walked nothing and returned the name unmasked; the only field
  // that can carry a secret here is the interpolated test name, and it is the whole surface.
  const server = await startFixtureServer({ '/login': (_req, res) => json(res, 200, { ok: true }) });
  // A test name is never interpolated, so the only way one carries a secret is the way this one
  // does: the author typed the value into the header, and some step later reveals it to the
  // redactor via `env()`. That is precisely the ordering the final pass exists for.
  const source = `test "burst for acme-tenant-secret"
  ramp to 1 users over 100ms
  api POST /login body { tenant: env(TENANT) }
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const collected: RunEvent[] = [];
  const { redactor } = await runProgram(program, testConfig(server.baseUrl), {
    source,
    environ: { ...process.env, TENANT: 'acme-tenant-secret' },
    emit: (e) => collected.push(e),
  });

  const end = collected.find((e) => e.type === 'test:end')!;
  assert.equal(end.type === 'test:end' && end.result.kind, 'workload', 'sanity: this is the workload pair B3-11 added');
  const masked = redactEvent(end, redactor);
  const text = JSON.stringify(masked);
  assert.doesNotMatch(text, /acme-tenant-secret/);
  assert.match(text, /•••\(TENANT\)/, 'and the placeholder is really there — a dropped result would also satisfy the line above');

  await server.close();
});

test('a short `require env` value is not substring-redacted, so it never corrupts unrelated report content (decision 64)', () => {
  const r = new Redactor();
  r.register('PORT', '3001'); // 4 chars — below the redaction floor
  assert.equal(r.redact('order id 3001 shipped'), 'order id 3001 shipped', 'a short secret must not blot out an unrelated matching field');
});

// A12-01. The test above and its unit twin assert the *intended* half of decision 64 — an unrelated
// field equal to a short secret is not corrupted — and they are correct. Nobody wrote the mirror
// assertion, because from the author's side declining to mask is the feature. It is a feature that
// has to be audible: the tool knew the value was declared a secret, knew it chose not to protect
// it, and said nothing. These four cover the whole rule, including the two things it must *not* say.
test('a value too short to mask is named by `unmaskableNames`, so the run can say so out loud (A12-01)', () => {
  const r = new Redactor();
  r.register('SHORTPW', 'hunt2'); // 5 chars — below the floor, ships in the clear
  assert.deepEqual(r.unmaskableNames(), ['SHORTPW']);
});

test('a maskable secret is not named as unmaskable — the warning must not cry wolf (A12-01)', () => {
  const r = new Redactor();
  r.register('LONGPW', 'hunter2extended');
  assert.deepEqual(r.unmaskableNames(), [], 'a value the redactor actually masks must never appear in the warning');
});

test('an empty value is not named as unmaskable — there is nothing to hide (A12-01)', () => {
  const r = new Redactor();
  r.register('UNSET', '');
  assert.deepEqual(r.unmaskableNames(), [], 'an unset/empty var leaks nothing, so warning about it would be noise');
});

test('a name carrying both a short and a maskable value is not named — it is masked where it matters (A12-01)', () => {
  const r = new Redactor();
  r.register('token', '7'); // e.g. a `capture` inside a loop, first iteration
  r.register('token', 'eyJhbGciOiJIUzI1NiJ9');
  assert.deepEqual(r.unmaskableNames(), [], 'pointing a reader at a name that *is* masked in the report they are holding is worse than silence');
});

test('a short `env()` secret is named in the report, and a long one alongside it is not (A12-01)', async () => {
  const server = await startFixtureServer({ '/echo': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "one short secret, one long one"
  api POST /echo body { a: env(SHORTPW), b: env(LONGPW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, SHORTPW: 'hunt2', LONGPW: 'hunter2extended' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['SHORTPW', 'LONGPW'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.deepEqual(report.unmaskableSecrets, ['SHORTPW'], 'the run must name the var it declined to protect, and only that one');

  // The claim the warning makes has to be true, or it is worse than no warning at all: the short
  // value really is in the clear, and the long one really is masked.
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.match(apiStep.request!.body ?? '', /hunt2/, 'the short secret must genuinely be present — otherwise this test proves nothing');
  assert.doesNotMatch(apiStep.request!.body ?? '', /hunter2extended/);

  await server.close();
});

test('a run with nothing too short to mask omits `unmaskableSecrets` entirely (A12-01)', async () => {
  const server = await startFixtureServer({ '/echo': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "only a maskable secret"
  api POST /echo body { a: env(LONGPW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, LONGPW: 'hunter2extended' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['LONGPW'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.unmaskableSecrets, undefined, 'the overwhelmingly common run must add nothing to the report');

  await server.close();
});

test('a short secret is never registered end-to-end, so an unrelated response field that happens to equal it renders untouched (decision 64)', async () => {
  const server = await startFixtureServer({ '/orders/3001': (_req, res) => json(res, 200, { orderId: 3001, status: 'shipped' }) });

  const source = `test "an unrelated field equal to a short secret stays visible"
  api GET /orders/3001
  expect status equals 200
  expect body.orderId equals 3001
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, PORT: '3001' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['PORT'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.match(apiStep.response!.bodyText, /"orderId":3001/, 'the unrelated orderId field must not be redacted just because it matches a short secret');

  await server.close();
});

// PLAN decision 86: a secret that only ever appeared in a failing retry attempt used to be
// invisible in the report anyway (the attempt itself was discarded) — now that `TestResult.attempts`
// preserves it, the redaction pass must reach into every attempt, not just the final kept one.
test('a secret that only appears in a discarded-until-now failing retry attempt is still redacted', async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/flaky-echo': (_req, res) => {
      calls++;
      if (calls === 1) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ note: 'pw is p@ssw0rd-xyz' }));
      else json(res, 200, { ok: true });
    },
  });

  const source = `test "first attempt leaks the secret in a 500 body" retry 1
  api GET /flaky-echo
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const config = { ...testConfig(server.baseUrl), requiredEnv: ['ADMIN_PW'] };
  const { report } = await runProgram(program, config, { source, environ });

  assert.equal(report.tests[0]!.attempts?.length, 2, 'sanity: attempt 1 failed, attempt 2 passed');
  const serialized = JSON.stringify(report.tests[0]);
  assert.doesNotMatch(serialized, /p@ssw0rd-xyz/, 'the secret must not leak from the discarded-until-now failing attempt');
  assert.match(JSON.stringify(report.tests[0]!.attempts![0]), /•••\(ADMIN_PW\)/, 'the masked placeholder should appear inside attempt 1 specifically');

  await server.close();
});

// ---- FS-01 (review finding V2-01): the limit, stated as a test ---------------

test('a trace archive passes through `redactReport` byte-identical — redaction does not reach binary evidence', () => {
  // No test in this suite had ever produced a real `TraceAsset`, which is how the gap survived:
  // `redactStepResult` spreads `...s`, so a trace (and a screenshot) flows through the whole
  // redaction pass untouched. That is not a bug to fix here — it is a fact about what redaction
  // *is*. `Redactor.redact` walks text; a Playwright archive is a zip of DOM snapshots and
  // per-action screenshots, and a screenshot is pixels. A page that renders a secret on screen
  // shows it in the capture exactly as it would to a person looking at the monitor.
  //
  // This test pins that limit so nobody later assumes the redactor covers it — and it is precisely
  // why FS-01 gates capture on `evidence full` instead of promising to clean the archive. The only
  // promise the tool can keep about a captured screenshot is "we didn't capture it"; see
  // browser-steps.test.ts's FS-01 block for the capture-side half.
  const r = new Redactor();
  r.register('API_KEY', 'sekret-value');
  const traceBytes = Buffer.from('PK sekret-value inside the archive').toString('base64');

  const report: RunReport = {
    ok: false,
    env: 'local',
    startedAt: '2026-08-03T00:00:00.000Z',
    durationMs: 1,
    total: 1,
    passed: 0,
    failed: 1,
    seed: 1,
    now: '2026-08-03T00:00:00.000Z',
    insecure: false,
    tests: [
      {
        kind: 'functional',
        name: 'renders a secret',
        ok: false,
        durationMs: 1,
        error: 'sekret-value showed up',
        steps: [{ kind: 'click', source: 'click button "Pay"', line: 2, ok: false, durationMs: 1, detail: 'sekret-value', screenshot: { base64: traceBytes } }],
        trace: { base64: traceBytes },
      },
    ],
  };

  const redacted = redactReport(report, r);
  const t = redacted.tests[0]!;
  assert.equal(t.kind, 'functional');
  // Text is redacted…
  assert.match(t.error!, /•••\(API_KEY\)/);
  assert.match(t.steps[0]!.detail!, /•••\(API_KEY\)/);
  // …and binary evidence is not, at all.
  assert.equal(t.trace!.base64, traceBytes, 'the archive is returned exactly as captured');
  assert.equal(t.steps[0]!.screenshot!.base64, traceBytes);
  assert.ok(Buffer.from(t.trace!.base64, 'base64').toString().includes('sekret-value'), 'the secret really is still in there — that is the point');
});
