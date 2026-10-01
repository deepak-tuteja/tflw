// One step of a functional test (`M192` U2): the mark, the source line as written, its duration,
// the runtime's own one-line detail — for an assertion that is `expected …, but got …`, the
// artefact's words, not the page's — and, folded, the evidence the step carries: the request and
// the response the run kept. The body reads exactly what the report holds: at `evidence headers
// only` that is the runtime's `[omitted by evidence level]` marker, shown as such (`D987`).

import type { ReactNode } from 'react';
import type { StepResult } from './contract';
import { ms, pretty } from './format';

/** A screenshot as the report holds it — the PNG bytes, base64, straight into the `img`. Never
 * redacted (the runtime's own note on `ScreenshotAsset`): what the page shows is what a user
 * looking at the browser saw. */
function Screenshot({ base64, label }: { base64: string; label: string }) {
  return (
    <figure className="screenshot">
      <img src={`data:image/png;base64,${base64}`} alt={label} loading="lazy" data-screenshot data-screenshot-bytes={base64.length} />
      <figcaption className="muted">{label}</figcaption>
    </figure>
  );
}

/** `children` is drawn under the step's own line and detail — the Run tree's *compared run* line
 *  (`D1409`), which belongs to the step it is about rather than to a list beside the steps. */
export function StepRow({ step, children, open }: { step: StepResult; children?: ReactNode; open?: boolean }) {
  if (step.kind === 'log') return <LogRow step={step} />;
  const hasTrace = step.request !== undefined;
  const hasShot = step.screenshot !== undefined || step.snapshotDiff !== undefined;
  const assertion = step.kind === 'expect' || step.kind === 'check';
  const labels = [step.screenshot ? 'screenshot' : '', step.snapshotDiff ? 'snapshot diff' : '', hasTrace ? 'request & response' : ''].filter(Boolean);
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
      {children}
      {hasTrace || hasShot ? (
        <details className="evidence" open={open ?? !step.ok}>
          <summary>{labels.join(', ')}</summary>
          {step.screenshot ? <Screenshot base64={step.screenshot.base64} label={step.ok ? 'screenshot' : 'screenshot at the failure'} /> : null}
          {step.snapshotDiff ? (
            <div className="snapshot-diff" data-snapshot-diff>
              {step.snapshotDiff.baseline ? <Screenshot base64={step.snapshotDiff.baseline} label="baseline" /> : null}
              <Screenshot base64={step.snapshotDiff.actual} label="actual" />
              {step.snapshotDiff.diff ? <Screenshot base64={step.snapshotDiff.diff} label="diff" /> : null}
            </div>
          ) : null}
          {hasTrace ? (
          <div className="trace">
            {/* Each panel scrolls (`.panel { overflow: auto }`), so each is a tab stop: a region a keyboard
                cannot reach cannot be scrolled without a mouse (axe's `scrollable-region-focusable`). */}
            <div className="panel req" data-request tabIndex={0} aria-label="the request">
              <div className="phead">
                → {step.request!.method} {step.request!.url}
              </div>
              <Headers headers={step.request!.headers} />
              {step.request!.body ? <pre className="body">{pretty(step.request!.body)}</pre> : null}
            </div>
            {step.response ? (
              <div className="panel res" data-response tabIndex={0} aria-label="the response">
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
          ) : null}
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
