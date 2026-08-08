// `M111` (review row `FU-07`) — one answer to "did this run reach a verdict?", shared by all three
// sinks so they cannot disagree about it.
//
// The console badge was computed from `report.ok` alone, and `report.ok` means "nothing that ran
// failed" — a true statement that is not the same statement as "this run passed". A workload run
// Ctrl-C'd at 6s of 30s therefore printed `PASS 1/1 passed` with a green `✓`, and said `⚠ aborted`
// four lines below, where a skimming human or a log-scraping CI job never reaches. `report.html`
// rendered the same green `PASS`. `junit.xml` was the worst of the three: `tests="1" failures="0"`,
// with the abort recorded only in a custom `<property>` that no standard JUnit consumer reads — so
// the artifact CI actually gates on said the run was clean.
//
// Measured on the `FU-07` repro, the deepest version of the conflation is one line further down:
// the *threshold* ticked green. `TF033`'s own help text says a workload-bearing test's verdict
// "comes only from its `threshold` lines against the run's aggregate metrics" — so a threshold
// evaluated over 6 seconds of a 30-second plan is not a lenient verdict, it is a verdict about a
// run that did not happen. Exit code 130 was right the whole time; only the reports were wrong.
//
// **R11 already decided this exact question one cause over.** An `inconclusive` run — tflw's own
// generator saturated — marks every threshold `<skipped/>` rather than passed, "not just the ones
// that happened to fail". An abort invalidates thresholds for the same reason (the sample is not
// the sample that was planned), so it gets the same treatment rather than a new one, and this
// module is where the two stopped being separate code.

import type { RunReport } from '@tflw/runtime';

/** Why this run's workload thresholds carry no verdict. */
export type NoVerdictReason = 'aborted' | 'inconclusive';

/**
 * `'aborted'`, `'inconclusive'`, or `null` when the run's thresholds mean what they say.
 *
 * Abort outranks inconclusive, matching the exit-code priority `runCommand` already applies
 * (`aborted > inconclusive > ok`) — a run that was cut short never gathered the sample that a
 * saturation reading would describe, so the abort is the more basic fact about it.
 */
export function noVerdictReason(report: RunReport): NoVerdictReason | null {
  if (report.aborted) return 'aborted';
  if (report.inconclusive) return 'inconclusive';
  return null;
}

/** Why a threshold carries no verdict, in the one wording every sink uses. */
export function noVerdictMessage(reason: NoVerdictReason, report: RunReport): string {
  if (reason === 'aborted') {
    return `this run was aborted (${report.abortedMessage ?? 'stopped before its planned duration elapsed'}) — thresholds were evaluated against a partial sample, so they carry no verdict`;
  }
  return "tflw's own generator process saturated during this run — results are inconclusive";
}

/**
 * The word at the top of the summary. `ABORTED` is a third state on purpose: a run cut short did
 * not pass and did not fail, and collapsing it into either is the defect `FU-07` filed. It is
 * rendered in the same red as `FAIL` because the one thing it definitely is not is a green run.
 */
export function runBadgeText(report: RunReport): 'PASS' | 'FAIL' | 'ABORTED' {
  if (report.aborted) return 'ABORTED';
  return report.ok ? 'PASS' : 'FAIL';
}
