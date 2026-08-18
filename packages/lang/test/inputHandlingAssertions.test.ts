// The Tier 3 grammar and its two static rules (M134a, PLAN_M134_PENTEST_TIER3.md D366/D372/D382,
// SPEC §9.12).
//
// Two rules, and both are borrowed rather than invented — which is most of what this file asserts:
//
//   TF067  assert it on a step that has something to mutate
//   TF064  move it off `wait until api`      (widened from Tier 2, not duplicated)
//   TF033  move it out of a workload-bearing test
//
// **The absences matter as much as the rules.** Tier 3 changes no identity, so it needs no owner —
// there is deliberately no `TF062`/`TF063` analogue here, and a test that quietly acquired one
// would mean the tier had grown a session dependency nobody decided on. That negative is asserted
// below rather than left as a fact about code nobody reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_SUB_CLAUSES } from '../src/parser.js';
import { parseSource, parseConfigSource, checkAuthzAssertions, Codes, type ProgramCheckOptions } from '../src/index.js';

const ASSERT = 'expect response has no input handling violations';

function codes(source: string, opts: ProgramCheckOptions = {}): string[] {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkAuthzAssertions(program, opts).map((d) => d.code);
}

function firstDiag(source: string, opts: ProgramCheckOptions = {}) {
  const { program } = parseSource(source);
  return checkAuthzAssertions(program, opts)[0];
}

const inTest = (...steps: string[]): string => `test "t"\n${steps.map((s) => `  ${s}`).join('\n')}\n`;

// --- the grammar: two bare words, because the lexer has no hyphen (D366) --------------------------

test('`has no input handling violations` parses, with and without a severity floor', () => {
  for (const floor of ['', 'minor ', 'moderate ', 'serious ', 'critical ']) {
    const { diagnostics } = parseSource(inTest('api GET /orders/1', `expect response has no ${floor}input handling violations`));
    assert.deepEqual(diagnostics, [], `\`has no ${floor}input handling violations\` must parse`);
  }
});

test('the hyphenated spelling is a parse error, and that is why the keyword is two bare words', () => {
  // `isIdentCont` is `/[A-Za-z0-9_]/` and `-` lexes as `minus`, so `input-handling` arrives as three
  // tokens. This test is the record of *why* the plan's D366 spelling could not ship as written —
  // and the guard against somebody "fixing" the keyword back to it.
  const { diagnostics } = parseSource(inTest('api GET /orders/1', 'expect response has no input-handling violations'));
  assert.ok(diagnostics.length > 0, 'a hyphen cannot appear in a tflw keyword');
});

test('the severity floor still has to come before the scan phrase', () => {
  const { diagnostics } = parseSource(inTest('api GET /orders/1', 'expect response has no input handling serious violations'));
  assert.ok(diagnostics.length > 0);
});

test('a misspelled first word suggests the WHOLE phrase, not the word that matched', () => {
  // A hint offering a bare `input` would send the reader to the next error rather than past it,
  // which is the property `suggestions.test.ts`'s round-trip guard exists to hold.
  const { diagnostics } = parseSource(inTest('api GET /orders/1', 'expect response has no inpt handling violations'));
  const hint = diagnostics[0]?.hint ?? '';
  assert.match(hint, /input handling/);
});

test('the error names all four scans, so a fifth cannot leave it naming three', () => {
  const { diagnostics } = parseSource(inTest('api GET /orders/1', 'expect response has no zzz violations'));
  const message = diagnostics[0]?.message ?? '';
  for (const phrase of ['a11y', 'security', 'authorization', 'input handling']) assert.match(message, new RegExp(phrase));
});

// --- the grammar: the two new `probe` sibling lines (D372) ------------------------------------------

test('`probe oversized` and `probe traversal` parse as siblings of `probe mutating`', () => {
  const source = `defaults\n  authorized target "http://localhost:4001" reason "fixture"\n    probe mutating\n    probe oversized\n    probe traversal\n`;
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics, []);
  const decl = config.defaults?.entries.find((e) => e.type === 'AuthorizedTargetDecl');
  assert.ok(decl && decl.type === 'AuthorizedTargetDecl');
  assert.deepEqual(
    { m: decl.probeMutating, o: decl.probeOversized, t: decl.probeTraversal },
    { m: true, o: true, t: true },
  );
});

test('each sibling is independent — declaring one grants only itself', () => {
  // Walked in both directions rather than once. A sub-clause table wired to the wrong field is the
  // defect this catches, and a single-direction test passes for half of them.
  //
  // **The word list is derived from `PROBE_SUB_CLAUSES`, and the expected field is not.** M137g
  // found this test hand-listing three words and three fields, which meant a fourth clause would
  // have been silently uncovered by the very test that exists to catch a mis-wired clause. Deriving
  // the words fixes the coverage; deriving the *expectation* from the same table the parser reads
  // would have made it a tautology, so the field name is recomputed here from the naming convention
  // instead. A future clause that breaks that convention fails loudly, which is the right prompt.
  for (const word of PROBE_SUB_CLAUSES) {
    const granted = `probe${word[0]!.toUpperCase()}${word.slice(1)}` as const;
    const source = `defaults\n  authorized target "http://localhost:4001" reason "fixture"\n    probe ${word}\n`;
    const { config, diagnostics } = parseConfigSource(source);
    assert.deepEqual(diagnostics, [], `\`probe ${word}\` must parse`);
    const decl = config.defaults?.entries.find((e) => e.type === 'AuthorizedTargetDecl');
    assert.ok(decl && decl.type === 'AuthorizedTargetDecl');
    const actual = Object.fromEntries(PROBE_SUB_CLAUSES.map((w) => [w, decl[`probe${w[0]!.toUpperCase()}${w.slice(1)}` as 'probeMutating']]));
    const expected = Object.fromEntries(PROBE_SUB_CLAUSES.map((w) => [w, `probe${w[0]!.toUpperCase()}${w.slice(1)}` === granted]));
    assert.deepEqual(actual, expected, `\`probe ${word}\` granted the wrong clause`);
  }
});

