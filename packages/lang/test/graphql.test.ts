// `M242` `C` (`D1328`) — `body graphql`: a body kind with its own clauses, printed back as written,
// and `TF085` on a `GET`. The runtime half (what is sent) is `runtime/test/graphql.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, Codes } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const file = (line: string): string => `test "t"\n  ${line}\n  expect status equals 200\n`;

test('`body graphql` parses with and without its two clauses', () => {
  for (const [line, vars, op] of [
    ['api POST /graphql body graphql "{ orders { id } }"', false, false],
    ['api POST /graphql body graphql "query O($id: ID!) { order(id: $id) { id } }" variables { id: {orderId} }', true, false],
    ['api POST /graphql body graphql "query O { orders { id } }" operation "O"', false, true],
    ['api POST /graphql body graphql "query O($id: ID!) { order(id: $id) { id } }" variables { id: 1 } operation "O"', true, true],
  ] as const) {
    const { program, diagnostics } = parseSource(file(line));
    assert.deepEqual(diagnostics, [], line);
    const body = (program.tests[0]!.body[0] as unknown as { body: { type: string; variables: unknown; operation: unknown } }).body;
    assert.equal(body.type, 'GraphqlBody');
    assert.equal(body.variables !== null, vars, line);
    assert.equal(body.operation !== null, op, line);
    const printed = print(program.tests[0]!.body[0]!);
    assert.ok(printed.ok);
    assert.equal(printed.text, line, 'prints back to itself');
  }
});

test('the clauses come in one order, and `variables` takes an object', () => {
  assert.notDeepEqual(parseSource(file('api POST /g body graphql "{ a }" operation "O" variables { id: 1 }')).diagnostics, []);
  assert.match(parseSource(file('api POST /g body graphql "{ a }" variables 5')).diagnostics[0]!.message, /expected an object after `variables`/);
});

test('`TF085`: a GraphQL body on a GET, and not on a POST', () => {
  const codes = (line: string) => checkProgram(parseSource(file(line)).program).map((d) => d.code);
  assert.ok(codes('api GET /graphql body graphql "{ a }"').includes(Codes.GRAPHQL_ON_GET));
  assert.ok(!codes('api POST /graphql body graphql "{ a }"').includes(Codes.GRAPHQL_ON_GET));
  const waited = `test "t"\n  wait until api GET /graphql body graphql "{ a }"\n    expect status equals 200\n`;
  assert.ok(checkProgram(parseSource(waited).program).some((d) => d.code === Codes.GRAPHQL_ON_GET), 'a polled request is a request too');
});

test('a name the variables read must be bound (TF030 reaches inside)', () => {
  const diags = checkProgram(parseSource(file('api POST /g body graphql "{ a }" variables { id: {nope} }')).program);
  assert.ok(diags.some((d) => /nope/.test(d.message)));
});
