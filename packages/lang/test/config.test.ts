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

// -- A2-12: `report` keeps its `StringLit`, like every sibling path directive (M74) -------------
//
// `parseReportDecl` wrote `dir: dir.value`, discarding the literal — and with it the string's
// `parts`, so an interpolation was gone before anything downstream could see it. `ast.ts` is
// re-exported wholesale from `index.ts`, which meant `ReportDecl.dir: string` was about to freeze
// as public API with that door shut. Every other path directive keeps the literal.

test('A2-12: `report` carries a StringLit, not a flattened string', () => {
  const { config, diagnostics } = parseConfigSource('defaults\n  report "./report"\nenv local default\n  api "http://x"\n');
  assert.deepEqual(diagnostics, []);
  const report = config!.defaults!.entries.find((e) => e.type === 'ReportDecl');
  assert.ok(report && report.type === 'ReportDecl');
  assert.equal(report.dir.type, 'StringLit');
  assert.equal(report.dir.value, './report');
});

test('A2-12: an interpolation in `report` survives into the AST, as it does for every sibling', () => {
  // Not a claim that it *resolves* — no config path interpolates today; `web "http://{HOST}"`
  // flattens to `.value` in `resolveConfig` exactly the same way. The point is that `report` was
  // the one directive where the information was destroyed at parse time, so the option could never
  // be taken later without a breaking change to an exported type.
  const source = 'defaults\n  report "./out-{BUILD_ID}"\nenv local default\n  api "http://x"\n  web "http://{HOST}:5173"\n';
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics, []);

  const report = config!.defaults!.entries.find((e) => e.type === 'ReportDecl');
  assert.ok(report && report.type === 'ReportDecl');
  const web = config!.envs[0]!.entries.find((e) => e.type === 'WebDecl');
  assert.ok(web && web.type === 'WebDecl');

  const interpNames = (lit: { parts: readonly { kind: string; ref?: readonly { name?: string }[] }[] }) =>
    lit.parts.filter((p) => p.kind === 'interp').map((p) => p.ref?.[0]?.name);

  assert.deepEqual(interpNames(report.dir), ['BUILD_ID'], '`report` must keep its interpolation, same as `web` keeps its own');
  assert.deepEqual(interpNames(web.url), ['HOST']);
});
