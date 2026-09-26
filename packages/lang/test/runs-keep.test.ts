// `runs keep N` — `M241` `E` (`D1325`): how many runs `tflw ui` keeps, as a top-level config line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource } from '../src/index.js';
import { CONFIG_DIRECTIVES } from '../src/spec-data.js';

const ENV = 'env local default\n  api "http://127.0.0.1:1"\n';

test('`runs keep 3` is a directive, parsed to its number, and absent when not written', () => {
  const { config, diagnostics } = parseConfigSource(`runs keep 3\n${ENV}`);
  assert.deepEqual(diagnostics, []);
  assert.equal(config.runs?.type, 'RunsDecl');
  assert.equal(config.runs?.keep.value, 3);
  assert.ok(!('runs' in parseConfigSource(ENV).config), 'omitted when absent, so no config golden grows a key');
  assert.ok((CONFIG_DIRECTIVES as readonly string[]).includes('runs'), 'and `TF022` names it among the directives');
});

test('the count is a whole number of at least one, written once', () => {
  for (const [line, why] of [
    ['runs keep 0', 'zero runs is a page that forgets every run'],
    ['runs keep 2.5', 'a count is whole'],
    ['runs keep "3"', 'a count is a number, not a string'],
    ['runs keep', 'the number is the line'],
  ] as const) {
    const { diagnostics } = parseConfigSource(`${line}\n${ENV}`);
    assert.ok(diagnostics.some((d) => d.severity === 'error'), `${line} — ${why}`);
  }
  const twice = parseConfigSource(`runs keep 3\nruns keep 4\n${ENV}`);
  assert.ok(twice.diagnostics.some((d) => /duplicate `runs` line/.test(d.message)), 'a config says it once');
  assert.equal(twice.config.runs?.keep.value, 3, 'and the first is the one kept');
  const misspelt = parseConfigSource(`runs kept 3\n${ENV}`);
  assert.ok(misspelt.diagnostics.some((d) => d.severity === 'error'), '`kept` is not the word');
});
