// Where an `authorization violations` assertion may stand (M130b, PLAN_M130B_AUTHZ_ENGINE.md
// D307/D315/D328/D329/D333, SPEC §9.11).
//
// Four rules, four codes, and the split is by **repair** rather than by topic — the rule that split
// `TF003` and kept `TF047` whole:
//
//   TF062  stop naming the credential on the step
//   TF063  declare an identity — a `test … as <session>`, or a session that is not `privileged`
//   TF064  move it off `wait until api`
//   TF033  move it out of a workload-bearing test
//
// Every rule here is *half* of a pair. The interpreter repeats each judgement at run time with the
// executing test in hand, because calls bind late — so the tests below assert as carefully on what
// this pass stays **silent** about (an `action` body, a bare `before` hook) as on what it reports.
// A checker that answered confidently inside an `action` would refuse the language's only unit of
// reuse; one that stayed silent everywhere would give up the pre-flight answer entirely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, parseSource, checkAuthzAssertions, checkProgram, identityCensus, Codes, type ProgramCheckOptions } from '../src/index.js';

const ASSERT = 'expect response has no authorization violations';

function codes(source: string, opts: ProgramCheckOptions = {}): string[] {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkAuthzAssertions(program, opts).map((d) => d.code);
}

function firstDiag(source: string, opts: ProgramCheckOptions = {}) {
  const { program } = parseSource(source);
  return checkAuthzAssertions(program, opts)[0];
}

/** A test body, with an owner unless one is asked for otherwise — so a fixture aimed at one rule
 *  does not quietly also trip `TF063` and pass for the wrong reason. */
const owned = (...steps: string[]): string => `test "t" as shopper\n${steps.map((s) => `  ${s}`).join('\n')}\n`;

// --- the ordinary shape, which must stay quiet --------------------------------------------------

test('an owned test asserting on a plain `api` step reports nothing', () => {
  // The negative control for every rule in this file. If this ever goes red, one of the four rules
  // below has widened into the case the feature exists for.
  assert.deepEqual(codes(owned('api GET /orders/1', ASSERT)), []);
});

test('the `check` form is the same assertion and is judged the same way', () => {
  assert.deepEqual(codes(`test "t"\n  api GET /orders/1\n  check response has no authorization violations\n`), [Codes.AUTHZ_ASSERTION_NO_PRINCIPAL]);
});

test('a security assertion in the same position is untouched — Tier 1 is frozen by this milestone', () => {
  // D304 chose a separate matcher precisely so that no shipped Tier 1 assertion changes behaviour
  // on upgrade. An ownerless test with a `security violations` assertion was legal before M130b and
  // has to stay legal, or this milestone broke every suite that has one.
  assert.deepEqual(codes(`test "t"\n  api GET /orders/1\n  expect response has no security violations\n`), []);
});

// --- TF062: the step names its own credential (D328) --------------------------------------------

test('TF062: a literal `Authorization` header on the judged step is refused', () => {
  const d = firstDiag(owned('api GET /orders/1', '  header "Authorization" is "Bearer x"', ASSERT));
  assert.equal(d?.code, Codes.AUTHZ_STEP_NAMES_OWN_CREDENTIAL);
  assert.match(d!.message, /names its own `Authorization` header/);
});

test('TF062: a literal `Cookie` header is the same rule', () => {
  assert.deepEqual(codes(owned('api GET /orders/1', '  header "Cookie" is "sid=x"', ASSERT)), [Codes.AUTHZ_STEP_NAMES_OWN_CREDENTIAL]);
});

test('TF062: the header name is matched case-insensitively', () => {
  // The exact assumption `M128`'s `sec/authenticated-response-cacheable` got wrong, where it cost a
  // rule that fired for nobody while its unit tests passed. Here the cost runs the other way: a
  // lowercase `authorization` slipping through sends a probe carrying the owner's own token.
  assert.deepEqual(codes(owned('api GET /orders/1', '  header "authorization" is "Bearer x"', ASSERT)), [Codes.AUTHZ_STEP_NAMES_OWN_CREDENTIAL]);
});

test('TF062: an unrelated header on the step is not a credential', () => {
  assert.deepEqual(codes(owned('api GET /orders/1', '  header "X-Trace" is "abc"', ASSERT)), []);
});

test('TF062: an interpolated header NAME is skipped rather than guessed at', () => {
  // This rule refuses a file, so being wrong here refuses a correct one. `{h}` may or may not be
  // `Authorization` and the checker cannot know which.
  assert.deepEqual(codes(`test "t" as shopper\n  let h = "X-Trace"\n  api GET /orders/1\n    header "{h}" is "abc"\n  ${ASSERT}\n`), []);
});

