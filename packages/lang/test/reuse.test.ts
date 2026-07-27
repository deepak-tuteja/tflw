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
  assert.equal(hint.actionFile, 'shared/log-in.tflw');
  assert.equal(hint.actionName, 'log in');

  // occurrence order follows source order; args follow param order (`username` then `password`,
  // matching the fixture's own field order).
  assert.deepEqual(hint.occurrences[0]!.args, ['"alice"', '"secret1"']);
  assert.deepEqual(hint.occurrences[1]!.args, ['"bob"', '"secret2"']);
  assert.equal(hint.occurrences[0]!.testName, 'checkout as alice');
  assert.equal(hint.occurrences[1]!.testName, 'checkout as bob');

  // the extracted action keeps every identical literal verbatim and only replaces the two that
  // actually vary — with the interpolation matching the deduped param names above.
  assert.match(hint.actionSource, /^action log in\(username, password\)$/m);
  assert.match(hint.actionSource, /open "\/login"/);
  assert.match(hint.actionSource, /fill field "Username" with \{username\}/);
  assert.match(hint.actionSource, /fill field "Password" with \{password\}/);
  assert.match(hint.actionSource, /click button "Log In"/);
  assert.match(hint.actionSource, /expect button "Sign out" is visible/);

  assert.match(hint.diffPreview, /reuse\[RF001\]: 2 occurrences of a similar 5-step sequence/);
  assert.match(hint.diffPreview, /tests\/checkout\.tflw:2 \(test "checkout as alice"\)/);
  assert.match(hint.diffPreview, /call site: log in\("alice", "secret1"\)/);
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
  assert.equal(replacement.text, `  log in("alice", "secret1")\n`);
});
