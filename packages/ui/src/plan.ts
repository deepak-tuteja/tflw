// The workload a LOAD test is composing, as points on a clock — `M213` `S6` (`D1103`).
//
// **A LOAD TOOL EXISTS TO SHOW A SHAPE OF WORK OVER TIME, AND NEITHER PANE SHOWED ONE.** The form
// had a `<select>` naming six shapes and a second one naming two units, and the only way to find
// out what `spike` with four stages actually looks like was to run it. `Workload.tsx` has plotted
// four charts of a *finished* run since `M192`; what was missing is the same picture before the
// run, from the workload being written.
//
// **THE PLANNED CURVE IS COMPUTED FROM THE FORM'S OWN VALUES AND NOTHING ELSE**, which is what
// makes it a projection of the file rather than a second account of it (`D985`, one construct
// over). Every branch below is a reading of `buildWorkload`'s own spec, so a shape this cannot
// draw is a shape the builder cannot construct.

/** The form's six shapes, as `LoadForm` names them. */
export type PlanShape = 'iterations' | 'iterations-per-user' | 'ramp' | 'hold' | 'step' | 'spike';

export interface PlanStage {
  readonly mode: 'jump' | 'ramp';
  readonly target: number;
  readonly durationMs: number;
}

export interface PlanInput {
  readonly shape: PlanShape;
  readonly unit: 'users' | 'rps';
  readonly target: number;
  readonly seconds: number;
  readonly stages: readonly PlanStage[];
}

/** One point of the planned curve: seconds since the run starts, and the level at that moment. */
export interface PlanPoint {
  readonly at: number;
  readonly level: number;
}

/**
 * The curve, or `null` for a shape that has no time axis.
 *
 * **`iterations` and `iterations-per-user` return `null`, and that is the honest answer rather
 * than a missing feature.** They say *run N iterations across M users* — the run ends when the
 * iterations are done, and how long that takes is a property of the system under test, which is
 * the thing being measured. Drawing a flat line to an invented right-hand edge would put a
 * duration on the chart that nobody wrote and nobody can predict. The pane says so instead.
 */
export function plannedCurve(input: PlanInput): readonly PlanPoint[] | null {
  switch (input.shape) {
    case 'iterations':
    case 'iterations-per-user':
      return null;
    /* **A ramp starts at zero and a hold does not**, which is the whole difference between them
       and is exactly what a reader cannot see in a `<select>` that spells them as two words. */
    case 'ramp':
      return [{ at: 0, level: 0 }, { at: input.seconds, level: input.target }];
    case 'hold':
      return [{ at: 0, level: input.target }, { at: input.seconds, level: input.target }];
    case 'step':
    case 'spike': {
      const out: PlanPoint[] = [];
      let at = 0;
      let level = 0;
      for (const stage of input.stages) {
        const seconds = stage.durationMs / 1000;
        /* A `jump` is a vertical edge: two points at the same instant, the second at the new
           level. A `ramp` has one point, because the line from where it was to where it is going
           IS the ramp. `step` has no spelling for a ramp — `buildWorkload` refuses one — so its
           stages are all jumps whatever the form holds. */
        if (input.shape === 'step' || stage.mode === 'jump') out.push({ at, level });
        level = stage.target;
        out.push({ at, level });
        at += seconds;
        out.push({ at, level });
      }
      return out;
    }
  }
}

/**
 * The planned curve as a series aligned to whole seconds — the shape a chart takes.
 *
 * **It samples rather than passing the breakpoints through**, because the achieved curve it is
 * drawn against is one point per second (`TimelinePoint.offsetSeconds`), and two series on one
 * x-axis have to share it. The value at a second is read off the polyline, which is exact for
 * every shape here: a jump is a vertical edge and a ramp is a straight line, so linear
 * interpolation is not an approximation of the plan, it **is** the plan.
 */
export function plannedSeries(input: PlanInput): { readonly x: readonly number[]; readonly y: readonly number[] } | null {
  const curve = plannedCurve(input);
  if (curve === null || curve.length === 0) return null;
  const end = Math.max(1, Math.ceil(curve[curve.length - 1]!.at));
  const x: number[] = [];
  const y: number[] = [];
  for (let second = 0; second <= end; second++) {
    x.push(second);
    y.push(levelAt(curve, second));
  }
  return { x, y };
}

/**
 * The planned level at one moment.
 *
 * **AT A JUMP'S OWN INSTANT THE CURVE HOLDS SEVERAL POINTS, AND THE LAST ONE WINS** — a jump at
 * second 5 means the level is the new one *from* 5 onward. The first draft of this walked the
 * segments in order and stopped at the first one ending at `second`, which for a staircase is the
 * segment *arriving* at the jump: it read second 5 as the old level, so every step in the series
 * was drawn one second late. Caught by the test that names the rule.
 *
 * So an exact hit on a breakpoint is answered from the breakpoints, and only a moment strictly
 * between two of them is interpolated — which is exact for every shape here, because a jump is a
 * vertical edge and a ramp is a straight line.
 */
export function levelAt(curve: readonly PlanPoint[], second: number): number {
  if (curve.length === 0) return 0;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (second <= first.at) return first.level;
  if (second >= last.at) return last.level;
  let exact: number | null = null;
  for (const point of curve) if (point.at === second) exact = point.level;
  if (exact !== null) return exact;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (a.at === b.at) continue;
    if (second > a.at && second < b.at) return a.level + ((b.level - a.level) * (second - a.at)) / (b.at - a.at);
  }
  return last.level;
}

/**
 * Whether the run's own timeline can be overlaid on this plan — `M213` `S6`.
 *
 * **IT CAN FOR `rps` AND IT CANNOT FOR `users`, AND THAT IS A PROPERTY OF THE REPORT.**
 * `TimelinePoint` records `count`, `rps`, `errorRate` and the duration percentiles for each
 * second — **arrivals**, not concurrency. An `rps` plan and the achieved `rps` are the same
 * quantity, so drawing them together answers *did the generator keep up*. A `users` plan is a
 * number of virtual users each looping; putting the achieved arrival rate on that axis would draw
 * two different quantities as one comparison, which reads as an answer and is not one.
 *
 * So the plot overlays the run where the two series mean the same thing, and says why it does not
 * where they do not, rather than drawing a line that would be believed.
 */
export function overlayIsComparable(unit: 'users' | 'rps'): boolean {
  return unit === 'rps';
}
