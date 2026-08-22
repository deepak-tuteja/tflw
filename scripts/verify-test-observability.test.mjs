// The vacuous-assertion scanner's own first tests (`M147-06`, `M147f`).
//
// ## Why it had none, and why that mattered
//
// `verify-test-observability.mjs` exists to answer one question — *can the pipeline this test
// actually invokes emit the code this test names?* — and it answers it by resolving each test's
// local helpers back to a pipeline stage. That resolver is the whole instrument. It shipped with no
// tests at all, unlike `verify-ledger.mjs` next door, and for nine milestones it silently dropped
// any arrow helper whose return-type annotation was longer than twenty characters.
//
// Both directions of that were wrong, and the quiet one is worse. Loud: nine tests in
// `importedCalls.test.ts` were reported `this assertion cannot fail` while every one of them calls
// `checkProgram` one frame down — and the cheapest way to silence a false `✗` is to delete the code
// name from the test, so the tool would have degraded the assertions it exists to protect. Quiet: a
// test whose *only* harness is such a helper resolves to no stage at all and lands in the
// `reached no known pipeline entry point (not analysed)` list, which is printed and does not fail.
// That list stood at 29 on the run that found this.
//
// So the cases below are about the resolver, not the report: what it registers, what it refuses,
// and — the pair that actually matters — that a long annotation and a short one now resolve the
// same, since the bug was never "helpers don't work", it was "long ones don't".

import test from 'node:test';
import assert from 'node:assert/strict';

import { findLocalHelpers, isReturnAnnotation } from './verify-test-observability.mjs';

// ---- isReturnAnnotation: what may sit between `)` and `=>` --------------------------------------

test('nothing between the parameter list and the arrow is the ordinary case', () => {
  assert.equal(isReturnAnnotation(''), true);
  assert.equal(isReturnAnnotation('  '), true);
});

test('a short return annotation is accepted, as it always was', () => {
  assert.equal(isReturnAnnotation(': Diagnostic[]'), true);
});

test('a LONG return annotation is accepted — the defect, stated as a case', () => {
  // 36 characters past the close paren. The old `arrow > closeParen + 20` rejected exactly this.
  assert.equal(isReturnAnnotation(': ReturnType<typeof checkProgram>'), true);
  assert.equal(isReturnAnnotation(': Array<readonly DiagnosticWithSourceSpan[]>'), true);
});

test('length is no longer the discriminator, and this is the case that says so', () => {
  // The control on the fix. If someone reintroduces a window, one of these two must break; asserting
  // only the long case would let a *wider* window pass while still being a window.
  const short = ': A';
  const long = `: ${'VeryLongTypeName'.repeat(20)}`;
  assert.equal(isReturnAnnotation(short), isReturnAnnotation(long));
  assert.equal(isReturnAnnotation(long), true);
});

test('statement punctuation is refused — it means the match ran past the arrow', () => {
  // `;`, `{`, `}` and `=` cannot appear in a return annotation but can appear in the code a runaway
  // match would swallow, so their absence is the discriminator that replaces the character count.
  for (const bad of [': A; const x', ': { a: number }', ': A } else {', ': A = 1']) {
    assert.equal(isReturnAnnotation(bad), false, bad);
  }
});

test('text that is not an annotation at all is refused', () => {
  assert.equal(isReturnAnnotation('foo'), false);
});

// ---- findLocalHelpers: the resolver over real declaration shapes --------------------------------

const bodyOf = (code, name) => findLocalHelpers(code).get(name);

test('a plain arrow const is registered with its body', () => {
  const src = 'const check = (s) => {\n  return checkProgram(s);\n};\n';
  assert.ok(findLocalHelpers(src).has('check'));
  assert.match(bodyOf(src, 'check'), /checkProgram/);
});

test('an arrow const with a LONG return annotation is registered too (`M147-06`)', () => {
  // Verbatim the shape from `importedCalls.test.ts` that produced nine false findings.
  const src = 'const check = (source: string, imported: KnownAction[]): ReturnType<typeof checkProgram> => {\n  return checkProgram(source, imported);\n};\n';
  const helpers = findLocalHelpers(src);
  assert.ok(helpers.has('check'), 'the helper was dropped, so any test calling it resolves elsewhere or nowhere');
  assert.match(helpers.get('check'), /checkProgram/);
});

test('the long and short forms of the same helper resolve identically', () => {
  // The bug was never "helpers are not registered" — it was "long ones are not". A test that only
  // checked the long form would pass against a resolver that had started dropping the short one.
  const short = 'const check = (s: string): Diagnostic[] => {\n  return checkProgram(s);\n};\n';
  const long = 'const check = (s: string): ReturnType<typeof checkProgram> => {\n  return checkProgram(s);\n};\n';
  assert.deepEqual(bodyOf(short, 'check'), bodyOf(long, 'check'));
});

test('a declared function is registered, and its body stops at its own closing brace', () => {
  const src = 'function harness(s) {\n  return parseSource(s);\n}\n\nfunction other() {\n  return lex(s);\n}\n';
  const helpers = findLocalHelpers(src);
  assert.match(helpers.get('harness'), /parseSource/);
  assert.doesNotMatch(helpers.get('harness'), /lex\(/, 'the body ran past its own brace and swallowed the next helper');
});

test('an expression-bodied arrow is registered up to its semicolon', () => {
  const src = 'const check = (s) => checkProgram(s);\nconst other = (s) => lex(s);\n';
  const helpers = findLocalHelpers(src);
  assert.match(helpers.get('check'), /checkProgram/);
  assert.doesNotMatch(helpers.get('check'), /lex\(/);
});

test('an async arrow const is registered', () => {
  const helpers = findLocalHelpers('const run = async (s) => {\n  return parseSource(s);\n};\n');
  assert.ok(helpers.has('run'));
});

test('a multi-line parameter list does not break the arrow lookup', () => {
  // `matchParen` walks the real parens, so a wrapped signature — common once an annotation is long
  // enough to push the line over the printer's width — must still resolve.
  const src = 'const check = (\n  source: string,\n  imported: KnownAction[],\n): ReturnType<typeof checkProgram> => {\n  return checkProgram(source, imported);\n};\n';
  assert.ok(findLocalHelpers(src).has('check'));
});
