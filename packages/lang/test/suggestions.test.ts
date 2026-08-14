// Suggestion honesty (M61, review cluster C7 — `A3-02`, `A3-15`, `A3-16`, `A3-20`, `A4-08`,
// `OBS-04`, `B6-11`'s language half).
//
// The pillar this file guards is not "the parser produces a diagnostic" — it already did in every
// one of those findings — but that **what the diagnostic recommends is true**. Three ways it wasn't:
// the suggestion meant the opposite of what the user wrote (`invisible` -> `visible`), the
// suggestion could not complete the statement it was offered for (`nut` -> `not`), or there was no
// suggestion where one was sitting in a constant in the same file.
//
// The round-trip guard at the bottom is the part that retires the class rather than the rows. It
// walks every closed vocabulary a did-you-mean here draws from, and fails when a word is added to
// one without a worked example proving it can actually stand where it would be suggested.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';
import { suggest } from '../src/diagnostic.js';
import { checkUnknownVariables } from '../src/checker.js';
import { SUGGESTION_VOCABULARIES } from '../src/parser.js';

/** The diagnostics of `source`, each flattened to `code | message | hint` for readable asserts. */
function diagnose(source: string): string[] {
  return parseSource(source).diagnostics.map((d) => `${d.code} | ${d.message} | ${d.hint ?? ''}`);
}

/** The one diagnostic `source` produces. Asserting the count matters as much as the text: a fix
 * that turns one honest error into two is not a fix. */
function onlyDiagnostic(source: string): string {
  const all = diagnose(source);
  assert.equal(all.length, 1, `expected exactly one diagnostic from:\n${source}\ngot:\n${all.join('\n')}`);
  return all[0]!;
}

const inTest = (step: string): string => `test "t"\n  ${step}\n`;

// --- A3-02: a suggestion that inverts the assertion --------------------------------------------

// Every negated state word a user reaches for is exactly one edit from its own positive twin, so
// the did-you-mean was always the antonym. Following it produced a *passing* test asserting the
// opposite of intent — the only finding in this cluster that can put a false green in a report.
for (const [written, meant] of [
  ['invisible', 'visible'],
  ['unchecked', 'checked'],
  ['unhidden', 'hidden'],
  ['notvisible', 'visible'],
  ['unenabled', 'enabled'],
] as const) {
  test(`\`is ${written}\` teaches \`not ${meant}\`, never the positive twin (A3-02)`, () => {
    const d = onlyDiagnostic(inTest(`expect button "Go" is ${written}`));
    assert.match(d, new RegExp(`write \`not ${meant}\``), d);
    // The regression proper: the old help was `did you mean \`visible\`?`, which is a correct
    // spelling of the wrong assertion.
    assert.doesNotMatch(d, /did you mean/, d);
  });
}

test('an already-negated one is a double negative, and is told to drop the `not` rather than add another (A3-02)', () => {
  // `is not invisible` means "is visible". Recommending `not visible` here would be the inverting
  // suggestion again, one layer along — so the advice has to depend on what was already consumed.
  const d = onlyDiagnostic(inTest('expect button "Go" is not invisible'));
  assert.match(d, /double negative — write `visible`/, d);
  assert.doesNotMatch(d, /not visible/, d);
});

test('a word that merely starts with a negation prefix is not mistaken for one (A3-02)', () => {
  // `disabled` is `dis` + `abled` to a prefix-stripper, and a real state word to the grammar.
  assert.deepEqual(diagnose(inTest('expect button "Go" is disabled')), []);
  assert.deepEqual(diagnose(inTest('expect button "Go" is not disabled')), []);
});

// --- A3-20: a suggestion that cannot complete the statement ------------------------------------

test('a mistyped matcher is never answered with `not`, which is a prefix and not a matcher (A3-20)', () => {
  const d = onlyDiagnostic(inTest('expect status nut 200'));
  assert.doesNotMatch(d, /did you mean `not`/, d);
  // With `not` out of the pool nothing is close enough, so the fallback carries the whole
  // vocabulary — including the prefixes, named as prefixes, which is where saying `not` is true.
  assert.match(d, /optionally prefixed with `is`\/`not`/, d);
});

// --- OBS-04: the option set that omitted the most-used matcher ---------------------------------

test('`expect status is 200` names the matcher it is missing (OBS-04)', () => {
  // Pre-M61 this was `expected a matcher, found \`200\`` with no help line whatsoever — `is` is a
  // copula (FS-08), so the value is not the problem, the absent `equals` is.
  const d = onlyDiagnostic(inTest('expect status is 200'));
  assert.match(d, /did you mean `equals 200`\?/, d);
});

