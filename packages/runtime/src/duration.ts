// `M160` (`D809`) — the one place a duration becomes text or JSON.
//
// `D807` made latency an unrounded float at the five precision-critical measurement sites, which
// is what a histogram, a `threshold pNN` and an `expect duration` all need. It is emphatically not
// what a reader needs: `(21.62377099999999ms)` is a worse answer than `(22ms)`, and a machine
// consumer diffing two runs must not see `12.000000001 !== 12`.
//
// So rounding moves to the boundary and happens exactly once, here. The rule is scale-relative,
// because the whole point of the milestone is that the interesting numbers are small:
//
//   - `>= 10 ms` -> integer. Nothing below the first decimal matters at that scale, and this is
//     bit-for-bit what every renderer printed before `M160`, which is why the milestone changes no
//     output above 10 ms.
//   - `< 10 ms`  -> two significant digits (`0.37`, `3.3`). Two is deliberate: it is enough to
//     distinguish a 0.37 ms runner-overhead floor from a 0.4 ms one, and few enough that the
//     digits it prints are digits the measurement actually supports.
//
// **The JSON report carries this value, not the raw float** (`D809`). Reproducibility of the
// reported number is worth more than the last three digits to the only consumers that read it —
// the sibling's perf bands are exactly such a consumer — and the raw value remains available to
// anyone reading the histogram directly.
//
// Bucket keys are floats now and carry visible representation noise (11.74 buckets to
// 11.700000000000001; see `histogram.ts`'s header), so a percentile is a prime caller here.

/** `D809`'s rounding rule, as a number. `NaN`/`Infinity` pass through untouched — a duration is
 * never either, and silently coercing one to `0` would hide the bug that produced it. */
export function roundDurationMs(ms: number): number {
  if (!Number.isFinite(ms)) return ms;
  if (Math.abs(ms) >= 10) return Math.round(ms);
  if (ms === 0) return 0;
  // Two significant digits. `toPrecision` then `Number` drops the exponent form `toPrecision`
  // produces below 1e-6, which no duration reaches but which would render as `3.7e-7` if it did.
  return Number(Number(ms).toPrecision(2));
}

/** `D809`'s rounding rule, as the text a reader sees. No unit suffix — callers own that, because
 * they differ (`(23ms)`, `23 ms`, a bare table cell). */
export function formatDurationMs(ms: number): string {
  return String(roundDurationMs(ms));
}
