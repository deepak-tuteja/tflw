// The run strip (`M205` Q12, cut into a slice at last by `M209` `S1`) — `env`, `workers` and the
// button that starts a run, above the tabs and below the doorbar.
//
// IT FACES THE RUN, NOT THE FILE AND NOT THE PROJECT. `DoorBar` answers *what am I here to do*,
// `TabStrip` answers *what am I doing with this file*, and this answers *what is about to run*.
// That is why it lives here rather than in the sidebar, where it sat from `M192` U2 until now: the
// sidebar was carrying two jobs, listing the project **and** assembling a command, and the second
// one is the reason it could never become a file tree (`M209` §0).
//
// It renders the request's own vocabulary and nothing else. `env`, `workers`, `--tag` and the file
// list are exactly what `tflw run` takes, so the button's label is the command read back: *what
// will run*, never *what is selected somewhere else*. The narrowing itself is still the sidebar's
// gesture — this strip shows the total, which is what makes the two halves legible as one request.

import type { ProjectView, RunRequest } from './contract';
import { matchingFiles, parseQuery } from './search';

export interface RunStripProps {
  readonly project: ProjectView;
  /** The env the run is graded against — a name from the project's own config, never free text. */
  readonly env: string;
  readonly onEnv: (env: string) => void;
  /** Raw, because the control is a text field until it parses: `tflw run` takes an integer or
   *  nothing at all, and a half-typed `1` must not become a request. `request()` is what decides. */
  readonly workers: string;
  readonly onWorkers: (workers: string) => void;
  /** The narrowing, for the label only — it lives with the control that edits it. */
  readonly selection: readonly string[];
  readonly query: string;
  readonly running: boolean;
  readonly onRun: (request: RunRequest) => void;
  readonly onCancel: () => void;
  /** The request as the page currently reads: assembled by whoever owns the four pieces. */
  readonly request: () => RunRequest;
}

export function RunStrip({ project, env, onEnv, workers, onWorkers, selection, query, running, onRun, onCancel, request }: RunStripProps) {
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
        <label data-tip="which `env` block of `tflw.config` this run reads — its base URLs, its timeouts, and whatever credentials that block names">
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
        {/* **What this control does is narrower than its label**, and the hover is where that gets
            said: the page sends it as `--workers`, which forks load-generating processes for
            workload-bearing tests and is a documented no-op on a test without a `workload` — so on
            the API door it is inert. File concurrency is a different axis with a different name.
            Recorded as `M216-01`; the hover states it rather than implying otherwise. */}
        <label data-tip="how many processes fork to generate load — for workload-bearing tests only, and a no-op on a test with no `workload`. How many FILES run at once is `tflw.config`'s own `workers N`.">
          workers
          <input type="number" min={1} placeholder="default" value={workers} onChange={(e) => onWorkers(e.target.value)} data-workers disabled={running} />
        </label>
      </div>
      {running ? (
        <button className="cancel" onClick={onCancel} data-cancel>
          cancel
        </button>
      ) : (
        <button className="run" onClick={() => onRun(request())} data-run disabled={nothing} data-tip="runs these tests and grades them — every assertion is judged and the whole run is kept as a report you can reopen. `send`, on the Compose tab, only shows you a response." data-run-narrowing={nothing ? 'none' : selection.length > 0 ? 'selection' : parsed.kind}>
          {label}
        </button>
      )}
    </div>
  );
}