test('…and the suggested text is insertable as written, after any prefix already typed (OBS-04)', () => {
  for (const [before, after] of [
    ['expect status is 200', 'expect status is equals 200'],
    ['expect status 200', 'expect status equals 200'],
    ['expect status not 200', 'expect status not equals 200'],
    ['expect body "hello"', 'expect body equals "hello"'],
  ] as const) {
    const d = onlyDiagnostic(inTest(before));
    assert.match(d, /did you mean `equals /, `${before}: ${d}`);
    assert.deepEqual(diagnose(inTest(after)), [], `following the suggestion must parse clean: ${after}`);
  }
});

test('the unknown-matcher fallback names the *whole* vocabulary, with nothing behind an ellipsis (OBS-04)', () => {
  // This line presents itself as the option set, so anything it leaves out is something the reader
  // concludes the language does not have. The hand-written version elided four matchers behind a
  // `…` and put `is` in front of `greater than`/`less than` as though it were required; it is now
  // built from the constants, so it cannot say less than the grammar accepts.
  const d = onlyDiagnostic(inTest('expect status blergh 200'));
  for (const word of ['equals', 'contains', 'matches', 'has', 'connects', 'fails', 'was', 'greater than', 'less than', 'visible', 'hidden', 'enabled', 'disabled', 'checked']) {
    assert.ok(d.includes(word), `fallback must name \`${word}\`: ${d}`);
  }
  assert.doesNotMatch(d, /…/, `nothing may hide behind an ellipsis: ${d}`);
});

// --- A3-15 / A3-16: vocabularies the parser had in hand and never named ------------------------

test('every way to get `a11y violations` wrong names the construct and its severity floor (A3-15)', () => {
  for (const step of ['expect page has no bad a11y violations', 'expect page has no violations', 'expect page has no', 'expect page has no a11y breaches']) {
    const d = onlyDiagnostic(inTest(step));
    assert.match(d, /a11y violations|did you mean/, `${step}: ${d}`);
    if (!/did you mean/.test(d)) assert.match(d, /minor\/moderate\/serious\/critical/, `${step}: ${d}`);
  }
});

test('a severity typo is corrected from the severity list, and only while a severity is still legal (A3-15)', () => {
  assert.match(onlyDiagnostic(inTest('expect page has no serius a11y violations')), /did you mean `serious`\?/);
  // After one is read, another is not a thing the user may write — so it must not be offered.
  assert.doesNotMatch(onlyDiagnostic(inTest('expect page has no serious minr a11y violations')), /did you mean `minor`\?/);
});

test('an unknown log level names the levels instead of asking for a string (A3-16)', () => {
  const d = onlyDiagnostic(inTest('log trace "x"'));
  assert.match(d, /expected a log level/, d);
  assert.match(d, /debug, info, warn, error/, d);
  // The old message pointed at the message string, which was the one part written correctly.
  assert.doesNotMatch(d, /expected a string/, d);
});

test('…and a near-miss level is corrected (A3-16)', () => {
  assert.match(onlyDiagnostic(inTest('log warm "x"')), /did you mean `warn`\?/);
  // A4-08 reaching a real parser path: the level vocabulary is lowercase, and `WARN` is what a
  // user who thinks of levels as constants types.
  assert.match(onlyDiagnostic(inTest('log WARN "x"')), /did you mean `warn`\?/);
});

test('a missing log message still reports the message, not a bogus level (A3-16)', () => {
  // `to` is the one bare word in the level slot that means something else entirely.
  assert.match(onlyDiagnostic(inTest('log to console')), /expected a log message/);
});

// --- FU-09: three natural spellings for "this collection is not empty", none of them answered ---
//
// The row was filed S2 ("no way to assert an array is non-empty") and re-probed to S3: two
// spellings work, and *no* diagnostic named either one. The third spelling was worse than silent —
// it fell out of the matcher grammar into call-parsing and blamed the user's parens, the same
// mis-blame `M84` fixed elsewhere.

test('FU-09: `has count greater than 0` names the mistake it is, not a missing paren', () => {
  const d = onlyDiagnostic(inTest('expect body.items has count greater than 0'));
  assert.match(d, /`has count` compares for equality/, d);
  assert.match(d, /`greater than`/, d);
  // The whole defect: the parser used to answer for a construct the user never wrote.
  assert.doesNotMatch(d, /call|paren/i, `a count matcher has nothing to do with calls: ${d}`);
});

test('FU-09: all three natural spellings point at a working one', () => {
  for (const step of [
    'expect body.items is not empty',
    'expect body.items is empty',
    'expect body.items has at least 1',
    'expect body.items has more than 1',
    'expect body.items has count greater than 0',
    'expect body.items has count less than 5',
    'expect body.items has count at least 1',
  ]) {
    const d = onlyDiagnostic(inTest(step));
    assert.match(d, /not has count 0/, `${step}: ${d}`);
    assert.match(d, /\.length is greater than 0/, `${step}: ${d}`);
  }
});

