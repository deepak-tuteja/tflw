// `renderMatcherTable`/`renderGeneratorTable` are pure functions of small arrays, so this tests
// them against fixture entries instead of the real ~13-row manifest — fast, and stable against
// future spec-data.ts content edits (same reasoning gen-docs.test.ts already uses for
// `parseSpecToTopics`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain .mjs script, no type declarations
import { renderMatcherTable, renderGeneratorTable, renderDiagnosticsTable } from '../scripts/gen-spec-tables.mjs';

test('renderMatcherTable emits a header row, separator, and one row per entry in order', () => {
  const table = renderMatcherTable([
    { id: 'equals', syntax: '`equals`', appliesTo: 'any value', example: '`expect status equals 201`', status: 'shipped' },
    { id: 'contains', syntax: '`contains`', appliesTo: 'strings, arrays', example: '`expect body.msg contains "x"`', status: 'shipped' },
  ]);
  const lines = table.split('\n');
  assert.equal(lines[0], '| Matcher | Applies to | Example |');
  assert.equal(lines[1], '|---|---|---|');
  assert.equal(lines[2], '| `equals` | any value | `expect status equals 201` |');
  assert.equal(lines[3], '| `contains` | strings, arrays | `expect body.msg contains "x"` |');
  assert.equal(lines.length, 4);
});

test('renderMatcherTable renders an empty array as just the header + separator', () => {
  const table = renderMatcherTable([]);
  assert.equal(table, '| Matcher | Applies to | Example |\n|---|---|---|');
});

test('renderGeneratorTable emits a header row, separator, and one row per entry including family', () => {
  const table = renderGeneratorTable([
    { id: 'unique-email', family: 'unique', syntax: '`unique email`', notes: 'collision-safe', example: '`unique email`' },
    { id: 'random-uuid', family: 'random', syntax: '`random uuid`', notes: 'collisions allowed', example: '`random uuid`' },
  ]);
  const lines = table.split('\n');
  assert.equal(lines[0], '| Family | Generator | Notes | Example |');
  assert.equal(lines[1], '|---|---|---|---|');
  assert.equal(lines[2], '| unique | `unique email` | collision-safe | `unique email` |');
  assert.equal(lines[3], '| random | `random uuid` | collisions allowed | `random uuid` |');
});

test('renderDiagnosticsTable emits a header row, separator, and one row per entry with the code backtick-wrapped', () => {
  const table = renderDiagnosticsTable([
    { code: 'TF001', meaning: 'Lexer: a character that cannot begin any token.', example: '`let y = $oops` → `unexpected character "$"`' },
    { code: 'TF031', meaning: 'Checker: a `request` assertion combined with a response-based one.', example: '`expect request connects` + `expect status equals 200`' },
  ]);
  const lines = table.split('\n');
  assert.equal(lines[0], '| Code | Meaning | Example |');
  assert.equal(lines[1], '|---|---|---|');
  assert.equal(lines[2], '| `TF001` | Lexer: a character that cannot begin any token. | `let y = $oops` → `unexpected character "$"` |');
  assert.equal(lines[3], '| `TF031` | Checker: a `request` assertion combined with a response-based one. | `expect request connects` + `expect status equals 200` |');
});

test('renderDiagnosticsTable renders an empty array as just the header + separator', () => {
  const table = renderDiagnosticsTable([]);
  assert.equal(table, '| Code | Meaning | Example |\n|---|---|---|');
});
