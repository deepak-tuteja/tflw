// `G1` (`D1381`) and `G3` (`D1382`) — the two halves that let a `with each concurrently` race move
// off a `Promise.all` helper: `together`, where the rows meet before the step they race on, and a
// value `before file` makes, which every test and row then reads without being able to change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, Codes } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const codes = (src: string, code: string): string[] =>
  checkProgram(parseSource(src).program).filter((d) => d.code === code).map((d) => d.message);

const RACE = 'with each concurrently\n  | who |\n  | "a" |\n  | "b" |\n';

test('`together` parses to its own step and prints back as itself', () => {
  const src = `${RACE}test "t {who}"\n  api GET /setup\n  together\n  api POST /race\n`;
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(program.tests[0]!.body.map((s) => s.type), ['ApiStep', 'TogetherStmt', 'ApiStep']);
  const printed = print(program.tests[0]!);
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text.trimEnd(), src.trimEnd());
});

test('`together` at the top level of a concurrent test checks clean — twice, as two meeting points', () => {
  assert.deepEqual(codes(`${RACE}test "t {who}"\n  together\n  api POST /a\n  together\n  api POST /b\n`, Codes.TOGETHER_OUT_OF_PLACE), []);
});

test('TF092: `together` where no rows can meet — a plain test, a block, a hook, an action', () => {
  assert.deepEqual(codes('test "t"\n  together\n  api GET /a\n', Codes.TOGETHER_OUT_OF_PLACE), ['`together` in "t", whose rows do not run at once']);
  // A table whose rows run in turn is not a race either.
  assert.equal(codes('with each\n  | who |\n  | "a" |\n  | "b" |\ntest "t {who}"\n  together\n', Codes.TOGETHER_OUT_OF_PLACE).length, 1);
  assert.deepEqual(codes(`${RACE}test "t {who}"\n  within css "#cart"\n    together\n`, Codes.TOGETHER_OUT_OF_PLACE), ['`together` inside a block, where some rows could pass it and others never reach it']);
  assert.deepEqual(codes('before\n  together\ntest "t"\n  api GET /a\n', Codes.TOGETHER_OUT_OF_PLACE), ['`together` in a hook, which runs outside the rows']);
  assert.deepEqual(codes('action go(x)\n  together\n  api GET /a\n', Codes.TOGETHER_OUT_OF_PLACE), ['`together` in action "go", where a caller\'s rows cannot see it']);
});

test('G3: a value `before file` makes is read by a test, a row, an each-scope hook and `after file`', () => {
  const src = [
    'before file',
    '  api POST /coupons',
    '  capture body.code as coupon',
    'before',
    '  log "for {coupon}"',
    `${RACE.trimEnd()}`,
    'test "redeem {who} {coupon}"',
    '  api POST /redeem body { code: "{coupon}" }',
    'after file',
    '  api DELETE /coupons/{coupon}',
    '',
  ].join('\n');
  assert.deepEqual(codes(src, Codes.UNKNOWN_VARIABLE), []);
  assert.deepEqual(codes(src, Codes.UNKNOWN_TABLE_COLUMN), [], 'a row\'s name reads the shared value as its body does');
  assert.deepEqual(codes(src, Codes.FILE_VALUE_REBOUND), []);
});

test('TF091: a test, a column, a hook or `after file` binding a shared name again', () => {
  const head = 'before file\n  let coupon = "RACE-1"\n';
  assert.deepEqual(codes(`${head}test "t"\n  let coupon = "OTHER"\n`, Codes.FILE_VALUE_REBOUND), ['`coupon` is made once in `before file` and shared read-only; test "t" binds it again']);
  assert.deepEqual(codes(`${head}test "t"\n  api GET /c\n  capture body.code as coupon\n`, Codes.FILE_VALUE_REBOUND).length, 1);
  assert.deepEqual(codes(`${head}with each\n  | coupon |\n  | "x"    |\ntest "t {coupon}"\n  api GET /c\n`, Codes.FILE_VALUE_REBOUND), ['`coupon` is made once in `before file` and shared read-only; the table of "t {coupon}" binds it again']);
  assert.deepEqual(codes(`${head}before\n  let coupon = "y"\ntest "t"\n  api GET /c\n`, Codes.FILE_VALUE_REBOUND), ['`coupon` is made once in `before file` and shared read-only; a `before` hook binds it again']);
  assert.deepEqual(codes(`${head}after file\n  let coupon = "z"\ntest "t"\n  api GET /c\n`, Codes.FILE_VALUE_REBOUND), ['`coupon` is made once in `before file` and shared read-only; `after file` binds it again']);
  // A second `before file` shares the first's scope; binding there is setup, not a rebinding.
  assert.deepEqual(codes(`${head}before file\n  let other = "{coupon}"\ntest "t"\n  api GET /c/{other}\n`, Codes.FILE_VALUE_REBOUND), []);
});
