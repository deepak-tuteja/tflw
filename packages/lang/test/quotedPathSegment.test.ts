// `M230` `B` — **a body path segment may be quoted** (`D1262`–`D1264`), closing `M213-18`.
//
// The row's carry is why this gap survived the language's whole life: **a path was only ever
// something a person typed.** A human does not attempt a key they can see is unspellable, so the
// corpus held zero evidence of the limit — no failing file, no support question, no diagnostic
// anyone met. It took `packages/ui/src/response.ts` enumerating *every* path in a real response
// body to produce the counterexample, and once something enumerated them the gap was everywhere:
// a JSON object keyed by id (`body.0`), a header map inlined into a body (`body.content-type`).
//
// Three of these four sections are about the widening. The fourth is the **negative control** and
// is the one that would have caught the wrong repair: a gate that only proves the new spelling
// works cannot see that the old error quietly went away, and a relaxation dressed as an addition
// is exactly what a `1.0.0` freeze cannot take back. `M223` `F`'s family says to write it first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, parsePathText, buildApiStep, buildCapture, buildExpect } from '../src/index.js';

const src = (body: string): string => `test "t"\n  ${body}\n`;

function errors(text: string): string[] {
  const { diagnostics } = parseSource(text);
  return diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
}

// ---- `D1262`: the grammar --------------------------------------------------

test('`M230` `B`: a quoted segment is a property segment, spelled differently (`D1262`)', () => {
  const { program, diagnostics } = parseSource(src('expect body."content-type" equals "json"'));
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  const stmt = program.tests[0]!.body[0]!;
  if (stmt.type !== 'ExpectStmt' || stmt.subject.type !== 'BodySubject') return assert.fail('not a body subject');
  // The AST is unchanged — this is a spelling, not a new node. `PathSegment` still has exactly
  // two kinds, so nothing downstream (`eval.ts`, the checker, the reporter) needed a branch.
  assert.deepEqual(stmt.subject.path, [{ kind: 'prop', name: 'content-type' }]);
});

test('`M230` `B`: quotes mean *the key*, brackets mean *the nth element*, and both occur', () => {
  // `body."0"` and `body[0]` are different subjects against a real response: an object keyed "0"
  // and the first element of an array. Neither is a second spelling of the other, which is why
  // `["0"]` was deliberately not added as a third form.
  const quoted = parseSource(src('expect body."0" equals 1'));
  const indexed = parseSource(src('expect body[0] equals 1'));
  const pathOf = (r: ReturnType<typeof parseSource>) => {
    const stmt = r.program.tests[0]!.body[0]!;
    return stmt.type === 'ExpectStmt' && stmt.subject.type === 'BodySubject' ? stmt.subject.path : null;
  };
  assert.deepEqual(pathOf(quoted), [{ kind: 'prop', name: '0' }]);
  assert.deepEqual(pathOf(indexed), [{ kind: 'index', index: 0 }]);
});

test('`M230` `B`: a quoted segment composes with dots and indexes in any order', () => {
  const { program, diagnostics } = parseSource(src('expect body.items[0]."a b" equals 1'));
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  const stmt = program.tests[0]!.body[0]!;
  if (stmt.type !== 'ExpectStmt' || stmt.subject.type !== 'BodySubject') return assert.fail('not a body subject');
  assert.deepEqual(stmt.subject.path, [
    { kind: 'prop', name: 'items' },
    { kind: 'index', index: 0 },
    { kind: 'prop', name: 'a b' },
  ]);
});

// ---- `D1264`: the same spelling in the same round --------------------------
//
// `M169d5`'s rule, and the reason widening `expect` alone was refused: a rule spent in one
// implementation and not the other lets parity agree with itself. `capture` shares `parseSubject`
// so it costs nothing; interpolation is a second reader of the same grammar and had to move too.

test('`M230` `B`: `capture` reads the same path grammar as `expect` (`D1264`)', () => {
  const { program, diagnostics } = parseSource(src('capture body."content-type" as ct'));
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  const stmt = program.tests[0]!.body[0]!;
  if (stmt.type !== 'CaptureStmt' || stmt.subject.type !== 'BodySubject') return assert.fail('not a capture of a body path');
  assert.deepEqual(stmt.subject.path, [{ kind: 'prop', name: 'content-type' }]);
});

