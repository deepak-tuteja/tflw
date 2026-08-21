// M147d (`A3-11`, D627, D641) — which subjects a `wait until` may stand in front of.
//
// `A3-11` reads: *`wait until` cannot poll the last API response, and the hint shows only the UI
// form.* Both halves reproduce. `wait until body.state equals "done"` is `TF010` "`wait until`
// expects either `api ...` or a UI locator condition", and the help said only `e.g. `wait until
// button "Submit" is enabled``.
//
// **What measuring the refusal found is that it was one sentence covering eight different
// mistakes.** `parseSubject` can produce fourteen subject shapes; the guard admitted exactly one,
// so `status`, `duration`, `header "…"`, `body …`, `response`, `request`, `{variable}`, `page`,
// `request to "…"` and `… of request to "…"` all arrived at the same message — and the message
// named the one spelling none of them was reaching for.
//
// Those eight divide, and the property they divide on is already load-bearing elsewhere in the
// implementation: **can re-reading this subject between two polls produce a different answer?**
//
//   * Five cannot. `status`, `duration`, `header`, `body …`, `response` and `request` read the
//     *response scope*, which exactly one `api` step writes; between two polls of a `wait until`
//     nothing runs. `{variable}` is the same argument one step over, and `TF041` already states it
//     in those words for a value subject inside `wait until api`. **The row's own example is in
//     this group**, so the capability it asked for is the one shape the rule can prove is never
//     worth admitting — and the thing it wanted already has a spelling that re-issues the request.
//   * Three can, and this is the real gap the row noticed without naming. `page`, `request to "…"`
//     and a value `of request to "…"` are live browser observations, and `expect` has *always*
//     polled them: `execA11yExpect`, `execNetworkExpect` and `execUiExpect` are three retry loops
//     that re-observe on every iteration. For these, `wait until <X>` is `expect <X>` on the wait
//     budget with an optional `for` hold — no new evaluation semantics at all, only a guard that
//     had never been widened past the form it was written for.
//
// Two consequences found by building it, neither in the row:
//
//  1. **The matcher half of the rule has exactly one member.** `matches snapshot` is the only
//     matcher whose evaluation documents itself as never retrying, so `wait until <locator> matches
//     snapshot "s"` parsed and produced a wait that could not wait. Refused now, at the same code.
//  2. **`TF042` had never reached `wait until` at all.** `expect button "Go" has no critical a11y
//     violations` was `TF042`; the identical mistake one keyword over checked clean and failed
//     mid-run from `uiMatcher.ts`'s `default:` throw — which is verbatim the scenario SPEC §1 cites
//     as `TF042`'s reason to exist. Widening the subject set without this would have shipped a
//     wider unchecked matcher position, so it is part of the slice rather than a follow-up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkMatcherSubjects, Codes } from '../src/index.js';
import type { WaitUntilUiStmt } from '../src/ast.js';

/** Diagnostic codes from parsing a step body under an `open`. */
const codes = (body: string): string[] => parseSource(`test "t"\n  open "/x"\n${body}`).diagnostics.map((d) => d.code);

/** The first diagnostic's message and hint, joined. */
const said = (body: string): string => {
  const d = parseSource(`test "t"\n  open "/x"\n${body}`).diagnostics[0];
  return d ? `${d.message} | ${d.hint ?? ''}` : '';
};

/** The `wait until` step of a fixture that must parse cleanly. */
const waitStep = (body: string): WaitUntilUiStmt => {
  const { program, diagnostics } = parseSource(`test "t"\n  open "/x"\n${body}`);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${body}`);
  return program.tests[0]!.body[1] as unknown as WaitUntilUiStmt;
};

/** `TF042` over one program body. */
const matcherDiags = (body: string): string[] => {
  const { program, diagnostics } = parseSource(`test "t"\n  open "/x"\n${body}`);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${body}`);
  return checkMatcherSubjects(program).map((d) => d.code);
};

// ---- the three that were being refused for no reason ------------------------

test('`page` is admitted, and lands on the node as an ordinary subject', () => {
  const step = waitStep('  wait until page has no critical a11y violations\n');
  assert.equal(step.type, 'WaitUntilUiStmt');
  assert.equal(step.subject.type, 'PageSubject');
  assert.equal(step.matcher.name, 'hasNoA11yViolations');
});

test('`request to "…"` is admitted', () => {
  const step = waitStep('  wait until request to "/api/cart" was made\n');
  assert.equal(step.subject.type, 'NetworkRequestSubject');
  assert.equal(step.matcher.name, 'wasMade');
});

test('a value subject is admitted by its `of request to "…"` clause, not by its keyword', () => {
  // The discriminator for the whole rule: `status` alone is refused two tests down, and the *only*
  // difference here is the clause that moves the read off the response scope and onto the browser's
  // observed traffic. `pollable()` tests for the clause by presence for exactly this reason.
  const step = waitStep('  wait until status of request to "/api/cart" equals 200\n');
  assert.equal(step.subject.type, 'StatusSubject');
  assert.notEqual((step.subject as { of: unknown }).of, null);
});

