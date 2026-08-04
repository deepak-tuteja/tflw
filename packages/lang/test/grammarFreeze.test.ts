// Milestone B1, the grammar freeze (PLAN_MILESTONE_B.md, decisions FS-04 … FS-08 in
// PLAN_FREEZE_SURFACE.md). The three *additive* parser changes live here together because they are
// one freeze decision landed as one vertical, and because each one's regression is a property about
// the grammar as a whole rather than about a single statement:
//
//   FS-06  a leading keyword never reserves that word for user action names
//   FS-07  one value parser for every matcher
//   FS-08  `is` is an optional copula
//
// FS-04 (`tick`/`untick`) and FS-05 (`pause`) are renames of specific statements and their tests
// live with those statements, in browser-steps.test.ts and load.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';

/** Parse a single step inside a minimal API test and return its diagnostics. */
function stepDiagnostics(step: string) {
  const { diagnostics } = parseSource(`test "t"\n  api GET /x\n  ${step}\n`);
  return diagnostics.filter((d) => d.severity !== 'warning');
}

function assertParses(step: string) {
  const errs = stepDiagnostics(step);
  assert.deepEqual(errs, [], `expected \`${step}\` to parse, got ${JSON.stringify(errs.map((d) => `${d.code}: ${d.message}`))}`);
}

/** The single matcher of the single step of a single-test program. */
function matcherOf(step: string) {
  const { program, diagnostics } = parseSource(`test "t"\n  api GET /x\n  ${step}\n`);
  assert.deepEqual(diagnostics, [], `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  const stmt = program.tests[0]!.body.at(-1)! as { matcher?: { name: string; negated: boolean; value?: unknown } };
  assert.ok(stmt.matcher, 'expected the last step to carry a matcher');
  return stmt.matcher;
}

/** Parse a whole program and return its non-warning diagnostics. */
function programDiagnostics(source: string) {
  return parseSource(source).diagnostics.filter((d) => d.severity !== 'warning');
}

function assertProgramParses(label: string, source: string) {
  const errs = programDiagnostics(source);
  assert.deepEqual(errs, [], `expected ${label} to parse, got ${JSON.stringify(errs.map((d) => `${d.code}: ${d.message}`))}`);
}

// -- FS-06 · a leading keyword never reserves that word -----------------------------------------

// A2-02. All five workload keywords were reserved as a step's first word unconditionally, so an
// action whose name started with one could be *declared* and could be *called in value position*,
// but never called as a statement — `run checkout("1")` was "expected an iteration count".
for (const [name, call] of [
  ['run checkout', 'run checkout("1")'],
  ['ramp to', 'ramp to("1")'],
  ['step users', 'step users("1")'],
  ['spike rps', 'spike rps("1")'],
  ['hold on', 'hold on("1")'],
] as const) {
  test(`FS-06: an action named \`${name}\` is callable as a statement`, () => {
    assertProgramParses(`a call to \`${name}\``, `action ${name}(id)\n  api GET /o/{id}\n\ntest "t"\n  ${call}\n`);
  });
}

// The other direction is the one that would break every existing load test if the lookahead were
// too eager — each workload form must still win when what follows is a workload clause.
for (const [label, clause] of [
  ['ramp', 'ramp to 50 users over 30s'],
  ['hold', 'hold 30 users for 20s'],
  ['run … iterations', 'run 500 iterations across 20 users'],
] as const) {
  test(`FS-06: a real \`${label}\` workload still parses as a workload`, () => {
    const source = `test "t"\n  ${clause}\n  api GET /x\n`;
    assertProgramParses(`the \`${label}\` workload`, source);
    assert.ok(parseSource(source).program.tests[0]!.workload, 'expected a workload-bearing test');
  });
}

test('FS-06: a `step users` block workload still parses as a workload', () => {
  const source = 'test "t"\n  step users\n    to 10 for 10s\n  api GET /x\n';
  assertProgramParses('the `step` workload', source);
  assert.ok(parseSource(source).program.tests[0]!.workload);
});

// -- FS-04 · the checkbox action becomes `tick`/`untick` (additive half, B1 step 1) --------------

