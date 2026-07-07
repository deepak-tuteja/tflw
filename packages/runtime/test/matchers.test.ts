// Backfill: the closed matcher set (matcher.ts, SPEC §6.2) has been live since M1 with zero
// dedicated runtime coverage — only `equals` was ever exercised, and only inside quantifiers.test.ts.
// This exercises every matcher + `not` negation against a real HTTP response (found via /grill-me,
// 2026-07-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { describe } from '../src/eval.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('`contains` matches a substring and an array element, and fails clearly otherwise', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { message: 'order created ok', tags: ['red', 'blue'] }),
  });

  const passing = `test "contains passes"
  api GET /orders
  expect body.message contains "created"
  expect body.tags contains "blue"
`;
  const { program: p1 } = parseSource(passing);
  const { report: r1 } = await runProgram(p1, testConfig(server.baseUrl), { source: passing });
  assert.equal(r1.ok, true, JSON.stringify(r1.tests[0], null, 2));

  const failing = `test "contains fails"
  api GET /orders
  expect body.message contains "shipped"
`;
  const { program: p2 } = parseSource(failing);
  const { report: r2 } = await runProgram(p2, testConfig(server.baseUrl), { source: failing });
  assert.equal(r2.ok, false);
  assert.match(r2.tests[0]!.error ?? '', /expected body\.message to contain "shipped", but got "order created ok"/);

  await server.close();
});

test('`matches "<regex>"` tests the subject as a string', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { id: 'ORD-1234' }),
  });

  const source = `test "matches"
  api GET /orders
  expect body.id matches "^ORD-[0-9]+$"
  expect header "content-type" matches "json"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`matches` with an invalid regex raises a clear runtime error, not a crash', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { id: 'x' }) });

  const source = `test "bad regex"
  api GET /orders
  expect body.id matches "(unclosed"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /invalid regex in matcher/);

  await server.close();
});

test('`is greater than` / `is less than` compare numbers', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { total: 42 }) });

  const source = `test "numeric compare"
  api GET /orders
  expect body.total is greater than 10
  expect body.total is less than 100
  expect duration is less than 5000
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`is greater than` on a non-number subject is a clear runtime error', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { total: 'not-a-number' }) });

  const source = `test "boom"
  api GET /orders
  expect body.total is greater than 10
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /`is greater than` expects a number, got a string/);

  await server.close();
});

test('matcher.ts describes a non-number type using the same shared `describe()` as eval.ts (decision 71)', () => {
  // Before decision 71, matcher.ts maintained its own copy of this helper and it had drifted —
  // missing the `Date` case, so a matcher error on a Date-typed actual rendered as "object" instead
  // of "a date". No user-facing subject can currently *carry* a raw `Date` (JSON round-trips dates
  // as ISO strings), so this pins the shared function directly rather than via an unreachable e2e.
  assert.equal(describe(new Date()), 'a date');
  assert.equal(describe('x'), 'a string');
  assert.equal(describe([1, 2]), 'an array');
  assert.equal(describe(null), 'null');
});

test('`has count` measures arrays and strings, and rejects everything else', async () => {
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { items: [1, 2, 3], id: 'abcde', total: 7 }),
  });

  const passing = `test "has count passes"
  api GET /orders
  expect body.items has count 3
  expect body.id has count 5
`;
  const { program: p1 } = parseSource(passing);
  const { report: r1 } = await runProgram(p1, testConfig(server.baseUrl), { source: passing });
  assert.equal(r1.ok, true, JSON.stringify(r1.tests[0], null, 2));

  const invalid = `test "has count on a number"
  api GET /orders
  expect body.total has count 1
`;
  const { program: p2 } = parseSource(invalid);
  const { report: r2 } = await runProgram(p2, testConfig(server.baseUrl), { source: invalid });
  assert.equal(r2.ok, false);
  assert.match(r2.tests[0]!.error ?? '', /`has count` expects an array \(or string\) subject, got number/);

  await server.close();
});

