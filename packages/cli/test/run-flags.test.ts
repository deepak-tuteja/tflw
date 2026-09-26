// `M241` `D` (`D1324`) — `tflw run`'s flags are one table, and the page reaches them through it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageRunFlags, readRunFlags, RUN_FLAGS } from '../src/run-flags.js';
import { runArgv, runFlagsProblem } from '../src/ui-server.js';

const value = (argv: string[], i: number, flag: string): string => {
  const v = argv[i];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} expects a value`);
  return v;
};
const inline = (arg: string, flag: string): string => arg.slice(flag.length + 1);
const unknown = (arg: string): never => {
  throw new Error(`unknown ${arg}`);
};
const read = (argv: string[]) => readRunFlags(argv, value, inline, unknown);

test('every flag is one row, spelled once, landing on a field of its own', () => {
  assert.equal(new Set(RUN_FLAGS.map((f) => f.flag)).size, RUN_FLAGS.length, 'a flag spelled twice');
  assert.equal(new Set(RUN_FLAGS.map((f) => f.key)).size, RUN_FLAGS.length, 'two flags landing on one field');
  for (const f of RUN_FLAGS) assert.match(f.flag, /^--[a-z][a-z-]*$/, f.flag);
});

test('the table reads the three shapes, both spellings of a value, and refuses what it does not hold', () => {
  const { files, values } = read(['a.tflw', '--bail', '--env', 'ci', '--fail-on=high', '--allow-public-target', 'x.test', '--allow-public-target=y.test', 'b.tflw']);
  assert.deepEqual(files, ['a.tflw', 'b.tflw']);
  assert.equal(values.bail, true);
  assert.equal(values.env, 'ci');
  assert.equal(values.failOnRaw, 'high');
  assert.deepEqual(values.allowPublicTargets, ['x.test', 'y.test'], 'a list flag gathers every occurrence, in order');
  assert.throws(() => read(['--nope']), /unknown --nope/);
  assert.throws(() => read(['--envx', 'a']), /unknown --envx/, 'a prefix of a flag is not the flag');
  assert.throws(() => read(['--bail=yes']), /unknown --bail=yes/, 'a switch takes no value');
  assert.throws(() => read(['--env', '--bail']), /expects a value/, 'a flag is not the value of the one before it');
});

test('the page sets exactly the rows `D1324` names, each under the subject that can spend it', () => {
  const rows = Object.fromEntries(pageRunFlags().map((f) => [f.flag, f.subject]));
  assert.deepEqual(rows, {
    '--seed': 'browser',
    '--now': 'always',
    '--parallel': 'always',
    '--skip-workload': 'workload',
    '--evidence': 'always',
    '--bail': 'always',
    '--browser': 'browser',
    '--fail-on': 'scan',
    '--baseline': 'scan',
  });
  for (const f of pageRunFlags()) assert.ok(f.hint !== undefined && f.hint.length > 0, `${f.flag} has no hint`);
});

test('a request\'s `more…` values become argv from the same rows — a value always inline, so it cannot become a flag', () => {
  const argv = runArgv({ files: ['a.tflw'], flags: { '--bail': true, '--fail-on': 'high', '--now': '--bail', '--skip-workload': false, '--seed': '' } });
  assert.deepEqual(argv, ['run', '--format', 'ndjson', '--no-color', '--now=--bail', '--bail', '--fail-on=high', 'a.tflw']);
  // The CLI reads that argv back to the same values — the round trip is the claim.
  const back = read(argv.slice(1));
  assert.equal(back.values.nowRaw, '--bail');
  assert.equal(back.values.failOnRaw, 'high');
  assert.equal(back.values.bail, true);
});

test('a flag the page was not offered, or in the wrong shape, is refused by name', () => {
  assert.equal(runFlagsProblem(undefined), null);
  assert.equal(runFlagsProblem({ '--bail': true, '--fail-on': 'high' }), null);
  assert.match(runFlagsProblem({ '--format': 'json' })!, /`--format` is not a flag the page can set/);
  assert.match(runFlagsProblem({ '--bail': 'yes' })!, /`--bail` takes true or false/);
  assert.match(runFlagsProblem({ '--now': 'a\nb' })!, /`--now` takes one line of text/);
  assert.match(runFlagsProblem(['--bail'])!, /object of flag to value/);
});
