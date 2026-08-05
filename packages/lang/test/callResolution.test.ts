// M87 (review cluster C6) — the checker resolves names.
//
// Until this milestone `checkValue` walked a call's *arguments* and never looked at its callee
// (`case 'CallExpr': for (const arg of value.args) …`), so a wrong-arity call to an action declared
// three lines above lint-passed, and so did a typo'd name. `A4-03` is the root cause; `FU-08` filed
// the typo half from a fresh user's seat. Both die at that step of a real run.
//
// The tests here are as much about the *limits* as the catches. Three of the four questions this
// pass could ask are unsound in some frame, and each suppression below has a real defect behind it:
// a shared library file would be condemned wholesale (late binding), a `use` line makes the negative
// undecidable without executing the user's code, and an unread import must never harden into a
// claim. A checker error people learn to route around is worse than no checker error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkCalls, checkResponseScopes, type KnownAction } from '../src/index.js';

/** Parse, insisting the fixture is *valid tflw* before asking a semantic question of it.
 *
 * Half the assertions below expect `[]`, and a fixture that fails to parse also yields `[]` — so
 * without this guard a typo in a test's own source reads as the pass it was written to prove. Not
 * hypothetical: `within "#panel"` (needs a locator, not a string) parsed to a single `ApiStep` and
 * quietly turned the nested-scope test into a test of nothing. Caught here because that one
 * happened to assert a *positive*; the negatives would never have said a word. */
function parseValid(src: string): ReturnType<typeof parseSource>['program'] {
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(
    diagnostics.map((d) => `${d.code}: ${d.message}`),
    [],
    'fixture does not parse — fix the test source, not the checker',
  );
  return program;
}

function callDiags(src: string, importedActions?: readonly KnownAction[]): ReturnType<typeof checkCalls> {
  return checkCalls(parseValid(src), importedActions === undefined ? {} : { importedActions });
}

const DECL = 'action create order(name)\n  api POST /orders body { name: {name} }\n  expect status equals 201\n  capture body.id as id\n  give id\n\n';

// ---- TF037: unknown call ---------------------------------------------------

test('TF037: a typo\'d call in a test body is unknown, and suggests the real name', () => {
  const diags = callDiags(`${DECL}test "t"\n  let a = creat order("W")\n`);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF037');
  assert.match(diags[0]!.message, /unknown call `creat order\(\.\.\.\)`/);
  assert.equal(diags[0]!.hint, 'did you mean `create order`?');
});

test('TF037: with no near miss, the hint lists what this file can call', () => {
  const diags = callDiags(`${DECL}test "t"\n  let a = something entirely different("W")\n`);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF037');
  assert.match(diags[0]!.hint!, /this file can call: `create order`/);
});

test('TF037: a file declaring no actions at all names the three ways to define one', () => {
  const diags = callDiags('test "t"\n  let a = nothing defines this()\n');
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.hint!, /declare it with `action` here, `import "…"` .*, or `use "…"`/);
});

test('TF037: a resolved call is silent', () => {
  assert.deepEqual(callDiags(`${DECL}test "t"\n  let a = create order("W")\n`), []);
});

test('TF037: an import the caller resolved puts that action in scope', () => {
  const src = 'import "./shared/orders.tflw"\n\ntest "t"\n  let a = create order("W")\n';
  assert.deepEqual(callDiags(src, [{ name: 'create order', arity: 1, from: './shared/orders.tflw' }]), []);
});

test('TF037 is suppressed when an import could not be resolved — never a claim made without looking', () => {
  // `importedActions: undefined` is the caller saying "I did not manage to read them", which is a
  // different thing from `[]` ("I read them and they declare nothing").
  const src = 'import "./shared/orders.tflw"\n\ntest "t"\n  let a = create order("W")\n';
  assert.deepEqual(callDiags(src), []);
});

test('TF037 is suppressed by a single `use` — a JS helper\'s exports need executing to enumerate', () => {
  const src = 'use "./helpers.ts"\n\ntest "t"\n  let a = anything at all("W")\n';
  assert.deepEqual(callDiags(src, []), []);
});

