// Unit tests for symbols.ts (PLAN_M13_LSP.md Phase 1): def/ref collection for hover/go-to-def/
// rename, and the `findIdentifierSpans` helper that recovers per-element spans for the AST's
// no-per-element-span list fields (TestDecl.sessions/ActionDecl.params/InlineDataTable.columns).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, collectSymbols, collectConfigSymbols, findIdentifierSpans, type Span } from '../src/index.js';

/** Ground truth for a span, computed independently of the lexer/parser by a plain string scan —
 * so these tests actually verify `symbols.ts`'s offsetting, not just agree with it. */
function posOf(source: string, needle: string, occurrence = 1): { offset: number; line: number; column: number } {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = source.indexOf(needle, idx + 1);
    if (idx === -1) throw new Error(`"${needle}" occurrence ${occurrence} not found in source`);
  }
  const before = source.slice(0, idx);
  const lastNewline = before.lastIndexOf('\n');
  return { offset: idx, line: before.split('\n').length, column: idx - lastNewline };
}

function assertSpanAt(span: Span, source: string, needle: string, occurrence = 1): void {
  const expected = posOf(source, needle, occurrence);
  assert.equal(span.start.offset, expected.offset, `start offset of "${needle}"`);
  assert.equal(span.start.line, expected.line, `start line of "${needle}"`);
  assert.equal(span.start.column, expected.column, `start column of "${needle}"`);
  assert.equal(span.end.offset, expected.offset + needle.length, `end offset of "${needle}"`);
}

test('collectSymbols: let def + a later VarRef resolve to the same span', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'orderId');
  assert.ok(def, 'expected an `orderId` def');
  assertSpanAt(def!.span, source, 'orderId', 1);

  const ref = table.refs.find((r) => r.kind === 'variable' && r.name === 'orderId');
  assert.ok(ref, 'expected an `orderId` ref from the interpolated path');
  assertSpanAt(ref!.span, source, 'orderId', 2); // just the identifier inside `{...}`, not the whole path
  assert.deepEqual(ref!.defSpan, def!.span);
});

test('collectSymbols: capture def + a later VarRef resolve to the same span', () => {
  const source = `test "ok"\n  api GET /health\n  capture status as httpStatus\n  let copy = httpStatus\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'httpStatus');
  assert.ok(def, 'expected an `httpStatus` def');
  assertSpanAt(def!.span, source, 'httpStatus', 1);

  const ref = table.refs.find((r) => r.kind === 'variable' && r.name === 'httpStatus');
  assert.ok(ref, 'expected an `httpStatus` ref from `let copy = httpStatus`');
  assertSpanAt(ref!.span, source, 'httpStatus', 2);
  assert.deepEqual(ref!.defSpan, def!.span);
});

test('collectSymbols: action params def + refs (interpolation + `give`), findIdentifierSpans round-trip', () => {
  const source = `action create order(customerName, amount)\n  api POST /orders body { customer: {customerName}, qty: {amount} }\n  give customerName\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const customerDef = table.defs.find((d) => d.kind === 'param' && d.name === 'customerName');
  const amountDef = table.defs.find((d) => d.kind === 'param' && d.name === 'amount');
  assert.ok(customerDef && amountDef);
  assertSpanAt(customerDef!.span, source, 'customerName', 1);
  assertSpanAt(amountDef!.span, source, 'amount', 1);

  const customerRefs = table.refs.filter((r) => r.kind === 'variable' && r.name === 'customerName');
  assert.equal(customerRefs.length, 2, 'the `{customerName}` interpolation + the `give customerName` VarRef');
  for (const ref of customerRefs) assert.deepEqual(ref.defSpan, customerDef!.span);

  const amountRefs = table.refs.filter((r) => r.kind === 'variable' && r.name === 'amount');
  assert.equal(amountRefs.length, 1);
  assert.deepEqual(amountRefs[0]!.defSpan, amountDef!.span);

  // Direct findIdentifierSpans round-trip against the 2-param action header (task's stated case).
  const action = program.actions[0]!;
  const headerEnd = action.body[0]!.span.start;
  const spans = findIdentifierSpans(source, { start: action.span.start, end: headerEnd }, action.params);
  assert.equal(spans.length, 2);
  action.params.forEach((p, i) => assertSpanAt(spans[i]!, source, p, 1));
});

