// The LOAD door's authoring pane (`M200` `A0-4`) — the first form in tflw that writes a file.
//
// WHAT IT DOES IS ENTIRELY `@tflw/lang`'s. `buildWorkload`/`buildThreshold`/`buildTest` make the
// node, `insertIntoSource` prints it, splices it and formats the file, and `putFile` writes the
// result under the etag the source was read at. Every one of those runs **in this browser** —
// the language package has no dependencies and no Node builtins — so what this component holds
// is the field values and nothing else. There is no second implementation of any of it here to
// drift from the one the CLI uses, which is the whole point of putting them there.
//
// IT SHOWS THE SOURCE IT IS ABOUT TO WRITE, BEFORE IT WRITES IT. The file is the only truth
// (`D985`), so a form that hid its own output would be asking the author to trust a projection
// over the thing itself. The preview is the exact bytes the PUT will carry.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Chart } from './Chart';
import { useTokenColors } from './theme';
import { overlayIsComparable, plannedSeries } from './plan';

/** `--accent` for the plan and `--warn` for what actually happened — the same pair `Workload.tsx`
 *  spends on *typical* and *slow*, so one reader's eye carries between the two panes. */
const PLOT_TOKENS = ['--accent', '--warn'] as const;
import { buildThreshold, buildTest, buildWorkload, insertIntoSource, type Insertion, type StageSpec, type ThresholdSpec, type WorkloadSpec } from '@tflw/lang';
import { getReports, getResults, putFile, type FileView } from './api';
import { REPORT_LOOKBACK, sameFile } from './ran';
import { TabStrip } from './TabStrip';
import { SourcePanel } from './SourcePanel';
import type { TabId } from './doors';
import { diagnose } from './diagnose';
import type { ProjectView } from './contract';

export interface LoadFormProps {
  /**
   * The file every tab here is about, **read by the shell** (`M210` `S1`).
   *
   * All four doors used to run this identical read — `getFile(path)` into a `useState`, refreshed
   * on a path change — which is the four-way duplicate `M206` `S1` removed for the *path* and left
   * in place for the *bytes*. `D1081` is what forced it: the explorer draws the open file's
   * outline, so the shell needs the text too, and a fifth copy of the same read was the one
   * outcome worth refusing outright.
   */
  readonly file: FileView | null;
  /** Why there is no file, when there is no file — a read failure has to be sayable somewhere. */
  readonly fileProblem: string | null;
  /** A write lands here: the shell's copy moves forward so every reader of it agrees at once. */
  readonly onFileWritten: (file: FileView) => void;
  readonly project: ProjectView;
  /** Called after a successful write, so the shell can re-read the project it just changed. */
  readonly onWritten: (path: string) => void;
  /** The file this form is about (`M206` `Q4`) — from the address, resolved by the shell. */
  readonly filePath: string;
  /** Which stage of this file's life is showing (`M205` §2, propagated by `M206` `S2b` and by
   *  `M207` `S1` to this door). It lives in the URL and nowhere else (`D1045`), so the shell owns
   *  it and hands it down. */
  readonly tab: TabId;
  readonly onTab: (tab: TabId, focusLine?: number) => void;
  /** The project's runs, rendered by the shell — so Run can be a tab of this file's strip without
   *  this form learning what a report directory is.
   *
   *  **THIS DOOR NEEDED NOTHING FOR IT TO BE RIGHT.** `ReportView` dispatches on
   *  `entry.kind === 'workload'` and renders charts, a histogram and an endpoint table — it is
   *  polymorphic by test kind, never by door — so a workload run's evidence was already correct
   *  here before the tab existed to show it in. */
  readonly runPane: ReactNode;
  /** Why Run has something to say while you are composing. */
  readonly runMark?: string;
  /** The strip's two project-fact tabs, built by the shell (`M206` `S2a`). */
  readonly authPanel: ReactNode;
  readonly configPanel: ReactNode;
  readonly configMark?: string;
}

type Shape = 'iterations' | 'iterations-per-user' | 'ramp' | 'hold' | 'step' | 'spike';

/** The four profiles and the two units the grid crosses — `M213` `S6` (`D1103`). The `title` on
 *  each is the sentence the old `<select>` spelled inline, which is where it belongs: a label
 *  naming the thing, and the explanation one hover away. */
