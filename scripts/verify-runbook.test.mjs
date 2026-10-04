// `verify:runbook`'s static half (`M259` `B`): the parts of the gate that need no install, in
// `npm test`. Running the fences needs a packed CLI, the network for `playwright` and a display for
// the browser tests, so that half is its own CI step (`npm run verify:runbook`, and its
// `--self-test`) on the Linux Node 22 job — but a chapter that would fail it **without running
// anything** (an untagged fence, a page missing from the order) is caught here first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { activeText, normalise, outputMatches, pageUnanswered, readChapter, readPublished, walkthroughFiles } from './verify-runbook.mjs';

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

test('`M260`: an output fence of only `…` is a placeholder, refused — it matches every output, an error\'s included', () => {
  const fence = (body) => ['```sh runbook', 'npx tflw check', '```', '', '```text runbook-output', ...body, '```'].join('\n');
  const vacuous = readChapter(fence(['…']), false);
  assert.deepEqual(vacuous.problems.map((p) => [p.line, p.placeholder]), [[5, true]]);
  assert.ok(outputMatches(normalise('…'), normalise('error: anything at all')), 'which is why: `…` alone matches a failure too');
  assert.deepEqual(readChapter(fence(['…', '']), false).problems.length, 1, 'blank lines beside it do not make it a claim');
  assert.deepEqual(readChapter(fence(['…', '12 files checked, no problems found.']), false).problems, [], 'one real line does');
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
  assert.equal(normalise('kept: report/runs/2026-10-01T09-30-14-902Z'), 'kept: report/runs/<time>', 'a kept run\'s directory, milliseconds after a dash');
  assert.equal(normalise('the coffee shelf is on http://127.0.0.1:41873'), 'the coffee shelf is on http://127.0.0.1:<port>');
  // A token whose tail reads as a duration is still one token (`M269`: CI printed `<token><t>`).
  assert.equal(normalise('at http://127.0.0.1:41873/?token=Zq3k-9s (loopback only)'), 'at http://127.0.0.1:<port>/?token=<token> (loopback only)');
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

test('`M261`: a printed page address is asked for its project with its token; no address, no question', async () => {
  assert.equal(await pageUnanswered('opening http://127.0.0.1:4720/order — press Ctrl+C to stop.'), null, 'an address with no token is not a page');
  const files = (q) => (q.url.includes('token=t0k') ? [{ path: 'a.tflw' }] : []);
  const server = createServer((q, r) => r.end(JSON.stringify({ files: files(q) })));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await pageUnanswered(`tflw ui — . at http://127.0.0.1:${port}/?token=t0k (loopback only)`), null);
    assert.match(await pageUnanswered(`at http://127.0.0.1:${port}/?token=other`), /lists no files/, 'the token printed is the token sent');
  } finally {
    server.close();
  }
  assert.match(await pageUnanswered(`at http://127.0.0.1:${port}/?token=t0k`), /did not answer \/api\/project/, 'and a page that is gone is a failure');
});