test('the locator form is untouched — the widening added arms, it did not rewrite the one that worked', () => {
  const step = waitStep('  wait until button "Go" is enabled\n');
  assert.equal(step.subject.type, 'LocatorSubject');
  assert.equal(step.matcher.name, 'enabled');
});

test('`for` and `timeout wait` compose with a widened subject exactly as they do with a locator', () => {
  const step = waitStep('  wait until page has no critical a11y violations for 2s timeout wait 5m\n');
  assert.equal(step.subject.type, 'PageSubject');
  assert.equal(step.holdMs, 2000);
  assert.equal(step.waitMs, 300_000);
});

// ---- the five that cannot be polled, and now say which reason applies -------

test('a response-scope subject is refused, and the refusal names the scope rather than the grammar', () => {
  for (const body of [
    '  wait until body.state equals "done"\n',
    '  wait until status equals 200\n',
    '  wait until duration is less than 100\n',
    '  wait until header "x-state" equals "done"\n',
    '  wait until response has no serious security violations\n',
    '  wait until request connects\n',
  ]) {
    assert.deepEqual(codes(body), [Codes.UNEXPECTED_TOKEN], body);
    assert.match(said(body), /reads the last `api` response/, body);
  }
});

test("the row's own program is refused with the spelling that does what it wanted", () => {
  // `A3-11` asked for polling of the last response; the reachable capability is re-issuing the
  // request, and the hint has to hand over that exact spelling or the row's author is left where
  // they started. The old help offered `wait until button "Submit" is enabled`, which is not it.
  const message = said('  wait until body.state equals "done"\n');
  assert.match(message, /re-issue the request/);
  assert.match(message, /wait until api GET \/orders\/1/);
  assert.doesNotMatch(message, /button "Submit"/);
});

test('a `{variable}` subject gets `TF041`\'s argument, not the response one — it is a different mistake', () => {
  const message = said('  let v = "done"\n  wait until {v} equals "done"\n');
  assert.match(message, /a bound value cannot/);
  assert.match(message, /TF041/);
  assert.doesNotMatch(message, /reads the last `api` response/);
});

test('the refusal names all three pollable shapes, so no reader has to guess the third', () => {
  const message = said('  wait until status equals 200\n');
  assert.match(message, /UI locator/);
  assert.match(message, /`page`/);
  assert.match(message, /request to/);
});

// ---- the matcher half ------------------------------------------------------

test('`matches snapshot` is refused on a `wait until` — it is compared once, so waiting cannot change it', () => {
  assert.deepEqual(codes('  wait until text "E" matches snapshot "s"\n'), [Codes.UNEXPECTED_TOKEN]);
  assert.match(said('  wait until text "E" matches snapshot "s"\n'), /cannot be polled/);
});

test('and it is still perfectly legal on the `expect` it belongs on', () => {
  assert.deepEqual(codes('  expect text "E" matches snapshot "s"\n'), []);
  assert.deepEqual(codes('  expect page matches snapshot "s"\n'), []);
});

// ---- TF042 now reaches the construct it never reached ----------------------

test('`TF042` judges a `wait until` pair identically to its `expect` twin', () => {
  const body = 'button "Go" has no critical a11y violations\n';
  assert.deepEqual(matcherDiags(`  expect ${body}`), [Codes.MATCHER_SUBJECT_MISMATCH]);
  assert.deepEqual(matcherDiags(`  wait until ${body}`), [Codes.MATCHER_SUBJECT_MISMATCH], 'the same mistake one keyword over used to check clean and fail mid-run');
});

test('`TF042` reaches a `wait until` nested inside a block, the way it already reaches an `expect`', () => {
  assert.deepEqual(matcherDiags('  within css "#panel"\n    wait until page has value "x"\n'), [Codes.MATCHER_SUBJECT_MISMATCH]);
});

test('`TF042` stays quiet on every pair D641 admits', () => {
  assert.deepEqual(matcherDiags('  wait until page has no critical a11y violations\n'), []);
  assert.deepEqual(matcherDiags('  wait until request to "/api/cart" was made\n'), []);
  assert.deepEqual(matcherDiags('  wait until status of request to "/api/cart" equals 200\n'), []);
  assert.deepEqual(matcherDiags('  wait until button "Go" is enabled\n'), []);
});

test('widening this pass did not widen the walk four other passes read', () => {
  // `forEachExpectInSteps` is shared with `checkAuthorizedTargets` and `checkPublicTargets`, two D21
  // safety layers. `checkMatcherSubjects` got its own traversal so that teaching it about a new step
  // type could not quietly change what those two judge — asserted here by the thing that would have
  // broken first: a `wait until` must still not appear as an `expect` to `TF041`, which shares the
  // walk and whose `inWaitUntil` flag means something else entirely.
  const { program, diagnostics } = parseSource('test "t"\n  open "/x"\n  wait until page has no critical a11y violations\n');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(checkMatcherSubjects(program), []);
});
