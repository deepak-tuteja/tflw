// `G10` (`D1384`) — a `rows` block under a `with each` test: judgements across every row, for a race
// whose outcome lives only in the responses (one email registered five times at once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, Codes, buildRowCount, replaceInSource } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const TABLE = 'with each concurrently\n  | n |\n  | 1 |\n  | 2 |\n  | 3 |\ntest "register {n}"\n  api POST /register\n  capture body.id as id\n';
const codes = (src: string, code: string): string[] =>
  checkProgram(parseSource(src).program).filter((d) => d.code === code).map((d) => d.message);

test('every count form parses onto the test, and prints back as written', () => {
  const src = `${TABLE}rows\n  expect exactly 1 row status equals 201\n  check 2 rows status equals 409\n  expect at least 1 row {id} equals 3\n  expect at most 2 rows body.x equals 1\n  expect no rows status equals 500\n  expect every row status is less than 500\n`;
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics, []);
  const rows = program.tests[0]!.rows!;
  assert.deepEqual(rows.checks.map((c) => c.count), [
    { kind: 'exactly', n: 1 }, { kind: 'bare', n: 2 }, { kind: 'atLeast', n: 1 }, { kind: 'atMost', n: 2 }, { kind: 'no' }, { kind: 'every' },
  ]);
  assert.deepEqual(rows.checks.map((c) => c.soft), [false, true, false, false, false, false]);
  const printed = print(program.tests[0]!);
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text.trimEnd(), src.trimEnd());
  assert.deepEqual(checkProgram(program), []);
});

test('`rows` belongs to the test above it, and the next declaration still parses as its own', () => {
  const { program, diagnostics } = parseSource(`${TABLE}\nrows\n  expect exactly 1 row status equals 201\n\ntest "after"\n  api GET /x\n`);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(program.tests.map((t) => [t.name.value, t.rows?.checks.length ?? 0]), [['register {n}', 1], ['after', 0]]);
});

test('a `rows` line needs a count and `row`/`rows`', () => {
  assert.match(parseSource(`${TABLE}rows\n  expect status equals 201\n`).diagnostics[0]!.message, /expected how many rows/);
  assert.match(parseSource(`${TABLE}rows\n  expect exactly 1 status equals 201\n`).diagnostics[0]!.message, /expected `row` or `rows` after the count/);
  assert.match(parseSource(`${TABLE}rows\n  log "x"\n`).diagnostics[0]!.message, /a `rows` line is `expect` or `check`/);
});

test('TF095: `rows` under a test with no table', () => {
  assert.deepEqual(codes('test "t"\n  api GET /a\nrows\n  expect exactly 1 row status equals 201\n', Codes.ROWS_WITHOUT_TABLE), ['`rows` under "t", which has no `with each` table']);
});

test('TF096: a subject a finished row cannot answer; a response and a binding it can', () => {
  assert.equal(codes(`${TABLE}rows\n  expect every row text "Done" is visible\n`, Codes.ROWS_SUBJECT_UNREADABLE).length, 1);
  assert.deepEqual(codes(`${TABLE}rows\n  expect every row status is less than 500\n  expect no rows {id} equals 0\n  expect every row header "x-a" equals "b"\n`, Codes.ROWS_SUBJECT_UNREADABLE), []);
});

test('a `rows` line reads what the rows bound — an unbound name is TF030', () => {
  assert.deepEqual(codes(`${TABLE}rows\n  expect every row {nope} equals 1\n  expect every row {n} equals 1\n`, Codes.UNKNOWN_VARIABLE), ['unknown variable "nope"']);
});

test('`M250` `G11`: one `rows` line\'s count is rewritten in place, and removing the last takes `rows` with it', () => {
  const src = `${TABLE}rows\n  expect exactly 1 row status equals 201\n  check 2 rows status equals 409\n\ntest "after"\n  api GET /x\n`;
  const check = parseSource(src).program.tests[0]!.rows!.checks[0]!;
  const count = buildRowCount('atLeast', '2');
  assert.equal(count.ok, true);
  if (!count.ok) return;
  const widened = replaceInSource(src, { kind: 'rowsCheck', decl: 0, index: 0, node: { ...check, count: count.node } });
  assert.equal(widened.ok, true, widened.ok ? '' : widened.reason);
  if (!widened.ok) return;
  assert.equal(widened.text, src.replace('expect exactly 1 row status', 'expect at least 2 rows status'), 'one line changed, every other byte kept');

  const one = replaceInSource(widened.text, { kind: 'rowsCheck', decl: 0, index: 1, node: null });
  assert.equal(one.ok, true, one.ok ? '' : one.reason);
  if (!one.ok) return;
  assert.doesNotMatch(one.text, /409/);
  const last = replaceInSource(one.text, { kind: 'rowsCheck', decl: 0, index: 0, node: null });
  assert.equal(last.ok, true, last.ok ? '' : last.reason);
  if (!last.ok) return;
  assert.doesNotMatch(last.text, /^rows$/m, 'an empty `rows` is TF015, so the header goes with its last line');
  const after = parseSource(last.text);
  assert.deepEqual(after.diagnostics, []);
  assert.deepEqual(after.program.tests.map((t) => [t.name.value, t.rows === undefined]), [['register {n}', true], ['after', true]]);

  // The builder says the parser's refusal in the field; `no` and `every` take no number.
  assert.equal(buildRowCount('exactly', 'two').ok, false);
  assert.deepEqual(buildRowCount('every', ''), { ok: true, node: { kind: 'every' } });
  // A test with no `rows` has none to rewrite.
  assert.equal(replaceInSource(src, { kind: 'rowsCheck', decl: 1, index: 0, node: null }).ok, false);
});
