// The functional view (`M192` U2): tests → steps → assertions, with the request and response
// under each `api` step. One renderer for a finished report (`results.json`, the merged
// `RunReport`) and for a run in flight (the stream reduced to the same shape by `live.ts`); the
// only difference is the header, which for a live run says what has arrived so far.

import type { AttemptResult, CrawlResult, ReportEntry, RunReport, StepResult, TestResult, WorkloadTestResult } from './contract';
import type { LiveTest } from './live';
import { ms, when } from './format';
import { StepRow } from './StepRow';

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
export function ReportBody({ tests }: { tests: readonly ReportEntry[] }) {
  const byFile = groupByFile(tests.map((t) => ({ file: t.file, entry: t })));
  return (
    <div className="tests">
      {byFile.map(([file, entries]) => (
        <section className="file" key={file} data-file-group={file}>
          <h2 className="file-name">{file}</h2>
          {entries.map((e, i) => (
            <Entry entry={e} key={`${e.name}-${i}`} />
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

function Entry({ entry }: { entry: ReportEntry }) {
  switch (entry.kind) {
    case 'functional':
      return <Functional test={entry} />;
    case 'workload':
      return <Workload test={entry} />;
    case 'crawl':
      return <Crawl test={entry} />;
  }
}

function Functional({ test }: { test: TestResult }) {
  const prior = test.attempts ? test.attempts.slice(0, -1) : [];
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
      {prior.map((a) => (
        <Attempt attempt={a} key={a.attempt} />
      ))}
      {test.attempts ? (
        <p className="attempt-final" data-attempts={test.attempts.length}>
          attempt {test.attempts.length} of {test.attempts.length} — {test.ok ? 'passed' : 'failed'}
        </p>
      ) : null}
      <Steps steps={test.steps} />
    </section>
  );
}

function Attempt({ attempt }: { attempt: AttemptResult }) {
  return (
    <details className="attempt" data-attempt={attempt.attempt}>
      <summary>
        <span className="badge fail">attempt {attempt.attempt} — failed</span>
        {attempt.error ? <span className="muted"> {attempt.error}</span> : null}
      </summary>
      <Steps steps={attempt.steps} />
    </details>
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
function Workload({ test }: { test: WorkloadTestResult }) {
  return (
    <section className={`test ${test.ok ? 'ok' : 'fail'}`} data-test data-kind="workload" data-name={test.name} data-ok={test.ok}>
      <h3>
        <span className={`dot ${test.ok ? 'ok' : 'fail'}`} />
        <span data-test-name>{test.name}</span>
        <span className="badge">workload</span>
      </h3>
      <p className="muted">
        {test.metrics.iterations} iterations · {test.metrics.failures} failed
      </p>
      <table className="thresholds">
        <tbody>
          {test.thresholds.map((t, i) => (
            <tr key={i} className={t.ok ? 'ok' : 'fail'} data-threshold>
              <td>{t.ok ? '✓' : '✗'}</td>
              <td>{t.label}</td>
              <td>
                {t.op === 'lessThan' ? '<' : '>'} {t.target}
              </td>
              <td>{t.actual === null ? 'no successful iterations' : t.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

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
