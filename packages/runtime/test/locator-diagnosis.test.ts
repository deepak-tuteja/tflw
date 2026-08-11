// M125c, `FU-21` ≡ `B4-11`, D266-D268. The message-construction half of browser locator diagnosis,
// tested at the pure-function level because two of its branches are otherwise only reachable from
// conditions that cannot be staged on demand: the DOM settling between the check and the
// description (a race), and a candidate list long enough to be sliced.
//
// The browser-level tests in `browser-diagnosis.test.ts` prove the same behaviour against real
// Chromium. Both exist on purpose — this file can enumerate the shapes, that one proves the shapes
// are the ones a real page actually produces. The lesson `FU-15` taught twice in `M125b2` is why:
// an assertion is only worth what the instrument behind it can see.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeCandidates, renderNearestCandidates, formatAmbiguity, type AmbiguousMatch } from '../src/browser.js';

test('dedupeCandidates collapses byte-identical suggestions and counts the group (B4-11)', () => {
  const out = dedupeCandidates([
    { suggestion: 'button "Save"', score: 0.9 },
    { suggestion: 'button "Save"', score: 0.9 },
    { suggestion: 'button "Submit"', score: 0.4 },
  ]);
  assert.deepEqual(out, [
    { suggestion: 'button "Save"', score: 0.9, matches: 2 },
    { suggestion: 'button "Submit"', score: 0.4, matches: 1 },
  ]);
});

test('it keeps the best score in a group, and first-seen order (which is best-first, since the caller sorts)', () => {
  const out = dedupeCandidates([
    { suggestion: 'button "A"', score: 0.5 },
    { suggestion: 'button "B"', score: 0.4 },
    { suggestion: 'button "A"', score: 0.8 },
  ]);
  assert.deepEqual(out.map((c) => c.suggestion), ['button "A"', 'button "B"']);
  assert.equal(out[0]!.score, 0.8);
});

test('distinct suggestions are never merged', () => {
  const out = dedupeCandidates([
    { suggestion: 'button "Save"', score: 0.9 },
    { suggestion: 'button "save"', score: 0.9 },
  ]);
  assert.equal(out.length, 2, 'case differs, so the pasted locators differ');
});

test('deduping is what frees the candidate slots — the crowding-out half of B4-11', () => {
  // Measured on a twelve-control page: all five slots came back as the same string, so a genuinely
  // different candidate could not be shown at all. This is that page, and the assertion is that
  // one distinct suggestion survives alongside the collapsed group rather than being pushed out.
  const twelveIdentical = Array.from({ length: 12 }, () => ({ suggestion: 'button "Add to cart"', score: 0.8 }));
  const out = dedupeCandidates([...twelveIdentical, { suggestion: 'button "Add to bag"', score: 0.6 }]);
  assert.deepEqual(out, [
    { suggestion: 'button "Add to cart"', score: 0.8, matches: 12 },
    { suggestion: 'button "Add to bag"', score: 0.6, matches: 1 },
  ]);
});

test('a non-unique suggestion is rendered with the reason it cannot be pasted as-is', () => {
  const out = renderNearestCandidates([{ suggestion: 'button "Save"', score: 0.9, matches: 2 }]);
  assert.match(out, /nearest matches on the page:/);
  assert.match(out, /button "Save"/);
  assert.match(out, /2 elements render this same locator/);
  assert.match(out, /within <container>/);
});

test('a unique suggestion carries no caveat — SPEC §9.3 calls these ready to paste, and this one is', () => {
  const out = renderNearestCandidates([{ suggestion: 'button "Login"', score: 0.9, matches: 1 }]);
  assert.match(out, /- `?button "Login"`?$/m);
  assert.doesNotMatch(out, /ambiguous/);
  assert.doesNotMatch(out, /within <container>/);
});

test('no candidates renders the empty string, leaving the caller’s message untouched', () => {
  assert.equal(renderNearestCandidates([]), '');
});

