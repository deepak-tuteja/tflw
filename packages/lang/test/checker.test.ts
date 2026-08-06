// Unit tests for checker.ts semantic checks that aren't config-dialect specific: named-service
// validation against the active env (P#29, SPEC §3.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkServices, checkSessionServices, checkDataTables, checkSessions, checkUnknownVariables, checkRequestAssertions, checkActionDecls, checkProgram } from '../src/index.js';

test('checkServices: accepts a known named service', () => {
  const { program } = parseSource(`test "ok"\n  api billing GET /invoices/1\n  expect status equals 200\n`);
  const diags = checkServices(program, ['billing']);
  assert.deepEqual(diags, []);
});

test('checkServices: accepts the default (unnamed) service unconditionally', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect status equals 200\n`);
  const diags = checkServices(program, []);
  assert.deepEqual(diags, []);
});

test('checkServices: flags an undeclared service', () => {
  const { program } = parseSource(`test "bad"\n  api billin GET /invoices/1\n  expect status equals 200\n`);
  const diags = checkServices(program, ['billing']);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF026');
  assert.match(diags[0]!.message, /unknown api service "billin"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `billing`\?/);
});

test('checkServices: flags an undeclared service inside `wait until api`', () => {
  const { program } = parseSource(`test "bad"\n  wait until api billin GET /invoices/1\n    expect status equals 200\n`);
  const diags = checkServices(program, ['billing']);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /did you mean `billing`\?/);
});

test('checkServices: lists known services when no close match exists', () => {
  const { program } = parseSource(`test "bad"\n  api zzz GET /x\n  expect status equals 200\n`);
  const diags = checkServices(program, ['billing', 'shipping']);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /known services: billing, shipping/);
});

test('checkServices: also validates service references inside `action` bodies', () => {
  const { program } = parseSource(`action create invoice(name)\n  api billin POST /invoices body { name: {name} }\n  give name\n`);
  const diags = checkServices(program, ['billing']);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /did you mean `billing`\?/);
});

test('checkServices: also validates service references inside hook bodies', () => {
  const { program } = parseSource(`before file\n  api billin GET /health\n  expect status equals 200\n\ntest "ok"\n  api GET /health\n  expect status equals 200\n`);
  const diags = checkServices(program, ['billing']);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /did you mean `billing`\?/);
});

test('checkSessionServices: accepts a session step using a known named service (decision 66)', () => {
  const { config } = parseConfigSource(`env local default\n  api "http://localhost:3001"\n  api billing "http://localhost:3002"\n\nsession admin\n  api billing GET /health\n`);
  const diags = checkSessionServices(config.sessions, ['billing']);
  assert.deepEqual(diags, []);
});

test('checkSessionServices: flags an undeclared service inside a `session` block (decision 66)', () => {
  const { config } = parseConfigSource(`env local default\n  api "http://localhost:3001"\n\nsession admin\n  api billng POST /auth/login\n`);
  const diags = checkSessionServices(config.sessions, ['billing']);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF026');
  assert.match(diags[0]!.message, /unknown api service "billng"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `billing`\?/);
});

test('checkDataTables: accepts a `{col}` in the test name matching a declared inline column', () => {
  const { program } = parseSource(`with each\n  | role |\n  | "admin" |\ntest "invite {role}"\n  api GET /health\n`);
  const diags = checkDataTables(program);
  assert.deepEqual(diags, []);
});

test('checkDataTables: flags a `{col}` in the test name not among the declared columns', () => {
  const { program } = parseSource(`with each\n  | role |\n  | "admin" |\ntest "invite {rol}"\n  api GET /health\n`);
  const diags = checkDataTables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF027');
  assert.match(diags[0]!.message, /unknown table column "rol"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `role`\?/);
});

test('checkDataTables: does not check file-backed tables (columns unknown until the file is read)', () => {
  const { program } = parseSource(`with each from "./x.csv"\ntest "invite {anything}"\n  api GET /health\n`);
  const diags = checkDataTables(program);
  assert.deepEqual(diags, []);
});

test('checkDataTables: ignores a test with no table at all', () => {
  const { program } = parseSource(`test "plain"\n  api GET /health\n`);
  const diags = checkDataTables(program);
  assert.deepEqual(diags, []);
});

test('checkSessions: accepts a known session', () => {
  const { program } = parseSource(`test "ok" as admin\n  api GET /health\n`);
  const diags = checkSessions(program, ['admin']);
  assert.deepEqual(diags, []);
});

test('checkSessions: ignores a test with no `as` at all', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n`);
  const diags = checkSessions(program, []);
  assert.deepEqual(diags, []);
});

