// The grammar + checker half of review finding `FU-11` (M96): `expect`/`check` accept a
// `{name}` / `{name.path}` value subject, so a `let`/`capture`d value can be asserted *on* rather
// than only compared against.
//
// The rule `FU-11` broke was enforced by **position** (which side of the matcher a value sits on)
// while the principle it claimed was about **provenance** (is this from the system under test) — so
// it banned captured values and permitted `2 + 2` smuggled through a request body. Its documented
// workaround told you to make the SUT carry back a value the test already had.
//
// Every test here has a stated negative control: the reverted-source behaviour it distinguishes
// itself from (`M92d` — a negative control that cannot fail is a passing test of nothing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkProgram, checkUnknownVariables, checkResponseScopes, checkValueSubjects, checkRequestAssertions } from '../src/index.js';

const src = (body: string): string => `test "t"\n${body}\n`;

// ---- D129: the grammar -----------------------------------------------------

test('a `{name}` subject parses (FU-11)', () => {
  // Control: on reverted source this is `TF013 expected a subject (…), found \`{\`` — `{` died
  // before the grammar was consulted.
  const { program, diagnostics } = parseSource(src('  let n = 5\n  expect {n} is greater than 0'));
  assert.deepEqual(diagnostics, []);
  const stmt = program.tests[0]!.body[1]!;
  assert.equal(stmt.type, 'ExpectStmt');
  assert.equal(stmt.type === 'ExpectStmt' && stmt.subject.type, 'ValueSubject');
});

test('a `{name.path[0]}` subject keeps its whole path (FU-11)', () => {
  const { program, diagnostics } = parseSource(src('  let o = 1\n  expect {o.items[2].price} equals 3'));
  assert.deepEqual(diagnostics, []);
  const stmt = program.tests[0]!.body[1]!;
  assert.equal(stmt.type, 'ExpectStmt');
  if (stmt.type !== 'ExpectStmt' || stmt.subject.type !== 'ValueSubject') return assert.fail('not a value subject');
  assert.deepEqual(stmt.subject.ref, [
    { kind: 'prop', name: 'o' },
    { kind: 'prop', name: 'items' },
    { kind: 'index', index: 2 },
    { kind: 'prop', name: 'price' },
  ]);
});

test('`check` takes a value subject too, not just `expect` (FU-11)', () => {
  // `check` parses its own subject/quantifier (`parseCheckStep`), so it is a genuinely separate
  // code path — this is not a restatement of the `expect` case above.
  const { program, diagnostics } = parseSource(src('  let n = 5\n  check {n} equals 5'));
  assert.deepEqual(diagnostics, []);
  const stmt = program.tests[0]!.body[1]!;
  assert.equal(stmt.type === 'ExpectStmt' && stmt.soft, true);
  assert.equal(stmt.type === 'ExpectStmt' && stmt.subject.type, 'ValueSubject');
});

test('a bare identifier is still not a subject — the collision stays an error (D129)', () => {
  // The whole reason subject position takes `{n}` and not `n`: `text`/`status`/`list`/… are
  // subject keywords, so a bare-ident rule would make `let text = "hi"` silently assert on a UI
  // locator. `n` is not a keyword, so it must be an error rather than quietly becoming one.
  const { diagnostics } = parseSource(src('  let n = 5\n  expect n equals 5'));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'TF013');
  assert.match(diagnostics[0]!.hint ?? '', /write `\{n\}`/);
});

test('a *misspelled* keyword still gets its did-you-mean, not the brace hint (D133 #2)', () => {
  // The brace hint is gated on the did-you-mean being absent. Without that gate, `statuss` — an
  // obvious typo — would be told to write `{statuss}`, teaching the wrong fix.
  const { diagnostics } = parseSource(src('  api GET /x\n  expect statuss equals 200'));
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.hint ?? '', /did you mean `status`\?/);
  assert.doesNotMatch(diagnostics[0]!.hint ?? '', /\{statuss\}/);
});

