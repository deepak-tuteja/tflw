// `M160` — latency carries a float; rounding happens at render.
//
// The milestone's own acceptance clauses, as tests. Clause 1 ("a ~0.4 ms response reports a p95
// that is neither 0 nor 1") is the whole point, and clause 5 (a merged sharded run agrees with an
// unsharded one at float precision) is where a silent integer assumption would have hidden.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { roundDurationMs, formatDurationMs } from '../src/duration.js';
import { LatencyHistogram } from '../src/histogram.js';

test('D809 rounds >= 10ms to an integer and < 10ms to two significant digits', () => {
  // >= 10 ms: bit-for-bit what every renderer printed before `M160`, which is why the milestone
  // changes no output at ordinary latencies.
  assert.equal(roundDurationMs(11.74), 12);
  assert.equal(roundDurationMs(28.86), 29);
  assert.equal(roundDurationMs(29.74), 30);
  assert.equal(roundDurationMs(63.66), 64);
  assert.equal(roundDurationMs(21.62377099999999), 22);
  assert.equal(roundDurationMs(1234.5678), 1235);
  // < 10 ms: the range the milestone exists for.
  assert.equal(roundDurationMs(0.37), 0.37);
  assert.equal(roundDurationMs(0.3714), 0.37);
  assert.equal(roundDurationMs(3.27), 3.3);
  assert.equal(roundDurationMs(3.3456), 3.3);
  assert.equal(roundDurationMs(0), 0);
});

test('D809 renders the M154f-13 ladder as measurable numbers, not 1/3/12/30/31/86', () => {
  // The 2026-08-26 ladder against k6. Before `M160` the first rung could only be `0` or `1`.
  const tflw = [0.37, 3.27, 11.74, 28.86, 29.74, 63.66].map(roundDurationMs);
  assert.deepEqual(tflw, [0.37, 3.3, 12, 29, 30, 64]);
});

test('D809 passes NaN/Infinity through rather than coercing a bug to zero', () => {
  assert.ok(Number.isNaN(roundDurationMs(NaN)));
  assert.equal(roundDurationMs(Infinity), Infinity);
});

test('formatDurationMs is roundDurationMs as text, with no unit suffix', () => {
  assert.equal(formatDurationMs(0.37), '0.37');
  assert.equal(formatDurationMs(21.62377099999999), '22');
});

test('acceptance 1: a ~0.4ms sample yields a p95 that is neither 0 nor 1', () => {
  const h = new LatencyHistogram();
  for (let i = 0; i < 1000; i++) h.record(0.37 + (i % 7) * 0.001);
  const p95 = h.percentile(95);
  assert.notEqual(roundDurationMs(p95), 0);
  assert.notEqual(roundDurationMs(p95), 1);
  assert.ok(p95 > 0.36 && p95 < 0.39, `p95 was ${p95}`);
});

test('bucketFor needs no change for sub-millisecond input — it is magnitude-relative', () => {
  // 0.37 buckets to 0.370 exactly as 370 buckets to 370. This is why `M160` is a five-site fix
  // and not a histogram rewrite.
  assert.equal(LatencyHistogram.bucketFor(0.37, 3), 0.37);
  assert.equal(LatencyHistogram.bucketFor(370, 3), 370);
  assert.equal(LatencyHistogram.bucketFor(0.3714, 3), 0.371);
});

test("the histogram's stated 0.5% worst-case error is the error it actually has", () => {
  // The header claimed ~0.1% until `M160`. The bound is half a bucket magnitude over the value,
  // maximised just above a decade boundary.
  let worst = 0;
  for (let v = 1.0; v < 10; v += 0.0001) {
    const b = LatencyHistogram.bucketFor(v, 3);
    worst = Math.max(worst, Math.abs(b - v) / v);
  }
  assert.ok(worst <= 0.005 + 1e-9, `worst relative error ${worst}`);
  assert.ok(worst > 0.004, `bound should be tight, got ${worst}`);
});

