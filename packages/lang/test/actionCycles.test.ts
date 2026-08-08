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
import { parseSource, checkActionCycles, checkProgram, Codes, type KnownAction } from '../src/index.js';

function check(source: string, importedActions?: readonly KnownAction[]): ReturnType<typeof checkActionCycles> {
  const parsed = parseSource(source);
  assert.deepEqual(parsed.diagnostics, [], 'fixture must parse cleanly, or the pass is being fed nothing');
  return checkActionCycles(parsed.program, importedActions === undefined ? {} : { importedActions });
}

/** Imported actions exactly as `resolveImportedActions` hands them over (M109, `M97d-01`): a real
 * parse of the imported file's text, bodies included.
 *
 * `@tflw/lang` cannot call that resolver — it lives in `@tflw/runtime`, which depends on this
 * package, and it does I/O this package refuses to do — so the shape is reproduced here. That is a
 * gap by construction, and it is closed on purpose elsewhere: **every test below would still pass
 * if the resolver went back to dropping `body` on the floor**, which is precisely the defect this
 * milestone fixes. `packages/runtime/test/import-cycles.test.ts` runs the real resolver over real
 * files, and `scripts/mutate.mjs` (`imports-drop-body`) keeps that one honest. */
function importsOf(path: string, source: string): KnownAction[] {
  const parsed = parseSource(source);
  assert.deepEqual(parsed.diagnostics, [], 'the imported fixture must parse cleanly too');
  return parsed.program.actions.map((action) => ({ name: action.name, arity: action.params.length, from: path, body: action.body }));
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

test('a call to an action this file does not declare, with the imports unread, is not an edge', () => {
  // The pass is handed no `importedActions` at all — the world-unknown case, which every test above
  // this line also runs under. An imported `b` calling back into `a` may well be a real cycle, but
  // nobody looked, and reporting one on the strength of a name would be a guess. M109 changes only
  // what happens when the caller *does* look; see the section below.
  const diags = check(`
import "./other.tflw"

action a()
  b()

test "t"
  a()
`);
  assert.deepEqual(diags, []);
});

// ---------------------------------------------------------------------------
// Across `import`s (M109, review row `M97d-01`).
//
// D141 shipped `TF044` same-file only, on the true statement that `KnownAction` carried a name and
// an arity but no body, and left the rest to the runtime guard. `resolveImportedActions` had the
// bodies all along — it ran a full `parseSource` per imported file and then discarded
// `program.actions[].body` — so what was missing was a field, not information.
//
// The soundness argument is the merge order. Calls bind **late, against the entry file's registry**
// (`buildRegistry`: this file's actions, then each import's, a duplicate a hard error), so an
// imported body's `a()` means *this* file's `a` whenever this file declares one. Model that merge
// and the graph is the one the run would walk; model it wrong and the pass invents cycles that
// cannot happen — which is what the shadowing control below exists to catch.
// ---------------------------------------------------------------------------

const OTHER = './other.tflw';

test('a cycle that leaves the file through an `import` and comes back is reported (M97d-01)', () => {
  const diags = check(
    `
import "./other.tflw"

action a()
  b()

test "t"
  a()
`,
    importsOf(OTHER, 'action b()\n  a()\n'),
  );
  assert.equal(diags.length, 1);
  assert.equal(diags[0]!.code, Codes.CALL_CYCLE);
  assert.equal(diags[0]!.severity, 'error');
  assert.match(diags[0]!.message, /`a → b → a`/, 'the same arrow notation the runtime guard prints');
  // "enters", not "completes": the call that closes this cycle is `b`'s, one file over. Claiming
  // otherwise would describe a line the reader is not looking at.
  assert.match(diags[0]!.message, /this call enters a cycle/);
  // The span is the local `b()` — the only line in *this* file a reader can delete to break the
  // cycle, and the only span this file's renderer can underline at all. A span from `other.tflw`
  // rendered against this source is the caret-on-an-unrelated-line defect M106 closed.
  assert.equal(diags[0]!.span.start.line, 5);
  assert.equal(diags[0]!.span.start.column, 3);
  assert.match(diags[0]!.hint ?? '', /`b` is imported from "\.\/other\.tflw" and calls `a`/);
});

test('an imported action that does not call back is not a cycle', () => {
  // NEGATIVE CONTROL, and the one that matters most: the positive test above passes just as well
  // against a pass that reports every call into an imported action. This is the ordinary shape — a
  // shared helper, called once — so a false positive here would break every suite with an `import`.
  const diags = check(
    `
import "./other.tflw"

action a()
  b()

test "t"
  a()
`,
    importsOf(OTHER, 'action b()\n  api GET /x\n'),
  );
  assert.deepEqual(diags, []);
});

test('an imported action carrying no `body` is a node the pass cannot look inside', () => {
  // NEGATIVE CONTROL for the `undefined`-vs-`[]` doctrine one level down. This is the pre-M109
  // `KnownAction` shape, which any caller assembling the list by hand can still hand over. No body
  // means nothing was read, not "this action calls nothing" — and there is no span to point at
  // either way, so silence is the only sound answer.
  const diags = check(
    `
import "./other.tflw"

action a()
  b()

test "t"
  a()
`,
    [{ name: 'b', arity: 0, from: OTHER }],
  );
  assert.deepEqual(diags, []);
});

test('a cycle whose every call site is inside imported files is left to that file’s own check', () => {
  // `b → c → b` is real and both call sites live in `other.tflw`. Reporting it *here* would mean
  // underlining a span that indexes into another file's text. It is a same-file cycle of that file,
  // which `tflw check` reports when it reaches it — every `.tflw` under the cwd is discovered — and
  // which the runtime guard catches in any case.
  const diags = check(
    `
import "./other.tflw"

test "t"
  b()
`,
    importsOf(OTHER, 'action b()\n  c()\n\naction c()\n  b()\n'),
  );
  assert.deepEqual(diags, []);
});

test('a cycle that closes back in this file keeps the `completes` wording, and names where it went', () => {
  // `a → b → c → a`, with `b` imported: the closing call (`c`'s `a()`) is local, so both the anchor
  // and the wording are exactly what a wholly-local cycle gets. The hint carries the provenance,
  // which is the only thing telling the reader why `b` is not in the file they are looking at.
  const diags = check(
    `
import "./other.tflw"

action a()
  b()

action c()
  a()

test "t"
  a()
`,
    importsOf(OTHER, 'action b()\n  c()\n'),
  );
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /this call completes a cycle: `a → b → c → a`/);
  assert.equal(diags[0]!.span.start.line, 8, 'the closing call, inside `c`');
  assert.match(diags[0]!.hint ?? '', /extract the shared steps into a third action/);
  assert.match(diags[0]!.hint ?? '', /\(`b` is imported from "\.\/other\.tflw"\)/);
});