test('TF062: only the NEAREST preceding `api` step counts', () => {
  // The assertion judges one request. A credential on an earlier, unrelated step is not on the
  // request being probed, and reporting it would refuse a file for a step the rule is not about.
  const before = owned('api POST /auth/login', '  header "Authorization" is "Bearer x"', 'api GET /orders/1', ASSERT);
  assert.deepEqual(codes(before), []);
});

test('TF062: a credential on a `wait until api` request is read too — it is still the judged request', () => {
  const src = `test "t" as shopper\n  wait until api GET /orders/1\n    header "Authorization" is "Bearer x"\n    expect status equals 200\n  ${ASSERT}\n`;
  assert.deepEqual(codes(src), [Codes.AUTHZ_STEP_NAMES_OWN_CREDENTIAL]);
});

// --- TF063: no principal to judge with (D307, D329) ---------------------------------------------

test('TF063: a test with no `as <session>` is refused', () => {
  const d = firstDiag(`test "t"\n  api GET /orders/1\n  ${ASSERT}\n`);
  assert.equal(d?.code, Codes.AUTHZ_ASSERTION_NO_PRINCIPAL);
  assert.match(d!.message, /needs an owner/);
});

test('TF063: `before file` and `after file` hooks can never have an owner', () => {
  for (const when of ['before', 'after']) {
    const src = `${when} file\n  api GET /orders/1\n  ${ASSERT}\n`;
    const d = firstDiag(src);
    assert.equal(d?.code, Codes.AUTHZ_ASSERTION_NO_PRINCIPAL, `${when} file`);
    assert.match(d!.hint ?? '', /isolated from every test/);
  }
});

test('TF063: a bare `before`/`after` hook is silent — it shares the wrapped test\'s scope', () => {
  // Not an exemption. The owner is the *test's* `as`, which this pass cannot see from the hook, so
  // the judgement moves to the interpreter rather than being guessed at or refused. (There is no
  // `before each` keyword — a bare `before` is the per-test hook, GRAMMAR.md § Tests.)
  for (const when of ['before', 'after']) {
    assert.deepEqual(codes(`${when}\n  api GET /orders/1\n  ${ASSERT}\n`), [], when);
  }
});

test('TF063: an `action` body is silent, and that is D328/D329\'s whole shape', () => {
  // Calls bind late against the entry file's registry (`checker.ts:885` already draws this line for
  // call resolution). Refusing here would forbid writing a shared authorization check once and
  // reusing it — so the runtime backstop answers instead, with the executing test in hand.
  assert.deepEqual(codes(`action check ownership()\n  api GET /orders/1\n  ${ASSERT}\n`), []);
});

test('TF063: every declared session being `privileged` leaves nothing to probe with', () => {
  const opts = { knownSessions: ['admin', 'svc'], privilegedSessions: ['admin', 'svc'] };
  const d = firstDiag(owned('api GET /orders/1', ASSERT), opts);
  assert.equal(d?.code, Codes.AUTHZ_ASSERTION_NO_PRINCIPAL);
  assert.match(d!.message, /every declared `session` is `privileged`/);
  // The hint has to say what `privileged` means, not just that it is set — the cheapest way to make
  // a slow authz assertion fast would otherwise be to declare the measurement away.
  assert.match(d!.hint ?? '', /meant\* to reach other principals|meant. to reach other principals/);
});

test('TF063: one un-privileged session is enough, and anonymous alone is not', () => {
  assert.deepEqual(codes(owned('api GET /orders/1', ASSERT), { knownSessions: ['admin', 'peer'], privilegedSessions: ['admin'] }), []);
});

test('TF063: the privileged door needs a resolved config, and stays shut without one', () => {
  // `undefined` means nobody looked — the same rule every other option field in `checker.ts`
  // follows. Guessing here would light up every authorization assertion in the docs-site editor
  // demo, which runs in a browser where no `tflw.config` can exist even in principle.
  assert.deepEqual(codes(owned('api GET /orders/1', ASSERT), { privilegedSessions: ['admin'] }), []);
  assert.deepEqual(codes(owned('api GET /orders/1', ASSERT), { knownSessions: [], privilegedSessions: [] }), []);
});

// --- TF064: a construct that re-runs its request (D315) -----------------------------------------

test('TF064: inside `wait until api`, because a real finding would be reported as a timeout', () => {
  const src = `test "t" as shopper\n  wait until api GET /orders/1\n    expect status equals 200\n    ${ASSERT}\n`;
  const d = firstDiag(src);
  assert.equal(d?.code, Codes.AUTHZ_ASSERTION_REPEATED_REQUEST);
  assert.match(d!.hint ?? '', /reported as a timeout/);
});

