// M2: value expressions — arithmetic (with standard precedence), unary minus, and date math +
// `format` (P#25, SPEC §7.5). Verified against what the server actually receives, not just the AST.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('arithmetic respects * / over + -, and unary minus works on a variable', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "math"
  let a = 10
  let b = 4
  let total = {a} + {b} * 2
  let neg = -{a}
  api POST /orders body { total: {total}, neg: {neg} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const body = JSON.parse(server.received.get('/orders')![0]!.body);
  assert.equal(body.total, 18); // 10 + 4*2, not (10+4)*2
  assert.equal(body.neg, -10);

  await server.close();
});

test('a `{ref}` directly inside an object field or array element still continues into an operator', async () => {
  // Regression: `body { doubled: {price} * 2 }` used to stop parsing at `{price}` and error on
  // the `*`, because parseFieldValue short-circuited straight to parseInterp() for a bare `{ref}`
  // instead of falling through to the full expression parser. Found via dogfooding (P#25).
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "field-value arithmetic"
  let price = 10
  let qty = 3
  api POST /orders body { doubled: {price} * 2, items: [{price}, {qty} + 1] }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const body = JSON.parse(server.received.get('/orders')![0]!.body);
  assert.equal(body.doubled, 20);
  assert.deepEqual(body.items, [10, 4]);

  await server.close();
});

test('division by zero is a clear runtime error, not NaN/Infinity', async () => {
  const source = `test "boom"
  let z = 0
  let bad = 5 / {z}
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /division by zero/);
});

test('arithmetic on a non-number is a clear runtime error', async () => {
  const source = `test "boom"
  let bad = -"abc"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /cannot apply '-' to number and a string/);
});

test('date math + format render a calendar date offset from `today`', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { ok: true }) });

  const source = `test "dates"
  let shipDate = format today + 3 days as "yyyy-MM-dd"
  api POST /orders body { shipDate: {shipDate} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const body = JSON.parse(server.received.get('/orders')![0]!.body);
  const expected = new Date();
  expected.setHours(0, 0, 0, 0);
  expected.setDate(expected.getDate() + 3);
  const yyyy = expected.getFullYear();
  const mm = String(expected.getMonth() + 1).padStart(2, '0');
  const dd = String(expected.getDate()).padStart(2, '0');
  assert.equal(body.shipDate, `${yyyy}-${mm}-${dd}`);

  await server.close();
});

test('`format` on a non-date value is a clear runtime error', async () => {
  const source = `test "boom"
  let bad = format "not a date" as "yyyy-MM-dd"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /needs a date value/);
});
