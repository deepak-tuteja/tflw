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
