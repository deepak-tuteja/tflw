// The reuse pass (M6, P#2): similarity detection across a suite -> extraction hints with a
// prepared `action`, params, and call-site preview. See reuse.ts's module doc comment for the v1
// scope this targets (flat, non-binding step sequences within a single test body).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';
import { detectReuse, renderCallSiteReplacement, type SuiteEntry } from '../src/reuse.js';

function entry(path: string, source: string): SuiteEntry {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture ${path} must parse cleanly`);
  return { path, source, program };
}

const LOGIN_A = `test "checkout as alice"
  open "/login"
  fill field "Username" with "alice"
  fill field "Password" with "secret1"
  click button "Log In"
  expect button "Sign out" is visible
`;

const LOGIN_B = `test "checkout as bob"
  open "/login"
  fill field "Username" with "bob"
  fill field "Password" with "secret2"
  click button "Log In"
  expect button "Sign out" is visible
`;

test('finds a duplicated 5-step flow across two tests, parameterizing only the differing literals', () => {
  const e = entry('tests/checkout.tflw', LOGIN_A + '\n' + LOGIN_B);
  const hints = detectReuse([e]);

  assert.equal(hints.length, 1);
  const hint = hints[0]!;
  assert.equal(hint.id, 'RF001');
  assert.equal(hint.length, 5);
  assert.equal(hint.occurrences.length, 2);
  assert.deepEqual([...hint.params].sort(), ['password', 'username']);
  // M27 (PLAN_LOG.md): "log" is now a real statement keyword, so the generic collision guard
  // (reuse.ts:615-634, already covering "open"/"close"-prefixed names) prefixes the generated
  // name with "the" — working as designed, not a regression.
  assert.equal(hint.actionFile, 'shared/the-log-in.tflw');
  assert.equal(hint.actionName, 'the log in');

  // occurrence order follows source order; args follow param order (`username` then `password`,
  // matching the fixture's own field order).
  assert.deepEqual(hint.occurrences[0]!.args, ['"alice"', '"secret1"']);
  assert.deepEqual(hint.occurrences[1]!.args, ['"bob"', '"secret2"']);
  assert.equal(hint.occurrences[0]!.testName, 'checkout as alice');
  assert.equal(hint.occurrences[1]!.testName, 'checkout as bob');

  // the extracted action keeps every identical literal verbatim and only replaces the two that
  // actually vary — with the interpolation matching the deduped param names above.
  assert.match(hint.actionSource, /^action the log in\(username, password\)$/m);
  assert.match(hint.actionSource, /open "\/login"/);
  assert.match(hint.actionSource, /fill field "Username" with \{username\}/);
  assert.match(hint.actionSource, /fill field "Password" with \{password\}/);
  assert.match(hint.actionSource, /click button "Log In"/);
  assert.match(hint.actionSource, /expect button "Sign out" is visible/);

  assert.match(hint.diffPreview, /reuse\[RF001\]: 2 occurrences of a similar 5-step sequence/);
  assert.match(hint.diffPreview, /tests\/checkout\.tflw:2 \(test "checkout as alice"\)/);
  assert.match(hint.diffPreview, /call site: the log in\("alice", "secret1"\)/);
  assert.match(hint.diffPreview, /apply: tflw refactor apply RF001/);
});

test('a below-threshold shared prefix (fewer than 3 steps) is not flagged', () => {
  // The third step's locator text genuinely differs ("Confirm" vs. "Cancel") — a structural
  // difference (locator names are never parameterized, D6/D7 exactness), not just a literal one —
  // so only the leading 2-step run ("open", "click Go") can match, and 2 < MIN_LEN.
  const a = `test "a"\n  open "/x"\n  click button "Go"\n  click button "Confirm"\n`;
  const b = `test "b"\n  open "/x"\n  click button "Go"\n  click button "Cancel"\n`;
  const hints = detectReuse([entry('t.tflw', a + '\n' + b)]);
  assert.deepEqual(hints, []);
});

test('a `let` in the middle breaks a window in two — only the eligible sides can match', () => {
  const a = `test "a"
  open "/x"
  click button "Start"
  hover button "Start"
  let id = unique number
  click button "Finish"
  hover button "Finish"
  scroll to button "Finish"
`;
  const b = `test "b"
  open "/x"
  click button "Start"
  hover button "Start"
  let id = unique number
  click button "Finish"
  hover button "Finish"
  scroll to button "Finish"
`;
  const hints = detectReuse([entry('t.tflw', a + '\n' + b)]);
  assert.equal(hints.length, 2);
  const lengths = hints.map((h) => h.length).sort();
  assert.deepEqual(lengths, [3, 3]);
});

test('the same 3-step block repeated twice inside one test is detected (self-duplication)', () => {
  const src = `test "double click flow"
  click button "Retry"
  hover button "Retry"
  scroll to button "Retry"
  click button "Retry"
  hover button "Retry"
  scroll to button "Retry"
`;
  const hints = detectReuse([entry('t.tflw', src)]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0]!.length, 3);
  assert.equal(hints[0]!.occurrences.length, 2);
  assert.equal(hints[0]!.occurrences[0]!.path, 't.tflw');
});

test('a proposed action name never collides with a statement keyword (M7 acceptance regression)', () => {
  // No `ClickStmt`/`ApiStep` in this window, so `proposeActionName` falls through to the
  // `OpenStmt` path — which, before this fix, literally prefixed the name with the word "open"
  // (`words('open ' + lastPathSegment(...))`). The generated call site was then `open products()`,
  // a real string a real user would see — and since the parser's statement dispatcher routes
  // unconditionally on a leading `open` token to `parseOpenStep()` (expects a string-literal path
  // next), that bare `CallStmt` failed to parse with "expected a path to open" (TF010). Found via
  // M7 acceptance running `tflw refactor apply` against a real extraction in testFlow-tests'
  // webv2-storefront.tflw whose only distinguishing step was an `OpenStmt`.
  // `OpenStmt.path` is a strictly-typed field (never parameterized — module doc above), so both
  // occurrences must open the exact same path; the differing `fill` value is what makes this a
  // genuine (non-trivial) duplicate instead of two byte-identical tests.
  const a = `test "a"\n  open "/products/widget"\n  fill field "Quantity" with "1"\n  expect button "Log out" is visible\n`;
  const b = `test "b"\n  open "/products/widget"\n  fill field "Quantity" with "2"\n  expect button "Log out" is visible\n`;
  const hints = detectReuse([entry('t.tflw', a + '\n' + b)]);
  assert.equal(hints.length, 1);
  const hint = hints[0]!;
  assert.notEqual(hint.actionName.split(' ')[0], 'open');
  // The generated action source itself must round-trip through the parser cleanly — the real bug
  // was invisible from `actionName` alone (a plain string) until actually re-parsed.
  const { diagnostics } = parseSource(hint.actionSource);
  assert.deepEqual(diagnostics, [], `generated action source must parse cleanly:\n${hint.actionSource}`);
  const replacement = renderCallSiteReplacement(hint.actionName, hint.occurrences[0]!, a);
  const { diagnostics: callDiagnostics } = parseSource(`test "x"\n${replacement.text}`);
  assert.deepEqual(callDiagnostics, [], `generated call site must parse cleanly: ${replacement.text}`);
});

test('a window step referencing a variable only bound in the caller (outside the window) is never matched (M7 acceptance regression)', () => {
  // Both tests' `open` step is byte-identical text — `"/products/{bulk100Id}"` — so naive
  // structural matching would cluster them just like the keyword-collision test above. But
  // `bulk100Id` is bound by each test's own preceding `capture`, *outside* the candidate window
  // (captures can never appear inside one — module doc above) — the variable doesn't exist inside
  // an extracted action's own scope, so a real `tflw refactor apply` against this exact shape
  // (testFlow-tests' webv2-storefront.tflw, M7 acceptance) produced an action whose first `open`
  // step failed with "unknown variable bulk100Id" the moment it actually ran. The step must be
  // excluded from matching entirely, not just from parameterization.
  const a = `test "a"\n  api GET /products\n  capture body.id as bulk100Id\n  open "/products/{bulk100Id}"\n  fill field "Quantity" with "1"\n  expect button "Log out" is visible\n`;
  const b = `test "b"\n  api GET /other\n  capture body.id as bulk100Id\n  open "/products/{bulk100Id}"\n  fill field "Quantity" with "2"\n  expect button "Log out" is visible\n`;
  const hints = detectReuse([entry('t.tflw', a + '\n' + b)]);
  assert.deepEqual(hints, []);
});

test('three or more occurrences of the same sequence cluster into a single hint', () => {
  const mk = (n: number) => `test "user ${n}"\n  open "/login"\n  fill field "Username" with "user${n}"\n  click button "Log In"\n`;
  const src = [mk(1), mk(2), mk(3)].join('\n');
  const hints = detectReuse([entry('t.tflw', src)]);
  assert.equal(hints.length, 1);
  assert.equal(hints[0]!.occurrences.length, 3);
  assert.deepEqual(hints[0]!.params, ['username']);
});

test('structurally different sequences (different button text) never cluster together', () => {
  const a = `test "a"\n  open "/x"\n  click button "Save"\n  hover button "Save"\n`;
  const b = `test "b"\n  open "/x"\n  click button "Delete"\n  hover button "Delete"\n`;
  const hints = detectReuse([entry('t.tflw', a + '\n' + b)]);
  assert.deepEqual(hints, []);
});

test('a locator name (StringLit-strict field) is never parameterized, only genuine Value-typed slots are', () => {
  // Same locator ("Save") in both, but the click *kind* differs (single vs double) — this is a
  // purely structural difference the pass must never paper over by "parameterizing" a step kind.
  const a = `test "a"\n  open "/x"\n  click button "Save"\n  hover button "Save"\n  scroll to button "Save"\n`;
  const b = `test "b"\n  open "/x"\n  double click button "Save"\n  hover button "Save"\n  scroll to button "Save"\n`;
  const hints = detectReuse([entry('t.tflw', a + '\n' + b)]);
  // only the trailing 2-step (hover, scroll) shape matches — below MIN_LEN, so nothing is flagged.
  assert.deepEqual(hints, []);
});

test('renderCallSiteReplacement preserves original indentation and produces a well-formed call line', () => {
  const combined = entry('t.tflw', LOGIN_A + '\n' + LOGIN_B);
  const hints = detectReuse([combined]);
  assert.equal(hints.length, 1);
  const hint = hints[0]!;
  const occ = hint.occurrences[0]!;
  const replacement = renderCallSiteReplacement(hint.actionName, occ, combined.source);
  assert.equal(combined.source.slice(replacement.start, replacement.end).startsWith('  open "/login"'), true);
  // M27 (PLAN_LOG.md): "the" prefix, same collision guard as above.
  assert.equal(replacement.text, `  the log in("alice", "secret1")\n`);
});
