// The workload a test asks for, plotted — `M224` `C` (`D1209`), from `M213` `S6` (`D1103`).
//
// **MOVED OUT OF `LoadForm` INTACT, BECAUSE THE PICTURE WAS NEVER THE FORM'S.** The plot is about
// a *declaration*: it reads a workload and the last run's achieved arrival rate for the file, and
// neither fact belongs to a staging form that asked which test to attach a new workload to. It
// lands in region 2 of the standard pane, under a segment that appears only when the selected
// declaration carries a workload — on **every** door, because `D1044` earns a panel by the
// construct and never grants it by the door.
import { useEffect, useMemo, useState } from 'react';
import type { Workload } from '@tflw/lang';
import { Chart } from './Chart';
import { useTokenColors } from './theme';
import { overlayIsComparable, plannedSeries } from './plan';
import { getReports, getResults } from './api';
import { REPORT_LOOKBACK, sameFile } from './ran';
import type { WorkloadTestResult } from './contract';
import { planInputOf, planProse, workloadEditOf } from './workloadEdit';

/** `--accent` for the plan and `--warn` for what actually happened — the same pair `Workload.tsx`
 *  spends on *typical* and *slow*, so one reader's eye carries between the two panes. */
const PLOT_TOKENS = ['--accent', '--warn'] as const;

export interface LastWorkloadRun {
  /** This declaration's own scenario report from that run. */
  readonly entry: WorkloadTestResult;
  /** `RunReport.inconclusive` — tflw's own generator was the bottleneck, so every threshold in
   *  the run was skipped and the numbers describe tflw contending with itself. */
  readonly inconclusive: boolean;
}

/**
 * **The last run of THIS declaration in this file** — `M213` `S6` (`D1103`), narrowed by `M225`
 * `E` (`D1221`).
 *
 * The same walk `S2` gave the API door (`D1099`), and the same bound: `ReportEntry.files` is the
 * artefacts in a report directory, not the `.tflw` files a run executed (`M213-19`), so which
 * report holds this file is only in its own `results.json`. Newest first, `REPORT_LOOKBACK` deep,
 * stop at the first that carries this declaration's workload.
 *
 * **`name` is what `M225` added**, and it is not cosmetic: a file with three workload tests in it
 * had every one of them reading the first one's curve. `null` means *do not look* — a declaration
 * with no workload has nothing to cite, and an unconditional walk would open three reports on
 * every file the reader opens.
 *
 * **Three states, not two.** `undefined` is *nobody has answered yet*, `null` is *answered, and
 * there is no such run*. Collapsing them would make `D1221`'s citation read **"not run here
 * yet"** for the fraction of a second before the reports come back — a page asserting a fact it
 * has not looked up.
 */
