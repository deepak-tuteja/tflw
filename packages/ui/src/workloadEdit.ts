// A workload, as a form holds it — `M224` `B` (`D1205`, `D1208`).
//
// **THIS EXISTS BECAUSE A WORKLOAD STOPPED BEING THE LOAD DOOR'S PROPERTY.** Until `M224` the ten
// workload shapes lived inside `LoadForm`, a staging form that asked which test to attach one to;
// `D1205` makes a workload an ordinary clause of a declaration, live wherever `TF033` allows one.
// So the shape vocabulary, the node-to-form reading and the form-to-spec writing move here, where
// the band editor (`B`) and the plan panel (`C`) can both have them without either owning the
// other.
//
// **THE SCALARS ARE STRINGS, LIKE `ThresholdEdit`'s**, and for its reason: an author types through
// intermediate states that are not yet numbers, and a field that coerces on every keystroke cannot
// be emptied. The conversion happens once, at `workloadSpecOf`, and `buildWorkload` is the one
// thing that judges the result.
import type { Workload } from '@tflw/lang';
import type { WorkloadSpec } from '@tflw/lang';
import type { PlanInput, PlanShape } from './plan';

export type WorkloadShape = PlanShape;

/** The four profiles and the two units the grid crosses — `M213` `S6` (`D1103`), moved out of
 *  `LoadForm` unchanged. The `title` on each is the sentence the old `<select>` spelled inline. */
export const WORKLOAD_PROFILES: ReadonlyArray<readonly [WorkloadShape, string, string]> = [
  ['ramp', 'ramp', 'start at nothing and climb to the target over the duration'],
  ['hold', 'hold', 'be at the target from the first second and stay there'],
  ['step', 'step', 'a staircase — each stage jumps to its level and holds'],
  ['spike', 'spike', 'stages that jump or ramp, mixed — the shape a traffic spike has'],
];

export const WORKLOAD_UNITS: ReadonlyArray<readonly ['users' | 'rps', string, string]> = [
  ['users', 'users', 'closed — this many virtual users, each looping; arrivals depend on how fast the system answers'],
  ['rps', 'rps', 'open — this many arrivals a second regardless of what has finished'],
];

export const WORKLOAD_ITERATION_SHAPES: ReadonlyArray<readonly [WorkloadShape, string, string]> = [
  ['iterations', 'N iterations', 'a fixed amount of work across M users — it ends when the work is done, and how long that takes is the measurement'],
  ['iterations-per-user', 'N per user', 'a fixed amount of work each, across M users'],
];

export interface WorkloadStageEdit {
  readonly mode: 'jump' | 'ramp';
  readonly target: string;
  readonly seconds: string;
}

export interface WorkloadEdit {
  readonly shape: WorkloadShape;
  readonly unit: 'users' | 'rps';
  readonly target: string;
  readonly seconds: string;
  readonly count: string;
  readonly vus: string;
  readonly stages: readonly WorkloadStageEdit[];
}

/** What `+ workload` writes before the author touches anything — `D1213`'s own first line, so the
 *  clause and the scaffold agree about what a workload looks like when nobody has said. */
export const DEFAULT_WORKLOAD: WorkloadEdit = {
  shape: 'ramp',
  unit: 'users',
  target: '5',
  seconds: '2',
  count: '100',
  vus: '2',
  stages: [{ mode: 'jump', target: '10', seconds: '5' }],
};

const seconds = (ms: number): string => String(Math.round(ms / 100) / 10);

/**
 * A workload node, read back as the form that would write it.
 *
 * **Every field of the form is filled, not just the ones this shape uses.** An author who switches
 * a `ramp` to a `step` finds a stage row rather than an empty block, and switching back finds the
 * ramp's own numbers — the alternative is a grid whose cells wipe each other, which is what makes
 * a shape choice feel destructive when it is not.
 */
