// `M247` `E` (`D1359`) — `with each concurrently`: the table's rows run at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, Codes } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const TWO = 'with each concurrently\n  | sku   |\n  | "A-1" |\n  | "A-2" |\ntest "reserve {sku}"\n  api POST /reserve body { sku: {sku} }\n  expect status equals 201\n';

test('`concurrently` closes a `with each` header, inline or from a file, and is absent when unwritten', () => {
  const inline = parseSource(TWO);
  assert.deepEqual(inline.diagnostics, []);
  assert.equal(inline.program.tests[0]!.table?.concurrently, true);
  const file = parseSource('with each from "./rows.csv" concurrently\ntest "t {a}"\n  api GET /a\n');
  assert.deepEqual(file.diagnostics, []);
  assert.equal(file.program.tests[0]!.table?.concurrently, true);
  const plain = parseSource('with each\n  | a |\n  | 1 |\ntest "t"\n  api GET /a\n').program.tests[0]!.table!;
  assert.ok(!('concurrently' in plain), 'every earlier tree keeps its shape');
});

test('the printer writes `concurrently` back in both forms, and a round trip is exact', () => {
  const printed = print(parseSource(TWO).program);
  assert.ok(printed.ok, printed.reason);
  assert.equal(printed.text.split('\n')[0], 'with each concurrently');
  const file = print(parseSource('with each from "./rows.csv" concurrently\ntest "t {a}"\n  api GET /a\n').program);
  assert.equal(file.text.split('\n')[0], 'with each from "./rows.csv" concurrently');
});

test('`TF090`: one inline row marked `concurrently` warns; two rows, or a file table, do not', () => {
  const one = 'with each concurrently\n  | sku   |\n  | "A-1" |\ntest "t {sku}"\n  api GET /a\n';
  const diags = checkProgram(parseSource(one).program).filter((d) => d.code === Codes.CONCURRENTLY_ONE_ROW);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.severity, 'warning');
  assert.deepEqual(checkProgram(parseSource(TWO).program).filter((d) => d.code === Codes.CONCURRENTLY_ONE_ROW), []);
  assert.deepEqual(checkProgram(parseSource('with each from "./r.csv" concurrently\ntest "t {a}"\n  api GET /a\n').program).filter((d) => d.code === Codes.CONCURRENTLY_ONE_ROW), []);
});
