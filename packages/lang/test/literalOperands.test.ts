// M124 (`PLAN_M124_LITERAL_DECIDABILITY.md`, D232-D239) — `TF054`/`TF055`/`TF056`: an operand
// written in the file that the runtime inspects and refuses.
//
// **The negative half is the half that matters here, and more so than in `baseUrls.test.ts`.**
// `TF051` could be wrong about a whole suite; these rules can be wrong about something worse — a
// *correct* program. Every one of them is `'static-if-literal'`, which means the sound answer for a
// non-literal operand is silence, and the tempting wrong answer is to evaluate what you can see:
// `random number {lo} to {hi}` has bounds nobody knows, `hex decode("{token}")` has an input nobody
// has read, and reporting on either is D137 clause 1 violated by a checker being clever. So every
// positive test below is paired with the interpolated form of the same program, asserted silent.
//
// The blunt control for the whole file: make `literalText` return `value.value` unconditionally and
// the interpolation tests fail; drop the `NumberLit` guards and the `{lo}`/`{hi}` tests fail.
//
// `M92d`'s rule throughout — a negative control that cannot fail is a passing test of nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkProgram, checkLiteralOperands, checkHoldWindows, Codes, type EnvTimeouts } from '../src/index.js';

const WAIT_30S: EnvTimeouts = { envName: 'local', wait: 30_000 };

/** A step body, checked by the `TF054` pass alone. Parse errors fail loudly rather than silently
 *  producing an empty program that every assertion below would pass against. */
const codes = (body: string): string[] => {
  const source = `test "t"\n${body}`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkLiteralOperands(program).map((d) => d.code);
};

