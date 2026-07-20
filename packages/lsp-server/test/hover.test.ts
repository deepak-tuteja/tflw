// Unit tests for hover.ts (PLAN_M13_LSP.md Phase 2, decision 17.7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, collectSymbols } from '@tflw/lang';
import { getHover } from '../src/index.js';

test('getHover: a matcher keyword surfaces its spec-data.ts entry', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('equals') + 1);
  assert.ok(result);
  assert.match(result!.contents, /equals/);
  assert.match(result!.contents, /any value/);
});

test('getHover: a generator expression surfaces its spec-data.ts entry', () => {
  const source = `test "ok"\n  let x = unique email\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('unique email') + 2);
  assert.ok(result);
  assert.match(result!.contents, /unique email/);
});

test('getHover: a variable ref shows its symbol kind', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const offset = source.indexOf('{orderId}') + 2;
  const result = getHover(program, table, offset);
  const ref = table.refs.find((r) => r.name === 'orderId')!;
  assert.deepEqual(result, { contents: '**orderId**: variable', span: ref.span });
});

test('getHover: an action param def shows its symbol kind', () => {
  const source = `action create order(name)\n  give name\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const def = table.defs.find((d) => d.kind === 'param')!;
  const result = getHover(program, table, def.span.start.offset + 1);
  assert.deepEqual(result, { contents: '**name**: action parameter', span: def.span });
});

test('getHover: `connects`/`fails` matchers surface their own spec-data.ts entries, not the visible/hidden state-word one (decision 18)', () => {
  const source = `test "ok"\n  api GET /health\n  expect request connects\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('connects') + 1);
  assert.ok(result);
  assert.match(result!.contents, /`connects`/);
  assert.match(result!.contents, /`request`/);

  const failsSource = `test "ok"\n  api GET /health\n  expect request fails matching "certificate"\n`;
  const { program: failsProgram } = parseSource(failsSource);
  const failsTable = collectSymbols(failsProgram, failsSource);
  const failsResult = getHover(failsProgram, failsTable, failsSource.indexOf('fails') + 1);
  assert.ok(failsResult);
  assert.match(failsResult!.contents, /`fails`/);
});

test('getHover: an active diagnostic at the offset shows its live message + hint plus the canonical DIAGNOSTICS meaning/example (decision 20.6), taking priority over an overlapping matcher hover', () => {
  const source = `test "ok"\n  api GET /health\n  expect status eq 200\n`;
  const { program, diagnostics } = parseSource(source);
  const table = collectSymbols(program, source);
  const diag = diagnostics.find((d) => d.code === 'TF014')!;
  assert.ok(diag, 'expected a TF014 unrecognised-matcher diagnostic in this fixture');
  const result = getHover(program, table, diag.span.start.offset + 1, diagnostics);
  assert.ok(result);
  assert.match(result!.contents, /error\[TF014\]/);
  assert.match(result!.contents, /unknown matcher `eq`/);
  assert.match(result!.contents, /expected one of: equals, contains, matches/);
  assert.match(result!.contents, /unrecognised matcher/);
  assert.match(result!.contents, /Example:/);
});

test('getHover: no diagnostics list falls through to normal matcher/symbol hover unchanged', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('equals') + 1);
  assert.ok(result);
  assert.match(result!.contents, /any value/);
});

test('getHover: null when nothing is at the offset', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  assert.equal(getHover(program, table, source.indexOf('api')), null);
});