test('FU-09: and the spellings it points at parse clean — the hint is executable advice', () => {
  // The file's thesis (see header): a diagnostic is only fixed when what it recommends is true.
  // The runtime half — that both forms actually *evaluate*, in both directions — lives in
  // `runtime/test/matcher.test.ts`, since this package cannot run a test.
  for (const step of [
    'expect body.items not has count 0',
    'expect body.items has count 0',
    'expect body.items.length is greater than 0',
    'expect body.items.length is less than 5',
    'expect body.items.length equals 3',
  ]) {
    assert.deepEqual(diagnose(inTest(step)), [], `following the hint must parse clean: ${step}`);
  }
});

test('FU-09: the same misfire on the neighboring `has value` branch is answered too, without inventing a working form', () => {
  // `has value` tests for an exact element, so there is no spelling to recommend — but naming the
  // real mistake still beats handing back advice about parens. Fixing one arm of an `if/else` and
  // leaving the other is the pattern this ledger keeps re-filing (`M61`→`M82`, `M77`→`B3-11`).
  const d = onlyDiagnostic(inTest('expect body.items has value greater than 3'));
  assert.match(d, /`has value` compares for equality/, d);
  assert.doesNotMatch(d, /call|paren/i, d);
  assert.doesNotMatch(d, /not has count 0/, `no count advice on a value matcher: ${d}`);
});

test('FU-09: `greater than` as a matcher in its own right is untouched', () => {
  // The guard sits inside the `has count`/`has value` operand slot only — the bound words are
  // still perfectly good matchers one level up, which is why they were reachable to misfire at all.
  for (const step of ['expect status is greater than 100', 'expect duration is less than 500', 'expect body.items has count 3', 'expect body.items has value "a"']) {
    assert.deepEqual(diagnose(inTest(step)), [], step);
  }
});

// --- A4-08: the two typos `suggest()` could not see --------------------------------------------

test('a case-only typo is a suggestion, not silence — SPEC §17\'s own worked example (A4-08)', () => {
  // This is the exact example carried verbatim by SPEC §17, `spec-data.ts`, the docs-site
  // Reference page and LSP hover, and until M61 it could not be reproduced: `suggest` lowercased
  // both sides and then required a *non-zero* distance, reading "the same word, differently cased"
  // as "nothing to say".
  assert.equal(suggest('orderid', ['orderId']), 'orderId');
  assert.equal(suggest('userID', ['userId']), 'userId');
  assert.equal(suggest('PRODUCT', ['product']), 'product');
  // …while an exact match still gets nothing: the caller is erroring for some other reason.
  assert.equal(suggest('orderId', ['orderId']), undefined);
});

test('an adjacent-character transposition costs one edit, not two (A4-08, secondary)', () => {
  // Plain Levenshtein charged 2 for a swap, which is past the threshold for exactly the short
  // names it happens to most — so `{nmae}` against a `name` column got the generic fallback.
  assert.equal(suggest('nmae', ['name']), 'name');
  assert.equal(suggest('sttaus', ['status']), 'status');
  assert.equal(suggest('ordreId', ['orderId']), 'orderId');
  // Not a licence to match anything: two *unrelated* wrong letters in a 4-char word still don't.
  assert.equal(suggest('xxme', ['name']), undefined);
});

test('the checker\'s unknown-variable hint carries the case fix end to end (A4-08)', () => {
  // The finding is about `suggest`, but it is filed against `TF030` because that is where it is
  // felt: capture names are camelCase by convention and interpolations are hand-typed, so case
  // drift is *the* characteristic typo of this language. This is SPEC §17's worked example, run.
  const { program, diagnostics } = parseSource(`test "t"\n  api GET /x\n  capture body.ok as orderId\n  api GET /orders/{orderid}\n`);
  assert.deepEqual(diagnostics, [], 'fixture parses — the miss is a checker one');
  const hints = checkUnknownVariables(program).map((d) => `${d.code} | ${d.message} | ${d.hint ?? ''}`);
  assert.equal(hints.length, 1, hints.join('\n'));
  assert.match(hints[0]!, /did you mean `orderId`\?/, hints[0]!);
});

// --- The round-trip guard: a suggestion must be able to stand where it is offered ---------------

/**
 * A complete, legal statement for every word in every closed vocabulary a did-you-mean draws from.
 *
 * The completeness assertion below is the load-bearing half: adding a word to one of the
 * `SUGGESTION_VOCABULARIES` without adding a line here fails, which is the only way to keep a word
 * that cannot complete a statement (`A3-20`'s `not`) out of the pool by construction rather than by
 * noticing. `M81` taught the shape and the failure mode both — its round-trip stopped one layer
 * short of the checker, so this one goes all the way to "parses with zero diagnostics".
 */
