// M123 — the summary parse, tested. It has been wrong three times and was never covered once.
import assert from 'node:assert/strict';
import test from 'node:test';

import { countsByWorkspace, failedTestNames, stripAnsi, summaryCount } from './reporter-summary.mjs';

const ESC = String.fromCharCode(27);
/** node:test's spec reporter under `FORCE_COLOR` — the shape that defeated both consumers. */
const coloured = (line) => `${ESC}[34m${line}${ESC}[39m`;

const PLAIN_SPEC = ['ℹ tests 925', 'ℹ pass 925', 'ℹ fail 0', 'ℹ cancelled 0'].join('\n');
const PLAIN_TAP = ['# tests 925', '# pass 925', '# fail 0', '# cancelled 0'].join('\n');
const COLOURED_SPEC = PLAIN_SPEC.split('\n').map(coloured).join('\n');

test('summaryCount reads both reporters', () => {
  for (const [label, text] of [
    ['spec', PLAIN_SPEC],
    ['tap', PLAIN_TAP],
  ]) {
    assert.equal(summaryCount(text, 'tests'), 925, label);
    assert.equal(summaryCount(text, 'fail'), 0, label);
  }
});

test('summaryCount reads a summary the environment has coloured — the M115-01 regression', () => {
  // Not a Node-version difference, which is what the row said for four milestones and what its
  // "confirmed on Fedora under Node 22" observation appeared to prove. Same Node, same command,
  // one variable: `FORCE_COLOR` in the caller's environment. The Mac's terminal exports it; ssh to
  // the box does not forward it, so the box could never have shown this.
  assert.equal(summaryCount(COLOURED_SPEC, 'pass'), 925);
  assert.equal(summaryCount(COLOURED_SPEC, 'fail'), 0);
});

test('summaryCount says `undefined` for a summary that is not there, never a number', () => {
  // `mutate.mjs` used to return -1 here — a count that cannot occur, that no caller checked, and
  // that printed as "(-1 failing)" in the one message a red baseline gets. "The suite reported
  // zero failures" and "the suite reported nothing" are different facts about different runs.
  assert.equal(summaryCount('the suite crashed before it could report', 'fail'), undefined);
  assert.equal(summaryCount(PLAIN_SPEC, 'fail'), 0);
});

test('summaryCount does not match a summary line quoted mid-sentence', () => {
  // The anchor is load-bearing: a test whose *name* contains the words would otherwise be counted.
  assert.equal(summaryCount('ok 3 - prints ℹ fail 7 when the run is red', 'fail'), undefined);
});

test('countsByWorkspace attributes each summary to the workspace npm announced', () => {
  const out = [
    '> @tflw/lang@0.1.0 test',
    coloured('ℹ tests 925'),
    '> @tflw/reporter@0.1.0 test',
    coloured('ℹ tests 106'),
  ].join('\n');
  assert.deepEqual(countsByWorkspace(out), { '@tflw/lang': 925, '@tflw/reporter': 106 });
});

test('countsByWorkspace ignores a summary printed before any workspace header', () => {
  assert.deepEqual(countsByWorkspace('ℹ tests 12\n> @tflw/lang@0.1.0 test\nℹ tests 925'), { '@tflw/lang': 925 });
});

test('failedTestNames names the tests from either reporter, deduplicated', () => {
  const tap = 'not ok 1 - a name\nnot ok 2 - another\nnot ok 3 - a name';
  const spec = `${coloured('✖ a name (1.20ms)')}\n✖ another (0.30ms)`;
  assert.deepEqual(failedTestNames(tap), ['a name', 'another']);
  assert.deepEqual(failedTestNames(spec), ['a name', 'another']);
});

test('stripAnsi leaves ordinary text alone, including bracketed text that is not an escape', () => {
  assert.equal(stripAnsi('a [34m b [0m c'), 'a [34m b [0m c');
  assert.equal(stripAnsi(`${ESC}[34ma${ESC}[39m`), 'a');
});
