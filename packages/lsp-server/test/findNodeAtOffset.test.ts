// Unit tests for findNodeAtOffset.ts (PLAN_M13_LSP.md Phase 2) — the shared walker every other
// resolution/*.ts module builds on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { findNodeAtOffset, spanContains } from '../src/index.js';

test('findNodeAtOffset: descends to a Matcher for an offset inside its keyword', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.indexOf('equals') + 1);
  assert.equal(path[0]!.type, 'Program');
  assert.equal(path[path.length - 1]!.type, 'Matcher');
});

test('findNodeAtOffset: descends further, into the matcher\'s NumberLit value', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.indexOf('200') + 1);
  const types = path.map((n) => n.type);
  assert.deepEqual(types, ['Program', 'TestDecl', 'ExpectStmt', 'Matcher', 'NumberLit']);
});

test('findNodeAtOffset: descends into a VarRef inside a `let`\'s value', () => {
  const source = `test "ok"\n  let a = unique("x")\n  let b = a\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.lastIndexOf(' a\n') + 1);
  assert.equal(path[path.length - 1]!.type, 'VarRef');
});

test('findNodeAtOffset: empty path when the offset falls outside the root span', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  assert.deepEqual(findNodeAtOffset(program, source.length + 1000), []);
});

// -- M4a: browser-arc steps/subjects (M3a-M3e) must be descendable, not stop dead at the step ----

test('findNodeAtOffset: descends into a FillStmt\'s locator name string', () => {
  const source = `test "ok"\n  fill field "Email" with "a@b.c"\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.indexOf('Email') + 1);
  assert.deepEqual(path.map((n) => n.type), ['Program', 'TestDecl', 'FillStmt', 'Locator', 'StringLit']);
});

test('findNodeAtOffset: descends into a FillStmt\'s `{email}` value as an Interp, not a stray VarRef', () => {
  // Unquoted `with {email}` is an `Interp` value (a bare braced interpolation), distinct from the
  // `VarRef` a bare unquoted identifier (`let b = a`) parses as — `Interp` has no further Node
  // child of its own (`ref` is a plain `PathSegment[]`, not AST nodes), so it's the leaf here.
  const source = `test "ok"\n  let email = unique email\n  fill field "Email" with {email}\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.lastIndexOf('email') + 1);
  assert.deepEqual(path.map((n) => n.type), ['Program', 'TestDecl', 'FillStmt', 'Interp']);
});

test('findNodeAtOffset: descends into a ClickStmt/HoverStmt/ScrollStmt/UncheckStmt/CheckStmt locator', () => {
  const cases: readonly [string, string, string][] = [
    [`test "ok"\n  click button "Pay"\n`, 'Pay', 'ClickStmt'],
    [`test "ok"\n  hover text "Menu"\n`, 'Menu', 'HoverStmt'],
    [`test "ok"\n  scroll to list "Cart"\n`, 'Cart', 'ScrollStmt'],
    [`test "ok"\n  uncheck field "Terms"\n`, 'Terms', 'UncheckStmt'],
    [`test "ok"\n  check field "Terms"\n`, 'Terms', 'CheckStmt'],
  ];
  for (const [source, needle, stepType] of cases) {
    const { program } = parseSource(source);
    const path = findNodeAtOffset(program, source.indexOf(needle) + 1);
    assert.deepEqual(path.map((n) => n.type), ['Program', 'TestDecl', stepType, 'Locator', 'StringLit'], source);
  }
});

test('findNodeAtOffset: descends into an OpenStmt path and a ScreenshotStmt name', () => {
  const openSource = `test "ok"\n  open "/checkout"\n`;
  const { program: openProgram } = parseSource(openSource);
  assert.deepEqual(
    findNodeAtOffset(openProgram, openSource.indexOf('/checkout') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'OpenStmt', 'StringLit'],
  );

  const shotSource = `test "ok"\n  screenshot "step-2"\n`;
  const { program: shotProgram } = parseSource(shotSource);
  assert.deepEqual(
    findNodeAtOffset(shotProgram, shotSource.indexOf('step-2') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ScreenshotStmt', 'StringLit'],
  );
});

test('findNodeAtOffset: descends into a WithinBlock\'s locator and its nested body', () => {
  const source = `test "ok"\n  within css "#cart"\n    click button "Checkout"\n`;
  const { program } = parseSource(source);
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('#cart') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'WithinBlock', 'Locator', 'StringLit'],
  );
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('Checkout') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'WithinBlock', 'ClickStmt', 'Locator', 'StringLit'],
  );
});

test('findNodeAtOffset: descends into a StubStmt\'s urlPattern and body field value', () => {
  const source = `test "ok"\n  stub GET "/api/orders/**" respond status 200 body { total: 3 }\n`;
  const { program } = parseSource(source);
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('/api/orders') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'StubStmt', 'StringLit'],
  );
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('3 }') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'StubStmt', 'ObjectLit', 'Field', 'NumberLit'],
  );
});

test('findNodeAtOffset: descends into a LocatorSubject expect and a NetworkRequestSubject/ref', () => {
  const uiSource = `test "ok"\n  expect button "Pay" is visible\n`;
  const { program: uiProgram } = parseSource(uiSource);
  assert.deepEqual(
    findNodeAtOffset(uiProgram, uiSource.indexOf('Pay') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ExpectStmt', 'LocatorSubject', 'Locator', 'StringLit'],
  );

  const netSource = `test "ok"\n  expect request to "/orders" was made\n`;
  const { program: netProgram } = parseSource(netSource);
  assert.deepEqual(
    findNodeAtOffset(netProgram, netSource.indexOf('/orders') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ExpectStmt', 'NetworkRequestSubject', 'NetworkRequestRef', 'StringLit'],
  );
});

test('findNodeAtOffset: descends into the `of request to "…"` clause on a StatusSubject', () => {
  const source = `test "ok"\n  api GET /health\n  expect status of request to "/orders" equals 200\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.indexOf('/orders') + 1);
  assert.deepEqual(path.map((n) => n.type), ['Program', 'TestDecl', 'ExpectStmt', 'StatusSubject', 'NetworkRequestRef', 'StringLit']);
});

