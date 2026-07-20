// Unit tests for rename.ts (PLAN_M13_LSP.md Phase 2, design decision 6; PLAN_ENTERPRISE.md
// decision 17.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, collectSymbols } from '@tflw/lang';
import { findRenameTargets } from '../src/index.js';

test('findRenameTargets: a variable renames only within its own test scope, not a same-named sibling', () => {
  const source = `test "a"\n  let token = unique("t")\n  api GET /health\n  let copy = token\n\ntest "b"\n  let token = unique("t2")\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const firstDef = table.defs.filter((d) => d.name === 'token')[0]!;
  const result = findRenameTargets(table, firstDef.span.start.offset + 1);
  assert.ok(result);
  assert.equal(result!.kind, 'variable');
  assert.equal(result!.crossFile, false);
  assert.equal(result!.spans.length, 2); // this test's def + its `let copy = token` ref only
});

test('findRenameTargets: an action param renames only within its own action', () => {
  const source = `action create order(name)\n  give name\n\naction cancel order(name)\n  give name\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const firstParamDef = table.defs.find((d) => d.kind === 'param')!;
  const result = findRenameTargets(table, firstParamDef.span.start.offset + 1);
  assert.ok(result);
  assert.equal(result!.kind, 'param');
  // The def + its own `give name` ref — not `cancel order`'s unrelated same-named param.
  assert.equal(result!.spans.length, 2);
});

test('findRenameTargets: a session rename is file-wide and flagged crossFile', () => {
  const source = `test "a" as admin\n  api GET /health\n\ntest "b" as admin\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = findRenameTargets(table, source.indexOf('admin') + 1);
  assert.ok(result);
  assert.equal(result!.kind, 'session');
  assert.equal(result!.crossFile, true);
  assert.equal(result!.spans.length, 2);
});

test('findRenameTargets: an in-file action rename covers its decl and every call site, flagged crossFile', () => {
  const source = `action create order(name)\n  give name\n\ntest "ok"\n  let a = create order("x")\n  let b = create order("y")\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const actionDef = table.defs.find((d) => d.kind === 'action')!;
  const result = findRenameTargets(table, actionDef.span.start.offset + 1);
  assert.ok(result);
  assert.equal(result!.kind, 'action');
  assert.equal(result!.crossFile, true);
  assert.equal(result!.spans.length, 3); // 1 def + 2 call sites
});

test('findRenameTargets: null when nothing renameable sits at the offset', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  assert.equal(findRenameTargets(table, source.indexOf('equals')), null);
});
