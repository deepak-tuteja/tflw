// M89a (`B3-02`, D-M89-1) — the one place a `LoadThresholdResult`'s numbers become text.
//
// Three sinks rendered a threshold's `actual`/`target`: `cli-summary.ts`, `html.ts`, and
// `junit.ts`. The first two carried byte-identical copies of the units rule; the third
// interpolated the raw number with no units at all. `D-M89-1` widens `actual` to `number | null`
// ("no successful iterations to take a percentile of"), which without this module would mean
// writing that null case out three times, in a milestone whose own subject is two copies of
// `describeWorkload` disagreeing about the same run. Same reasoning as `escape.ts`'s `esc`: the
// risk isn't today's behaviour, it's the day one copy learns something the others don't.
//
// Note this *changes* `junit.xml`'s threshold-failure message, which previously read
// `actual 2 was not less than 100` — it now carries the same units the console and HTML report
// have always shown (`actual 2ms was not less than 100ms`). A human-readable `message` attribute,
// not a machine-read field, and the alternative was a fourth spelling of the same rule.

import type { LoadThresholdResult } from '@tflw/runtime';

/** `error rate` is a 0-1 fraction, every other metric is milliseconds — `label` is the
 * discriminator because it is what `evaluateThresholds` already derives the metric kind into, and
 * `LoadThresholdResult` carries no separate kind field to read instead. */
function isErrorRate(t: LoadThresholdResult): boolean {
  return t.label === 'error rate' || t.label.startsWith('error rate for ');
}

/** `null` means the run produced **no successful iterations**, so there is no percentile to state
 * (D-M89-1). Rendered as words rather than a number precisely so it can't be misread as a fast one:
 * the whole point of the `null` is that `0ms` here would be a passing latency reported by a run
 * where every single request failed. */
export function formatThresholdActual(t: LoadThresholdResult): string {
  if (t.actual === null) return 'no successful iterations';
  return isErrorRate(t) ? `${(t.actual * 100).toFixed(2)}%` : `${Math.round(t.actual)}ms`;
}

export function formatThresholdTarget(t: LoadThresholdResult): string {
  return isErrorRate(t) ? `${(t.target * 100).toFixed(2)}%` : `${t.target}ms`;
}
