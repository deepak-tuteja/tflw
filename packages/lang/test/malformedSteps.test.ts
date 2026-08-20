// `M147c` (`M140-01`) — the step the parser abandons, and the two passes that used to read its
// absence as a fact about the user's file.
//
// **The row named one shape and the joint is somewhere else.** `M140-01` reported `api POST /o body
// [1, 2]` raising `TF010` and then a false `TF039` on the next line, and concluded from a
// discriminator — that `api GET /o headerz "x"` raises `TF010` alone — that the fault was "the body
// branch, whose recovery drops the whole step out of the AST while `endLine`'s recovery keeps it".
// The first half of that is right and the second half is not. Six of `parseApiRequestLine`'s exits
// cascade, not one: a bad inline `body`, a bad `form`, a bad duration after `timeout`, an unknown
// method, `without` not followed by `redirects`, and a non-string after `as` (tests 1-6). What the
// trailing-token case actually shows is that `endLine()` reports *after* the node is built, while
// every one of those six returns `null` *before* it. So the repair is at the drop site, not in
// `parseApiBody` — the row's own cheaper suggestion would have fixed one case in six.
//
// **And it is not one victim but two.** The same drop makes `capture body.id as` — where the name
// is literally the token that is missing — raise `TF030` "unknown variable" on every later use of a
// name the file does bind (tests 8-9). Measured while reproducing the row, one mechanism, so both
// are repaired here rather than leaving the second to be refiled.
//
// **The two suppressions are deliberately independent**, and tests 12 and 13 are the guard on that:
// a malformed `api` must not blind the variable pass, and a malformed `capture` must not establish
// a response scope. A single "something went wrong in this body" flag would pass every other test
// in this file and fail those two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkProgram, Codes } from '../src/index.js';

const codes = (source: string): string[] => {
  const { program, diagnostics } = parseSource(source);
  return [...diagnostics, ...checkProgram(program)].filter((d) => d.severity === 'error').map((d) => d.code);
};

/** The six `api` shapes that abandon the step, each with an `expect` under it that reads the
 *  response. Every one raised its own parse error plus a `TF039` before this change. */
const API_SHAPES: ReadonlyArray<readonly [string, string]> = [
  // Was `body [1, 2]` when this file was written for `M147c`; D639 (`M147d`, one day later) made a
  // top-level array a legal body, so the fixture stopped being malformed and these tests would have
  // gone quietly vacuous — the class `M141` exists for. `body 5` fails at the same site, in the same
  // branch, and is still refused on purpose: a `body` is a JSON document, not any value.
  ['inline body', 'api POST /o body 5'],
  ['form body', 'api POST /o form { a: 1 }'],
  ['timeout duration', 'api POST /o timeout xyz'],
  ['http method', 'api PSOT /o'],
  ['without redirects', 'api POST /o without redirekts'],
  ['as label', 'api POST /o as 5'],
];

for (const [what, line] of API_SHAPES) {
  test(`a malformed \`api\` step (${what}) does not also report TF039`, () => {
    const got = codes(`test "t"\n  ${line}\n  expect status equals 200\n`);
    assert.ok(got.length >= 1, 'the mistake itself must still be reported');
    assert.ok(!got.includes(Codes.NO_RESPONSE_YET), `${line} still cascades: ${got.join(', ')}`);
  });
}

test('one mistake, one diagnostic — the cascade did not merely move', () => {
  assert.deepEqual(codes('test "t"\n  api POST /o body 5\n  expect status equals 200\n'), [Codes.UNEXPECTED_TOKEN]);
});

test('a malformed `api` step suppresses every following assertion in the frame, not just the first', () => {
  // The count is the point: `mix.tflw` in the repro raised *two* `TF039`s from one mistake, because
  // the flag is positional and every later `expect` consults it.
  const got = codes('test "t"\n  api POST /o body 5\n  expect request connects\n  expect status equals 200\n');
  assert.deepEqual(got, [Codes.UNEXPECTED_TOKEN]);
});

test('a malformed `capture` does not also report TF030 for the name it would have bound', () => {
  const got = codes('test "t"\n  api GET /o\n  capture body.id as\n  expect body.x equals "{{id}}"\n');
  assert.ok(got.length >= 1);
  assert.ok(!got.includes(Codes.UNKNOWN_VARIABLE), got.join(', '));
});

test('a malformed `let` does the same — `capture` is not a special case', () => {
  // Written through `parseValue`'s failure rather than `endLine`'s, since a trailing token after a
  // complete `let` recovers with the node intact and never had the bug.
  const got = codes('test "t"\n  let x =\n  api GET /o\n  expect body.a equals "{{x}}"\n');
  assert.ok(!got.includes(Codes.UNKNOWN_VARIABLE), got.join(', '));
});

test('NEGATIVE — a body with no `api` step at all still reports TF039', () => {
  assert.deepEqual(codes('test "t"\n  expect status equals 200\n'), [Codes.NO_RESPONSE_YET]);
});

