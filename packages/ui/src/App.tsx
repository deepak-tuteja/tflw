// The shell (`M192` U2, widened by `M200` `A0-3`): four doors, then the project on the left, the
// runs across the top, the selected run below. State is what the server said and nothing else —
// the page holds no truth of its own.
//
// The door lives in the URL hash and nowhere else (`D1045`). It is a view of a project rather
// than a fact about one, so there is no `.tflw-ui/` anything to remember it in, and a link to
// `#/load` is a link to the LOAD door of whatever project this server is serving.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRun, getConfig, getProject, getReports, getResults, getRuns, getStderr, putConfig, reportFileUrl, startRun, subscribe } from './api';
import type { EndEvent, Lens, ProjectView, ReportDir, RunRecord, RunReport, RunRequest } from './contract';
import { DEFAULT_TAB, doorFromHash, fileFromHash, focusFromHash, hashForDoor, hashForTab, tabFromHash, type TabId } from './doors';
import { Landing } from './Landing';
import { DoorBar } from './DoorBar';
import { LoadForm } from './LoadForm';
import { ApiForm } from './ApiForm';
import { AuthPanel } from './AuthPanel';
import { ConfigPanel } from './ConfigPanel';
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
  /** The file every tab is about (`M206` `Q4`). It lives in the hash for `D1045`'s reason and is
   *  held here rather than in each form, which is where it used to live **twice** — `ApiForm` and
   *  `BrowserForm` each kept their own `useState(files[0] ?? '')`, so a door change reset it. */
  const [file, setFileState] = useState<string | null>(() => fileFromHash(window.location.hash));
  /** The line Config was asked to land on (`M205` S5b), read off the end of the hash. `null` for
   *  every address that does not name one, which is every address anybody had before `S5b`. */
  const [focusLine, setFocusLine] = useState<number | null>(() => focusFromHash(window.location.hash));
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
      setFileState(fileFromHash(window.location.hash));
      setFocusLine(focusFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setDoor = useCallback(
    (next: Lens | null) => {
      // A door change **keeps the file and resets the tab** (`M206` `Q4`).
      //
      // The reset is unchanged; its reason is not. This used to read "the door decides which file
      // you land on", which stopped being true the moment the file moved into the address — the
      // address decides, and the door is a view of it. What survives is the narrower claim: a tab
      // is a stage of *this* file's life, and the stage you were at in one kind of work says
      // nothing about the stage you are at in another. Landing on BROWSER's Source because you
      // were reading API's is a guess; landing on Compose is the door's own promise (`D1042`).
      const next_hash = next === null ? hashForDoor(null) : hashForTab(next, DEFAULT_TAB, file);
      window.location.hash = next_hash;
      setDoorState(next);
      setTabState(DEFAULT_TAB);
      setFocusLine(null);
    },
    [file],
  );
  const setTab = useCallback(
    (next: TabId, focus?: number) => {
      if (door !== null) window.location.hash = hashForTab(door, next, file, focus);
      setTabState(next);
      setFocusLine(focus ?? null);
    },
    [door, file],
  );
  /** Choosing a different file. It drops the focus line, because a line number is an offset into
   *  the file that named it and means nothing in the next one. */
  const setFile = useCallback(
    (next: string) => {
      if (door !== null) window.location.hash = hashForTab(door, tab, next);
      setFileState(next);
      setFocusLine(null);
    },
    [door, tab],
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

  /**
   * The Config tab's editor state — **held in the shell**, which is `S5a`'s finding applied a
   * second time and one level higher (`M206` `S2a`).
   *
   * The strip swaps panels by unmounting them, so state inside a panel is lost on a tab trip. The
   * Compose fields survive that only because they are `useState` in *this* component, which the
   * strip never unmounts — a fact `S5a` discovered by mutating `hidden` to unmounted and watching
   * a green gate stay green. A half-edited `tflw.config` thrown away by a glance at Auth would be
   * exactly the failure the Compose fields were saved from, and the fix is the same fix: the state
   * lives above the panel.
   *
   * `S5a` put it in `ApiForm`, which was the right height while one door had a strip. It is wrong
   * the moment a second door gets one: `tflw.config` is a **project** fact, so a copy per door
   * would be four editors over one file, disagreeing about what is unsaved. That is the same
   * duplicate `S1` removed for the selected file, caught before it was written rather than after.
   */
  const [configText, setConfigText] = useState<string | null>(null);
  /** What is on disk as of the last read or write — the oracle for *is there anything to save*. */
  const [configDisk, setConfigDisk] = useState<string | null>(null);
  const [configEtag, setConfigEtag] = useState<string | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configProblem, setConfigProblem] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState<string | null>(null);

  /**
   * Read `tflw.config` the first time Config is opened, and never otherwise.
   *
   * Lazily, because the project view is re-read after every write and a config carried on it would
   * be re-fetched on every one of those for a tab most authors will never open — and eagerly here
   * would also mean choosing what to do when the page's unsaved text disagrees with a fresher
   * read. Once is the honest answer: the etag is what detects a config changed underneath, and it
   * detects it at the moment it matters, as the `409` that guard exists for.
   */
  const readConfig = useCallback(() => {
    setConfigProblem(null);
    setConfigSaved(null);
    return getConfig()
      .then((c) => {
        setConfigText(c.text);
        setConfigDisk(c.text);
        setConfigEtag(c.etag);
      })
      .catch((e: unknown) => setConfigProblem(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (tab !== 'config' || configText !== null) return;
    void readConfig();
  }, [tab, configText, readConfig]);

  const saveConfig = useCallback(async () => {
    if (configText === null || configEtag === null) return;
    setConfigBusy(true);
    setConfigProblem(null);
    setConfigSaved(null);
    try {
      const put = await putConfig(configText, configEtag);
      if (!put.ok) {
        // A `409` is the one refusal with no repair inside this page, so it gets a gesture rather
        // than a sentence: `re-read from disk` is offered beside it, and it is a button because
        // taking it throws away what you typed. The first draft said *reopen this tab to read it
        // again*, which was false — the read fires once, when the text is still `null`, so
        // leaving and coming back returns the same stale bytes and the same 409. Found by reading
        // the advice against the effect that would have to honour it.
        setConfigProblem(put.error);
        return;
      }
      setConfigEtag(put.etag);
      setConfigDisk(configText);
      setConfigSaved('saved — tflw.config is what you see here');
      // The project view carries the sessions and the authorized targets Auth reads, and both
      // just changed. `D985` again: the page is a projection of the files, so it re-reads rather
      // than patching what it thinks it wrote.
      void readProjectView();
    } finally {
      setConfigBusy(false);
    }
  }, [configText, configEtag, readProjectView]);



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
   * The runs, as one node — and since `M207` `S2` there is exactly **one** place it is put.
   *
   * `M205` S5 built this with two placements: API's strip held it in a Run tab and the other three
   * doors stacked it under their form, where it had been since `M192`. That was the round's scope
   * showing in the code rather than only in a plan, and it was always meant to end — `M206` `S2b`
   * took BROWSER, `M207` `S1` took LOAD and this slice takes SCANS. **Every door now reaches its
   * runs through Run and no door renders them inline**, so the conditional that chose between the
   * two placements is gone rather than narrowed to a door that no longer needs it.
   *
   * It is still built once and handed down, which is what kept two placements from becoming two
   * renderings for the three rounds they coexisted.
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

  /**
   * The file the strip is about, resolved once (`M206` `S1`, `S2a`).
   *
   * `fileFromHash` reports what the address says and never asks the project whether it is true, so
   * somebody has to fall back when a hash names a file that has been renamed or deleted. That was
   * each form's job in `S1` — the same expression in two places, which is the shape `S1` was
   * removing — and it is the shell's now, because the shell is what hands the file to the panels.
   */
  const filePaths = project?.files.map((f) => f.path) ?? [];
  const path = file !== null && filePaths.includes(file) ? file : (filePaths[0] ?? '');

  /**
   * The strip's two **project-fact** tabs, built here and handed to whichever door is open.
   *
   * This is the rule's own split showing up in the code (`M205` §2): a tab is *a stage of one
   * file's life* — Compose and Source, which each door owns because Compose is the only thing that
   * varies by the kind of work — or *a project fact that file resolves against*, which is Auth and
   * Config, and a project fact has no business being built four times. `Run` was already here for
   * the same reason.
   */
  const authPanel = project ? <AuthPanel project={project} path={path} onEdit={(line) => setTab('config', line)} /> : null;
  const configPanel = (
    <ConfigPanel
      text={configText}
      disk={configDisk}
      onChange={(next) => {
        setConfigText(next);
        // The `saved` line is a claim about the bytes on disk, and one keystroke makes it false.
        // It goes the moment the text moves, rather than sitting under an edit it no longer
        // describes.
        setConfigSaved(null);
      }}
      onSave={() => void saveConfig()}
      onReload={() => void readConfig()}
      busy={configBusy}
      problem={configProblem}
      saved={configSaved}
      focusLine={focusLine}
    />
  );
  /** Config has something to say while you are elsewhere only when it is holding an unsaved edit. */
  const configMark = configText !== null && configDisk !== null && configText !== configDisk ? 'tflw.config has an edit nobody has saved' : undefined;

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
            filePath={path}
            onFile={setFile}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
          />
        ) : null}
        {project && door === 'api' ? (
          <ApiForm
            project={project}
            onWritten={() => void readProjectView()}
            tab={tab}
            onTab={setTab}
            path={path}
            onFile={setFile}
            focusLine={focusLine}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
          />
        ) : null}
        {project && door === 'scan' ? (
          <ScanForm
            project={project}
            onWritten={() => void readProjectView()}
            filePath={path}
            onFile={setFile}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
          />
        ) : null}
        {project && door === 'browser' ? (
          <BrowserForm
            project={project}
            onWritten={() => void readProjectView()}
            filePath={path}
            onFile={setFile}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
          />
        ) : null}
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
