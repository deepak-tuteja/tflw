// `M165a` — `TF081`, a single-valued config key declared twice in one block (`D829`-`D832`).
//
// `resolveConfig` applies a block's entries in order and most of them assign, so a second
// `timeout step` overwrote the first and nothing anywhere said the first line had been read and
// thrown away. `tflw check` reported *no problems found* on a file with two answers to one question.
//
// What is asserted here is the *rule*: where it fires, where it deliberately does not, and at which
// line. Whether the exempt set is the right set is a different question and is not answered by
// reading — `packages/runtime/test/config-key-arity.test.ts` doubles every one of the seventeen
// config keys, resolves it, and grades this checker's verdict against what the resolver actually
// did with the second declaration (`D830`).
//
// Every test states its negative control (`M92d`), and here the controls are the point: three of the
// five ways this could be wrong are false positives, not misses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, Codes } from '../src/index.js';

const dupes = (source: string) => {
  const { diagnostics } = parseConfigSource(source);
  const other = diagnostics.filter((d) => d.code !== Codes.CONFIG_DUPLICATE_KEY);
  assert.deepEqual(other.map((d) => `${d.code}: ${d.message}`), [], `fixture raised something else:\n${source}`);
  return diagnostics.filter((d) => d.code === Codes.CONFIG_DUPLICATE_KEY);
};

test('a key declared twice in one block is `TF081`, reported at the second line', () => {
  const diags = dupes('defaults\n  timeout step 10s\n  timeout step 30s\n');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'error');
  assert.equal(diags[0].message, 'duplicate config key `timeout step`');
  // The *second* line, which is the one to delete — not the first, and not the block.
  assert.equal(diags[0].span.start.line, 3);
});

test('the hint names the key, the block, and what the second line did to the first', () => {
  const [diag] = dupes('env ci default\n  api "http://a"\n  api "http://b"\n');
  assert.match(diag.hint ?? '', /`env ci` sets `api` once/);
  assert.match(diag.hint ?? '', /discarded without a word/);
});

// `D831` — three declarations of one key are two mistakes. The count is the assertion: a rule that
// reported the *key* rather than the occurrence would give one diagnostic here and read as correct.
test('three declarations report two diagnostics, one per extra occurrence', () => {
  const diags = dupes('defaults\n  workers 1\n  workers 2\n  workers 3\n');
  assert.deepEqual(diags.map((d) => d.span.start.line), [3, 4]);
});

// `D832` — an `env` overriding a `defaults` value is the reason both blocks exist.
test('the same key in `defaults` and in an `env` is not a duplicate', () => {
  assert.deepEqual(dupes('defaults\n  workers 4\n\nenv ci default\n  api "http://a"\n  timeout step 5s\n'), []);
  assert.deepEqual(dupes('defaults\n  timeout step 5s\n\nenv ci default\n  api "http://a"\n  timeout step 9s\n'), []);
});

// Two envs are two blocks, which is the same rule seen from the other side and the case a
// per-*file* `Set` would have got wrong while passing every test above.
test('two `env` blocks each declaring the key is not a duplicate, and each is scoped alone', () => {
  assert.deepEqual(dupes('env ci default\n  api "http://a"\n\nenv stg\n  api "http://b"\n'), []);
  const diags = dupes('env ci default\n  api "http://a"\n\nenv stg\n  api "http://b"\n  api "http://c"\n');
  assert.deepEqual(diags.map((d) => d.span.start.line), [6]);
});

// The sub-keyed pair. `resolveConfig` writes `timeouts[target]` and `services[service]`, so a rule
// keyed on the declaration *kind* would refuse both of these correct configs.
test('`timeout` is keyed per target', () => {
  assert.deepEqual(dupes('defaults\n  timeout step 10s\n  timeout expect 30s\n  timeout wait 60s\n'), []);
  assert.deepEqual(dupes('defaults\n  timeout step 10s\n  timeout expect 30s\n  timeout expect 45s\n').map((d) => d.message), [
    'duplicate config key `timeout expect`',
  ]);
});

test('`api` is keyed per service, and the bare `api` is its own key', () => {
  assert.deepEqual(dupes('env ci default\n  api "http://a"\n  api payments "http://p"\n  api search "http://s"\n'), []);
  assert.deepEqual(dupes('env ci default\n  api "http://a"\n  api payments "http://p"\n  api payments "http://q"\n').map((d) => d.message), [
    'duplicate config key `api payments`',
  ]);
});

// `D830`'s four. Written as three lines each rather than two, because a rule that reported only the
// *second* occurrence would pass a two-line version of this test by arithmetic.
test('the four accumulating keys may be declared as often as a config likes', () => {
  assert.deepEqual(dupes('defaults\n  header "A" is "1"\n  header "B" is "2"\n  header "C" is "3"\n'), []);
  assert.deepEqual(dupes('env ci default\n  api "http://a"\n  allow hosts "a.example"\n  allow hosts "b.example"\n  allow hosts "c.example"\n'), []);
  assert.deepEqual(dupes('defaults\n  redact header "A"\n  redact header "B"\n  redact header "C"\n'), []);
  assert.deepEqual(
    dupes(
      'defaults\n' +
        '  authorized target "https://a.example" reason "self-hosted fixture"\n' +
        '  authorized target "https://b.example" reason "self-hosted fixture"\n' +
        '  authorized target "https://c.example" reason "self-hosted fixture"\n',
    ),
    [],
  );
});

// `teardown` is named on its own because it is the key that arrived in `M157` and was missing from
// the first draft of the exempt/non-exempt split — a milestone that repaired a stale list without
// testing the row it added would be repeating the fault it was written for.
test('`teardown` twice in one block is `TF081`', () => {
  assert.deepEqual(dupes('defaults\n  teardown always\n  teardown never\n').map((d) => d.message), [
    'duplicate config key `teardown`',
  ]);
});

// `log` is two keys under one word, and the parser is what splits them. A rule reading the leading
// keyword would call this a duplicate.
test('`log destination` and `log level` are different keys', () => {
  assert.deepEqual(dupes('defaults\n  log destination console\n  log level warn\n'), []);
  assert.deepEqual(dupes('defaults\n  log destination console\n  log destination html\n').map((d) => d.message), [
    'duplicate config key `log destination`',
  ]);
});

// A `timeout` line may declare several targets at once (`timeout step 10s, expect 30s`), which is the
// one directive in the config dialect that yields a *list* of entries. So a duplicate can live inside
// a single line, where a rule written against lines rather than entries would never look.
test('one `timeout` line repeating a target is still a duplicate', () => {
  assert.deepEqual(dupes('defaults\n  timeout step 10s, expect 30s\n'), []);
  assert.deepEqual(dupes('defaults\n  timeout step 10s, step 30s\n').map((d) => d.message), [
    'duplicate config key `timeout step`',
  ]);
});