test('TF064: a `security violations` assertion in the same position is untouched', () => {
  // Tier 1 reads a response the suite already asked for; re-reading it per poll costs nothing and
  // reports nothing new. The restriction belongs to the scan that *originates* requests.
  const src = `test "t"\n  wait until api GET /orders/1\n    expect status equals 200\n    expect response has no security violations\n`;
  assert.deepEqual(codes(src), []);
});

// --- TF033: inside a workload-bearing test (D315) -----------------------------------------------

// A `test` becomes workload-bearing the moment its block contains a workload line (D93-D96) —
// there is no `load`/`scenario` keyword.
const WORKLOAD = 'test "t" as shopper\n  run 5 iterations across 2 users\n  threshold error rate is less than 1%\n';

test('TF033: inside a workload, beside `browser steps aren\'t supported` — same construct, same fix', () => {
  const d = firstDiag(`${WORKLOAD}  api GET /orders/1\n  ${ASSERT}\n`);
  assert.equal(d?.code, Codes.LOAD_INVALID);
  assert.match(d!.hint ?? '', /multiplies cross-identity traffic/);
});

test('TF033: the workload rule does not also fire TF063 for a workload with an owner', () => {
  assert.deepEqual(codes(`${WORKLOAD}  api GET /orders/1\n  ${ASSERT}\n`), [Codes.LOAD_INVALID]);
});

test('TF033: a functional test with the same body is fine', () => {
  assert.deepEqual(codes(owned('api GET /orders/1', ASSERT)), []);
});

// --- D333: `anonymous` is reserved ---------------------------------------------------------------

test('D333: `session anonymous` is a config error, under the duplicate-name code', () => {
  const { diagnostics } = parseConfigSource('env local default\n  api "http://x"\n\nsession anonymous\n  api GET /a\n');
  assert.deepEqual(diagnostics.map((d) => d.code), [Codes.CONFIG_SESSION_CONFLICT]);
  assert.match(diagnostics[0]!.message, /reserved principal name/);
});

test('D333: any other session name is fine, including one that merely contains it', () => {
  const { diagnostics } = parseConfigSource('env local default\n  api "http://x"\n\nsession anonymousUser\n  api GET /a\n');
  assert.deepEqual(diagnostics, []);
});

// --- D331: the identity census -------------------------------------------------------------------

test('D331: the census counts api steps in owned tests, and every api step as the denominator', () => {
  const src =
    'test "owned" as shopper\n  api GET /a\n  api GET /b\n' +
    '\ntest "anonymous"\n  api GET /c\n' +
    '\naction helper()\n  api GET /d\n' +
    '\nbefore file\n  api GET /e\n';
  const { program } = parseSource(src);
  assert.deepEqual(identityCensus(program), { apiSteps: 5, withOwner: 2 });
});

test('D331: `wait until api` is an api step, and a nested block is walked', () => {
  const src = 'test "t" as shopper\n  wait until api GET /a\n    expect status equals 200\n  within css ".x"\n    api GET /b\n';
  assert.deepEqual(identityCensus(program(src)), { apiSteps: 2, withOwner: 2 });
});

test('D331: a step inside an `action` lands in the denominator only — it under-claims on purpose', () => {
  // It runs under whichever test called it, which is a run-time fact. A census whose whole job is
  // to state a bound must err toward a *larger* stated blind spot, never a smaller one.
  assert.deepEqual(identityCensus(program('action a()\n  api GET /x\n')), { apiSteps: 1, withOwner: 0 });
});

function program(src: string) {
  const parsed = parseSource(src);
  assert.deepEqual(parsed.diagnostics, [], `fixture did not parse:\n${src}`);
  return parsed.program;
}

// --- composition ---------------------------------------------------------------------------------

test('the pass is wired into `checkProgram`, not merely exported', () => {
  // The failure this catches is the one M60 caught across the LSP and the CLI: a pass that exists,
  // is tested directly, and is composed into nothing anybody calls.
  const found = checkProgram(program(`test "t"\n  api GET /orders/1\n  ${ASSERT}\n`)).map((d) => d.code);
  assert.ok(found.includes(Codes.AUTHZ_ASSERTION_NO_PRINCIPAL), `expected TF063 from checkProgram, got ${found.join(', ')}`);
});

test('TF060 gates the authorization matcher too, and names the scan it refused', () => {
  const opts = { envAuthorizedTargets: { envName: 'local', targets: [], apiBaseUrl: 'https://localhost:8443/v1', services: [] } };
  const found = checkProgram(program(`test "t" as shopper\n  api GET /orders/1\n  ${ASSERT}\n`), opts);
  const gate = found.find((d) => d.code === Codes.SECURITY_ASSERTION_UNAUTHORIZED);
  assert.ok(gate, `expected TF060, got ${found.map((d) => d.code).join(', ')}`);
  assert.match(gate!.message, /^an authorization scan against/, 'a message that says "a security scan" about an authorization one is a wrong sentence, not a shared one');
});
