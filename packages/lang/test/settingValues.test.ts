// `M147c` (`A2-09`, D631/D632) — `TF071`: **a setting whose written value is outside the range the
// setting can act on.**
//
// Five slots in the language take a bare number and, before this file existed, not one of them read
// it. `workers 0`, `viewport 0 0`, `timeout step 0s` and `retry 2.5` each reached `tflw check`'s
// "no problems found" and then ran something nobody wrote — zero workers, a viewport with no area,
// a `setTimeout(abort, 0)` on every request, and three attempts where two-and-a-half retries were
// asked for. The rule that closes all four is in SPEC §3.1.
//
// **What the negative controls are protecting, and why there are so many of them.** Three of the
// legal spellings below are *zeros*, and a rule phrased as "a setting may not be zero" would refuse
// every one of them. `timeout expect 0s` and `timeout wait 0s` mean *evaluate once, don't poll* —
// both poll loops are `for (;;)` bodies that test their deadline only after the first evaluation,
// so zero is a real setting there and not a mistake. `retry 0` and `up to 0` are the defaults said
// out loud. The rule is about the *promise*, never about the number, which is the same line
// `random string 0` draws in §4.1 — and these tests are what stops the next edit from flattening it.
//
// **Negatives are deliberately absent from the refusal set and present as a control.** `workers -1`
// was never silent: the lexer emits `-` as its own token, so every one of these slots rejects it as
// *not a number at all*, `TF010`, and always has. Measured before the rule was written rather than
// assumed, and asserted below so that a future `settingValue` that starts handling negatives is
// caught changing a code that other tooling already keys on.
//
// The blunt control for the whole file: delete the `min` comparison in `settingValue` and the zero
// tests fail; delete the `Number.isInteger` test and the fraction tests fail; make the `timeout`
// call site unconditional and the two legal-zero timeout tests fail.
//
// `M92d`'s rule throughout — a negative control that cannot fail is a passing test of nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, parseSource, Codes, DEMO_BASE_URL } from '../src/index.js';

/** A `defaults` block's diagnostics, as codes. The `env` block is present because a config without
 *  one is a different complaint, and this file is not testing that one. */
const configCodes = (body: string): string[] =>
  parseConfigSource(`defaults\n${body}\n\nenv local default\n  api "https://example.test"\n`).diagnostics.map((d) => d.code);

const configMessages = (body: string): string[] =>
  parseConfigSource(`defaults\n${body}\n\nenv local default\n  api "https://example.test"\n`).diagnostics.map(
    (d) => `${d.message} | ${d.hint ?? ''}`,
  );

/** A whole test file's parse diagnostics, as codes. */
const fileCodes = (source: string): string[] => parseSource(source).diagnostics.map((d) => d.code);

const fileMessages = (source: string): string[] =>
  parseSource(source).diagnostics.map((d) => `${d.message} | ${d.hint ?? ''}`);

const RETRY = (header: string) => `test "t" ${header}\n  api GET /a\n  expect status equals 200\n`;
const HONORING = (n: string) =>
  `test "t"\n  api GET /a\n    retry honoring "Retry-After" up to ${n}\n  expect status equals 200\n`;

// -- `workers` ---------------------------------------------------------------------------------
//
// The one slot where the language already had the answer and only half-applied it: `--workers 0`
// has always been a usage error ("expects a positive integer", `cli.ts`), while `workers 0` in
// `tflw.config` was accepted. Same value, same setting, two doors, one rule — that asymmetry is the
// whole of `A2-09`'s first line, and the first test below is the one that closes it.

test('`workers 0` is refused — a run needs at least one worker', () => {
  assert.deepEqual(configCodes('  workers 0'), [Codes.INVALID_SETTING_VALUE]);
});

test('`workers 2.5` is refused — workers are whole processes', () => {
  assert.deepEqual(configCodes('  workers 2.5'), [Codes.INVALID_SETTING_VALUE]);
});

test('`workers 1` is silent — the sequential default, spelled out', () => {
  assert.deepEqual(configCodes('  workers 1'), []);
});

test('`workers 4` is silent', () => {
  assert.deepEqual(configCodes('  workers 4'), []);
});

test('the `workers` message names the value as written and points at `workers 1`', () => {
  const [msg] = configMessages('  workers 0');
  assert.match(msg!, /`workers 0` is below the smallest value this setting can take \(1\)/);
  assert.match(msg!, /at least one worker/);
});

// -- `viewport` --------------------------------------------------------------------------------
//
// Two dimensions on one line, and **both are reported**. `viewport 0 0` is two mistakes, and
// stopping at the first would send someone back for a second `check` to be told about the other
// half.
//
// The first version of this test failed, and the reason is worth keeping: M83's panic mode drops
// any diagnostic raised without the cursor having moved since the last one, so checking both values
// after reading both tokens got the width reported and the height silently swallowed. The parser
// now reads-then-checks each dimension in turn, which puts a consumed token between the two calls.
// This assertion is what holds that ordering in place, and any future setting that takes two
// numbers on one line inherits the same requirement.

