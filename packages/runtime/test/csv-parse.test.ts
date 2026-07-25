// `csv-parse.ts` unit tests (gap #19, PLAN_GAPS_19.md D19.3/D19.4) — pure parsing logic, no HTTP
// fixture needed. Runtime integration (the `body csv` subject itself) is covered separately in
// `body-csv-pdf.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeError } from '../src/eval.js';
import { parseCsv } from '../src/csv-parse.js';

test('parses a well-formed multi-row CSV into an array of records', () => {
  const rows = parseCsv('id,status,total\n1,delivered,19.98\n2,pending,4.50\n');
  assert.deepEqual(rows, [
    { id: '1', status: 'delivered', total: '19.98' },
    { id: '2', status: 'pending', total: '4.50' },
  ]);
});

test('a header-only CSV (no data rows) parses to an empty array', () => {
  assert.deepEqual(parseCsv('id,status,total\n'), []);
});

test('empty input parses to an empty array', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('quoted fields may contain commas, embedded newlines, and escaped quotes', () => {
  const rows = parseCsv('name,note\n"Smith, John","says ""hi""\nsecond line"\n');
  assert.deepEqual(rows, [{ name: 'Smith, John', note: 'says "hi"\nsecond line' }]);
});

test('every cell is a plain string, never coerced to a number', () => {
  const rows = parseCsv('qty,price\n3,9.99\n');
  assert.equal(rows[0]!.qty, '3');
  assert.equal(rows[0]!.price, '9.99');
});

test('handles \\r\\n line endings identically to \\n', () => {
  const rows = parseCsv('id,name\r\n1,Widget\r\n2,Gadget\r\n');
  assert.deepEqual(rows, [
    { id: '1', name: 'Widget' },
    { id: '2', name: 'Gadget' },
  ]);
});

test('a data row with too few fields throws a RuntimeError naming the row and expected count', () => {
  assert.throws(
    () => parseCsv('id,status,total\n1,delivered\n'),
    (err: unknown) => err instanceof RuntimeError && /row 2 has 2 fields, expected 3 \(from the header row\)/.test(err.message),
  );
});

test('a data row with too many fields throws a RuntimeError naming the row and expected count', () => {
  assert.throws(
    () => parseCsv('id,status\n1,delivered,extra\n'),
    (err: unknown) => err instanceof RuntimeError && /row 2 has 3 fields, expected 2 \(from the header row\)/.test(err.message),
  );
});
