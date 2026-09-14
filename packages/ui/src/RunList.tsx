// The run list (`M192` U2): a run is a report directory (§2 q6) — `current` is what the last
// `tflw run` wrote, `runs/<id>` is what the server kept — and, above them, the runs this server
// started that are still in flight, which have no directory yet.

import type { ReportDir, RunRecord } from './contract';
import { when } from './format';

export type Selection = { readonly kind: 'run'; readonly id: string } | { readonly kind: 'report'; readonly id: string } | null;

export interface RunListProps {
  readonly runs: readonly RunRecord[];
  readonly reports: readonly ReportDir[];
  readonly selected: Selection;
  readonly onSelect: (s: Selection) => void;
}

export function RunList({ runs, reports, selected, onSelect }: RunListProps) {
  const live = runs.filter((r) => r.status === 'running');
  return (
    <nav className="runs" data-runs>
      {live.map((r) => (
        <button key={r.id} className={`run-row running${selected?.kind === 'run' && selected.id === r.id ? ' selected' : ''}`} onClick={() => onSelect({ kind: 'run', id: r.id })} data-run-row={r.id} data-status={r.status}>
          <span className="dot running" />
          <span>running</span>
          <span className="muted">{when(r.startedAt)}</span>
        </button>
      ))}
      {reports.map((r) => (
        <button
          key={r.id}
          className={`run-row${selected?.kind === 'report' && selected.id === r.id ? ' selected' : ''}`}
          onClick={() => onSelect({ kind: 'report', id: r.id })}
          data-report-row={r.id}
          data-ok={r.summary ? String(r.summary.ok) : 'unknown'}
        >
          <span className={`dot ${r.summary ? (r.summary.ok ? 'ok' : 'fail') : 'none'}`} />
          <span>
            {r.id === 'current' ? 'current' : r.id}
            {r.summary ? (
              <span className="muted" data-row-counts>
                {' '}
                {r.summary.passed}/{r.summary.total}
              </span>
            ) : null}
          </span>
          <span className="muted">{r.at ? when(r.at) : ''}</span>
        </button>
      ))}
      {live.length === 0 && reports.length === 0 ? <p className="muted empty">no runs yet — run the project, or open it after a terminal run</p> : null}
    </nav>
  );
}
