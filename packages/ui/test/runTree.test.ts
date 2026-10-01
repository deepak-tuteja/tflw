// The Run tab as a tree by verdict — `M257` `B` (`D1409`), as pure functions.
//
// The page gate reads the tree off the served page against the fixture's `results.json`; these hold
// the rules the fixture does not exercise — an inconclusive run, a cancelled one, a skip, a passing
// file hook in the stream, two tests of one name — each a place a plausible rewrite goes wrong
// silently. Every test names its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grouped, headlineOf, openingItem, treeOfLive, treeOfReport, verdictsIn } from '../src/runTree.ts';
import type { ReportEntry, RunReport } from '../src/contract.ts';
import type { LiveTest } from '../src/live.ts';

const fn = (name: string, ok: boolean, extra: Record<string, unknown> = {}): ReportEntry =>
  ({ kind: 'functional', name, ok, durationMs: 5, file: 'tests/a.tflw', steps: [], ...extra }) as ReportEntry;
const load = (name: string, ok: boolean): ReportEntry => ({ kind: 'workload', name, ok, file: 'tests/load.tflw' }) as unknown as ReportEntry;

const report = (tests: readonly ReportEntry[], over: Partial<RunReport> = {}): RunReport =>
  ({ env: 'local', startedAt: '2026-10-01T10:00:00.000Z', durationMs: 3100, total: tests.length, passed: 0, failed: 0, ok: true, tests, ...over }) as RunReport;

test('the tree groups failed · inconclusive · skipped · passed, each in the report’s own order', () => {
  const items = treeOfReport(report([fn('b passes', true), fn('a fails', false), fn('c skipped', true, { skipped: 'not today' }), fn('d fails', false)]));
  assert.deepEqual(
    grouped(items).map(([g, list]) => [g, list.map((i) => i.name)]),
    [
      ['failed', ['a fails', 'd fails']],
      ['skipped', ['c skipped']],
      ['passed', ['b passes']],
    ],
  );
  // NEGATIVE CONTROL: an empty group is absent rather than drawn with a zero.
  assert.equal(grouped(items).some(([g]) => g === 'inconclusive'), false);
});

test('a workload test in a run that cannot vouch for its numbers is inconclusive, whichever way its thresholds went', () => {
  const tests = [load('a load that passed', true), load('a load that failed', false), fn('an assertion', true)];
  const items = treeOfReport(report(tests, { inconclusive: true, ok: false }));
  assert.deepEqual(items.map((i) => i.group), ['inconclusive', 'inconclusive', 'passed'], 'a functional test did not read the generator');
  // NEGATIVE CONTROL: the same tests in a run that CAN vouch for them keep their own verdicts.
  assert.deepEqual(treeOfReport(report(tests)).map((i) => i.group), ['passed', 'failed', 'passed']);
  // And a run cut short is the same case as a saturated one (`R5`).
  assert.equal(treeOfReport(report(tests, { aborted: true })).filter((i) => i.group === 'inconclusive').length, 2);
});

test('two tests of one name in one file are two rows, keyed apart', () => {
  const items = treeOfReport(report([fn('each row', true), fn('each row', false)]));
  assert.equal(new Set(items.map((i) => i.key)).size, 2);
});

test('the headline carries ONE verdict, and a count of zero is not drawn', () => {
  const items = treeOfReport(report([fn('a', false), ...Array.from({ length: 16 }, (_, i) => fn(`p${i}`, true))]));
  const h = headlineOf(items, { cancelled: false, inconclusive: false, running: false });
  assert.deepEqual([h.word, h.count, h.counts], ['FAILED', 1, ['16 passed']]);
  const all = headlineOf(treeOfReport(report([fn('a', true), fn('b', true)])), { cancelled: false, inconclusive: false, running: false });
  assert.deepEqual([all.word, all.count, all.counts], ['PASSED', 2, []]);
  // A cancelled run says so in the verdict's place, whatever its partial counts are (F8).
  assert.equal(headlineOf(items, { cancelled: true, inconclusive: false, running: false }).word, 'CANCELLED');
  // A failed test outranks an inconclusive run: something is known to be wrong.
  assert.equal(headlineOf(items, { cancelled: false, inconclusive: true, running: false }).word, 'FAILED');
  assert.equal(headlineOf(treeOfReport(report([fn('a', true)])), { cancelled: false, inconclusive: true, running: false }).word, 'INCONCLUSIVE');
});

test('`verdictsIn` counts verdicts, not tallies — and the §0 line is three', () => {
  assert.equal(verdictsIn('1 FAILED · 16 passed · 1 inconclusive · 3.1 s'), 1);
  assert.equal(verdictsIn('17 PASSED · 3.1 s'), 1);
  assert.equal(verdictsIn('CANCELLED · 3 passed'), 1);
  // NEGATIVE CONTROL — the headline the plan measured (§0, §7): a verdict, a zero wearing a count,
  // and a bare second verdict.
  assert.equal(verdictsIn('FAIL · 17 tests · 17 passed · 0 failed · env local · inconclusive'), 3);
  // And a headline with no verdict at all is not one verdict either.
  assert.equal(verdictsIn('17 tests · 17 passed'), 0);
});

test('a run opens on its first failure, else its first inconclusive test, else on nothing', () => {
  assert.equal(openingItem(treeOfReport(report([fn('ok', true), fn('bad', false)])))?.name, 'bad');
  assert.equal(openingItem(treeOfReport(report([load('saturated', true), fn('ok', true)], { inconclusive: true })))?.name, 'saturated');
  // NEGATIVE CONTROL: a run that passed opens on no test — it is read by its headline.
  assert.equal(openingItem(treeOfReport(report([fn('ok', true)]))), null);
});

test('a run in flight: a running group first, and a passing file hook is work, not a row', () => {
  const live: LiveTest[] = [
    { file: 'tests/a.tflw', name: 'before file', hook: 'before file', steps: [], result: fn('before file', true) as never },
    { file: 'tests/a.tflw', name: 'done', steps: [], result: fn('done', true) },
    { file: 'tests/a.tflw', name: 'going', steps: [], result: null },
  ];
  assert.deepEqual(treeOfLive(live).map((i) => [i.name, i.group]), [['done', 'passed'], ['going', 'running']]);
  const h = headlineOf(treeOfLive(live), { cancelled: false, inconclusive: false, running: true });
  assert.deepEqual([h.word, h.counts], ['RUNNING', ['1 passed']], 'the running test is the verdict word, not a second count');
  // NEGATIVE CONTROL: a FAILING hook is in the report, so it is a row.
  const failing = [{ ...live[0]!, result: fn('before file', false) as never }];
  assert.equal(treeOfLive(failing).length, 1);
});
