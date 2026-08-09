// `M114` (review row `M111-01`) — the one place `RunReport.ok` is decided, and the half of `FU-07`
// that `M111` deliberately left open.
//
// `M111` made the three sinks a *person* reads honest about a run that never reached a verdict: the
// console badge, `report.html`'s header, and `junit.xml`'s `<skipped/>` thresholds. It left the
// machine-readable ones alone — and those are the ones CI actually branches on. Measured on the
// `FU-07` repro before this milestone, an aborted run's `report/results.json` and its `run:end`
// ndjson event both read `{"ok": true, "passed": 1, "failed": 0, "aborted": true}`: the field named
// for "did this pass" handed back a clean pass off a run cut short at 0s of a 4s plan.
//
// **The decision (`M111-01`): `ok` means "this run passed", not "nothing that ran failed".** The
// narrow statement is not lost — `failed === 0` says exactly that, beside `total`, where a reader is
// already looking. What had no field at all was the thing `ok` is *named* for. A run with no verdict
// is therefore `ok: false`, and `aborted`/`inconclusive` — already first-class in `results.json` —
// say which kind of no-verdict it was.
//
// **Three of the row's own reasons for filing rather than folding in did not survive measurement.**
// The row said flipping `ok` would "either change that ordering's meaning or make two fields
// disagree in the opposite direction", and that the change "touches … `tflw run --failed`'s state
// file":
//
//  1. *The exit-code ladder is untouched.* `runCommand` checks `aborted` then `inconclusive` then
//     `ok`, so `ok` was already consulted only after both — the ladder picks *which* non-zero code,
//     and every exit code is byte-identical before and after this milestone (130 aborted, 3
//     inconclusive, 1 failed, 0 clean). Nothing about the ordering's meaning changed.
//  2. *`ok: false` beside `failed: 0` is not a disagreement.* It reads "this run did not pass, and
//     no test failed", which is precisely what an abort is. The pair only looked contradictory while
//     `ok` was a synonym for `failed === 0`, which is the thing being fixed.
//  3. *`tflw run --failed` never read this field.* `.last-run.json` is built from `TestResult.ok`
//     (`reporter/src/last-run.ts`), one entry per failing *test*; the aborted repro writes
//     `{"failed":[]}` before and after this change. That claim was wrong when it was filed.
//
// And a fourth thing turned up only by running the sibling cause rather than reading it: the console
// badge printed a green `PASS 1/1 passed` over an **inconclusive** run. `runBadgeText` special-cased
// `aborted` alone while `junit.xml` — through `noVerdictReason` — marked both of that run's
// thresholds `<skipped/>`. The two sinks `M111` unified disagreed about one of the two reasons it
// unified them for. `runBadgeText` now renders both, from this module's answer.

import type { RunReport } from './types.js';

/** Why this run — and every threshold in it — carries no verdict. */
export type NoVerdictReason = 'aborted' | 'inconclusive';

/**
 * `'aborted'`, `'inconclusive'`, or `null` when this run's results mean what they say.
 *
 * Abort outranks inconclusive, matching the exit-code priority `runCommand` already applies
 * (`aborted > inconclusive > ok`) — a run that was cut short never gathered the sample a saturation
 * reading would describe, so the abort is the more basic fact about it.
 *
 * Takes the two fields rather than a whole `RunReport` so a report still being assembled can ask.
 */
export function noVerdictReason(report: Pick<RunReport, 'aborted' | 'inconclusive'>): NoVerdictReason | null {
  if (report.aborted) return 'aborted';
  if (report.inconclusive) return 'inconclusive';
  return null;
}

/**
 * Stamp `ok` from the rest of the report. **The only derivation of `RunReport.ok` in the tool** —
 * all three producers end with this call (`runProgram`'s own report,
 * `spliceLoadReportIntoRunReport`'s merged one, and the CLI's cross-file `mergeReports`), so a run
 * cannot acquire a verdict from the path it happened to take.
 *
 * That is not a stylistic preference. `spliceLoadReportIntoRunReport` is precisely where `aborted`
 * and `inconclusive` arrive *after* `ok` was already computed, and where a per-producer copy of this
 * rule would have been forgotten — it is the reason this is a function and not three expressions.
 */
export function finalizeVerdict(report: RunReport): RunReport {
  const ok = noVerdictReason(report) === null && report.tests.every((t) => t.ok);
  return ok === report.ok ? report : { ...report, ok };
}
