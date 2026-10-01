// `verify:runbook`'s static half (`M259` `B`): the parts of the gate that need no install, in
// `npm test`. Running the fences needs a packed CLI, the network for `playwright` and a display for
// the browser tests, so that half is its own CI step (`npm run verify:runbook`, and its
// `--self-test`) on the Linux Node 22 job — but a chapter that would fail it **without running
// anything** (an untagged fence, a page missing from the order) is caught here first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activeText, normalise, outputMatches, readChapter, readPublished, walkthroughFiles } from './verify-runbook.mjs';

test('every walkthrough chapter exists, is in the order, and has no untagged shell fence (`D1416`)', () => {
  const { listed, unlisted } = walkthroughFiles();
  assert.ok(listed.length >= 2, 'the walkthrough lists its chapters');
  assert.deepEqual(unlisted, [], 'a page under runbook/start/ that the order leaves out is never run');
  const published = readPublished();
  let steps = 0;
  for (const file of listed) {
    const ch = readChapter(readFileSync(file, 'utf8'), published);
    assert.deepEqual(ch.problems, [], file);
    steps += ch.steps.length;
  }
  assert.ok(steps > 0, 'and there is something to run');
});

test('an untagged fence is a problem, a manual one is counted, and an output fence binds to the command before it', () => {
  const page = ['```sh runbook-manual', 'git clone x', '```', '', '```sh runbook', 'echo hi', '```', '', '```text runbook-output', 'hi', '```', '', '```sh', 'tflw run', '```'].join('\n');
  const ch = readChapter(page, false);
  assert.deepEqual(ch.manual, [{ line: 1 }]);
  assert.deepEqual(ch.steps, [{ line: 5, source: 'echo hi', background: false, expected: 'hi' }]);
  assert.deepEqual(ch.problems.map((p) => p.line), [13]);
  // An output fence with no command before it is a problem, not an assertion about nothing.
  assert.deepEqual(readChapter('```text runbook-output\nhi\n```', false).problems.map((p) => p.line), [1]);
});

test('only the `<Published>` twin the flag selects is read, and line numbers stay the file\'s', () => {
  const page = 'a\n<Published :when="false">\n\n```sh runbook\nbefore\n```\n\n</Published>\n\n<Published>\n\n```sh\nafter\n```\n\n</Published>\n';
  const before = readChapter(page, false);
  assert.deepEqual([before.steps.map((s) => s.source), before.problems], [['before'], []]);
  assert.equal(before.steps[0].line, 4);
  const after = readChapter(page, true);
  assert.deepEqual([after.steps, after.problems.map((p) => p.line)], [[], [12]]);
  assert.equal(activeText(page, false).split('\n').length, page.split('\n').length);
});

test('the normalisations take what differs between two honest runs, and nothing else', () => {
  assert.equal(
    normalise('\x1b[32mPASS\x1b[0m 32/32 passed · env local · seed 81723 · now 2026-10-01T12:00:03.123Z · 2712 ms  \n'),
    'PASS 32/32 passed · env local · seed <seed> · now <time> · <t>',
  );
  assert.equal(normalise('12:34:35.653 PASS 35/35 passed'), '<clock> PASS 35/35 passed');
  assert.equal(normalise('the coffee shelf is on http://127.0.0.1:41873'), 'the coffee shelf is on http://127.0.0.1:<port>');
  assert.equal(normalise('wrote /tmp/x/reader/report/report.html', ['/tmp/x/reader']), 'wrote <dir>/report/report.html');
  assert.equal(normalise('tflw 0.1.0 · Node v22.11.0'), 'tflw <version> · Node v<node>');
  // Counts are the claim, never normalised: "32 tests" must stay 32.
  assert.equal(normalise('12 files, 37 tests, 18 in a browser'), '12 files, 37 tests, 18 in a browser');
});

test('`…` is any run of lines, including none; every other line must match exactly', () => {
  assert.ok(outputMatches('a\n…\nd', 'a\nb\nc\nd'));
  assert.ok(outputMatches('a\n…\nd', 'a\nd'));
  assert.ok(outputMatches('…\nlast', 'npm noise\nmore\nlast'));
  assert.ok(!outputMatches('a\nd', 'a\nb\nd'), 'without `…`, an extra line is a difference');
  assert.ok(!outputMatches('a\n…\nd', 'a\nb\ne'), 'and `…` does not excuse the line after it');
  assert.ok(!outputMatches('1 file checked', '2 files checked'));
});
