// The functional view (`M192` U2): tests → steps → assertions, with the request and response
// under each `api` step. One renderer for a finished report (`results.json`, the merged
// `RunReport`) and for a run in flight (the stream reduced to the same shape by `live.ts`); the
// only difference is the header, which for a live run says what has arrived so far.

import { useEffect, useState } from 'react';
import type { AttemptResult, CrawlResult, ReportEntry, RunReport, StepResult, TestResult, TraceAsset, WorkloadTestResult } from './contract';
import type { LiveTest } from './live';
import { BROWSER_KINDS, tracePath } from './assets';
import { ms, when } from './format';
import { reportFileUrl } from './api';
import { StepRow } from './StepRow';
import { Workload } from './Workload';

/** What a WebUI test's evidence depends on and where it can be opened: the report it is in and
 * the level that report was run at. Absent for a live pane, which has neither yet. */
export interface ReportContext {
  readonly id: string;
  readonly evidenceLevel: RunReport['evidenceLevel'];
  readonly traceViewer: boolean;
  /** U4 — a second report directory opened beside this one; the workload view shows both. */
  readonly compare?: { readonly id: string; readonly data: RunReport } | null;
  /**
   * **Open this trace in the page** — `M220` `C` (`D1179`).
   *
   * *open trace* used to be an `<a target="_blank">`, which answers the question by leaving the
   * application. That was the right shape while a trace was a *failure artefact* you took away to
   * study; `D1170` makes it the ordinary outcome of pressing ▶, and the round's whole ask was
   * *playback within the app*. So the shell decides where the viewer goes and this component asks
   * it to, which also keeps `ReportView` a projection of a report rather than a router.
   *
   * **Required, and not an optional with an `<a target="_blank">` behind it.** The first draft
   * kept the old link as a fallback for a caller that supplies no handler, and there is no such
   * caller: `ReportBody` is the only one and it always does. An unreachable branch is not a
   * defensive one — `M200`'s own carry, and `D1082` one layer up — so the branch is gone and the
   * control has one spelling. Taking the file away is still offered, by the download link and the
   * `show-trace` line beside this one, which are what that reader actually wanted.
   */
  readonly onOpenTrace: (path: string) => void;
}

export function ReportHeader({ report }: { report: RunReport }) {
  return (
    <header className="report-head" data-summary data-ok={report.ok}>
      <span className={`verdict ${report.ok ? 'ok' : 'fail'}`} data-verdict>
        {report.ok ? 'PASS' : 'FAIL'}
      </span>
      <span data-counts>
        {report.total} test{report.total === 1 ? '' : 's'} · {report.passed} passed · {report.failed} failed
      </span>
      <span className="muted">
        env <code data-env>{report.env}</code> · {ms(report.durationMs)} · {when(report.startedAt)}
      </span>
      {report.evidenceLevel && report.evidenceLevel !== 'full' ? (
        <span className="muted" data-evidence-level={report.evidenceLevel}>
          evidence <code>{report.evidenceLevel}</code> — {report.evidenceLevel === 'none' ? 'no headers and no bodies are in this report' : 'response bodies are not in this report'}
        </span>
      ) : null}
      {report.aborted ? <span className="warn">aborted{report.abortedMessage ? ` — ${report.abortedMessage}` : ''}</span> : null}
      {report.inconclusive ? <span className="warn">inconclusive</span> : null}
    </header>
  );
}