// A3-07/C10. Step 1 lands `tick`/`untick` alongside the old spellings so testFlow-tests can migrate
// its seven lines before bare `check <locator>` stops parsing in step 3. Both readings of `check`
// therefore still work here — that is the point of the overlap window, and the test that proves the
// window is open is the same test that will be inverted when it closes.
test('FS-04: `tick`/`untick` parse as the checkbox actions', () => {
  for (const [step, type] of [
    ['tick field "Accept terms"', 'TickStmt'],
    ['untick field "Accept terms"', 'UntickStmt'],
  ] as const) {
    const source = `test "t"\n  open "/x"\n  ${step}\n`;
    assertProgramParses(step, source);
    assert.equal((parseSource(source).program.tests[0]!.body.at(-1)! as { type: string }).type, type);
  }
});

test('FS-04: `tick` takes any locator kind, like the action it replaces', () => {
  for (const locator of ['field "Accept"', 'button "Go"', 'css ".box"']) {
    assertProgramParses(`tick ${locator}`, `test "t"\n  open "/x"\n  tick ${locator}\n`);
  }
});

test('FS-04 step 1: the outgoing spellings still parse, and still mean the action', () => {
  const source = 'test "t"\n  open "/x"\n  check field "Accept terms"\n  uncheck field "Accept terms"\n';
  assertProgramParses('the outgoing `check`/`uncheck` spellings', source);
  const body = parseSource(source).program.tests[0]!.body as readonly { type: string }[];
  assert.deepEqual(body.slice(-2).map((s) => s.type), ['TickStmt', 'UntickStmt']);
});

// `check` as the soft assertion is the load-bearing meaning — it runs through the whole API half and
// is what the docs teach first. FS-04 removes the *action* reading, never this one.
test('FS-04: `check <subject> <matcher>` is untouched — it stays the soft assertion', () => {
  const source = 'test "t"\n  api GET /x\n  check status equals 200\n';
  assertProgramParses('the soft assertion', source);
  const stmt = parseSource(source).program.tests[0]!.body.at(-1)! as { type: string; soft?: boolean };
  assert.equal(stmt.type, 'ExpectStmt');
  assert.equal(stmt.soft, true);
});

// -- FS-07 · one value parser for every matcher -------------------------------------------------

/** The parsed value of the last step, however that step carries one. */
function valueOf(step: string, prelude = '') {
  const source = `test "t"\n${prelude}  api GET /x\n  ${step}\n`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  const stmt = program.tests[0]!.body.at(-1)! as { matcher?: { value?: { type: string } }; value?: { type: string } };
  const v = stmt.matcher?.value ?? stmt.value;
  assert.ok(v, 'expected the last step to carry a value');
  return v;
}

// A3-04. `matches subset { id: 1 }` was valid one line above `equals { id: 1 }`, which failed with
// "expected `}` to close the interpolation" — two hand-rolled value parsers disagreeing, published
// as "applies to any value" in three generated surfaces (A3-OS-01).
test('FS-07: `equals` and `contains` take an object literal, like `matches subset` always did', () => {
  assert.equal(valueOf('expect body equals { id: 1 }').type, 'ObjectLit');
  assert.equal(valueOf('expect body.items contains { id: 1 }').type, 'ObjectLit');
  assert.equal(valueOf('expect body matches subset { id: 1 }').type, 'ObjectLit');
});

test('FS-07: matcher values take an array literal — the gap the ledger never recorded', () => {
  assert.equal(valueOf('expect body.tags equals ["a", "b"]').type, 'ArrayLit');
});

test('FS-07: `let` takes object and array literals too, not only matcher position', () => {
  assert.equal(valueOf('let a = { id: 1 }').type, 'ObjectLit');
  assert.equal(valueOf('let a = [1, 2]').type, 'ArrayLit');
  assert.equal(valueOf('let a = {}').type, 'ObjectLit', '`{}` is the empty object, not an empty interpolation');
});

// A3-06. `Matcher.value` was already `Value` and both runtime paths already called `evalValue`, so
// the literal-token `expect('number')` in the parser was the only thing making the one array-length
// matcher in the closed set undrivable from a `with each` table.
test('FS-07: `has count` takes a variable and an interpolation, not just a literal', () => {
  assert.equal(valueOf('expect body.items has count 3').type, 'NumberLit');
  assert.equal(valueOf('expect body.items has count n', '  let n = 3\n').type, 'VarRef');
  assert.equal(valueOf('expect body.items has count {n}', '  let n = 3\n').type, 'Interp');
});

