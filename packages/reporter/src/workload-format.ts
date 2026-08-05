// M89b (`B3-03`, D-M89-5) — the one place a `LoadWorkloadReport` becomes text.
//
// There used to be two functions named `describeWorkload` over two different values, and one run
// described itself two contradictory ways five seconds apart:
//
//     scenario "count-based" — run 50 iterations across 2 users
//       ✓ count-based (workload — ramp to 2 users over 0ms)
//
// `cli.ts`'s version switched over all 10 AST kinds and was right; `cli-summary.ts` and `html.ts`
// each hardcoded `ramp to …` because the report type they read had nowhere to put the answer. The
// fix is not a third correct copy: `LoadWorkloadReport` (D-M89-4) carries the shape, and this
// module is the only formatter of it, so the pre-run line and the summary line are the same string
// *by construction*. D-M89-5 rejected "two functions plus a property test that they agree" —
// a test that two things agree is weaker than their being one thing, and this cluster is a
// catalogue of exactly that failure.

import type { LoadWorkloadReport } from '@tflw/runtime';

/** `(closed)`/`(open)` is redundant with the unit for the 8 duration-based kinds (`users` is always
 * closed, `rps` always open) and absent for the 2 count-based ones, which have no open form. It is
 * kept because it is the pre-run line's existing text and because the closed/open distinction —
 * coordinated omission, the back-off diagnostic — is the one thing about a workload a reader most
 * needs in front of them when reconciling a latency number. */
function model(w: Extract<LoadWorkloadReport, { model: string }>): string {
  return ` (${w.model})`;
}

function unit(w: Extract<LoadWorkloadReport, { model: string }>): string {
  return w.model === 'closed' ? 'users' : 'rps';
}

/** Total planned span of a stage list — the sum of the stages' own durations. Display only; the
 * scheduler walks the stages themselves (`stageTargetAt`). */
function totalMs(stages: readonly { readonly durationMs: number }[]): number {
  return stages.reduce((sum, s) => sum + s.durationMs, 0);
}

function peak(stages: readonly { readonly target: number }[]): number {
  return Math.max(...stages.map((s) => s.target));
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** One line describing a workload, for the CLI's pre-run preview, the run summary, and
 * `report.html`'s panel — all three, from this one function. A `step`/`spike` line summarises its
 * stages (count, peak, total span) rather than listing them; the per-stage detail is in
 * `results.json`, which is where a reader who needs it is looking. */
export function describeWorkload(w: LoadWorkloadReport): string {
  switch (w.shape) {
    case 'ramp':
      return `ramp to ${w.target} ${unit(w)} over ${w.overMs}ms${model(w)}`;
    case 'hold':
      return `hold ${w.target} ${unit(w)} for ${w.forMs}ms${model(w)}`;
    case 'step':
      return `step ${plural(w.stages.length, 'stage')} up to ${peak(w.stages)} ${unit(w)} over ${totalMs(w.stages)}ms${model(w)}`;
    case 'spike':
      return `spike ${plural(w.stages.length, 'stage')} up to ${peak(w.stages)} ${unit(w)} over ${totalMs(w.stages)}ms${model(w)}`;
    case 'iterations':
      return w.perVu
        ? `run ${w.iterations} iterations per user across ${w.vus} users`
        : `run ${w.iterations} iterations across ${w.vus} users`;
  }
}