test('`M230` `B`: an interpolation reads it too, as a value and inside a string (`D1264`)', () => {
  const asValue = parseSource(src('let x = {o."content-type"}'));
  assert.deepEqual(
    asValue.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  // Inside a string the quotes are the *string's* escapes, because the hole lives in a string
  // literal. This is the spelling `print` emits, and the round-trip test below proves it reads
  // back as the same path rather than as text.
  const inString = parseSource(src('let x = "ct is {o.\\"content-type\\"}"'));
  assert.deepEqual(
    inString.diagnostics.filter((d) => d.severity === 'error'),
    [],
  );
  const stmt = inString.program.tests[0]!.body[0]!;
  if (stmt.type !== 'LetStmt' || stmt.value.type !== 'StringLit') return assert.fail('not a string let');
  assert.deepEqual(stmt.value.parts, [
    { kind: 'text', value: 'ct is ' },
    {
      kind: 'interp',
      ref: [
        { kind: 'prop', name: 'o' },
        { kind: 'prop', name: 'content-type' },
      ],
    },
  ]);
});

test('`M230` `B`: the head of an interpolation is still a bare name (`D1264`)', () => {
  // A hole opens with a *variable*, and `let "a-b" = …` is not a thing the language has. Widening
  // the head would have invented a binding form as a side effect of a path spelling.
  assert.notDeepEqual(errors(src('let x = {"content-type"}')), []);
});

// ---- `D1263`: the printer, and idempotence ---------------------------------

test('`M230` `B`: the printer quotes when, and only when, the bare spelling would not parse back (`D1263`)', () => {
  const roundTrip = (line: string): string => {
    const { program, diagnostics } = parseSource(src(line));
    assert.deepEqual(
      diagnostics.filter((d) => d.severity === 'error'),
      [],
      line,
    );
    const printed = print(program);
    assert.equal(printed.ok, true, line);
    return printed.text.split('\n')[1]!.trim();
  };
  // The quoted key keeps its quotes …
  assert.equal(roundTrip('expect body."content-type" equals "json"'), 'expect body."content-type" equals "json"');
  assert.equal(roundTrip('expect body."0" equals 1'), 'expect body."0" equals 1');
  assert.equal(roundTrip('capture body."content-type" as ct'), 'capture body."content-type" as ct');
  assert.equal(roundTrip('let x = {o."content-type"}'), 'let x = {o."content-type"}');
  assert.equal(roundTrip('let x = "ct is {o.\\"content-type\\"}"'), 'let x = "ct is {o.\\"content-type\\"}"');
  // … and a name that does not need them does not get them. This is the assertion that fails on
  // the tempting wrong rule (*quote whenever quoting is legal*), which would rewrite every file
  // in the corpus on `tflw fmt` while every round trip stayed green.
  assert.equal(roundTrip('expect body.items[0].price equals 3'), 'expect body.items[0].price equals 3');
});

// ---- The negative control: the bare spelling still refuses what it refused --

test('`M230` `B`: the widening is a new spelling, not a relaxation — the bare forms still refuse', () => {
  // Measured 2026-09-22, and the two codes differ because the two failures differ: `content-type`
  // lexes as `content`, `-`, `type`, so the path ends cleanly and the *matcher* is missing;
  // `0` is not an identifier at all and dies inside the path. `PLAN_M230_M232_LEDGER_CLOSE.md` §2
  // predicted `TF010` for both — the prediction was right about the refusal and wrong about one
  // code, which is recorded here rather than rounded off.
  assert.deepEqual(errors(src('expect body.content-type equals "json"')), ['TF014']);
  assert.deepEqual(errors(src('expect body.0 equals 1')), ['TF010']);
  // And the diagnostic teaches the new spelling, because `D1262` is additive and nobody has a
  // reason to go looking for it.
  const { diagnostics } = parseSource(src('expect body.0 equals 1'));
  assert.match(diagnostics[0]!.message, /quoted key/);
});

// ---- One scanner, three callers (`D1264`) ----------------------------------

test('`M230` `B`: `build.ts` reads paths with the parser`s own scanner, not a copy of it', () => {
  // The page types a path as *text*; the file is read back by the *parser*. Before this round
  // those were two grammars written twice, and `M213-18`'s finding is that they had drifted
  // identically — both narrower than any real body — so nothing ever disagreed.
  const built = buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: 'headers."content-type"' }, matcher: 'equals', operand: '"json"' });
  assert.equal(built.ok, true, built.ok ? '' : built.reason);
  if (built.ok) {
    const stmt = built.node;
    if (stmt.subject.type !== 'BodySubject') return assert.fail('not a body subject');
    assert.deepEqual(stmt.subject.path, [{ kind: 'prop', name: 'headers' }, { kind: 'prop', name: 'content-type' }]);
  }
  // …and the scanner itself, directly: the head may be quoted for a body path and may not for a
  // `{ref}` hole, which is the one difference between the callers and so a parameter, not a copy.
  assert.deepEqual(parsePathText('"content-type"', { quotedHead: true }), [{ kind: 'prop', name: 'content-type' }]);
  assert.equal(parsePathText('"content-type"'), null);
  assert.equal(parsePathText('a."b.c".d', { quotedHead: true })!.length, 3, 'a dot inside a quoted key is part of the key, not a separator');
});

