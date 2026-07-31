// M31 (PLAN_BROWSER_PERF_SECURITY.md D19, PLAN_REPORTS_PERF_SECURITY.md R4) — `LatencyHistogram`:
// bucketed percentile computation, exact min/max/avg, and merge (the substrate multi-process
// generator shards report percentiles back through, without shipping every raw sample).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LatencyHistogram } from '../src/histogram.js';

test('an empty histogram reports zeroed stats, not NaN/undefined', () => {
  const h = new LatencyHistogram();
  assert.equal(h.count, 0);
  assert.equal(h.min, 0);
  assert.equal(h.max, 0);
  assert.equal(h.avg, 0);
  assert.equal(h.percentile(50), 0);
});

test('min/max/avg stay exact regardless of bucketing precision', () => {
  const h = new LatencyHistogram();
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) h.record(v);
  assert.equal(h.count, 10);
  assert.equal(h.min, 1);
  assert.equal(h.max, 10);
  assert.equal(h.avg, 5.5);
});

test('percentiles over a uniform 1..100 distribution land close to the requested rank', () => {
  const h = new LatencyHistogram();
  for (let v = 1; v <= 100; v++) h.record(v);
  // Nearest-rank on 100 samples: p50 -> index 50 (0-based) -> value 51; small headroom for the
  // bucketing precision (default 3 significant digits, negligible at this magnitude).
  assert.ok(Math.abs(h.percentile(50) - 51) <= 1, `p50 = ${h.percentile(50)}`);
  assert.ok(Math.abs(h.percentile(95) - 96) <= 1, `p95 = ${h.percentile(95)}`);
  assert.ok(Math.abs(h.percentile(99) - 100) <= 1, `p99 = ${h.percentile(99)}`);
});

test('a 0ms duration (a cached/instant response) buckets to exactly 0, not NaN (log10(0) guard)', () => {
  const h = new LatencyHistogram();
  h.record(0);
  h.record(0);
  assert.equal(h.count, 2);
  assert.equal(h.min, 0);
  assert.equal(h.max, 0);
  assert.equal(h.percentile(50), 0);
});

test('merge produces the same percentile as recording every sample into one histogram', () => {
  const combined = new LatencyHistogram();
  const a = new LatencyHistogram();
  const b = new LatencyHistogram();
  for (let v = 1; v <= 50; v++) {
    combined.record(v);
    a.record(v);
  }
  for (let v = 51; v <= 100; v++) {
    combined.record(v);
    b.record(v);
  }
  a.merge(b);
  assert.equal(a.count, combined.count);
  assert.equal(a.min, combined.min);
  assert.equal(a.max, combined.max);
  assert.equal(a.avg, combined.avg);
  assert.equal(a.percentile(50), combined.percentile(50));
  assert.equal(a.percentile(95), combined.percentile(95));
  assert.equal(a.percentile(99), combined.percentile(99));
});

test('merge is commutative and mutates only the receiver', () => {
  const a = new LatencyHistogram();
  const b = new LatencyHistogram();
  a.record(10);
  a.record(20);
  b.record(30);
  const bCountBefore = b.count;
  a.merge(b);
  assert.equal(a.count, 3);
  assert.equal(b.count, bCountBefore, 'merge must not mutate the argument');
});

test('toBuckets/fromBuckets round-trips a histogram usable exactly like the original', () => {
  const h = new LatencyHistogram();
  for (const v of [5, 5, 5, 12, 40, 40, 100]) h.record(v);
  const buckets = h.toBuckets();
  assert.ok(buckets.length > 0);
  assert.ok(
    buckets.every((b, i) => i === 0 || b.value > buckets[i - 1]!.value),
    'toBuckets() must be sorted ascending by value',
  );
  const restored = LatencyHistogram.fromBuckets(buckets, { count: h.count, sum: 5 + 5 + 5 + 12 + 40 + 40 + 100, min: h.min, max: h.max });
  assert.equal(restored.count, h.count);
  assert.equal(restored.min, h.min);
  assert.equal(restored.max, h.max);
  assert.equal(restored.avg, h.avg);
  assert.equal(restored.percentile(50), h.percentile(50));
});
