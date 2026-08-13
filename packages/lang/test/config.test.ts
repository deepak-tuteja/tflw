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

// -- M130b/D307/D330: Tier 2's two config additions -------------------------------------------
//
// The goldens above snapshot the whole `authz-declarations` fixture, which proves these parse and
// keeps them from drifting silently. What they cannot state is *which* flag ended up on *which*
// node, and the two ways to get that wrong are both silent: a `privileged` read onto the wrong
// session empties the probe set for a principal nobody exempted, and a `probe mutating` read onto
// the wrong target grants a write somewhere its author did not grant it.

test('D307: `privileged` lands on the session it follows, and on no other', () => {
  const source = 'env local default\n  api "http://x"\n\nsession admin privileged\n  api GET /a\n\nsession peer\n  api GET /a\n';
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    config!.sessions.map((s) => [s.name, s.privileged]),
    [['admin', true], ['peer', false]],
    'a modifier that leaked to the next declaration would exempt a principal nobody wrote it for',
  );
});

test('D307: `privileged` follows `oauth2`, and the sugar body still parses', () => {
  const source = 'env local default\n  api "http://x"\n\nsession svc oauth2 privileged\n  token url "http://x/t"\n  client id env(I)\n  client secret env(S)\n';
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics, []);
  const [svc] = config!.sessions;
  assert.equal(svc!.privileged, true);
  assert.ok(svc!.oauth2, 'the modifier must not consume the block `oauth2` introduces');
});

test('D307: the misordered header costs exactly one diagnostic, and is still read as meant', () => {
  // The recovery is the point. Before it, `endLine()` reported the `oauth2` and then the oauth2
  // body parsed as ordinary steps, so the author also got ``unknown step `token` `` with a
  // did-you-mean of `open` — a second error about a block they had written correctly.
  const source = 'env local default\n  api "http://x"\n\nsession svc privileged oauth2\n  token url "http://x/t"\n  client id env(I)\n  client secret env(S)\n';
  const { config, diagnostics } = parseConfigSource(source);
  assert.equal(diagnostics.length, 1, `expected one diagnostic, got:\n${diagnostics.map((d) => `${d.code}: ${d.message}`).join('\n')}`);
  assert.match(diagnostics[0]!.message, /`privileged` comes after `oauth2`/);
  const [svc] = config!.sessions;
  assert.equal(svc!.privileged, true, 'recovery reads the header as written, so the checker sees the session the author described');
  assert.ok(svc!.oauth2);
});

test('D330: `probe mutating` lands on the declaration it is indented under, and on no other', () => {
  const source =
    'defaults\n' +
    '  authorized target "http://a.test" reason "one"\n' +
    '    probe mutating\n' +
    '  authorized target "http://b.test" reason "two"\n';
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics, []);
  const targets = config!.defaults!.entries.filter((e) => e.type === 'AuthorizedTargetDecl');
  assert.deepEqual(
    targets.map((t) => [t.target.value, t.probeMutating]),
    [['http://a.test', true], ['http://b.test', false]],
    'the sub-clause must not survive into the declaration below it — that would grant a write nobody granted',
  );
});

test('D330: the one-line declaration is unchanged, and a sub-clause is never required', () => {
  // `tflw-acceptance/security/tflw.config:33` and `:40` are on `main` written this way. M130b adds
  // a line beneath the declaration; it does not reformat the declaration.
  const { config, diagnostics } = parseConfigSource('defaults\n  authorized target "https://staging.example.com" reason "contracted window"\n');
  assert.deepEqual(diagnostics, []);
  const [target] = config!.defaults!.entries.filter((e) => e.type === 'AuthorizedTargetDecl');
  assert.equal(target!.reason.value, 'contracted window');
  assert.equal(target!.probeMutating, false);
});
