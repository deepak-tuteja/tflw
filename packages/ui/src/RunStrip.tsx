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
  readonly tags: ReadonlySet<string>;
  readonly running: boolean;
  readonly onRun: (request: RunRequest) => void;
  readonly onCancel: () => void;
  /** The request as the page currently reads: assembled by whoever owns the four pieces. */
  readonly request: () => RunRequest;
}

export function RunStrip({ project, env, onEnv, workers, onWorkers, selection, tags, running, onRun, onCancel, request }: RunStripProps) {
  return (
    <div className="runstrip" data-runstrip>
      <div className="controls">
        <label>
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
        <label>
          workers
          <input type="number" min={1} placeholder="default" value={workers} onChange={(e) => onWorkers(e.target.value)} data-workers disabled={running} />
        </label>
      </div>
      {running ? (
        <button className="cancel" onClick={onCancel} data-cancel>
          cancel
        </button>
      ) : (
        <button className="run" onClick={() => onRun(request())} data-run>
          {/* `M205` Q13: the button names the SELECTION, because that is the gesture that filled it.
              `run all` is not an absence of a choice — it is the choice a project makes when you
              have not narrowed it, and it has to read as a decision. */}
          {selection.length > 0 ? `run selection · ${selection.length} file${selection.length === 1 ? '' : 's'}` : 'run all'}
          {tags.size > 0 ? ` · ${[...tags].sort().map((t) => `@${t}`).join(' ')}` : ''}
        </button>
      )}
    </div>
  );
}