const PROFILES: ReadonlyArray<readonly [Shape, string, string]> = [
  ['ramp', 'ramp', 'start at nothing and climb to the target over the duration'],
  ['hold', 'hold', 'be at the target from the first second and stay there'],
  ['step', 'step', 'a staircase — each stage jumps to its level and holds'],
  ['spike', 'spike', 'stages that jump or ramp, mixed — the shape a traffic spike has'],
];

const UNITS: ReadonlyArray<readonly ['users' | 'rps', string, string]> = [
  ['users', 'users', 'closed — this many virtual users, each looping; arrivals depend on how fast the system answers'],
  ['rps', 'rps', 'open — this many arrivals a second regardless of what has finished'],
];

const ITERATION_SHAPES: ReadonlyArray<readonly [Shape, string, string]> = [
  ['iterations', 'N iterations', 'a fixed amount of work across M users — it ends when the work is done, and how long that takes is the measurement'],
  ['iterations-per-user', 'N per user', 'a fixed amount of work each, across M users'],
];

interface ThresholdRow {
  readonly metric: 'duration' | 'errorRate';
  readonly percentile: number;
  readonly op: 'lessThan' | 'greaterThan';
  readonly bound: number;
  readonly scope: string;
}

const EMPTY_THRESHOLD: ThresholdRow = { metric: 'duration', percentile: 95, op: 'lessThan', bound: 500, scope: '' };

/** Seconds in the form, milliseconds in the language — one conversion, stated once. */
const secondsToMs = (s: number): number => Math.round(s * 1000);