test('TF037 is suppressed inside an `action` body — calls bind late, against the importing file', () => {
  // The dogfood repo's `shared/root.tflw` is exactly this: an extracted action whose body calls
  // `login(...)`, supplied by the file that imports it. Reporting here would condemn every shared
  // library file in a suite, and there is no import that would fix it — `buildRegistry` resolves
  // one level from the *entry* file and never recurses.
  assert.deepEqual(callDiags('action root(q)\n  let s = login("a", "b")\n  give s\n'), []);
});

test('TF037 still fires in a hook body — a hook always runs under its own file\'s registry', () => {
  const diags = callDiags(`${DECL}before\n  let a = creat order("W")\n`);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF037');
});

// ---- TF038: wrong arity ----------------------------------------------------

test('TF038: too many arguments, pointing at the declaration', () => {
  const diags = callDiags(`${DECL}test "t"\n  let a = create order("W", "x", "y")\n`);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF038');
  assert.equal(diags[0]!.message, 'action "create order" expects 1 argument, got 3');
  assert.equal(diags[0]!.hint, 'declared at line 1');
});

test('TF038: too few arguments, and the noun agrees with the count', () => {
  const src = 'action pair(a, b)\n  give a\n\ntest "t"\n  let x = pair("one")\n';
  const diags = callDiags(src);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.message, 'action "pair" expects 2 arguments, got 1');
});

test('TF038: an imported action is named by the file it came from, not by a line number', () => {
  const src = 'import "./shared/orders.tflw"\n\ntest "t"\n  let a = create order()\n';
  const diags = callDiags(src, [{ name: 'create order', arity: 1, from: './shared/orders.tflw' }]);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF038');
  assert.equal(diags[0]!.hint, 'imported from "./shared/orders.tflw"');
});

test('TF038 holds inside an `action` body, where TF037 does not — a resolved name is authoritative', () => {
  // Soundness asymmetry worth pinning: late binding can *add* names, never redefine one. A
  // duplicate is refused by `TF035` here and by `buildRegistry` at run time, so a name matching a
  // declared action is that action in every frame — the arity question survives what the unknown
  // question does not.
  const src = 'action pair(a, b)\n  give a\n\naction caller()\n  let x = pair("one")\n  give x\n';
  const diags = callDiags(src);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF038');
});

test('TF038 survives a `use` line for the same reason', () => {
  const src = 'use "./helpers.ts"\n\naction pair(a, b)\n  give a\n\ntest "t"\n  let x = pair("one")\n';
  const diags = callDiags(src, []);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF038');
});

// ---- TF040: a call in a position that never evaluates -----------------------

test('TF040: a call as an object field — the shape that sends `{}` at a green ✓', () => {
  const src = `${DECL}test "t"\n  api POST /a body { id: create order("W") }\n  expect status equals 200\n`;
  const diags = callDiags(src);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF040');
  assert.match(diags[0]!.hint!, /bind it first — `let result = create order\(…\)`/);
});

test('TF040: a call as an array element', () => {
  const src = `${DECL}test "t"\n  api POST /a body { ids: [create order("W")] }\n  expect status equals 200\n`;
  assert.equal(callDiags(src)[0]!.code, 'TF040');
});

test('TF040: a call nested in an expression is not "the whole value of a `let`"', () => {
  const src = `${DECL}test "t"\n  let a = create order("W") + "x"\n`;
  assert.equal(callDiags(src)[0]!.code, 'TF040');
});

test('TF040: the two legal positions stay silent', () => {
  assert.deepEqual(callDiags(`${DECL}test "t"\n  create order("W")\n`), []);
  assert.deepEqual(callDiags(`${DECL}test "t"\n  let a = create order("W")\n`), []);
});

