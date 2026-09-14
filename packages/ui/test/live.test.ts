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
import { EMPTY_LIVE, reduceLive } from '../src/live.ts';

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