test('the bare one-line declaration still grants nothing, and still parses', () => {
  // `tflw-acceptance/security/tflw.config` is on `main` written this way; D330's rule is that the
  // sub-clauses are lines *beneath*, never a reformatting of the line above.
  const { config, diagnostics } = parseConfigSource(`defaults\n  authorized target "http://localhost:4001" reason "fixture"\n`);
  assert.deepEqual(diagnostics, []);
  const decl = config.defaults?.entries.find((e) => e.type === 'AuthorizedTargetDecl');
  assert.ok(decl && decl.type === 'AuthorizedTargetDecl');
  assert.deepEqual({ m: decl.probeMutating, o: decl.probeOversized, t: decl.probeTraversal }, { m: false, o: false, t: false });
});

test('a misspelled sub-clause suggests the nearest real one', () => {
  const { diagnostics } = parseConfigSource(`defaults\n  authorized target "http://localhost:4001" reason "fixture"\n    probe traversl\n`);
  assert.match(diagnostics[0]?.hint ?? '', /probe traversal/);
});

// --- TF067: nothing to mutate (D382) -----------------------------------------------------------------

test('TF067: a request with no id, no query and no body has nothing to mutate', () => {
  assert.deepEqual(codes(inTest('api GET /health', ASSERT)), [Codes.INPUT_ASSERTION_NO_MUTABLE_INPUT]);
});

test('TF067: the hint names all three kinds of site, because any one of them is the repair', () => {
  const d = firstDiag(inTest('api GET /health', ASSERT));
  assert.match(d!.hint ?? '', /id.*query parameter.*JSON body/s);
  assert.match(d!.hint ?? '', /TF067/);
});

test('TF067 stays silent where the request does have a site', () => {
  // The negative control. Each of these is one of the three site kinds, and if any goes red the
  // rule has widened into the case the feature exists for.
  assert.deepEqual(codes(inTest('api GET /orders/7', ASSERT)), [], 'an identifier path segment is a site');
  assert.deepEqual(codes(inTest('api GET /search?q=shoes', ASSERT)), [], 'a query parameter is a site');
  assert.deepEqual(codes(inTest('api POST /notes body { text: "hi" }', ASSERT)), [], 'a JSON body leaf is a site');
});

test('TF067 stays silent wherever the checker cannot know — every uncertainty answers "maybe"', () => {
  // The direction that refuses no correct file. Interpolation can produce an id segment or a whole
  // query string; a `body from` file is not the checker's to read; raw text may well be JSON.
  assert.deepEqual(codes(`test "t"\n  let id = "7"\n  api GET /orders/{id}\n  ${ASSERT}\n`), []);
  assert.deepEqual(codes(inTest('api POST /notes body from "./payload.json"', ASSERT)), []);
  assert.deepEqual(codes(inTest('api POST /notes body text "{a:1}"', ASSERT)), []);
});

test('TF067 fires on a form body, which provably yields no JSON leaf', () => {
  assert.deepEqual(codes(inTest('api POST /notes form a=1, b=2', ASSERT)), [Codes.INPUT_ASSERTION_NO_MUTABLE_INPUT]);
});

// --- the borrowed rules ------------------------------------------------------------------------------

test('TF064: inside `wait until api`, the same code and the same repair as Tier 2', () => {
  const src = `test "t"\n  wait until api GET /orders/1\n    expect status equals 200\n    ${ASSERT}\n`;
  assert.deepEqual(codes(src), [Codes.SCAN_ASSERTION_REPEATED_REQUEST]);
});

test('TF033: inside a workload-bearing test, and the hint says why it is worse here than in Tier 2', () => {
  const src = `test "t"\n  ramp to 5 users over 1s\n  api GET /orders/7\n  ${ASSERT}\n`;
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${src}`);
  const diags = checkAuthzAssertions(program);
  assert.ok(diags.some((d) => d.code === Codes.LOAD_INVALID));
  // One probe *per payload per mutable input*, not one per principal — the multiplication is an
  // order of magnitude worse than the rule it is borrowed from, and the hint has to say so.
  assert.match(diags.find((d) => d.code === Codes.LOAD_INVALID)!.hint ?? '', /per payload per mutable input/);
});

// --- the absences (the tier changes no identity) --------------------------------------------------------

test('an unowned test is fine — this tier needs no `as <session>` at all (D370)', () => {
  // Tier 2's `TF063` has no analogue here, and this is the assertion that says so. If a future
  // change makes an owner necessary, this test names the day it happened.
  assert.deepEqual(codes(inTest('api GET /orders/7', ASSERT)), []);
});

test('a suite whose every session is `privileged` is still fine — there is no probe set to empty', () => {
  assert.deepEqual(codes(inTest('api GET /orders/7', ASSERT), { knownSessions: ['admin'], privilegedSessions: ['admin'] }), []);
});

test('a step naming its own `Authorization` header is fine — nothing is stripped, so nothing is confused', () => {
  const src = `test "t"\n  api GET /orders/7\n    header "Authorization" is "Bearer x"\n  ${ASSERT}\n`;
  assert.deepEqual(codes(src), []);
});

test('the `check` form is the same assertion and is judged the same way', () => {
  assert.deepEqual(codes(inTest('api GET /health', 'check response has no input handling violations')), [Codes.INPUT_ASSERTION_NO_MUTABLE_INPUT]);
});
