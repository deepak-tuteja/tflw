// Config-dialect golden tests: AST snapshots for valid tflw.config, error snapshots for invalid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, renderDiagnostics } from '../src/index.js';
import { CONFIG_INVALID, CONFIG_VALID } from './fixtures.js';
import { assertGolden, astJson } from './helpers.js';

for (const fixture of CONFIG_VALID) {
  test(`config valid: ${fixture.name} parses clean`, () => {
    const { diagnostics } = parseConfigSource(fixture.source);
    assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), []);
  });

  test(`config valid: ${fixture.name} AST snapshot`, () => {
    const { config } = parseConfigSource(fixture.source);
    assertGolden(`config/${fixture.name}.json`, astJson(config as never));
  });
}

for (const fixture of CONFIG_INVALID) {
  test(`config invalid: ${fixture.name} reports diagnostics`, () => {
    const { diagnostics } = parseConfigSource(fixture.source);
    assert.ok(diagnostics.length > 0, `expected a diagnostic for ${fixture.name}`);
  });

  test(`config invalid: ${fixture.name} error snapshot`, () => {
    const { diagnostics } = parseConfigSource(fixture.source);
    const rendered = renderDiagnostics(diagnostics, fixture.source, { filename: 'tflw.config' });
    assertGolden(`config-errors/${fixture.name}.txt`, rendered);
  });
}
