// Unit tests for checker.ts semantic checks that aren't config-dialect specific: named-service
// validation against the active env (P#29, SPEC §3.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkServices, checkSessionServices, checkDataTables, checkSessions, checkUnknownVariables } from '../src/index.js';

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

test('checkUnknownVariables: accepts an inline table column referenced in the test body (not just the name)', () => {
  const { program } = parseSource(`with each\n  | role  | email |\n  | "a"   | "b"   |\ntest "invite {role}"\n  api POST /invites body { role: {role}, email: {email} }\n`);
  assert.deepEqual(checkUnknownVariables(program), []);
});

test('checkUnknownVariables: accepts an action parameter referenced in its own body', () => {
  const { program } = parseSource(`action create order(name, qty)\n  api POST /orders body { name: {name}, qty: {qty} }\n  give name\n`);
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
