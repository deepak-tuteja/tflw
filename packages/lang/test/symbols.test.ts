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

// M28 (PLAN_LOG_LSP.md): `log`'s message (M27) had never been walked — a `{var}` referenced only
// inside a `log` line was invisible to hover/go-to-def/rename, with no error (a checker-clean file
// just produced an empty ref list for that span).
test('collectSymbols: a `{var}` interpolated only inside a `log` message resolves to its `let` def', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  log "order {orderId} created"\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'orderId');
  assert.ok(def, 'expected an `orderId` def');

  const ref = table.refs.find((r) => r.kind === 'variable' && r.name === 'orderId');
  assert.ok(ref, 'expected an `orderId` ref from the log message interpolation');
  assertSpanAt(ref!.span, source, 'orderId', 2); // just the identifier inside `{...}`
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

// -- M4a: browser steps (M3a-M3e) must be walked for refs, same as api steps ---------------------
// (walkSteps/walkSubject previously only handled the API-dialect step/subject types; a `{var}`
// used inside any browser step was silently never recorded as a ref — see PROGRESS.md M4a).

test('collectSymbols: a `{var}` inside `open "..."` and `fill field "..." with {var}` resolves to its `let` def', () => {
  const source = `test "ok"\n  let email = unique email\n  open "/checkout/{email}"\n  fill field "Email" with {email}\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'email');
  assert.ok(def, 'expected an `email` def');

  const refs = table.refs.filter((r) => r.kind === 'variable' && r.name === 'email');
  assert.equal(refs.length, 2, 'one ref from `open`, one from `fill field … with`');
  for (const ref of refs) assert.deepEqual(ref.defSpan, def!.span);
});

test('collectSymbols: a `{var}` inside `click`/`hover`/`scroll`/`uncheck`/`check`/`select`/`press` locator text resolves', () => {
  const source = [
    'test "ok"',
    '  let label = unique("Item")',
    '  click button "{label}"',
    '  hover text "{label}"',
    '  scroll to list "{label}"',
    '  uncheck field "{label}"',
    '  check field "{label}"',
    '  select "Widget" from field "{label}"',
    '  press "Enter" on field "{label}"',
    '',
  ].join('\n');
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'label');
  assert.ok(def, 'expected a `label` def');
  const refs = table.refs.filter((r) => r.kind === 'variable' && r.name === 'label');
  assert.equal(refs.length, 7, 'one ref per step referencing {label}');
  for (const ref of refs) assert.deepEqual(ref.defSpan, def!.span);
});

test('collectSymbols: a `{var}` inside a `within` block locator/body shares the enclosing scope', () => {
  const source = `test "ok"\n  let section = unique("Cart")\n  within css "#{section}"\n    click button "Checkout"\n    let inner = unique("x")\n  let after = inner\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const sectionDef = table.defs.find((d) => d.name === 'section');
  const sectionRef = table.refs.find((r) => r.name === 'section');
  assert.ok(sectionDef && sectionRef, 'expected `section` def + ref inside the `within` locator');
  assert.deepEqual(sectionRef!.defSpan, sectionDef!.span);

  const innerDef = table.defs.find((d) => d.name === 'inner');
  const afterRef = table.refs.find((r) => r.name === 'inner');
  assert.ok(innerDef, 'expected `inner` let def inside the within block');
  assert.ok(afterRef, 'expected `inner` ref after the within block');
  assert.deepEqual(afterRef!.defSpan, innerDef!.span, '`within` shares scope, not a new one, so `inner` is visible after the block');
});

test('collectSymbols: `download as <name>` binds `name` as a def, referenced after the block', () => {
  const source = `test "ok"\n  download as file\n    click text "Download report"\n  let copy = file\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'file');
  assert.ok(def, 'expected a `file` def from `download as file`');
  assertSpanAt(def!.span, source, 'file', 1);

  const ref = table.refs.find((r) => r.kind === 'variable' && r.name === 'file');
  assert.ok(ref, 'expected a `file` ref from `let copy = file`');
  assert.deepEqual(ref!.defSpan, def!.span);
});

test('collectSymbols: `{var}` inside a `stub` body object resolves', () => {
  const source = `test "ok"\n  let token = unique("tok")\n  stub GET "/api/session" respond status 200 body { token: "{token}" }\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'token');
  const ref = table.refs.find((r) => r.kind === 'variable' && r.name === 'token');
  assert.ok(def && ref, 'expected `token` def + ref inside the stub body');
  assert.deepEqual(ref!.defSpan, def!.span);
});

test('collectSymbols: `{var}` inside `request to "..."` (NetworkRequestSubject) and `of request to "..."` both resolve', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /health\n  expect request to "/orders/{orderId}" was made\n  expect status of request to "/orders/{orderId}" equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'orderId');
  assert.ok(def, 'expected an `orderId` def');
  const refs = table.refs.filter((r) => r.kind === 'variable' && r.name === 'orderId');
  assert.equal(refs.length, 2, 'one ref from `request to "…"`, one from `of request to "…"`');
  for (const ref of refs) assert.deepEqual(ref.defSpan, def!.span);
});

test('collectSymbols: `{var}` inside a `LocatorSubject` expect (`expect button "{var}" is visible`) resolves', () => {
  const source = `test "ok"\n  let label = unique("Pay")\n  expect button "{label}" is visible\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const def = table.defs.find((d) => d.kind === 'variable' && d.name === 'label');
  const ref = table.refs.find((r) => r.kind === 'variable' && r.name === 'label');
  assert.ok(def && ref, 'expected `label` def + ref from the LocatorSubject expect');
  assert.deepEqual(ref!.defSpan, def!.span);
});

test('collectSymbols: `expect page has no a11y violations` (bare PageSubject) collects no spurious refs and does not throw', () => {
  const source = `test "ok"\n  open "/checkout"\n  expect page has no critical a11y violations\n`;
  const { program } = parseSource(source);
  assert.doesNotThrow(() => collectSymbols(program, source));
});

test('collectSymbols (M4b): `{var}` inside `matches snapshot "<name>"` and inside a `mask <locator>` both resolve', () => {
  const source = `test "ok"\n  let step = unique("checkout")\n  let region = unique(".ts")\n  expect page matches snapshot "{step}-page" mask css "{region}"\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  const stepDef = table.defs.find((d) => d.name === 'step');
  const stepRef = table.refs.find((r) => r.name === 'step');
  assert.ok(stepDef && stepRef, 'expected `step` def + ref inside the snapshot name');
  assert.deepEqual(stepRef!.defSpan, stepDef!.span);

  const regionDef = table.defs.find((d) => d.name === 'region');
  const regionRef = table.refs.find((r) => r.name === 'region');
  assert.ok(regionDef && regionRef, 'expected `region` def + ref inside the mask locator');
  assert.deepEqual(regionRef!.defSpan, regionDef!.span);
});

test('collectSymbols (M4b): `matches snapshot` against a LocatorSubject resolves both the locator name and the snapshot name', () => {
  const source = `test "ok"\n  let name = unique("Pay")\n  let snap = unique("pay-button")\n  expect button "{name}" matches snapshot "{snap}"\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);

  assert.ok(table.refs.find((r) => r.name === 'name'), 'expected a `name` ref from the button locator');
  assert.ok(table.refs.find((r) => r.name === 'snap'), 'expected a `snap` ref from the snapshot name');
});
