// `M147c` (`A2-11`, D633) — `TF072`: **the same column name declared twice in one `with each`
// header.**
//
// `| name | name |` parsed, checked clean and ran. A row binds each name once, so the second column
// overwrote the first: every cell under the earlier one was read out of the source, thrown away,
// and never mentioned. The test passed. That is the whole finding — not a crash, a silence.
//
// **Three decisions this file pins, each with the break that would show it was wrong.**
//
// 1. *Judged inside the loop that reads the header, not over `columns` afterwards.* The obvious
//    post-hoc version was written first and measured against these tests: it fails four of them.
//    M83's panic mode drops any diagnostic raised without the cursor having moved, and once the
//    header is read the cursor does not move between one complaint and the next — so
//    `| id | id | id |` reported once instead of twice, and the caret pointed past the whole header
//    instead of at a name. Reading each name first buys both: a `|` is consumed between any two
//    complaints, and the token whose span is wanted is in hand.
// 2. *The duplicate is kept in `columns`.* The header's **width** is what every data row is matched
//    against, so dropping the offending name would answer one mistake with a ragged-row complaint
//    against every row in the table — the cascade M83 spent a milestone removing from this exact
//    production. The "and nothing else" assertions are that break: they fail the moment the header
//    and the rows disagree about width.
// 3. *The set is per table, not per file.* `seenColumns` is constructed inside `parseDataTable`, so
//    two tables may each declare `id`. Hoist it and the two-table test below goes red.
//
// The blunt control for the file: delete the `seen.has` branch and every positive goes silent while
// every negative still passes — which is the direction that matters, since a rule that fires on the
// legal spellings would have been caught by the negatives alone.
//
// `M92d`'s rule throughout — a negative control that cannot fail is a passing test of nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, Codes } from '../src/index.js';

const codes = (source: string): string[] => parseSource(source).diagnostics.map((d) => d.code);

/** A table header + rows, wrapped in the smallest runnable test that reads a column. */
const TABLE = (header: string, rows: string[], name = 't {a}'): string =>
  `with each\n  ${header}\n${rows.map((r) => `  ${r}\n`).join('')}test "${name}"\n  api GET /a\n  expect status equals 200\n`;

// -- the rule ----------------------------------------------------------------

test('a column name declared twice is refused', () => {
  assert.deepEqual(codes(TABLE('| a | a |', ['| "x" | "y" |'])), [Codes.DUPLICATE_TABLE_COLUMN]);
});

test('the caret lands on the second occurrence — the one to rename', () => {
  const { diagnostics } = parseSource(TABLE('| a | a |', ['| "x" | "y" |']));
  const dup = diagnostics.find((d) => d.code === Codes.DUPLICATE_TABLE_COLUMN)!;
  // Line 2 is the header; column 9 is the second `a`, not the first at column 5.
  assert.equal(dup.span.start.line, 2);
  assert.equal(dup.span.start.column, 9);
  assert.match(dup.message, /duplicate table column `a`/);
});

test('the hint names the consequence and the repair, not just the fact', () => {
  const { diagnostics } = parseSource(TABLE('| a | a |', ['| "x" | "y" |']));
  const dup = diagnostics.find((d) => d.code === Codes.DUPLICATE_TABLE_COLUMN)!;
  assert.match(dup.hint!, /discarded/);
  assert.match(dup.hint!, /rename one/);
});

test('a name declared three times reports twice — M83 panic mode does not swallow the third', () => {
  // The break for decision 1, measured: judge `columns` after `parseTableRow` returns and this is
  // `[TF072]`, because the second `error()` is raised with the cursor exactly where the first left
  // it. Note the *first* duplicate still reports under that version — the swallow starts at the
  // third column, which is why a two-column fixture alone would not have caught it.
  const found = codes(TABLE('| id | id | id |', ['| "x" | "y" | "z" |'], 't {id}'));
  assert.deepEqual(found, [Codes.DUPLICATE_TABLE_COLUMN, Codes.DUPLICATE_TABLE_COLUMN]);
});