test('a local action shadows an imported one of the same name, so the imported body is not an edge', () => {
  // NEGATIVE CONTROL for the merge order, and the one place a wrong model invents a cycle out of
  // nothing. Both files declare `b`; the local one is added first, exactly as `buildRegistry` does,
  // and it does not call `a`. Take the imported body instead and this reports `a → b → a`, a cycle
  // no run can reach. (The duplicate itself is a real error — `TF035` reports it statically and
  // `buildRegistry` throws — but it is not this pass's to re-report.)
  const diags = check(
    `
import "./other.tflw"

action a()
  b()

action b()
  api GET /x

test "t"
  a()
`,
    importsOf(OTHER, 'action b()\n  a()\n'),
  );
  assert.deepEqual(diags, []);
});

test('only calls the interpreter evaluates are edges — inside an imported body too', () => {
  const notEvaluated = check(
    `
import "./other.tflw"

action a()
  b()

test "t"
  a()
`,
    importsOf(OTHER, 'action b()\n  let x = a() + "y"\n  api GET /x\n'),
  );
  assert.deepEqual(notEvaluated, [], '`let x = a() + "y"` never runs `a`, on either side of an import');

  // CONTROL: the same call in a position that does run. Without it the assertion above would pass
  // against a pass that never crosses an import at all — which is the pre-M109 behaviour.
  const evaluated = check(
    `
import "./other.tflw"

action a()
  b()

test "t"
  a()
`,
    importsOf(OTHER, 'action b()\n  let x = a()\n  api GET /x\n'),
  );
  assert.equal(evaluated.length, 1);
  assert.match(evaluated[0]!.message, /`a → b → a`/);
});

test('a cross-file cycle reachable from two local actions is still one diagnostic', () => {
  // The dedup key is the member *set*, and crossing a file boundary must not change that: two local
  // ways into one cycle is one mistake.
  const diags = check(
    `
import "./other.tflw"

action a()
  b()

action entry()
  a()

test "t"
  a()
  entry()
`,
    importsOf(OTHER, 'action b()\n  a()\n'),
  );
  assert.equal(diags.length, 1, JSON.stringify(diags.map((d) => d.message), null, 2));
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
