// `M242` `C` (`D1328`) — what `body graphql` sends: GraphQL-over-HTTP's POST shape, as JSON, with the
// two optional fields left out when not written rather than sent as `null`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('the query, its variables and its operation name arrive as one JSON document', async () => {
  const seen: { ct: string | undefined; body: unknown }[] = [];
  const server = await startFixtureServer({
    '/graphql': (req, res, raw) => {
      seen.push({ ct: req.headers['content-type'], body: JSON.parse(raw) });
      json(res, 200, { data: { order: { id: '7' } } });
    },
  });
  const src = [
    'test "t"',
    '  let orderId = 7',
    '  api POST /graphql body graphql "query O($id: ID!) { order(id: $id) { id } }" variables { id: {orderId} } operation "O"',
    '  expect body.data.order.id equals "7"',
    '  api POST /graphql body graphql "{ ping }"',
    '',
  ].join('\n');
  const { report } = await runProgram(parseSource(src).program, testConfig(server.baseUrl), { source: src });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0]));
  assert.equal(seen.length, 2);
  assert.match(seen[0]!.ct ?? '', /^application\/json/);
  assert.deepEqual(seen[0]!.body, { query: 'query O($id: ID!) { order(id: $id) { id } }', variables: { id: 7 }, operationName: 'O' });
  assert.deepEqual(seen[1]!.body, { query: '{ ping }' }, 'no variables, no operationName — absent, not null');
  await server.close();
});
