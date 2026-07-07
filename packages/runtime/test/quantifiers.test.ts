// M2: `any`/`all` array quantifiers over a body path (P#14, SPEC §6.3) — the walk-until-array
// evaluation in interpreter.ts's `evaluateQuantified`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

const ORDERS = {
  items: [
    { name: 'Widget', status: 'active' },
    { name: 'Gadget', status: 'inactive' },
  ],
  tags: ['urgent', 'later'],
};

test('`any` passes when at least one element matches; `all` fails on the first mismatch', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, ORDERS) });

  const source = `test "quantifiers"
  api GET /orders
  expect any body.items.name equals "Widget"
  expect any body.tags equals "urgent"
  expect all body.items.status equals "active"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  const t = report.tests[0]!;
  assert.equal(t.ok, false);
  assert.equal(t.steps[1]!.ok, true); // any body.items.name equals "Widget"
  assert.equal(t.steps[2]!.ok, true); // any body.tags equals "urgent"
  assert.equal(t.steps[3]!.ok, false); // all body.items.status equals "active" — Gadget is inactive
  assert.match(t.steps[3]!.detail ?? '', /body\.items\[1\]\.status/);

  await server.close();
});

test('`all` passes when every element matches', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { items: [{ status: 'active' }, { status: 'active' }] }),
  });

  const source = `test "all passes"
  api GET /orders
  expect all body.items.status equals "active"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`any` fails with a clear message when no element matches', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { items: [{ name: 'Gadget' }] }),
  });

  const source = `test "any fails"
  api GET /orders
  expect any body.items.name equals "Widget"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.steps[1]!.detail ?? '', /expected any element in body\.items to match, but none of 1 did/);

  await server.close();
});

test('`any`/`all` compose with `matches subset {...}` — the matcher just runs once per element like any other', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { items: [{ name: 'Widget', status: 'active', price: 10 }, { name: 'Gadget', status: 'active', extra: true }] }),
  });

  const source = `test "quantified subset"
  api GET /orders
  expect all body.items matches subset { status: "active" }
  expect any body.items matches subset { name: "Widget", price: 10 }
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`any` treats an element missing the remaining path as a non-match instead of crashing the assertion (P#46)', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { items: [{ tags: null }, { tags: { name: 'Widget' } }] }),
  });

  const source = `test "any tolerates a missing path on one element"
  api GET /orders
  expect any body.items.tags.name equals "Widget"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`all` also treats a per-element navigation failure as that element failing, not a runtime crash (P#46)', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { items: [{ tags: null }, { tags: { name: 'Widget' } }] }),
  });

  const source = `test "all reports a clean failure, not a crash"
  api GET /orders
  expect all body.items.tags.name equals "Widget"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /body\.items\[0\]\.tags\.name/);

  await server.close();
});
