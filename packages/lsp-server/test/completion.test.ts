// Unit tests for resolution/completion.ts (PLAN_M13_LSP.md Phase 2, design decision 3) — the
// candidate-list layer over `@tflw/lang`'s grammar-shape `CompletionContext`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionContext, parseSource, collectSymbols } from '@tflw/lang';
import { getCompletions, variablesInScopeAt } from '../src/index.js';

test('getCompletions: step kind returns keyword candidates filtered by prefix', () => {
  const source = 'test "ok"\n  e';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['expect'],
  );
});

test('getCompletions: matcher kind attaches spec-data.ts detail text', () => {
  const source = 'test "ok"\n  expect status e';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const equalsCandidate = candidates.find((c) => c.label === 'equals');
  assert.ok(equalsCandidate);
  assert.match(equalsCandidate!.detail ?? '', /any value/);
});

test('getCompletions: subject kind includes `request` (decision 18)', () => {
  const source = 'test "ok"\n  expect r';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['request'],
  );
});

test('getCompletions: matcher kind includes `connects`/`fails` with their own spec-data.ts detail text, not the state-word one (decision 18)', () => {
  const source = 'test "ok"\n  expect request c';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const connectsCandidate = candidates.find((c) => c.label === 'connects');
  assert.ok(connectsCandidate);
  assert.match(connectsCandidate!.detail ?? '', /`request`/);

  const failsSource = 'test "ok"\n  expect request f';
  const failsCtx = getCompletionContext(failsSource, failsSource.length)!;
  const failsCandidate = getCompletions(failsCtx).find((c) => c.label === 'fails');
  assert.ok(failsCandidate);
  assert.match(failsCandidate!.detail ?? '', /`request`/);
});

test('getCompletions: session kind uses the caller-supplied knownSessions list', () => {
  const source = 'test "ok" as a';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx, { knownSessions: ['admin', 'userA', 'billing'] }).map((c) => c.label),
    ['admin'],
  );
});

test('getCompletions: session kind is empty without a knownSessions source', () => {
  const source = 'test "ok" as a';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx), []);
});

test('getCompletions: unique kind attaches spec-data.ts detail text', () => {
  const source = 'test "ok"\n  let x = unique e';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['email'],
  );
  assert.match(candidates[0]!.detail ?? '', /collision-safe/);
});

test('getCompletions: random kind attaches spec-data.ts detail text', () => {
  const source = 'test "ok"\n  let x = random n';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['number'],
  );
});

test('getCompletions: transform kind attaches spec-data.ts detail text (decision 22/M18)', () => {
  const source = 'test "ok"\n  let x = base64 e';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['encode'],
  );
  assert.match(candidates[0]!.detail ?? '', /not a fresh-value generator \(M18\)/);
});

// -- M4a: browser-arc (M3a-M3e) step/subject/matcher keywords, previously missing from these ------
// independent-copy wordlists entirely (only API-dialect vocab was ever added here).

test('getCompletions: step kind includes browser-arc step keywords (M3a-M3d)', () => {
  const source = 'test "ok"\n  cl';
  const ctx = getCompletionContext(source, source.length)!;
  // `cleanup` (M29/M33) used to sit here too — it also starts with `cl`. `M157c` retired the
  // keyword and `M157e` deleted its manifest row, and this list is built from the manifest, so it
  // left without this file being edited for it. That is `D724`'s rule paying for itself in the
  // direction it is rarely read: the row goes when the construct does, and every consumer follows.
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['click', 'close']);
});

// M28 (PLAN_LOG_LSP.md): `log` (M27) had never caught this independent-copy wordlist up either.
test('getCompletions: step kind includes `log` (M27/M28) — `lo` prefix matches only `log`', () => {
  const source = 'test "ok"\n  lo';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['log']);
});

test('getCompletions: subject kind includes UI locator + page subjects (M3a, M3e)', () => {
  const source = 'test "ok"\n  expect pa';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['page']);
});

