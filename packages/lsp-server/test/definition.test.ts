// Unit tests for definition.ts (PLAN_M13_LSP.md Phase 2, design decision 5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, collectSymbols } from '@tflw/lang';
import { findDefinition } from '../src/index.js';

test('findDefinition: a VarRef resolves locally to its `let` def span', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = findDefinition(program, table, source.indexOf('{orderId}') + 2);
  const expectedDef = table.defs.find((d) => d.name === 'orderId')!;
  assert.deepEqual(result, { kind: 'local', span: expectedDef.span });
});

test('findDefinition: clicking a def itself resolves to its own span', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const def = table.defs.find((d) => d.name === 'orderId')!;
  const result = findDefinition(program, table, def.span.start.offset + 1);
  assert.deepEqual(result, { kind: 'local', span: def.span });
});

test('findDefinition: a session ref surfaces a config-session marker', () => {
  const source = `test "ok" as admin\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = findDefinition(program, table, source.indexOf('admin') + 1);
  assert.deepEqual(result, { kind: 'config-session', name: 'admin' });
});

test('findDefinition: a call to an action not in this file surfaces an imported-call marker', () => {
  const source = `import "./shared.tflw"\n\ntest "ok"\n  let orderId = create order("Widget")\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = findDefinition(program, table, source.indexOf('create order') + 1);
  assert.deepEqual(result, { kind: 'imported-call', name: 'create order', importPaths: ['./shared.tflw'], usePaths: [] });
});

test('findDefinition: a call to an in-file action resolves locally', () => {
  const source = `action create order(name)\n  give name\n\ntest "ok"\n  let orderId = create order("Widget")\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const callOffset = source.indexOf('create order', source.indexOf('test')) + 1;
  const result = findDefinition(program, table, callOffset);
  const actionDef = table.defs.find((d) => d.kind === 'action')!;
  assert.deepEqual(result, { kind: 'local', span: actionDef.span });
});

test('findDefinition: null when nothing resolvable sits at the offset', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  assert.equal(findDefinition(program, table, source.indexOf('equals')), null);
});