test('a locator keyword with no selector names the value reading (D133 #3)', () => {
  // M96 *creates* this trap: before `FU-11` nobody wrote `expect text equals "hi"` meaning a
  // variable, because no variable was assertable. Control: reverted source says only "expected a
  // string", pointing at the token and not at the misreading.
  const { diagnostics } = parseSource(src('  let text = "hi"\n  expect text equals "hi"'));
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.hint ?? '', /if you meant a value you bound.*write `\{text\}`/);
});

test('the subject expectation names `{variable}` at both TF013 sites (D133 #1)', () => {
  const notAnIdent = parseSource(src('  api GET /x\n  expect 42 equals 200')).diagnostics;
  assert.equal(notAnIdent.length, 1);
  assert.match(notAnIdent[0]!.message, /or a `\{variable\}`/);
});

// ---- D130: `capture` rejects it --------------------------------------------

test('`capture {x} as y` is rejected and points at `let` (D130)', () => {
  // Control: on reverted source `parseCapture` shares `parseSubject`, so this would have become
  // legal *for free* — duplication arriving by inheritance rather than by anyone choosing it.
  const { diagnostics } = parseSource(src('  let x = 1\n  capture {x} as y'));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'TF013');
  assert.match(diagnostics[0]!.message, /`capture` reads a value out of a response/);
  assert.match(diagnostics[0]!.hint ?? '', /`let savedId = \{orderId\}`/);
});

// ---- D131: quantifiers -----------------------------------------------------

test('`any`/`all` accept a value subject (D131)', () => {
  const { diagnostics } = parseSource(src('  let items = 1\n  expect all {items.price} is greater than 0'));
  assert.deepEqual(diagnostics, []);
});

test('a quantifier on a non-quantifiable subject is still rejected (D131)', () => {
  // The paired half: widening the gate must not blow it open. `status` is not an array.
  const { diagnostics } = parseSource(src('  api GET /x\n  expect any status equals 200'));
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /only applies to a `body\.<path>`, `body csv`, or `\{variable\}` subject/);
});

test('the path must live inside the braces (D131)', () => {
  // `{items}.price` would fork the `{` rule D129 made total, so it must not parse as a subject
  // with a trailing path.
  const { diagnostics } = parseSource(src('  let items = 1\n  expect all {items}.price is greater than 0'));
  assert.notEqual(diagnostics.length, 0);
});

// ---- D132/D136a: TF041 -----------------------------------------------------

