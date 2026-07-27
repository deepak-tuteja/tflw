// `tflw migrate` (P#38, decision 45's 1.0-gate deliverable): mechanical rewrite engine for
// checker-flagged deprecations. No real deprecation exists yet (the grammar has been
// additive-only since the first release) — these tests prove the engine itself is correct against
// synthetic diagnostics, the same "thin but real, proven by a fixture rather than a live grammar
// change" scope this milestone's acceptance findings called for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';
import { collectMigrations, applyMigrations } from '../src/migrate.js';
import type { Diagnostic } from '../src/diagnostic.js';
import type { Position, Span } from '../src/token.js';

function pos(offset: number): Position {
  // line/column are unused by collectMigrations/applyMigrations (offset-only splicing) — filled
  // with placeholder values so the `Position` shape is satisfied without computing real ones.
  return { offset, line: 1, column: offset + 1 };
}

function span(start: number, end: number): Span {
  return { start: pos(start), end: pos(end) };
}

function deprecated(start: number, end: number, replacement: string): Diagnostic {
  return {
    code: 'TF999',
    severity: 'warning',
    message: 'deprecated (test fixture)',
    span: span(start, end),
    deprecation: { replacement },
  };
}

function ordinary(start: number, end: number): Diagnostic {
  return { code: 'TF010', severity: 'error', message: 'unrelated (test fixture)', span: span(start, end) };
}

test('collectMigrations turns a deprecation-tagged diagnostic into a span edit with the original text captured', () => {
  const source = 'expect status equal 200\n';
  //                            ^^^^^ offsets 14..19 = "equal"
  const diags = [deprecated(14, 19, 'equals')];
  const edits = collectMigrations(diags, source);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0], { start: 14, end: 19, oldText: 'equal', newText: 'equals' });
});

test('diagnostics without a `deprecation` payload are silently skipped, not an error', () => {
  const source = 'expect status equals 200\n';
  const diags = [ordinary(0, 6), deprecated(7, 13, 'code')];
  const edits = collectMigrations(diags, source);
  assert.equal(edits.length, 1);
  assert.equal(edits[0]!.oldText, 'status');
});

test('applyMigrations splices a single edit correctly', () => {
  const source = 'expect status equal 200\n';
  const edits = collectMigrations([deprecated(14, 19, 'equals')], source);
  assert.equal(applyMigrations(source, edits), 'expect status equals 200\n');
});

test('collectMigrations sorts edits widest-first (descending start) so applying them in order never invalidates an earlier offset', () => {
  const source = 'AAAA BBBB CCCC\n';
  // Two edits, deliberately constructed out of source order.
  const diags = [deprecated(10, 14, 'DDDD'), deprecated(0, 4, 'ZZZZ')];
  const edits = collectMigrations(diags, source);
  assert.deepEqual(
    edits.map((e) => e.start),
    [10, 0],
  );
  assert.equal(applyMigrations(source, edits), 'ZZZZ BBBB DDDD\n');
});

test('a real deprecation round-trip: the migrated source reparses cleanly through the real parser', () => {
  // A real, fully valid `.tflw` file — migrate must work against real source, not just abstract
  // strings. Simulates a deprecation that renames a locator's own text (a made-up rename, purely
  // to exercise the pipeline end to end against a real parseable file both before and after).
  const source = 'test "x"\n  click button "Old Label"\n  expect status equals 200\n';
  const before = parseSource(source);
  assert.deepEqual(before.diagnostics, []);

  const idx = source.indexOf('Old Label');
  const diags = [deprecated(idx, idx + 'Old Label'.length, 'New Label')];
  const migrated = applyMigrations(source, collectMigrations(diags, source));
  assert.equal(migrated, 'test "x"\n  click button "New Label"\n  expect status equals 200\n');

  const after = parseSource(migrated);
  assert.deepEqual(after.diagnostics, [], `migrated source must still parse cleanly:\n${migrated}`);
});
