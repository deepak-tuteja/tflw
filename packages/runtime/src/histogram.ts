// M31 (PLAN_BROWSER_PERF_SECURITY.md D19, PLAN_REPORTS_PERF_SECURITY.md R4) — the substrate a
// multi-process load generator uses to report percentiles back to the process that merges them.
// Shipping every raw duration over IPC doesn't scale (a 20-minute run at 2k rps is millions of
// samples, R4's own framing); a histogram is a few KB regardless of sample count and merges by
// summing bucket counts — "no message passing" beyond that one small payload (D19).
//
// Values are bucketed to `precision` significant decimal digits (default 3, i.e. ~0.1% relative
// error) — real HDR histograms make the exact same tradeoff for the exact same reason. Percentiles
// therefore carry that bounded rounding error; `min`/`max`/`avg` are tracked as exact running
// scalars alongside the buckets, so those three numbers are never approximated, only the
// percentiles are. This is used uniformly by every `runLoad`/`runLoadShard` scenario accumulator,
// single-process or sharded — single-process runs never need to merge anything, but they pay the
// same (negligible, sub-millisecond-at-typical-latencies) bucketing cost so there is exactly one
// code path for "how does a scenario accumulate durations," not two.

export interface HistogramBucket {
  readonly value: number;
  readonly count: number;
}

export class LatencyHistogram {
  private readonly buckets = new Map<number, number>();
  private sampleCount = 0;
  private sumValue = 0;
  private minValue = Infinity;
  private maxValue = -Infinity;

  constructor(private readonly precision = 3) {}

  record(valueMs: number): void {
    this.sampleCount++;
    this.sumValue += valueMs;
    if (valueMs < this.minValue) this.minValue = valueMs;
    if (valueMs > this.maxValue) this.maxValue = valueMs;
    const bucket = LatencyHistogram.bucketFor(valueMs, this.precision);
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
  }

  /** Rounds `value` to `precision` significant decimal digits — the bucket key every sample of
   * roughly the same magnitude collapses into. `value <= 0` (a 0ms duration is real, e.g. a cached
   * response) buckets to exactly 0, since `log10` is undefined there. */
  static bucketFor(value: number, precision: number): number {
    if (value <= 0) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - precision + 1);
    return Math.round(value / magnitude) * magnitude;
  }

  /** Absorbs every bucket (and the exact running scalars) from `other` into `this`. */
  merge(other: LatencyHistogram): void {
    for (const [bucket, count] of other.buckets) {
      this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + count);
    }
    this.sampleCount += other.sampleCount;
    this.sumValue += other.sumValue;
    if (other.minValue < this.minValue) this.minValue = other.minValue;
    if (other.maxValue > this.maxValue) this.maxValue = other.maxValue;
  }

  get count(): number {
    return this.sampleCount;
  }

  get min(): number {
    return this.sampleCount === 0 ? 0 : this.minValue;
  }

  get max(): number {
    return this.sampleCount === 0 ? 0 : this.maxValue;
  }

  get avg(): number {
    return this.sampleCount === 0 ? 0 : this.sumValue / this.sampleCount;
  }

  /** Exact running sum — the raw scalar `LoadShardScenarioResult.sum` ships across IPC so
   * `fromBuckets` can reconstruct `avg` exactly rather than re-deriving it from a rounded value. */
  get sum(): number {
    return this.sumValue;
  }

  /** Nearest-rank percentile over the bucketed distribution — same method `percentileOf` used on a
   * raw sorted array pre-M31, just walking bucket keys (ascending) and their counts instead of
   * individual samples. */
  percentile(p: number): number {
    if (this.sampleCount === 0) return 0;
    const rank = Math.min(this.sampleCount - 1, Math.floor((p / 100) * this.sampleCount));
    const sortedBuckets = [...this.buckets.entries()].sort((a, b) => a[0] - b[0]);
    let cumulative = 0;
    for (const [value, count] of sortedBuckets) {
      cumulative += count;
      if (cumulative > rank) return value;
    }
    return sortedBuckets[sortedBuckets.length - 1]![0];
  }

  /** Serializable snapshot for shipping across an IPC boundary (`LoadShardScenarioResult`) —
   * ascending by value so a receiving `fromBuckets` reconstructs a histogram whose `percentile()`
   * behaves identically without needing to re-sort. */
  toBuckets(): HistogramBucket[] {
    return [...this.buckets.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
  }

  static fromBuckets(buckets: readonly HistogramBucket[], stats: { readonly count: number; readonly sum: number; readonly min: number; readonly max: number }, precision = 3): LatencyHistogram {
    const h = new LatencyHistogram(precision);
    for (const b of buckets) h.buckets.set(b.value, b.count);
    h.sampleCount = stats.count;
    h.sumValue = stats.sum;
    h.minValue = stats.count === 0 ? Infinity : stats.min;
    h.maxValue = stats.count === 0 ? -Infinity : stats.max;
    return h;
  }
}
