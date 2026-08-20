// M147d (`A3-12`, D627, D639) — a `body` is a JSON document, and which document it is was decided
// by one `expect('lbrace', …)` at each of two sites.
//
// The row named the request side: `api POST /o body [1, 2]` raised ``TF010: expected `{` to start
// an object, found `[` ``. Measuring the four surfaces that read a top-level JSON document before
// changing any of them showed the inline body was the only one that refused an array:
//
//  · `body from "./p.json"` where the file holds `[1, 2]` — clean, and always has been. A file body
//    is text passed through, so the shape it may hold was never the parser's decision.
//  · `expect body equals [1, 2]` — clean. The assertion side reads a top-level array fine.
//  · `body { items: [1, 2] }` — clean. An array was legal *one level down* the whole time.
//  · `api POST /o body [1, 2]` — `TF010`. The odd one out.
//
// So this is D627's rider exactly: three of four surfaces already agreed, and the fix is to widen
// the fourth rather than to argue the other three into line.
//
// **The row named one site and there were two.** `stub … respond status 200 body {…}` had the same
// `expect('lbrace', …)`, and it is the site where the narrowness actually bit: a list endpoint
// answers with a top-level array, so stubbing `GET /api/orders` — the ordinary case, not an exotic
// one — was unwritable. Measured before the change (`.m147-scratch/d3/b1.before`): the identical
// ``TF010: expected `{` to start an object, found `[` ``.
//
// **What did not change is asserted as hard as what did.** `body 5` is still refused; the widening
// is to *JSON documents*, not to *any value*. Accepting a bare scalar would give the language two
// spellings for `body text "…"`, which is the defect D638 had just finished removing from the time
// units one slice earlier. The refusal message had to grow a second opener, and it now names the
// form to reach for instead.
//
// **And the workaround was not free**, which is the part the row did not name: before D639 the only
// way to send a top-level array was `body text "[…]"`, which `undici` sends as
// `text/plain;charset=UTF-8` — so a JSON API is entitled to answer it with a 415 while `check` and
// the report both call the file fine. Measured in `packages/runtime/test/request-shapes.test.ts`,
// where the first version of that assertion predicted *no* content-type and was wrong.
//
// The blunt control: restore either `expect('lbrace', …)` and the array positives for that site
// fail; drop the scalar refusal and the negatives fail. Registered as `m147d` mutations (D636).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkUnknownVariables } from '../src/index.js';

/** Diagnostic codes from a parse of a whole file. */
const codes = (source: string): string[] => parseSource(source).diagnostics.map((d) => d.code);

/** A step body wrapped in a minimal test. */
const stepCodes = (body: string): string[] => codes(`test "t"\n  ${body}\n`);

/** The first diagnostic's message and hint, for the refusal that had to grow an opener. */
const said = (source: string): string => {
  const d = parseSource(source).diagnostics[0];
  return d ? `${d.message} | ${d.hint ?? ''}` : '';
};

test('an inline api body may be a top-level array', () => {
  assert.deepEqual(stepCodes('api POST /o body [1, 2]'), []);
  assert.deepEqual(stepCodes('api POST /o body [{ id: 1 }, { id: 2 }]'), []);
  assert.deepEqual(stepCodes('api POST /o body []'), []);
});

test('the array reaches the AST as an ArrayLit, not as an object with no fields', () => {
  const { program } = parseSource('test "t"\n  api POST /o body [1, 2]\n');
  const step = program.tests[0]?.body[0];
  assert.equal(step?.type, 'ApiStep');
  const body = (step as { body: { type: string; value: { type: string; elements: unknown[] } } }).body;
  assert.equal(body.type, 'InlineBody');
  assert.equal(body.value.type, 'ArrayLit');
  assert.equal(body.value.elements.length, 2);
});

test('the object form is unchanged, and still lands on the same field', () => {
  assert.deepEqual(stepCodes('api POST /o body { a: 1 }'), []);
  const { program } = parseSource('test "t"\n  api POST /o body { a: 1 }\n');
  const step = program.tests[0]?.body[0];
  const body = (step as { body: { value: { type: string; fields: unknown[] } } }).body;
  assert.equal(body.value.type, 'ObjectLit');
  assert.equal(body.value.fields.length, 1);
});

