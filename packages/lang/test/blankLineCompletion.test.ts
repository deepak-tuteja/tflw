// M125e / `FU-24` (D278) — a cursor on a line of pure indentation resolves to a context.
//
// This was the row's second half, and it was never a filtering bug: `byPrefix('')` admits
// everything, but there was no context to filter. `lexer.ts`'s `processLine` treats a
// whitespace-only line as *blank*, emits no `indent`/`newline` for it, and so no guarded production
// is ever reached. It is the exact moment someone reaches for the list — right after pressing Enter
// for a new step — and it returned nothing at all.
//
// Every source string below ends exactly where the cursor sits, the convention completion.test.ts
// established.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionContext, lex, parseForCompletion } from '../src/index.js';

const ctxAt = (source: string) => getCompletionContext(source, source.length);

test('an indented blank line inside a test resolves to step position with an empty prefix', () => {
  assert.deepEqual(ctxAt('test "ok"\n  '), { kind: 'step', prefix: '' });
});

test('the same line after an existing step still resolves', () => {
  assert.deepEqual(ctxAt('test "ok"\n  api GET /health\n  '), { kind: 'step', prefix: '' });
});

test('the prefix is empty, not the probe character', () => {
  // The fix works by lexing one synthetic character so the line stops being blank. If that
  // character survived into `prefix`, the caller would filter candidates by it — and since no
  // keyword starts with `_`, the result would be an empty list again, arrived at differently.
  const ctx = ctxAt('test "ok"\n  ');
  assert.equal(ctx?.prefix, '');
});

test('the answer matches what typing one real character gives, minus the filtering', () => {
  // The claim the fix rests on: the parser could always answer from this cursor position, and only
  // the lexer's view of the line stood in the way. If these two kinds ever disagree, the synthetic
  // character is changing the parse rather than unblocking it.
  assert.equal(ctxAt('test "ok"\n  ')?.kind, ctxAt('test "ok"\n  c')?.kind);
});

test('a tab-indented blank line resolves too', () => {
  assert.deepEqual(ctxAt('test "ok"\n\t'), { kind: 'step', prefix: '' });
});

test('an indented blank line inside an action body resolves', () => {
  assert.deepEqual(ctxAt('action create order(name)\n  '), { kind: 'step', prefix: '' });
});

test('a blank line at column 0 is left alone', () => {
  // D278: indentation means "inside a block". At the left margin the cursor is at declaration
  // position, which is not one of the six instrumented productions — answering there would be
  // inventing a result rather than deriving one.
  assert.equal(ctxAt('test "ok"\n  api GET /health\n'), null);
});

test('an empty document is left alone', () => {
  assert.equal(ctxAt(''), null);
});

test('a line with real content is unaffected by the blank-line path', () => {
  assert.deepEqual(ctxAt('test "ok"\n  ex'), { kind: 'step', prefix: 'ex' });
});

test('nothing completes at declaration position — the fact that makes the column-0 arm redundant', () => {
  // The guard above has two arms; the `line.length === 0` one is currently unfalsifiable from
  // outside. `getCompletionContext` is `parseForCompletion(…) ?? resolveOnBlankLine(…)`, so removing
  // that arm changes an answer only where the parser declines *and* the probe character makes it
  // answer — and at column 0 the probe is a token at indent 0, which dedents out of every block.
  // All seven `completionResult` sites live inside a test or action body; declaration position has
  // none. The mutation harness carries this as `equivalent: true` on the strength of that.
  //
  // This test is what keeps that claim honest. It does not assert the guard — it asserts the fact
  // the guard is redundant *because of*. The day anything sets a completion context at declaration
  // position (a `test`/`action`/`use` keyword list, say), this goes red, and the `equivalent` claim
  // has to be withdrawn in the same change rather than discovered wrong later.
  for (const src of [
    '',
    '\n',
    'test "ok"\n  api GET /health\n',
    'action create order(name)\n  api POST /orders\n',
    'test "ok"\n  expect status equals 200\n',
    'test "ok"\n  api POST /x body {\n',
    'session admin\n  api POST /login\n',
    'env local default\n  api "http://x"\n',
  ]) {
    assert.equal(
      parseForCompletion(lex(src + '_').tokens),
      null,
      `a completion context now exists at declaration position for ${JSON.stringify(src)} — the column-0 arm of resolveOnBlankLine's guard is load-bearing again, and its mutant is no longer equivalent`,
    );
  }
});

test('a line with content is never routed through the blank-line branch', () => {
  // `  expect ` has content before the cursor, so `parseForCompletion` answers and the new branch
  // is never consulted. It answers `step`/`expect` — the trailing space is not enough to move the
  // cursor into subject position, which needs a character (`expect s` → `subject`/`s`, asserted in
  // completion.test.ts). Pinned as the *pre-existing* shape, not as a thing this milestone chose:
  // the assertion that matters here is that adding the branch did not disturb it.
  assert.deepEqual(ctxAt('test "ok"\n  expect '), { kind: 'step', prefix: 'expect' });
});