test('`viewport 0 0` reports both dimensions, not just the first', () => {
  assert.deepEqual(configCodes('  viewport 0 0'), [Codes.INVALID_SETTING_VALUE, Codes.INVALID_SETTING_VALUE]);
});

test('`viewport 1280 0` reports only the height', () => {
  const msgs = configMessages('  viewport 1280 0');
  assert.equal(msgs.length, 1);
  assert.match(msgs[0]!, /viewport height 0/);
});

test('`viewport 0 720` reports only the width', () => {
  const msgs = configMessages('  viewport 0 720');
  assert.equal(msgs.length, 1);
  assert.match(msgs[0]!, /viewport width 0/);
});

test('`viewport 1280.5 720` is refused — pixels are whole', () => {
  const msgs = configMessages('  viewport 1280.5 720');
  assert.equal(msgs.length, 1);
  assert.match(msgs[0]!, /`viewport width 1280\.5` is not a whole number/);
});

test('`viewport 1280 720` is silent — Playwright\'s own default', () => {
  assert.deepEqual(configCodes('  viewport 1280 720'), []);
});

test('`viewport 1 1` is silent — degenerate but renderable, and not the checker\'s taste to police', () => {
  assert.deepEqual(configCodes('  viewport 1 1'), []);
});

// -- `timeout <target>` ------------------------------------------------------------------------
//
// **The asymmetry is the point.** `timeout step 0s` hands `setTimeout(abort, 0)` to every request,
// so the suite fails before a byte is sent; the other two targets poll, and both loops evaluate
// once before testing the deadline, so `0s` there is a legible setting: *evaluate once, don't
// poll*. Flattening the three targets into one rule would refuse two working configs.

test('`timeout step 0s` is refused — every request aborts before it is sent', () => {
  assert.deepEqual(configCodes('  timeout step 0s'), [Codes.INVALID_SETTING_VALUE]);
});

test('`timeout expect 0s` is silent — evaluate once, don\'t poll', () => {
  assert.deepEqual(configCodes('  timeout expect 0s'), []);
});

test('`timeout wait 0s` is silent — evaluate once, don\'t poll', () => {
  assert.deepEqual(configCodes('  timeout wait 0s'), []);
});

test('`timeout step 0s` inside a comma list is still refused', () => {
  assert.deepEqual(configCodes('  timeout step 0s, expect 5s'), [Codes.INVALID_SETTING_VALUE]);
});

test('`timeout step 1ms` is silent — a real budget, however small', () => {
  assert.deepEqual(configCodes('  timeout step 1ms'), []);
});

test('`timeout step 10s, expect 5s, wait 30s` is silent — SPEC §3.1\'s own example', () => {
  assert.deepEqual(configCodes('  timeout step 10s, expect 5s, wait 30s'), []);
});

test('the `timeout step` hint says why, and says the other two targets are different', () => {
  const [msg] = configMessages('  timeout step 0s');
  assert.match(msg!, /aborts every request before it is sent/);
  assert.match(msg!, /`timeout expect 0s`\/`timeout wait 0s` are different and stay legal/);
});

// -- `retry N` on a test header ----------------------------------------------------------------
//
// `1 + Math.max(0, test.retry)` is what the interpreter computes, so `retry 2.5` asked for
// two-and-a-half re-runs and silently got the same three attempts as `retry 2`. Not a rounding
// nicety — the file said one thing and the run did another.

test('`retry 2.5` is refused — attempts are whole', () => {
  assert.deepEqual(fileCodes(RETRY('retry 2.5')), [Codes.INVALID_SETTING_VALUE]);
});

test('`retry 0` is silent — the default, spelled out loud', () => {
  assert.deepEqual(fileCodes(RETRY('retry 0')), []);
});

test('`retry 2` is silent', () => {
  assert.deepEqual(fileCodes(RETRY('retry 2')), []);
});

test('the `retry` message quotes what was written and explains the attempt count', () => {
  const [msg] = fileMessages(RETRY('retry 2.5'));
  assert.match(msg!, /`retry 2\.5` is not a whole number/);
  assert.match(msg!, /`retry 2` runs the test up to three times/);
});

test('a refused `retry` does not also break the rest of the header', () => {
  // The value is rejected, the modifier is not — `as admin` after it must still parse, or one
  // mistyped count would cascade into a second, unrelated diagnostic (`M83`'s rule).
  assert.deepEqual(fileCodes(RETRY('retry 2.5 as admin')), [Codes.INVALID_SETTING_VALUE]);
});

// -- `retry honoring "…" up to N` --------------------------------------------------------------
//
// Same family, one line away, and `up to 0` stays legal for the same reason `retry 0` does: it says
// *honour the header, then don't re-issue*. Only the fractional case is new.

test('`up to 1.5` is refused', () => {
  assert.deepEqual(fileCodes(HONORING('1.5')), [Codes.INVALID_SETTING_VALUE]);
});

test('`up to 0` is silent — honour the header, then don\'t re-send', () => {
  assert.deepEqual(fileCodes(HONORING('0')), []);
});

