// `tflw fmt` — `M191` (`D994`–`D997`). Every `D995`/`D996` rule pinned on the smallest input that
// exercises it, the two declared adjacency exceptions, the refusal, and the round-trip gate on a
// file that uses everything at once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, roundTrip, compareTexts, lex } from '../src/index.js';

const fmt = (s: string) => {
  const r = format(s);
  assert.equal(r.ok, true, r.reason);
  return r.formatted;
};
const line = (s: string) => fmt(`test "t"\n  ${s}\n`).split('\n')[1]!.slice(2);

test('block indentation is two spaces per level, whatever the source used', () => {
  assert.equal(fmt('test "t"\n    api GET /x\n    expect status equals 200\n'), 'test "t"\n  api GET /x\n  expect status equals 200\n');
  assert.equal(fmt('test "t"\n api GET /x\n  header "a" is "b"\n'), 'test "t"\n  api GET /x\n    header "a" is "b"\n');
});

test('one space between tokens; none before , : ) ] ; none after ( [', () => {
  assert.equal(line('expect   body.items   equals  [1 ,2 , 3]'), 'expect body.items equals [1, 2, 3]');
  assert.equal(line('expect body [0] equals 1'), 'expect body [0] equals 1'); // index or list is the parser's call: kept as written
  assert.equal(line('let x = unique( "a" )'), 'let x = unique("a")');
  assert.equal(line('expect body[ 0 ].id equals 1'), 'expect body[0].id equals 1');
});

test('objects pad, interpolations stay tight, empties are empty (FS-07\'s two-token rule)', () => {
  assert.equal(line('api POST /o body {a:1,b:{c}}'), 'api POST /o body { a: 1, b: {c} }');
  assert.equal(line('api POST /o body { stock }'), 'api POST /o body {stock}');
  assert.equal(line('api POST /o body {}'), 'api POST /o body {}');
  assert.equal(line('api POST /o body { items: [ ] }'), 'api POST /o body { items: [] }');
  assert.equal(line('api POST /o body { items: [ { a: 1 } ] }'), 'api POST /o body { items: [{ a: 1 }] }');
});

test('the space after - and + is kept as written: unary and binary are a parse fact', () => {
  assert.equal(line('api POST /o body { price: -1 }'), 'api POST /o body { price: -1 }');
  assert.equal(line('let d = today - 10 days'), 'let d = today - 10 days');
  assert.equal(line('expect body.n is less than -5'), 'expect body.n is less than -5');
});

test('a duration unit keeps touching its number, and a spelled-out unit keeps its space', () => {
  assert.equal(line('hold 50 rps for 4s'), 'hold 50 rps for 4s');
  assert.equal(line('let d = today + 3 seconds'), 'let d = today + 3 seconds');
  assert.equal(line('threshold error rate is less than 1%'), 'threshold error rate is less than 1%');
});

test('`=` is tight in a form clause and spaced in a let', () => {
  assert.equal(line('api POST /login form email = "a", pw="b"'), 'api POST /login form email="a", pw="b"');
  assert.equal(line('let x=5'), 'let x = 5');
});

test('a multi-line bracket body indents one level past its opener\'s line, closer at that line', () => {
  const src = 'test "t"\n  api POST /o body {\n      items: [\n            { a: 1 },\n        { b: 2 }\n          ]\n        }\n';
  assert.equal(fmt(src), 'test "t"\n  api POST /o body {\n    items: [\n      { a: 1 },\n      { b: 2 }\n    ]\n  }\n');
});

test('a comment line takes the next code line\'s indent', () => {
  assert.equal(fmt('# header\ntest "t"\n# about the step\n  api GET /x\n'), '# header\ntest "t"\n  # about the step\n  api GET /x\n');
});

test('an end-of-block comment keeps the block it closes — before a dedent and at EOF', () => {
  assert.equal(fmt('test "t"\n  api GET /x\n  # why this block ends here\ntest "u"\n  api GET /y\n'), 'test "t"\n  api GET /x\n  # why this block ends here\ntest "u"\n  api GET /y\n');
  assert.equal(fmt('test "t"\n  api GET /x\n\n  # ideal, not built\n  #   expect body matches schema\n'), 'test "t"\n  api GET /x\n\n  # ideal, not built\n  #   expect body matches schema\n');
});

test('a comment inside a bracket body sits with the body', () => {
  assert.equal(fmt('test "t"\n  api POST /o body {\n  # the price\n  price: 1\n  }\n'), 'test "t"\n  api POST /o body {\n    # the price\n    price: 1\n  }\n');
});

