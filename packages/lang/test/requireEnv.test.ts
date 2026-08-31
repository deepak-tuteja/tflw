// `M156a`/`M156b` — `TF077` and `TF078`, the check-time half of `require env`'s promise
// (`D774`-`D778`).
//
// `spec-data.ts` said a missing secret *"fails at check time rather than mid-suite"*, and the gate
// that makes it true only ever saw the names the author remembered to declare. An `env(NAME)` no
// `require env` line covered was invisible to it and died at whichever step reached it first, with
// `require env` present and correct. `TF077` is the converse rule; the two compose into the
// sentence, and neither gives it alone.
//
// `TF078` is folded in beside it because `TF077` alone would have shipped and still missed the
// commonest spelling of the mistake: a braced `{env(NAME)}` is not a reference, it is text.
//
// Every test states its negative control (`M92d`). Here the controls carry most of the weight —
// three of the ways this could be wrong are false positives, and one of them (`D776`'s
// declared-but-unread names) is a doctrine the sibling's `C95` plant pins in the other direction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkProgram, checkConfigDeclaredEnvRefs, checkConfigBracedEnvRefs, Codes } from '../src/index.js';

const check = (source: string, requiredEnv?: readonly string[]) =>
  checkProgram(parseSource(source).program, requiredEnv === undefined ? {} : { requiredEnv });

const codes = (source: string, requiredEnv?: readonly string[]) => check(source, requiredEnv).map((d) => d.code);

const READS_A_SECRET = 'test "t"\n  api GET /health\n  expect body.status equals env(P_ROGUE)\n';

// ---------------------------------------------------------------------------
// `TF077` — every reference must be declared
// ---------------------------------------------------------------------------

test('an `env()` no `require env` line declares is `TF077`, an error, at the reference', () => {
  const diags = check(READS_A_SECRET, []);
  assert.deepEqual(diags.map((d) => d.code), [Codes.UNDECLARED_ENV_REF]);
  assert.equal(diags[0].severity, 'error');
  assert.match(diags[0].message, /`P_ROGUE` is read here but no `require env` line declares it/);
  // The reference's own line, which is the one to look at — not the file, not the config.
  assert.equal(diags[0].span.start.line, 3);
});

test('a declared reference is silent — the positive control for every negative below', () => {
  assert.deepEqual(codes(READS_A_SECRET, ['P_ROGUE']), []);
});

test('`undefined` skips the pass entirely, and that is the LSP and the docs-site editor demo', () => {
  // The false positive that matters most: a caller who resolved no config has not said this suite
  // declares nothing, and squiggling every `env(` in an open buffer would be the editor disagreeing
  // with a `tflw check` that reports the file clean.
  assert.deepEqual(codes(READS_A_SECRET), []);
  // `[]` is emphatically *not* the same answer — it is a config that was read and declares nothing,
  // which is the shape the rule exists for.
  assert.deepEqual(codes(READS_A_SECRET, []), [Codes.UNDECLARED_ENV_REF]);
});

test('a declared name nothing reads stays silent, permanently (`D776`)', () => {
  // The doctrine `C95` pins in the sibling, asserted here rather than assumed: `require env` is a
  // precondition on the environment, not a check on use sites. A secret that only has to exist for
  // the redactor to pre-register it is an ordinary shape, and there is no "unused declaration" lint.
  assert.deepEqual(codes('test "t"\n  api GET /health\n', ['P_UNUSED']), []);
  assert.deepEqual(codes(READS_A_SECRET, ['P_ROGUE', 'P_UNUSED']), []);
});

test('a near-miss against a declared name is offered as the repair', () => {
  const [diag] = check('test "t"\n  api GET /x\n  expect body.k equals env(API_KEYY)\n', ['API_KEY']);
  assert.match(diag.hint ?? '', /did you mean `API_KEY`\?/);
});

test('with no `require env` line at all the hint says so, and names the line to add', () => {
  const [diag] = check(READS_A_SECRET, []);
  assert.match(diag.hint ?? '', /this config has no `require env` line/);
  assert.match(diag.hint ?? '', /require env P_ROGUE/);
});

test('with declarations present the hint lists them, and says what the run does without one', () => {
  const [diag] = check(READS_A_SECRET, ['A_TOKEN', 'B_TOKEN']);
  assert.match(diag.hint ?? '', /today declares: A_TOKEN, B_TOKEN/);
  assert.match(diag.hint ?? '', /dies at this step, mid-suite/);
});

test('the walk is structural, so a reference in a position no switch enumerates is still found', () => {
  // `eachNodeOfType`'s whole argument. A data-table cell and a request body are two positions a
  // hand-written switch over the step grammar forgets, and silence in a position reads as approval.
  const inBody = 'test "t"\n  api POST /login body { email: env(A_EMAIL), password: env(A_PW) }\n';
  assert.deepEqual(codes(inBody, []), [Codes.UNDECLARED_ENV_REF, Codes.UNDECLARED_ENV_REF]);
  const inForm = 'test "t"\n  open "/login"\n  fill form\n    | "Email"    | env(A_EMAIL) |\n    | "Password" | env(A_PW)    |\n';
  assert.equal(codes(inForm, []).filter((c) => c === Codes.UNDECLARED_ENV_REF).length, 2);
});