// `expect`'s matcher value is a `Value` expression, and object *literals* only exist as a
// `FieldValue` (inside `body { … }` / arrays / table cells) — there's no grammar for writing one
// directly after `equals`. The realistic way `equals` ever compares two objects is a `capture`d
// value from an earlier response compared against a later one via `{ref}` interpolation.
test('`equals` on an object is key-order-insensitive, but still checks key membership exactly (P#46)', async () => {
  const server = await startFixtureServer({
    '/first': (_req, res) => json(res, 200, { info: { a: 1, b: 2 } }),
    // Same data, reverse key order on the wire — JSON.parse preserves that insertion order.
    '/second-same': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"info":{"b":2,"a":1}}'),
    '/second-diff': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"info":{"a":1}}'),
  });

  const passing = `test "same keys, different wire order"
  api GET /first
  capture body.info as snapshot
  api GET /second-same
  expect body.info equals {snapshot}
`;
  const { program: p1 } = parseSource(passing);
  const { report: r1 } = await runProgram(p1, testConfig(server.baseUrl), { source: passing });
  assert.equal(r1.ok, true, JSON.stringify(r1.tests[0], null, 2));

  const missingKey = `test "a key missing from the actual object still fails"
  api GET /first
  capture body.info as snapshot
  api GET /second-diff
  expect body.info equals {snapshot}
`;
  const { program: p2 } = parseSource(missingKey);
  const { report: r2 } = await runProgram(p2, testConfig(server.baseUrl), { source: missingKey });
  assert.equal(r2.ok, false, 'an object missing a key the expected value has must still fail equals');

  await server.close();
});

test('`matches subset {...}` passes when every expected key/value is present, ignoring extra keys', async () => {
  const server = await startFixtureServer({
    '/orders/missing': (_req, res) => json(res, 404, { type: 'about:blank', title: 'Not Found', status: 404, instance: '/orders/missing' }),
  });

  const source = `test "structural shape check"
  api GET /orders/missing
  expect status equals 404
  expect body matches subset { type: "about:blank", title: "Not Found", status: 404 }
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`matches subset {...}` fails on a missing key or a mismatched value, with a clear message', async () => {
  const server = await startFixtureServer({
    '/orders/missing': (_req, res) => json(res, 404, { type: 'about:blank', title: 'Not Found', status: 404 }),
  });

  const missingKey = `test "missing key"
  api GET /orders/missing
  expect body matches subset { detail: "no such order" }
`;
  const { program: p1 } = parseSource(missingKey);
  const { report: r1 } = await runProgram(p1, testConfig(server.baseUrl), { source: missingKey });
  assert.equal(r1.ok, false);
  assert.match(r1.tests[0]!.error ?? '', /to match subset/);

  const wrongValue = `test "wrong value"
  api GET /orders/missing
  expect body matches subset { title: "Something Else" }
`;
  const { program: p2 } = parseSource(wrongValue);
  const { report: r2 } = await runProgram(p2, testConfig(server.baseUrl), { source: wrongValue });
  assert.equal(r2.ok, false);

  await server.close();
});

test('`matches subset {...}` recurses into nested object values but requires exact array equality', async () => {
  const server = await startFixtureServer({
    '/orders/1': (_req, res) =>
      json(res, 200, { id: 1, customer: { name: 'Ada', vip: true, notes: 'irrelevant' }, tags: ['red', 'blue'] }),
  });

  const nestedPass = `test "nested subset passes"
  api GET /orders/1
  expect body matches subset { customer: { name: "Ada", vip: true } }
`;
  const { program: p1 } = parseSource(nestedPass);
  const { report: r1 } = await runProgram(p1, testConfig(server.baseUrl), { source: nestedPass });
  assert.equal(r1.ok, true, JSON.stringify(r1.tests[0], null, 2));

  const arrayMustBeExact = `test "partial array does not satisfy subset"
  api GET /orders/1
  expect body matches subset { tags: ["red"] }
`;
  const { program: p2 } = parseSource(arrayMustBeExact);
  const { report: r2 } = await runProgram(p2, testConfig(server.baseUrl), { source: arrayMustBeExact });
  assert.equal(r2.ok, false, 'a partial array should not satisfy subset — arrays need full equality');

  await server.close();
});

test('`matches subset {...}` on a non-object subject is a clear runtime error, not a silent pass', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { message: 'ok' }) });

  const source = `test "subset against a string subject"
  api GET /orders
  expect body.message matches subset { x: 1 }
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /`matches subset` expects an object subject, got a string/);

  await server.close();
});