export function workloadEditOf(node: Workload | null): WorkloadEdit {
  if (node === null) return DEFAULT_WORKLOAD;
  const stagesOf = (stages: Workload extends never ? never : readonly { readonly mode: 'jump' | 'ramp'; readonly target: number; readonly durationMs: number }[]): readonly WorkloadStageEdit[] =>
    stages.map((s) => ({ mode: s.mode, target: String(s.target), seconds: seconds(s.durationMs) }));
  switch (node.type) {
    case 'RampUsersWorkload': return { ...DEFAULT_WORKLOAD, shape: 'ramp', unit: 'users', target: String(node.users), seconds: seconds(node.overMs) };
    case 'RampRpsWorkload': return { ...DEFAULT_WORKLOAD, shape: 'ramp', unit: 'rps', target: String(node.rps), seconds: seconds(node.overMs) };
    case 'HoldUsersWorkload': return { ...DEFAULT_WORKLOAD, shape: 'hold', unit: 'users', target: String(node.users), seconds: seconds(node.forMs) };
    case 'HoldRpsWorkload': return { ...DEFAULT_WORKLOAD, shape: 'hold', unit: 'rps', target: String(node.rps), seconds: seconds(node.forMs) };
    case 'StepUsersWorkload': return { ...DEFAULT_WORKLOAD, shape: 'step', unit: 'users', stages: stagesOf(node.stages) };
    case 'StepRpsWorkload': return { ...DEFAULT_WORKLOAD, shape: 'step', unit: 'rps', stages: stagesOf(node.stages) };
    case 'SpikeUsersWorkload': return { ...DEFAULT_WORKLOAD, shape: 'spike', unit: 'users', stages: stagesOf(node.stages) };
    case 'SpikeRpsWorkload': return { ...DEFAULT_WORKLOAD, shape: 'spike', unit: 'rps', stages: stagesOf(node.stages) };
    case 'SharedIterationsWorkload': return { ...DEFAULT_WORKLOAD, shape: 'iterations', count: String(node.iterations), vus: String(node.vus) };
    case 'PerVuIterationsWorkload': return { ...DEFAULT_WORKLOAD, shape: 'iterations-per-user', count: String(node.iterationsPerVu), vus: String(node.vus) };
  }
}

const ms = (s: string): number => Math.round(Number(s) * 1000);

/** The form, as the spec `buildWorkload` judges. Nothing here validates: an empty field becomes
 *  `NaN`, and `buildWorkload`'s own bounds say so in the form's words. */
export function workloadSpecOf(edit: WorkloadEdit): WorkloadSpec {
  switch (edit.shape) {
    case 'iterations': return { kind: 'iterations', perUser: false, count: Number(edit.count), vus: Number(edit.vus) };
    case 'iterations-per-user': return { kind: 'iterations', perUser: true, count: Number(edit.count), vus: Number(edit.vus) };
    case 'ramp': return { kind: 'ramp', unit: edit.unit, target: Number(edit.target), overMs: ms(edit.seconds) };
    case 'hold': return { kind: 'hold', unit: edit.unit, target: Number(edit.target), forMs: ms(edit.seconds) };
    case 'step':
    case 'spike':
      return {
        kind: edit.shape,
        unit: edit.unit,
        /**
         * **A `step` stage is always a jump, whatever the edit is carrying** — `M225` `C`.
         *
         * `print.ts` states the rule and the parser enforces it: `step`+ramp is no such program.
         * The editor already honours it by drawing a bare `to` instead of the mode select, so a
         * `step` has no control that can set `mode` — but an author who builds a `spike` with a
         * ramped stage and then switches the profile to `step` kept the ramp in the edit, and
         * `buildWorkload` refused the whole clause with *use `spike` for a ramp* against a control
         * that was no longer on screen. A refusal the reader cannot act on is a trap, and this is
         * the form saying what it already shows.
         */
        stages: edit.stages.map((s) => ({ mode: edit.shape === 'step' ? 'jump' as const : s.mode, target: Number(s.target), durationMs: ms(s.seconds) })),
      };
  }
}

/** The same form as the plot's input. One reading of the values, so the picture and the bytes
 *  cannot disagree about what is being written (`D985`). */
export function planInputOf(edit: WorkloadEdit): PlanInput {
  return {
    shape: edit.shape,
    unit: edit.unit,
    target: Number(edit.target),
    seconds: Number(edit.seconds),
    stages: edit.stages.map((s) => ({ mode: s.mode, target: Number(s.target), durationMs: ms(s.seconds) })),
  };
}

