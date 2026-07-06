// M2: actions (`action name(params) ... give expr`) as the reuse unit (P#17, SPEC §8) — both
// same-file and imported via `import "./shared.tflw"`. Calling an action executes its own steps
// (spliced into the report) and its `give` value flows back to the caller's `let`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a same-file action composes: its steps land in the report, `give` feeds the caller', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 201, { id: 42 }),
    '/orders/42': (_req, res) => json(res, 200, { id: 42, status: 'created' }),
  });

  const source = `action create order(name, qty)
  api POST /orders body { name: {name}, qty: {qty} }
  expect status equals 201
  capture body.id as id
  give id

test "checkout composes an action"
  let orderId = create order("Widget", 3)
  api GET /orders/{orderId}
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const steps = report.tests[0]!.steps;
  // action's own api/expect/capture/give land inline (its `give` is a real step, shown for
  // transparency), then the `let` call step, then the caller's own api/expect. Calling an action
  // does NOT update the caller's "last response" — it has its own, encapsulated (by design).
  assert.deepEqual(
    steps.map((s) => s.kind),
    ['api', 'expect', 'capture', 'give', 'call', 'api', 'expect'],
  );
  assert.match(steps[4]!.detail ?? '', /create order\("Widget", 3\) = 42/);
  assert.equal(server.received.get('/orders/42')!.length, 1);

  await server.close();
});

test('an action imported via `import` works the same way', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-import-'));
  await writeFile(
    join(dir, 'shared.tflw'),
    `action create order(name)
  api POST /orders body { name: {name} }
  expect status equals 201
  capture body.id as id
  give id
`,
  );

  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 201, { id: 7 }) });
  const source = `import "./shared.tflw"

test "uses the imported action"
  let orderId = create order("Gadget")
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.match(report.tests[0]!.steps[4]!.detail ?? '', /create order\("Gadget"\) = 7/);

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('calling an unknown name is a clear runtime error', async () => {
  const source = `test "typo"
  let x = create odrer("Widget")
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /unknown call `create odrer\(\.\.\.\)`/);
});

test('wrong argument count is a clear runtime error', async () => {
  const source = `action create order(name, qty)
  give name

test "missing an arg"
  let x = create order("Widget")
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expects 2 argument\(s\), got 1/);
});

test('a duplicate action name (own file vs. import) fails the whole file up front — actions are file-scoped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-dup-'));
  await writeFile(join(dir, 'shared.tflw'), `action create order(name)\n  give name\n`);

  const source = `import "./shared.tflw"

action create order(name)
  give name

test "collides"
  let x = create order("Widget")
`;
  const { program } = parseSource(source);
  // Registry building (duplicate-action detection) happens once, before any test runs — like a
  // static setup error, it rejects the whole run rather than failing one test (the CLI's
  // top-level catch turns this into a usage-error exit, same as a bad tflw.config).
  await assert.rejects(runProgram(program, testConfig('http://127.0.0.1:1'), { source, baseDir: dir }), /duplicate action "create order"/);

  await rm(dir, { recursive: true, force: true });
});
