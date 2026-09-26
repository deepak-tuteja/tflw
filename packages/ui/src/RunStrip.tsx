// The run strip (`M205` Q12, cut into a slice at last by `M209` `S1`) — `env`, the button that
// starts a run, and the two flags the run can bear, above the tabs and below the doorbar.
//
// IT FACES THE RUN, NOT THE FILE AND NOT THE PROJECT. `DoorBar` answers *what am I here to do*,
// `TabStrip` answers *what am I doing with this file*, and this answers *what is about to run*.
// That is why it lives here rather than in the sidebar, where it sat from `M192` U2 until now: the
// sidebar was carrying two jobs, listing the project **and** assembling a command, and the second
// one is the reason it could never become a file tree (`M209` §0).
//
// **AND IT RENDERS ONLY THE PART OF THAT VOCABULARY THIS RUN CAN SPEND** — `M229` `B` (`D1250`),
// which closed `M216-01` and its unfiled twin. `--workers` is a no-op on a test with no `workload`
// and `--headed` is a no-op on a test that opens no page, and both were drawn on every door, on
// every project, always. They are now drawn when the narrowing in the label beside them would
// actually reach a test that can spend them. The key is the **lens set of the run**, never the
// door: this strip faces the run, and `run all` on the API door runs the LOAD tests too.
//
// It renders the request's own vocabulary and nothing else. `env`, `workers`, `--tag` and the file
// list are exactly what `tflw run` takes, so the button's label is the command read back: *what
// will run*, never *what is selected somewhere else*. The narrowing itself is still the sidebar's
// gesture — this strip shows the total, which is what makes the two halves legible as one request.

import { useEffect, useState } from 'react';
import type { ProjectView, RunRequest } from './contract';
import { lensesInRun, matchingFiles, parseQuery } from './search';

export interface RunStripProps {
  readonly project: ProjectView;
  /** The env the run is graded against — a name from the project's own config, never free text. */
  readonly env: string;
  readonly onEnv: (env: string) => void;
  /** Raw, because the control is a text field until it parses: `tflw run` takes an integer or
   *  nothing at all, and a half-typed `1` must not become a request. `request()` is what decides. */
  readonly workers: string;
  readonly onWorkers: (workers: string) => void;
  /** **`--headed`** (`M220` `D`, `D1173`) — run-level, like the two above it. */
  readonly headed: boolean;
  readonly onHeaded: (headed: boolean) => void;
  /** The narrowing, for the label only — it lives with the control that edits it. */
  readonly selection: readonly string[];
  readonly query: string;
  readonly running: boolean;
  readonly onRun: (request: RunRequest) => void;
  readonly onCancel: () => void;
  /** The request as the page currently reads: assembled by whoever owns the four pieces. */
  readonly request: () => RunRequest;
}

