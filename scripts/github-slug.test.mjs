// GitHub's slug rule, held to GitHub's own answer (`M152c`).
//
// The first test here is the one that matters, and it is not a unit test: it replays the anchors
// GitHub minted for `SPEC.md` and asserts this repository reproduces every one. Everything below it
// is a unit test of a rule that has already been confirmed — useful for saying *why* a case behaves
// as it does, worthless as evidence that the rule is right, because a hand-written expectation and
// a hand-written implementation agree by construction. `D693` refused a hand-rolled slugger for
// exactly that reason, and a test file full of `assert.equal(slug('a b'), 'a-b')` would have been
// the same mistake wearing a green tick.
//
// The corpus earned that role once already. A draft of `DELETED` carried a literal U+00A0 where the
// escape now is, which made it a different rule than the one written in the comment beside it — and
// it scored 75/75, because the accident happened to be correct. Only dumping `.source`'s codepoints
// found it. A test that could only compare this file against itself would have agreed with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorsOf, headingsOf, slug } from './github-slug.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(readFileSync(join(ROOT, 'scripts', 'spec-anchors.json'), 'utf8'));
const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');

test('every anchor GitHub minted for SPEC.md is reproduced exactly', () => {
  const wrong = corpus.headings.filter(([text, anchor]) => slug(text) !== anchor);
  assert.deepEqual(
    wrong.map(([text, anchor]) => `${JSON.stringify(text)}\n    github: ${anchor}\n    ours:   ${slug(text)}`),
    [],
    `github-slug.mjs disagrees with GitHub, pinned at ${corpus.repo}@${String(corpus.sha).slice(0, 7)}`,
  );
});

test('the corpus still covers every heading SPEC.md currently has', () => {
  // The conformance test above can only vouch for heading shapes GitHub has actually been asked
  // about. A heading added or reworded since the corpus was pinned is unproven — and this repo
  // reworded four in this very milestone — so the answer is to re-pin, not to widen the rule and
  // hope. Failing here is how anybody finds that out.
  const pinned = new Set(corpus.headings.map(([text]) => text));
  const uncovered = headingsOf(spec).map((h) => h.text).filter((t) => !pinned.has(t));
  assert.deepEqual(
    uncovered,
    [],
    'these SPEC.md headings are not in the pinned corpus, so GitHub has never confirmed their\n' +
      'anchors. Push the branch and re-pin:\n' +
      '  node scripts/refresh-spec-anchors.mjs --ref <branch>',
  );
});

test('the corpus is a real corpus, not a handful of easy headings', () => {
  // A guard on the guard. A corpus that shrank to three ASCII headings would pass the conformance
  // test and prove nothing, so name the characters whose handling is load-bearing and require each
  // to appear. Every one of them is a character that produced a dead link or could have.
  assert.ok(corpus.headings.length >= 70, `corpus has only ${corpus.headings.length} headings`);
  for (const [what, char] of [['en-dash', '–'], ['em-dash', '—'], ['emoji', '✅'], ['backtick', '`'], ['underscore', '_'], ['slash', '/']]) {
    assert.ok(
      corpus.headings.some(([text]) => text.includes(char)),
      `no heading in the corpus contains ${what} — GitHub has not been asked how it slugs one`,
    );
  }
});

test('punctuation is deleted before spaces become hyphens, which is why a range loses its dash', () => {
  // `D693`'s six dead links, in one line. The en-dash range and the ASCII-hyphen range are written
  // identically by a human and slug differently, and the pair is the point: the second is what
  // every author typed, the first is what GitHub produced.
  assert.equal(slug('3. The config dialect (P#27–31)'), '3-the-config-dialect-p2731');
  assert.equal(slug('3. The config dialect (P#27-31)'), '3-the-config-dialect-p27-31');
});

test('a trailing emoji leaves a trailing hyphen, and no emoji leaves none', () => {
  assert.equal(slug('17. Diagnostic codes ✅'), '17-diagnostic-codes-');
  assert.equal(slug('17. Diagnostic codes'), '17-diagnostic-codes');
});

test('hyphen and underscore survive; every other punctuation mark and symbol does not', () => {
  assert.equal(slug('a-b_c'), 'a-b_c');
  assert.equal(slug('a.b,c;d:e!f?g"h…i(j)k[l]m{n}o/p\\q`r*s+t=u<v>w&x'), 'abcdefghijklmnopqrstuvwx');
});

test('a no-break space is deleted, and an ordinary space becomes a hyphen', () => {
  // The pair that the U+00A0 accident collapsed. Written as escapes on both sides on purpose: the
  // difference between these two assertions is invisible in every review path there is.
  assert.equal(slug('a\u00A0b'), 'ab');
  assert.equal(slug('a\u0020b'), 'a-b');
});

test('a `#` line inside a fence is not a heading, and the same line outside one is', () => {
  const fenced = '# Real\n\n```console\n# Not a heading\n```\n\n## Also real\n';
  assert.deepEqual(headingsOf(fenced).map((h) => h.text), ['Real', 'Also real']);
  assert.deepEqual(headingsOf('# Real\n\n# Not a heading\n\n## Also real\n').map((h) => h.text),
    ['Real', 'Not a heading', 'Also real']);
});

test('a fence closes only on the character that opened it', () => {
  // `SPEC.md` nests ``` inside ~~~ to show a fence as content. Closing on either character would
  // reopen the scan mid-block and start counting sample output as headings.
  const nested = '~~~markdown\n```\n# Not a heading\n```\n~~~\n\n# Real\n';
  assert.deepEqual(headingsOf(nested).map((h) => h.text), ['Real']);
});

test('two headings that slug alike get GitHub\'s suffix, and are reported as unproven', () => {
  // This repo has no colliding headings, so the corpus cannot vouch for the suffix rule. It is
  // implemented from GitHub's documented behaviour and surfaced rather than trusted: `anchorsOf`
  // hands collisions back so the gate can refuse instead of passing a link on a guess.
  const { anchors, collisions } = anchorsOf('# Notes\n\n# Notes\n\n# Notes!\n');
  assert.deepEqual(anchors.map((a) => a.anchor), ['notes', 'notes-1', 'notes-2']);
  assert.equal(collisions.length, 2);
  assert.deepEqual(anchorsOf('# Notes\n\n# Other\n').collisions, []);
});