test('NEGATIVE — a genuinely unbound name still reports TF030', () => {
  assert.deepEqual(codes('test "t"\n  api GET /o\n  expect body.x equals "{{nope}}"\n'), [Codes.UNKNOWN_VARIABLE]);
});

test('NEGATIVE — a malformed step that is not an `api` step does not establish a response', () => {
  // The head is read from what the user typed, so an unknown step keyword suppresses nothing. A
  // placeholder that established unconditionally would lose this true positive.
  const got = codes('test "t"\n  clik "#a"\n  expect status equals 200\n');
  assert.ok(got.includes(Codes.NO_RESPONSE_YET), got.join(', '));
});

test('NEGATIVE — a malformed `api` step leaves the variable world alone', () => {
  const got = codes('test "t"\n  api GET /o body 5\n  expect body.x equals "{{nope}}"\n');
  assert.ok(got.includes(Codes.UNKNOWN_VARIABLE), got.join(', '));
});

test('NEGATIVE — a malformed `capture` does not establish a response scope', () => {
  const got = codes('test "t"\n  capture body.id as\n  expect status equals 200\n');
  assert.ok(got.includes(Codes.NO_RESPONSE_YET), got.join(', '));
});

test('the placeholder is in the body, at the position the user wrote', () => {
  const { program } = parseSource('test "t"\n  api POST /o body 5\n  expect status equals 200\n');
  const body = program.tests[0]!.body;
  assert.equal(body.length, 2);
  const gap = body[0]!;
  assert.equal(gap.type, 'MalformedStep');
  assert.equal(gap.type === 'MalformedStep' ? gap.head : '', 'api');
  assert.equal(gap.span.start.line, 2);
  assert.equal(gap.span.start.column, 3);
});

test('`wait until api` is recorded as its whole phrase, and establishes', () => {
  const { program } = parseSource('test "t"\n  wait until api GET /o body 5\n  expect status equals 200\n');
  const gap = program.tests[0]!.body[0]!;
  assert.equal(gap.type === 'MalformedStep' ? gap.head : '', 'wait until api');
  assert.ok(!codes('test "t"\n  wait until api GET /o body 5\n  expect status equals 200\n').includes(Codes.NO_RESPONSE_YET));
});

test('NEGATIVE — `wait until` on a UI condition is a different phrase and does not establish', () => {
  // `wait until api …` polls a response; `wait until <ui condition>` never issues a request. Reading
  // only the first word would merge them and silence a correct TF039 under every malformed `wait`.
  const got = codes('test "t"\n  wait until text "hi" iz visible\n  expect status equals 200\n');
  assert.ok(got.includes(Codes.NO_RESPONSE_YET), got.join(', '));
});

test('a program that parses carries no placeholder at all', () => {
  const { program, diagnostics } = parseSource('test "t"\n  api GET /o\n  expect status equals 200\n');
  assert.deepEqual(diagnostics, []);
  assert.ok(!program.tests[0]!.body.some((s) => s.type === 'MalformedStep'));
});

test('an `action` body gets the same treatment as a test body', () => {
  // Four call sites drop steps and all four had to be wired; an action body is the one a library
  // file is made of, so a fix that reached only `parseTest` would be invisible in the file that
  // matters most.
  const got = codes('action doIt\n  api POST /o body 5\n  expect status equals 200\n');
  assert.ok(!got.includes(Codes.NO_RESPONSE_YET), got.join(', '));
});

test('a nested `within` block shares the enclosing scope, so it inherits the unknown binding', () => {
  // `bound` is threaded through by reference for `within`, so the unknown-binding holder is too. A
  // holder created fresh per recursion would pass every other test in this file and fail this one.
  //
  // **The control is asserted here, in the same test, and that is not decoration.** The first
  // version of this used `within "#panel"` — not the grammar, which needs a locator kind — and
  // `expect text "…" equals`, which reports `TF042` rather than `TF030`. So it asserted the absence
  // of a code the fixture could never have produced, passed under the mutation that was written to
  // break it, and was caught only by running that mutation. `M141` is the milestone about exactly
  // this, and the cheap guard against re-earning it is to make the fixture prove it can fail.
  const control = codes('test "t"\n  api GET /o\n  within css "#p"\n    fill field "b" with "1"\n  fill field "a" with "{{nope}}"\n');
  assert.deepEqual(control, [Codes.UNKNOWN_VARIABLE], 'the fixture must be able to report TF030 at all');

  // The abandoned `capture` is *inside* the block and the reference is *after* it, which is the
  // one arrangement the per-step filter cannot cover on its own: an unknown binding discovered in
  // the nested call has to be visible to the enclosing loop, and only the shared holder carries it
  // out. The mirror arrangement — malformed outside, reference inside — was tried first and passes
  // either way, because the enclosing loop filters what the nested call appended anyway.
  const got = codes('test "t"\n  api GET /o\n  within css "#p"\n    capture body.id as\n  fill field "a" with "{{id}}"\n');
  assert.ok(!got.includes(Codes.UNKNOWN_VARIABLE), got.join(', '));
});
