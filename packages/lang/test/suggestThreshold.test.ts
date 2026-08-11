// M125b2, `FU-20c`, D261 — `suggest`'s edit-distance budget is keyed on the **longer** of the
// typed word and the candidate, not on the typed word alone.
//
// The row was filed as "`TF030 unknown variable "prodId"` never suggests the in-scope name", which
// is not what happens: it suggests within a distance threshold, and the row's own pair sits
// outside it. `prodId` → `productId` is distance 3, judged against a 6-character word's budget of
// 2, so it fell out. That is exactly backwards — the longer the intended name, the further a
// plausible typo can diverge from it — and abbreviating a long name is an entirely ordinary typo.
//
// **Why this file pins the silences as hard as the suggestions.** `suggest` is the single
// suggestion engine for the whole language: methods, keywords, matchers, variables, actions,
// services, sessions. Re-keying its threshold widens every "did you mean" in the product at once,
// in the direction of suggesting *more*, and a confidently wrong suggestion is worse than none.
//
// And the reason the mutant for this decision has to be spelled `prodId`/`productId`
// specifically: **every existing suggestion test in the repo passes under either keying.** That is
// how a live defect survived forty milestones of green suites, and it is why reverting the key must
// fail here rather than nowhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../src/diagnostic.js';

test("the row's own pair: abbreviating a long name is now suggested", () => {
  // distance 3 against `productId`. Keyed on the typed word (6 chars → budget 2) this is silence;
  // keyed on the longer of the two (9 chars → budget 3) it is the answer. THE mutant control.
  assert.equal(suggest('prodId', ['productId']), 'productId');
});

test('the ladder from the re-measurement holds, entry for entry', () => {
  // Every row measured against the shipped binary in `M125a`, reproduced here as units. The first
  // is the one that changed; the rest must not have.
  assert.equal(suggest('prodId', ['productId']), 'productId'); // was: fallback
  assert.equal(suggest('pids', ['pid']), 'pid');
  assert.equal(suggest('pdi', ['pid']), 'pid'); // transposition — the Damerau arm
  assert.equal(suggest('prodid', ['prodId']), 'prodId'); // case-only (M61, `A4-08`)
  assert.equal(suggest('prodId2', ['prodId']), 'prodId');
  assert.equal(suggest('prodId', ['pid']), undefined); // too far in *both* keyings
});

test('the widening is symmetric: a long typo of a short name is still judged on the long one', () => {
  // `Math.max` and not "the candidate's length" — a typed word longer than every candidate keeps
  // its own budget, which is the pre-existing behaviour and must survive.
  assert.equal(suggest('statuss', ['status']), 'status');
  assert.equal(suggest('statusCodes', ['status']), undefined);
});

test('a short prefix of a long name is admitted; a short word unrelated to it is not', () => {
  assert.equal(suggest('stat', ['status']), 'status'); // distance 2, budget 3 — newly admitted
  assert.equal(suggest('foo', ['productId']), undefined);
  assert.equal(suggest('id', ['orderId']), undefined);
});

test('the widening does not make HTTP methods suggest each other', () => {
  // The single most-used candidate set in the language, and the one where a wrong suggestion would
  // be acted on fastest. Short, mutually dissimilar names must all stay silent about each other.
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  for (const m of methods) {
    const others = methods.filter((x) => x !== m);
    assert.equal(suggest(m, others), undefined, `${m} should suggest nothing among the other methods`);
  }
});

test('a real method typo still resolves (the `GTE` case that closed FU-20b)', () => {
  assert.equal(suggest('GTE', ['GET', 'POST', 'PUT']), 'GET');
});

test('an exact match still answers nothing, at any length', () => {
  // Unchanged rule: the caller is erroring for some other reason, and "did you mean `x`?" about the
  // `x` already typed is noise. Asserted at a length the new keying touches, so a refactor that
  // moved the early return past the threshold check would fail here.
  assert.equal(suggest('productId', ['productId', 'orderId']), undefined);
  assert.equal(suggest('pid', ['pid']), undefined);
});

test('no candidates, or nothing anywhere near, is still undefined', () => {
  assert.equal(suggest('prodId', []), undefined);
  assert.equal(suggest('zzzzzzzzzz', ['productId', 'orderId']), undefined);
});

test('ranked selection is unchanged — the nearest candidate wins, not the longest', () => {
  // D261 changes only which distances are *admitted*, never which candidate is chosen. With both
  // in range, the closer one must still win, and it must not become "whichever has the widest
  // budget".
  assert.equal(suggest('prodId', ['prodID', 'productIdentifier']), 'prodID');
});