export function RunStrip({ project, env, onEnv, workers, onWorkers, headed, onHeaded, selection, query, running, onRun, onCancel, request }: RunStripProps) {
  /**
   * The button is the request read back (`M205` Q13, `D1064`). Three narrowings in one sentence,
   * in the order that decides them: an explicit selection wins, then a query, then the project.
   *
   * A tag query that matches no tag is the one state where there is nothing to press: `--tag nope`
   * is an error in the CLI (`cli.ts`), and a search box that quietly ran the whole suite instead
   * is worse than a button that says so.
   */
  const parsed = parseQuery(query, project);
  const matched = matchingFiles(project, parsed);
  /**
   * **What this run would actually contain** — `M229` `B` (`D1250`), closing `M216-01`.
   *
   * `workers` and `headed` each govern one kind of test, and both were drawn always. The subject of
   * `workers` is a workload **in this run** and the subject of `headed` is a browser **in this
   * run**, so `D1082` applies to both: a control whose subject is absent is absent, not drawn dead.
   *
   * Two readings and not one flag, and they are not the same set — `lensesInRun` is keyed on the
   * lenses the narrowing reaches, so a selection of one API file hides both, a selection holding a
   * load file shows `workers` **on every door including API**, and a project with no browser test
   * never shows `headed` anywhere. A single `doorSpecific` flag is the proxy this arc has now
   * mis-keyed three times (`M227` `A`, `M228` `F1`), and a door literal is the fourth: both are
   * green under the mutation that matters, because the door you are standing behind does not narrow
   * what `run all` runs.
   */
  const lenses = lensesInRun(project, selection, parsed);
  const takesWorkers = lenses.has('load');
  const takesHeaded = lenses.has('browser');

  /**
   * **`more…`** — `M241` `D` (`D1324`). The rest of `tflw run`'s flags the page may set, as the
   * server lists them from the table the CLI parses by, each drawn only while its subject is in
   * THIS run — the same `D1250` reading `workers` and `headed` use, so a scan's `fail on` is not on
   * a strip whose run holds no scan. Only the rows on screen are sent: a value set while a scan was
   * selected does not ride along on a run that has none.
   *
   * The values are remembered per project in this browser — a convenience, and nothing a run
   * depends on: the argv the run was started with is on its record, which is the durable answer.
   */
  const storeKey = `tflw.runFlags:${project.root}`;
  const [flags, setFlags] = useState<Record<string, string | boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, string | boolean>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(flags));
    } catch {
      // A private window or blocked storage: the values last as long as the page, which is all
      // this ever promised.
    }
  }, [storeKey, flags]);
  const spends = (subject: string): boolean =>
    subject === 'always' || (subject === 'scan' && lenses.has('scan')) || (subject === 'browser' && lenses.has('browser')) || (subject === 'workload' && lenses.has('load'));
  const rows = project.runFlags.filter((f) => spends(f.subject));
  const sent: Record<string, string | boolean> = {};
  for (const row of rows) {
    const v = flags[row.flag];
    if (v !== undefined && v !== false && v !== '') sent[row.flag] = v;
  }
  const setCount = Object.keys(sent).length;
  const nothing = parsed.kind === 'tag' && parsed.tags.length === 0;
  const label = nothing
    ? `nothing matches ${parsed.typed}`
    : selection.length > 0
      ? `run selection · ${selection.length} file${selection.length === 1 ? '' : 's'}`
      : parsed.kind === 'tag'
        ? `run ${parsed.tags.map((t) => `@${t}`).join(' ')}`
        : parsed.kind === 'text'
          ? `run ${matched!.size} matching file${matched!.size === 1 ? '' : 's'}`
          : 'run all';

  return (
    <div className="runstrip" data-runstrip>
      <div className="controls">
        {/* `M216` `C`. The three controls on this strip said nothing at all, and the run button is
            half of `D1130`'s pair: `send` and `run` sit inches apart on the Compose tab and do
            different things, which is a confusion with a milestone named after it — `M215` exists
            because pressing `send` was read as running the test. */}
        <label data-tip="the `env` block of tflw.config this run reads — base URLs, timeouts, credentials">
          env
          <select value={env} onChange={(e) => onEnv(e.target.value)} data-env-select disabled={running}>
            {project.envs.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
                {e.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {/* **`M216-01`, CLOSED by `M229` `B`.** `M216` `C` could only make the hover say that this
            control is narrower than its label — *"forks load-generating processes for
            workload-bearing tests, and is a documented no-op on a test without a `workload`"* — and
            the row stayed open because saying so is not the repair. It is drawn now when the run
            beside it holds a workload, which is `D1082` rather than a sentence. The tip keeps the
            second half, which no condition can say: file concurrency is a different axis with a
            different name, and it lives in `tflw.config`. */}
        {takesWorkers ? (
          <label data-tip="processes forked to generate load for workload tests — files at once is the config's">
            workers
            <input type="number" min={1} placeholder="default" value={workers} onChange={(e) => onWorkers(e.target.value)} data-workers disabled={running} />
          </label>
        ) : null}
        {/* **`--headed`** — `M220` `D` (`D1173`). It belongs on this strip and not beside ▶ for the
            reason the header gives: this strip faces *the run*, and `--headed` is a run-level flag.
            The tip says what it is for rather than what it does, because *shows the browser* is
            already on the label — what a reader needs is that the trace is the better answer and
            this is here for the two engines that cannot have one. */}
        {takesHeaded ? (
          <label className="check" data-tip="a visible browser window instead of headless — to watch it move; the trace keeps more">
            <input type="checkbox" checked={headed} onChange={(e) => onHeaded(e.target.checked)} data-headed disabled={running} />
            headed
          </label>
        ) : null}
        {rows.length === 0 ? null : (
          <details className="run-more" data-run-more={rows.map((r) => r.flag).join(' ')}>
            <summary data-tip="the rest of what `tflw run` takes, for what this run holds">
              more…{setCount === 0 ? '' : ` (${setCount})`}
            </summary>
            <div className="run-more-rows">
              {rows.map((row) =>
                row.shape === 'bool' ? (
                  <label key={row.flag} className="check" data-tip={row.hint}>
                    <input type="checkbox" checked={flags[row.flag] === true} onChange={(e) => setFlags({ ...flags, [row.flag]: e.target.checked })} data-run-flag={row.flag} disabled={running} />
                    {row.label}
                  </label>
                ) : (
                  <label key={row.flag} data-tip={row.hint}>
                    {row.label}
                    <input value={typeof flags[row.flag] === 'string' ? (flags[row.flag] as string) : ''} onChange={(e) => setFlags({ ...flags, [row.flag]: e.target.value })} data-run-flag={row.flag} disabled={running} placeholder="default" />
                  </label>
                ),
              )}
            </div>
          </details>
        )}
      </div>
      {running ? (
        <button className="cancel" onClick={onCancel} data-cancel>
          cancel
        </button>
      ) : (
        <button className="run" onClick={() => onRun(setCount === 0 ? request() : { ...request(), flags: sent })} data-run disabled={nothing} data-tip="runs and grades these tests, and keeps the run as a report you can reopen" data-run-narrowing={nothing ? 'none' : selection.length > 0 ? 'selection' : parsed.kind}>
          {label}
        </button>
      )}
    </div>
  );
}