test('findIdentifierSpans: locates a 3-param action header in order', () => {
  const source = `action create order(customerName, amount, note)\n  give customerName\n`;
  const { program } = parseSource(source);
  const action = program.actions[0]!;
  const headerEnd = action.body[0]!.span.start;
  const spans = findIdentifierSpans(source, { start: action.span.start, end: headerEnd }, action.params);
  assert.equal(spans.length, 3);
  action.params.forEach((p, i) => assertSpanAt(spans[i]!, source, p, 1));
});

test('collectSymbols + findIdentifierSpans: `as admin, userA` sessions are refs with precise spans', () => {
  const source = `test "ok" as admin, userA\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const refs = table.refs.filter((r) => r.kind === 'session');
  assert.deepEqual(
    refs.map((r) => r.name),
    ['admin', 'userA'],
  );
  assertSpanAt(refs[0]!.span, source, 'admin', 1);
  assertSpanAt(refs[1]!.span, source, 'userA', 1);

  // Direct findIdentifierSpans round-trip against the `as` clause (task's stated case).
  const t = program.tests[0]!;
  const headerEnd = t.body[0]!.span.start;
  const spans = findIdentifierSpans(source, { start: t.name.span.end, end: headerEnd }, t.sessions);
  assert.equal(spans.length, 2);
  t.sessions.forEach((s, i) => assertSpanAt(spans[i]!, source, s, 1));
});

test('collectSymbols: a session ref resolves against a separately-parsed tflw.config session def', () => {
  const configSource = `env local default\n  api "http://localhost:3000"\n\nsession admin\n  header "Authorization" is "Bearer token"\n`;
  const { config } = parseConfigSource(configSource);
  const configTable = collectConfigSymbols(config, configSource);
  const sessionDef = configTable.defs.find((d) => d.kind === 'session' && d.name === 'admin');
  assert.ok(sessionDef, 'expected a `session admin` def in the config table');
  assertSpanAt(sessionDef!.span, configSource, 'admin', 1);

  const testSource = `test "ok" as admin\n  api GET /health\n`;
  const { program } = parseSource(testSource);
  const table = collectSymbols(program, testSource);
  const sessionRef = table.refs.find((r) => r.kind === 'session' && r.name === 'admin');
  assert.ok(sessionRef, 'expected an `admin` session ref');
  assertSpanAt(sessionRef!.span, testSource, 'admin', 1);
  // Cross-file resolution (joining this ref to the config's def) is `packages/lsp-server`'s job
  // (PLAN_M13_LSP.md decision 5) — `packages/lang` only guarantees each span is independently correct.
});

test('collectSymbols: a 4-column inline table header collects one def per column with precise spans', () => {
  const source = `with each\n  | role | email | active | note |\n  | "admin" | "a@x.com" | true | "n/a" |\ntest "invite {role}"\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const columns = ['role', 'email', 'active', 'note'];
  for (const col of columns) {
    const def = table.defs.find((d) => d.kind === 'variable' && d.name === col);
    assert.ok(def, `expected a def for column "${col}"`);
    assertSpanAt(def!.span, source, col, 1);
  }
});

test('collectSymbols: a file-backed table (`with each from`) is skipped entirely, like checkUnknownVariables', () => {
  const source = `with each from "./data.csv"\ntest "row {row}"\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  assert.deepEqual(table.defs, []);
  assert.deepEqual(table.refs, []);
});

test('collectSymbols: a `before each` binding is shared across tests as distinct, per-test refs to one def', () => {
  const source = `before each\n  let token = unique("t")\n\ntest "a"\n  api GET /health\n  let copyA = token\n\ntest "b"\n  api GET /health\n  let copyB = token\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const defs = table.defs.filter((d) => d.name === 'token');
  assert.equal(defs.length, 1, 'the `before each` let is a single physical definition');

  const refs = table.refs.filter((r) => r.name === 'token' && r.kind === 'variable');
  assert.equal(refs.length, 2, 'one ref per test that shares the before-each scope');
  assert.notEqual(refs[0]!.scopeId, refs[1]!.scopeId, 'each test gets its own scopeId');
  for (const ref of refs) assert.deepEqual(ref.defSpan, defs[0]!.span);
});

test('collectSymbols: an in-file action call resolves to the action def; args are walked independently', () => {
  const source = `action create order(name)\n  give name\n\ntest "ok"\n  let orderId = create order("Widget")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const actionDef = table.defs.find((d) => d.kind === 'action' && d.name === 'create order');
  assert.ok(actionDef, 'expected a `create order` action def');

  const callRef = table.refs.find((r) => r.kind === 'action' && r.name === 'create order');
  assert.ok(callRef, 'expected a `create order` call ref');
  assert.deepEqual(callRef!.defSpan, actionDef!.span);
});
