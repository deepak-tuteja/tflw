// `expect`/`check response has no [<severity>] security violations` end-to-end (M128b, D283-D296,
// SPEC §9.10) — the interpreter wiring, against a real loopback server. The pack's own rule logic is
// unit-tested in `security-rules.test.ts`; what this file is about is everything between an HTTP
// response and a step result: which trace the scan reads, what the counts line says, D285's
// no-power-to-fail verdict, and D287's session findings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json, type Handler } from './support.js';
import type { ResolvedConfig } from '../src/types.js';

/** A JSON route with no security headers at all — the §0 prediction's shape. */
const bare: Handler = (_req, res) => json(res, 200, { ok: true });

async function run(routes: Record<string, Handler>, source: string, tweak: (c: ResolvedConfig) => ResolvedConfig = (c) => c) {
  const server = await startFixtureServer(routes);
  try {
    const { program } = parseSource(source);
    const { report } = await runProgram(program, tweak(testConfig(server.baseUrl)), { source });
    return report;
  } finally {
    await server.close();
  }
}

/** The one `expect`/`check` step in a single-test report. */
function stepsOf(report: Awaited<ReturnType<typeof run>>) {
  const t = report.tests[0]!;
  return t.kind === 'functional' ? t.steps : [];
}

function assertionStep(report: Awaited<ReturnType<typeof run>>) {
  const steps = stepsOf(report).filter((s) => s.kind === 'expect' || s.kind === 'check');
  return steps[steps.length - 1]!;
}

const T = (body: string) => `test "t"\n${body}\n`;

// --- the assertion runs at all ----------------------------------------------

test('a plaintext JSON response trips the two unconditional rules and fails', async () => {
  const report = await run({ '/a': bare }, T('  api GET /a\n  expect response has no security violations'));
  const step = assertionStep(report);
  assert.equal(step.ok, false);
  assert.match(step.detail!, /sec\/nosniff-missing/);
});

test('the counts line names all three states and its own denominator (D292, M126)', async () => {
  const report = await run({ '/a': bare }, T('  api GET /a\n  expect response has no security violations'));
  // Over http with no cookie and no CORS header: hsts, cookie-not-secure, the three cookie rules,
  // csp, x-frame-options and cors all stand down; nosniff, server-version and (unauthenticated)
  // cacheable is not applicable. The two TLS rules stand down too: nothing was probed, because
  // nothing here is https. So 12 considered, 2 applicable.
  assert.match(assertionStep(report).detail!, /12 rules — 2 applicable, 10 not applicable, 1 violation/);
});

test('a fully hardened response passes, and still prints its counts', async () => {
  const hardened: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }).end('{}');
  };
  const report = await run({ '/a': hardened }, T('  api GET /a\n  expect response has no security violations'));
  const step = assertionStep(report);
  assert.equal(step.ok, true);
  assert.match(step.detail!, /has no security violations — 12 rules — 2 applicable, 10 not applicable, 0 violations/);
});

test('`check` is the soft form — it records a failure without aborting the test', async () => {
  const report = await run({ '/a': bare, '/b': bare }, T('  api GET /a\n  check response has no security violations\n  api GET /b\n  expect status equals 200'));
  const kinds = stepsOf(report).map((s) => s.kind);
  assert.ok(kinds.includes('check'));
  // The step after the failing `check` still ran, which is the whole point of the soft form.
  assert.equal(stepsOf(report).filter((s) => s.kind === 'api').length, 2);
});

// --- D296: the floor narrows the pack ---------------------------------------

test('a severity floor changes the denominator, not just the findings', async () => {
  const report = await run({ '/a': bare }, T('  api GET /a\n  expect response has no serious security violations'));
  // 3 critical + 4 serious (hsts, csp, and M128c's two TLS rules).
  assert.match(assertionStep(report).detail!, /7 rules/);
});

test('a floor keeps a worse finding — `serious` also counts `critical`', async () => {
  const weakCookie: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'set-cookie': 'sid=abc' }).end('{}');
  };
  const report = await run({ '/a': weakCookie }, T('  api GET /a\n  expect response has no serious security violations'));
  const step = assertionStep(report);
  assert.equal(step.ok, false);
  assert.match(step.detail!, /sec\/cookie-not-httponly/);
});

// --- D285: an assertion with no power to fail -------------------------------

test('D285: zero applicable rules is a failure, not a pass', async () => {
  // A `critical` floor over plaintext with no cookie and no CORS header engages nothing at all.
  const report = await run({ '/a': bare }, T('  api GET /a\n  expect response has no critical security violations'));
  const step = assertionStep(report);
  assert.equal(step.ok, false, 'an assertion that could not have failed must not pass');
  assert.match(step.detail!, /had no power to fail/);
});

test('D285 names each rule that stood down, and why', async () => {
  const report = await run({ '/a': bare }, T('  api GET /a\n  expect response has no critical security violations'));
  const detail = assertionStep(report).detail!;
  assert.match(detail, /sec\/cookie-not-secure applies when: the scheme is https AND the response sets a cookie/);
  assert.match(detail, /lower the severity floor/);
});

test('D285 does not fire when a rule applied and simply found nothing', async () => {
  const nosniff: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }).end('{}');
  };
  const report = await run({ '/a': nosniff }, T('  api GET /a\n  expect response has no security violations'));
  assert.doesNotMatch(assertionStep(report).detail!, /no power to fail/);
});

// --- which trace the scan reads ---------------------------------------------

