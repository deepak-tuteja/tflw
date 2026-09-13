// `M189b` (`D977`) — `defaults` is merged into EVERY env at run time, not into the default one.
//
// Found by the sibling's need rather than by this repository's: `testFlow-tests`' `C93` plant
// grades `config:directive:defaults` through four `tflw check` legs, and a hand mutation of the
// RUNTIME merge — `if (config.defaults && env.isDefault)` — left all four green, because the
// checker has its own merge and none of the legs runs anything. The same mutation was then
// entered in `scripts/mutate.mjs` (`defaults-merged-for-the-default-env-only`) and this package's
// suite did not kill it either: `config-key-arity.test.ts` resolves through `selectEnv(config, {})`,
// which is the default env every time, and no test here had ever resolved a `defaults` block for
// an env selected by name. Two readers of one construct, and both suites read the one that happens
// to be the default. This is the control that entry now needs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource } from '@tflw/lang';
import { resolveConfig, selectEnv } from '../src/resolve.js';

const SOURCE = [
  'defaults',
  '  header "X-Def" is "shared"',
  '  allow hosts "example.test"',
  '  timeout api 7s',
  '',
  'env one default',
  '  api "http://one.example"',
  '',
  'env two',
  '  api "http://two.example"',
  '',
].join('\n');

const resolvedFor = (flag: string) => {
  const parsed = parseConfigSource(SOURCE);
  assert.deepEqual(parsed.diagnostics, [], 'the fixture must parse clean');
  return resolveConfig(parsed.config, selectEnv(parsed.config, { flag }));
};

test('`defaults` reaches the env that is NOT the default — header, allow hosts and timeout alike (M189b)', () => {
  const two = resolvedFor('two');
  assert.equal(two.apiBaseUrl, 'http://two.example', 'the fixture selected env two, not the default');
  assert.deepEqual(two.headers.map((h) => [h.name, h.service]), [['X-Def', null]], 'the shared header line reached env two');
  assert.deepEqual(two.allowHosts, ['example.test'], 'the shared allow-hosts line reached env two');
  assert.equal(two.timeouts.api, 7000, 'the shared timeout reached env two');
});

test('and the default env sees exactly the same `defaults`, so the two resolutions differ only by what the env blocks say', () => {
  const one = resolvedFor('one');
  const two = resolvedFor('two');
  assert.equal(one.apiBaseUrl, 'http://one.example');
  const shared = ({ apiBaseUrl: _a, envName: _n, ...rest }: ReturnType<typeof resolvedFor>) => rest;
  assert.deepEqual(shared(two), shared(one));
});
