// M32 (PLAN_REPORTS_PERF_SECURITY.md R3/R4) — `Timeline`: per-second bucketing, merge, and the
// IPC round-trip (`toBuckets`/`fromBuckets`) `load-report.html`'s timeline charts are built from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../src/timeline.js';

test('an empty timeline has no points', () => {
  const t = new Timeline();
  assert.deepEqual(t.toSeries(), []);
});

test('records land in the floored second, tracking count/failures/rps/errorRate/min/mean/max', () => {
  const t = new Timeline();
  t.record(0.2, 10, true);
  t.record(0.9, 20, true);
  t.record(0.99, 30, false);
  const series = t.toSeries();
  assert.equal(series.length, 1);
  const p = series[0]!;
  assert.equal(p.offsetSeconds, 0);
  assert.equal(p.count, 3);
  assert.equal(p.failures, 1);
  assert.equal(p.rps, 3);
  assert.equal(p.errorRate, 1 / 3);
  assert.equal(p.min, 10);
  assert.equal(p.max, 30);
  assert.equal(p.mean, 20);
});

test('a negative offset (clock skew right at run start) clamps to bucket 0, not a negative key', () => {
  const t = new Timeline();
  t.record(-0.05, 5, true);
  const series = t.toSeries();
  assert.equal(series.length, 1);
  assert.equal(series[0]!.offsetSeconds, 0);
});

test('points come back sorted ascending by offsetSeconds regardless of record order', () => {
  const t = new Timeline();
  t.record(3, 1, true);
  t.record(1, 1, true);
  t.record(2, 1, true);
  const offsets = t.toSeries().map((p) => p.offsetSeconds);
  assert.deepEqual(offsets, [1, 2, 3]);
});

test('percentiles are computed per-second, not from a pre-averaged bucket (R4)', () => {
  const t = new Timeline();
  for (let v = 1; v <= 100; v++) t.record(0, v, true);
  const p = t.toSeries()[0]!;
  assert.ok(Math.abs(p.p50 - 51) <= 1, `p50 = ${p.p50}`);
  assert.ok(Math.abs(p.p95 - 96) <= 1, `p95 = ${p.p95}`);
});

test('merge sums overlapping seconds and unions non-overlapping ones', () => {
  const a = new Timeline();
  const b = new Timeline();
  a.record(0, 10, true);
  a.record(1, 20, true);
  b.record(0, 30, false);
  b.record(2, 40, true);
  a.merge(b);
  const series = a.toSeries();
  assert.equal(series.length, 3);
  const bySecond = new Map(series.map((p) => [p.offsetSeconds, p]));
  assert.equal(bySecond.get(0)!.count, 2);
  assert.equal(bySecond.get(0)!.failures, 1);
  assert.equal(bySecond.get(1)!.count, 1);
  assert.equal(bySecond.get(2)!.count, 1);
});

test('merge does not mutate its argument', () => {
  const a = new Timeline();
  const b = new Timeline();
  b.record(0, 5, true);
  a.merge(b);
  assert.equal(b.toSeries()[0]!.count, 1, 'merge must not mutate the argument');
});

test('toBuckets/fromBuckets round-trips a timeline usable exactly like the original', () => {
  const t = new Timeline();
  t.record(0, 5, true);
  t.record(0, 15, false);
  t.record(1, 25, true);
  const restored = Timeline.fromBuckets(t.toBuckets());
  assert.deepEqual(restored.toSeries(), t.toSeries());
});

test('a shard missing a second entirely merges fine (union, not intersection)', () => {
  const a = new Timeline();
  a.record(5, 1, true);
  const b = new Timeline();
  b.record(9, 1, true);
  a.merge(b);
  assert.deepEqual(
    a.toSeries().map((p) => p.offsetSeconds),
    [5, 9],
  );
});
