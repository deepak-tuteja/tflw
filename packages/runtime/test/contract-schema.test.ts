// `expect body matches schema "Name" from "source"` (SPEC, PLAN decision 102a, enterprise arc
// cluster 3, closes TFLW-GAPS.md gap #6) — real ajv validation against a fetched OpenAPI
// document's `components.schemas`. Real fixture server (no mocking): the `/openapi.json` fixture
// below has a cross-`$ref`'d pair (`Widget.address` → `Address`) to prove ref resolution, not
// just a flat schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

const OPENAPI_DOC = {
  components: {
    schemas: {
      Address: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      Widget: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          address: { $ref: '#/components/schemas/Address' },
        },
        required: ['id', 'name'],
      },
    },
  },
};

async function startWidgetServer() {
  return startFixtureServer({
    '/openapi.json': (_req, res) => json(res, 200, OPENAPI_DOC),
    '/widgets/good': (_req, res) => json(res, 200, { id: 'w1', name: 'Widget', address: { city: 'Springfield' } }),
    '/widgets/bad': (_req, res) => json(res, 200, { id: 'w1' }), // missing required `name`
    '/openapi-broken.json': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('not json');
    },
  });
}

test('a response that matches its documented schema passes, resolving a cross-$ref', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "widget matches its schema"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

test('a response missing a required field fails with a readable ajv error', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "widget missing a required field"
  api GET /widgets/bad
  expect body matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.equal(expectStep.ok, false);
  assert.match(expectStep.detail!, /to match schema "Widget"/);
  assert.match(expectStep.detail!, /name/);

  await server.close();
});

test('`not matches schema` passes when the shape genuinely does not match', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "bad widget correctly does not match"
  api GET /widgets/bad
  expect body not matches schema "Widget" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

test('an unknown schema name fails clearly, naming the schema', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "schema that was never documented"
  api GET /widgets/good
  expect body matches schema "DoesNotExist" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /schema "DoesNotExist" not found/);

  await server.close();
});

test('a malformed (non-JSON, no components.schemas) OpenAPI document fails clearly', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "openapi doc is not usable"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi-broken.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.ok((report.tests[0]!.error ?? '').length > 0);

  await server.close();
});

test('the OpenAPI document is fetched once and cached across multiple assertions in one run', async () => {
  const server = await startWidgetServer();
  const config = testConfig(server.baseUrl);
  const source = `test "two schema assertions, one fetch"
  api GET /widgets/good
  expect body matches schema "Widget" from "/openapi.json"
  expect body.address matches schema "Address" from "/openapi.json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/openapi.json')!.length, 1, 'the doc must be fetched once and cached, not once per assertion');

  await server.close();
});
