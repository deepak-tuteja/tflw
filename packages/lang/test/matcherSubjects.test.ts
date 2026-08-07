// M97b (`PLAN_M97_CHECKER_CONTRACT.md`, D140) — `A4-15` and `A4-11`: matcher↔subject-kind and
// quantifier↔matcher compatibility, decided by the checker instead of surfacing mid-run.
//
// SPEC §1 called this "a documented gap … a post-v0.1 item", and the runtime comment at
// `interpreter.ts`'s `evaluateNetworkExpect` said the same in as many words. It was an honest gap,
// paid for on every run: `expect status is visible` linted green and then failed after the request
// with `matcher \`visible\` is not supported on an API subject` — a mistake fully visible in the
// source text, reported at the worst possible moment.
//
// The design risk this file exists to hold down is **not** that a rule is missing. It is that the
// rule is drawn one axis too wide. `contains` documents "strings, arrays"; reading that as a static
// claim about `body.msg` would start rejecting correct programs — `A4-05`'s false-positive failure
// mode arriving as the fix for `A4-11`. So the last group below asserts the *permissive* half:
// every shape question stays a runtime error. Those tests fail if someone later "tightens" the
// manifest, which is exactly when someone would.
//
// Every test states its negative control (`M92d` — a negative control that cannot fail is a
// passing test of nothing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkProgram, checkMatcherSubjects, checkValueSubjects, Codes } from '../src/index.js';
import { MATCHERS, MATCHER_ROW_BY_NAME, type SubjectKind } from '../src/spec-data.js';
import type { MatcherName } from '../src/ast.js';

const src = (body: string): string => `test "t"\n${body}\n`;
const codes = (source: string): string[] => {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse: ${source}`);
  return checkMatcherSubjects(program).map((d) => d.code);
};

/**
 * One writable example per `MatcherName`, against a subject of each kind the checker recognises.
 * Written out rather than generated: the point is to exercise the real grammar, and a generator
 * would share whichever assumption the manifest already encodes.
 */
const SUBJECT_SOURCE: Readonly<Record<SubjectKind, string>> = {
  value: 'status',
  locator: 'button "Pay"',
  page: 'page',
  request: 'request',
  'network-request': 'request to "/api/orders"',
};

/** Matcher clause text, keyed by AST `MatcherName`. */
const MATCHER_SOURCE: Readonly<Record<MatcherName, string>> = {
  equals: 'equals 1',
  contains: 'contains "x"',
  matches: 'matches "x"',
  matchesSubset: 'matches subset { a: 1 }',
  matchesSchema: 'matches schema "W" from "/openapi.json"',
  matchesFile: 'matches file "./f.bin"',
  greaterThan: 'is greater than 1',
  lessThan: 'is less than 1',
  hasCount: 'has count 1',
  hasValue: 'has value "x"',
  visible: 'is visible',
  hidden: 'is hidden',
  enabled: 'is enabled',
  disabled: 'is disabled',
  checked: 'is checked',
  connects: 'connects',
  fails: 'fails',
  wasMade: 'was made',
  hasNoA11yViolations: 'has no critical a11y violations',
  matchesSnapshot: 'matches snapshot "s"',
};

const ALL_MATCHERS = Object.keys(MATCHER_SOURCE) as MatcherName[];
const ALL_KINDS = Object.keys(SUBJECT_SOURCE) as SubjectKind[];
const rowFor = (name: MatcherName) => MATCHERS.find((m) => m.id === MATCHER_ROW_BY_NAME[name])!;

// ---- the manifest itself ---------------------------------------------------

test('`MATCHER_ROW_BY_NAME` is total over `MatcherName` and lands on real rows', () => {
  // The link that makes a new matcher impossible to add silently: without it, an unmapped name
  // falls out of `checkMatcherSubjects` unchecked and everything below still passes.
  // Control: drop any entry and this names it.
  const ids = new Set(MATCHERS.map((m) => m.id));
  for (const name of ALL_MATCHERS) {
    const id = MATCHER_ROW_BY_NAME[name];
    assert.ok(id, `no MATCHERS row mapped for matcher \`${name}\` — add one to MATCHER_ROW_BY_NAME`);
    assert.ok(ids.has(id), `matcher \`${name}\` maps to "${id}", which is not a MATCHERS id`);
  }
});

