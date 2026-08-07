// Error-message golden tests. The rendered diagnostic output is a reviewed artifact — snapshot
// it so any change to wording, carets, or "did you mean" hints is deliberate (PLAN M0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, renderDiagnostics, renderDiagnostic, displayAnchor } from '../src/index.js';
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

// ---------------------------------------------------------------------------
// M106 (`M98c-01`, D191-D196) — a caret with nothing under it.
//
// A zero-extent span is the norm, not an anomaly: 89% of diagnostics carry one, because "expected
// X, found end of line" points at a position rather than at a lexeme, and almost all of them render
// correctly with the caret one cell past the last character of a real line. The exceptions are the
// ones anchored at end-of-source, where `split('\n')` has manufactured a phantom empty last line out
// of the file's trailing newline.
//
// **The milestone's oracle is that the renderer already agreed with itself in one of two cases.**
// `test "x"\n` and `test "x"` are the same program and produce the same `TF015`, and the second
// already rendered correctly; every author gets the first, because every real `.tflw` ends with a
// newline. So the expected output of these tests is not invented — it is what the no-trailing-
// newline form has always printed.
//
// Measured over every `.tflw` in testFlow-tests plus every line-boundary truncation of each (19,143
// parses): 1,310 round-trip pairs, **800 mismatched before this change and 0 after**, and 957 carets
// re-anchored. The two goldens that moved (`empty-test`, `wait-until-headers-only-no-expect`) had
// the defect checked in.
// ---------------------------------------------------------------------------

/** The `-->` locator of the one diagnostic `source` produces with `code`. Deliberately reads the
 * locator rather than the caret line: D195 makes the two move together, and asserting the locator
 * catches a caret that moved while the `-->` stayed behind — which would print a line number the
 * snippet below it does not show. */
function locatorOf(source: string, code: string): string {
  const { diagnostics } = parseSource(source);
  const diag = diagnostics.find((d) => d.code === code);
  assert.ok(diag, `expected a ${code} for ${JSON.stringify(source)}, got ${diagnostics.map((d) => d.code).join(', ') || 'none'}`);
  return renderDiagnostic(diag, source, { filename: 'x.tflw' }).split('\n')[1]!.trim();
}

test('M106/M98c-01: a trailing newline stops changing where the diagnostic points', () => {
  // The oracle. Each source is rendered with and without its final newline; the two must be
  // identical. They are the same program — the parser produces the same code and the same message
  // for both — and before M106 they printed different line numbers, different snippets and a caret
  // in a different place, because only one of the two had a phantom last line to land on.
  for (const source of [
    'test "x"\n',
    'test "x"\n  api GET\n',
    'test "x"\n  # TODO: add the steps\n',
    'test "x"\n  api POST /o body {\n',
    'test "x"\n  wait until api GET /jobs/1\n    header "A" is "b"\n',
  ]) {
    const bare = source.slice(0, -1);
    const withNewline = parseSource(source).diagnostics;
    const without = parseSource(bare).diagnostics;
    assert.equal(without.length, withNewline.length, `${JSON.stringify(source)}: the two forms must be the same program`);
    for (let i = 0; i < withNewline.length; i++) {
      assert.equal(without[i]!.code, withNewline[i]!.code, `${JSON.stringify(source)}: same diagnostic, index ${i}`);
      assert.equal(
        renderDiagnostic(withNewline[i]!, source, { filename: 'x.tflw' }),
        renderDiagnostic(without[i]!, bare, { filename: 'x.tflw' }),
        `${JSON.stringify(source)}: the trailing newline must not change the rendering of ${withNewline[i]!.code}`,
      );
    }
  }
});

test('M106/D194: the caret lands past the last non-whitespace character of the anchor line', () => {
  // `test "x"` is 8 characters, so the position after it is column 9 — where `newline` already sits
  // when there is no trailing byte to push the anchor past (D159's placement, matched deliberately).
  // Before M106 this read `2:1`, on a line that is not in the file.
  assert.equal(locatorOf('test "x"\n', 'TF015'), '--> x.tflw:1:9');
});

test('M106/D193: the walk-back steps over a comment-only line', () => {
  // The 156-in-957 case. `  # TODO: add the steps` is the last line with any content in the file,
  // and anchoring to it would put the caret past the end of a sentence the author wrote as a note —
  // D159's defect in a new place. The anchor is `test "x"`, column 9, exactly as above.
  assert.equal(locatorOf('test "x"\n  # TODO: add the steps\n', 'TF015'), '--> x.tflw:1:9');
});