test('getCompletions: matcher kind includes `has no [<severity>] a11y violations` (M3e)', () => {
  const source = 'test "ok"\n  expect page h';
  const ctx = getCompletionContext(source, source.length)!;
  const labels = getCompletions(ctx).map((c) => c.label);
  assert.ok(labels.includes('has no a11y violations'));
  for (const sev of ['minor', 'moderate', 'serious', 'critical']) {
    assert.ok(labels.includes(`has no ${sev} a11y violations`), `missing severity floor: ${sev}`);
  }
});

// M133 (D24b catch-up). Both scans are asserted with their `detail` non-empty, not just their
// label: a candidate list that offers `has no authorization violations` and says nothing about it
// is the exact failure `FU-24`/D251 named for the step list, and these two matchers are the ones in
// the language a user is least likely to already know the semantics of.
test('getCompletions: matcher kind includes `has no [<severity>] security violations` (M128b) with detail', () => {
  const source = 'test "ok"\n  expect response h';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const labels = candidates.map((c) => c.label);
  assert.ok(labels.includes('has no security violations'));
  for (const sev of ['minor', 'moderate', 'serious', 'critical']) {
    assert.ok(labels.includes(`has no ${sev} security violations`), `missing severity floor: ${sev}`);
  }
  assert.ok(candidates.find((c) => c.label === 'has no security violations')!.detail, 'spec-data supplies the detail line');
});

test('getCompletions: matcher kind includes `has no [<severity>] authorization violations` (M130b/D304) with detail', () => {
  const source = 'test "ok"\n  expect response h';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const labels = candidates.map((c) => c.label);
  assert.ok(labels.includes('has no authorization violations'));
  for (const sev of ['minor', 'moderate', 'serious', 'critical']) {
    assert.ok(labels.includes(`has no ${sev} authorization violations`), `missing severity floor: ${sev}`);
  }
  assert.ok(candidates.find((c) => c.label === 'has no authorization violations')!.detail, 'spec-data supplies the detail line');
});

// M137a (`D384`'s residue) — the arc's third scan, which `M134a` shipped without the guard its two
// predecessors have. Same `detail` assertion for the same reason: this is now the matcher in the
// language whose semantics a reader is least likely to already hold, and the two-word scan name is
// the one place a wordlist could half-catch-up and still look right.
test('getCompletions: matcher kind includes `has no [<severity>] input handling violations` (M134a/D366) with detail', () => {
  const source = 'test "ok"\n  expect response h';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const labels = candidates.map((c) => c.label);
  assert.ok(labels.includes('has no input handling violations'));
  for (const sev of ['minor', 'moderate', 'serious', 'critical']) {
    assert.ok(labels.includes(`has no ${sev} input handling violations`), `missing severity floor: ${sev}`);
  }
  assert.ok(candidates.find((c) => c.label === 'has no input handling violations')!.detail, 'spec-data supplies the detail line');
});

test('getCompletions: matcher kind includes `matches file` (gap #17), `matches snapshot` (M4b), and `was made` (M3d)', () => {
  const fileSource = 'test "ok"\n  expect body bytes m';
  const fileCtx = getCompletionContext(fileSource, fileSource.length)!;
  assert.deepEqual(
    getCompletions(fileCtx).map((c) => c.label),
    ['matches', 'matches subset', 'matches schema', 'matches file', 'matches snapshot'],
  );

  const madeSource = 'test "ok"\n  expect request to "/x" w';
  const madeCtx = getCompletionContext(madeSource, madeSource.length)!;
  assert.deepEqual(getCompletions(madeCtx).map((c) => c.label), ['was made']);
});

test('getCompletions: transform kind after `hex`/`url` too, matching on `decode`', () => {
  const source = 'test "ok"\n  let x = hex d';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['decode'],
  );
});

// -- M4b: visual regression (`matches snapshot`) ------------------------------------------------

test('getCompletions: matcher kind includes `matches snapshot` once `matches` is fully typed (trailing space)', () => {
  const source = 'test "ok"\n  expect page matches ';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(ctx, { kind: 'matcher', prefix: 'matches' });
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['matches', 'matches subset', 'matches schema', 'matches file', 'matches snapshot'],
  );
  const snapshotCandidate = candidates.find((c) => c.label === 'matches snapshot');
  assert.match(snapshotCandidate?.detail ?? '', /page.*UI locators/);
});

