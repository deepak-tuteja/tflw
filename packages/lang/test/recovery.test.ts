// Parser recovery: one mistake costs one diagnostic (M83, review cluster C11).
//
// Every test here was a repro before it was a test. The shared failure was that recovery had no
// model of what it had just discarded, so the *consequences* of a mistake were reported alongside
// the mistake — an orphaned block re-dispatched line by line, a summary complaint about a block
// whose contents already failed, the same token diagnosed once per production that looked at it.
// The invariant these lock in is a ratio: n mistakes, n diagnostics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '../src/index.js';

const codes = (src: string): string[] => parseSource(src).diagnostics.map((d) => d.code);
const lines = (src: string): number[] => parseSource(src).diagnostics.map((d) => d.span.start.line);

test('A2-03: a bad `action` header does not re-report its own body one line at a time', () => {
  const { diagnostics } = parseSource(
    'action create order\n  api POST /orders\n  capture id from body.id\n  give id\n\ntest "uses it"\n  create order()\n  expect status equals 201\n',
  );
  assert.equal(diagnostics.length, 1, `expected only the missing \`(\`, got:\n${diagnostics.map((d) => d.message).join('\n')}`);
  assert.match(diagnostics[0]!.message, /expected `\(` after the action name/);
  assert.equal(diagnostics[0]!.span.start.line, 1);
});

test('A2-03: no diagnostic ever lands on the valid `test` line that follows a failed block', () => {
  // The worst message the parser could produce: a caret on a line beginning with `test`, saying a
  // `test` was expected. It came from the orphaned body's trailing dedent reaching the top level.
  const { program, diagnostics } = parseSource('action create order\n  give id\n\ntest "uses it"\n  api GET /o\n');
  assert.ok(!diagnostics.some((d) => d.span.start.line === 4), 'a diagnostic pointed at the recovered `test` line');
  assert.ok(!diagnostics.some((d) => /found a dedent/.test(d.message)), 'lexer-internal vocabulary reached the user');
  // Recovery still works: the following test is parsed, not lost with the action.
  assert.equal(program.tests.length, 1);
  assert.deepEqual(program.tests[0]!.body.map((s) => s.type), ['ApiStep']);
});

test('A2-03: the `scenario` migration path reports only its own teaching message', () => {
  // D103 is the one diagnostic written specifically to hold a migrating user's hand. It used to
  // arrive buried under six `TF016`s, one per line of the body it was explaining.
  const { diagnostics } = parseSource(
    'scenario "checkout under load"\n  ramp to 50 rps over 30s\n  api GET /orders\n  expect status equals 200\n\ntest "still fine"\n  api GET /o\n',
  );
  assert.deepEqual(
    diagnostics.map((d) => d.code),
    ['TF033'],
    `D103 was buried:\n${diagnostics.map((d) => d.message).join('\n')}`,
  );
  assert.match(diagnostics[0]!.message, /`scenario` was removed/);
});

test('A2-04: a bad stage line costs one diagnostic, and does not delete the step after the block', () => {
  const { program, diagnostics } = parseSource('test "load"\n  step users\n    to 50 over 10s\n  api GET /o\n  expect status equals 200\n');
  assert.deepEqual(
    diagnostics.map((d) => `${d.code}@${d.span.start.line}`),
    ['TF010@3'],
    `expected one diagnostic on the stage line:\n${diagnostics.map((d) => d.message).join('\n')}`,
  );
  // The summary used to fire too, with its caret on line 4 — and then recovery ate line 4 as well,
  // so a load test came back functional, missing its only request, still asserting a status.
  assert.deepEqual(
    program.tests[0]!.body.map((s) => s.type),
    ['ApiStep', 'ExpectStmt'],
  );
});

test('A2-04: a stage block that is genuinely empty still says so, pointing at the header', () => {
  // The summary is suppressed only when something *inside* the block already failed. With nothing
  // in the block to fail, it is the only news there is — and it now points at the line that opened
  // the block rather than at whatever line follows it.
  const { program, diagnostics } = parseSource('test "load"\n  step users\n  api GET /o\n');
  assert.ok(
    diagnostics.some((d) => /needs at least one stage line|has no stages/.test(d.message)),
    `an empty stage block went unreported: ${diagnostics.map((d) => d.message).join(' | ')}`,
  );
  assert.ok(!diagnostics.some((d) => d.span.start.line === 3), 'the block diagnostic pointed past the block');
  // …and the step it used to point at is still in the test.
  assert.deepEqual(program.tests[0]!.body.map((s) => s.type), ['ApiStep']);
});