test('M106/D193: it steps over a run of blank and comment lines together', () => {
  // Blank, comment, blank, comment — none of them a line the author can be pointed at.
  assert.equal(locatorOf('test "x"\n\n  # one\n\n# two\n\n', 'TF015'), '--> x.tflw:1:9');
});

test('M106/D196: with no code line to fall back to, the position is left alone', () => {
  // The floor. A prefix that is entirely blank and comment lines has nothing to anchor to; the
  // function returns the original position rather than walking off the front of the array. Measured
  // zero times in the corpus and reachable, so it is pinned rather than left to be discovered.
  //
  // Driven through `displayAnchor` directly because no parser rule produces this shape today —
  // which is the point: the guard exists for the input the corpus does not contain.
  const source = '# only a comment\n\n';
  const eof = { offset: source.length, line: 3, column: 1 };
  assert.deepEqual(displayAnchor({ start: eof, end: eof }, source), { line: 3, column: 1 });
});

test('M106/D192: a diagnostic with real extent is never moved — the negative control', () => {
  // `TF049` points *at* a comment, on purpose: a bidi override inside one is the whole finding. Its
  // span has extent, so the zero-extent guard leaves it exactly where the lexer put it. `# rtl ` is
  // 6 characters, so the override sits at column 7 of line 3.
  //
  // **The comment has to come after the code, and the first version of this test did not.** With the
  // comment on line 1 there is nothing to walk back to, so the floor returned the position unmoved
  // and the test passed whether the zero-extent guard was there or not — a control that could not
  // fail, which is the trap M98b/M98c/M98d each shipped one of. Caught by `anchor-ignores-extent`
  // surviving; with the comment last, removing the guard walks this caret onto line 2 and it dies.
  const source = 'test "x"\n  expect status equals 200\n# rtl ‮ here\n';
  assert.equal(locatorOf(source, 'TF049'), '--> x.tflw:3:7');
});

test('M106: a caret already past the end of a real line does not move — the second control', () => {
  // 1,506 of the 2,312 zero-extent spans in the corpus are this shape, and every one of them was
  // already right: `  api GET` is 9 characters, so "expected a path" points at column 10, one past
  // the `T`. The line has code on it, so the walk-back never starts. If this moves, the change is
  // not the one that was intended and the whole golden corpus is wrong.
  assert.equal(locatorOf('test "x"\n  api GET\n', 'TF010'), '--> x.tflw:2:10');
});

test('M106/D194b: trailing whitespace does not carry the caret past the end of the code', () => {
  // The counterexample the oracle turned up. `test "x"   ` puts `eof` at `posAt(n)` — three cells
  // into the spaces — while the same file with a final newline re-anchors and trims them, so the two
  // forms disagreed even after the walk-back existed. Both are column 9 now: `test "x"` is 8
  // characters and the code ends there whatever follows it.
  assert.equal(locatorOf('test "x"   \n', 'TF015'), '--> x.tflw:1:9');
  assert.equal(locatorOf('test "x"   ', 'TF015'), '--> x.tflw:1:9');
});

test('M106: a re-anchored caret is exactly one cell wide', () => {
  // `displayAnchor` only ever moves a zero-extent span, so there is no width to carry over — and
  // `end.column` belongs to the line the caret just left. Without that guard the caret line is
  // filled from the anchor column to the *span's* column, which belongs to a different line.
  //
  // **Reaching it needs trailing whitespace, and the first version of this test did not have any.**
  // `layoutLine` clamps a caret that runs off the end of the rendered line, so the excess width was
  // invisible whenever the anchor line was the shorter of the two — which it is unless the anchor
  // column stops short of the line's own length. Trailing spaces are what make that possible (D194b
  // trims them out of the column but leaves them in the line), and they are invisible in an editor,
  // so this is a file shape a user reaches without knowing it. Caught by `anchor-caret-width`
  // surviving the first version.
  const source = 'test "x"' + ' '.repeat(30) + '\n  # a comment that is long';
  const diag = parseSource(source).diagnostics.find((d) => d.code === 'TF015')!;
  const rendered = renderDiagnostic(diag, source, { filename: 'x.tflw' });
  const carets = rendered.split('\n').find((l) => l.includes('^'))!.match(/\^+/)![0];
  assert.equal(carets.length, 1, `expected a single caret, got:\n${rendered}`);
});
