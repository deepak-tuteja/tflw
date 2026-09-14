// The shell (`M192` U2): the project on the left, the runs across the top, the selected run
// below. State is what the server said and nothing else — the page holds no truth of its own.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRun, getProject, getReports, getResults, getRuns, getStderr, reportFileUrl, startRun, subscribe } from './api';
import type { EndEvent, ProjectView, ReportDir, RunRecord, RunReport, RunRequest } from './contract';
import { addNoise, EMPTY_LIVE, reduceLive, type LiveState } from './live';
import { reportIdOf } from './format';
import { LiveBody, ReportBody, ReportHeader } from './ReportView';
import { Findings } from './Findings';
import { RunList, type Selection } from './RunList';
import { Sidebar } from './Sidebar';

interface LiveRun {
  readonly id: string;
  readonly state: LiveState;
  readonly end: EndEvent | null;
  readonly stderr: string | null;
}

export function App() {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<readonly RunRecord[]>([]);
  const [reports, setReports] = useState<readonly ReportDir[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [report, setReport] = useState<{ id: string; data: RunReport } | null>(null);
  // U4 — a second directory opened beside the selected one (§2 q6). Chosen per selection: it
  // is dropped when the selection changes, so a comparison is always between two named runs.
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ id: string; data: RunReport } | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  const refreshLists = useCallback(async () => {
    const [r, p] = await Promise.all([getRuns(), getReports()]);
    setRuns(r);
    setReports(p);
    return p;
  }, []);

  useEffect(() => {
    getProject()
      .then(setProject)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    refreshLists()
      .then((p) => {
        if (p[0]) setSelected({ kind: 'report', id: p[0].id });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshLists]);

  // A selected report directory is read once — `results.json` is the merged `RunReport`.
  useEffect(() => {
    if (selected?.kind !== 'report') return;
    const id = selected.id;
    setCompareId(null);
    getResults(id)
      .then((data) => setReport({ id, data }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [selected]);

  useEffect(() => {
    if (compareId === null) {
      setCompare(null);
      return;
    }
    const id = compareId;
    getResults(id)
      .then((data) => setCompare({ id, data }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [compareId]);

  const watch = useCallback(
    (id: string) => {
      unsubscribe.current?.();
      setLive({ id, state: EMPTY_LIVE, end: null, stderr: null });
      unsubscribe.current = subscribe(id, {
        event: (e) => setLive((l) => (l && l.id === id ? { ...l, state: reduceLive(l.state, e) } : l)),
        noise: (line) => setLive((l) => (l && l.id === id ? { ...l, state: addNoise(l.state, line) } : l)),
        end: (end) => {
          setLive((l) => (l && l.id === id ? { ...l, end } : l));
          void refreshLists();
          if (end.kept) setSelected({ kind: 'report', id: reportIdOf(end.kept) });
          else getStderr(id).then((stderr) => setLive((l) => (l && l.id === id ? { ...l, stderr } : l)));
        },
      });
    },
    [refreshLists],
  );

  const onRun = useCallback(
    async (request: RunRequest) => {
      try {
        const record = await startRun(request);
        setSelected({ kind: 'run', id: record.id });
        await refreshLists();
        watch(record.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshLists, watch],
  );

  // Selecting a run row that is still in flight (re)attaches to its stream — the server replays
  // every line first, so a page opened mid-run sees the whole of it.
  useEffect(() => {
    if (selected?.kind === 'run' && live?.id !== selected.id) watch(selected.id);
  }, [selected, live?.id, watch]);

  const running = runs.some((r) => r.status === 'running');
  const onCancel = useCallback(() => {
    const r = runs.find((x) => x.status === 'running');
    if (r) void cancelRun(r.id).then(refreshLists);
  }, [runs, refreshLists]);

  return (
    <div className="app">
      {project ? <Sidebar project={project} running={running} onRun={onRun} onCancel={onCancel} /> : <aside className="sidebar muted">{error ?? 'reading the project…'}</aside>}
      <main className="main">
        <RunList runs={runs} reports={reports} selected={selected} onSelect={setSelected} />
        {error ? (
          <p className="error" data-error>
            {error}
          </p>
        ) : null}
        {selected?.kind === 'run' && live && live.id === selected.id ? <LivePane live={live} /> : null}
        {selected?.kind === 'report' && report && report.id === selected.id ? (
          <article className="report" data-report={report.id}>
            <ReportHeader report={report.data} />
            <p className="muted files-line">
              {reports.length > 1 ? (
                <label className="compare">
                  compare with{' '}
                  <select value={compareId ?? ''} onChange={(e) => setCompareId(e.target.value === '' ? null : e.target.value)} data-compare>
                    <option value="">— nothing —</option>
                    {reports
                      .filter((r) => r.id !== report.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              {reports
                .find((r) => r.id === report.id)
                ?.files.map((f) => (
                  <a key={f} href={reportFileUrl(report.id, f)} target="_blank" rel="noreferrer" data-report-file={f}>
                    {f}
                  </a>
                ))}
            </p>
            <Findings report={report.data} compare={compare && compare.id === compareId ? compare : null} />
            <ReportBody tests={report.data.tests} context={{ id: report.id, evidenceLevel: report.data.evidenceLevel, traceViewer: project?.traceViewer ?? false, compare: compare && compare.id === compareId ? compare : null }} />
          </article>
        ) : null}
        {selected === null && !error ? <p className="muted empty">select a run</p> : null}
      </main>
    </div>
  );
}

function LivePane({ live }: { live: LiveRun }) {
  const done = live.state.tests.filter((t) => t.result !== null);
  const failed = done.filter((t) => t.result && !t.result.ok).length;
  return (
    <article className="report live" data-live={live.id} data-live-status={live.end ? live.end.status : 'running'}>
      <header className="report-head">
        <span className={`verdict ${live.end ? (live.end.status === 'cancelled' ? 'warn' : failed > 0 ? 'fail' : 'ok') : 'running'}`}>
          {live.end ? (live.end.status === 'cancelled' ? 'CANCELLED' : `exit ${live.end.exitCode}`) : 'RUNNING'}
        </span>
        <span data-live-counts>
          {done.length} of {live.state.announced || '?'} done · {failed} failed
        </span>
      </header>
      {live.stderr ? <pre className="stderr" data-stderr>{live.stderr}</pre> : null}
      {live.state.noise.length > 0 ? <pre className="stderr">{live.state.noise.join('\n')}</pre> : null}
      <LiveBody tests={live.state.tests} />
    </article>
  );
}
