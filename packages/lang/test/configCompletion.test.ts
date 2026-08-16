// M137a / D444 — `getConfigCompletionContext`, the `tflw.config` half of grammar-shape autocomplete.
//
// This file exists because the first mutation sweep of this milestone said it had to. The rule that
// keeps a deep completion context from being overwritten by a shallower one as recovery unwinds
// lives in `parser.ts` — this package — and every test that could see it lived in `@tflw/lsp-server`,
// one layer up, where the candidate *labels* are assembled. So `config-completion-outer-guard-wins`
// survived against a suite that could not fail: the defect was real, the test was real, and they
// were in different packages.
//
// The candidate lists stay in `configCompletionDetail.test.ts` where they belong. What is asserted
// here is only what this package decides: which production the cursor sits in.
//
// Every source string ends exactly where the cursor sits, the convention completion.test.ts set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfigCompletionContext, getCompletionContext } from '../src/index.js';

const ctxAt = (source: string) => getConfigCompletionContext(source, source.length);

const AUTHORIZED =
  'defaults\n' +
  '  authorized target "http://localhost:4001" reason "self-hosted test fixture"\n';

test('the top level of a config is a completion position — the one place the test dialect has none', () => {
  assert.deepEqual(ctxAt('d'), { kind: 'config-directive', prefix: 'd' });
  assert.deepEqual(ctxAt('sess'), { kind: 'config-directive', prefix: 'sess' });
});

test('a wholly empty line at column 0 still answers nothing (D278 survives the top level being instrumented)', () => {
  assert.equal(ctxAt(''), null);
  assert.equal(ctxAt('defaults\n  timeout 5s\n'), null);
});

test('an entry position knows which block it is in, because the two take different keys', () => {
  assert.deepEqual(ctxAt('defaults\n  '), { kind: 'defaults-key', prefix: '' });
  assert.deepEqual(ctxAt('defaults\n  wor'), { kind: 'defaults-key', prefix: 'wor' });
  assert.deepEqual(ctxAt('env local default\n  '), { kind: 'env-key', prefix: '' });
  assert.deepEqual(ctxAt('env local default\n  ap'), { kind: 'env-key', prefix: 'ap' });
});

// The rule the mutation sweep caught. Both of these resolve inside `parseConfigEntries`' loop, and
// that loop re-enters `parseConfigEntry` on the very token the cursor sits on once the sub-clause
// production has returned — so without first-answer-wins in `atCompletionPoint()`, both come back as
// `defaults-key` and every `probe …` completion in the language offers the list of config keys.
test('a sub-clause line under `authorized target` is probe position, not the enclosing block\'s key position', () => {
  assert.deepEqual(ctxAt(AUTHORIZED + '    '), { kind: 'probe', prefix: '' });
  assert.deepEqual(ctxAt(AUTHORIZED + '    pro'), { kind: 'probe', prefix: 'pro' });
});

test('after `probe ` the cursor is in class position, which is a different production', () => {
  assert.deepEqual(ctxAt(AUTHORIZED + '    probe '), { kind: 'probe-class', prefix: '' });
  assert.deepEqual(ctxAt(AUTHORIZED + '    probe mut'), { kind: 'probe-class', prefix: 'mut' });
});

// A cursor after a completed token is the case `M137a` widened `resolveAtUntypedCursor` for, and
// `probe ` is why. Asserted as the *pair* rather than as one answer: the two positions are one
// character apart in the buffer and produce different kinds, which is the whole claim.
test('the space is what separates the two, and it separates them in both directions', () => {
  assert.equal(ctxAt(AUTHORIZED + '    probe')?.kind, 'probe');
  assert.equal(ctxAt(AUTHORIZED + '    probe ')?.kind, 'probe-class');
});

test('the dialects do not answer for each other', () => {
  // Not tidiness. Before this milestone there was one entry point, so a config buffer was parsed
  // with the test grammar — `defaults` is not a test-dialect declaration, the cursor reached no
  // guarded production, and the answer was silence. Both directions are pinned so the second entry
  // point cannot later be "simplified" back into the first.
  assert.equal(getCompletionContext('defaults\n  ', 'defaults\n  '.length), null);
  assert.equal(ctxAt('test "ok"\n  '), null);
});