/**
 * The workload being composed, plotted — `M213` `S6` (`D1103`).
 *
 * **One chart, two series, and the second is only there when the two mean the same thing.**
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
function WorkloadPlot({ shape, unit, target, seconds, stages, achieved }: {
  readonly shape: Shape;
  readonly unit: 'users' | 'rps';
  readonly target: number;
  readonly seconds: number;
  readonly stages: readonly StageSpec[];
  /** The last run's per-second arrival rate for this file, or `null` when nothing has run it. */
  readonly achieved: readonly { readonly at: number; readonly rps: number }[] | null;
}) {
  const [planned, slow] = useTokenColors(PLOT_TOKENS);
  const series = useMemo(
    () => plannedSeries({ shape, unit, target, seconds, stages: stages.map((x) => ({ mode: x.mode, target: x.target, durationMs: x.durationMs })) }),
    [shape, unit, target, seconds, stages],
  );

  if (series === null) {
    return (
      <p className="muted" data-load-plot-none>
        this shape has no clock — it runs the iterations and ends when they are done, and how long
        that takes is what the run measures.
      </p>
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
    <div className="workload-plot" data-load-plot={unit} data-load-plot-overlay={comparable ? 'yes' : 'no'}>
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
      {overlayIsComparable(unit) ? (
        achieved === null || achieved.length === 0 ? (
          <p className="muted" data-load-plot-why="no-run">nothing has run this file yet, so there is no achieved curve to draw over the plan.</p>
        ) : null
      ) : (
        <p className="muted" data-load-plot-why="not-comparable">
          a run records <strong>arrivals</strong>, not concurrency — so there is no achieved curve
          that means the same thing as a <code>users</code> plan. Switch the unit to{' '}
          <code>rps</code>, or read the run’s own charts in Run.
        </p>
      )}
    </div>
  );
}

export function LoadForm({ project, onWritten, filePath, file, fileProblem, onFileWritten, tab, onTab, runPane, runMark, authPanel, configPanel, configMark }: LoadFormProps) {
  const path = filePath;
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [testName, setTestName] = useState('');
  // Off by default, deliberately: a threshold adds a judgement to a test, a workload line changes
  // how it RUNS — it stops being a single-shot functional test and becomes a per-VU loop. Doing
  // that implicitly because someone came through this door would be a much bigger change than the
  // one they asked for, so it is a thing to tick.
  const [alsoWorkload, setAlsoWorkload] = useState(false);
  const [name, setName] = useState('holds under load');
  const [tags, setTags] = useState('load');
  const [shape, setShape] = useState<Shape>('iterations');
  const [count, setCount] = useState(120);
  const [vus, setVus] = useState(4);
  const [target, setTarget] = useState(50);
  const [seconds, setSeconds] = useState(30);
  const [stages, setStages] = useState<readonly StageSpec[]>([{ mode: 'jump', target: 10, durationMs: 5000 }]);
  const [unit, setUnit] = useState<'users' | 'rps'>('users');
  const [thresholds, setThresholds] = useState<readonly ThresholdRow[]>([EMPTY_THRESHOLD]);
  /**
   * **The last run's achieved arrival rate for this file** — `M213` `S6` (`D1103`).
   *
   * The same walk `S2` gave the API door (`D1099`), and the same bound: `ReportEntry.files` is the
   * artefacts in a report directory, not the `.tflw` files a run executed (`M213-19`), so which
   * report holds this file is only in its own `results.json`. Newest first, `REPORT_LOOKBACK` deep,
   * stop at the first that carries a workload test for this file.
   *
   * `null` is the ordinary state of a file nobody has run, and is silent for that reason.
   */
  const [achieved, setAchieved] = useState<readonly { readonly at: number; readonly rps: number }[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const reports = (await getReports()).slice().sort((a, b) => b.at.localeCompare(a.at));
        for (const entry of reports.slice(0, REPORT_LOOKBACK)) {
          if (!entry.files.includes('results.json')) continue;
          const report = await getResults(entry.id);
          if (!live) return;
          const mine = report.tests.find((t) => t.kind === 'workload' && sameFile(t.file, path));
          if (mine && mine.kind === 'workload') {
            setAchieved(mine.metrics.timeline.map((p) => ({ at: p.offsetSeconds, rps: p.rps })));
            return;
          }
        }
        if (live) setAchieved(null);
      } catch {
        if (live) setAchieved(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [path, project]);
  const [busy, setBusy] = useState(false);
  const [ownProblem, setProblem] = useState<string | null>(null);
  /** A read failure is the shell's to discover and this pane's to say — there is no third place a
   *  reader looks, and a form that stayed silent about it would show an empty file as an empty
   *  form, which is the `M210` §0 defect wearing a different hat. */
  const problem = ownProblem ?? fileProblem;
  const [wrote, setWrote] = useState<string | null>(null);

  /** The tests in the chosen file, for the "add to an existing test" mode. Every test, not only
   *  the ones already behind LOAD: `D1044` is exactly the case where an API test gains a
   *  threshold from this lens and becomes a load test by doing so. */
  const testsInFile = useMemo(() => project.files.find((f) => f.path === path)?.tests ?? [], [project, path]);

  const workloadSpec = useCallback((): WorkloadSpec => {
    switch (shape) {
      case 'iterations': return { kind: 'iterations', perUser: false, count, vus };
      case 'iterations-per-user': return { kind: 'iterations', perUser: true, count, vus };
      case 'ramp': return { kind: 'ramp', unit, target, overMs: secondsToMs(seconds) };
      case 'hold': return { kind: 'hold', unit, target, forMs: secondsToMs(seconds) };
      case 'step': return { kind: 'step', unit, stages };
      case 'spike': return { kind: 'spike', unit, stages };
    }
  }, [shape, count, vus, unit, target, seconds, stages]);

  const thresholdSpec = (row: ThresholdRow): ThresholdSpec => ({
    metric: row.metric === 'duration' ? { kind: 'duration', percentile: row.percentile } : { kind: 'errorRate' },
    op: row.op,
    bound: row.bound,
    scope: row.scope.trim() === '' ? null : row.scope.trim(),
  });

  /**
   * The source this form would write, computed from the current field values on every keystroke.
   *
   * It is the preview *and* the thing that gets PUT — one value, so what is shown and what is
   * written cannot differ. A refusal from any builder or from the splice lands here as text, not
   * as a thrown error, because every one of them is something the author can fix in a field.
   */
  const pending = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!file) return { ok: false, reason: 'reading the file…' };
    const built: Array<{ ok: boolean; reason?: string }> = [];

    const rows = thresholds.map((r) => buildThreshold(thresholdSpec(r)));
    built.push(...rows);
    const badRow = rows.find((r) => !r.ok);
    if (badRow && !badRow.ok) return { ok: false, reason: badRow.reason };

    if (mode === 'existing') {
      if (testName === '') return { ok: false, reason: 'pick the test to add to' };
      const chosen = testsInFile.find((t) => t.name === testName);
      const insertions: Insertion[] = [];
      // Only when it was asked for, and only when there is not one already — the language allows
      // at most one workload line and `insertIntoSource` would refuse a second.
      if (alsoWorkload && chosen && !chosen.workload) {
        const w = buildWorkload(workloadSpec());
        if (!w.ok) return { ok: false, reason: w.reason };
        insertions.push({ kind: 'workload', testName, node: w.node });
      }
      for (const r of rows) if (r.ok) insertions.push({ kind: 'threshold', testName, node: r.node });
      let text = file.text;
      for (const insertion of insertions) {
        const result = insertIntoSource(text, insertion);
        if (!result.ok) return { ok: false, reason: result.reason };
        text = result.text;
      }
      return { ok: true, text };
    }

    const w = buildWorkload(workloadSpec());
    if (!w.ok) return { ok: false, reason: w.reason };
    const test = buildTest({
      name,
      tags: tags.split(/[\s,]+/).filter(Boolean),
      workload: w.node,
      thresholds: rows.flatMap((r) => (r.ok ? [r.node] : [])),
      body: [],
    });
    if (!test.ok) return { ok: false, reason: test.reason };
    const result = insertIntoSource(file.text, { kind: 'test', node: test.node });
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
  }, [file, mode, testName, testsInFile, alsoWorkload, name, tags, thresholds, workloadSpec]);

  /** `D1052` — recomputed with the preview, from the same bytes, so what is shown and what is
   *  judged cannot be two different files. */
  const diagnostics = useMemo(() => (pending.ok ? diagnose(pending.text) : []), [pending]);

  const save = useCallback(async () => {
    if (!file || !pending.ok) return;
    setBusy(true);
    setProblem(null);
    const res = await putFile(path, pending.text, file.etag);
    setBusy(false);
    if (!res.ok) {
      setProblem(res.status === 409 ? `${res.error} — reopen the file and apply this again` : res.code ? `${res.code} at line ${res.line}: ${res.error}` : res.error);
      return;
    }
    onFileWritten({ path, text: pending.text, etag: res.etag });
    setWrote(path);
    onWritten(path);
  }, [file, pending, path, onWritten]);

  const numberField = (label: string, value: number, set: (n: number) => void, key: string) => (
    <label key={key}>
      {label}
      <input type="number" value={value} min={1} onChange={(e) => set(Number(e.target.value))} data-load-field={key} />
    </label>
  );

  /**
   * What a tab you are not looking at has to say — the same three cases as API (`M205` S5) and
   * BROWSER (`M206` `S2b`), each a fact about what that tab's own subject is holding.
   *
   * **There is no `send` on this door either**, so `M206` `Q5`'s switching half never fires here:
   * a load run is started from the sidebar and marks Run rather than taking you to it. That is the
   * right behaviour for this door for a reason the other two do not have — a workload run is the
   * long one, so being moved off the form you are still filling in would cost more here than
   * anywhere else.
   */
  const marks: Partial<Record<TabId, string>> = {};
  if (pending.ok && file && pending.text !== file.text) marks.source = 'Compose is holding bytes this file does not have yet';
  if (runMark) marks.run = runMark;
  if (configMark) marks.config = configMark;

  return (
    <section className="doorpane" data-load-form>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={pending} diagnostics={diagnostics} project={project} door="load" /> : null}
      {tab === 'run' ? <div className="runpane" data-load-run-tab>{runPane}</div> : null}
      {tab === 'auth' ? authPanel : null}
      {tab === 'config' ? configPanel : null}

      {tab !== 'compose' ? null : (
      <section className="authoring" data-load-compose>
      <header className="authoring-head">
        <h2>write a load test</h2>
        <p className="muted">
          Every byte below goes through the printer and the formatter, and lands in a real file — the same file{' '}
          <code>tflw run</code> reads from a terminal.
        </p>
      </header>

      <div className="authoring-grid">
        {/* **The `file` control is gone (`M205` Q7, deleted by `M209` `S4`).** The explorer names
            the file: clicking a row in the tree opens it and the address carries it, so a second
            control stating the same fact is the duplication Q7 was written to end. The file this
            form writes into is `path`, from the hash, and the pane says which one it is. */}

        <label>
          what
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} data-load-mode>
            <option value="new">a new test</option>
            <option value="existing">add to a test already here</option>
          </select>
        </label>

        {mode === 'existing' ? (
          <>
            <label>
              test
              <select value={testName} onChange={(e) => setTestName(e.target.value)} data-load-test>
                <option value="">— pick one —</option>
                {testsInFile.map((t) => (
                  <option key={`${t.line}-${t.name}`} value={t.name}>
                    {t.name}
                    {t.workload ? ' (already a workload test)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label title="a workload line makes this a load test — it stops running once and starts looping per user">
              also give it a workload line
              <input
                type="checkbox"
                checked={alsoWorkload}
                disabled={testsInFile.find((t) => t.name === testName)?.workload ?? false}
                onChange={(e) => setAlsoWorkload(e.target.checked)}
                data-load-also-workload
              />
            </label>
          </>
        ) : (
          <>
            <label>
              name
              <input value={name} onChange={(e) => setName(e.target.value)} data-load-name />
            </label>
            <label>
              tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-load-tags placeholder="load smoke" />
            </label>
          </>
        )}

        {/* **THE SHAPE IS A GRID, NOT TEN OPTIONS** (`M213` `S6`, `D1103`).
            The language's ten workload shapes are not ten things: they are **four profiles × two
            units**, plus two iteration shapes that have no time axis at all. A `<select>` spelled
            them as a flat list of ten sentences, which is the one arrangement that hides the fact
            a reader most needs — that `ramp` and `hold` differ in where they start, and that
            `users` and `rps` are a *closed* and an *open* model of arrival rather than two
            spellings of "how much".

            Drawn as a grid, choosing a profile and choosing a unit are two choices instead of one
            lookup, and the pair you have not chosen is on screen beside the pair you have. */}
        <div className="shape-grid" hidden={mode === 'existing' && !alsoWorkload} data-load-shape={shape} data-load-unit={shape === 'iterations' || shape === 'iterations-per-user' ? '' : unit}>
          <div className="shape-cols">
            <span />
            {UNITS.map(([u, label, why]) => (
              <button
                key={u}
                type="button"
                className={unit === u ? 'unit on' : 'unit'}
                onClick={() => setUnit(u)}
                data-shape-unit={u}
                aria-pressed={unit === u}
                title={why}
              >
                {label}
              </button>
            ))}
          </div>
          {PROFILES.map(([p, label, why]) => (
            <div className="shape-row" key={p}>
              <button
                type="button"
                className={shape === p ? 'profile on' : 'profile'}
                onClick={() => setShape(p)}
                data-shape-profile={p}
                aria-pressed={shape === p}
                title={why}
              >
                {label}
              </button>
              {UNITS.map(([u]) => (
                <button
                  key={u}
                  type="button"
                  className={shape === p && unit === u ? 'cell on' : 'cell'}
                  onClick={() => { setShape(p); setUnit(u); }}
                  data-shape-cell={`${p}:${u}`}
                  aria-pressed={shape === p && unit === u}
                  title={`${label} ${u}`}
                >
                  {shape === p && unit === u ? '●' : '·'}
                </button>
              ))}
            </div>
          ))}
          {/* **The two that are not in the grid, and are not an eleventh column either.** An
              iteration shape names an amount of work, not a rate: the run ends when the iterations
              are done, and how long that takes is the thing being measured. It has no unit axis to
              sit on, so it sits beside the grid rather than inside it. */}
          <div className="shape-row shape-aside">
            {ITERATION_SHAPES.map(([p, label, why]) => (
              <button
                key={p}
                type="button"
                className={shape === p ? 'profile on' : 'profile'}
                onClick={() => setShape(p)}
                data-shape-profile={p}
                aria-pressed={shape === p}
                title={why}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {shape === 'iterations' || shape === 'iterations-per-user' ? (
          <>
            {numberField('iterations', count, setCount, 'count')}
            {numberField('users', vus, setVus, 'vus')}
          </>
        ) : null}

        {shape === 'ramp' || shape === 'hold' ? (
          <>
            {numberField('target', target, setTarget, 'target')}
            {numberField('seconds', seconds, setSeconds, 'seconds')}
          </>
        ) : null}

        {shape === 'step' || shape === 'spike' ? (
          <div className="stages" data-load-stages={stages.length}>
            {stages.map((s, i) => (
              <div className="stage-row" key={i}>
                {shape === 'spike' ? (
                  <select
                    value={s.mode}
                    onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, mode: e.target.value as 'jump' | 'ramp' } : x)))}
                    data-stage-mode={i}
                  >
                    <option value="jump">hold at</option>
                    <option value="ramp">ramp to</option>
                  </select>
                ) : (
                  // A `step` block has no spelling for a ramp, so the form does not offer one —
                  // `buildWorkload` refuses it, and an option that is always refused is a trap.
                  <span className="muted">to</span>
                )}
                <input
                  type="number"
                  value={s.target}
                  min={1}
                  onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))}
                  data-stage-target={i}
                />
                <input
                  type="number"
                  value={s.durationMs / 1000}
                  min={1}
                  onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, durationMs: secondsToMs(Number(e.target.value)) } : x)))}
                  data-stage-seconds={i}
                />
                <span className="muted">s</span>
                <button onClick={() => setStages(stages.filter((_, j) => j !== i))} data-stage-remove={i} disabled={stages.length === 1}>
                  −
                </button>
              </div>
            ))}
            <button onClick={() => setStages([...stages, { mode: 'jump', target: 10, durationMs: 5000 }])} data-stage-add>
              + stage
            </button>
          </div>
        ) : null}
      </div>

      <div className="thresholds-form" data-load-thresholds={thresholds.length}>
        {thresholds.map((row, i) => (
          <div className="threshold-row" key={i}>
            <select value={row.metric} onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, metric: e.target.value as 'duration' | 'errorRate' } : x)))} data-threshold-metric={i}>
              <option value="duration">duration</option>
              <option value="errorRate">error rate</option>
            </select>
            {row.metric === 'duration' ? (
              <input type="number" value={row.percentile} min={1} max={99} onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, percentile: Number(e.target.value) } : x)))} data-threshold-percentile={i} />
            ) : null}
            <select value={row.op} onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, op: e.target.value as 'lessThan' | 'greaterThan' } : x)))} data-threshold-op={i}>
              <option value="lessThan">is less than</option>
              <option value="greaterThan">is greater than</option>
            </select>
            <input type="number" value={row.bound} min={0} step="any" onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, bound: Number(e.target.value) } : x)))} data-threshold-bound={i} />
            <span className="muted">{row.metric === 'duration' ? 'ms' : '%'}</span>
            <input value={row.scope} placeholder='for "label" (optional)' onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))} data-threshold-scope={i} />
            <button onClick={() => setThresholds(thresholds.filter((_, j) => j !== i))} data-threshold-remove={i}>
              −
            </button>
          </div>
        ))}
        <button onClick={() => setThresholds([...thresholds, EMPTY_THRESHOLD])} data-threshold-add>
          + threshold
        </button>
      </div>

      {pending.ok ? (
        <>
          {/* **THE PLOT IS THE PREVIEW** (`M213` `S6`, `D1103`).
              A `<pre>` of the bytes was the right preview when Compose could not read the file;
              Source has shown those bytes since `M210`, and this door's own question is not *what
              will be written* but **what shape of work is that**. `planned with achieved overlaid
              in one frame is the picture a load tool exists to show`, and neither pane showed one
              — `Workload.tsx` has plotted a *finished* run since `M192` and Compose could not
              reach it.

              Explicitly **not a JMeter tree**: JMeter's model is containers holding samplers
              holding assertions, tflw's is flat, and drawing a tree would assert a containment the
              file does not have. */}
          <WorkloadPlot
            shape={shape}
            unit={unit}
            target={target}
            seconds={seconds}
            stages={stages}
            achieved={achieved}
          />
          {/* `D1052` — what `tflw check` will say about these bytes. Shown, never blocking: the
              write route refuses what cannot be read (`D1049`), and an unbound `{'{'}token{'}'}` reads
              fine — it is just wrong, and the author should hear it here rather than in CI. */}
          {diagnostics.length > 0 ? (
            <ul className="preview-diagnostics" data-load-diagnostics={diagnostics.length}>
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity} data-diagnostic-code={d.code}>
                  <code>{d.code}</code> line {d.span.start.line} — {d.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="warn" data-load-problem>
          {pending.reason}
        </p>
      )}

      <div className="authoring-actions">
        <button className="run" onClick={() => void save()} disabled={!pending.ok || busy} data-load-save>
          {busy ? 'writing…' : `write ${path}`}
        </button>
        {wrote ? (
          <span className="muted" data-load-wrote={wrote}>
            written — <code>{wrote}</code> is what <code>tflw run</code> will read
          </span>
        ) : null}
        {problem ? (
          <span className="error" data-load-error>
            {problem}
          </span>
        ) : null}
      </div>
      </section>
      )}
    </section>
  );
}