// -- M33 (perf-arc LSP/VS Code catch-up, D24b): the M29-M32 load-testing keywords had never been
// offered by completion at all — `STEP_KEYWORDS` predated the whole arc. ------------------------

test('getCompletions (M33/FS-05): step kind includes `pause` inside a workload-bearing body', () => {
  // `pa` alone would also match `parallel`; narrow past where they diverge, same reasoning as the
  // `cleanup`-vs-`click`/`close` case below. Before FS-05 this was `thi` for `think`, kept clear of
  // `threshold`.
  const source = 'test "checkout burst"\n  ramp to 10 users over 30s\n  pau';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(ctx, { kind: 'step', prefix: 'pau' });
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['pause'],
  );
});

test('FS-05: `think` is not offered by completion — a retired spelling must not be suggested back to the reader', () => {
  const source = 'test "checkout burst"\n  ramp to 10 users over 30s\n  th';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(ctx, { kind: 'step', prefix: 'th' });
  const labels = getCompletions(ctx).map((c) => c.label);
  assert.ok(!labels.includes('think'), `completion still offers a removed keyword: ${JSON.stringify(labels)}`);
  assert.ok(labels.includes('threshold'), `expected the real \`th\` keyword to still be offered: ${JSON.stringify(labels)}`);
});

test('FS-04: `uncheck` is not offered by completion, but `untick` is', () => {
  const source = 'test "ok"\n  un';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(ctx, { kind: 'step', prefix: 'un' });
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['untick'],
  );
});

test('getCompletions (M33): step kind includes `ramp`/`threshold` at the start of a scenario body line', () => {
  const rampSource = 'test "checkout burst"\n  ra';
  const rampCtx = getCompletionContext(rampSource, rampSource.length)!;
  assert.deepEqual(rampCtx, { kind: 'step', prefix: 'ra' });
  assert.deepEqual(
    getCompletions(rampCtx).map((c) => c.label),
    ['ramp'],
  );

  const thresholdSource = 'test "checkout burst"\n  ramp to 10 users over 30s\n  thr';
  const thresholdCtx = getCompletionContext(thresholdSource, thresholdSource.length)!;
  assert.deepEqual(thresholdCtx, { kind: 'step', prefix: 'thr' });
  assert.deepEqual(
    getCompletions(thresholdCtx).map((c) => c.label),
    ['threshold'],
  );

  // `cleanup` was the third arm here until `M157c` retired it. Kept as a **negative**: the word is
  // still dispatched by `parseTestBody`, so "the parser recognises it" and "the editor offers it"
  // have to be able to disagree, and this is where that is asserted. Offering a retired spelling is
  // `B5-10`'s direction of error — the highlighter finishing a word the checker then rejects.
  const cleanupSource = 'test "checkout burst"\n  ramp to 10 users over 30s\n  clea';
  const cleanupCtx = getCompletionContext(cleanupSource, cleanupSource.length)!;
  assert.deepEqual(cleanupCtx, { kind: 'step', prefix: 'clea' });
  assert.deepEqual(
    getCompletions(cleanupCtx).map((c) => c.label),
    [],
  );
});

// ---- M96/D134: bound variables in subject position -------------------------
//
// `FU-11`'s real failure mode was never that the grammar rejected `expect {orderId} …` — it was
// that nobody discovered the form. The subject list is a wall a user hits once and routes around
// permanently, and what they learn instead is the `actions.md` workaround. So this is load-bearing,
// not polish, and it gets the same test treatment as the grammar.

test('getCompletions: subject kind offers bound variables alongside keywords (M96/D134)', () => {
  // A one-letter prefix, not a bare `expect ` — with a trailing space `getCompletionContext` still
  // reports `kind: 'step'` (`atCompletionPoint` fires only on an ident token or eof). Pre-existing,
  // and orthogonal to M96.
  const source = 'test "ok"\n  expect s';
  const ctx = getCompletionContext(source, source.length)!;
  assert.equal(ctx.kind, 'subject');
  const labels = getCompletions(ctx, { knownVariables: ['sku', 'orderId'] }).map((c) => c.label);
  assert.ok(labels.includes('{sku}'), 'the matching variable is offered');
  assert.ok(!labels.includes('{orderId}'), 'and a non-matching one is filtered out');
  assert.ok(labels.includes('status'), 'and the keywords are still there');
});