test('checkSessions: flags an undeclared session', () => {
  const { program } = parseSource(`test "bad" as admn\n  api GET /health\n`);
  const diags = checkSessions(program, ['admin']);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF028');
  assert.match(diags[0]!.message, /unknown session "admn"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `admin`\?/);
});

test('checkSessions: lists known sessions when no close match exists', () => {
  const { program } = parseSource(`test "bad" as zzz\n  api GET /health\n`);
  const diags = checkSessions(program, ['admin', 'guest']);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /known sessions: admin, guest/);
});

test('checkSessions: accepts a test opting into several known sessions at once', () => {
  const { program } = parseSource(`test "ok" as admin, userA\n  api GET /health\n`);
  const diags = checkSessions(program, ['admin', 'userA']);
  assert.deepEqual(diags, []);
});

test('checkSessions: flags only the unknown name(s) among several opted into, one diagnostic per bad name', () => {
  const { program } = parseSource(`test "bad" as admin, gohst\n  api GET /health\n`);
  const diags = checkSessions(program, ['admin', 'ghost']);
  assert.equal(diags.length, 1, 'the valid `admin` name must not also be flagged');
  assert.equal(diags[0]!.code, 'TF028');
  assert.match(diags[0]!.message, /unknown session "gohst"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `ghost`\?/);
});

test('checkSessions: flags every unknown name when a test opts into several bad ones', () => {
  const { program } = parseSource(`test "bad" as zzz, yyy\n  api GET /health\n`);
  const diags = checkSessions(program, ['admin']);
  assert.equal(diags.length, 2);
  assert.match(diags[0]!.message, /unknown session "zzz"/);
  assert.match(diags[1]!.message, /unknown session "yyy"/);
});

test('validateConfig: flags a duplicate `session` name', () => {
  const { diagnostics } = parseConfigSource(`env local default\n  api "http://localhost:3001"\n\nsession admin\n  api GET /health\n\nsession admin\n  api GET /health\n`);
  const sessionDiags = diagnostics.filter((d) => d.code === 'TF029');
  assert.equal(sessionDiags.length, 1);
  assert.match(sessionDiags[0]!.message, /duplicate session `admin`/);
});

// checkUnknownVariables (decision 57): a conservative pass over `{var}`/bare-identifier
// references, flagging one only when it's provably never bound anywhere reachable in its scope.