test('`not matches subset {...}` negates cleanly', async () => {
  const server = await startFixtureServer({ '/orders/1': (_req, res) => json(res, 200, { status: 'open' }) });

  const source = `test "not subset"
  api GET /orders/1
  expect body not matches subset { status: "closed" }
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('`matches subset {...}` failure shows only the mismatched/missing keys, not the whole object (gap #8)', async () => {
  const server = await startFixtureServer({
    '/orders/1': (_req, res) =>
      json(res, 200, {
        id: 1,
        status: 'pending',
        customer: { name: 'Ada', vip: true },
        // A big filler field, standing in for a real large response body — it must NOT appear
        // in the failure message at all once the diff is subset-aware.
        items: Array.from({ length: 60 }, (_, idx) => ({ id: `item-${idx}`, quantity: idx })),
      }),
  });

  const missingAndWrong = `test "subset mismatch on a large body"
  api GET /orders/1
  expect body matches subset { status: "shipped", customer: { name: "Ada", vip: false }, detail: "nope" }
`;
  const { program } = parseSource(missingAndWrong);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source: missingAndWrong });
  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  // The three real mismatches show up, correlated to their own (possibly nested) key path...
  assert.match(error, /"status":"pending"/);
  assert.match(error, /"customer\.vip":true/);
  assert.match(error, /"detail":"<missing>"/);
  // ...but none of the 60-element filler array (proof the whole object was never dumped).
  assert.doesNotMatch(error, /item-0/);
  assert.match(error, /only the 3 mismatched key\(s\) shown, out of 4 total on the response/);

  await server.close();
});

test('a large `equals`/`contains` failure is truncated with a clear marker, not dumped whole (gap #8)', async () => {
  const bigTag = 'x'.repeat(3000);
  const server = await startFixtureServer({
    '/orders': (_req, res) => json(res, 200, { tag: bigTag }),
  });

  const source = `test "big body truncates"
  api GET /orders
  expect body.tag equals "something-else"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.ok(error.length < bigTag.length, 'the failure message must be materially shorter than the untruncated value');
  assert.match(error, /truncated, showing \d+ of \d+ chars/);

  await server.close();
});

test('a negated `matches subset {...}` that unexpectedly matches shows the whole (truncated) actual, not a mismatch diff', async () => {
  const server = await startFixtureServer({ '/orders/1': (_req, res) => json(res, 200, { status: 'open', note: 'fine' }) });

  const source = `test "not subset, but it matched anyway"
  api GET /orders/1
  expect body not matches subset { status: "open" }
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  // No "<missing>"/mismatch framing here — the raw subset check genuinely passed, so the fallback
  // is the ordinary whole-actual-object message every other matcher already uses.
  assert.match(error, /"status":"open"/);
  assert.match(error, /"note":"fine"/);
  assert.doesNotMatch(error, /mismatched key/);

  await server.close();
});

test('`not` negates any matcher', async () => {
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { status: 'open' }) });

  const passing = `test "not passes"
  api GET /orders
  expect body.status not equals "closed"
`;
  const { program: p1 } = parseSource(passing);
  const { report: r1 } = await runProgram(p1, testConfig(server.baseUrl), { source: passing });
  assert.equal(r1.ok, true, JSON.stringify(r1.tests[0], null, 2));

  const failing = `test "not fails"
  api GET /orders
  expect body.status not equals "open"
`;
  const { program: p2 } = parseSource(failing);
  const { report: r2 } = await runProgram(p2, testConfig(server.baseUrl), { source: failing });
  assert.equal(r2.ok, false);
  assert.match(r2.tests[0]!.error ?? '', /expected body\.status not to equal "open", but got "open"/);

  await server.close();
});
