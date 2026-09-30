// The verdict index as a pure function (`M255` `A`, `D1404`, `D1414`).
//
// The page gate reads the fixture's kept runs through the served page; this holds the rules the
// fixture happens not to exercise — a renamed test, a verdict that went green, a crawl, a run that is
// not ok with nothing failed — because each is a rule a plausible rewrite would get wrong silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOf, markKey, verdictIndex } from '../src/verdicts';
import type { HistoryView, ProjectView, ReportDir } from '../src/contract';

type Row = { name: string; lenses?: ProjectView['files'][number]['tests'][number]['lenses'] };
const file = (path: string, tests: Row[], crawls: Row[] = []): ProjectView['files'][number] => ({
  path,
  actions: [],
  imports: [],
  diagnostics: 0,
  errors: 0,
  warnings: 0,
  crawls: crawls.map((c, i) => ({ name: c.name, line: 100 + i, lenses: c.lenses ?? ['scan'], sessions: [] })),
  tests: tests.map((t, i) => ({ name: t.name, tags: [], line: i + 1, workload: false, lenses: t.lenses ?? ['api'], sessions: [], steps: { api: 1, browser: 0, load: 0, scan: 0 } })),
});

const project = (files: ProjectView['files']): ProjectView => ({
  configured: true,
  root: '/p',
  version: { version: '0.0.0-test', source: 'dev', commit: null, dirty: null, builtAt: null },
  envs: [],
  reportDir: './report',
  helpers: [],
  runFlags: [],
  files,
  traceViewer: false,
  scratchPath: '.scratch.tflw',
  scratchIgnored: true, playScratch: '.play.tflw', playIgnored: true,
  scratchEtag: null,
  authorization: { envName: 'local', targets: [], apiBaseUrl: null, services: [], sessions: [] },
  webBaseUrl: null,
});

const past = (file: string, name: string, verdicts: ('pass' | 'fail' | 'skip')[], last: string): HistoryView['tests'][number] => ({
  file, name, verdicts, last, failures: verdicts.filter((v) => v === 'fail').length, flaky: false,
});

const p = project([
  file('tests/orders.tflw', [{ name: 'an order is placed' }, { name: 'an order is read' }, { name: 'an order is renamed' }]),
  file('tests/shop.tflw', [{ name: 'the shop greets' }], [{ name: 'the shop is crawled' }]),
  file('shared/root.tflw', []),
]);

/** Newest first: `r3` is a Send's scratch run and holds none of these tests — the case that made
 *  the index per test (§8.3 #11). */
const history: HistoryView = {
  runs: ['r3', 'r2', 'r1'],
  tests: [
    past('tests/orders.tflw', 'an order is placed', ['fail', 'pass'], 'r2'),
    // Failed once, passes now: not failing — pytest's `--lf` rule (`D1414`).
    past('tests/orders.tflw', 'an order is read', ['pass', 'fail'], 'r2'),
    // The old name of `an order is renamed`: a verdict about a declaration that no longer exists.
    past('tests/orders.tflw', 'an order was renamed', ['fail'], 'r1'),
    past('./tests/shop.tflw', 'the shop greets', ['skip'], 'r2'),
    past('tests/shop.tflw', 'the shop is crawled', ['fail'], 'r1'),
    past('.scratch.tflw', 'an order is placed', ['pass'], 'r3'),
  ],
  thresholds: [],
};
const reports: ReportDir[] = [
  { id: 'r3', path: 'report/runs/r3', at: '2026-09-30T10:00:00.000Z', artefacts: [], tests: [], summary: { ok: true, total: 1, passed: 1, failed: 0 } },
];

test('a test’s verdict is its newest in the kept runs — a newer run that did not hold it changes nothing', () => {
  const ix = verdictIndex(p, history, reports);
  assert.deepEqual(ix.test('tests/orders.tflw', 'an order is placed'), { verdict: 'fail', run: 'r2', flaky: false });
  assert.equal(ix.test('tests/orders.tflw', 'an order is read').verdict, 'pass');
  // A `./` on either side is the same file (`ran.ts`'s `sameFile` reason).
  assert.equal(ix.test('tests/shop.tflw', 'the shop greets').verdict, 'skip');
  // Renamed: no verdict under the new name, and the old one is not borrowed (§6 prediction 2).
  assert.deepEqual(ix.test('tests/orders.tflw', 'an order is renamed'), { verdict: 'not-run', run: null, flaky: false });
  // The scratch run's same-named test is a different file, so it is not this test's verdict.
  assert.notEqual(ix.test('tests/orders.tflw', 'an order is placed').run, 'r3');
});

test('`failed` is the tests whose newest verdict failed — crawls too, and never a test that has since passed', () => {
  const ix = verdictIndex(p, history, reports);
  assert.deepEqual([...ix.failed].sort(), [markKey('tests/orders.tflw', 'an order is placed'), markKey('tests/shop.tflw', 'the shop is crawled')].sort());
  // Only the project's own rows: the renamed test's old name failed, and nothing in the project is it.
  assert.equal(ix.failed.has(markKey('tests/orders.tflw', 'an order was renamed')), false);
});

test('a file rolls its tests up — failed over passed over skipped over not run — and counts each', () => {
  const ix = verdictIndex(p, history, reports);
  assert.deepEqual(ix.file(p.files[0]!), { verdict: 'fail', passed: 1, failed: 1, skipped: 0, notRun: 1 });
  assert.deepEqual(ix.file(p.files[1]!), { verdict: 'fail', passed: 0, failed: 1, skipped: 1, notRun: 0 });
  assert.deepEqual(ix.file(p.files[2]!), { verdict: 'not-run', passed: 0, failed: 0, skipped: 0, notRun: 0 });
  const green = verdictIndex(p, { ...history, tests: [past('tests/orders.tflw', 'an order is read', ['pass'], 'r2')] }, reports);
  assert.equal(green.file(p.files[0]!).verdict, 'pass', 'one passed and two never ran reads as passed, with the count in the tip');
  const skipped = verdictIndex(p, { ...history, tests: [past('tests/shop.tflw', 'the shop greets', ['skip'], 'r2')] }, reports);
  assert.equal(skipped.file(p.files[1]!).verdict, 'skip');
});

test('the newest run is history’s first, with the run list’s time and summary: fail, inconclusive, pass', () => {
  assert.equal(verdictIndex(p, null, reports).newest, null, 'no history, no run');
  const at = (summary: ReportDir['summary']) => verdictIndex(p, history, [{ ...reports[0]!, summary }]).newest;
  assert.deepEqual(at({ ok: true, total: 1, passed: 1, failed: 0 }), { id: 'r3', at: '2026-09-30T10:00:00.000Z', verdict: 'pass', failed: 0, total: 1 });
  assert.equal(at({ ok: false, total: 3, passed: 2, failed: 1 })?.verdict, 'fail');
  // Not ok and nothing failed: a saturated generator or a run cut short (`M114`'s `ok`).
  assert.equal(at({ ok: false, total: 3, passed: 3, failed: 0 })?.verdict, 'inconclusive');
  assert.equal(at(null)?.verdict, 'inconclusive', 'a run with no results.json has no verdict to claim');
});

test('the head line’s age is coarse on purpose', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');
  assert.equal(ageOf('2026-09-30T11:59:30.000Z', now), 'just now');
  assert.equal(ageOf('2026-09-30T11:55:00.000Z', now), '5 min ago');
  assert.equal(ageOf('2026-09-30T09:00:00.000Z', now), '3 h ago');
  assert.equal(ageOf('2026-09-23T12:00:00.000Z', now), '7d ago');
  assert.equal(ageOf('', now), '');
});
