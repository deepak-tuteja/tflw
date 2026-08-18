// M137a / D444 — the config dialect had no completion at all, and this is both the proof it has one
// now and the guard that keeps its vocabulary from drifting.
//
// The `stepKeywords.test.ts` shape (D277), pointed at the other dialect. That test exists because
// the step list had been thirty-seven bare strings copied out of `parser.ts`; this one exists
// because `CONFIG_KEYWORDS` would otherwise be the *fourth* independently-maintained copy of the
// config vocabulary — after the parser's arrays, `tflw.tmLanguage.json`'s and `semanticTokens.ts`'s
// — in the same milestone that is repairing the third one's drift (`B5-09`).
//
// The three "exactly" assertions below are set equality against the parser's own exported arrays,
// so a word added to the grammar with no summary written for it fails here rather than shipping as
// a candidate nobody can complete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEYWORDS, CONFIG_KEYS, CONFIG_DIRECTIVES, PROBE_SUB_CLAUSES, getCompletionContext, getConfigCompletionContext } from '@tflw/lang';
import { getCompletions } from '../src/index.js';

const completeAt = (source: string) => {
  const ctx = getConfigCompletionContext(source, source.length);
  assert.ok(ctx, 'expected a completion context at this cursor');
  return getCompletions(ctx!);
};

const idsOf = (slot: 'directive' | 'key' | 'probe') => CONFIG_KEYWORDS.filter((e) => e.slot === slot).map((e) => e.id);

// -- the manifest is held to the parser, not to prose ------------------------------------------

test('CONFIG_KEYWORDS covers exactly the parser\'s directives, config keys and probe sub-clauses', () => {
  assert.deepEqual(idsOf('directive'), [...CONFIG_DIRECTIVES]);
  assert.deepEqual(idsOf('key'), [...CONFIG_KEYS]);
  assert.deepEqual(idsOf('probe'), [...PROBE_SUB_CLAUSES]);
});

test('every config keyword carries a summary — the FU-24 bar, applied to a list that did not exist', () => {
  assert.deepEqual(CONFIG_KEYWORDS.filter((e) => !e.summary.trim()).map((e) => e.id), []);
});

// -- the five instrumented positions -----------------------------------------------------------

test('the top level of a config offers its five directives', () => {
  const candidates = completeAt('d');
  assert.deepEqual(candidates.map((c) => c.label), ['defaults']);
  assert.deepEqual(completeAt('e').map((c) => c.label), ['env', 'exclude']);
  // Every one carries its detail, all the way through the candidate layer rather than only in the
  // manifest — the two are different failures and only this one is visible to a user.
  assert.ok(candidates.every((c) => c.detail));
});

test('a `defaults` block offers the keys legal in `defaults`, and not the two that are not', () => {
  const labels = completeAt('defaults\n  ').map((c) => c.label);
  assert.ok(labels.includes('workers'), '`workers` is defaults-only and belongs here');
  assert.ok(labels.includes('authorized'), 'a key legal in both blocks belongs here');
  // `A2-07b` in candidate-list form: offering these would be telling a user to write something the
  // checker then refuses with `TF025`.
  assert.ok(!labels.includes('web'), '`web` is env-only');
  assert.ok(!labels.includes('api'), '`api` is env-only');
});

test('an `env` block offers the keys legal in `env`, and not the three that are not', () => {
  const labels = completeAt('env local default\n  ').map((c) => c.label);
  assert.ok(labels.includes('web'));
  assert.ok(labels.includes('api'));
  assert.ok(!labels.includes('workers'), '`workers` is defaults-only');
  assert.ok(!labels.includes('report'), '`report` is defaults-only');
  assert.ok(!labels.includes('viewport'), '`viewport` is defaults-only');
});

// The decision's own worked example. `probe mutating` shipped in `M130b` and had never been
// completable in either position a person types it from — which is the whole of D444's case for
// building the mechanism now rather than deferring it into the milestone that adds `csrf from`.
test('a sub-clause line under `authorized target` offers the whole `probe …` phrase', () => {
  const source =
    'defaults\n' +
    '  authorized target "http://localhost:4001" reason "self-hosted test fixture"\n' +
    '    ';
  const candidates = completeAt(source);
  // Derived from the parser's own tuple rather than hand-listed. `M137g` added a fourth clause and
  // found both of this file's expectations frozen at three — a completion list that silently stops
  // growing is the exact `M133` defect this suite was built to prevent, reappearing in its own tests.
  assert.deepEqual(candidates.map((c) => c.label), PROBE_SUB_CLAUSES.map((w) => `probe ${w}`));
  assert.ok(candidates.every((c) => c.detail), 'each probe class says what permitting it means');
});

test('after `probe ` the candidate is the bare class word, not a phrase that repeats it', () => {
  const source =
    'defaults\n' +
    '  authorized target "http://localhost:4001" reason "self-hosted test fixture"\n' +
    '    probe ';
  assert.deepEqual(completeAt(source).map((c) => c.label), [...PROBE_SUB_CLAUSES]);
  // Mid-word, which is how it is actually typed.
  assert.deepEqual(completeAt(source + 'o').map((c) => c.label), ['oversized']);
});

// -- the dialects do not answer for each other -------------------------------------------------

test('the second entry point is the whole of it: the test-dialect parser answers nothing in a config', () => {
  // Not a style assertion. Before this milestone `runCompletion()` was the only entry point, so a
  // `tflw.config` buffer was parsed as a *test* file — `defaults` is not a test-dialect declaration,
  // so the cursor never reached a guarded production and the answer was silence. Both halves are
  // asserted so the reason for the second entry point cannot be optimised away later.
  const source = 'defaults\n  ';
  assert.equal(getCompletionContext(source, source.length), null, 'the test grammar has nothing to say about a config');
  const labels = getCompletions(getConfigCompletionContext(source, source.length)!).map((c) => c.label);
  assert.ok(labels.includes('timeout'), 'the config entry point answers');
});

test('and the config parser is equally silent about a test file — the split cuts both ways', () => {
  const source = 'test "ok"\n  ';
  assert.equal(getConfigCompletionContext(source, source.length), null);
});