test('`MATCHER_SOURCE` covers every `MatcherName` the AST declares', () => {
  // Guards this file rather than the source: a matcher added to the union but not here would be
  // untested while every test below went on passing. Reads the union through the manifest, which
  // the test above pins to `MatcherName`.
  const mapped = new Set(Object.keys(MATCHER_ROW_BY_NAME));
  const missing = [...mapped].filter((n) => !(n in MATCHER_SOURCE));
  assert.deepEqual(missing, [], 'add these matchers to MATCHER_SOURCE so they are exercised below');
});

test('every structured subject kind is still claimed by the row\'s own prose', () => {
  // D140's drift guard, and it only goes one way on purpose: it catches "added a subject kind,
  // forgot the docs", not prose rewording. A stricter comparison would fight `gen-spec-tables.mjs`,
  // whose output is deliberately byte-identical to the hand-written table it replaced.
  // Control: add 'page' to `equals`' subjects and this fires — 'any value' claims no page.
  const MARKERS: Readonly<Record<SubjectKind, readonly string[]>> = {
    value: ['value', 'string', 'array', 'object', 'number', 'duration', 'bytes'],
    locator: ['UI'],
    page: ['`page`'],
    request: ['`request`'],
    'network-request': ['`request to'],
  };
  const undocumented: string[] = [];
  for (const row of MATCHERS) {
    for (const kind of row.subjects) {
      if (!MARKERS[kind].some((m) => row.appliesTo.includes(m))) {
        undocumented.push(`${row.id} claims "${kind}", but its "Applies to" reads ${row.appliesTo}`);
      }
    }
  }
  assert.deepEqual(undocumented, [], 'SPEC §6.2 and the checker have to say the same thing — update the `appliesTo` prose too');
});

test('`TF041` covers exactly the matchers this manifest denies a value', () => {
  // M96 hand-wrote `LIVE_HANDLE_MATCHERS`; M97b derived `subjects` from the runtime. The two sets
  // came out identical, and this asserts that rather than leaving it a coincidence — they are one
  // rule with two presentations, and the day they diverge one of them is wrong.
  // Control: `matches file` is pointedly in neither (its "Applies to" reads `body bytes`, which
  // looks browser-ish but survives a capture) — move it into either and this fails.
  const deniedByManifest = ALL_MATCHERS.filter((n) => !rowFor(n).subjects.includes('value')).sort();
  const rejectedByTf041 = ALL_MATCHERS.filter((n) => {
    const { program } = parseSource(src(`  let v = 1\n  expect {v} ${MATCHER_SOURCE[n]}`));
    return checkValueSubjects(program).some((d) => d.code === Codes.VALUE_SUBJECT_INVALID);
  }).sort();
  assert.deepEqual(rejectedByTf041, deniedByManifest);
});

// ---- the rule ---------------------------------------------------------------