test('a stubbed response body may be a top-level array — the site the row did not name', () => {
  assert.deepEqual(codes('test "t"\n  stub GET "/api/orders" respond status 200 body [1, 2]\n'), []);
  const { program } = parseSource('test "t"\n  stub GET "/api/orders" respond status 200 body [{ id: 1 }]\n');
  const step = program.tests[0]?.body[0];
  assert.equal(step?.type, 'StubStmt');
  assert.equal((step as { body: { type: string } }).body.type, 'ArrayLit');
});

test('the three surfaces that already accepted a top-level array still do', () => {
  assert.deepEqual(stepCodes('api POST /o body from "./p.json"'), []);
  assert.deepEqual(stepCodes('api POST /o body { items: [1, 2] }'), []);
  assert.deepEqual(codes('test "t"\n  api GET /o\n  expect body equals [1, 2]\n'), []);
});

// NEGATIVE — the widening is to JSON *documents*, not to any value. If this ever goes green the
// language has grown a second spelling for `body text "…"`.
test('a top-level scalar is still not a body', () => {
  assert.notDeepEqual(stepCodes('api POST /o body 5'), []);
  assert.notDeepEqual(stepCodes('api POST /o body "payload"'), []);
  assert.notDeepEqual(stepCodes('api POST /o body true'), []);
  assert.notDeepEqual(codes('test "t"\n  stub GET "/x" respond status 200 body 5\n'), []);
});

// NEGATIVE — the refusal had to name both openers, and it points at the form to reach for instead
// of listing what it wanted. Before D639 it said ``expected `{` to start an object`` and offered
// ``expected `{` `` as the whole of its help, which named neither the array nor `body text`.
test('the refusal names both openers and the form for a non-JSON payload', () => {
  assert.equal(
    said('test "t"\n  api POST /o body 5\n'),
    'expected `{` or `[` to start the request body, found `5` | a `body` is a JSON object or array — for anything else, use `body text "…"`',
  );
  assert.equal(
    said('test "t"\n  stub GET "/x" respond status 200 body 5\n'),
    'expected `{` or `[` to start the stubbed response body, found `5` | a `body` is a JSON object or array — for anything else, use `body text "…"`',
  );
});

// NEGATIVE — `parseObject` is shared with `matches subset` and with every nested value position,
// and none of those grew an array form. The refusal there still names `{` alone, which is the whole
// reason D639 raised its own message at the two `body` sites instead of widening that helper: the
// other callers really do want an object, and a shared message would have lied to them.
test('an object position that is not a body still asks for an object alone', () => {
  assert.equal(
    said('test "t"\n  api GET /o\n  expect body matches subset [1, 2]\n'),
    'expected `{` to start an object, found `[` | expected `{`',
  );
});

// The checker and the symbol walker both read an inline body by iterating `.fields`, which an array
// does not have. Both now hand the whole document to the generic value walker instead, so a
// reference inside an array element is a reference — this fails with `[]` (nothing walked) if
// either widening is reverted.
test('a `{var}` inside an array body is a real reference, not an unwalked hole', () => {
  const bad = 'test "t"\n  api POST /o body [{ id: {nope} }]\n';
  const { program, diagnostics } = parseSource(bad);
  assert.deepEqual(diagnostics, [], 'the fixture must parse before the checker can be asked');
  assert.deepEqual(checkUnknownVariables(program).map((d) => d.code), ['TF030']);

  const good = 'test "t"\n  let id = unique("x")\n  api POST /o body [{ id: {id} }]\n';
  assert.deepEqual(checkUnknownVariables(parseSource(good).program), []);
});

// The same for a stubbed array body, which travels a different `case` in both walkers.
test('a `{var}` inside a stubbed array body is a real reference too', () => {
  const bad = 'test "t"\n  stub GET "/x" respond status 200 body [{ id: {nope} }]\n';
  const { program } = parseSource(bad);
  assert.deepEqual(checkUnknownVariables(program).map((d) => d.code), ['TF030']);
});