test('A2-10: each `step`/`spike` preposition mismatch costs exactly one diagnostic', () => {
  // `to N for` is a jump in `step` and an error in `spike`; `to N over` is a ramp in `spike` and an
  // error in `step`; `hold N for` is legal only in `spike`. Whether that asymmetry survives is a
  // grammar-freeze question — that each mismatch cost *two* diagnostics, the second mispositioned,
  // was not.
  for (const [head, stage] of [
    ['step', 'to 50 over 10s'],
    ['spike', 'to 50 for 10s'],
    ['step', 'hold 50 for 10s'],
  ] as const) {
    const src = `test "load"\n  ${head} users\n    ${stage}\n  api GET /o\n`;
    assert.deepEqual(lines(src), [3], `\`${head}\` + \`${stage}\`: ${parseSource(src).diagnostics.map((d) => d.message).join(' | ')}`);
  }
});

test('A2-05: a quoted `with each` header cell costs one diagnostic, not three', () => {
  const src = 'with each\n  | "name" | "qty" |\n  | "a"    | 2     |\ntest "quoted header"\n  api GET /o\n';
  assert.deepEqual(
    parseSource(src).diagnostics.map((d) => `${d.code}@${d.span.start.line}`),
    ['TF010@2'],
    `expected only the header-cell error:\n${parseSource(src).diagnostics.map((d) => d.message).join('\n')}`,
  );
  // The data rows used to be left in the token stream for `parseTest` to trip over, so the next two
  // diagnostics described a `|` and a dedent — neither of them anything the user wrote wrong.
  assert.ok(!parseSource(src).diagnostics.some((d) => /found `\|`/.test(d.message)));
});

test('A3-17: a malformed array index is reported once, by the production that owns it', () => {
  const src = 'test "idx"\n  api GET /o\n  expect body.items[-1].id equals 1\n';
  const { diagnostics } = parseSource(src);
  assert.equal(diagnostics.length, 1, `the same \`-\` was diagnosed by three productions:\n${diagnostics.map((d) => d.message).join('\n')}`);
  assert.match(diagnostics[0]!.message, /expected an array index/);
  // Not "expected `]`" and not "expected a matcher" — those are the grammar slots the *parser* was
  // in, not the mistake the user made.
  assert.ok(!diagnostics.some((d) => /expected a matcher/.test(d.message)));
});

test('A2-07: a bad `timeout` target is not also reported as an unknown config key', () => {
  const { diagnostics } = parseConfigSource('defaults\n  timeout step 5s, reporr 3s\n');
  assert.equal(diagnostics.length, 1, `two productions diagnosed one token:\n${diagnostics.map((d) => d.message).join('\n')}`);
  assert.match(diagnostics[0]!.message, /expected a timeout target/);
  // The suppressed second one suggested `report` — a config key, in a slot that wants a timeout
  // target. Following it produced `timeout step 5s, report 3s`, which is nonsense.
  assert.ok(!diagnostics.some((d) => /did you mean `report`/.test(d.hint ?? '')));
});

// -- the guard rails on all of the above -------------------------------------------------------

test('panic mode suppresses consequences, never a second real mistake', () => {
  // The one way this whole milestone could go wrong is by swallowing errors. Distinct mistakes on
  // distinct lines must still each be reported.
  assert.deepEqual(codes('test "a"\n  expct status equals 200\n  api GET\n'), ['TF011', 'TF010']);
  assert.equal(parseSource('test "a"\n  api GET /o\n\ntest "b"\n  expct status equals 200\n').diagnostics.length, 1);
  // Two bad declarations in a row: both reported, neither swallowed by the other's recovery.
  const two = parseSource('action create order\n  give id\n\naction ship it\n  give x\n');
  assert.equal(two.diagnostics.length, 2);
  assert.deepEqual(
    two.diagnostics.map((d) => d.span.start.line),
    [1, 4],
  );
});

test('recovery after a failed header still parses everything that follows', () => {
  // The cascade was bounded before this milestone (proportional to the orphaned block, not to the
  // file) — which is why it was S2. What must not regress is the recovery itself.
  const body = Array.from({ length: 20 }, (_, i) => `test "t${i}"\n  api GET /o\n  expect status equals 200\n`).join('\n');
  const { program, diagnostics } = parseSource(`action create order\n  give id\n\n${body}`);
  assert.equal(diagnostics.length, 1);
  assert.equal(program.tests.length, 20);
});