test('formatAmbiguity numbers the matches and appends each discriminator (D267)', () => {
  const matches: AmbiguousMatch[] = [
    { text: 'Save', discriminator: 'data-testid="save-profile"' },
    { text: 'Save', discriminator: 'id="save-billing"' },
  ];
  const out = formatAmbiguity('`button "Save"`', 'role', 2, matches);
  assert.match(out, /matched 2 elements:/);
  assert.match(out, /1\. "Save" — data-testid="save-profile"/);
  assert.match(out, /2\. "Save" — id="save-billing"/);
  assert.match(out, /narrow it with `within <container>`/);
});

test('a match the page offers nothing to distinguish keeps the bare ordinal', () => {
  const out = formatAmbiguity('`button "X"`', 'role', 2, [
    { text: 'X', discriminator: null },
    { text: 'X', discriminator: null },
  ]);
  assert.match(out, /^ {2}1\. "X"$/m);
  assert.match(out, /^ {2}2\. "X"$/m);
});

test('an element with no text at all is still listed', () => {
  const out = formatAmbiguity('`button "X"`', 'role', 2, [
    { text: '', discriminator: 'id="a"' },
    { text: '', discriminator: 'id="b"' },
  ]);
  assert.match(out, /1\. \(no visible text\) — id="a"/);
});

test('the shown/more arithmetic comes from one list, so it always accounts for every match (FU-21 half B)', () => {
  // The filed symptom was "2 matches, 1 shown, … and 1 more" — impossible now, because both numbers
  // are read off the same array. Twelve in, five shown, seven more.
  const matches: AmbiguousMatch[] = Array.from({ length: 12 }, (_, i) => ({ text: 'Add to cart', discriminator: `in "Product ${i + 1}"` }));
  const out = formatAmbiguity('`button "Add to cart"`', 'role', 12, matches);
  assert.match(out, /matched 12 elements:/);
  assert.equal(out.match(/^ {2}\d+\. /gm)?.length, 5);
  assert.match(out, /… and 7 more/);
});

test('the caller’s count is not a second opinion — the elision follows the list, not the observation (D266)', () => {
  // The two numbers disagreeing is not hypothetical: it is the only explanation for the filed
  // "matched 2 elements … 1 shown … and 1 more". Given a caller that saw 7 and a describing query
  // that found 3, the list is the authority for both the count and the elision, and there is
  // nothing to elide. Every assertion here is identical under the old code on a *stable* page,
  // which is precisely why the defect survived until someone drove an unstable one.
  const matches: AmbiguousMatch[] = Array.from({ length: 3 }, () => ({ text: 'x', discriminator: null }));
  const out = formatAmbiguity('`button "x"`', 'role', 7, matches);
  assert.match(out, /matched 3 elements:/);
  assert.doesNotMatch(out, /… and \d+ more/);
  assert.doesNotMatch(out, /7/);
});

test('exactly at the cap, nothing is elided', () => {
  // `/more/` alone would be satisfied by the trailing "make the name more specific" and prove
  // nothing — the elision line is what this is about, so match the elision line.
  const matches: AmbiguousMatch[] = Array.from({ length: 5 }, () => ({ text: 'x', discriminator: null }));
  assert.doesNotMatch(formatAmbiguity('`button "x"`', 'role', 5, matches), /… and \d+ more/);
});

test('a page that settles between the throw and the description says so, rather than reporting “matched 1 elements”', () => {
  // The caller counted >1 and threw; this single describing query saw fewer. Reporting the query
  // alone would be internally consistent and actively misleading, and reporting the caller's count
  // beside a one-item list is the very inconsistency FU-21 half B was filed about.
  const out = formatAmbiguity('`button "Save"`', 'role', 2, [{ text: 'Save', discriminator: null }]);
  assert.match(out, /matched 2 elements when the step ran/);
  assert.match(out, /the page changed while the failure was being described \(it now matches 1\)/);
  assert.doesNotMatch(out, /matched 1 elements:/);
});
