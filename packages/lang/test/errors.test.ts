// Error-message golden tests. The rendered diagnostic output is a reviewed artifact — snapshot
// it so any change to wording, carets, or "did you mean" hints is deliberate (PLAN M0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, renderDiagnostics, renderDiagnostic } from '../src/index.js';
import { INVALID } from './fixtures.js';
import { assertGolden } from './helpers.js';

for (const fixture of INVALID) {
  test(`invalid: ${fixture.name} reports diagnostics`, () => {
    const { diagnostics } = parseSource(fixture.source);
    assert.ok(diagnostics.length > 0, `expected at least one diagnostic for ${fixture.name}`);
  });

  test(`invalid: ${fixture.name} error snapshot`, () => {
    const { diagnostics } = parseSource(fixture.source);
    const rendered = renderDiagnostics(diagnostics, fixture.source, { filename: `${fixture.name}.tflw` });
    assertGolden(`errors/${fixture.name}.txt`, rendered);
  });
}

test('recovery reports more than one error in a file', () => {
  const fixture = INVALID.find((f) => f.name === 'recovers-and-continues')!;
  const { diagnostics } = parseSource(fixture.source);
  assert.ok(diagnostics.length >= 2, `expected recovery to surface multiple diagnostics, got ${diagnostics.length}`);
});

// ---------------------------------------------------------------------------
// M98a (`A1-08`, D147-D151) — the caret is placed in terminal cells, not code units.
//
// Before M98a the renderer spent `Position.column` (a UTF-16 code-unit column) as if it were a
// display column, so every caret under a tab, a CJK run or a combining mark was misaligned by
// exactly the difference between the two units.
//
// **The expected cell is hand-computed in each test's comment, never recomputed from the
// implementation's own width table.** A test that measured the rendered line with `cellWidth` would
// agree with a wrong renderer as readily as a right one and prove nothing.
//
// The whole golden corpus was checked before this landed: the four goldens containing non-ASCII
// carry it only in help text, never in a rendered source line, so none of them exercised this and
// none of them moves. That is why the bug survived — every golden is ASCII in the one position that
// matters — and it is why a golden that *does* move from here on is a regression signal.
// ---------------------------------------------------------------------------

/** The caret's 0-based terminal cell, measured from the first cell of the rendered source text.
 * Both the source line and the caret line carry the same `N | ` gutter, so it cancels. */
function caretCell(rendered: string): number {
  const lines = rendered.split('\n');
  const sourceLine = lines.find((l) => /^\s*\d+ \|/.test(l))!;
  const caretLine = lines.find((l) => l.includes('^'))!;
  const gutter = sourceLine.indexOf('| ') + 2;
  return caretLine.indexOf('^') - gutter;
}

/** Render the `TF001` a stray `$` produces on line 2 of `source`. */
function renderStrayDollar(source: string): string {
  const { diagnostics } = parseSource(source);
  const diag = diagnostics.find((d) => d.code === 'TF001')!;
  assert.ok(diag, 'expected the stray `$` to produce a TF001');
  return renderDiagnostic(diag, source, { filename: 'width.tflw' });
}

test('M98a/A1-08: a tab before the error does not push the caret left', () => {
  //   `  log` = 4 cells, tab advances to the next 8-stop → 8, `"x"` → 11, space → 12, `$` at 12.
  // The machine column is 10, which is what the old renderer used: ~2 cells short here, and ~7
  // short in the finding's repro where the tab sat in a wider run.
  const rendered = renderStrayDollar('test "s"\n  log\t"x" $y\n');
  assert.equal(caretCell(rendered), 12);
  // Tabs are expanded in the printed line (D150), so the caret and the `$` now share an index —
  // the rendered geometry no longer depends on the reader's tab stops.
  const sourceLine = rendered.split('\n').find((l) => /^\s*\d+ \|/.test(l))!;
  const caretLine = rendered.split('\n').find((l) => l.includes('^'))!;
  assert.equal(caretLine.indexOf('^'), sourceLine.indexOf('$'));
  assert.doesNotMatch(sourceLine, /\t/, 'the raw tab must not survive into the rendered line');
});