// ---- `M256`: the text reader takes what the token reader takes -------------------------------
//
// Found by the page's round-trip gate, which opens every row in both corpora and closes it
// untouched: 116 captures and assertions over a response whose root is a list (`body[0].id`) came
// back **refused**, because `parsePathText` demanded a key first while `parseBodyPath` — the token
// route the parser itself uses — has always read an index there. The same gate found `is empty`
// unbuildable and an absolute-URL request uneditable; all three are the builder refusing a file
// the parser accepts.

test('`M256`: a body path may open with an index, as the parser reads it — and a `{ref}` still may not', () => {
  const read = parseSource(src('capture body[0].id as firstId'));
  assert.deepEqual(read.diagnostics.filter((d) => d.severity === 'error'), [], 'the language reads it');
  assert.deepEqual(parsePathText('[0].id', { quotedHead: true, indexHead: true }), [{ kind: 'index', index: 0 }, { kind: 'prop', name: 'id' }]);
  const built = buildCapture({ subject: { kind: 'body', path: '[0].id' }, name: 'firstId' });
  assert.ok(built.ok, built.ok ? '' : built.reason);
  assert.equal(print(built.node).ok && (print(built.node) as { text: string }).text, 'capture body[0].id as firstId');
  // The control: a `{ref}` hole opens with the variable it names, so the option is not the default.
  assert.equal(parsePathText('[0].id'), null, 'an interpolation head is still a name');
  const value = buildExpect({ soft: false, quantifier: null, subject: { kind: 'value', ref: '[0]' }, matcher: 'equals', operand: '1' });
  assert.equal(value.ok, false, 'and a `{value}` subject names a variable, never an index');
});

test('`M256`: `is empty` takes nothing, as the parser writes it — and `equals` still needs its value', () => {
  const built = buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: 'comment' }, matcher: 'isEmpty', operand: null });
  assert.ok(built.ok, built.ok ? '' : built.reason);
  assert.equal(print(built.node).ok && (print(built.node) as { text: string }).text, 'expect body.comment is empty');
  const bare = buildExpect({ soft: false, quantifier: null, subject: { kind: 'body', path: 'comment' }, matcher: 'equals', operand: null });
  assert.equal(bare.ok, false, 'the control: a matcher that compares still refuses no value');
});

test('`M256`: an absolute URL is a request target the builder takes, as the lexer does — and a bare word is not', () => {
  const spec = { service: null, method: 'GET' as const, headers: [], body: null, label: null };
  const absolute = buildApiStep({ ...spec, path: 'https://example.test/health' });
  assert.ok(absolute.ok, absolute.ok ? '' : absolute.reason);
  assert.equal(print(absolute.node).ok && (print(absolute.node) as { text: string }).text, 'api GET https://example.test/health');
  assert.equal(buildApiStep({ ...spec, path: 'orders' }).ok, false, 'the control: a relative word is still not a target');
});
