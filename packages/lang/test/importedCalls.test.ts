// `M147c` (`A4-21`, `M140-03`) — the two things a file learns about its own `import` lines at check
// time, and the reasons each of them nearly went the other way.
//
// **`A4-21`.** `checkCalls` reports an unknown call in a `test` or a hook body and never inside an
// `action` body, and that asymmetry is correct where it was written: calls bind late, against the
// entry file's registry, so a library file's calls are undecidable *while checking the library*.
// `shared/root.tflw` in the dogfood suite is that shape and reporting there would fail every
// library file in every suite. One level up the same call is fully decidable — the importer's
// registry is the registry it will run under — so the fix is a second pass over the imported
// bodies, not a loosened flag. Test 8 below is the guard on that distinction: the day someone
// "simplifies" this into `visit(action, true)`, the library-file case goes red.
//
// **`M140-03`.** `TF073` lives in `checkImportsParse` here and not in the resolver that discovers
// the fact, so `@tflw/lang` keeps building every check-time diagnostic itself. That placement is
// what lets SPEC §17's `TF073` row carry a probe the suite executes — `diagnosticExamples.test.ts`
// runs each probe through `checkProgram` and cannot reach into `@tflw/runtime` at all. The join
// over real files on disk is `packages/runtime/test/imported-file-errors.test.ts`; without it,
// every test here would stay green if the resolver stopped reporting the fact.
//
// **Three implementations were measured before this one**, and each break is recorded on the test
// that catches it: dropping the `closedWorld` guard (test 5), dropping the evaluated-position
// filter (test 7), and dropping the per-(import, name) dedup (test 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkProgram, Codes, type Diagnostic, type KnownAction } from '../src/index.js';

/** The imported actions `resolveImportedActions` would hand over for `source`, built the same way
 *  it builds them — by parsing the file and keeping name, arity and body. Written out rather than
 *  imported because this package does no I/O; the runtime test named above is what holds the two
 *  spellings together. */
const importedFrom = (from: string, source: string): KnownAction[] => {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], 'the imported fixture must parse cleanly');
  return program.actions.map((a) => ({ name: a.name, arity: a.params.length, from, body: a.body }));
};

// The return type is spelled `Diagnostic[]` and not `ReturnType<typeof checkProgram>`, which is
// the same type: `verify-test-observability.mjs` gives up on an arrow helper whose return-type
// annotation runs more than twenty characters between the parameter list and the `=>`, and a
// helper it cannot read is a harness it cannot resolve. With the long spelling the nine tests
// below resolved to `importedFrom`'s stages alone — lex and parse — and every one was reported
// as a vacuous `TF037` assertion, which they are not. Filed as `M147-06`; this is the annotation
// a reader would have written anyway.
const check = (source: string, imported: KnownAction[]): Diagnostic[] => {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], 'the entry fixture must parse cleanly');
  return checkProgram(program, { importedActions: imported });
};

const ORDERS = 'action createOrder(sku)\n  makeId("ord")\n  api GET /orders/{sku}\n  expect status equals 200\n';
const ENTRY = 'import "./lib/orders.tflw"\n\ntest "make an order"\n  createOrder("abc")\n';

test('an imported action calling a transitively-imported name is reported (A4-21)', () => {
  const diags = check(ENTRY, importedFrom('./lib/orders.tflw', ORDERS));
  const unknown = diags.filter((d) => d.code === Codes.UNKNOWN_CALL);
  assert.equal(unknown.length, 1, JSON.stringify(diags, null, 2));
  assert.match(unknown[0]!.message, /imported action "createOrder" calls `makeId\(\.\.\.\)`/);
});

test('the caret sits on the local `import` path literal, never in the imported file', () => {
  const diags = check(ENTRY, importedFrom('./lib/orders.tflw', ORDERS)).filter((d) => d.code === Codes.UNKNOWN_CALL);
  // Line 1, column 8 — `import "` is seven characters, so this is the opening quote of the literal.
  // The call itself is on line 2 of *another* file; underlining that line number against this
  // source would point at `test "make an order"`, which is the `M106` argument in one example.
  assert.equal(diags[0]!.span.start.line, 1);
  assert.equal(diags[0]!.span.start.column, 8);
});

