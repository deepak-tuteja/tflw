// M99a (`PLAN_M99_VALUE_TERMINATION.md`, D167/D168/D168b) — `A3-05`: what ends a value.
//
// tflw has no reserved words. The lexer emits every word as `ident` and keywords are contextual, so
// at a value position the parser sees `ident ident` and cannot tell `random number lo to hi` (a
// variable, then a keyword belonging to the enclosing production) from `create order(…)` (one
// multi-word call name) without looking further. `parseIdentOrCall` looks further, and until this
// milestone its rule had only two branches: scan forward over every consecutive `ident`, and if the
// run lands on `(` it is a call — otherwise it is a *malformed* call. A bare variable followed by a
// keyword took the second branch and was reported as a missing paren:
//
//   error[TF010]: `lo` looks like the start of a call but never reaches `(`
//     --> r1.tflw:9:25
//   9 |   let x = random number lo to hi
//     |                         ^^
//
// The scan is a lookahead and consumes nothing, so a third branch was always available: return a
// single-token `VarRef` and hand the remaining idents back to the enclosing production. That is
// D167. No terminator vocabulary and no context threading — both alternatives were rejected on
// measurement, not taste (a stop-word table permanently forbids its words as the second word of a
// multi-word action name, and the corpus already contains `action retry login`).
//
// Every test states its negative control (`M92d` — a negative control that cannot fail is a passing
// test of nothing; the finding in `M98c` and `M98d` twice each).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkProgram, Codes } from '../src/index.js';

const parse = (source: string) => parseSource(source);

const errorsOf = (source: string) => parse(source).diagnostics.filter((d) => d.severity === 'error');

/** Parse + the full check pass list, the way `tflw check` composes them. */
const allDiagnostics = (source: string) => {
  const { program, diagnostics } = parse(source);
  return [...diagnostics, ...checkProgram(program)];
};

// ---- D167: the newly-valid spellings -------------------------------------------------------

// Every one of these was re-confirmed against the `M98d` build before the fix, and every one of
// them parses clean in the braced spelling — which is why the parser's own doc examples never hit
// it.
const REPROS: readonly (readonly [string, string])[] = [
  ['random number', 'let x = random number lo to hi'],
  ['random decimal', 'let y = random decimal lo to hi'],
  ['random date', 'let z = random date between a and b'],
  ['format … as', 'let f = format d as "yyyy-MM-dd"'],
];

for (const [label, line] of REPROS) {
  test(`a bare name terminated by a keyword parses: ${label}`, () => {
    const source = `test "t"\n  let lo = 1\n  let hi = 9\n  let a = "2020-01-01"\n  let b = "2020-12-31"\n  let d = "2020-06-15"\n  ${line}\n  api GET /health\n  expect status equals 200\n`;
    assert.deepEqual(errorsOf(source), [], `${label} should parse: ${line}`);
  });
}

test('a bare name terminated by a keyword parses: `select … from field`', () => {
  // The UI half of `A3-05`, and the one that reads least like the others: `size` is followed by two
  // idents (`from`, `field`) before a string, so the old forward scan ran three words deep before
  // giving up and blaming the first.
  const source = `test "t"\n  open "/app"\n  let size = "Large"\n  select size from field "Size"\n`;
  assert.deepEqual(errorsOf(source), []);
});

test('control: the same spellings were the ones that used to fail, and still fail one word longer', () => {
  // This is what makes the four tests above mean something. If `parseIdentOrCall` had simply
  // stopped scanning altogether, they would pass and so would everything else — the suite would be
  // green against a parser that no longer recognises multi-word calls at all. `create order` with
  // no parens is still an error, and the *next* test pins which error.
  assert.equal(errorsOf(`test "t"\n  let a = create order\n`).length, 1);
});

// ---- D168: the message is relocated, not deleted --------------------------------------------

test('a genuine missing paren at end of line keeps TF010’s paren advice', () => {
  // Back-off degrades exactly one shape. In every keyword-terminated position the enclosing
  // production has something sharper to say (``expected `from`, found `extra` ``); at end of line it
  // has only ``expected end of line``, so the note carries the original message to where the
  // mistake is now visible.
  const [diag, ...rest] = errorsOf(`test "t"\n  let a = create order\n`);
  assert.deepEqual(rest, []);
  assert.equal(diag?.code, Codes.UNEXPECTED_TOKEN);
  // The exact sentence, not merely "some TF010" — the generic ``unexpected `order` at end of step``
  // is also TF010, so a code-only assertion could not tell "the note fired" from "the note was
  // never written". That is the control this test needs and the reason it is spelled out.
  assert.equal(diag?.message, '`create` looks like the start of a call but never reaches `(`');
  assert.match(diag?.hint ?? '', /multi-word calls need parens/);
});

