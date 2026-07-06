// Error-message golden tests. The rendered diagnostic output is a reviewed artifact — snapshot
// it so any change to wording, carets, or "did you mean" hints is deliberate (PLAN M0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, renderDiagnostics } from '../src/index.js';
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
