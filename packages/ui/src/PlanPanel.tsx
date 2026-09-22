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
import { sameFile } from './ran';
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
 * The same filter `S2` gave the API door (`D1099`), and it is a **filter** since `M232` (`D1271`):
 * `ReportEntry.files` was the artefacts in a report directory, not the `.tflw` files a run
 * executed (`M213-19`), so which report held this file used to be readable only by opening its own
 * `results.json` — newest first, `REPORT_LOOKBACK` deep. `ReportEntry.tests` answers it in the
 * list the page already has, at no cost to the server, so the cap is gone with the walk it
 * bounded and exactly one payload is fetched.
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
        /* The list narrows it to the reports that ran this **file**; which of them holds a
           *workload* named `name` is still only in the payload, so the walk survives over a set
           that is now usually one long — and the fetch inside it is the reason the loop is still a
           loop rather than a `find`. */
        for (const entry of reports) {
          if (!entry.tests.some((f) => sameFile(f, path))) continue;
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
 * **How the work divides between the users** — `M227` `C` (`D1234`).
 *
 * `run 40 iterations across 4 users` is four shares of ten; `run 10 iterations per user across 4`
 * is four shares of ten that happen to total forty. The remainder is *shown* rather than rounded
 * away — `41 across 4` is 11/10/10/10, and a picture that drew four equal bars would be asserting
 * something the language does not say.
 */
export function sharesOf(perUser: boolean, count: number, vus: number): readonly number[] {
  if (!Number.isFinite(count) || !Number.isFinite(vus) || vus <= 0 || count < 0) return [];
  const n = Math.round(vus);
  if (perUser) return Array.from({ length: n }, () => Math.round(count));
  const each = Math.floor(Math.round(count) / n);
  const over = Math.round(count) % n;
  return Array.from({ length: n }, (_, i) => each + (i < over ? 1 : 0));
}

/** No more rows than a reader can take in at once; `examples/storefront` declares 20 users and the
 *  corpus's own rungs declare 4, so the cap is about the shape of the picture rather than about
 *  this corpus. */
const SHARE_ROWS = 12;

/**
 * **An iteration plan draws its work, and it is not a chart** — `M227` `C` (`D1234`).
 *
 * It has no time axis and `plannedCurve` correctly returns `null` for it (`D1212` — *`null` is not
 * "unknown"*), so there is no series and nothing to hang an x-axis on. uPlot exists here to plot a
 * series against an axis; four rectangles would import the whole time-plot apparatus and then have
 * to invent the one axis the shape does not have.
 *
 * **The right-hand edge is open on purpose.** The bar's length is iterations, and the dashed run
 * past it is the sentence beside it drawn: the work is known and how long it takes is the thing
 * being measured.
 */
function ShareBars({ perUser, count, vus }: { readonly perUser: boolean; readonly count: number; readonly vus: number }) {
  const shares = sharesOf(perUser, count, vus);
  if (shares.length === 0) return null;
  const most = Math.max(...shares, 1);
  const total = shares.reduce((a, b) => a + b, 0);
  const shown = shares.slice(0, SHARE_ROWS);
  return (
    <div className="share-bars" data-share-bars={shares.length} data-share-total={total}>
      <ol>
        {shown.map((n, i) => (
          <li key={i} data-share-user={i + 1} data-share-count={n}>
            <span className="share-who">user {i + 1}</span>
            <span className="share-track">
              <span className="share-bar" style={{ width: `${(n / most) * 100}%` }} />
            </span>
            <span className="share-n">{n}</span>
          </li>
        ))}
      </ol>
      {shares.length > shown.length ? (
        <p className="plan-prose muted" data-share-more={shares.length - shown.length}>
          and {shares.length - shown.length} more users, the same share each.
        </p>
      ) : null}
      <p className="plan-prose muted" data-share-line>
        {perUser ? `${count} iterations each` : `${total} iterations, shared out`} · {total} total ·{' '}
        <span className="share-open-key">the length past the bar is the duration nobody has yet</span>
      </p>
    </div>
  );
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
  const edit = useMemo(() => workloadEditOf(workload), [workload]);
  const input = useMemo(() => planInputOf(edit), [edit]);
  const series = useMemo(() => plannedSeries(input), [input]);
  const unit = input.unit;

  /* ── `M227` `B` (`D1231`) — the picture left, the prose right ───────────────────────────────
     `M226` bought this panel 1042 px of width. The plot cannot use it (a constant 180 px height
     turned 4.0:1 into 5.8:1 for free) and the prose is harmed by it (measured 90 characters to
     the line, against a comfortable 65-75). So the width is spent rather than fought, and
     **both** shapes enter the same frame — an iteration plan draws its work (`D1234`) rather
     than sitting as one paragraph where every other shape has a figure. */
  if (series === null) {
    return (
      <div className="plan-panel" data-compose-plan="no-clock">
        <div className="plan-figure">
          <ShareBars perUser={input.shape === 'iterations-per-user'} count={Number(edit.count)} vus={Number(edit.vus)} />
        </div>
        <div className="plan-words">
          <p className="plan-prose muted" data-load-plot-none data-load-plot-prose="iterations">{planProse(input.shape, input.unit)}</p>
        </div>
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
      <div className="plan-figure">
        <Chart
          id="planned"
          title="the work this test asks for"
          unit={unit}
          x={x}
          kind="line"
          xName="at"
          xLabel={(v) => `${v}s`}
          yLabel={(v) => `${v}`}
          /* `D1230` — the plot is the region's height, not a constant, so the divider the reader
             already has means something for the picture. `D1233` — the height is a declared
             quantity, so it is drawn from zero; a `hold` plan was an 8-px hairline without it. */
          height="fill"
          zeroBased
          series={[
            { label: `planned ${unit}`, color: planned!, values: x.map((second) => (second <= (series.x[series.x.length - 1] ?? 0) ? series.y[second] ?? null : null)) },
            ...(comparable ? [{ label: 'achieved rps', color: slow!, values: x.map((second) => byAt.get(second) ?? null), dashed: true }] : []),
          ]}
        />
      </div>
      {/* ── `M225` `F` (`D1222`) — the segment explains its own axis ────────────────────────
          The two sentences the grid cannot fit, and they go here rather than in the composer
          because the plot is the thing being explained and because region 1 is the constrained
          region (§1.11) while this one has the space. They differ by axis, which is gate 17: a
          `users` plan and an `rps` plan are not one picture with a different label on it.

          ── `M227` `B` (`D1232`) — and they say it in the footer's own voice. `planProse()` used
          to render at 11 px under a chart and at 14 px without one, because the no-clock branch
          returned before `.plan-prose` existed: one function, one sentence, two sizes, decided by
          nothing. Every explanatory line in region 2 is 12 px now — the size the segment tabs and
          `.response-none` already used. */}
      <div className="plan-words">
        <p className="plan-prose muted" data-load-plot-prose={unit}>{planProse(input.shape, unit)}</p>
        {overlayIsComparable(unit) ? (
          achieved === null || achieved.length === 0 ? (
            <p className="plan-prose muted" data-load-plot-why="no-run">nothing has run this file yet, so there is no achieved curve to draw over the plan.</p>
          ) : null
        ) : (
          <p className="plan-prose muted" data-load-plot-why="not-comparable">
            a run records <strong>arrivals</strong>, not concurrency — so there is no achieved curve
            that means the same thing as a <code>users</code> plan. Switch the unit to{' '}
            <code>rps</code>, or read the run&rsquo;s own charts in Run.
          </p>
        )}
      </div>
    </div>
  );
}
