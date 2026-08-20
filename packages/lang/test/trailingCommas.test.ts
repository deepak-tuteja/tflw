// M147d (`A3-18`, D627, D637) — which comma lists accept a trailing comma, and why that is a
// property of the closing token rather than of the construct.
//
// The row named one asymmetry: `api POST /o body { a: 1, }` checks clean and `let a = sign("x",)`
// raises ``TF010: expected a value, found `)` ``. Reading every comma loop in the parser showed the
// joint is not "literals vs calls" — it is **what closes the list**. Four of the thirteen loops are
// closed by a bracket (`{}`, `[]`, and twice by `()`); the other nine end at the end of the line,
// where a trailing comma has no closing token to sit before and the next thing the parser reaches
// is `endLine`. So the widening D627's rider asks for lands on *two* sites, not the one the row
// named: call arguments and action parameters.
//
// **The negative half is the rule's boundary and is the half worth having.** If the tests only
// proved `sign("x",)` parses, the rule "a bracket-closed list accepts a trailing comma" would be
// indistinguishable from "every comma list accepts one" — and the second is false, because
// `random of "a", "b",` runs off the end of the line. Both directions are asserted below.
//
// The blunt control: delete either `if (this.check('rparen')) break;` in `parser.ts` and the
// positives for that site fail. Registered as `m147d` mutations (D636) rather than demonstrated in
// a scratch script.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';

/** Diagnostic codes from a parse of a whole file. */
const codes = (source: string): string[] => parseSource(source).diagnostics.map((d) => d.code);

/** A step body wrapped in a minimal test. */
const stepCodes = (body: string): string[] => codes(`test "t"\n  ${body}\n`);

test('a call argument list accepts a trailing comma', () => {
  assert.deepEqual(stepCodes('let a = sign("x",)'), []);
  assert.deepEqual(stepCodes('let a = sign("x", "y",)'), []);
});

test('the trailing comma does not become an argument', () => {
  const { program } = parseSource('test "t"\n  let a = sign("x",)\n');
  const decl = program.tests[0]?.body[0];
  assert.equal(decl?.type, 'LetStmt');
  const value = (decl as { value: { type: string; args: unknown[] } }).value;
  assert.equal(value.type, 'CallExpr');
  assert.equal(value.args.length, 1, 'the comma is a separator, not an empty slot');
});

test('an action parameter list accepts a trailing comma', () => {
  assert.deepEqual(codes('action make id(prefix,)\n  let x = 1\n'), []);
  const { program } = parseSource('action make id(prefix, suffix,)\n  let x = 1\n');
  assert.deepEqual(program.actions[0]?.params, ['prefix', 'suffix']);
});

test('a comma is still a separator, not a value — one comma does not make an empty list', () => {
  assert.notDeepEqual(stepCodes('let a = sign(,)'), []);
  assert.notDeepEqual(stepCodes('let a = sign("x",,)'), []);
  assert.notDeepEqual(codes('action make id(,)\n  let x = 1\n'), []);
});

test('an empty argument list is still empty, and a full one still parses', () => {
  assert.deepEqual(stepCodes('let a = sign()'), []);
  assert.deepEqual(stepCodes('let a = sign("x", "y")'), []);
});

test('the brace and bracket literals the row compared against are unchanged', () => {
  assert.deepEqual(stepCodes('api POST /o body { a: 1, }'), []);
  assert.deepEqual(stepCodes('let a = ["x", "y",]'), []);
});

// NEGATIVE — the rule is about the closing bracket, so a list that ends at the end of the line
// gains nothing. `random of` is the shortest of the nine; if this ever goes green, the widening has
// leaked out of `parseIdentOrCall`/`parseActionDecl` and into the shared comma handling.
//
// That boundary has an incident behind it rather than a preference: a trailing comma on `require
// env`'s line-terminated list once hung `parseConfig()` outright and took the process out of heap
// (`require-env-trailing-comma-continuation` in `fixtures.ts`, found dogfooding 2026-07-18). A
// comma before a newline reads as a line continuation, and this grammar has none.
test('a line-terminated comma list still refuses a trailing comma', () => {
  assert.deepEqual(stepCodes('let a = random of "a", "b"'), []);
  assert.notDeepEqual(stepCodes('let a = random of "a", "b",'), []);
});
