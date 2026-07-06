// AST golden tests + invariants for valid M0 sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';
import { VALID } from './fixtures.js';
import { assertGolden, astJson } from './helpers.js';

for (const fixture of VALID) {
  test(`valid: ${fixture.name} parses with no diagnostics`, () => {
    const { diagnostics } = parseSource(fixture.source);
    assert.deepEqual(
      diagnostics.map((d) => `${d.code}: ${d.message}`),
      [],
      `expected clean parse for ${fixture.name}`,
    );
  });

  test(`valid: ${fixture.name} AST snapshot`, () => {
    const { program } = parseSource(fixture.source);
    assertGolden(`ast/${fixture.name}.json`, astJson(program));
  });
}

test('parses every top-level test', () => {
  const src = VALID.map((f) => f.source).join('\n');
  const { program, diagnostics } = parseSource(src);
  assert.equal(diagnostics.length, 0);
  assert.equal(program.tests.length, VALID.length);
});