// THE regression for the `{` rule. testFlow-tests has eight live `equals {var}` interpolations, and
// object literals must not capture any of them. `{ IDENT }` is an interpolation forever — which is
// only safe because an object literal always requires `key: value`, so no shorthand-key form exists.
test('FS-07: `{ ident }` stays an interpolation, and keeps climbing into an expression', () => {
  assert.equal(valueOf('expect body.stock equals {stock}', '  let stock = 1\n').type, 'Interp');
  assert.equal(valueOf('let a = {stock}', '  let stock = 1\n').type, 'Interp');
  assert.equal(
    valueOf('expect body.n equals {price} * 2', '  let price = 2\n').type,
    'BinaryExpr',
    'an interpolation-led expression must still reach the arithmetic levels (P#25)',
  );
});

// The checker walks Values generically, so widening the parser must not open a hole where an
// unknown variable in a newly-legal position lints green.
test('FS-07: the checker still resolves variables inside the widened positions', async () => {
  const { checkProgram } = await import('../src/index.js');
  for (const step of ['expect body.items has count {nope}', 'expect body equals { id: {nope} }', 'expect body.tags equals [{nope}]']) {
    const { program } = parseSource(`test "t"\n  api GET /x\n  ${step}\n`);
    const codes = checkProgram(program, {}).map((d) => d.code);
    assert.ok(codes.includes('TF030'), `expected TF030 for \`${step}\`, got ${JSON.stringify(codes)}`);
  }
});

// -- FS-08 · `is` is an optional copula ---------------------------------------------------------

// The decision's whole point: all four spellings parse and mean the same thing. Before FS-08 only
// `not is visible` and `is visible` did — `is not visible` was `TF014: unexpected \`not\` after
// \`is\`` and bare `not visible` was unreachable, which is why SPEC §6.2's own documented example
// did not parse.
for (const spelling of ['is not visible', 'not is visible']) {
  test(`FS-08: \`${spelling}\` parses as a negated \`visible\``, () => {
    const m = matcherOf(`expect text "Error" ${spelling}`);
    assert.equal(m.name, 'visible');
    assert.equal(m.negated, true);
  });
}

for (const spelling of ['is visible', 'visible']) {
  test(`FS-08: \`${spelling}\` parses as a plain \`visible\``, () => {
    const m = matcherOf(`expect text "Error" ${spelling}`);
    assert.equal(m.name, 'visible');
    assert.equal(m.negated, false);
  });
}

test('FS-08: the copula is optional in front of `greater than`/`less than` too', () => {
  assert.equal(matcherOf('expect status is greater than 200').name, 'greaterThan');
  assert.equal(matcherOf('expect status greater than 200').name, 'greaterThan');
  assert.equal(matcherOf('expect status is less than 500').name, 'lessThan');
  assert.equal(matcherOf('expect status less than 500').name, 'lessThan');
});

test('FS-08: the copula is accepted in front of a value matcher, and composes with `not`', () => {
  assert.equal(matcherOf('expect status is equals 200').negated, false);
  assert.equal(matcherOf('expect status is not equals 500').negated, true);
  assert.equal(matcherOf('expect status not equals 500').negated, true);
});

test('FS-08: the copula reaches `check` and `wait until`, not just `expect`', () => {
  assertParses('check text "Error" is not visible');
  assertParses('wait until text "Error" is not visible');
});

// The copula is consumed once, not repeatedly — otherwise `is is is visible` would be legal and the
// grammar would have no shape at all. Same for a doubled `not`, which would silently double-negate.
test('FS-08: a second `is` or a second `not` is an error, not a no-op', () => {
  assert.equal(stepDiagnostics('expect text "x" is is visible')[0]?.code, 'TF014');
  assert.equal(stepDiagnostics('expect text "x" not not visible')[0]?.code, 'TF014');
});

// OBS-04. Before FS-08 the state words were only reachable under an `is` branch with its own
// narrower suggest vocabulary, so a bare `vissible` could not be corrected at all — and the
// top-level fallback line never mentioned `equals`.
test('OBS-04: a state-word typo is suggested with or without the copula', () => {
  for (const step of ['expect text "x" is vissible', 'expect text "x" vissible']) {
    const d = stepDiagnostics(step)[0]!;
    assert.equal(d.code, 'TF014');
    assert.match(d.hint ?? '', /did you mean `visible`\?/);
  }
});

test('OBS-04: the fallback help names value matchers, the comparison forms and the states', () => {
  const d = stepDiagnostics('expect status eq 200')[0]!;
  assert.equal(d.code, 'TF014');
  const help = d.hint ?? '';
  assert.match(help, /equals/, 'the old line omitted `equals` entirely');
  assert.match(help, /greater than/);
  assert.match(help, /visible/);
});