/**
 * **How long this workload runs, in the control's own words** — `M224` `E` (`D1212`).
 *
 * `null` is not "unknown": it is the honest answer for the two iteration shapes, **29 of the
 * corpus's 85 workload lines**. They say *run N iterations across M users*, so the run ends when
 * the work is done and how long that takes is the property being measured. Summing a duration for
 * them would put a number on a button that nobody wrote and nobody can predict.
 */
export function workloadSeconds(edit: WorkloadEdit): number | null {
  switch (edit.shape) {
    case 'iterations':
    case 'iterations-per-user':
      return null;
    case 'ramp':
    case 'hold': {
      const n = Number(edit.seconds);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    case 'step':
    case 'spike': {
      let total = 0;
      for (const stage of edit.stages) {
        const n = Number(stage.seconds);
        if (!Number.isFinite(n) || n <= 0) return null;
        total += n;
      }
      return total > 0 ? total : null;
    }
  }
}

// ── The composer's words — `M225` `C`/`D` (`D1219`, `D1220`, `D1222`) ─────────────────────────
//
// **THE COMPOSER WAS THE ONLY THING ON THE PAGE USING THE BROWSER'S NATIVE TOOLTIP.** Measured on
// `.workload-edit` at spike/users, the richest shape: 25 controls, **0 with `data-tip`, 16 with
// `title`, 6 with `aria-label` alone and 3 with nothing at all**. Page-wide the split was 61
// `data-tip` against 16 `title`, and *all sixteen of the titles were in this one block* —
// `D1103`'s grid moved out of `LoadForm` in `M224` `B` carrying its `title` attributes, and the
// page's own tooltip has never applied to it. So the text was not missing; it was delivered by the
// OS, after a ~1s hover, in the OS font, at the pointer.
//
// **And converting the mechanism alone would not have been enough**, which is why this file gained
// words rather than just an attribute name. The eight cells that pick the shape carried
// ``title={`${label} ${u}`}`` — *"spike users"*, the row label and the column label already printed
// beside them: the one control that decides what kind of load this is said the least of anything
// in the block.
//
// Every surface reads from here — the tips, the sentence under the grid, the clause's own label
// and the plan panel's prose. Three surfaces holding their own words is `D1094`'s failure, and
// this project keeps recording it.

/** `users` or `rps`, in the words a reader needs rather than the two the grammar uses. */
const arrivals = (unit: 'users' | 'rps', n: string): string =>
  unit === 'users' ? `${n} users` : `${n} arrivals a second`;

/**
 * **What a cell means, which is not what its row and its column mean separately** (`D1219`).
 *
 * A `spike`×`rps` is not the intersection of two independent facts — it is a traffic spike
 * measured in arrivals, and it behaves nothing like a spike in users. The grid exists *because*
 * the pairing is the thing, so this is eight written sentences and not a template.
 */
export const WORKLOAD_CELL_WHY: Readonly<Record<string, string>> = {
  'ramp:users': 'climb from nothing to N users over a duration — the classic soak ramp. Each user loops, so the request rate is whatever the system can answer.',
  'ramp:rps': 'climb from nothing to N arrivals a second over a duration. The rate is imposed: if the system slows, the queue grows rather than the rate falling.',
  'hold:users': 'N users from the first second, for a duration. The steady state — what a fixed population of clients costs.',
  'hold:rps': 'N arrivals a second from the first second, for a duration. The steadiest of the four, and the one that will overload a system rather than wait for it.',
  'step:users': 'a staircase in users: each stage jumps to its level and holds it. The shape for finding where the knee is.',
  'step:rps': 'a staircase in arrivals a second. Each stage imposes its rate for its own duration, whatever the last one did.',
  'spike:users': 'stages that hold or ramp, mixed, in users — a burst and what follows it.',
  'spike:rps': 'stages that hold or ramp, mixed, in arrivals a second. The shape a real traffic spike has, and the one closed load cannot produce.',
};

/** The tips for everything in the block that is not a shape (`D1219`) — the fields that said what
 *  they *are* and never what they *mean*. */
export const WORKLOAD_FIELD_WHY = {
  count: 'how many iterations in total — the run ends when they are done, and how long that takes is the measurement.',
  countPerUser: 'how many iterations EACH user runs. The total is this times the users beside it.',
  vus: 'how many virtual users share the work. More users finish the same iterations sooner, and contend harder while they do it.',
  target: 'the level this workload climbs to or holds — users or arrivals a second, whichever the column above says.',
  seconds: 'how long, in seconds. For a `ramp` this is the climb; for a `hold` it is the whole run at the target.',
  stageTargetStep: 'the level this stage jumps to and holds.',
  stageTargetSpike: 'the level this stage reaches — held from its first second when it says `hold at`, climbed to over its duration when it says `ramp to`.',
  stageSecondsStep: 'how long this stage holds its level, in seconds. The stages run back to back.',
  stageSecondsSpike: 'how long this stage lasts, in seconds — a hold at its level, or the time it takes to climb there.',
  stageMode: '`hold at` starts the stage at its level; `ramp to` climbs to it from where the last stage left off. A `step` block has no spelling for a ramp, which is why it does not offer one.',
  stageRemove: 'take this stage out. The stages that follow move up; the block keeps its shape.',
  stageAdd: 'another stage, after the last one. A stage list may not be empty, so the last one cannot be removed.',
} as const;

/** `ThresholdRow`'s five controls (`D1219`). A threshold is half of what `TF033` makes a load
 *  test's verdict, and none of this was anywhere on the page. */
export const THRESHOLD_WHY = {
  metric: '`duration` grades how long iterations took; `error rate` grades how many failed. A test carrying a `duration` threshold needs an unscoped `error rate` one beside it (`TF033`) — a fast run that failed everything is not a pass.',
  percentile: 'which percentile of the durations is graded. 95 means *all but the slowest one in twenty*. It reads only the iterations that SUCCEEDED, so it is a statement about the working path.',
  scope: 'a request tag, to grade one request rather than the whole iteration. Empty means the whole test — which is what the `error rate` threshold beside it must be.',
  op: 'which way the bound is read. A duration is almost always `is less than`; an error rate always is.',
  bound: 'the number the metric is held to — milliseconds for a duration, percent for an error rate.',
  remove: 'take this threshold off. A test that carries a `workload` must keep at least one (`TF033`), so the last one refuses.',
} as const;

/**
 * **The language's own spelling of a shape** — `M225` `D` (`D1220`).
 *
 * `[data-band-workload]` used to render `test.workload.type.replace(/Workload$/, '')`, which put
 * **`SpikeUsers`** on screen, lowercased by the stylesheet to `spikeusers`. Not a sentence, not
 * two words, and not what the file it describes actually says.
 *
 * Held to `printWorkload` by a gate rather than by care: every word here occurs, in this order, in
 * the line the printer writes for that shape.
 */
export function workloadWords(shape: WorkloadShape, unit: 'users' | 'rps'): string {
  switch (shape) {
    case 'iterations': return 'run iterations';
    case 'iterations-per-user': return 'run iterations per user';
    default: return `${shape} ${unit}`;
  }
}

/** A stage, in the spelling its block gives it — `print.ts`'s `printStage`, which is context-bound
 *  for a reason worth repeating here: `step`+jump is `to N for <dur>`, `spike`+jump is `hold N for
 *  <dur>`, `spike`+ramp is `to N over <dur>`, and `step`+ramp is no such program. */
function stageWords(shape: WorkloadShape, s: WorkloadStageEdit): string {
  if (shape === 'step' || s.mode === 'jump') return `${s.target} for ${s.seconds}s`;
  return `climbing to ${s.target} over ${s.seconds}s`;
}

/**
 * **What this workload IS, in one line, derived from the edit and not from the saved node**
 * (`D1220`).
 *
 * The edit, so it moves as the author types — the same rule `planInputOf` follows and for `D985`'s
 * reason: one reading of the values, so the picture and the bytes cannot disagree. The plot, this
 * sentence and the printed line are one fact stated three ways.
 *
 * The second half is the distinction the grid exists to teach and no label can carry. The user's
 * own corpus holds the proof: `hold 4 users for 2s` against `/health` did **22,398 iterations**
 * and `hold 15 rps for 2s` did **30** — same duration, same endpoint, three orders of magnitude
 * apart, because one is closed and the other is open.
 */
export function workloadSentenceOf(edit: WorkloadEdit): string {
  const closed =
    edit.unit === 'users' || edit.shape === 'iterations' || edit.shape === 'iterations-per-user'
      ? 'Closed — each user loops, so the system sets the rate.'
      : 'Open — arrivals keep coming at that rate whatever the system is doing.';
  switch (edit.shape) {
    case 'iterations':
      return `${edit.count} iterations in total, shared across ${edit.vus} users. It ends when the work is done, and how long that takes is the measurement.`;
    case 'iterations-per-user':
      return `${edit.count} iterations each, across ${edit.vus} users. It ends when the work is done, and how long that takes is the measurement.`;
    case 'ramp':
      return `From nothing to ${arrivals(edit.unit, edit.target)} over ${edit.seconds}s. ${closed}`;
    case 'hold':
      return `${arrivals(edit.unit, edit.target)} from the first second, for ${edit.seconds}s. ${closed}`;
    case 'step':
    case 'spike': {
      const parts = edit.stages.map((s) => stageWords(edit.shape, s));
      const unit = edit.unit === 'users' ? 'users' : 'arrivals a second';
      return `${parts.join(', then ')} — ${unit}. ${closed}`;
    }
  }
}

/**
 * **The plan panel's own two sentences** — `M225` `F` (`D1222`).
 *
 * It goes beside the plot rather than in the composer because the plot is the thing being
 * explained, and because region 1 is the constrained region (§1.11) while region 2 has the space.
 * It differs by axis, which is the whole of gate 17: a users plan and an rps plan are not the same
 * picture with a different label on it.
 */
export function planProse(shape: WorkloadShape, unit: 'users' | 'rps'): string {
  if (shape === 'iterations' || shape === 'iterations-per-user') {
    return 'No duration is drawn, because there is none to draw: an iteration shape names an amount of work, and how long the work takes is the thing being measured. The height is the users sharing it.';
  }
  return unit === 'users'
    ? 'The height is virtual users — a CLOSED plan. Each user finishes one iteration before it starts the next, so the request rate is whatever the system can answer: if it slows, the plan does too, and the curve above is a population rather than a rate.'
    : 'The height is arrivals a second — an OPEN plan. The rate is imposed on the system rather than negotiated with it, so if it slows, the work queues instead of the plan easing off. This is the shape that overloads, and the one closed load cannot produce.';
}

/**
 * **What this workload DID, cited from this test's own history** — `M225` `E` (`D1221`).
 *
 * **It cites; it never predicts.** An estimate would need a latency nobody has before the run, and
 * a number on this page that is sometimes wrong is worse than one that is sometimes absent
 * (§7). What it can do is show the reader the distinction the grid exists to teach, in the
 * reader's own numbers: the user's corpus has `hold 4 users for 2s` against `/health` at **22,398
 * iterations** and `hold 15 rps for 2s` at **30** — same duration, same endpoint, three orders of
 * magnitude apart, because one is closed and the other is open.
 *
 * Two cases have to read as facts rather than as blanks:
 *
 * - **never run here** — a sentence, not an empty line and not a zero.
 * - **INCONCLUSIVE** — say so, and say every threshold was skipped. This is the case worth the
 *   whole line: `examples/storefront` records `ramp to 20 users` against a body doing no I/O
 *   running **1,053,717 iterations in three seconds**, tflw correctly declaring *itself* the
 *   bottleneck, every threshold `skipped` — and nothing on the page warned before ▶.
 */
export function workloadCitation(run: {
  readonly iterations: number;
  readonly p95Ms: number;
  readonly inconclusive: boolean;
} | null): string {
  if (run === null) return 'not run here yet — ▶ next door runs it and this line fills in.';
  const n = run.iterations.toLocaleString('en-US');
  const p95 = `${Math.round(run.p95Ms * 100) / 100}ms`;
  if (run.inconclusive) {
    return `last run here: ${n} iterations, p95 ${p95} — INCONCLUSIVE. tflw's own generator was the bottleneck, so every threshold was skipped and these numbers describe tflw, not the system.`;
  }
  return `last run here: ${n} iterations, p95 ${p95}.`;
}