test('getCompletions: a variable candidate inserts braces but filters on the bare name (M96)', () => {
  // The label has to be `{orderId}` because that is what must end up in the buffer; the user types
  // `or`, so without `filterText` the client would drop the entry at the first keystroke.
  const source = 'test "ok"\n  expect or';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx, { knownVariables: ['orderId'] });
  const v = candidates.find((c) => c.label === '{orderId}');
  assert.ok(v, 'the prefix `or` matches the bare name, not the braced label');
  assert.equal(v!.filterText, 'orderId');
});

test('getCompletions: keywords outrank variables of the same name (M96/D134)', () => {
  // `status` the response subject must not be outranked by someone's `let status = …`. No sortText
  // bookkeeping does this — `{` sorts after every letter, so default lexicographic order suffices.
  const source = 'test "ok"\n  expect stat';
  const ctx = getCompletionContext(source, source.length)!;
  const labels = getCompletions(ctx, { knownVariables: ['status'] }).map((c) => c.label);
  assert.deepEqual(labels, ['status', '{status}']);
  assert.ok(labels.indexOf('status') < labels.indexOf('{status}'));
});

test('getCompletions: no variables in scope changes nothing (M96)', () => {
  // The control: the new branch must be inert when the caller supplies nothing, so every existing
  // subject-completion behaviour is untouched.
  const source = 'test "ok"\n  expect r';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['request']);
});

// ---- M96/D134: what is actually in scope at the cursor ---------------------

test('variablesInScopeAt: only bindings above the cursor, in the enclosing test (M96)', () => {
  const source = [
    'test "a"',
    '  let early = 1',
    '  expect ',
    '  let late = 2',
    'test "b"',
    '  let other = 3',
    '  expect status equals 200',
  ].join('\n');
  const offset = source.indexOf('  expect ') + '  expect '.length;
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  assert.deepEqual(variablesInScopeAt(program, symbols, offset), ['early']);
});

test('variablesInScopeAt: an action sees its own parameters (M96)', () => {
  const source = ['action create order(name, qty)', '  expect ', ''].join('\n');
  const offset = source.indexOf('  expect ') + '  expect '.length;
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  assert.deepEqual(variablesInScopeAt(program, symbols, offset), ['name', 'qty']);
});

test('variablesInScopeAt: a `before each` hook binds into every test body (M96)', () => {
  // Such a hook runs before the test whatever order it appears in the file, so its names are not
  // subject to the above-the-cursor rule the way a `let` in the test body is.
  const source = ['before each', '  let token = "t"', '', 'test "a"', '  expect ', ''].join('\n');
  const offset = source.indexOf('  expect ') + '  expect '.length;
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  assert.deepEqual(variablesInScopeAt(program, symbols, offset), ['token']);
});

test('variablesInScopeAt: a `before file` hook does NOT bind into a test body (M96)', () => {
  // The paired control. `before file` has its own response scope and its own variable scope at run
  // time (`runFileHooks` builds a fresh `Map`), so offering its names would suggest a completion
  // the checker then rejects with `TF030` — a suggestion that cannot compile is worse than none.
  const source = ['before file', '  let setup = "s"', '', 'test "a"', '  expect ', ''].join('\n');
  const offset = source.indexOf('  expect ') + '  expect '.length;
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  assert.deepEqual(variablesInScopeAt(program, symbols, offset), []);
});

test('variablesInScopeAt: outside any test/action/hook, nothing is in scope (M96)', () => {
  const source = ['test "a"', '  let x = 1', '  expect status equals 200', ''].join('\n');
  const { program } = parseSource(source);
  const symbols = collectSymbols(program, source);
  assert.deepEqual(variablesInScopeAt(program, symbols, 0), []);
});
