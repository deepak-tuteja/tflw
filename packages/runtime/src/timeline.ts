// M32 (PLAN_REPORTS_PERF_SECURITY.md R3/R4) — per-second aggregate buckets that drive
// `load-report.html`'s timeline charts (latency-over-time, throughput, error-rate). R4's
// constraint: percentiles cannot be computed from pre-averaged buckets (you can't average p95s),
// so each second's bucket keeps its own small `LatencyHistogram` (a few hundred entries at most,
// M31) rather than just a running sum — cheap enough to keep one per second of a run (a 30-minute
// run is 1800 of these, still a few MB at worst) and it's what lets a `TimelinePoint` report a real
// p50/p95/p99 for that one second, not an approximation of one. `min`/`mean`/`max` are also kept as
// exact running scalars per bucket, mirroring `LatencyHistogram` itself.

import { LatencyHistogram, type HistogramBucket } from './histogram.js';

/** One second's worth of a scenario's (or the combined view's) iterations, ready to plot. */
export interface TimelinePoint {
  /** Seconds since the run started, floored — the bucket key. */
  readonly offsetSeconds: number;
  readonly count: number;
  readonly failures: number;
  /** `count` for this one second — already a rate since the bucket width is exactly 1s. */
  readonly rps: number;
  readonly errorRate: number;
  readonly min: number;
  readonly mean: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** A `TimelinePoint` stripped to what's cheap to ship across a fork's IPC channel (M31-style) —
 * the receiving side's `Timeline.fromBuckets` rebuilds a real `Timeline` (and thus real
 * `TimelinePoint`s) from these. */
export interface SerializedTimelineBucket {
  readonly offsetSeconds: number;
  readonly count: number;
  readonly failures: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly histogram: readonly HistogramBucket[];
}

interface SecondBucket {
  count: number;
  failures: number;
  sum: number;
  min: number;
  max: number;
  readonly histogram: LatencyHistogram;
}

function emptyBucket(): SecondBucket {
  return { count: 0, failures: 0, sum: 0, min: Infinity, max: -Infinity, histogram: new LatencyHistogram() };
}

export class Timeline {
  private readonly buckets = new Map<number, SecondBucket>();

  /** `offsetSeconds` is floored and clamped to >=0 — a duration that completes a hair before the
   * nominal run start (clock skew between `performance.now()` reads) still lands in bucket 0
   * rather than needing a negative-key bucket no chart would ever expect. */
  record(offsetSeconds: number, durationMs: number, ok: boolean): void {
    const key = Math.max(0, Math.floor(offsetSeconds));
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = emptyBucket();
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    if (!ok) bucket.failures++;
    bucket.sum += durationMs;
    if (durationMs < bucket.min) bucket.min = durationMs;
    if (durationMs > bucket.max) bucket.max = durationMs;
    bucket.histogram.record(durationMs);
  }

  /** Absorbs every second-bucket from `other` into `this`, summing overlapping seconds — the same
   * shape `LatencyHistogram.merge` uses, so a multi-process run's timeline merges the same way its
   * histogram does (R4). */
  merge(other: Timeline): void {
    for (const [key, ob] of other.buckets) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = emptyBucket();
        this.buckets.set(key, bucket);
      }
      bucket.count += ob.count;
      bucket.failures += ob.failures;
      bucket.sum += ob.sum;
      if (ob.min < bucket.min) bucket.min = ob.min;
      if (ob.max > bucket.max) bucket.max = ob.max;
      bucket.histogram.merge(ob.histogram);
    }
  }

  /** Chart-ready points, sorted ascending by second. */
  toSeries(): TimelinePoint[] {
    return [...this.buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([offsetSeconds, b]) => ({
        offsetSeconds,
        count: b.count,
        failures: b.failures,
        rps: b.count,
        errorRate: b.count === 0 ? 0 : b.failures / b.count,
        min: b.count === 0 ? 0 : b.min,
        mean: b.count === 0 ? 0 : b.sum / b.count,
        max: b.count === 0 ? 0 : b.max,
        p50: b.histogram.percentile(50),
        p95: b.histogram.percentile(95),
        p99: b.histogram.percentile(99),
      }));
  }

  /** Serializable snapshot for an IPC boundary (mirrors `LatencyHistogram.toBuckets`). */
  toBuckets(): SerializedTimelineBucket[] {
    return [...this.buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([offsetSeconds, b]) => ({
        offsetSeconds,
        count: b.count,
        failures: b.failures,
        sum: b.sum,
        min: b.count === 0 ? 0 : b.min,
        max: b.count === 0 ? 0 : b.max,
        histogram: b.histogram.toBuckets(),
      }));
  }

  static fromBuckets(buckets: readonly SerializedTimelineBucket[]): Timeline {
    const t = new Timeline();
    for (const sb of buckets) {
      const histogram = LatencyHistogram.fromBuckets(sb.histogram, { count: sb.count, sum: sb.sum, min: sb.min, max: sb.max });
      t.buckets.set(sb.offsetSeconds, { count: sb.count, failures: sb.failures, sum: sb.sum, min: sb.min, max: sb.max, histogram });
    }
    return t;
  }
}