test('a trailing comment gets two spaces, its text untouched, and a # in a string is not one', () => {
  assert.equal(line('api GET /x    # TODO   '), 'api GET /x  # TODO');
  assert.equal(line('expect body.t equals "gap #17"'), 'expect body.t equals "gap #17"');
});

test('tables align by column, cells formatted by the same rules', () => {
  const src = 'test "t"\n  with each\n    | name | price |\n    | "Pen"   | 1.5|\n    | unique( "Long name" ) | 22 |\n';
  assert.equal(fmt(src), 'test "t"\n  with each\n    | name                | price |\n    | "Pen"               | 1.5   |\n    | unique("Long name") | 22    |\n');
});

test('blank lines collapse to one, none at the start, exactly one final newline, no trailing whitespace', () => {
  assert.equal(fmt('\n\ntest "t"  \n\n\n  api GET /x   \n\n\n'), 'test "t"\n\n  api GET /x\n');
  assert.equal(fmt(''), '');
});

test('CRLF and a BOM are normalised away', () => {
  assert.equal(fmt('﻿test "t"\r\n  api GET /x\r\n'), 'test "t"\n  api GET /x\n');
});

test('a file that does not lex is not formatted, and says why', () => {
  const r = format('test "t"\n  api GET /x $\n');
  assert.equal(r.ok, false);
  assert.equal(r.formatted, 'test "t"\n  api GET /x $\n');
  assert.match(r.reason!, /TF001 at 2:14/);
});

test('idempotent on its own output', () => {
  const once = fmt('test "t"\n    api POST /o body {a:1}\n');
  assert.equal(fmt(once), once);
});

test('the round-trip gate: same tokens, same structure, same comments, idempotent — and it refuses a lex error', () => {
  const src = [
    '# header',
    '@tag',
    'test "everything at once"  # trailing',
    '  let d = today - 10 days',
    '  api POST /o body {',
    '      items: [ { a: -1, b: {name} } ],',
    '      # inner',
    '      n: 4s',
    '    }',
    '    header "a" is "b"',
    '  with each',
    '    | k | v |',
    '    | "x" | 1 |',
    '  # closes the block',
    'test "u"',
    '  api GET /u?q=1',
    '',
  ].join('\n');
  assert.deepEqual(roundTrip(src), []);
  const before = lex(src).tokens.filter((t) => t.type === 'ident' || t.type === 'string' || t.type === 'number').map((t) => t.raw);
  const after = lex(fmt(src)).tokens.filter((t) => t.type === 'ident' || t.type === 'string' || t.type === 'number').map((t) => t.raw);
  assert.deepEqual(after, before);
  assert.deepEqual(roundTrip('test "t"\n  api GET /x $\n'), ['not formatted: TF001 at 2:14: unexpected character "$"']);
});

test('the lexer\'s line records carry what the token stream drops', () => {
  const r = lex('# c\n\ntest "t"  # t\n  api POST /o body {\n  a: 1 }\n');
  assert.deepEqual(r.lines.map((l) => [l.kind, l.indent, l.continuation, l.comment ?? null]), [
    ['comment', 0, false, '# c'],
    ['blank', 0, false, null],
    ['code', 0, false, '# t'],
    ['code', 2, false, null],
    ['code', 2, true, null],
    ['blank', 0, false, null], // the empty line after the final newline — every file that ends in one has it
  ]);
});

test('the gate\'s own controls: each comparison fires on an output that fails it', () => {
  const src = '# header\ntest "t"\n  api GET /x  # why\n  expect status equals 200\n';
  assert.deepEqual(compareTexts(src, src), []);
  assert.match(compareTexts(src, 'test "t"\n  api GET /x  # why\n  expect status equals 200\n').join(' '), /comment count 2 → 1/);
  assert.match(compareTexts(src, '# header\ntest "t"\n  api GET /x  # WHY\n  expect status equals 200\n').join(' '), /comment 1 changed/);
  assert.match(compareTexts(src, '# header\ntest "t"\n  api GET /y  # why\n  expect status equals 200\n').join(' '), /token \d+ path:\/x → path:\/y/);
  assert.match(compareTexts(src, '# header\ntest "t"\n  api GET /x  # why\n    expect status equals 200\n').join(' '), /indent\/dedent structure changed/);
  assert.match(compareTexts(src, '# header\ntest "t"\n  api GET /x  # why\n').join(' '), /token count \d+ → \d+/);
});