const messages = (body: string): string[] => {
  const { program, diagnostics } = parseSource(`test "t"\n${body}`);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${body}`);
  return checkLiteralOperands(program).map((d) => `${d.message} | ${d.hint ?? ''}`);
};

const holdCodes = (body: string, env: EnvTimeouts | undefined): string[] => {
  const source = `test "t"\n${body}`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkHoldWindows(program, env ? { envTimeouts: env } : {}).map((d) => d.code);
};

/** A whole file, through the composed pass list — what `tflw check` actually runs. */
const fileCodes = (source: string): string[] => {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkProgram(program).map((d) => d.code);
};

// ---------------------------------------------------------------------------
// `TF054`, sites 1-2: `random number` / `random decimal` — `M97a-02`.
// ---------------------------------------------------------------------------

test('`random number` with the bounds the wrong way round is `TF054`', () => {
  // Control: the same program with the bounds swapped is silent (asserted immediately below).
  assert.deepEqual(codes('  let bad = random number 5 to 1\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let ok = random number 1 to 5\n'), []);
});

test('`random decimal` shares the rule and the code', () => {
  assert.deepEqual(codes('  let bad = random decimal 9 to 2\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let ok = random decimal 2 to 9\n'), []);
});

test('equal bounds are legal — the runtime\'s test is `to < from`, not `to <= from`', () => {
  // A one-element range is a real thing to write (`random number 1 to 1` in a table row that is
  // parameterised elsewhere). Reporting it would be this milestone inventing a rule rather than
  // predicting one, which is the `A4-05` shape.
  assert.deepEqual(codes('  let ok = random number 3 to 3\n'), []);
});

test('negative bounds are read, and this grammar has no unary minus', () => {
  // The clause that a `NumberLit`-only rule silently skips: the parser desugars `-5` to the
  // `BinaryExpr` `0 - 5`, so *every* negative bound looks non-literal unless the rule folds it.
  // Found by this test failing, not by reading the parser.
  // Control: the first assertion is what a rule that folded `-` in the wrong direction gets wrong.
  assert.deepEqual(codes('  let ok = random number -5 to -1\n'), []);
  assert.deepEqual(codes('  let bad = random number -1 to -5\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let bad = random number 1 to -5\n'), [Codes.INVALID_LITERAL_OPERAND]);
});

test('the folded message prints what the author wrote, not the desugaring', () => {
  // `0 - 5` is the parser's business. Quoting it back would teach a reader that they wrote
  // something they did not.
  const [msg] = messages('  let bad = random number -1 to -5\n');
  assert.match(msg!, /random number -1 to -5/);
  assert.doesNotMatch(msg!, /0 - /);
});

test('the fold is exactly the desugaring, not general constant folding', () => {
  // An operand with an unbound name in it stays unknowable however simple the arithmetic looks —
  // the moment this starts evaluating `{lo} - 5`, D237 is gone and so is soundness.
  assert.deepEqual(codes('  let lo = 5\n  let bad = random number {lo} to -5\n'), []);
});

test('an interpolated bound is skipped entirely (D237)', () => {
  // The heart of `'static-if-literal'`. Neither of these is knowable, and both are ordinary things
  // to write — a range read out of a data table is the normal shape, not an exotic one.
  assert.deepEqual(codes('  let hi = 1\n  let bad = random number 5 to {hi}\n'), []);
  assert.deepEqual(codes('  let lo = 5\n  let bad = random number {lo} to 1\n'), []);
  assert.deepEqual(codes('  let lo = 5\n  let hi = 1\n  let bad = random number {lo} to {hi}\n'), []);
});

// ---------------------------------------------------------------------------
// `TF054`, site 3: `random password` — `M97a-02`.
// ---------------------------------------------------------------------------

test('`random password` below length 4 is `TF054`', () => {
  assert.deepEqual(codes('  let bad = random password 2\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let ok = random password 4\n'), []);
  assert.deepEqual(codes('  let ok = random password 16\n'), []);
});

test('`random password` with no length at all is silent', () => {
  // Nothing was written, so there is no literal to be wrong — the default is 12 and the AST field
  // is absent. Control: this is the branch a `node.length!.value < 4` would crash on.
  assert.deepEqual(codes('  let ok = random password\n'), []);
});

test('the hint explains *why* four, not just that it must be four', () => {
  // The number is arbitrary-looking until you know the generator guarantees four character classes.
  // A diagnostic that only restates the bound teaches nothing (`teaching.test.ts`'s standing rule).
  const [msg] = messages('  let bad = random password 3\n');
  assert.match(msg!, /at least 4/);
  assert.match(msg!, /uppercase letter, a lowercase letter, a digit and a symbol/);
});

// ---------------------------------------------------------------------------
// `TF054`, sites 4-6: `hex` / `base64` / `url` `decode` — `M97a-03`.
// ---------------------------------------------------------------------------

test('`hex decode` of a non-hex literal is `TF054`', () => {
  assert.deepEqual(codes('  let x = hex decode("not-hex!")\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let x = hex decode("deadbeef")\n'), []);
});

test('an odd number of hex digits is the clause nobody remembers, and it is checked', () => {
  // `Buffer.from("abc", "hex")` does not throw — it silently decodes one byte and drops the rest,
  // which is exactly why the runtime tests the length itself and why the checker must too.
  // Control: `"abcd"` is the same characters at an even length and is silent.
  assert.deepEqual(codes('  let x = hex decode("abc")\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let x = hex decode("abcd")\n'), []);
});

test('`base64 decode` rejects the URL-safe alphabet, matching the runtime exactly', () => {
  // The most likely way for a re-derived checker copy to be *wrong on a correct program* is the
  // opposite of this: accepting `-`/`_` because `Buffer.from` does. `applyTransform` rejects them,
  // so the checker must, and this asserts the agreement rather than assuming it.
  assert.deepEqual(codes('  let x = base64 decode("ab-_")\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let x = base64 decode("aGk=")\n'), []);
});

test('`base64 decode` of a non-base64 literal is `TF054`', () => {
  assert.deepEqual(codes('  let x = base64 decode("not valid base64!!")\n'), [Codes.INVALID_LITERAL_OPERAND]);
});

test('`url decode` of a malformed escape is `TF054` — the third site `M97a-03` does not name', () => {
  // The row accounts for two sites (`hex`, `base64`); `applyTransform` refuses three. Found by
  // probing rather than by reading the row, which is why the probe exists.
  assert.deepEqual(codes('  let x = url decode("%")\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let x = url decode("%zz")\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  let x = url decode("a%20b")\n'), []);
});

test('`encode` is never inspected in any of the three', () => {
  // Encoding cannot fail — every string has an encoding. A rule that fired here would reject
  // `hex encode("not-hex!")`, which is a perfectly ordinary line.
  assert.deepEqual(codes('  let x = hex encode("not-hex!")\n'), []);
  assert.deepEqual(codes('  let x = base64 encode("not valid base64!!")\n'), []);
  assert.deepEqual(codes('  let x = url encode("%")\n'), []);
});

test('an interpolated decode input is skipped (D237)', () => {
  // `hex decode("{token}")` reads as invalid hex if you look at the source text — the braces are
  // not hex digits. That is the trap `literalText` exists to avoid: the *value* is unknown, and
  // reporting on the unexpanded text would flag a program that decodes fine at run time.
  assert.deepEqual(codes('  let token = "deadbeef"\n  let x = hex decode("{token}")\n'), []);
  assert.deepEqual(codes('  let token = "aGk="\n  let x = base64 decode("pre{token}")\n'), []);
});

// ---------------------------------------------------------------------------
// `TF054`, site 7: a regex operand that will not compile — `M97a-16`.
// ---------------------------------------------------------------------------

test('`matches` with an uncompilable literal pattern is `TF054`', () => {
  assert.deepEqual(codes('  api GET /a\n  expect body.name matches "("\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  api GET /a\n  expect body.name matches "^ok$"\n'), []);
});

test('`expect request fails matching "…"` is the second site — and it is *this* spelling', () => {
  // `M97a-16` reads as `expect request to "/x" fails matching "…"`, which `TF042` refuses first
  // (`fails` is not a matcher for a `request to "…"` subject), so that form would have "confirmed"
  // a site the checker never sees. Measured, not assumed — the `M97a-09` trap in miniature.
  assert.deepEqual(codes('  api GET /a\n  expect request fails matching "("\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(codes('  api GET /a\n  expect request fails matching "ECONNREFUSED"\n'), []);
});

test('the hint carries the engine\'s own reason', () => {
  // "invalid regex" alone leaves the reader counting brackets. `new RegExp` already knows which
  // construct is unterminated, and that sentence is free.
  const [msg] = messages('  api GET /a\n  expect body.name matches "("\n');
  assert.match(msg!, /invalid regex in matcher/);
  assert.match(msg!, /group|parenthes/i);
});

test('an interpolated pattern is skipped (D237)', () => {
  // A pattern assembled from a capture is unknowable, and `"{prefix}("` is a *valid* regex once
  // `prefix` expands to `\\`.
  assert.deepEqual(codes('  let p = "^ok"\n  api GET /a\n  expect body.name matches "{p}"\n'), []);
  assert.deepEqual(codes('  let p = "^ok"\n  api GET /a\n  expect body.name matches "{p}("\n'), []);
});

test('a matcher with no operand at all does not reach the rule', () => {
  // `expect request fails` (no `matching`) leaves `matcher.value` undefined — the branch a
  // `String(matcher.value)` would turn into the pattern `"undefined"`.
  assert.deepEqual(codes('  api GET /a\n  expect request fails\n'), []);
});

// ---------------------------------------------------------------------------
// `TF054` — reach: the pass walks the object graph, not a list of statement kinds.
// ---------------------------------------------------------------------------

test('a bad operand inside an `action` body is found', () => {
  const source = 'action seed()\n  let bad = random number 5 to 1\n\ntest "t"\n  seed()\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  assert.deepEqual(checkLiteralOperands(program).map((d) => d.code), [Codes.INVALID_LITERAL_OPERAND]);
});

test('a bad operand inside a hook body is found', () => {
  const source = 'before file\n  let bad = random password 1\n\ntest "t"\n  api GET /a\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  assert.deepEqual(checkLiteralOperands(program).map((d) => d.code), [Codes.INVALID_LITERAL_OPERAND]);
});

test('a bad operand in an inline `with each` cell is found', () => {
  // The reach test that a step-walker fails: a table cell is a `Value` hanging off the *test*, not
  // off any step, and it is evaluated once per row — so one bad literal is N failures at run time.
  const source = 'with each\n  | n |\n  | random number 5 to 1 |\ntest "t {n}"\n  api GET /a\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  assert.deepEqual(checkLiteralOperands(program).map((d) => d.code), [Codes.INVALID_LITERAL_OPERAND]);
});

test('a bad operand nested in a request body is found', () => {
  // A generator inside an object literal inside an api step — three levels below any statement the
  // pass names, and the reason the walk dispatches on `type` over every object instead.
  assert.deepEqual(codes('  api POST /orders body { qty: random number 9 to 2 }\n'), [Codes.INVALID_LITERAL_OPERAND]);
});

test('two bad operands report twice, in source order', () => {
  const got = codes('  let a = random number 5 to 1\n  let b = hex decode("zz")\n');
  assert.deepEqual(got, [Codes.INVALID_LITERAL_OPERAND, Codes.INVALID_LITERAL_OPERAND]);
});

// ---------------------------------------------------------------------------
// `TF055` — the hold window vs `timeout wait` (`M97a-06`).
// ---------------------------------------------------------------------------

test('a hold window longer than `timeout wait` is `TF055`', () => {
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "Hidden" is hidden for 60s\n', WAIT_30S), [Codes.HOLD_EXCEEDS_WAIT_TIMEOUT]);
});

test('a hold window shorter than `timeout wait` is silent', () => {
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "Hidden" is hidden for 5s\n', WAIT_30S), []);
});

test('a hold window exactly equal to `timeout wait` is reported — the runtime\'s test is `>=`', () => {
  // The off-by-one that reads as pedantry and is not: a window as long as the budget still cannot
  // close, because the condition would have to survive past the deadline that ends the step.
  // Control: 29_999ms is silent.
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "H" is hidden for 30s\n', WAIT_30S), [Codes.HOLD_EXCEEDS_WAIT_TIMEOUT]);
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "H" is hidden for 29999ms\n', WAIT_30S), []);
});

test('`wait until` with no `for` clause is silent', () => {
  // `holdMs` is `null`, and `null >= 30000` is `false` in JS but `typeof null === 'object'` — the
  // guard is a `typeof` test rather than a truthiness one, and this is what proves it.
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "H" is hidden\n', WAIT_30S), []);
});

test('`TF055` is a **warning**, never an error (D147)', () => {
  // The tier is the decision this rule turns on: the second operand comes from config, so the
  // checker is predicting, and a prediction must not make a valid suite unrunnable. A suite whose
  // CI env raises `timeout wait` to 120s is correct and must still run.
  const { program } = parseSource('test "t"\n  open "/x"\n  wait until button "H" is hidden for 60s\n');
  const diags = checkHoldWindows(program, { envTimeouts: WAIT_30S });
  assert.deepEqual(diags.map((d) => d.severity), ['warning']);
});

test('with no resolved env the pass is skipped entirely, not defaulted', () => {
  // The `undefined`-vs-present doctrine, and the most dangerous field to get wrong in this file: a
  // fallback of `{ wait: 0 }` makes *every* `for` clause in the language too long, and a fallback
  // of the documented 30s default is right often enough that nobody would suspect it in the
  // workspace where it is wrong.
  // Control: the identical program under `WAIT_30S` reports (asserted above and again here).
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "H" is hidden for 60s\n', undefined), []);
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "H" is hidden for 60s\n', WAIT_30S), [Codes.HOLD_EXCEEDS_WAIT_TIMEOUT]);
});

test('a raised `timeout wait` makes the same program clean', () => {
  // The env-dependence stated as a test rather than as prose: one program, two envs, two answers.
  assert.deepEqual(holdCodes('  open "/x"\n  wait until button "H" is hidden for 60s\n', { envName: 'ci', wait: 120_000 }), []);
});

// ---------------------------------------------------------------------------
// `TF056` — a data table the loader will refuse (`M97a-01`).
// ---------------------------------------------------------------------------

test('`with each from` a `.txt` path is `TF056`', () => {
  assert.deepEqual(fileCodes('with each from "./rows.txt"\ntest "t"\n  api GET /a\n'), [Codes.DATA_TABLE_EXTENSION]);
});

test('`.csv` and `.json` are silent, upper case included', () => {
  // The runtime lowercases before comparing (`extname(...).toLowerCase()`), so `ROWS.CSV` loads —
  // and a checker that compared case-sensitively would reject a file that runs.
  assert.deepEqual(fileCodes('with each from "./rows.csv"\ntest "t"\n  api GET /a\n'), []);
  assert.deepEqual(fileCodes('with each from "./rows.json"\ntest "t"\n  api GET /a\n'), []);
  assert.deepEqual(fileCodes('with each from "./ROWS.CSV"\ntest "t"\n  api GET /a\n'), []);
});

test('a path with no extension at all is `TF056`, and says so', () => {
  const { program } = parseSource('with each from "./rows"\ntest "t"\n  api GET /a\n');
  const [diag] = checkProgram(program);
  assert.equal(diag?.code, Codes.DATA_TABLE_EXTENSION);
  assert.match(diag!.message, /no extension/);
});

test('a dotfile has no extension — `.csv` as a whole basename is not a `.csv` file', () => {
  // `extname("./.csv")` is `""`, not `".csv"`, and the runtime uses `extname`. A `lastIndexOf('.')`
  // written without the dotfile clause accepts this and disagrees with the loader.
  assert.deepEqual(fileCodes('with each from "./.csv"\ntest "t"\n  api GET /a\n'), [Codes.DATA_TABLE_EXTENSION]);
});

test('the dot must follow the last separator', () => {
  // `dir.v2/rows` has a dot, and it is not an extension. Control: `dir.v2/rows.csv` is silent.
  assert.deepEqual(fileCodes('with each from "./dir.v2/rows"\ntest "t"\n  api GET /a\n'), [Codes.DATA_TABLE_EXTENSION]);
  assert.deepEqual(fileCodes('with each from "./dir.v2/rows.csv"\ntest "t"\n  api GET /a\n'), []);
});

test('an interpolated table path is skipped (D237)', () => {
  // The extension of a name nobody has resolved is not a fact.
  assert.deepEqual(fileCodes('with each from "{dir}/rows.csv"\ntest "t"\n  api GET /a\n'), []);
  assert.deepEqual(fileCodes('with each from "./rows{suffix}"\ntest "t"\n  api GET /a\n'), []);
});

test('an inline `with each` reaches no part of the rule', () => {
  // Two forms share one AST field; only one has a path. Control: this is the branch a
  // `table.path.value` written without the type test would crash on.
  assert.deepEqual(fileCodes('with each\n  | n |\n  | 1 |\ntest "t {n}"\n  api GET /a\n'), []);
});

test('`TF056` is an error, unlike `TF043` on the same line', () => {
  // Same neighbourhood, opposite tier, and the contrast is D147: a missing file may be created by
  // an earlier step, so `TF043` predicts and warns; an extension cannot change between check and
  // run, so this observes and errors.
  const { program } = parseSource('with each from "./rows.txt"\ntest "t"\n  api GET /a\n');
  assert.deepEqual(checkProgram(program).map((d) => d.severity), ['error']);
});

// ---------------------------------------------------------------------------
// Composition — the rules are wired into `checkProgram`, which is what `tflw check` calls.
// ---------------------------------------------------------------------------

test('all three reach `checkProgram`', () => {
  // A pass can be perfect and unwired; `M60` exists because three consumers had drifted apart on
  // exactly that. `TF055` needs its option, so it is asserted through the option-carrying path.
  assert.deepEqual(fileCodes('test "t"\n  let bad = random number 5 to 1\n'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(fileCodes('with each from "./rows.txt"\ntest "t"\n  api GET /a\n'), [Codes.DATA_TABLE_EXTENSION]);

  const { program } = parseSource('test "t"\n  open "/x"\n  wait until button "H" is hidden for 60s\n');
  assert.ok(checkProgram(program, { envTimeouts: WAIT_30S }).some((d) => d.code === Codes.HOLD_EXCEEDS_WAIT_TIMEOUT));
  assert.ok(!checkProgram(program).some((d) => d.code === Codes.HOLD_EXCEEDS_WAIT_TIMEOUT));
});

test('a clean program stays clean through the whole composed list', () => {
  // The file-wide false-positive control. Every construct these rules inspect, written correctly.
  const source = [
    'test "t"',
    '  let n = random number 1 to 5',
    '  let d = random decimal 1 to 5',
    '  let p = random password 12',
    '  let q = random password',
    '  let h = hex decode("deadbeef")',
    '  let b = base64 decode("aGk=")',
    '  let u = url decode("a%20b")',
    '  api GET /a',
    '  expect body.name matches "^ok$"',
    '  api GET /b',
    // A separate request on purpose: `TF031` forbids pairing a connection-level assertion with a
    // response one on the same call, and this fixture is here to prove the M124 rules stay silent,
    // not to smuggle in an unrelated error.
    '  expect request fails matching "ECONNREFUSED"',
    '',
  ].join('\n');
  assert.deepEqual(fileCodes(source), []);
});