test('acceptance 5: a merged sharded histogram matches an unsharded one at float precision', () => {
  const samples: number[] = [];
  for (let i = 0; i < 600; i++) samples.push(0.2 + (i % 97) * 0.037);

  const whole = new LatencyHistogram();
  for (const s of samples) whole.record(s);

  const shards = [new LatencyHistogram(), new LatencyHistogram(), new LatencyHistogram()];
  samples.forEach((s, i) => shards[i % 3]!.record(s));
  // Round-trip each shard through the IPC shape, exactly as a forked worker does.
  const merged = new LatencyHistogram();
  for (const sh of shards) {
    merged.merge(
      LatencyHistogram.fromBuckets(sh.toBuckets(), { count: sh.count, sum: sh.sum, min: sh.min, max: sh.max }),
    );
  }

  assert.equal(merged.count, whole.count);
  for (const p of [50, 90, 95, 99]) {
    assert.equal(merged.percentile(p), whole.percentile(p), `p${p} diverged`);
  }
  assert.ok(Math.abs(merged.sum - whole.sum) < 1e-9);
  assert.equal(merged.min, whole.min);
  assert.equal(merged.max, whole.max);
});

test('rounding bucket keys would destroy them, which is why toBuckets does not', () => {
  // 3-significant-digit buckets are spaced 0.1 apart in [10, 100), so `D809`'s integer rule maps
  // ten distinct buckets onto one. This is the measurement behind that carve-out.
  const keys = new Set<number>();
  for (let v = 10; v < 100; v += 0.05) keys.add(LatencyHistogram.bucketFor(v, 3));
  const rounded = new Set([...keys].map(roundDurationMs));
  assert.ok(keys.size > 800, `expected ~901 distinct keys, got ${keys.size}`);
  assert.ok(rounded.size < 100, `expected collapse to ~91, got ${rounded.size}`);
});

// ---------------------------------------------------------------------------
// `D810` — `expect duration is less than N` compares the float.
//
// Acceptance clause 4. Deterministic on purpose: driving this through a real fixture server would
// mean asking a loopback socket to answer in a specific fraction of a millisecond, which is a
// flaky test pretending to be an end-to-end one. The claim under test is about the *comparison*,
// and the comparison is reachable directly.

import { parseSource } from '@tflw/lang';
import { evalMatcher } from '../src/matcher.js';
import type { EvalCtx } from '../src/eval.js';

function durationMatcher(src: string) {
  const { program } = parseSource(`test "t"\n  api GET /x\n  ${src}\n`);
  const stmt = (program as unknown as { tests: { body: { type: string; matcher: unknown }[] }[] }).tests[0]!.body.find(
    (s) => s.type === 'ExpectStmt',
  )!;
  return stmt.matcher as Parameters<typeof evalMatcher>[2];
}

test('D810: a 0.6ms duration satisfies `is less than 1`, and 1.4ms does not', () => {
  const m = durationMatcher('expect duration is less than 1');
  const ctx = {} as EvalCtx;
  assert.equal(evalMatcher('duration', 0.6, m, ctx).ok, true, 'a 0.6ms response must pass `< 1`');
  assert.equal(evalMatcher('duration', 1.4, m, ctx).ok, false, 'a 1.4ms response must fail `< 1`');
});

test('D810: the inversion this removes — pre-M160 both of those rounded to 1 and both failed', () => {
  // `Math.round(0.6)` is 1, and `1 < 1` is false, so the *faster* response failed the bound it
  // satisfied. That is the surprise `M160` exists to remove; this test pins the old arithmetic so
  // the reason stays legible.
  const m = durationMatcher('expect duration is less than 1');
  const ctx = {} as EvalCtx;
  assert.equal(evalMatcher('duration', Math.round(0.6), m, ctx).ok, false);
  assert.equal(evalMatcher('duration', Math.round(1.4), m, ctx).ok, false);
});
