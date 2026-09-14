// One step of a functional test (`M192` U2): the mark, the source line as written, its duration,
// the runtime's own one-line detail — for an assertion that is `expected …, but got …`, the
// artefact's words, not the page's — and, folded, the evidence the step carries: the request and
// the response the run kept. The body reads exactly what the report holds: at `evidence headers
// only` that is the runtime's `[omitted by evidence level]` marker, shown as such (`D987`).

import type { StepResult } from './contract';
import { ms, pretty } from './format';

export function StepRow({ step }: { step: StepResult }) {
  if (step.kind === 'log') return <LogRow step={step} />;
  const hasTrace = step.request !== undefined;
  const assertion = step.kind === 'expect' || step.kind === 'check';
  return (
    <li className={`step ${step.ok ? 'ok' : 'fail'} kind-${step.kind}`} data-step data-line={step.line} data-kind={step.kind} data-ok={step.ok}>
      <div className="line">
        <span className="mark">{step.ok ? '✓' : '✗'}</span>
        <code data-source>{step.source}</code>
        <span className="sms" data-ms>
          {ms(step.durationMs)}
        </span>
      </div>
      {step.detail ? (
        <div className={`detail${step.ok ? '' : ' baddetail'}${assertion ? ' assertion' : ''}`} data-detail>
          {step.detail}
        </div>
      ) : null}
      {hasTrace ? (
        <details className="evidence" open={!step.ok}>
          <summary>request &amp; response</summary>
          <div className="trace">
            <div className="panel req" data-request>
              <div className="phead">
                → {step.request!.method} {step.request!.url}
              </div>
              <Headers headers={step.request!.headers} />
              {step.request!.body ? <pre className="body">{pretty(step.request!.body)}</pre> : null}
            </div>
            {step.response ? (
              <div className="panel res" data-response>
                <div className="phead" data-status>
                  ← {step.response.status} {step.response.statusText} · {ms(step.response.durationMs)}
                </div>
                <Headers headers={step.response.headers} />
                {step.response.bodyText ? (
                  <pre className="body" data-body>
                    {pretty(step.response.bodyText)}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

function LogRow({ step }: { step: StepResult }) {
  const level = step.level ?? 'info';
  return (
    <li className={`step ok kind-log level-${level}`} data-step data-line={step.line} data-kind="log" data-ok="true">
      <div className="line">
        <span className={`log-badge log-${level}`}>{level.toUpperCase()}</span>
        <code data-source>{step.source}</code>
        <span className="sms" data-ms>
          {ms(step.durationMs)}
        </span>
      </div>
      {step.detail ? (
        <div className="detail" data-detail>
          {step.detail}
        </div>
      ) : null}
    </li>
  );
}

function Headers({ headers }: { headers: Readonly<Record<string, string>> }) {
  const rows = Object.entries(headers);
  if (rows.length === 0) return null;
  return (
    <table className="headers" data-headers>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
