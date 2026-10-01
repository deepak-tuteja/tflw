// **The Run tab** — `M257` `B`/`C` (`D1409`).
//
// A run is read as a tree by verdict: one headline that carries exactly one verdict, a run picker
// where the chip row was, and on the left the tests grouped `failed` · `inconclusive` · `skipped` ·
// `passed` — the failures open and the passes one folded row with a count — then `security` and
// `history` as rows of their own. Picking a test draws it on the right, its failing step open and
// the passing ones folded (`StepRow`'s own rule), and the compared run's same step one line under
// each. A run in flight is the same tree with a `running` group at the top, built from the stream
// by `live.ts` — one renderer for both, which `M192` U2 asked of the view this replaces.
//
// **THE DETAIL IS ONE TEST, NOT THE REPORT.** `ReportView` drew every test with every step, which
// is how a run of seventeen passing tests came to 8 982 px (plan §0). The tree is the index; the
// right-hand side is one test at a time, and the page opens on the first failure because that is
// what a reader who opened a failing run came to read.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AttemptResult, CrawlResult, HistoryView, ReportDir, ReportEntry, RunRecord, RunReport, ScanFinding, StepResult, TestResult, TraceAsset, WorkloadTestResult } from './contract';
import type { LiveRun } from './live';
import { liveCounts } from './live';
import { BROWSER_KINDS, tracePath } from './assets';
import { ago, ms, when } from './format';
import { reportFileUrl } from './api';
import { StepRow } from './StepRow';
import { OPENS_GROUP } from './ran';
import { Workload } from './Workload';
import { Findings, securitySummary } from './Findings';
import { HistoryDots, testPast } from './History';
import { RunList, type Selection } from './RunList';
import { grouped, headlineOf, openingItem, OPEN_AT_REST, runInconclusive, treeOfLive, treeOfReport, type TreeItem } from './runTree';

/** What the pane is showing: a kept report, a run in flight (or one that ended with no report), or
 *  nothing picked yet. */
export type RunSubject =
  | { readonly kind: 'report'; readonly id: string; readonly data: RunReport }
  | { readonly kind: 'live'; readonly live: LiveRun }
  | null;

export interface ExitNote {
  readonly id: string;
  readonly run: RunRecord;
  readonly stderr: string;
}

export interface RunViewProps {
  readonly subject: RunSubject;
  readonly runs: readonly RunRecord[];
  readonly reports: readonly ReportDir[];
  readonly selected: Selection;
  readonly onSelect: (s: Selection) => void;
  readonly compareId: string | null;
  readonly compare: { readonly id: string; readonly data: RunReport } | null;
  readonly onCompare: (id: string | null) => void;
  readonly exitNote: ExitNote | null;
  readonly history: HistoryView | null;
  readonly traceViewer: boolean;
  readonly onOpenTrace: (path: string) => void;
  readonly onAccept: ((f: ScanFinding) => void) | null;
  /** The declared line of a test in the project, for `open in Compose`; `null` when the project no
   *  longer declares it (renamed, or a row-expanded name). */
  readonly lineOf: (file: string, name: string) => number | null;
  readonly onCompose: (file: string, line: number) => void;
  readonly onRerun: (file: string, name: string) => void;
  readonly running: boolean;
}

/** The right-hand side: a test by its tree key, or one of the two project rows. */
type Pick = { readonly kind: 'test'; readonly key: string } | { readonly kind: 'security' } | { readonly kind: 'history' } | null;