test('every matcher×subject-kind pairing agrees with the manifest', () => {
  // The whole cross-product in one assertion, both directions: a denied pairing reports `TF042`,
  // and — the half that keeps this sound — an allowed one reports nothing.
  // Control: on reverted source every one of the ~85 rejections is missing; `tflw check` reported
  // no problems for any of them.
  const wrong: string[] = [];
  for (const name of ALL_MATCHERS) {
    for (const kind of ALL_KINDS) {
      if (kind === 'value') continue; // `TF041`'s, asserted above
      const allowed = rowFor(name).subjects.includes(kind);
      const got = codes(src(`  api GET /h\n  expect ${SUBJECT_SOURCE[kind]} ${MATCHER_SOURCE[name]}`));
      const rejected = got.includes(Codes.MATCHER_SUBJECT_MISMATCH);
      if (allowed === rejected) {
        wrong.push(`${name} on ${kind}: manifest says ${allowed ? 'allowed' : 'denied'}, checker ${rejected ? 'rejected' : 'accepted'}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test('`A4-15`: `expect status is visible` no longer lints green', () => {
  // The row's own repro, run through the full `checkProgram` composition rather than the pass
  // alone — a pass nobody calls is the failure `A4-09` filed against the LSP.
  // Control: on reverted source, "1 file checked, no problems found".
  const { program } = parseSource(src('  api GET /h\n  expect status is visible'));
  const diags = checkProgram(program);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, Codes.MATCHER_SUBJECT_MISMATCH);
  assert.match(diags[0]!.message, /can't be used on a value/);
  assert.match(diags[0]!.hint!, /UI locators/);
});

test('`A4-11`: `any` cannot be combined with `matches schema`', () => {
  // SPEC §6.2.1 says "the checker/runtime rejects the combination loudly". Only the runtime did.
  // Control: on reverted source this returns [].
  assert.deepEqual(
    codes(src('  api GET /h\n  expect any body.items matches schema "W" from "/openapi.json"')),
    [Codes.MATCHER_SUBJECT_MISMATCH],
  );
});

test('`any` cannot be combined with `matches file` either — the worse of the two', () => {
  // `matches schema` at least throws a clear runtime error. `matches file` under a quantifier falls
  // through to `evalMatcher`'s default and reports a message about *UI* matchers, and because
  // `evaluateQuantified` catches per-element failures, `any` swallows it whole into "expected any
  // element … but none of N did". The invalid matcher never appears in the output at all.
  // Control: on reverted source, [].
  assert.deepEqual(
    codes(src('  api GET /h\n  expect all body.items matches file "./f.bin"')),
    [Codes.MATCHER_SUBJECT_MISMATCH],
  );
});

test('a quantifier on a per-element matcher stays legal', () => {
  // Control: make `quantifiable` default-false and this fires — the quantifier ban has to name the
  // two I/O matchers, not every matcher nobody thought about.
  assert.deepEqual(codes(src('  api GET /h\n  expect all body.items has count 2')), []);
  assert.deepEqual(codes(src('  api GET /h\n  expect any body.items.name contains "x"')), []);
});

// ---- the permissive half: shape is not this pass's business -----------------

test('a value matcher is accepted on every value-bearing subject, whatever its shape', () => {
  // D140's load-bearing carve-out. `contains` documents "strings, arrays" and `is greater than`
  // documents "numbers" — none of which is knowable before a response exists. If a future edit
  // reads `appliesTo` as a static type claim, these are the tests that fail, and they are meant to.
  // Control: give `contains` a `subjects: ['value']` narrowed by shape and every line here fires.
  const subjects = ['status', 'duration', 'header "x"', 'body', 'body.msg', 'body text', 'body bytes', 'body csv', 'body pdf text'];
  for (const subject of subjects) {
    for (const matcher of ['equals 1', 'contains "x"', 'matches "x"', 'is greater than 1', 'has count 1']) {
      assert.deepEqual(
        codes(src(`  api GET /h\n  expect ${subject} ${matcher}`)),
        [],
        `\`expect ${subject} ${matcher}\` is a runtime shape question, not a checker error`,
      );
    }
  }
});

test('`matches file` survives a capture — `body bytes` is a subject, not a browser handle', () => {
  // The case M96 called out by name when it left `matches file` out of `TF041`: capture a binary
  // body, make three more requests, assert against the file later. A kind-only rule keeps working
  // here; a bytes-shaped "kind" would have broken it.
  // Control: give `matches-file` `subjects: ['bytes']` as a distinct kind and this fires.
  assert.deepEqual(
    codes(src('  api GET /r\n  capture body bytes as receipt\n  api GET /h\n  expect {receipt} matches file "./expected.pdf"')),
    [],
  );
});