test('two names each declared twice report once each, in source order', () => {
  const found = codes(TABLE('| a | b | a | b |', ['| "1" | "2" | "3" | "4" |']));
  assert.deepEqual(found, [Codes.DUPLICATE_TABLE_COLUMN, Codes.DUPLICATE_TABLE_COLUMN]);
});

// -- what the refusal must not drag in ---------------------------------------

test('the duplicated name stays in the header, so the data rows are still the right width', () => {
  // The break for decision 2, measured: de-duplicate the header (`columns = [...new Set(columns)]`)
  // and the header is one cell narrower than every row below it, so the `TF072` arrives with a
  // ragged-row `TF010` per data row — one mistake answered with four complaints, in a production
  // M83 spent a milestone quietening.
  const found = codes(TABLE('| a | a |', ['| "x" | "y" |', '| "p" | "q" |', '| "m" | "n" |']));
  assert.deepEqual(found, [Codes.DUPLICATE_TABLE_COLUMN]);
});

test('the table still parses — the test and its steps survive the diagnostic', () => {
  // The other tempting shortcut, also measured: returning `null` from `parseTableColumnName` on a
  // duplicate. `parseTableRow` bails on a `null` cell, which routes into the header-recovery branch
  // that discards the whole table — so the test loses its rows, its columns and (being a
  // `with each` test with nothing to iterate) its reason to exist, over one repeated word.
  const { program } = parseSource(TABLE('| a | a |', ['| "x" | "y" |']));
  assert.equal(program.tests.length, 1);
  const table = program.tests[0]!.table!;
  assert.equal(table.type, 'InlineDataTable');
  assert.deepEqual(table.type === 'InlineDataTable' ? table.columns : [], ['a', 'a']);
  assert.equal(program.tests[0]!.body.length, 2);
});

// -- negative controls -------------------------------------------------------

test('distinct column names are silent', () => {
  assert.deepEqual(codes(TABLE('| a | b |', ['| "x" | "y" |'])), []);
});

test('one column is silent — a set of one has nothing to collide with', () => {
  assert.deepEqual(codes(TABLE('| a |', ['| "x" |'])), []);
});

test('two tables in one file may each declare the same name', () => {
  // The break for decision 3. Hoist `seenColumns` out of `parseDataTable` and this reports.
  const source =
    TABLE('| id |', ['| "x" |'], 'one {id}') + '\n' + TABLE('| id |', ['| "y" |'], 'two {id}');
  assert.deepEqual(codes(source), []);
});

test('a repeated *cell value* is not a repeated column', () => {
  assert.deepEqual(codes(TABLE('| a | b |', ['| "same" | "same" |'])), []);
});

test('a file-backed table has no header here and cannot trip the rule', () => {
  const source = 'with each from "./rows.csv"\ntest "t {a}"\n  api GET /a\n  expect status equals 200\n';
  assert.deepEqual(codes(source), []);
});

test('the header\'s existing quoted-name refusal is untouched — it still discards the table', () => {
  // `M84`/`A2-05`: a quoted header cell returns `null` from `parseTableColumnName` *before* the
  // duplicate branch is reached, and the whole table is discarded by design. The new `seen.add`
  // must not be on that path, or a header of `| "a" | "a" |` would report a duplicate for a table
  // that no longer exists.
  const found = codes(TABLE('| "a" | "a" |', ['| "x" | "y" |']));
  assert.ok(!found.includes(Codes.DUPLICATE_TABLE_COLUMN), found.join(','));
  assert.deepEqual(found, [Codes.UNEXPECTED_TOKEN]);
});

// -- the neighbour it is deliberately not ------------------------------------

test('TF027 still owns an unknown `{col}` in the test name, and the two do not collide', () => {
  assert.deepEqual(codes(TABLE('| a | b |', ['| "x" | "y" |'], 't {c}')), []);
  // …at parse time. `TF027` is the checker's, so assert the split rather than assume it: the
  // parser stays silent about a name it cannot resolve, and `checkDataTables` is what speaks.
  const { program } = parseSource(TABLE('| a | b |', ['| "x" | "y" |'], 't {c}'));
  assert.equal(program.tests[0]!.table!.type, 'InlineDataTable');
});
