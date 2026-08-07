// M97d (`PLAN_M97_CHECKER_CONTRACT.md`, D141) — `TF044`, review row `A4-13`.
//
// An `action` that can reach itself. The rejection is sound because **tflw has no conditionals**:
// there is no `IfStmt` in the AST and no branching keyword in the parser, so a cycle in the call
// graph is not *potentially* infinite but unconditionally so. The checker contract's first clause
// (D137) says the checker may only reject what the runtime would have failed on, and a cycle can
// only ever end by failing.
//
// Every test below states the control that makes it non-vacuous — a pass that reports a cycle for
// every repeated *visit* would pass most of the positive cases here and be badly wrong, so the
// diamond and the sequential-call tests carry as much weight as the cycles do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkActionCycles, checkProgram, Codes } from '../src/index.js';

function check(source: string): ReturnType<typeof checkActionCycles> {
  const parsed = parseSource(source);
  assert.deepEqual(parsed.diagnostics, [], 'fixture must parse cleanly, or the pass is being fed nothing');
  return checkActionCycles(parsed.program);
}

test('a direct self-call is a cycle, reported at the call that closes it', () => {
  const diags = check(`
action boom()
  boom()

test "t"
  boom()
`);
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, Codes.CALL_CYCLE);
  assert.equal(diags[0]!.severity, 'error');
  assert.match(diags[0]!.message, /`boom → boom`/);
  // The span is the offending call inside the action, not the innocent one in the test.
  assert.equal(diags[0]!.span.start.line, 3);
});

test('an indirect cycle is reported, and named in full', () => {
  const diags = check(`
action a()
  b()

action b()
  c()

action c()
  a()

test "t"
  a()
`);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /`a → b → c → a`/);
});

test('a cycle reachable from three entry points is one diagnostic, not three', () => {
  // Without the member-set dedup key, `a`, `b` and `c` each start a DFS that rediscovers the same
  // cycle, and a two-line mistake is reported as three mistakes.
  const diags = check(`
action a()
  b()

action b()
  c()

action c()
  a()

test "t"
  a()
  b()
  c()
`);
  assert.equal(diags.length, 1);
});

test('two independent cycles are two diagnostics', () => {
  // The control for the test above: dedup must key on *which* cycle, not merely "already reported
  // one", or a file with two unrelated recursive actions would only hear about the first.
  const diags = check(`
action a()
  a()

action b()
  b()

test "t"
  a()
  b()
`);
  assert.equal(diags.length, 2);
  assert.deepEqual(diags.map((d) => d.message.match(/`([^`]+)`/)![1]), ['a → a', 'b → b']);
});

test('a deep acyclic chain reports nothing', () => {
  // NEGATIVE CONTROL. Eight frames of nesting is legal and common; a pass that fired on depth
  // rather than on reachability would reject this, and the runtime completes it happily.
  const diags = check(`
action f1()
  f2()
action f2()
  f3()
action f3()
  f4()
action f4()
  f5()
action f5()
  f6()
action f6()
  f7()
action f7()
  f8()
action f8()
  api GET /x

test "t"
  f1()
`);
  assert.deepEqual(diags, []);
});

test('a diamond reports nothing — a node visited twice is not a node on the stack twice', () => {
  // NEGATIVE CONTROL for the DFS bookkeeping specifically. `d` is reached from both `b` and `c`,
  // so a pass that confused "seen before" with "currently executing" would call this a cycle.
  const diags = check(`
action a()
  b()
  c()

action b()
  d()

action c()
  d()

action d()
  api GET /x

test "t"
  a()
`);
  assert.deepEqual(diags, []);
});

test('calling the same action twice in one body is not a cycle', () => {
  // NEGATIVE CONTROL. Two sequential calls are two frames that never overlap. This is the shape a
  // real suite writes constantly — `create user()` twice to make two users — so a false positive
  // here would be the expensive kind.
  const diags = check(`
action helper()
  api GET /x

action pair()
  helper()
  helper()

test "t"
  pair()
  pair()
`);
  assert.deepEqual(diags, []);
});

test('only calls the interpreter evaluates are edges', () => {
  // `let x = a() + "y"` never runs `a` — `evaluatedCalls` excludes it and so must this pass, or a
  // program the runtime completes would be rejected (contract clause 1).
  const notEvaluated = check(`
action a()
  let x = a() + "y"
  api GET /x

test "t"
  a()
`);
  assert.deepEqual(notEvaluated, [], 'a call inside a larger expression never runs, so it is not an edge');

  // CONTROL: the identical call, in a position that *does* run, is a cycle. Without this the test
  // above would pass against a pass that finds no edges anywhere.
  const evaluated = check(`
action a()
  let x = a()
  api GET /x

test "t"
  a()
`);
  assert.equal(evaluated.length, 1);
  assert.match(evaluated[0]!.message, /`a → a`/);
});

test('the check is not gated on a closed world — a `use` does not silence it', () => {
  // Deliberate deviation from the plan, which said this would reuse `checkCalls`' closed-world
  // condition. It must not: an edge here joins two actions declared in *this* file, and a same-file
  // name can never be shadowed by an imported one (`buildRegistry` throws on a duplicate, `TF035`
  // reports it). Gating on closed world would have skipped every suite that loads a JS helper.
  const diags = check(`
use "./helpers.js"
import "./shared.tflw"

action a()
  b()

action b()
  a()

test "t"
  a()
`);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /`a → b → a`/);
});

test('a call to an action this file does not declare is not an edge', () => {
  // An imported `b` calling back into `a` is a real cycle the *runtime* catches (D141's guard) and
  // this pass structurally cannot see, because `KnownAction` discards imported bodies. Reporting
  // it from here would be a guess.
  const diags = check(`
import "./other.tflw"

action a()
  b()

test "t"
  a()
`);
  assert.deepEqual(diags, []);
});

test('checkProgram composes the pass, sorted into position order', () => {
  const source = `
action a()
  expect status is visible
  a()

test "t"
  a()
`;
  const parsed = parseSource(source);
  const diags = checkProgram(parsed.program, { knownServices: [], knownSessions: [] });
  const codes = diags.map((d) => d.code);
  assert.ok(codes.includes(Codes.CALL_CYCLE), 'checkProgram must run the pass, not just export it');
  // `A4-14`'s ordering: line 3's matcher complaint precedes line 4's cycle, whatever order the
  // passes run in.
  assert.ok(codes.indexOf(Codes.MATCHER_SUBJECT_MISMATCH) < codes.indexOf(Codes.CALL_CYCLE));
});
