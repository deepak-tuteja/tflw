// M125e / `FU-24` — the step list teaches, and it appears on a blank line.
//
// The row's own measurement was "0 items carrying `detail`" on the completion that *works*. The
// list was thirty-seven bare strings mapped as `{ label }`, so completion could offer `api` and say
// nothing about what it does. Both halves — the empty line and the empty detail — trace back to
// that one fact, which is why they close together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionContext, STEP_KEYWORDS } from '@tflw/lang';
import { getCompletions } from '../src/index.js';

const completeAt = (source: string) => {
  const ctx = getCompletionContext(source, source.length);
  assert.ok(ctx, 'expected a completion context at this cursor');
  return getCompletions(ctx!);
};

test('a fresh indented line offers the whole step list, where it offered nothing', () => {
  const candidates = completeAt('test "ok"\n  ');
  assert.equal(candidates.length, STEP_KEYWORDS.length);
  assert.deepEqual(
    candidates.map((c) => c.label),
    STEP_KEYWORDS.map((k) => k.id),
  );
});

test('every step candidate carries a detail — none did before', () => {
  const withoutDetail = completeAt('test "ok"\n  ').filter((c) => !c.detail);
  assert.deepEqual(withoutDetail.map((c) => c.label), []);
});

test('the detail is the summary, not the syntax', () => {
  // A completion widget renders `detail` inline next to the label, so the one-line meaning belongs
  // there; the syntax line is what hover is for. Asserting the exact source keeps the two from
  // being quietly swapped, which would look fine in a screenshot and read badly in an editor.
  const api = completeAt('test "ok"\n  ap').find((c) => c.label === 'api');
  assert.equal(api?.detail, STEP_KEYWORDS.find((k) => k.id === 'api')!.summary);
  assert.ok(!api!.detail!.includes('<METHOD>'), 'the syntax leaked into the detail slot');
});

test('prefix filtering still narrows, and narrows with details attached', () => {
  const candidates = completeAt('test "ok"\n  c');
  assert.deepEqual(candidates.map((c) => c.label), ['check', 'capture', 'click', 'close', 'cleanup']);
  assert.ok(candidates.every((c) => c.detail));
});

test('a retired spelling is still not offered, now by construction', () => {
  // It used to be a comment in a hand-kept list. It is now a property of the manifest: `think` and
  // `uncheck` have no entry, so there is nothing to filter out.
  const labels = completeAt('test "ok"\n  th').map((c) => c.label);
  assert.ok(!labels.includes('think'));
  assert.ok(labels.includes('threshold'));
});

test('the blank-line list and the one-character list agree about what exists', () => {
  // The blank-line fix must not answer a *different* question from the one that always worked.
  const blank = completeAt('test "ok"\n  ').map((c) => c.label);
  const typed = completeAt('test "ok"\n  c').map((c) => c.label);
  assert.deepEqual(typed, blank.filter((l) => l.startsWith('c')));
});