test('`up to 3` is silent — SPEC §5.5\'s own example', () => {
  assert.deepEqual(fileCodes(HONORING('3')), []);
});

// -- the control: negatives were never this rule's business ------------------------------------
//
// Measured before the rule was written. The lexer emits `-` as its own token, so these slots reject
// a negative as *not a number*, `TF010`, long before any range is considered — which is why the
// rule above is phrased around zero and fractions and says nothing about sign. Asserted here so a
// later `settingValue` that starts handling negatives is caught changing a code other tooling
// already keys on, rather than discovered by a dogfood fixture in the sibling repo.

test('`workers -1` is TF010, not TF071 — the grammar rejects it as not-a-number', () => {
  assert.deepEqual(configCodes('  workers -1'), [Codes.UNEXPECTED_TOKEN]);
});

test('`viewport -2 -3` is TF010, not TF071', () => {
  assert.deepEqual(configCodes('  viewport -2 -3'), [Codes.UNEXPECTED_TOKEN]);
});

test('`retry -1` is TF010, not TF071', () => {
  assert.deepEqual(fileCodes(RETRY('retry -1')), [Codes.UNEXPECTED_TOKEN]);
});

// -- the sixth slot, and it is not a number ----------------------------------------------------
//
// `M118-01`. `tflw://` is reserved and `tflw://demo` is the only address under it, so
// `api "tflw://dmeo"` names a value the setting cannot act on for exactly the reason `workers 0`
// does — and it used to parse, check green, and die at run time naming the only legal spelling.
//
// This one is decided in the **checker**, not the parser, and the difference is principled: the
// range of a number is a fact about its shape that the production reading it already knows
// everything about, while what a scheme reserves is a fact about the language's own semantics. The
// interpolated control is D147's line and the one that would matter most if it broke — a checker
// that evaluated `"tflw://{TARGET}"` would refuse a config that runs.

test('`api "tflw://dmeo"` is refused — one legal address under the reserved scheme', () => {
  assert.deepEqual(
    parseConfigSource('env local default\n  api "tflw://dmeo"\n').diagnostics.map((d) => d.code),
    [Codes.INVALID_SETTING_VALUE],
  );
});

test('`api "tflw://demo"` is silent — what `tflw init` scaffolds', () => {
  assert.deepEqual(parseConfigSource('env local default\n  api "tflw://demo"\n').diagnostics, []);
});

test('`api "tflw://{TARGET}"` is silent — not decidable here (D147)', () => {
  assert.deepEqual(parseConfigSource('env local default\n  api "tflw://{TARGET}"\n').diagnostics, []);
});

test('an ordinary http base URL is untouched', () => {
  assert.deepEqual(parseConfigSource('env local default\n  api "https://example.test"\n').diagnostics, []);
});

test('the reserved-scheme rule reaches a named service too', () => {
  assert.deepEqual(
    parseConfigSource('env local default\n  api "https://example.test"\n  api billing "tflw://demoo"\n').diagnostics.map((d) => d.code),
    [Codes.INVALID_SETTING_VALUE],
  );
});

test('a misplaced `api` gets both complaints — the placement AND the value', () => {
  // Measured, and it corrected the test that was written first. `api` is `ENV_ONLY`, so it cannot
  // appear in `defaults` at all and `TF025` says so — but the value is *also* wrong, and both are
  // reported rather than the second waiting behind the first. The pass is wired into both loops for
  // that reason and not because `defaults` can hold an `api` today: a rule scoped to the block it
  // happens to be legal in now is a rule that silently stops covering it later.
  assert.deepEqual(
    parseConfigSource('defaults\n  api "tflw://dmeo"\n\nenv local default\n  api "https://example.test"\n').diagnostics.map(
      (d) => d.code,
    ),
    [Codes.CONFIG_KEY_CONTEXT, Codes.INVALID_SETTING_VALUE],
  );
});

test('the message names the typo and the hint names the only legal address', () => {
  const [d] = parseConfigSource('env local default\n  api "tflw://dmeo"\n').diagnostics;
  assert.match(d!.message, /`tflw:\/\/dmeo` is not an address this setting can take/);
  assert.match(d!.hint!, /`tflw:\/\/demo` is the only address under it/);
});

test('the span covers the string literal, not the whole `api` line', () => {
  // `M147e` is about producer-side spans; this one is already right and is pinned so it stays that
  // way — the caret belongs on the value that is wrong, not on the directive that is fine.
  const source = 'env local default\n  api "tflw://dmeo"\n';
  const [d] = parseConfigSource(source).diagnostics;
  assert.equal(source.slice(d!.span.start.offset, d!.span.end.offset), '"tflw://dmeo"');
});

test('`DEMO_BASE_URL` is not refused by the rule that reads it — the constant and the check agree', () => {
  // A one-line guard against the failure this move is meant to prevent: the constant now lives in
  // `@tflw/lang` and `demo-service.ts` re-exports it, so a future edit to either can no longer make
  // the scaffolded config fail its own checker without something going red here.
  assert.deepEqual(parseConfigSource(`env local default\n  api "${DEMO_BASE_URL}"\n`).diagnostics, []);
});