test('the hint names the file and the rule that makes it the reader`s problem', () => {
  const diags = check(ENTRY, importedFrom('./lib/orders.tflw', ORDERS)).filter((d) => d.code === Codes.UNKNOWN_CALL);
  const hint = diags[0]!.hint ?? '';
  assert.match(hint, /brings in a file's `action`s and nothing else/);
  assert.match(hint, /"\.\/lib\/orders\.tflw"/);
});

test('NEGATIVE — an imported action calling a name the importing file declares is silent', () => {
  // The capability the `A4-03` rule exists to protect: calls bind late, so a library action calling
  // a name only its importer defines *runs*. Reporting it would be the checker being stricter than
  // the runtime, which D137 clause 1 forbids outright.
  const entry = 'import "./lib/orders.tflw"\n\naction makeId(prefix)\n  let id = "{prefix}-1"\n\ntest "t"\n  createOrder("abc")\n';
  assert.deepEqual(check(entry, importedFrom('./lib/orders.tflw', ORDERS)).filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

test('NEGATIVE — an imported action calling a sibling in its own file is silent', () => {
  // `buildRegistry` adds *every* action of an imported file, so a call between two of them always
  // resolves. A pass that only looked at the entry file's own actions would fire here.
  const both = 'action makeId(prefix)\n  let id = "{prefix}-1"\n\naction createOrder(sku)\n  makeId("ord")\n  api GET /orders/{sku}\n  expect status equals 200\n';
  assert.deepEqual(check(ENTRY, importedFrom('./lib/orders.tflw', both)).filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

test('NEGATIVE — a `use` in the importing file reopens the world and silences the pass', () => {
  // BREAK MEASURED: with the `closedWorld` guard removed this reports `makeId`, and a JS helper
  // module exporting `makeId` is exactly how a suite legitimately supplies it. The checker cannot
  // enumerate a module's exports without executing it, so silence is the only sound answer.
  const entry = 'import "./lib/orders.tflw"\nuse "./helpers.mjs"\n\ntest "t"\n  createOrder("abc")\n';
  assert.deepEqual(check(entry, importedFrom('./lib/orders.tflw', ORDERS)).filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

test('a name missing five times over is one diagnostic, not five', () => {
  // BREAK MEASURED: without the per-(import, name) dedup this reports five times on one line — the
  // cascade shape `M147c` keeps deleting, and on the *import* line it is worse than usual, because
  // every copy carries the identical caret.
  const five = 'action createOrder(sku)\n  makeId("a")\n  makeId("b")\n  makeId("c")\n  makeId("d")\n  makeId("e")\n  api GET /o\n  expect status equals 200\n';
  const diags = check(ENTRY, importedFrom('./lib/orders.tflw', five)).filter((d) => d.code === Codes.UNKNOWN_CALL);
  assert.equal(diags.length, 1);
});

test('a call in a position that never evaluates is not reported', () => {
  // BREAK MEASURED: without `collectEvaluatedCalls` this fires on `makeId` here, and the call never
  // runs — `let x = f() + "y"` evaluates the concatenation and drops the call, which is `TF040`'s
  // whole subject. Claiming a missing import for a call that cannot fail would be a false positive
  // in the strictest sense: the program runs.
  const dead = 'action createOrder(sku)\n  let x = makeId("a") + "y"\n  api GET /o\n  expect status equals 200\n';
  assert.deepEqual(check(ENTRY, importedFrom('./lib/orders.tflw', dead)).filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

test('the local file`s own action bodies are still exempt (the A4-03 rule survives)', () => {
  // THE GUARD ON THE DISTINCTION. This is `shared/root.tflw`: a library file, checked on its own,
  // whose action calls a name only its importers define. It must stay clean. Fold the new pass into
  // `visit(action, true)` and this goes red — which is the point of writing it as a second pass.
  const library = 'action createOrder(sku)\n  makeId("ord")\n  api GET /o\n  expect status equals 200\n';
  assert.deepEqual(check(library, []).filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

test('a near spelling in the importer`s own registry becomes a "did you mean"', () => {
  const entry = 'import "./lib/orders.tflw"\n\naction makeIds(prefix)\n  let id = "{prefix}-1"\n\ntest "t"\n  createOrder("abc")\n';
  const diags = check(entry, importedFrom('./lib/orders.tflw', ORDERS)).filter((d) => d.code === Codes.UNKNOWN_CALL);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint ?? '', /did you mean `makeIds`\?/);
});

test('an imported action with no body is a node nothing is claimed about', () => {
  // The `undefined`-vs-`[]` doctrine `KnownAction.body` documents, applied here: a caller that hands
  // over a name and an arity has not said the action calls nothing.
  const diags = check(ENTRY, [{ name: 'createOrder', arity: 1, from: './lib/orders.tflw' }]);
  assert.deepEqual(diags.filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

// ---------------------------------------------------------------------------
// `M140-03` — `TF073`.
// ---------------------------------------------------------------------------

const BROKEN_ENTRY = 'import "./broken.tflw"\n\ntest "t"\n  api GET /a\n  expect status equals 200\n';

test('an import naming a file that does not parse is `TF073`, at the path literal', () => {
  const { program } = parseSource(BROKEN_ENTRY);
  const diags = checkProgram(program, { importsWithErrors: new Set(['./broken.tflw']) });
  assert.equal(diags.length, 1, JSON.stringify(diags, null, 2));
  assert.equal(diags[0]!.code, Codes.IMPORT_PARSE_ERRORS);
  assert.equal(diags[0]!.severity, 'error');
  assert.match(diags[0]!.message, /imported file "\.\/broken\.tflw" does not parse/);
  assert.equal(diags[0]!.span.start.line, 1);
  assert.equal(diags[0]!.span.start.column, 8);
});

test('the hint hands over the command that shows the real carets', () => {
  const { program } = parseSource(BROKEN_ENTRY);
  const [diag] = checkProgram(program, { importsWithErrors: new Set(['./broken.tflw']) });
  assert.match(diag!.hint ?? '', /run `tflw check \.\/broken\.tflw`/);
  assert.match(diag!.hint ?? '', /named here rather than underlined/);
});

test('NEGATIVE — no answer from the caller means no diagnostic, not a clean bill', () => {
  // The docs-site editor demo runs in a browser and can never ask this question. `undefined` has to
  // skip the pass; an empty set is the caller saying it looked. Both are silence here, and the
  // difference matters one level up, where the CLI always looks and the demo never does.
  const { program } = parseSource(BROKEN_ENTRY);
  assert.deepEqual(checkProgram(program, {}).filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS), []);
  assert.deepEqual(checkProgram(program, { importsWithErrors: new Set() }).filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS), []);
});

test('NEGATIVE — an import that is not in the set is not accused', () => {
  const two = 'import "./broken.tflw"\nimport "./fine.tflw"\n\ntest "t"\n  api GET /a\n  expect status equals 200\n';
  const { program } = parseSource(two);
  const diags = checkProgram(program, { importsWithErrors: new Set(['./broken.tflw']) }).filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /broken\.tflw/);
});

test('two broken imports are two diagnostics, on their own lines', () => {
  // The resolver used to return on the first failure, so a file with two broken imports told you
  // about them one run at a time.
  const two = 'import "./a.tflw"\nimport "./b.tflw"\n\ntest "t"\n  api GET /a\n  expect status equals 200\n';
  const { program } = parseSource(two);
  const diags = checkProgram(program, { importsWithErrors: new Set(['./a.tflw', './b.tflw']) }).filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS);
  assert.equal(diags.length, 2);
  assert.deepEqual(diags.map((d) => d.span.start.line), [1, 2]);
});