test('cookie rules see every `Set-Cookie` line, not the joined header', async () => {
  const twoCookies: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] }).end('{}');
  };
  const report = await run({ '/a': twoCookies }, T('  api GET /a\n  expect response has no security violations'));
  const detail = assertionStep(report).detail!;
  assert.match(detail, /cookie `a`/);
  assert.match(detail, /cookie `b`/);
});

test('a cookie set on an earlier redirect hop is still scanned', async () => {
  // M88c1's whole point, inherited: the commonest login shape sets its cookie on the 302, and the
  // final response sets nothing. A scan that read only the last hop would report clean.
  const routes: Record<string, Handler> = {
    '/login': (_req, res) => res.writeHead(302, { location: '/home', 'set-cookie': 'sid=abc' }).end(),
    '/home': bare,
  };
  const report = await run(routes, T('  api GET /login\n  expect response has no security violations'));
  assert.match(assertionStep(report).detail!, /cookie `sid`/);
});

test('a cookie value never appears in the failure detail', async () => {
  const secret: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=super-secret-jwt-value' }).end('{}');
  };
  const report = await run({ '/a': secret }, T('  api GET /a\n  expect response has no security violations'));
  assert.doesNotMatch(assertionStep(report).detail!, /super-secret-jwt-value/);
});

test('`authenticated-response-cacheable` reads the request that was actually sent', async () => {
  const src = T('  api GET /a\n    header "Authorization" is "Bearer tok"\n  expect response has no security violations');
  const report = await run({ '/a': bare }, src);
  assert.match(assertionStep(report).detail!, /sec\/authenticated-response-cacheable/);
});

// --- D287: the session's own login response ---------------------------------

/** A session whose login response sets a cookie with no `HttpOnly` — the defect D287 exists for. */
function withWeakSession(config: ResolvedConfig): ResolvedConfig {
  const { program } = parseSource('');
  void program;
  return {
    ...config,
    sessions: new Map([
      [
        'admin',
        {
          type: 'SessionDecl' as const,
          name: 'admin',
          body: parseSource('test "s"\n  api POST /login\n').program.tests[0]!.body,
          oauth2: null,
          privileged: false,
          span: { start: { line: 1, col: 1, offset: 0 }, end: { line: 1, col: 1, offset: 0 } },
        },
      ],
    ]) as ResolvedConfig['sessions'],
  };
}

test('D287: a session login cookie with no HttpOnly fails a test\'s security assertion', async () => {
  const routes: Record<string, Handler> = {
    '/login': (_req, res) => res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=abc' }).end('{}'),
    '/a': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }).end('{}');
    },
  };
  // `/a` on its own is clean, so without D287 this assertion would report a green over a suite
  // whose session cookie is readable by any script on the origin.
  const src = 'test "t" as admin\n  api GET /a\n  expect response has no security violations\n';
  const report = await run(routes, src, withWeakSession);
  const step = assertionStep(report);
  assert.equal(step.ok, false);
  assert.match(step.detail!, /session "admin" login/);
  assert.match(step.detail!, /sec\/cookie-not-httponly/);
});

test('D287: session findings are filtered by the assertion\'s own floor', async () => {
  const routes: Record<string, Handler> = {
    '/login': (_req, res) => res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=abc; HttpOnly' }).end('{}'),
    '/a': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }).end('{}');
    },
  };
  // The login response's only finding is `server-version-disclosure`-free and `nosniff-missing`
  // (moderate). A `critical` floor must not surface it — and, nothing else applying, D285 takes over.
  const src = 'test "t" as admin\n  api GET /a\n  expect response has no critical security violations\n';
  const report = await run(routes, src, withWeakSession);
  assert.match(assertionStep(report).detail!, /had no power to fail/);
});

test('D287: a clean session contributes nothing', async () => {
  const clean: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'set-cookie': 'sid=abc; HttpOnly; SameSite=Lax', 'cache-control': 'no-store' }).end('{}');
  };
  const src = 'test "t" as admin\n  api GET /a\n  expect response has no security violations\n';
  const report = await run({ '/login': clean, '/a': clean }, src, withWeakSession);
  assert.equal(assertionStep(report).ok, true);
});

// --- what `response` is not --------------------------------------------------

test('`capture response as x` is a runtime error naming the parts that can be bound', async () => {
  const report = await run({ '/a': bare }, T('  api GET /a\n  capture response as r'));
  assert.equal(report.tests[0]!.ok, false);
  assert.match(report.tests[0]!.error ?? '', /not a capturable value/);
  assert.match(report.tests[0]!.error ?? '', /capture body/);
});

// --- M128c: a passing negated assertion lists what it found ------------------

test('`not has no … violations` names the findings on its PASSING line', async () => {
  // The acceptance corpus in `testFlow-tests` is written in this form — it is how a "this rule must
  // fire" case is expressed as a green test — and until M128c its pass line said only `has 2 critical
  // security violations`. The one fact the assertion exists to establish was therefore absent from
  // the console, from `report.html` and from `results.json` alike, so nothing downstream could
  // recover it. Found by writing the grader that needed it.
  const report = await run({ '/a': bare }, T('  api GET /a\n  expect response not has no security violations'));
  const step = assertionStep(report);
  assert.equal(step.ok, true);
  assert.match(step.detail!, /has 1 security violation — 12 rules/);
  assert.match(step.detail!, /- \[moderate\] sec\/nosniff-missing:/);
});

test('the plain form\'s pass has nothing to list, and lists nothing', async () => {
  const hardened: Handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' }).end('{}');
  };
  const report = await run({ '/a': hardened }, T('  api GET /a\n  expect response has no security violations'));
  const step = assertionStep(report);
  assert.equal(step.ok, true);
  assert.doesNotMatch(step.detail!, /\n\s*- \[/);
});