test('findNodeAtOffset: descends into a DragStmt\'s two locators and a DropFileStmt\'s filePath/locator', () => {
  const dragSource = `test "ok"\n  drag text "First" to text "Second"\n`;
  const { program: dragProgram } = parseSource(dragSource);
  assert.deepEqual(
    findNodeAtOffset(dragProgram, dragSource.indexOf('Second') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'DragStmt', 'Locator', 'StringLit'],
  );

  const dropSource = `test "ok"\n  drop file "./f.png" onto css "#zone"\n`;
  const { program: dropProgram } = parseSource(dropSource);
  assert.deepEqual(
    findNodeAtOffset(dropProgram, dropSource.indexOf('./f.png') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'DropFileStmt', 'StringLit'],
  );
});

test('findNodeAtOffset (M4b): descends into a `matches snapshot "<name>"` Matcher.snapshotName', () => {
  const source = `test "ok"\n  expect page matches snapshot "checkout-page"\n`;
  const { program } = parseSource(source);
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('checkout-page') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ExpectStmt', 'Matcher', 'StringLit'],
  );
});

test('findNodeAtOffset (M4b): descends into a trailing `mask <locator>` clause on ExpectStmt', () => {
  const source = `test "ok"\n  expect page matches snapshot "checkout-page" mask css ".timestamp"\n`;
  const { program } = parseSource(source);
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('.timestamp') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ExpectStmt', 'Locator', 'StringLit'],
  );
});

// -- M33 (perf-arc LSP/VS Code catch-up, D24b): `ramp`/`threshold`/`think` (M29-M32) had never
// been reachable at all — the walker stopped dead at `Program`, since `children()`'s `Program`
// case never listed `n.scenarios` and `ScenarioDecl` had no case of its own (silently fell into
// `default: return []`). M50 (D93-D95) later collapsed `scenario`/`ScenarioDecl` into a
// workload-bearing `TestDecl`, so these now descend through the ordinary `TestDecl` case instead
// of a separate one. ----------------------------------------------------------------------------

test('findNodeAtOffset (M33/M50): descends past Program into a workload-bearing TestDecl', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  api GET /health\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.indexOf('checkout burst') + 1);
  assert.deepEqual(path.map((n) => n.type), ['Program', 'TestDecl', 'StringLit']);
});

test('findNodeAtOffset (M33/M50): descends into a workload-bearing test body step, exactly like a functional TestDecl body step', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  let orderId = unique("ord")\n  api POST /orders body { id: {orderId} }\n  expect status equals 201\n`;
  const { program } = parseSource(source);
  const path = findNodeAtOffset(program, source.lastIndexOf('orderId') + 1);
  assert.deepEqual(path.map((n) => n.type), ['Program', 'TestDecl', 'ApiStep', 'InlineBody', 'Field', 'Interp']);
});

test('findNodeAtOffset (M33/M50): a RampUsersWorkload/RampRpsWorkload node is reachable and is a leaf', () => {
  const usersSource = `test "browsing"\n  ramp to 10 users over 30s\n  api GET /health\n`;
  const { program: usersProgram } = parseSource(usersSource);
  assert.deepEqual(
    findNodeAtOffset(usersProgram, usersSource.indexOf('ramp') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'RampUsersWorkload'],
  );

  const rpsSource = `test "browsing"\n  ramp to 100 rps over 30s\n  api GET /health\n`;
  const { program: rpsProgram } = parseSource(rpsSource);
  assert.deepEqual(
    findNodeAtOffset(rpsProgram, rpsSource.indexOf('ramp') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'RampRpsWorkload'],
  );
});

test('findNodeAtOffset (M33/M50): a ThresholdDecl node is reachable and is a leaf', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  threshold p95 duration is less than 800ms\n  api GET /health\n`;
  const { program } = parseSource(source);
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('threshold') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ThresholdDecl'],
  );
});

test('findNodeAtOffset (M33/M50): a ThinkStmt node is reachable and is a leaf, distinct from the surrounding body steps', () => {
  const source = `test "browsing"\n  ramp to 10 users over 30s\n  api GET /health\n  think 1s to 3s\n  api GET /health\n`;
  const { program } = parseSource(source);
  assert.deepEqual(
    findNodeAtOffset(program, source.indexOf('think') + 1).map((n) => n.type),
    ['Program', 'TestDecl', 'ThinkStmt'],
  );
});

test('spanContains: inclusive of both endpoints', () => {
  const span = { start: { offset: 5, line: 1, column: 6 }, end: { offset: 10, line: 1, column: 11 } };
  assert.equal(spanContains(span, 5), true);
  assert.equal(spanContains(span, 10), true);
  assert.equal(spanContains(span, 7), true);
  assert.equal(spanContains(span, 4), false);
  assert.equal(spanContains(span, 11), false);
});