const ROUND_TRIP: Record<keyof typeof SUGGESTION_VOCABULARIES, Record<string, string>> = {
  matcher: {
    equals: 'expect status equals 200',
    contains: 'expect body contains "ok"',
    matches: 'expect body matches "ok"',
    has: 'expect list "items" has count 2',
    connects: 'expect request connects',
    fails: 'expect request fails',
    was: 'expect request to "/api/x" was made',
    greater: 'expect status greater than 5',
    less: 'expect status less than 5',
    visible: 'expect button "Go" visible',
    hidden: 'expect button "Go" hidden',
    enabled: 'expect button "Go" enabled',
    disabled: 'expect button "Go" disabled',
    checked: 'expect field "Terms" checked',
  },
  locator: {
    button: 'expect button "Go" visible',
    field: 'expect field "Email" visible',
    text: 'expect text "Welcome" visible',
    list: 'expect list "items" has count 2',
    css: 'expect css ".cart" visible',
    xpath: 'expect xpath "//div" visible',
  },
  logLevel: {
    debug: 'log debug "m"',
    info: 'log info "m"',
    warn: 'log warn "m"',
    error: 'log error "m"',
  },
  logDestination: {
    console: 'log "m" to console',
    html: 'log "m" to html',
    both: 'log "m" to both',
  },
  severityFloor: {
    minor: 'expect page has no minor a11y violations',
    moderate: 'expect page has no moderate a11y violations',
    serious: 'expect page has no serious a11y violations',
    critical: 'expect page has no critical a11y violations',
  },
  // M128b, then M130b — the scan words the same `has no …` production dispatches on. Each worked
  // example uses the subject its own matcher accepts, which is the half that matters here: `expect
  // page has no security violations` parses and is then a `TF042`, so an example that reached for
  // whichever subject was nearest would prove the suggestion completes a *statement* without
  // proving it completes a valid one. `security` and `authorization` share `response` because they
  // genuinely share it (D304) — a separate matcher on the same subject, not a folded one.
  // M134a adds the first *two-word* member, and it is the one this guard most needs to have walked:
  // the phrase is what the parser offers, so the property "typing the suggestion parses" is only
  // meaningful if the example is the phrase rather than its first word.
  scanKind: {
    a11y: 'expect page has no a11y violations',
    security: 'expect response has no security violations',
    authorization: 'expect response has no authorization violations',
    'input handling': 'expect response has no input handling violations',
  },
  // Statement keywords get the cheaper property rather than 30-odd worked examples: the pool is
  // derived from the parser's own dispatch list minus `RETIRED_STATEMENT_KEYWORDS`, so the failure
  // to guard against is a word in the pool the parser will not dispatch to at all — which shows up
  // as `TF011: unknown step`, and is checked generically below.
  statement: {},
};

for (const [vocabulary, words] of Object.entries(SUGGESTION_VOCABULARIES)) {
  const examples = ROUND_TRIP[vocabulary as keyof typeof SUGGESTION_VOCABULARIES];
  if (vocabulary === 'statement') continue;

  test(`every word the parser may suggest as a ${vocabulary} has a worked example (M61)`, () => {
    assert.deepEqual(
      [...words].filter((w) => examples[w] === undefined),
      [],
      `add a complete statement to ROUND_TRIP.${vocabulary} — a word may only be suggested once it is shown to work there`,
    );
    assert.deepEqual([...Object.keys(examples)].filter((w) => !(words as readonly string[]).includes(w)), [], `ROUND_TRIP.${vocabulary} has an entry for a word not in the vocabulary`);
  });

  for (const word of words) {
    test(`suggesting \`${word}\` as a ${vocabulary} recommends something that parses (M61)`, () => {
      const example = examples[word];
      assert.ok(example, `no worked example for ${vocabulary} \`${word}\``);
      assert.deepEqual(diagnose(inTest(example)), [], `\`${example}\` must parse clean — a suggestion that cannot complete a statement is not a suggestion`);
    });
  }
}

test('every suggestable statement keyword actually dispatches to a parse attempt (M61, A3-20 class)', () => {
  // The `TF011` did-you-mean draws from this pool, so a word in it that the parser does not handle
  // would answer a typo with a spelling that produces the very same `TF011` — the statement-level
  // shape of `A3-20`. `RETIRED_STATEMENT_KEYWORDS` exists because two words already had to leave.
  const undispatched = SUGGESTION_VOCABULARIES.statement.filter((kw) => diagnose(inTest(kw)).some((d) => d.startsWith('TF011')));
  assert.deepEqual([...undispatched], [], 'a statement keyword in the did-you-mean pool that the parser rejects as unknown');
});