test('a live-handle matcher on a value subject is TF041 (D132)', () => {
  // Control: on reverted source `expect {x} is visible` does not parse at all, so this test would
  // pass for the wrong reason — hence the parse assertion first. `TF041` must be what rejects it.
  const { program, diagnostics } = parseSource(src('  let x = 1\n  expect {x} is visible'));
  assert.deepEqual(diagnostics, [], 'it must parse — TF041, not the grammar, is what rejects this');
  const diags = checkValueSubjects(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF041');
  assert.match(diags[0]!.message, /needs a live browser element, page, or request/);
});

test('every live-handle matcher is rejected, and no value matcher is (D132)', () => {
  // The partition itself, stated once. A matcher moving between halves without this test would be
  // a silent behaviour change.
  const live = ['is visible', 'is hidden', 'is enabled', 'is disabled', 'is checked', 'has value "x"', 'matches snapshot "s"', 'has no a11y violations', 'connects', 'fails', 'was made'];
  for (const m of live) {
    const { program, diagnostics } = parseSource(src(`  let x = 1\n  expect {x} ${m}`));
    assert.deepEqual(diagnostics, [], `\`${m}\` must parse`);
    assert.equal(checkValueSubjects(program).length, 1, `\`${m}\` must be TF041`);
  }
  // `matches file` is pointedly in the *allowed* half — its "Applies to" reads `body bytes`, which
  // looks browser-ish but is an ordinary capturable subject. Allowing it is what lets a binary body
  // outlive its request.
  const value = ['equals 1', 'contains "x"', 'matches "x"', 'matches subset { a: 1 }', 'is greater than 1', 'is less than 1', 'has count 1', 'matches file "x.pdf"'];
  for (const m of value) {
    const { program, diagnostics } = parseSource(src(`  let x = 1\n  expect {x} ${m}`));
    assert.deepEqual(diagnostics, [], `\`${m}\` must parse`);
    assert.deepEqual(checkValueSubjects(program), [], `\`${m}\` must stay a runtime concern`);
  }
});

test('a value subject inside `wait until api` is TF041 (D136a)', () => {
  // It cannot change between polls, so it either passes on the first attempt — a no-op dressed as
  // a wait condition — or times out blaming an endpoint that never controlled it.
  const { program, diagnostics } = parseSource(src('  let x = 1\n  wait until api GET /x\n    expect {x} equals 1'));
  assert.deepEqual(diagnostics, []);
  const diags = checkValueSubjects(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF041');
  assert.match(diags[0]!.hint ?? '', /cannot change between polls/);
});

test('a value subject outside `wait until api` in the same test is fine (D136a)', () => {
  // The paired half — the rejection must be about the position, not about the file containing a
  // `wait until api` at all.
  const { program } = parseSource(src('  let x = 1\n  expect {x} equals 1\n  wait until api GET /x\n    expect status equals 200'));
  assert.deepEqual(checkValueSubjects(program), []);
});

test('checkValueSubjects reaches nested block bodies', () => {
  const { program } = parseSource(src('  let x = 1\n  within css "#main"\n    expect {x} is visible'));
  assert.equal(checkValueSubjects(program).length, 1);
});

// ---- D133/TF030: an unbound name is still caught ---------------------------

test('an unbound `{typo}` subject is TF030 (M96)', () => {
  // Without `checkSubject`'s new walk this would parse, check clean, and fail at run time with the
  // very diagnostic the pass exists to move earlier.
  const { program } = parseSource(src('  let x = 1\n  expect {typo} equals 1'));
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF030');
});

// ---- TF039: the exemption, and its paired control --------------------------

test('a value assertion may be a test\'s first step (TF039 exemption)', () => {
  const { program } = parseSource(src('  let x = 1\n  expect {x} equals 1'));
  assert.deepEqual(checkResponseScopes(program), []);
});

test('a *response* assertion as a test\'s first step still errors (TF039 paired control)', () => {
  // An exemption is the easiest way to silently blow a hole in a working guard. Both halves, or
  // neither: this is the half that proves the guard still guards.
  const { program } = parseSource(src('  expect status equals 200'));
  const diags = checkResponseScopes(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF039');
});

test('a `capture` before any api step still errors, beside an exempt value assertion (TF039)', () => {
  const { program } = parseSource(src('  let x = 1\n  expect {x} equals 1\n  capture body.id as y'));
  const diags = checkResponseScopes(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF039');
});

// ---- checkRequestAssertions: the exclusion ---------------------------------

test('a value assertion may sit beside `expect request fails` (M96)', () => {
  // It reads a binding, not this request's connection state, so it is orthogonal to the
  // connects/fails restriction rather than an incompatible response assertion.
  const { program } = parseSource(src('  let code = 7\n  api GET /x\n  expect request fails\n  expect {code} equals 7'));
  assert.deepEqual(checkRequestAssertions(program), []);
});

test('a *response* assertion beside `expect request fails` still errors (paired control)', () => {
  const { program } = parseSource(src('  api GET /x\n  expect request fails\n  expect status equals 200'));
  assert.equal(checkRequestAssertions(program).length, 1);
});

// ---- the composed pass list ------------------------------------------------

test('checkProgram runs checkValueSubjects (M60: one call site to forget)', () => {
  // `checkProgram` exists because the CLI, the LSP and the docs demo each assembled their own
  // drifted pass list. A new pass that nothing composed would be a checker that is right in its
  // unit test and absent from every product surface.
  const { program } = parseSource(src('  let x = 1\n  expect {x} is visible'));
  assert.equal(checkProgram(program).some((d) => d.code === 'TF041'), true);
});