test('checkUnknownVariables: accepts a `let`-bound variable referenced later', () => {
  const { program } = parseSource(`test "ok"\n  let orderId = "123"\n  api GET /orders/{orderId}\n  expect status equals 200\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: accepts a `capture`d variable referenced later', () => {
  const { program } = parseSource(`test "ok"\n  api POST /orders body { name: "Widget" }\n  capture body.id as orderId\n  api GET /orders/{orderId}\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

// The static half of review finding `A4-06` (M95). `capture`'s subject is the same `Subject` node
// `expect`'s is, but until M95 `checkStepSequence`'s `CaptureStmt` case only bound the name and
// never looked at it — so `capture` was the one statement in the language whose subject nothing
// inspected, static or runtime. The asymmetry is the test: the same typo, in the same header
// literal, one line apart, had to produce the same diagnostic and did not. The runtime half — a
// subject that resolves to nothing at all — is in `packages/runtime/test/capture-nothing.test.ts`.

test('checkUnknownVariables: flags a typo\'d `{var}` in a `capture` header subject (A4-06)', () => {
  const { program } = parseSource(`test "bad"\n  api GET /x\n  capture header "X-{nope}" as v\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF030');
  assert.match(diags[0]!.message, /unknown variable "nope"/);
});

test('checkUnknownVariables: `capture` and `expect` report the same typo identically (A4-06)', () => {
  const capture = checkUnknownVariables(parseSource(`test "bad"\n  api GET /x\n  capture header "X-{nope}" as v\n`).program);
  const expect = checkUnknownVariables(parseSource(`test "bad"\n  api GET /x\n  expect header "X-{nope}" equals "1"\n`).program);
  assert.equal(capture.length, expect.length);
  assert.equal(capture[0]!.code, expect[0]!.code);
  assert.equal(capture[0]!.message, expect[0]!.message);
});

test('checkUnknownVariables: accepts a bound `{var}` in a `capture` subject (A4-06)', () => {
  const { program } = parseSource(`test "ok"\n  let which = "trace"\n  api GET /x\n  capture header "X-{which}" as v\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: a `capture` subject cannot see the name that `capture` itself binds (A4-06)', () => {
  // The check runs *before* `bound.add(step.name)`, matching `LetStmt` — a step never sees its own
  // not-yet-assigned name. Order-dependent, so it is the control for the two-line edit's ordering.
  const { program } = parseSource(`test "bad"\n  api GET /x\n  capture header "X-{v}" as v\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "v"/);
});

test('checkUnknownVariables: accepts an inline table column referenced in the test body (not just the name)', () => {
  const { program } = parseSource(`with each\n  | role  | email |\n  | "a"   | "b"   |\ntest "invite {role}"\n  api POST /invites body { role: {role}, email: {email} }\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: accepts an action parameter referenced in its own body', () => {
  const { program } = parseSource(`action create order(name, qty)\n  api POST /orders body { name: {name}, qty: {qty} }\n  give name\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: flags a typo\'d ref used as a bare CallStmt argument (M6)', () => {
  const { program } = parseSource(`test "bad"\n  let id = unique number\n  login(idd)\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF030');
  assert.match(diags[0]!.hint ?? '', /did you mean `id`\?/);
});

test('checkUnknownVariables: accepts a known ref used as a bare CallStmt argument (M6)', () => {
  const { program } = parseSource(`test "ok"\n  let id = unique number\n  login(id)\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: accepts `env(NAME)` unconditionally — not a `{var}` reference', () => {
  const { program } = parseSource(`test "ok"\n  api POST /login body { pass: env(ADMIN_PW) }\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: flags a typo\'d `{var}` in an api path, with a did-you-mean hint', () => {
  const { program } = parseSource(`test "bad"\n  api POST /orders body { name: "Widget" }\n  capture body.id as orderId\n  api GET /orders/{orderid}\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF030');
  assert.match(diags[0]!.message, /unknown variable "orderid"/);
});

test('checkUnknownVariables: flags a typo\'d `{var}` inside a body object field, with a did-you-mean hint', () => {
  const { program } = parseSource(`action create thing(name)\n  api POST /things body { name: {nam} }\n  give name\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "nam"/);
  assert.match(diags[0]!.hint ?? '', /did you mean `name`\?/);
});

test('checkUnknownVariables: flags a bare `VarRef` on the right side of `let`', () => {
  const { program } = parseSource(`test "bad"\n  let total = grandTotal\n  api GET /health\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "grandTotal"/);
});

test('checkUnknownVariables: accepts a well-shaped literal `upload … type "…"` (decision 22/M19)', () => {
  const { program } = parseSource(`test "ok"\n  api POST /uploads upload "./img.png" as "avatar" type "image/png"\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: flags a malformed literal `upload … type "…"` with TF032', () => {
  const { program } = parseSource(`test "bad"\n  api POST /uploads upload "./img.png" as "avatar" type "imagepng"\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF032');
  assert.match(diags[0]!.message, /invalid content type "imagepng"/);
});

test('checkUnknownVariables: skips the TF032 shape check for an interpolated `type "{var}"` — a runtime concern, not static', () => {
  const { program } = parseSource(`test "ok"\n  let mime = "image/png"\n  api POST /uploads upload "./img.png" as "avatar" type "{mime}"\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables (M4b): accepts a `{var}` inside `matches snapshot "<name>"` and inside a `mask <locator>`', () => {
  const { program } = parseSource(`test "ok"\n  let step = "checkout"\n  let region = ".timestamp"\n  expect page matches snapshot "{step}-page" mask css "{region}"\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables (M4b): flags a typo\'d `{var}` inside `matches snapshot "<name>"`', () => {
  const { program } = parseSource(`test "bad"\n  let step = "checkout"\n  expect page matches snapshot "{stp}-page"\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "stp"/);
});

test('checkUnknownVariables (M4b): flags a typo\'d `{var}` inside a `mask <locator>`', () => {
  const { program } = parseSource(`test "bad"\n  let region = ".timestamp"\n  expect page matches snapshot "checkout" mask css "{regoin}"\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "regoin"/);
});

test('checkUnknownVariables: still flags an unknown variable inside an interpolated `type "{var}"`', () => {
  const { program } = parseSource(`test "bad"\n  api POST /uploads upload "./img.png" as "avatar" type "{mimetype}"\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF030');
  assert.match(diags[0]!.message, /unknown variable "mimetype"/);
});

test('checkUnknownVariables: does not check a test with a file-backed table — its columns are unknown statically', () => {
  const { program } = parseSource(`with each from "./x.csv"\ntest "invite {role}"\n  api POST /invites body { role: {role}, email: {email} }\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: a `before`(each) hook\'s `let` is visible in the test body and its `after`(each) hook', () => {
  const { program } = parseSource(
    `before\n  let orderId = "123"\n\ntest "ok"\n  api GET /orders/{orderId}\n\nafter\n  api DELETE /orders/{orderId}\n`,
  );
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: one test\'s `let` is never visible in a different test (independent scopes)', () => {
  const { program } = parseSource(`test "a"\n  let orderId = "123"\n  api GET /health\n\ntest "b"\n  api GET /orders/{orderId}\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "orderId"/);
});

test('checkUnknownVariables: a `before file`/`after file` hook has its own isolated scope, shared with no test', () => {
  const { program } = parseSource(`before file\n  let token = "abc"\n  api GET /health\n\ntest "ok"\n  api GET /orders/{token}\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1, 'a file hook\'s `let` must not leak into a test body');
  assert.match(diags[0]!.message, /unknown variable "token"/);
});

test('checkProgram: diagnostics come back in source order, not grouped by pass (A4-14)', () => {
  // Composed output used to be ordered by *check function*, so `tflw check` printed a line-9 error
  // above a line-8 one and the LSP's problem panel listed them the same way — this file's internal
  // structure leaking into every consumer.
  // Control: drop the `byPosition` wrapper and this comes back [30, 42, 37] — pass order, which is
  // three errors reported in three different orders from the one a reader reads them in.
  const { program } = parseSource(
    `test "t"\n  api GET /health\n  expect status is visible\n  expect body.x equals {nope}\n  get thing()\n`,
  );
  const diags = checkProgram(program);
  assert.deepEqual(
    diags.map((d) => d.span.start.line),
    [...diags.map((d) => d.span.start.line)].sort((a, b) => a - b),
  );
  assert.ok(diags.length >= 3, `expected several diagnostics to order, got ${diags.length}`);
});

// ---- `A4-05` (M97b, D139): file hooks group by `when`, not by `scope` ------
//
// Three tests, and the middle one is why the obvious fix is wrong. Merging all file hooks into one
// shared set would make the first pass and the second fail — trading a false positive for a false
// negative on code that genuinely breaks at run time.

test('checkUnknownVariables: a second `before file` sees the first\'s bindings (A4-05)', () => {
  // The filed repro. `runFileHooks` threads one scope through every hook of one label, so this runs
  // correctly — and the checker used to hand each hook a fresh empty set and call it unknown.
  // Control: on reverted source this returns 1 diagnostic, `unknown variable "token"`.
  const { program } = parseSource(
    `before file\n  let token = "abc"\n  api GET /health\n\nbefore file\n  api GET /orders/{token}\n\ntest "ok"\n  api GET /health\n`,
  );
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: `after file` still cannot see a `before file` binding (A4-05)', () => {
  // The true positive the over-strict version caught by accident, kept deliberately. `runFileHooks`
  // is called twice with a fresh `scope` each time, so this really is unresolvable.
  // Control: use one shared set for all file hooks — the natural over-correction — and this
  // silently returns [], which is the false negative D139 exists to refuse.
  const { program } = parseSource(
    `before file\n  let token = "abc"\n  api GET /health\n\nafter file\n  api GET /orders/{token}\n\ntest "ok"\n  api GET /health\n`,
  );
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "token"/);
});

test('checkUnknownVariables: a second `after file` sees the first\'s bindings too (A4-05)', () => {
  // The same rule on the other label — `runFileHooks` does not care which one it was handed.
  // Control: split on `when === 'before'` only and this stays broken while the first test passes.
  const { program } = parseSource(
    `after file\n  let token = "abc"\n  api GET /health\n\nafter file\n  api GET /orders/{token}\n\ntest "ok"\n  api GET /health\n`,
  );
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: an action\'s own scope never sees a caller\'s or another action\'s variables', () => {
  const { program } = parseSource(
    `action create order(name)\n  api POST /orders body { name: {name} }\n  give name\n\naction other()\n  api GET /orders/{name}\n  give true\n`,
  );
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "name"/);
});

test('checkUnknownVariables: checks a header subject\'s interpolated name and a `wait until api`\'s nested expects', () => {
  const { program } = parseSource(
    `test "bad"\n  api GET /health\n  expect header "{missingHeader}" equals "1"\n  wait until api GET /orders/{alsoMissing}\n    expect status equals 200\n`,
  );
  const diags = checkUnknownVariables(program);
  const messages = diags.map((d) => d.message).sort();
  assert.deepEqual(messages, ['unknown variable "alsoMissing"', 'unknown variable "missingHeader"']);
});

test('checkUnknownVariables: a broken `before`(each) hook shared by two tests is reported once, not once per test', () => {
  const { program } = parseSource(`before\n  api GET /orders/{ghost}\n\ntest "a"\n  api GET /health\n\ntest "b"\n  api GET /health\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1, 'the same broken hook reference must be deduped, not reported per test');
  assert.match(diags[0]!.message, /unknown variable "ghost"/);
});

test('parser: rejects a bare `header` step outside a session block', () => {
  const { diagnostics } = parseSource(`test "bad"\n  header "X" is "1"\n`);
  assert.ok(diagnostics.length > 0, 'expected a diagnostic — `header` is only valid inside a `session` block');
});

test('checkRequestAssertions: accepts a bare `request connects`/`fails`', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request connects\n\ntest "also ok"\n  api GET /health\n  expect request fails\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: accepts `fails matching "text"` and `not connects`', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request fails matching "certificate"\n\ntest "also ok"\n  api GET /health\n  expect request not connects\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: flags a status assertion mixed with `request fails` on the same request', () => {
  const { program } = parseSource(`test "bad"\n  api GET /health\n  expect request fails\n  expect status equals 200\n`);
  const diags = checkRequestAssertions(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF031');
  assert.match(diags[0]!.message, /`expect status` can't be combined with `request connects`\/`fails`/);
});

test('checkRequestAssertions: flags every non-request assertion in the run, regardless of order', () => {
  const { program } = parseSource(`test "bad"\n  api GET /health\n  expect status equals 200\n  expect request connects\n  expect body.ok equals true\n`);
  const diags = checkRequestAssertions(program);
  assert.equal(diags.length, 2);
  const messages = diags.map((d) => d.message).sort();
  assert.match(messages[0]!, /`expect body`/);
  assert.match(messages[1]!, /`expect status`/);
});

test('checkRequestAssertions: a request-only run is fine even across several expects', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request connects\n  expect request not fails\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: two separate `api` calls each get their own clean group', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request fails\n  api GET /other\n  expect status equals 200\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: a `request to "…" was made` (M3d) is exempt from the connects/fails mixing rule — reads the browser network log, not this api step\'s response', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request fails\n  expect request to "/api/orders" was made\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: `page has no … a11y violations` (M3e) is likewise exempt — reads the page\'s DOM, not this api step\'s response', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request connects\n  expect page has no critical a11y violations\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: `page matches snapshot "…"` (M4b) is likewise exempt — reads the page, not this api step\'s response', () => {
  const { program } = parseSource(`test "ok"\n  api GET /health\n  expect request connects\n  expect page matches snapshot "checkout"\n`);
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('checkRequestAssertions: also validates inside `action`/`hook` bodies', () => {
  const { program: actionProgram } = parseSource(`action ping()\n  api GET /health\n  expect request fails\n  expect status equals 200\n  give true\n`);
  assert.equal(checkRequestAssertions(actionProgram).length, 1);

  const { program: hookProgram } = parseSource(`before file\n  api GET /health\n  expect request fails\n  expect status equals 200\n\ntest "ok"\n  api GET /health\n  expect status equals 200\n`);
  assert.equal(checkRequestAssertions(hookProgram).length, 1);
});

test('checkRequestAssertions: rejects a `request` assertion inside `wait until api`', () => {
  const { program } = parseSource(`test "bad"\n  wait until api GET /health\n    expect request connects\n`);
  const diags = checkRequestAssertions(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF031');
  assert.match(diags[0]!.message, /not supported inside `wait until api`/);
});

// ---- M3a: browser steps (SPEC §9) — variable-binding walk + recursion into `within` -----------

test('checkUnknownVariables: flags an unknown `{var}` inside a locator name', () => {
  const { program } = parseSource(`test "bad"\n  click button "Remove {itemName}"\n`);
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF030');
});

test('checkUnknownVariables: accepts a `{var}` inside a locator name once it is `let`-bound', () => {
  const { program } = parseSource(`test "ok"\n  let itemName = "Widget"\n  click button "Remove {itemName}"\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: recurses into a `within` block body, sharing the enclosing scope', () => {
  const bad = parseSource(`test "bad"\n  within list "Cart items"\n    fill field "Qty" with {qty}\n`).program;
  assert.equal(checkUnknownVariables(bad).length, 1);

  const ok = parseSource(`test "ok"\n  let qty = 2\n  within list "Cart items"\n    fill field "Qty" with {qty}\n`).program;
  assert.deepEqual(checkUnknownVariables(ok), []);

  // A `let` bound *inside* the block stays visible to steps that follow it, same as any other
  // nested block in this checker (WithinBlock is a resolution scope, not a variable scope).
  const insideThenAfter = parseSource(
    `test "ok"\n  within list "Cart items"\n    let qty = 2\n    fill field "Qty" with {qty}\n  expect field "Total" has value {qty}\n`,
  ).program;
  assert.deepEqual(checkUnknownVariables(insideThenAfter), []);
});

test('checkServices: validates `api <service>` references nested inside a `within` block', () => {
  const { program } = parseSource(`test "bad"\n  within list "Cart items"\n    api billing GET /health\n`);
  const diags = checkServices(program, ['shipping']);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF026');
});

test('checkRequestAssertions: validates an `api`+`expect request` pair nested inside a `within` block', () => {
  const { program } = parseSource(`test "bad"\n  within list "Cart items"\n    api GET /health\n    expect request connects\n    expect status equals 200\n`);
  const diags = checkRequestAssertions(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF031');
});

// ---- M3b: frames / tabs / downloads / drag-drop / wait until <ui> -----------------------------

test('checkUnknownVariables: flags an unknown `{var}` inside `drag …to…`\'s from/to locator names', () => {
  const fromBad = parseSource(`test "bad"\n  drag text "{missing} item" to text "Second item"\n`).program;
  assert.equal(checkUnknownVariables(fromBad).length, 1);
  const toBad = parseSource(`test "bad"\n  drag text "First item" to text "{missing} item"\n`).program;
  assert.equal(checkUnknownVariables(toBad).length, 1);
  const ok = parseSource(`test "ok"\n  let n = "Second"\n  drag text "First item" to text "{n} item"\n`).program;
  assert.deepEqual(checkUnknownVariables(ok), []);
});

test('checkUnknownVariables: flags an unknown `{var}` inside `drop file … onto …`\'s path and locator', () => {
  const pathBad = parseSource(`test "bad"\n  drop file "{missing}.png" onto css "#dropzone"\n`).program;
  assert.equal(checkUnknownVariables(pathBad).length, 1);
  const locatorBad = parseSource(`test "bad"\n  drop file "./f.png" onto css "{missing}"\n`).program;
  assert.equal(checkUnknownVariables(locatorBad).length, 1);
});

test('checkUnknownVariables: flags an unknown `{var}` inside `wait until <locator> <matcher>`', () => {
  const bad = parseSource(`test "bad"\n  wait until field "Qty" has value {qty}\n`).program;
  assert.equal(checkUnknownVariables(bad).length, 1);
  const ok = parseSource(`test "ok"\n  let qty = "2"\n  wait until field "Qty" has value {qty}\n`).program;
  assert.deepEqual(checkUnknownVariables(ok), []);
});

test('checkUnknownVariables: recurses into `switch to new tab`\'s block body, sharing the enclosing scope', () => {
  const bad = parseSource(`test "bad"\n  switch to new tab\n    fill field "Qty" with {qty}\n`).program;
  assert.equal(checkUnknownVariables(bad).length, 1);
  const ok = parseSource(`test "ok"\n  let qty = 2\n  switch to new tab\n    fill field "Qty" with {qty}\n`).program;
  assert.deepEqual(checkUnknownVariables(ok), []);
});

test('checkUnknownVariables: `download as <name>` binds `name` for steps after the block', () => {
  const { program } = parseSource(`test "ok"\n  download as file\n    click text "Download report"\n  expect field "Filename" has value {file}\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkServices: validates `api <service>` references nested inside `switch to new tab` and `download` blocks', () => {
  const tab = parseSource(`test "bad"\n  switch to new tab\n    api billing GET /health\n`).program;
  assert.equal(checkServices(tab, ['shipping']).length, 1);
  const download = parseSource(`test "bad"\n  download as file\n    api billing GET /health\n`).program;
  assert.equal(checkServices(download, ['shipping']).length, 1);
});

test('checkRequestAssertions: validates an `api`+`expect request` pair nested inside `switch to new tab` and `download` blocks', () => {
  const tab = parseSource(`test "bad"\n  switch to new tab\n    api GET /health\n    expect request connects\n    expect status equals 200\n`).program;
  assert.equal(checkRequestAssertions(tab).length, 1);
  const download = parseSource(`test "bad"\n  download as file\n    api GET /health\n    expect request connects\n    expect status equals 200\n`).program;
  assert.equal(checkRequestAssertions(download).length, 1);
});

// -- M60 (A2-01): action names are unique within a file ---------------------------------------

test('checkActionDecls: two actions with the same name is flagged (TF035) at the second declaration', () => {
  const { program, diagnostics } = parseSource('action fetch it()\n  give 1\n\naction fetch it()\n  give 2\n\ntest "t"\n  fetch it()\n');
  assert.deepEqual(diagnostics, [], 'the duplicate is a semantic error, not a parse error — the file still parses');
  const diags = checkActionDecls(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF035');
  assert.match(diags[0]!.message, /duplicate action "fetch it"/);
  assert.deepEqual(diags[0]!.span, program.actions[1]!.span, 'reported at the duplicate, not the original');
  assert.match(diags[0]!.hint ?? '', /already declared at line 1/);
});

// -- `B5-02` half 1 (M97b, D143): TF035 covers the imported case the runtime always refused ------
//
// The finding stated D138's thesis before it was adopted: `spec-data.ts` documented `TF035` as "two
// `action`s in one file share a name", which was exactly as narrow as the implementation — so the
// manifest, the checker and this test all agreed with each other and all missed what
// `buildRegistry` enforces. `tflw run` has always refused to start on these.

const imported = (name: string, from: string, arity = 0) => ({ name, arity, from });

test('checkActionDecls: a local action colliding with an imported one is flagged (B5-02)', () => {
  // Control: on reverted source this returns [] — and `tflw run` then dies at registry-build time
  // with `duplicate action "login" (imported from "./shared/auth.tflw")`, before any test runs.
  const { program } = parseSource('import "./shared/auth.tflw"\n\naction login()\n  give 1\n\ntest "t"\n  login()\n');
  const diags = checkActionDecls(program, { importedActions: [imported('login', './shared/auth.tflw')] });
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF035');
  assert.match(diags[0]!.message, /duplicate action "login" \(imported from "\.\/shared\/auth\.tflw"\)/);
  assert.deepEqual(diags[0]!.span, program.imports[0]!.span, 'reported at the `import`, which is the line that brought the collision in');
  assert.match(diags[0]!.hint ?? '', /already declared at line 3/);
});

test('checkActionDecls: two imports providing the same name is flagged (B5-02)', () => {
  // `resolveImportedActions` deliberately does not dedupe — its own doc says a cross-file duplicate
  // is "`TF035`'s business, not this function's". Until now nothing took it up on that.
  // Control: on reverted source, [].
  const { program } = parseSource('import "./a.tflw"\nimport "./b.tflw"\n\ntest "t"\n  api GET /health\n');
  const diags = checkActionDecls(program, {
    importedActions: [imported('login', './a.tflw'), imported('login', './b.tflw')],
  });
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /already declared by `import "\.\/a\.tflw"`/);
  assert.deepEqual(diags[0]!.span, program.imports[1]!.span, 'reported at the second import');
});

test('checkActionDecls: an unresolved import world reports no imported duplicate (B5-02)', () => {
  // The `undefined`-vs-`[]` rule, and the soundness half of this change. `undefined` means the
  // imports were never read — a name cannot be a duplicate of something nobody looked at, and
  // guessing here would be a false positive in the one direction clause 1 forbids.
  //
  // Honest note on the control, because the first one written for this was wrong: today the two
  // cases coincide *structurally* — with `undefined` there is nothing to iterate, so removing the
  // explicit guard changes no behaviour, and a control that mutates the guard does not fail. This
  // test is therefore not a control on the guard; it pins the *contract*, and it fails the day
  // someone gives the unresolved case a fallback world to compare against (reading the filesystem
  // here, or defaulting to a cached registry). That is the change worth catching, and it is the
  // only one this can catch.
  const { program } = parseSource('import "./shared/auth.tflw"\n\naction login()\n  give 1\n\ntest "t"\n  login()\n');
  assert.deepEqual(checkActionDecls(program, {}), []);
  assert.deepEqual(checkActionDecls(program, { importedActions: [] }), []);
});

test('checkActionDecls: an imported name that collides with nothing is never flagged (B5-02)', () => {
  const { program } = parseSource('import "./shared/auth.tflw"\n\naction checkout()\n  give 1\n\ntest "t"\n  checkout()\n');
  assert.deepEqual(checkActionDecls(program, { importedActions: [imported('login', './shared/auth.tflw')] }), []);
});

test('checkActionDecls: distinct action names, and a name shared with a test, are never flagged', () => {
  const { program } = parseSource('action a()\n  give 1\n\naction b()\n  give 2\n\ntest "a"\n  api GET /health\n');
  assert.deepEqual(checkActionDecls(program), []);
});

test('checkActionDecls: three actions where two share a name flags exactly one diagnostic', () => {
  const { program } = parseSource('action a()\n  give 1\n\naction b()\n  give 2\n\naction a()\n  give 3\n');
  const diags = checkActionDecls(program);
  assert.equal(diags.length, 1);
  assert.deepEqual(diags[0]!.span, program.actions[2]!.span);
});

// -- M60: `checkProgram` composes every per-file pass ------------------------------------------
//
// The point of this test is coverage of the *list*, not of any one rule: the CLI, the language
// server, and the docs-site editor demo each used to assemble their own, and had drifted to 6, 4,
// and 1 pass respectively. A new pass that isn't added to `checkProgram` fails here.

test('checkProgram: reports a diagnostic from every pass it composes, given one file that breaks all of them', () => {
  const source = [
    'action dup()',
    '  give 1',
    '',
    'action dup()',                                             // TF035 — checkActionDecls
    '  give 2',
    '',
    'with each',
    '  | n |',
    '  | 1 |',
    'test "row {nope}"',                                        // TF027 — checkDataTables
    '  api ghost GET /a/{missing}',                             // TF026 — checkServices, TF030 — checkUnknownVariables
    '  expect request connects',                                // TF031 — checkRequestAssertions
    '  expect status equals 200',
    '',
    'test "load" as nosuch',                                    // TF028 — checkSessions
    '  ramp to 1 users over 1s',                                // TF033 — checkWorkloadTests (no threshold)
    '  api GET /health',
    '',
  ].join('\n');
  const { program } = parseSource(source);
  const codes = new Set(checkProgram(program, { knownServices: [], knownSessions: [] }).map((d) => d.code));
  for (const expected of ['TF026', 'TF027', 'TF028', 'TF030', 'TF031', 'TF033', 'TF035']) {
    assert.ok(codes.has(expected), `checkProgram dropped the pass that reports ${expected}; got ${[...codes].join(', ')}`);
  }
});

test('checkProgram: omitting knownServices/knownSessions skips those two passes rather than checking against nothing', () => {
  // The docs-site editor demo's case: a browser has no `tflw.config` even in principle, so a named
  // service is unresolvable rather than wrong. Everything a single file can be judged on alone
  // still runs.
  const { program } = parseSource('test "t" as admin\n  api billing GET /invoices/1\n  expect status equals 200\n');
  assert.deepEqual(checkProgram(program), []);
  const codes = checkProgram(program, { knownServices: [], knownSessions: [] }).map((d) => d.code).sort();
  assert.deepEqual(codes, ['TF026', 'TF028'], 'an empty list means "resolved, declares none" — that *is* checkable');
});