test('two undeclared uses of one name are two diagnostics, not one', () => {
  // Deduping by name would cost a reader a location and save them nothing: the repair is the same
  // edit for both, and both are places the run dies.
  const twice = 'test "t"\n  api GET /a\n  expect body.k equals env(P)\n\ntest "u"\n  api GET /b\n  expect body.k equals env(P)\n';
  assert.deepEqual(codes(twice, []), [Codes.UNDECLARED_ENV_REF, Codes.UNDECLARED_ENV_REF]);
});

test('the config dialect is checked too — the position the rule was built from', () => {
  // A `session` body and an `oauth` block are the two commonest `env()` positions anywhere, and a
  // rule that only saw test files would miss the case that filed the row.
  const cfg = 'env local default\n  api "http://localhost:4001"\n\nsession admin\n  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }\n  capture body.token as token\n';
  const parsed = parseConfigSource(cfg);
  assert.deepEqual(parsed.diagnostics.map((d) => d.code), [], 'fixture is otherwise clean');
  const diags = checkConfigDeclaredEnvRefs(parsed.config, []);
  assert.deepEqual(diags.map((d) => d.code), [Codes.UNDECLARED_ENV_REF, Codes.UNDECLARED_ENV_REF]);
  assert.deepEqual(checkConfigDeclaredEnvRefs(parsed.config, ['ADMIN_EMAIL', 'ADMIN_PW']).map((d) => d.code), []);
});

// ---------------------------------------------------------------------------
// `TF078` — a braced `env()` is text
// ---------------------------------------------------------------------------

test('`"{env(NAME)}"` in a string is `TF078`, a warning, and names the variable', () => {
  const parsed = parseConfigSource('defaults\n  header "X-Token" is "{env(P_TOKEN)}"\n');
  const [diag, ...rest] = checkConfigBracedEnvRefs(parsed.config);
  assert.deepEqual(rest, []);
  assert.equal(diag.code, Codes.BRACED_ENV_REF);
  assert.equal(diag.severity, 'warning');
  assert.match(diag.message, /`\{env\(P_TOKEN\)\}` inside a string is literal text, not a secret/);
  assert.match(diag.hint ?? '', /Write `env\(P_TOKEN\)` on its own/);
});

test('`TF077` cannot see it, which is the whole reason `TF078` exists', () => {
  // The braced form is not a reference — the parser leaves it as text, so the declared-names rule
  // walks straight past it. A rule that missed the commonest spelling of the mistake it exists to
  // catch would be `D722` wearing a diagnostic code.
  const parsed = parseConfigSource('defaults\n  header "X-Token" is "{env(P_TOKEN)}"\n');
  assert.deepEqual(checkConfigDeclaredEnvRefs(parsed.config, []).map((d) => d.code), []);
});

test('a real `{variable}` interpolation is untouched — the false positive that would matter', () => {
  assert.deepEqual(codes('test "t"\n  let name = "bob"\n  api GET /u\n  expect body.n equals "hi {name}"\n'), []);
  const parsed = parseConfigSource('env ci default\n  api "https://{API_HOST}/v1"\n');
  assert.deepEqual(checkConfigBracedEnvRefs(parsed.config).map((d) => d.code), []);
});

test('the word `env` in ordinary prose is not the shape, and is not reported', () => {
  const parsed = parseConfigSource('defaults\n  header "X-Note" is "set env before running"\n');
  assert.deepEqual(checkConfigBracedEnvRefs(parsed.config).map((d) => d.code), []);
});

test('a bare unbraced `env(NAME)` in a string is also just text, and is deliberately not reported', () => {
  // The narrowness is the decision (`D778`): only the spelling that *looks* like this language's
  // interpolation is diagnosed. `"env(TOKEN)"` looks like text because it is text, and a checker
  // that refused every mention would be guessing at intent.
  const parsed = parseConfigSource('defaults\n  header "X-Note" is "env(TOKEN)"\n');
  assert.deepEqual(checkConfigBracedEnvRefs(parsed.config).map((d) => d.code), []);
});

test('whitespace inside the braces is the same mistake and is caught', () => {
  const parsed = parseConfigSource('defaults\n  header "X-Token" is "{ env( P_TOKEN ) }"\n');
  assert.deepEqual(checkConfigBracedEnvRefs(parsed.config).map((d) => d.code), [Codes.BRACED_ENV_REF]);
});

test('two braced references in one literal are two warnings', () => {
  // `lastIndex` on a module-level `/g` regex is the bug this asserts against: a second call reusing
  // a leftover index reports the first occurrence of one string and skips it in the next.
  const parsed = parseConfigSource('defaults\n  header "X" is "{env(A)}-{env(B)}"\n  header "Y" is "{env(A)}"\n');
  assert.deepEqual(checkConfigBracedEnvRefs(parsed.config).map((d) => d.code), [
    Codes.BRACED_ENV_REF,
    Codes.BRACED_ENV_REF,
    Codes.BRACED_ENV_REF,
  ]);
});

test('`TF078` needs no config, so it fires in a test file with nothing resolved', () => {
  // Unlike `TF077` it is wired unconditionally: the fact is entirely in the bytes of the source,
  // which is also what makes it an observation rather than a prediction.
  assert.deepEqual(codes('test "t"\n  api GET /x\n  expect body.k equals "{env(TOKEN)}"\n'), [Codes.BRACED_ENV_REF]);
});