test('M98a/A1-08: a wide CJK run before the error does not push the caret left', () => {
  //   `  log "` = 7 cells, 日本語 is 3 code units but 6 cells → 13, `"` → 14, space → 15, `$` at 15.
  // The machine column is 13 (3 units for 3 characters), so the old caret landed 2 cells early.
  const rendered = renderStrayDollar('test "s"\n  log "日本語" $y\n');
  assert.equal(caretCell(rendered), 15);
});

test('M98a/A1-08: a combining mark occupies no cell', () => {
  //   `  log "` = 7 cells, `e` → 8, U+0301 combines onto it and adds nothing → 8, `"` → 9,
  // space → 10, `$` at 10. The machine column is 12 — 2 units for what a reader sees as one
  // character plus its accent — so the old caret landed 2 cells late.
  const rendered = renderStrayDollar('test "s"\n  log "é" $y\n');
  assert.equal(caretCell(rendered), 10);
});

test('M98a/A1-08: an astral emoji is the case where both coordinates already agreed', () => {
  //   `  log "` = 7 cells, 🚀 is 2 code units *and* 2 cells → 9, `"` → 10, space → 11, `$` at 11.
  // Recorded deliberately: this input was in the finding's measurement table and it is the one
  // shape that renders correctly under the *old* code too, because a surrogate pair happens to
  // cost the same in both units. It is a coincidence, not coverage — it is here so nobody later
  // reads the finding's emoji row as the regression test, and so the width table's astral branch
  // has an input that reaches it.
  const rendered = renderStrayDollar('test "s"\n  log "🚀" $y\n');
  assert.equal(caretCell(rendered), 11);
});

test('M98a: an all-ASCII diagnostic renders exactly as before — the negative control', () => {
  // The control for the whole milestone. If the display layer changes anything about a plain ASCII
  // line, every golden in the corpus is wrong and the change is not the one that was intended.
  //
  // Mutation-tested, per M97d's lesson: reverting `layoutLine` to `' '.repeat(column - 1)` leaves
  // *this* test green and fails the three cases above; removing the tab expansion alone fails only
  // the tab case. Each control fails for its own single fault, which is the property a control has
  // to have to be worth its name.
  const rendered = renderStrayDollar('test "s"\n  log "x" $y\n');
  assert.equal(caretCell(rendered), 10); //   `  log "x" ` = 10 cells, `$` at 10 = column 11 - 1.
});

test('M59/A1-01: a diagnostic on a very long line renders a bounded window, with the caret still on target', () => {
  // A distinctive character at the offending column, so the caret's alignment can be asserted
  // directly rather than recomputed from window arithmetic in the test.
  const long = 'x'.repeat(400) + 'Z' + 'x'.repeat(49_599);
  const rendered = renderDiagnostic(
    { code: 'TF001', severity: 'error', message: 'unexpected character "Z"', span: { start: { offset: 400, line: 1, column: 401 }, end: { offset: 401, line: 1, column: 402 } } },
    long,
  );
  // The rendered line used to be the whole 50 KB source line plus 400 spaces of caret padding —
  // per diagnostic, which is what made a file of unreadable bytes quadratic. Bounded output is the
  // fix; a caret that still points at the right character is the property that must survive it.
  assert.ok(rendered.length < 1_000, `expected a bounded render, got ${rendered.length} chars`);
  const caretLine = rendered.split('\n').find((l) => l.includes('^'))!;
  const sourceLine = rendered.split('\n').find((l) => /^\s*1 \|/.test(l))!;
  assert.ok(sourceLine.includes('\u2026'), 'a truncated line must say it was truncated');
  assert.equal(caretLine.indexOf('^'), sourceLine.indexOf('Z'), 'the caret must sit under the offending character inside the window');
});
