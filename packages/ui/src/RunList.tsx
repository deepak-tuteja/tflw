// The run list (`M192` U2): a run is a report directory (§2 q6) — `current` is what the last
// `tflw run` wrote, `runs/<id>` is what the server kept — and, above them, the runs this server
// started that are still in flight, which have no directory yet.
//
// **`M229` `E` IS THIS COMPONENT'S FIRST DESIGN RECORD** (`D1253`, `D1254`, `D1255`). It drew the
// surface every ▶ press lands on and `RunList` occurred **0 times** in `DECISIONS.md` — which
// `UI_STRUCTURE.md` §4 named as the place a review should expect to be productive, and it was:
// three of the four findings in the review's last pass are here, and all three are the kind that
// only appear when nobody has had to argue for the thing.
//
// The three rules it now keeps, each one sentence:
//
// - **The list says which run is open** (`D1253`). It had a `.selected` class and an accent border
//   since `M192` and no *state* a screen reader or a script could read — a toggle button in a list
//   of ten, with `aria-pressed` on none of them. `D1129`'s family: the styling is not the state.
// - **`current` is a property of a run, not a run** (`D1254`). See `ui-server.ts`'s `listReports`.
// - **A report's directory name is provenance, not a title** (`D1255`). `2026-09-20T10-41-50-120Z`
//   was the widest thing in the row and the readable date sat beside it in grey, saying the same
//   instant twice — once as a filesystem artifact. The row leads with the date now and the
//   directory is in the tip, which is where a value you might want to copy belongs.

import type { ReportDir, RunRecord } from './contract';
import { ago, when } from './format';

export type Selection = { readonly kind: 'run'; readonly id: string } | { readonly kind: 'report'; readonly id: string } | null;

export interface RunListProps {
  readonly runs: readonly RunRecord[];
  readonly reports: readonly ReportDir[];
  readonly selected: Selection;
  readonly onSelect: (s: Selection) => void;
}

export function RunList({ runs, reports, selected, onSelect }: RunListProps) {
  /** Read once per render, so every chip ages against the same instant (`format.ts` `ago`). */
  const now = Date.now();
  const live = runs.filter((r) => r.status === 'running');
  // U7: a run that ended with no directory — a usage error, a cancel before any report — has no
  // row among the reports and would vanish from the list; it stays as its own row, its exit the
  // label, and selecting it replays its stream and stderr. Found on the security corpus, whose
  // `require env` was unmet: the pane said `exit 2` until the next click, then nothing did.
  const unkept = runs.filter((r) => r.status !== 'running' && r.kept === null);
  return (
    <nav className="runs" data-runs>
      {live.map((r) => (
        <button
          key={r.id}
          className={`run-row running${selected?.kind === 'run' && selected.id === r.id ? ' selected' : ''}`}
          aria-pressed={selected?.kind === 'run' && selected.id === r.id}
          onClick={() => onSelect({ kind: 'run', id: r.id })}
          data-run-row={r.id}
          data-status={r.status}
          data-tip="a run this page started that has not finished — the pane follows it live, and a report directory appears when it ends"
        >
          <span className="dot running" />
          <span>running</span>
          <span className="muted" data-run-when={r.startedAt} data-tip={when(r.startedAt)}>{ago(r.startedAt, now)}</span>
        </button>
      ))}
      {unkept.map((r) => (
        <button
          key={r.id}
          className={`run-row${selected?.kind === 'run' && selected.id === r.id ? ' selected' : ''}`}
          aria-pressed={selected?.kind === 'run' && selected.id === r.id}
          onClick={() => onSelect({ kind: 'run', id: r.id })}
          data-run-row={r.id}
          data-status={r.status}
          data-exit={r.exitCode ?? ''}
          data-tip="this run wrote no report directory — a usage error, or a cancel before anything was graded. Opening it replays what the process said."
        >
          <span className={`dot ${r.status === 'cancelled' ? 'none' : 'fail'}`} />
          <span>{r.status === 'cancelled' ? 'cancelled' : `exit ${r.exitCode ?? r.signal}`} · no report</span>
          <span className="muted" data-run-when={r.startedAt} data-tip={when(r.startedAt)}>{ago(r.startedAt, now)}</span>
        </button>
      ))}
      {reports.map((r) => {
        const open = selected?.kind === 'report' && selected.id === r.id;
        return (
          <button
            key={r.id}
            className={`run-row${open ? ' selected' : ''}`}
            /* `D1253` — the state, beside the styling. A list of ten toggles where the only signal
               is a border colour tells a reader with the page in front of them and nobody else. */
            aria-pressed={open}
            onClick={() => onSelect({ kind: 'report', id: r.id })}
            data-report-row={r.id}
            data-ok={r.summary ? String(r.summary.ok) : 'unknown'}
            data-report-current={r.current === true ? '' : undefined}
            /* `D1255` — the directory name, in the one place a value you might need to copy
               belongs. `D1127`'s derived tips are the precedent: a tip is what the row would say
               if you asked it, and a report directory is exactly that kind of fact. */
            data-tip={`the evidence this run left, kept at \`${r.path}\`${r.current === true ? ' — and this is what `report/current` holds, so `tflw report` opens it' : ''}`}
          >
            <span className={`dot ${r.summary ? (r.summary.ok ? 'ok' : 'fail') : 'none'}`} />
            {/* The date leads, because it is the one thing that tells two runs apart at a glance.
                A directory with no `results.json` has no date to lead with, and falls back to its
                own name rather than to an empty row. */}
            {/* Relative, with the absolute form and its zone in the tip (`M239-05`): the chip is read
                at a glance and the question is *is this about the code in front of me*. The
                directory name is the id, not a date, and stays as it is in the compare select. */}
            <span data-run-when={r.at ?? ''} data-tip={r.at ? when(r.at) : undefined}>{r.at ? ago(r.at, now) : r.id}</span>
            {r.current === true ? (
              <span className="badge also" data-row-current>
                current
              </span>
            ) : null}
            {r.summary ? (
              <span className="muted" data-row-counts>
                {r.summary.passed}/{r.summary.total}
              </span>
            ) : null}
          </button>
        );
      })}
      {live.length === 0 && unkept.length === 0 && reports.length === 0 ? <p className="muted empty">no runs yet — run the project, or open it after a terminal run</p> : null}
    </nav>
  );
}
