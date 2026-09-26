// `M189b` (`D977`) — three config keys resolve to what they say, held by name.
//
// Three registry entries written for the sibling's never-red plants SURVIVED this suite on the
// box: `scoped-header-loses-its-scope`, `workers-key-pinned-to-one`, `report-key-ignored`. Each
// makes `resolveConfig` return something the config did not say — a scoped header with no service,
// `workers 2` as `1`, `report "artifacts/custom"` as the default — and nothing here had ever read
// those three fields off a resolved config by value. `config-key-arity.test.ts` looks like it
// does: it resolves every key twice and compares the two resolutions to each other, which is a
// measurement of *whether the second declaration wins* and says nothing about what either one
// resolved to. A resolver pinning `workers` to `1` makes both resolutions equal, and the arity
// test's verdict — "the first is discarded, and `TF081` fires" — stays consistent with itself.
// Asserting a function is consistent is not asserting it is right, which this repository has
// written down before and is writing down again with three examples.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, DEFAULT_HELPER_DIRS } from '@tflw/lang';
import { resolveConfig, selectEnv } from '../src/resolve.js';

/** `workers` and `report` are `defaults`-only keys (`TF025`), so the varying lines go there; the
 *  header lines are legal in either block and go there too, for one fixture shape. */
const resolved = (lines: readonly string[]) => {
  const source = [...(lines.length ? ['defaults', ...lines.map((l) => `  ${l}`), ''] : []), 'env local default', '  api "http://one.example"', '  api second "http://two.example"', ''].join('\n');
  const parsed = parseConfigSource(source);
  assert.deepEqual(parsed.diagnostics, [], `the fixture must parse clean:\n${source}`);
  return resolveConfig(parsed.config, selectEnv(parsed.config, {}));
};

test('a `header … for <service>` line resolves WITH its service, and an unscoped one with none (M189b)', () => {
  const r = resolved(['header "X-Every" is "every"', 'header "X-Second" is "second" for second']);
  assert.deepEqual(
    r.headers.map((h) => [h.name, h.service]),
    [['X-Every', null], ['X-Second', 'second']],
    'the scope is the difference between a header on one service and a header on all of them (SPEC §3.2)',
  );
});

test('`workers N` resolves to N — not to the default the flag would apply (M189b)', () => {
  assert.equal(resolved(['workers 2']).workers, 2);
  assert.equal(resolved(['workers 5']).workers, 5);
  assert.equal(resolved([]).workers, 1, 'the control: with no key the resolver gives the default, so the two lines above are the key being read');
});

test('`report "<dir>"` resolves to that directory — not to the default (M189b)', () => {
  assert.equal(resolved(['report "artifacts/custom"']).reportDir, 'artifacts/custom');
  assert.equal(resolved([]).reportDir, './report', 'the control: the default, so the line above is the key being read');
});

test('`helpers` resolves to the declared directories, flattened across lines, and to `DEFAULT_HELPER_DIRS` — the same array — when a config declares none (`M239` `D`, `D1319`)', () => {
  const declared = parseConfigSource('helpers "./lib", "./shared"\nhelpers "./more"\nenv local default\n  api "http://127.0.0.1:1"\n');
  const r = resolveConfig(declared.config, selectEnv(declared.config, { flag: undefined, envVar: undefined }));
  assert.deepEqual(r.helpers, ['./lib', './shared', './more']);
  const none = parseConfigSource('env local default\n  api "http://127.0.0.1:1"\n');
  const d = resolveConfig(none.config, selectEnv(none.config, { flag: undefined, envVar: undefined }));
  assert.equal(d.helpers, DEFAULT_HELPER_DIRS, 'identity, not equality: the checker\'s hint reads it to say "the default"');
  assert.deepEqual([...d.helpers], ['./helpers', './tests/helpers']);
});
