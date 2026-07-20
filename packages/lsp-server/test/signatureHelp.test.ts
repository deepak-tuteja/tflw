// Unit tests for signatureHelp.ts (PLAN_M13_LSP.md Phase 2, design decision 4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { getSignatureHelp } from '../src/index.js';

test('getSignatureHelp: `unique(...)` reports a fixed one-param signature', () => {
  const source = `test "ok"\n  let x = unique("ord")\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const result = getSignatureHelp(program, source.indexOf('"ord"') + 1);
  assert.deepEqual(result, { label: 'unique(prefix)', parameters: ['prefix'], activeParameter: 0 });
});

test('getSignatureHelp: an in-file action call resolves real parameter names + the active index', () => {
  const source = `action create order(name, amount)\n  give name\n\ntest "ok"\n  let orderId = create order("Widget", 3)\n  api GET /health\n`;
  const { program } = parseSource(source);
  const result = getSignatureHelp(program, source.indexOf('3)'));
  assert.equal(result?.label, 'create order(name, amount)');
  assert.deepEqual(result?.parameters, ['name', 'amount']);
  assert.equal(result?.activeParameter, 1);
});

test('getSignatureHelp: the first argument reports activeParameter 0', () => {
  const source = `action create order(name, amount)\n  give name\n\ntest "ok"\n  let orderId = create order("Widget", 3)\n  api GET /health\n`;
  const { program } = parseSource(source);
  const result = getSignatureHelp(program, source.indexOf('"Widget"') + 1);
  assert.equal(result?.activeParameter, 0);
});

test('getSignatureHelp: an unresolved (imported) call falls back to positional labels', () => {
  const source = `import "./shared.tflw"\n\ntest "ok"\n  let orderId = create order("Widget")\n  api GET /health\n`;
  const { program } = parseSource(source);
  const result = getSignatureHelp(program, source.indexOf('"Widget"'));
  assert.equal(result?.label, 'create order(arg1)');
  assert.deepEqual(result?.parameters, ['arg1']);
});

test('getSignatureHelp: null outside any call', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  assert.equal(getSignatureHelp(program, source.indexOf('equals')), null);
});