test('TF040 is reported alone — position is the thing to fix first', () => {
  // The name is also wrong here, and the arity too. Piling `TF037` on top would ask the reader to
  // fix a call that should not be in that position at all.
  const src = `${DECL}test "t"\n  api POST /a body { id: creat order() }\n  expect status equals 200\n`;
  const diags = callDiags(src);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF040');
});

test('TF040 finds a call in a position no step-shaped walker enumerates', () => {
  // The regression this pass is shaped around: `directCalls` (M60) switches over `Step` and has no
  // `ApiStep` case, so a call inside a request body is invisible to it. `eachCall` recurses over the
  // AST's own object graph instead, so a position is covered the day it parses.
  const src = `${DECL}test "t"\n  api POST /a body { nested: { deep: [ { deeper: create order("W") } ] } }\n  expect status equals 200\n`;
  assert.equal(callDiags(src).length, 1);
  assert.equal(callDiags(src)[0]!.code, 'TF040');
});

// ---- TF039: assertion or capture before any response ------------------------

function responseDiags(src: string): ReturnType<typeof checkResponseScopes> {
  return checkResponseScopes(parseValid(src));
}

test('TF039: an assertion as a test\'s first step', () => {
  const diags = responseDiags('test "t"\n  expect status equals 200\n');
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF039');
  assert.match(diags[0]!.hint!, /^`status` reads the last `api` step's response/);
});

test('TF039: a `capture` before any request', () => {
  const diags = responseDiags('test "t"\n  capture body.id as id\n');
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF039');
  assert.match(diags[0]!.hint!, /before this `capture`/);
});

test('TF039: an `api` step ahead of the assertion clears it', () => {
  assert.deepEqual(responseDiags('test "t"\n  api GET /a\n  expect status equals 200\n'), []);
});

test('TF039: `wait until api` establishes a response too', () => {
  const src = 'test "t"\n  wait until api GET /a\n    expect status equals 200\n  expect status equals 200\n';
  assert.deepEqual(responseDiags(src), []);
});

test('TF039: a UI subject needs no response — the interpreter never routes it through one', () => {
  assert.deepEqual(responseDiags('test "t"\n  open "/"\n  expect button "Go" is visible\n'), []);
});

test('TF039: calling an action does not publish its response to the caller (FU-12)', () => {
  const src = 'action do it()\n  api GET /a\n  expect status equals 200\n\ntest "t"\n  do it()\n  expect status equals 200\n';
  const diags = responseDiags(src);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, 'TF039');
  assert.match(diags[0]!.hint!, /never crosses out of an `action` or a hook/);
});

test('TF039: a `before` hook\'s request is invisible to the test body', () => {
  const src = 'before\n  api GET /a\n  expect status equals 200\n\ntest "t"\n  expect status equals 200\n';
  assert.equal(responseDiags(src).length, 1);
});

test('TF039: an action body is checked in its own right, and a request inside it counts', () => {
  assert.deepEqual(responseDiags('action do it()\n  api GET /a\n  expect status equals 200\n'), []);
  assert.equal(responseDiags('action do it()\n  expect status equals 200\n').length, 1);
});

test('TF039: a nested block is its own response scope, both ways', () => {
  // `execSteps` recurses for `within`/`switch to new tab`/`download`, and `lastResponse` is a local
  // of that function — so a request outside the block does not carry in, and one inside does not
  // carry out.
  const inward = 'test "t"\n  api GET /a\n  within list "Cart items"\n    expect status equals 200\n';
  assert.equal(responseDiags(inward).length, 1);
  const outward = 'test "t"\n  within list "Cart items"\n    api GET /a\n  expect status equals 200\n';
  assert.equal(responseDiags(outward).length, 1);
});

test('TF039 says nothing about anything after the first request', () => {
  // Deliberately out of scope: whether a *later* assertion reads a field that exists is `A4-06`
  // and `A4-15`'s territory, and stays a runtime concern.
  const src = 'test "t"\n  api GET /a\n  expect body.nope.deeper equals 1\n  capture body.also.missing as x\n';
  assert.deepEqual(responseDiags(src), []);
});