/** Tests grouped by file in declaration order — the order the report holds them in. */
export function ReportBody({ tests, context }: { tests: readonly ReportEntry[]; context?: ReportContext }) {
  const byFile = groupByFile(tests.map((t) => ({ file: t.file, entry: t })));
  return (
    <div className="tests">
      {byFile.map(([file, entries]) => (
        <section className="file" key={file} data-file-group={file}>
          <h2 className="file-name">{file}</h2>
          {entries.map((e, i) => (
            <Entry entry={e} context={context} key={`${e.name}-${i}`} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function LiveBody({ tests }: { tests: readonly LiveTest[] }) {
  const byFile = groupByFile(tests.map((t) => ({ file: t.file, entry: t })));
  return (
    <div className="tests">
      {byFile.map(([file, entries]) => (
        <section className="file" key={file} data-file-group={file}>
          <h2 className="file-name">{file}</h2>
          {entries.map((t, i) =>
            t.result ? (
              <Entry entry={t.result} key={`${t.name}-${i}`} />
            ) : (
              <section className="test running" key={`${t.name}-${i}`} data-test data-name={t.name} data-ok="running">
                <h3>
                  <span className="dot running" /> {t.name} <span className="muted">running…</span>
                </h3>
                <Steps steps={t.steps} />
              </section>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

function groupByFile<T>(items: readonly { file: string | undefined; entry: T }[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const { file, entry } of items) {
    const key = file ?? '(no file)';
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()];
}

function Entry({ entry, context }: { entry: ReportEntry; context?: ReportContext }) {
  switch (entry.kind) {
    case 'functional':
      return <Functional test={entry} context={context} />;
    case 'workload': {
      const c = context?.compare;
      const other = c ? { id: c.id, test: c.data.tests.find((t): t is WorkloadTestResult => t.kind === 'workload' && t.name === entry.name) ?? null } : null;
      return <Workload test={entry} other={other} />;
    }
    case 'crawl':
      return <Crawl test={entry} />;
  }
}

function Functional({ test, context }: { test: TestResult; context?: ReportContext }) {
  const prior = test.attempts ? test.attempts.slice(0, -1) : [];
  // A WebUI test below `evidence full` has no screenshot and no trace by decision (`FS-01`), and
  // the page says so where they would be rather than leaving the reader to infer it (`D987`).
  const browser = test.steps.some((s) => BROWSER_KINDS.has(s.kind));
  const withheld = browser && context !== undefined && context.evidenceLevel !== undefined && context.evidenceLevel !== 'full';
  return (
    <section className={`test ${test.ok ? 'ok' : 'fail'}`} data-test data-kind="functional" data-name={test.name} data-ok={test.ok}>
      <h3>
        <span className={`dot ${test.ok ? 'ok' : 'fail'}`} />
        <span data-test-name>{test.name}</span>
        {test.flaky ? <span className="badge warn" data-flaky>flaky</span> : null}
        {test.concurrency === 'parallel' ? <span className="badge">parallel</span> : null}
        <span className="tms" data-ms>
          {ms(test.durationMs)}
        </span>
      </h3>
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
        <p className="muted" data-evidence-withheld={context!.evidenceLevel}>
          no screenshots and no trace — this run's evidence level is <code>{context!.evidenceLevel}</code>; they exist only at <code>full</code>
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
      {test.trace && context ? <TraceLink trace={test.trace} context={context} /> : null}
      <Steps steps={test.steps} />
    </section>
  );
}

function Attempt({ attempt, context }: { attempt: AttemptResult; context?: ReportContext }) {
  return (
    <details className="attempt" data-attempt={attempt.attempt}>
      <summary>
        <span className="badge fail">attempt {attempt.attempt} — failed</span>
        {attempt.error ? <span className="muted"> {attempt.error}</span> : null}
      </summary>
      {attempt.trace && context ? <TraceLink trace={attempt.trace} context={context} /> : null}
      <Steps steps={attempt.steps} />
    </details>
  );
}

/** The Playwright trace of a failed attempt: *open trace* hands the archive to Playwright's own
 * viewer, served by `tflw ui` under `/trace/` from the project's `playwright-core`; the download
 * and the `show-trace` line are there for a project without one, and for a reader who wants the
 * file. The archive's name is the reporter's hash of its bytes (`assets.ts`). */
function TraceLink({ trace, context }: { trace: TraceAsset; context: ReportContext }) {
  /**
   * **The report says where the archive is, now** — `M220` `B` (`D1171`).
   *
   * This used to take the archive's *bytes* and hash them, in the browser, asynchronously, in
   * order to recover the name of a file sitting in the report directory the whole time — which is
   * what made the 668 KB of base64 in `results.json` look load-bearing. `writeResultsJson` puts
   * the path there instead, so the common branch is now no work at all.
   *
   * The hashing branch stays for a report written before this round, which carries bytes and no
   * path: a reader opening an old report directory is not a case to break, and the function it
   * calls has not moved.
   */
  const [hashed, setHashed] = useState<string | null>(null);
  const base64 = trace.base64;
  useEffect(() => {
    if (base64 === undefined) return undefined;
    let live = true;
    tracePath(base64).then((p) => {
      if (live) setHashed(p);
    });
    return () => {
      live = false;
    };
  }, [base64]);
  const path = trace.path ?? hashed;
  if (path === null || path === undefined) return null;
  const href = reportFileUrl(context.id, path);
  /* The viewer's own URL is the **shell's** to build now (`D1179`), beside the frame it goes in —
     it used to be built here because this component owned the link. What is left here is the
     archive's own href, which the download below needs and the shell asks for by path. */
  return (
    <p className="trace-line" data-trace={path}>
      {/* `D1179` — the viewer opens in the Run pane. Still gated on `traceViewer`, which is
          whether `playwright-core` resolves from the project at all: with no viewer to serve there
          is nothing to open, and the `show-trace` line below says what to run instead. */}
      {context.traceViewer ? (
        <button type="button" className="linkish" onClick={() => context.onOpenTrace(path)} data-open-trace data-tip="opens Playwright's own trace for this test, here in the page — every action, the DOM as it was at each one, and the network beside it">
          open trace
        </button>
      ) : null}
      <a href={href} download data-trace-download>
        trace.zip
      </a>
      <code className="muted">npx playwright show-trace {path}</code>
    </p>
  );
}

function Steps({ steps }: { steps: readonly StepResult[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <StepRow step={s} key={`${s.line}-${i}`} />
      ))}
    </ol>
  );
}

/** A workload row as the report holds it — its verdict and its thresholds. The metrics, the
 * charts and the endpoint table are U4's; nothing here pretends to be them. */
function Crawl({ test }: { test: CrawlResult }) {
  return (
    <section className={`test ${test.ok ? 'ok' : 'fail'}`} data-test data-kind="crawl" data-name={test.name} data-ok={test.ok}>
      <h3>
        <span className={`dot ${test.ok ? 'ok' : 'fail'}`} />
        <span data-test-name>{test.name}</span>
        <span className="badge">crawl</span>
      </h3>
      <p className="muted">
        {test.surface.discovered} discovered · {test.surface.sent} sent · {test.surface.reached} reached · {test.surface.withheld} withheld
      </p>
      {test.error ? <p className="error">{test.error}</p> : null}
      <Steps steps={test.steps} />
    </section>
  );
}
