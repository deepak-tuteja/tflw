// `live.ts` (`M192` U2): the stream reduced is the report. `fixtures/reports/full/events.ndjson`
// and `results.json` beside it were written by one `tflw run`; replaying the one through the
// reducer has to yield the other's tests, or the live pane and the finished view are two accounts
// of a run. A pure test — the page gate (`cli/test/ui-page.test.ts`) covers the wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunEvent, RunReport, TestResult, WorkloadTestResult } from '@tflw/runtime';
import { EMPTY_LIVE, liveCounts, reduceLive } from '../src/live.ts';
import { exitExplained } from '../src/format.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const corpus = join(here, '..', 'fixtures', 'reports', 'full');
const events = readFileSync(join(corpus, 'events.ndjson'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as RunEvent);
const report = JSON.parse(readFileSync(join(corpus, 'results.json'), 'utf8')) as RunReport;

test('the stream replayed through the reducer is results.json: every test, in order, with its steps', () => {
  const live = events.reduce(reduceLive, EMPTY_LIVE);
  assert.equal(live.announced, report.total);
  assert.deepEqual(live.files, [...new Set(report.tests.map((t) => t.file))]);
  // A `test:end`'s result is the report's entry minus what the CLI adds at merge: `file`, which
  // the event carries beside it (and the reducer keeps), and — for the functional kind only —
  // `concurrency`, which a workload result carries on the stream already (U4 found the two kinds
  // differ here). Stated rather than absorbed: a third field appearing on one side and not the
  // other is a contract drift the page should notice.
  assert.equal(live.tests.length, report.tests.length);
  for (let i = 0; i < report.tests.length; i++) {
    const { file, concurrency, ...entry } = report.tests[i] as TestResult | WorkloadTestResult;
    const t = live.tests[i]!;
    assert.equal(t.file, file);
    assert.ok(concurrency !== undefined);
    const { file: _f, concurrency: streamed, ...got } = t.result as TestResult | WorkloadTestResult;
    assert.equal(_f, undefined, 'the stream never carries file on the result');
    if (entry.kind === 'workload') assert.equal(streamed, concurrency);
    else assert.equal(streamed, undefined, 'a functional result gains concurrency only at merge');
    assert.deepEqual(got, entry);
  }
  // Every test ended, so the steps shown are the result's own; before that they were the
  // `step:end`s as they arrived, which for an unretried test are the same list. A workload has
  // no steps and shows none.
  for (const t of live.tests) assert.deepEqual(t.steps, t.result!.kind === 'workload' ? [] : (t.result as TestResult).steps);
  assert.ok(live.tests.some((t) => t.result!.kind === 'workload'), 'the corpus holds the workload kind');
});

test('mid-stream, a test holds the steps that have arrived so far and no result', () => {
  const firstEnd = events.findIndex((e) => e.type === 'test:end');
  const partial = events.slice(0, firstEnd).reduce(reduceLive, EMPTY_LIVE);
  assert.equal(partial.tests.length, 1);
  const t = partial.tests[0]!;
  assert.equal(t.result, null);
  const expected = (report.tests[0] as TestResult).steps;
  assert.equal(t.steps.length, expected.length);
  assert.deepEqual(t.steps, expected);
  // The retried test's `step:end`s are one attempt's each; its `test:end` carries the final
  // attempt's steps, which is what the view then shows.
  const retried = report.tests.find((r) => (r as TestResult).attempts) as TestResult;
  const all = events.reduce(reduceLive, EMPTY_LIVE);
  const shown = all.tests.find((x) => x.name === retried.name)!;
  assert.deepEqual(shown.steps, retried.steps);
  assert.ok(events.filter((e) => e.type === 'step:end' && e.test === retried.name).length > retried.steps.length, 'the stream carried the failed attempt too');
});

test('a passing file hook is work in flight, not a test: shown in the pane and left out of the count (M192 U7)', () => {
  const hookStep = { kind: 'api', source: 'api GET /health', line: 2, ok: true, durationMs: 1 } as unknown as TestResult['steps'][number];
  const stream: RunEvent[] = [
    { type: 'run:start', total: 1, env: 'local', file: 'a.tflw' },
    { type: 'test:start', name: 'before file', file: 'a.tflw' },
    { type: 'test:end', result: { kind: 'functional', name: 'before file', ok: true, durationMs: 1, steps: [hookStep] }, file: 'a.tflw' },
    { type: 'test:start', name: 'the one test', file: 'a.tflw' },
    { type: 'test:end', result: { kind: 'functional', name: 'the one test', ok: false, durationMs: 1, steps: [] }, file: 'a.tflw' },
    // A failing hook enters the report as its own entry (`hooks.test.ts`), so it counts.
    { type: 'test:start', name: 'after file', file: 'a.tflw' },
    { type: 'test:end', result: { kind: 'functional', name: 'after file', ok: false, durationMs: 1, steps: [], error: 'a `after file` hook failed' }, file: 'a.tflw' },
  ];
  const live = stream.reduce(reduceLive, EMPTY_LIVE);
  assert.equal(live.tests.length, 3, 'every pair is shown');
  assert.deepEqual(liveCounts(live), { done: 2, failed: 2 });
  assert.equal(live.announced, 1);
});

test('an exit is explained only by the report verdict that produced it (M192 U7): 0 ok, 1 failed, 3 inconclusive, 130 aborted; anything else, a signal or a cancel is the page\'s to say', () => {
  const done = (exitCode: number | null, signal: string | null = null, status: 'done' | 'cancelled' = 'done') => ({ status, exitCode, signal });
  assert.equal(exitExplained(done(0), { ok: true }), true);
  assert.equal(exitExplained(done(0), { ok: false }), false);
  assert.equal(exitExplained(done(1), { ok: false }), true);
  assert.equal(exitExplained(done(1), { ok: true }), false);
  assert.equal(exitExplained(done(3), { ok: true, inconclusive: true }), true);
  assert.equal(exitExplained(done(3), { ok: true }), false);
  assert.equal(exitExplained(done(130), { ok: true, aborted: true }), true);
  assert.equal(exitExplained(done(130), { ok: true }), false);
  assert.equal(exitExplained(done(2), { ok: true }), false, 'the dogfood: a 326/326 report and exit 2');
  assert.equal(exitExplained(done(null, 'SIGKILL'), { ok: true }), false);
  assert.equal(exitExplained(done(130, null, 'cancelled'), { ok: true, aborted: true }), false, 'a cancel is the page\'s own gesture');
});
