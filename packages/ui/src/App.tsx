// The shell (`M192` U2, widened by `M200` `A0-3`): four doors, then the project on the left, the
// runs across the top, the selected run below. State is what the server said and nothing else —
// the page holds no truth of its own.
//
// The door lives in the URL hash and nowhere else (`D1045`). It is a view of a project rather
// than a fact about one, so there is no `.tflw-ui/` anything to remember it in, and a link to
// `#/load` is a link to the LOAD door of whatever project this server is serving.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRun, getProject, getReports, getResults, getRuns, getStderr, reportFileUrl, startRun, subscribe } from './api';
import type { EndEvent, Lens, ProjectView, ReportDir, RunRecord, RunReport, RunRequest } from './contract';
import { doorFromHash, hashForDoor, hashForTab, tabFromHash, type TabId } from './doors';
import { Landing } from './Landing';
import { DoorBar } from './DoorBar';
import { LoadForm } from './LoadForm';
import { ApiForm } from './ApiForm';
import { ScanForm } from './ScanForm';
import { BrowserForm } from './BrowserForm';
import { addNoise, EMPTY_LIVE, liveCounts, reduceLive, type LiveState } from './live';
import { exitExplained, reportIdOf } from './format';
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
  const [door, setDoorState] = useState<Lens | null>(() => doorFromHash(window.location.hash));
  /** Which stage of the selected file is showing (`M205` §2). It is the hash's second segment, so
   *  a tab is linkable and the back button walks it — the same rule `D1045` makes for the door. */
  const [tab, setTabState] = useState<TabId>(() => tabFromHash(window.location.hash));
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
  // U7 — the process behind a kept directory, when its exit is not the report's own verdict.
  const [exitNote, setExitNote] = useState<{ id: string; run: RunRecord; stderr: string } | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  // The hash is the source of truth for the door, so the back button works and a pasted link
  // opens where it says. `setDoor` writes the hash; the listener is what actually moves the page.
  useEffect(() => {
    const onHash = () => {
      setDoorState(doorFromHash(window.location.hash));
      setTabState(tabFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setDoor = useCallback((next: Lens | null) => {
    // A door change resets the tab, because the tab is a stage of a file and the door decides
    // which file you land on. Carrying `source` across a door change would land you reading a
    // file you did not choose.
    window.location.hash = hashForDoor(next);
    setDoorState(next);
    setTabState(tabFromHash(hashForDoor(next)));
  }, []);
  const setTab = useCallback(
    (next: TabId) => {
      if (door !== null) window.location.hash = hashForTab(door, next);
      setTabState(next);
    },
    [door],
  );

  const refreshLists = useCallback(async () => {
    const [r, p] = await Promise.all([getRuns(), getReports()]);
    setRuns(r);
    setReports(p);
    return p;
  }, []);

  const [noProject, setNoProject] = useState(false);

  const readProjectView = useCallback(() => {
    return getProject()
      .then((p) => {
        setProject(p);
        setNoProject(p === null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    void readProjectView();
    refreshLists()
      .then((p) => {
        // Only when nothing was chosen meanwhile — a run started before the list arrived (U7's
        // gate did exactly that) would otherwise be unselected by the page's own first load.
        if (p[0]) setSelected((s) => s ?? { kind: 'report', id: p[0]!.id });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshLists, readProjectView]);

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
    if (!report) return;
    const run = runs.find((r) => r.kept !== null && reportIdOf(r.kept) === report.id);
    if (!run || run.status === 'running' || exitExplained(run, report.data)) {
      setExitNote(null);
      return;
    }
    const id = report.id;
    getStderr(run.id)
      .then((stderr) => setExitNote({ id, run, stderr }))
      .catch(() => setExitNote({ id, run, stderr: '' }));
  }, [report, runs]);

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

  if (door === null || noProject) {
    // A door onto nothing is not a door: until there is a `tflw.config`, every path leads back
    // to the landing, which is where a project can be made (`A0-5`).
    return <Landing project={project} error={error} noProject={noProject} onOpen={setDoor} onCreated={() => void readProjectView()} />;
  }

  /**
   * The runs, as one node placed in one of two ways (`M205` S5).
   *
   * The API door puts it **inside the strip's Run tab**; the other three keep it under their form,
   * where it has been since `M192`. That is the round's scope showing in the code rather than only
   * in a plan: the strip is adopted for one door and propagates once BROWSER, LOAD and SCANS have
   * been grilled against its rule. Built once either way, so the two placements cannot become two
   * renderings.
   */
  const runPane = (
    <>
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
          {exitNote && exitNote.id === report.id ? (
            <div className="warn run-exit" data-run-exit={exitNote.run.exitCode ?? ''} data-run-status={exitNote.run.status}>
              ⚠ the run behind this directory {exitNote.run.status === 'cancelled' ? 'was cancelled from this page' : 'ended'} with{' '}
              {exitNote.run.exitCode !== null ? `exit ${exitNote.run.exitCode}` : `signal ${exitNote.run.signal}`} — the report is what it had written by then, and its verdict does not say so.
              {exitNote.stderr ? (
                <pre className="stderr" data-run-stderr>
                  {exitNote.stderr}
                </pre>
              ) : null}
            </div>
          ) : null}
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
    </>
  );

  return (
    <div className="app">
      {project ? <Sidebar project={project} door={door} running={running} onRun={onRun} onCancel={onCancel} /> : <aside className="sidebar muted">{error ?? 'reading the project…'}</aside>}
      <main className="main">
        {project ? <DoorBar project={project} door={door} onDoor={setDoor} /> : null}
        {/* `D1042`: the door decides what the "new test" surface is, and nothing else. LOAD's is
            `A0-4`'s form and API's is `A1-4`'s; BROWSER and SCANS have theirs in `A2`–`A3`. */}
        {project && door === 'load' ? (
          <LoadForm
            project={project}
            onWritten={() => {
              // The page is a projection of the file (`D985`), so after a write the projection is
              // re-read rather than patched — the server is what says what the file now holds.
              void readProjectView();
            }}
          />
        ) : null}
        {project && door === 'api' ? (
          <ApiForm
            project={project}
            onWritten={() => void readProjectView()}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
          />
        ) : null}
        {project && door === 'scan' ? <ScanForm project={project} onWritten={() => void readProjectView()} /> : null}
        {project && door === 'browser' ? <BrowserForm project={project} onWritten={() => void readProjectView()} /> : null}
        {door === 'api' ? null : runPane}
      </main>
    </div>
  );
}

function LivePane({ live }: { live: LiveRun }) {
  const { done, failed } = liveCounts(live.state);
  return (
    <article className="report live" data-live={live.id} data-live-status={live.end ? live.end.status : 'running'}>
      <header className="report-head">
        <span className={`verdict ${live.end ? (live.end.status === 'cancelled' ? 'warn' : live.end.exitCode === 0 ? 'ok' : 'fail') : 'running'}`}>
          {live.end ? (live.end.status === 'cancelled' ? 'CANCELLED' : `exit ${live.end.exitCode}`) : 'RUNNING'}
        </span>
        <span data-live-counts>
          {done} of {live.state.announced || '?'} done · {failed} failed
        </span>
      </header>
      {live.stderr ? <pre className="stderr" data-stderr>{live.stderr}</pre> : null}
      {live.state.noise.length > 0 ? <pre className="stderr">{live.state.noise.join('\n')}</pre> : null}
      <LiveBody tests={live.state.tests} />
    </article>
  );
}
