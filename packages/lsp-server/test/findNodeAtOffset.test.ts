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

test('spanContains: inclusive of both endpoints', () => {
  const span = { start: { offset: 5, line: 1, column: 6 }, end: { offset: 10, line: 1, column: 11 } };
  assert.equal(spanContains(span, 5), true);
  assert.equal(spanContains(span, 10), true);
  assert.equal(spanContains(span, 7), true);
  assert.equal(spanContains(span, 4), false);
  assert.equal(spanContains(span, 11), false);
});