test('the back-off note expires: a later unrelated error gets its own message', () => {
  // The note is one slot, keyed to the parser position it was taken at, and `this.pos` only ever
  // increases. Here the back-off is consumed successfully by `random number` (no error at all), and
  // the error arrives later, in a different step, at a different span.
  const source = `test "t"\n  let lo = 1\n  let hi = 9\n  let x = random number lo to hi\n  api GET /health\n  expect status equals 200 extra\n`;
  const diags = errorsOf(source);
  assert.equal(diags.length, 1);
  assert.doesNotMatch(diags[0]?.message ?? '', /looks like the start of a call/);
  assert.doesNotMatch(diags[0]?.hint ?? '', /multi-word calls need parens/);
  // Control: the note demonstrably *can* reach a diagnostic — the test above proves it fires when
  // the cursor has not moved. Mutating the lifetime guard so the note outlives its token turns this
  // test red while that one stays green, which is the pair that makes either one meaningful.
});

test('multi-word calls are still multi-word', () => {
  // 44 multi-word calls in the corpus make this the cheapest possible regression to introduce and
  // the easiest to miss: if the back-off ran one token too eagerly, `create widget("w-1")` would
  // parse as `VarRef(create)` followed by junk and every one of them would break at once.
  const source = `action create widget(id)\n  api GET /health\n  expect status equals 200\n\ntest "t"\n  let w = create widget("w-1")\n  api GET /health\n  expect status equals 200\n`;
  assert.deepEqual(errorsOf(source), []);

  const { program } = parse(source);
  const step = program.tests[0]?.body[0];
  assert.equal(step?.type, 'LetStmt');
  const call = (step as unknown as { value: { type: string; name?: string } }).value;
  assert.equal(call.type, 'CallExpr');
  assert.equal(call.name, 'create widget', 'the call kept both words of its name');
});

// ---- D168b: the recovery node does not get double-reported ----------------------------------

test('the recovery VarRef is not also reported as an unknown variable', () => {
  // D167 returns `VarRef(create)` so the parser can keep going. Before D168b the checker then read
  // that invented node and added ``unknown variable "create"`` underneath the paren advice: one
  // mistake, two errors, the second one nonsense. Before D167 the production returned `null`, so
  // there was no node to misread — this is a regression D167 introduced and D168b closes.
  const diags = allDiagnostics(`test "t"\n  let a = create order\n`);
  assert.deepEqual(
    diags.map((d) => d.code),
    [Codes.UNEXPECTED_TOKEN],
  );
});

test('suppression is by span, not by name', () => {
  // The control that makes the test above safe. `recoveredSpans` holds offsets, so a *different*
  // reference to the same word is untouched — suppressing by name would silence a genuine `create`
  // bound (or not bound) elsewhere in the file, trading a cosmetic duplicate for a missed error.
  const diags = allDiagnostics(`test "t"\n  let a = create order\n  api GET /health\n  expect body.id equals create\n`);
  assert.deepEqual(
    diags.map((d) => d.code),
    [Codes.UNEXPECTED_TOKEN, Codes.UNKNOWN_VARIABLE],
  );
  assert.match(diags[1]?.message ?? '', /unknown variable "create"/);
});

test('recoveredSpans is absent from every program that parses', () => {
  // The field is recovery metadata, so anything else means the parser is quietly taking the
  // back-off path on healthy input — and the suppression above would then be hiding real
  // diagnostics rather than invented ones.
  //
  // *Absent*, not merely empty: written as a required field first, it changed the serialised AST of
  // every program in the language and turned all 31 parser golden files red. A healthy program's
  // AST has to stay byte-identical or those goldens stop asserting what they were written to
  // assert, which is why this asserts the key is not there at all.
  const { program } = parse(
    `action create widget(id)\n  api GET /health\n  expect status equals 200\n\ntest "t"\n  let lo = 1\n  let hi = 9\n  let x = random number lo to hi\n  let w = create widget("w-1")\n  api GET /health\n  expect status equals 200\n`,
  );
  assert.equal(Object.hasOwn(program, 'recoveredSpans'), false);

  // Control: a program that *does* back off carries exactly one span, so the assertion above is the
  // key being withheld rather than the field never being written to at all.
  const recovering = parse(`test "t"\n  let a = create order\n`).program;
  assert.equal(Object.hasOwn(recovering, 'recoveredSpans'), true);
  assert.equal(recovering.recoveredSpans?.length, 1);
});