export function useLastWorkloadRun(path: string, name: string | null): LastWorkloadRun | null | undefined {
  const [run, setRun] = useState<LastWorkloadRun | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRun(undefined);
    if (name === null) return;
    void (async () => {
      try {
        const reports = (await getReports()).slice().sort((a, b) => b.at.localeCompare(a.at));
        for (const entry of reports.slice(0, REPORT_LOOKBACK)) {
          if (!entry.files.includes('results.json')) continue;
          const report = await getResults(entry.id);
          if (!live) return;
          const mine = report.tests.find((t) => t.kind === 'workload' && sameFile(t.file, path) && t.name === name);
          if (mine && mine.kind === 'workload') {
            setRun({ entry: mine, inconclusive: report.inconclusive === true });
            return;
          }
        }
        if (live) setRun(null);
      } catch {
        if (live) setRun(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [path, name]);
  return run;
}

/**
 * **One chart, two series, and the second is only there when the two mean the same thing.**
 *
 * `TimelinePoint` records `count`, `rps`, `errorRate` and the duration percentiles for each second
 * of a run — **arrivals**, not concurrency. So an `rps` plan and the run's achieved `rps` are the
 * same quantity and answer a real question together (*did the generator keep up, and where did it
 * stop keeping up*), while a `users` plan is a number of loops in flight: drawing the achieved
 * arrival rate on that axis would put two different quantities in one comparison, which reads as
 * an answer and is not one. The plot says so in a sentence rather than drawing the line.
 *
 * The colours come from `theme.ts` (`S1`), which is what lets a canvas follow a theme at all — a
 * `ctx.strokeStyle` is a string, not a stylesheet, so `var(--accent)` in one is silently ignored.
 */
export function PlanPanel({ path, name, workload }: {
  readonly path: string;
  /** The declaration this plot is about, so a file with three workload tests stops drawing the
   *  first one's curve under all three (`D1221`'s narrowing). */
  readonly name: string | null;
  readonly workload: Workload;
}) {
  const [planned, slow] = useTokenColors(PLOT_TOKENS);
  const lastRun = useLastWorkloadRun(path, name);
  const achieved = useMemo(
    () => (lastRun === null || lastRun === undefined ? null : lastRun.entry.metrics.timeline.map((p) => ({ at: p.offsetSeconds, rps: p.rps }))),
    [lastRun],
  );
  const input = useMemo(() => planInputOf(workloadEditOf(workload)), [workload]);
  const series = useMemo(() => plannedSeries(input), [input]);
  const unit = input.unit;

  if (series === null) {
    return (
      <div className="plan-panel" data-compose-plan="no-clock">
        <p className="muted" data-load-plot-none data-load-plot-prose="iterations">{planProse(input.shape, input.unit)}</p>
      </div>
    );
  }

  const comparable = overlayIsComparable(unit) && achieved !== null && achieved.length > 0;
  /* The x-axis is the longer of the two, so a run that overran its plan is visible as exactly
     that rather than clipped at the plan's own right-hand edge. */
  const lastAchieved = comparable ? Math.max(...achieved.map((p) => p.at)) : 0;
  const end = Math.max(series.x[series.x.length - 1] ?? 1, lastAchieved);
  const x: number[] = [];
  for (let second = 0; second <= end; second++) x.push(second);
  const byAt = new Map((achieved ?? []).map((p) => [p.at, p.rps]));

  return (
    <div className="plan-panel workload-plot" data-compose-plan={unit} data-load-plot={unit} data-load-plot-overlay={comparable ? 'yes' : 'no'}>
      <Chart
        id="planned"
        title="the work this test asks for"
        unit={unit}
        x={x}
        kind="line"
        xName="at"
        xLabel={(v) => `${v}s`}
        yLabel={(v) => `${v}`}
        series={[
          { label: `planned ${unit}`, color: planned!, values: x.map((second) => (second <= (series.x[series.x.length - 1] ?? 0) ? series.y[second] ?? null : null)) },
          ...(comparable ? [{ label: 'achieved rps', color: slow!, values: x.map((second) => byAt.get(second) ?? null), dashed: true }] : []),
        ]}
      />
      {/* ── `M225` `F` (`D1222`) — the segment explains its own axis ────────────────────────
          The two sentences the grid cannot fit, and they go here rather than in the composer
          because the plot is the thing being explained and because region 1 is the constrained
          region (§1.11) while this one has the space. They differ by axis, which is gate 17: a
          `users` plan and an `rps` plan are not one picture with a different label on it. */}
      <p className="plan-prose muted" data-load-plot-prose={unit}>{planProse(input.shape, unit)}</p>
      {overlayIsComparable(unit) ? (
        achieved === null || achieved.length === 0 ? (
          <p className="muted" data-load-plot-why="no-run">nothing has run this file yet, so there is no achieved curve to draw over the plan.</p>
        ) : null
      ) : (
        <p className="muted" data-load-plot-why="not-comparable">
          a run records <strong>arrivals</strong>, not concurrency — so there is no achieved curve
          that means the same thing as a <code>users</code> plan. Switch the unit to{' '}
          <code>rps</code>, or read the run&rsquo;s own charts in Run.
        </p>
      )}
    </div>
  );
}