export function RunView(props: RunViewProps) {
  const { subject, runs, reports, selected, onSelect, compareId, compare, onCompare, exitNote, history, traceViewer, onOpenTrace, onAccept, lineOf, onCompose, onRerun, running } = props;
  const report = subject?.kind === 'report' ? subject.data : null;
  const live = subject?.kind === 'live' ? subject.live : null;
  const subjectId = subject === null ? null : subject.kind === 'report' ? subject.id : subject.live.id;

  const items = useMemo<readonly TreeItem[]>(() => (report !== null ? treeOfReport(report) : live !== null ? treeOfLive(live.state.tests) : []), [report, live]);

  // ── The filter (`M241` `E`, `D1325`): a name and a file. *failed* and *skipped* are groups now.
  const [text, setText] = useState('');
  const [fileOnly, setFileOnly] = useState('');
  const files = useMemo(() => [...new Set(items.map((i) => i.file))], [items]);
  const needle = text.trim().toLowerCase();
  const shown = items.filter((i) => (fileOnly === '' || i.file === fileOnly) && (needle === '' || i.name.toLowerCase().includes(needle)));

  const security = report === null ? null : securitySummary(report, compare);

  // ── What the right-hand side shows. A new subject opens on its first failure; a run in flight
  //    follows the test that is running until the reader picks something themselves.
  const [pick, setPick] = useState<Pick>(null);
  const readerPicked = useRef(false);
  useEffect(() => {
    readerPicked.current = false;
    const first = openingItem(items);
    setPick(first !== null ? { kind: 'test', key: first.key } : security !== null && report !== null && (report.findings ?? []).length > 0 ? { kind: 'security' } : null);
    // Deliberately keyed on the subject alone: a stream that grows must not re-open the pane.
  }, [subjectId]);
  useEffect(() => {
    if (live === null || readerPicked.current) return;
    const current = [...items].reverse().find((i) => i.group === 'running') ?? openingItem(items) ?? items[items.length - 1];
    if (current !== undefined) setPick({ kind: 'test', key: current.key });
  }, [live, items]);
  const choose = (p: Pick): void => {
    readerPicked.current = true;
    setPick(p);
  };
  const picked = pick?.kind === 'test' ? shown.find((i) => i.key === pick.key) ?? null : null;

  // ── The headline.
  const cancelled = exitNote?.run.status === 'cancelled' || live?.end?.status === 'cancelled';
  const head = headlineOf(items, { cancelled, inconclusive: report !== null && runInconclusive(report), running: live !== null && live.end === null });
  /* A run that ended with no report and did not pass never reached a verdict about any test, and its
     exit is the only fact there is — U7 found a green `exit 2` keyed on a failed count of zero. */
  const unstarted = live !== null && live.end !== null && live.end.kept === null && live.end.status !== 'cancelled' && live.end.exitCode !== 0;
  const verdictText = unstarted ? `exit ${live.end!.exitCode ?? '?'}` : head.count === null ? head.word : `${head.count} ${head.word}`;
  const tone = unstarted ? 'fail' : head.tone;

  const dir = report !== null && subjectId !== null ? reports.find((r) => r.id === subjectId) ?? null : null;

  return (
    <article className="report run-view" {...(report !== null ? { 'data-report': subjectId ?? '' } : live !== null ? { 'data-live': live.id, 'data-live-status': live.end ? live.end.status : 'running' } : { 'data-run-none': '' })}>
      <header className="run-head">
        {/* The page's second heading level: a test's name under it is an `h3` (axe's heading-order). */}
        <h2 className="run-headline" data-summary data-headline={head.word} data-ok={report !== null ? String(report.ok) : undefined}>
          <span className={`verdict ${tone}`} data-verdict={unstarted ? 'EXIT' : head.word}>
            {verdictText}
          </span>
          {head.counts.length > 0 ? <span data-counts> · {head.counts.join(' · ')}</span> : null}
          {live !== null ? <LiveCounts live={live} /> : null}
          {report !== null ? <span className="muted" data-run-ms> · {ms(report.durationMs)}</span> : null}
        </h2>
        <div className="run-bar">
          <RunPicker runs={runs} reports={reports} selected={selected} onSelect={onSelect} />
          {report !== null ? (
            <span className="muted">
              {/* The start as an instant, not an age: the picker beside it already says how long ago
                  the run was kept, and two ages in one line read as a contradiction whenever the
                  two instants differ (a copied or touched run directory). */}
              env <code data-env>{report.env}</code> · started <span data-run-started={report.startedAt}>{when(report.startedAt)}</span>
            </span>
          ) : null}
          {report !== null && reports.length > 1 ? (
            <label className="compare">
              compare{' '}
              <select value={compareId ?? ''} onChange={(e) => onCompare(e.target.value === '' ? null : e.target.value)} data-compare aria-label="compare with another run">
                <option value="">— nothing —</option>
                {reports
                  .filter((r) => r.id !== subjectId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.at ? `${ago(r.at, Date.now())} · ${r.id}` : r.id}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          {dir?.artefacts.map((f) => (
            <a key={f} href={reportFileUrl(dir.id, f)} target="_blank" rel="noreferrer" data-report-file={f}>
              {f}
            </a>
          ))}
        </div>
        {report?.evidenceLevel && report.evidenceLevel !== 'full' ? (
          <p className="muted" data-evidence-level={report.evidenceLevel}>
            evidence <code>{report.evidenceLevel}</code> — {report.evidenceLevel === 'none' ? 'no headers and no bodies are in this report' : 'response bodies are not in this report'}
          </p>
        ) : null}
        {report?.aborted ? <p className="warn" data-run-aborted>cut short{report.abortedMessage ? ` — ${report.abortedMessage}` : ''}</p> : null}
      </header>

      {exitNote !== null && report !== null && exitNote.id === subjectId ? (
        <div className="warn run-exit" data-run-exit={exitNote.run.exitCode ?? ''} data-run-status={exitNote.run.status}>
          ⚠ the run that wrote this report {exitNote.run.status === 'cancelled' ? 'was cancelled from this page' : 'ended'} with{' '}
          {exitNote.run.exitCode !== null ? `exit ${exitNote.run.exitCode}` : `signal ${exitNote.run.signal}`} — the report is what it had written by then.
          {exitNote.stderr ? (
            <pre className="stderr" data-run-stderr>
              {exitNote.stderr}
            </pre>
          ) : null}
        </div>
      ) : null}
      {live?.stderr ? <pre className="stderr" data-stderr>{live.stderr}</pre> : null}
      {live !== null && live.state.noise.length > 0 ? <pre className="stderr">{live.state.noise.join('\n')}</pre> : null}

      {subject === null ? (
        <p className="muted empty" data-run-empty>
          {runs.length === 0 && reports.length === 0 ? 'no runs yet — ▶ runs the tests the explorer shows' : 'pick a run above'}
        </p>
      ) : (
        <div className="run-body">
          <nav className="run-tree" data-run-tree aria-label="the run's tests, by verdict">
            {items.length > 0 ? (
              <div className="report-filter" data-report-filter data-report-shown={shown.length} data-report-total={items.length}>
                <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="a test name" aria-label="a test name" data-filter-text data-tip="tests whose name holds this text" />
                {files.length < 2 ? null : (
                  <select value={fileOnly} onChange={(e) => setFileOnly(e.target.value)} data-filter-file aria-label="one file" data-tip="the tests of one file">
                    <option value="">every file</option>
                    {files.map((f) => (
                      <option key={f} value={f}>
                        {f || '(no file)'}
                      </option>
                    ))}
                  </select>
                )}
                {shown.length === items.length ? null : (
                  <span className="muted" data-report-narrowed>
                    {shown.length} of {items.length}
                  </span>
                )}
              </div>
            ) : null}
            {grouped(shown).map(([group, list]) => (
              /* A narrowing filter opens every group it matched: the reader searched for these rows, and a
                 match inside a folded `passed 1` is a second press to find what was just typed. */
              <details key={`${subjectId}-${group}`} className={`tree-group g-${group}`} open={OPEN_AT_REST.has(group) || shown.length < items.length || (picked !== null && picked.group === group)} data-tree-group={group} data-tree-count={list.length}>
                <summary>
                  {group} <span className="count">{list.length}</span>
                </summary>
                <ul>
                  {list.map((i) => (
                    <li key={i.key}>
                      <button
                        type="button"
                        className={`tree-test${picked?.key === i.key ? ' on' : ''}`}
                        aria-pressed={picked?.key === i.key}
                        onClick={() => choose({ kind: 'test', key: i.key })}
                        data-tree-test={i.group}
                        data-name={i.name}
                        data-file={i.file}
                        data-tip-derived=""
                      >
                        <span className={`dot ${dotOf(i.group)}`} />
                        {/* A long name is cut with an ellipsis, and the tip is DERIVED from what the
                            ellipsis took (`D1127`) — a test's name is the run's data, not a sentence. */}
                        <span className="tree-name" data-tip-text>{i.name}</span>
                        {i.entry !== null && 'durationMs' in i.entry ? <span className="muted tms">{ms(i.entry.durationMs)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {items.length > 0 && shown.length === 0 ? <p className="muted" data-tree-none>no test here matches</p> : null}
            {security !== null ? (
              <button type="button" className={`tree-row${pick?.kind === 'security' ? ' on' : ''}`} aria-pressed={pick?.kind === 'security'} onClick={() => choose({ kind: 'security' })} data-tree-security={(report?.findings ?? []).length} data-tip="what this run judged by a security rule, and what it declined to judge">
                security · {security} ▸
              </button>
            ) : null}
            {report !== null ? (
              <button type="button" className={`tree-row${pick?.kind === 'history' ? ' on' : ''}`} aria-pressed={pick?.kind === 'history'} onClick={() => choose({ kind: 'history' })} data-tree-history={history?.runs.length ?? 0} data-tip="each test across the kept runs, the ones that failed first">
                history · {history === null || history.runs.length === 0 ? 'no kept runs' : `${history.runs.length} kept run${history.runs.length === 1 ? '' : 's'}`} ▸
              </button>
            ) : null}
          </nav>

          <section className="run-detail" data-run-detail={pick?.kind ?? 'none'}>
            {pick?.kind === 'security' && report !== null ? <Findings report={report} compare={compare} onAccept={onAccept} /> : null}
            {pick?.kind === 'history' ? <HistoryPanel history={history} /> : null}
            {picked !== null ? (
              <TestDetail
                item={picked}
                context={{ id: subjectId ?? '', evidenceLevel: report?.evidenceLevel, traceViewer, compare, history, onOpenTrace }}
                line={lineOf(picked.file, picked.name)}
                onCompose={onCompose}
                onRerun={running ? null : onRerun}
              />
            ) : null}
            {pick === null || (pick.kind === 'test' && picked === null) ? (
              <p className="muted" data-run-detail-none>
                {items.length === 0 ? (live !== null && live.end === null ? 'waiting for the first test…' : 'this run holds no tests') : `${head.word === 'PASSED' ? 'every test passed' : 'nothing picked'} — pick a test to read its steps`}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </article>
  );
}

function dotOf(group: TreeItem['group']): string {
  return group === 'failed' ? 'fail' : group === 'passed' ? 'ok' : group === 'running' ? 'running' : group === 'skipped' ? 'skip' : 'warn';
}

function LiveCounts({ live }: { readonly live: LiveRun }) {
  const { done } = liveCounts(live.state);
  return (
    <span className="muted" data-live-counts>
      {' '}· {done} of {live.state.announced || '?'} done
    </span>
  );
}

/**
 * **`run 7d ago ▾`** — the run picker (`D1409`), in place of the chip row. The list inside is
 * `RunList` unchanged: its rows, their state and their tips were `M229` `E`'s and are still right;
 * what changes is that they are one press away instead of a row of chips over every report.
 */
function RunPicker({ runs, reports, selected, onSelect }: { readonly runs: readonly RunRecord[]; readonly reports: readonly ReportDir[]; readonly selected: Selection; readonly onSelect: (s: Selection) => void }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const now = Date.now();
  const report = selected?.kind === 'report' ? reports.find((r) => r.id === selected.id) ?? null : null;
  const run = selected?.kind === 'run' ? runs.find((r) => r.id === selected.id) ?? null : null;
  const label =
    report !== null ? `run ${report.at ? ago(report.at, now) : report.id}`
    : run !== null ? (run.status === 'running' ? 'run · running' : `run ${ago(run.startedAt, now)}`)
    : runs.length + reports.length === 0 ? 'no runs yet'
    : 'pick a run';
  return (
    <details className="run-picker" ref={ref} data-run-picker={runs.length + reports.length}>
      <summary data-run-picked={selected?.id ?? ''}>{label} ▾</summary>
      <RunList
        runs={runs}
        reports={reports}
        selected={selected}
        onSelect={(s) => {
          if (ref.current !== null) ref.current.open = false;
          onSelect(s);
        }}
      />
    </details>
  );
}

/** What a WebUI test's evidence depends on and where it can be opened — `ReportView`'s context. */
interface DetailContext {
  readonly id: string;
  readonly evidenceLevel: RunReport['evidenceLevel'];
  readonly traceViewer: boolean;
  readonly compare: { readonly id: string; readonly data: RunReport } | null;
  readonly history: HistoryView | null;
  readonly onOpenTrace: (path: string) => void;
}

/** The picked test, on the right: `open in Compose` and `rerun this test` under its name. */
function TestDetail({ item, context, line, onCompose, onRerun }: { readonly item: TreeItem; readonly context: DetailContext; readonly line: number | null; readonly onCompose: (file: string, line: number) => void; readonly onRerun: ((file: string, name: string) => void) | null }) {
  const actions: ReactNode = (
    <p className="test-actions">
      {line === null ? (
        <span className="muted" data-open-compose-none data-tip="renamed since this run, or a row of a table">
          not in the file any more
        </span>
      ) : (
        <button type="button" className="linkish" onClick={() => onCompose(item.file, line)} data-open-compose={line} data-tip="this test's own line, in Compose">
          open in Compose
        </button>
      )}
      {onRerun === null ? null : (
        <button type="button" className="linkish" onClick={() => onRerun(item.file, item.name)} data-rerun={item.name} data-tip="runs just this test again">
          rerun this test
        </button>
      )}
    </p>
  );
  if (item.entry === null) {
    const steps = item.live?.steps ?? [];
    return (
      <section className="test running" data-test data-name={item.name} data-ok="running">
        <h3>
          <span className="dot running" /> {item.name} <span className="muted">running · step {steps.length + 1}</span>
        </h3>
        <Steps steps={steps} other={null} />
      </section>
    );
  }
  const entry = item.entry;
  switch (entry.kind) {
    case 'functional':
      return <Functional test={entry} context={context} actions={actions} />;
    case 'workload': {
      const c = context.compare;
      const other = c ? { id: c.id, test: c.data.tests.find((t): t is WorkloadTestResult => t.kind === 'workload' && t.name === entry.name && (t.file ?? '') === (entry.file ?? '')) ?? null } : null;
      return <Workload test={entry} other={other} history={context.history} actions={actions} />;
    }
    case 'crawl':
      return <Crawl test={entry} actions={actions} other={otherOf(context, entry)} />;
  }
}

/** The same test in the compared run: same file, same name. */
function otherOf(context: DetailContext, entry: ReportEntry): TestResult | CrawlResult | null {
  const c = context.compare;
  if (c === null) return null;
  const found = c.data.tests.find((t) => t.kind === entry.kind && t.name === entry.name && (t.file ?? '') === (entry.file ?? ''));
  return found !== undefined && (found.kind === 'functional' || found.kind === 'crawl') ? found : null;
}

function Functional({ test, context, actions }: { readonly test: TestResult; readonly context: DetailContext; readonly actions: ReactNode }) {
  const prior = test.attempts ? test.attempts.slice(0, -1) : [];
  // A WebUI test below `evidence full` has no screenshot and no trace by decision (`FS-01`), and
  // the page says so where they would be rather than leaving the reader to infer it (`D987`).
  const browser = test.steps.some((s) => BROWSER_KINDS.has(s.kind));
  const withheld = browser && context.evidenceLevel !== undefined && context.evidenceLevel !== 'full';
  const other = otherOf(context, test);
  return (
    <section className={`test ${test.skipped !== undefined ? 'skip' : test.ok ? 'ok' : 'fail'}`} data-test data-kind="functional" data-name={test.name} data-ok={test.ok} data-skipped={test.skipped === undefined ? undefined : ''}>
      <h3>
        <span className={`dot ${test.skipped !== undefined ? 'skip' : test.ok ? 'ok' : 'fail'}`} />
        <span data-test-name>{test.name}</span>
        {/* `D1327` — a skip is its own outcome here as in report.html: a grey dot, a badge, the reason. */}
        {test.skipped !== undefined ? <span className="badge" data-skip-badge data-tip={`skipped: ${test.skipped}`}>skipped</span> : null}
        {test.flaky ? <span className="badge warn" data-flaky>flaky</span> : null}
        {test.concurrency === 'parallel' ? <span className="badge">parallel</span> : null}
        <HistoryDots past={testPast(context.history, test.file, test.name)} />
        <span className="tms" data-ms>
          {ms(test.durationMs)}
        </span>
      </h3>
      <p className="muted test-file" data-test-file>
        {test.file}
      </p>
      {actions}
      {test.error ? (
        <p className="error" data-error>
          {test.error}
        </p>
      ) : null}
      {test.warnings && test.warnings.length > 0 ? (
        <ul className="warnings">
          {test.warnings.map((w, i) => (
            <li key={i} data-warning>
              <code>{w.code}</code> {w.message} <span className="muted">line {w.line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {withheld ? (
        <p className="muted" data-evidence-withheld={context.evidenceLevel}>
          no screenshots and no trace — this run's evidence level is <code>{context.evidenceLevel}</code>; they exist only at <code>full</code>
        </p>
      ) : null}
      {prior.map((a) => (
        <Attempt attempt={a} context={context} key={a.attempt} />
      ))}
      {test.attempts ? (
        <p className="attempt-final" data-attempts={test.attempts.length}>
          attempt {test.attempts.length} of {test.attempts.length} — {test.ok ? 'passed' : 'failed'}
        </p>
      ) : null}
      {test.trace ? <TraceLink trace={test.trace} context={context} /> : null}
      <Steps steps={test.steps} other={other?.steps ?? null} />
    </section>
  );
}

function Attempt({ attempt, context }: { readonly attempt: AttemptResult; readonly context: DetailContext }) {
  return (
    <details className="attempt" data-attempt={attempt.attempt}>
      <summary>
        <span className="badge fail">attempt {attempt.attempt} — failed</span>
        {attempt.error ? <span className="muted"> {attempt.error}</span> : null}
      </summary>
      {attempt.trace ? <TraceLink trace={attempt.trace} context={context} /> : null}
      <Steps steps={attempt.steps} other={null} />
    </details>
  );
}

/** The Playwright trace of a browser test — `M220` `C` (`D1179`, `D1171`): *open trace* opens the
 * viewer in this pane; the download and the `show-trace` line are for a reader who wants the file. */
function TraceLink({ trace, context }: { readonly trace: TraceAsset; readonly context: DetailContext }) {
  const [hashed, setHashed] = useState<string | null>(null);
  const base64 = trace.base64;
  useEffect(() => {
    if (base64 === undefined) return undefined;
    let alive = true;
    tracePath(base64).then((p) => {
      if (alive) setHashed(p);
    });
    return () => {
      alive = false;
    };
  }, [base64]);
  const path = trace.path ?? hashed;
  if (path === null || path === undefined) return null;
  return (
    <p className="trace-line" data-trace={path}>
      {context.traceViewer ? (
        <button type="button" className="linkish" onClick={() => context.onOpenTrace(path)} data-open-trace data-tip="opens this test's Playwright trace here — every action, its DOM and its network">
          open trace
        </button>
      ) : null}
      <a href={reportFileUrl(context.id, path)} download data-trace-download>
        trace.zip
      </a>
      <code className="muted">npx playwright show-trace {path}</code>
    </p>
  );
}

/**
 * The steps, each with the compared run's same step one line under it (`D1409`). *Same* is the
 * same line reading the same words — the join `ran.ts` makes — and failing that the same position,
 * which is what a step is when the file changed between the two runs by something above it.
 */
/**
 * The steps whose evidence is open at rest: a failing step, and the step that opens the group a
 * failure is in (`D1409`). An `expect` has no evidence of its own — the response it judged is its
 * request's — so opening only the failing step left the one thing worth reading folded.
 */
function openAtRest(steps: readonly StepResult[]): ReadonlySet<number> {
  const out = new Set<number>();
  let opener: number | null = null;
  steps.forEach((s, i) => {
    if (OPENS_GROUP.has(s.kind)) opener = i;
    if (s.ok) return;
    out.add(i);
    if (opener !== null) out.add(opener);
  });
  return out;
}

function Steps({ steps, other }: { readonly steps: readonly StepResult[]; readonly other: readonly StepResult[] | null }) {
  const open = openAtRest(steps);
  return (
    <ol className="steps">
      {steps.map((s, i) => {
        const twin = other === null ? undefined : other.find((o) => o.line === s.line && o.source === s.source) ?? (other[i]?.source === s.source ? other[i] : undefined);
        return (
          <StepRow step={s} key={`${s.line}-${i}`} open={open.has(i)}>
            {other === null ? null : (
              <div className={`compare-step${twin === undefined ? ' none' : twin.ok ? '' : ' bad'}`} data-compare-step={twin === undefined ? 'none' : String(twin.ok)}>
                {twin === undefined ? 'compared run: not in that run' : `compared run: ${twin.ok ? '✓' : '✗'} ${twin.detail ?? twin.source} · ${ms(twin.durationMs)}`}
              </div>
            )}
          </StepRow>
        );
      })}
    </ol>
  );
}

function Crawl({ test, actions, other }: { readonly test: CrawlResult; readonly actions: ReactNode; readonly other: TestResult | CrawlResult | null }) {
  return (
    <section className={`test ${test.ok ? 'ok' : 'fail'}`} data-test data-kind="crawl" data-name={test.name} data-ok={test.ok}>
      <h3>
        <span className={`dot ${test.ok ? 'ok' : 'fail'}`} />
        <span data-test-name>{test.name}</span>
        <span className="badge">crawl</span>
      </h3>
      {actions}
      <p className="muted">
        {test.surface.discovered} discovered · {test.surface.sent} sent · {test.surface.reached} reached · {test.surface.withheld} withheld
      </p>
      {test.error ? <p className="error">{test.error}</p> : null}
      <Steps steps={test.steps} other={other?.steps ?? null} />
    </section>
  );
}

/**
 * **`history ▸`** — `M257` `C` over `M249`'s kept runs. Each test the kept runs remember, its
 * verdicts oldest on the left, the failing ones first. With no kept runs the row says what keeps
 * them rather than drawing an empty table.
 */
function HistoryPanel({ history }: { readonly history: HistoryView | null }) {
  if (history === null || history.runs.length === 0) {
    return (
      <p className="muted" data-history-none>
        no kept runs yet — every run is kept under <code>report/runs/&lt;id&gt;/</code>, so run the tests again and each one&rsquo;s past appears here
      </p>
    );
  }
  const rows = [...history.tests].sort((a, b) => b.failures - a.failures || Number(b.flaky) - Number(a.flaky) || a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
  return (
    <section className="history-panel" data-history-panel={history.runs.length}>
      <h2>
        history <span className="muted">· the last {history.runs.length} kept run{history.runs.length === 1 ? '' : 's'}</span>
      </h2>
      <table>
        <tbody>
          {rows.map((t) => (
            <tr key={`${t.file}\u0000${t.name}`} data-history-row={t.name}>
              <td>
                <span className="muted">{t.file}</span> {t.name}
              </td>
              <td>{t.verdicts.length < 2 ? <span className="muted">{t.verdicts[0] ?? ''}</span> : <HistoryDots past={t} />}</td>
              <td className="muted">{t.failures === 0 ? '' : `${t.failures} failed`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
