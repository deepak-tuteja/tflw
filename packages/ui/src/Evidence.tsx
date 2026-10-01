// **The evidence column** — `M256` `B` (`D1406`).
//
// THE RIGHT-HAND COLUMN USED TO DRAW THE TEST A SECOND TIME. `M214` put an editor card there and
// the response under it; the steps column beside it drew the same statements as rows. Two pictures
// of one test, and `D1405` keeps the one a reader navigates by: a picked row edits in place, in the
// steps column. What is left for this column is what the steps column cannot show — **what came
// back**, and nothing else.
//
// **FOUR TENANTS, EACH EARNED BY WHAT IS PICKED** (`D1209` unchanged, one tenant wider): `response`
// for a request, `plan` for a test that carries a workload, `scan` for one that asserts a scan
// matcher, and `screenshot` for a browser step. The tabs are drawn only when there is a choice.
//
// **IT OPENS ON THE LAST RUN** (`D1406`). With a request picked and nothing sent, the column shows
// what the newest run recorded for that step, under a line that dates it, and flags it when the
// step's words have changed since — the response is still the last thing that came back for that
// step, and a reader who has just retyped a path is the one who wants it. Below `evidence full`
// the run kept no body, and the column says which level it ran at rather than showing the
// runtime's placeholder as though the service had sent it (`D987`).

import type { CaptureSpec, ExpectSpec, MatcherName, Workload } from '@tflw/lang';
import { PlanPanel } from './PlanPanel';
import { ScanPanel, type Authorization } from './ScanPanel';
import { ResponsePanel, ago, statusTone, type Ran } from './parts';
import { reportFileUrl } from './api';
import type { OutlineRequest, Prefix, SendForm } from './outline';

/** The column's tenants, in the order their tabs are drawn (`D1406`). */
export const EVIDENCE_TABS = ['response', 'plan', 'scan', 'screenshot'] as const;
export type EvidenceTab = (typeof EVIDENCE_TABS)[number];

/** What each tab IS, in the reader's words — `M228` `F` (`D1246`)'s rule: a tab that is already open
 *  gets pressed by someone looking at it, so its tip has to be true of the view, not of a press. */
const TIP: Readonly<Record<EvidenceTab, string>> = {
  response: 'what came back — from the last run, or from the last `send`',
  plan: 'the workload this test declares, drawn to scale — what will run, for how long, and at what rate',
  scan: 'where a scan in this env can reach, and what authorizes it — nothing here runs',
  screenshot: 'the page as the last run saw it at this step',
};

/** One press's worth of responses, as the steps column hands them over (`M225` `B`, `D1217`). */
export interface SentEntry {
  readonly request: OutlineRequest;
  readonly ran: Ran;
}

export interface EvidenceProps {
  readonly path: string;
  readonly tenants: readonly EvidenceTab[];
  readonly tab: EvidenceTab;
  readonly onTab: (tab: EvidenceTab) => void;
  /** The picked test's workload and name — the `plan` tenant (`D1209`, `D1221`). */
  readonly plan: { readonly workload: Workload; readonly name: string | null } | null;
  readonly authorization: Authorization;
  readonly scanMatchers: readonly MatcherName[];
  readonly onProjectTab: (tab: 'auth' | 'config') => void;
  /** The response in the box and the request it came from — ONE reading (`M225` §1.2). */
  readonly shown: Ran | null;
  readonly shownRequest: OutlineRequest | null;
  /** Whether a request is picked at all: the empty state differs (`not sent yet` against *pick a
   *  request*), and a picked request with no evidence is the commoner of the two. */
  readonly picked: OutlineRequest | null;
  readonly sentHere: readonly SentEntry[];
  readonly sent: { readonly form: SendForm; readonly at: string } | null;
  readonly onPickSent: (line: number) => void;
  readonly prefix: Prefix | null;
  readonly prefixAll: Prefix | null;
  readonly onSend: ((form: SendForm) => void) | null;
  readonly sending: boolean;
  readonly busy: boolean;
  readonly scratchUnignored: string | null;
  readonly onVerify: ((request: OutlineRequest, spec: ExpectSpec) => void) | null;
  readonly onCapture: ((request: OutlineRequest, specs: readonly CaptureSpec[]) => void) | null;
  /** The picked browser step's group from the last run, and what to call it — the `screenshot`
   *  tenant. `ran` is `null` when the step has not run. */
  readonly shot: { readonly ran: Ran | null; readonly what: string } | null;
  /** A recording in progress — the column FOLLOWS it (`D1408`): it says where the live page is (the
   *  browser window the recorder opened) and keeps the last static frame under that line. */
  readonly recording: { readonly into: string; readonly pending: number } | null;
  /** A run the column is following — `M257` `A` (`D1407`): the group it is showing, and whether the
   *  run is still going or rests on the step that failed. */
  readonly following: { readonly line: number; readonly status: 'running' | 'passed' | 'failed' | 'cancelled' } | null;
  /** The picked test's trace in the last run — the stage's link, moved here (`D1407`). */
  readonly trace: { readonly path: string; readonly reportId: string; readonly open: () => void } | null;
}

export function Evidence(props: EvidenceProps) {
  const { path, tenants, tab, onTab, plan, authorization, scanMatchers, onProjectTab, shown, shownRequest, picked, sentHere, sent, onPickSent, prefix, prefixAll, onSend, sending, busy, scratchUnignored, onVerify, onCapture, shot, recording, following, trace } = props;
  const sendPrefix = prefix ?? prefixAll;
  const response = shown?.response ?? null;
  /** Below `evidence full` the body is the runtime's placeholder, not the service's answer (`D987`). */
  const bodyKept = shown === null || shown.evidence === null || shown.evidence === 'full';
  return (
    /* `.responsebox` is kept as the column's class: it is the one box per pane that holds what came
       back (`§6` prediction 6 — a fold below 1100 is this same element, never a summary of it). */
    <section className="evidence responsebox" data-evidence={tab} data-compose-responsebox={response !== null ? 'yes' : 'no'}>
      {tenants.length > 1 ? (
        <nav className="seg" data-evidence-tabs={tab}>
          {tenants.map((which) => (
            <button key={which} type="button" className={tab === which ? 'seg-on' : ''} aria-pressed={tab === which} onClick={() => onTab(which)} data-evidence-tab={which} data-tip={TIP[which]}>
              {which}
            </button>
          ))}
        </nav>
      ) : null}

      {following === null ? null : (
        <p className="muted evidence-follow" data-evidence-follow="run" data-evidence-follow-line={following.line}>
          {following.status === 'running' ? `following the run · line ${following.line}` : `the run failed here · line ${following.line} — pick a row to leave it`}
        </p>
      )}

      {tab === 'plan' && plan !== null ? <PlanPanel path={path} name={plan.name} workload={plan.workload} /> : null}

      {tab === 'scan' ? <ScanPanel authorization={authorization} matchers={scanMatchers} onAuth={() => onProjectTab('auth')} onConfig={() => onProjectTab('config')} /> : null}

      {tab === 'screenshot' ? <Shot shot={shot} recording={recording} trace={trace} /> : null}

      {tab !== 'response' ? null : response !== null && shown !== null && shownRequest !== null ? (
        <>
          {/* ── The strip — `M225` `B` (`D1217`): only when a press issued more than one request. */}
          {sentHere.length > 1 && sent !== null ? (
            <div className="sendstrip" data-compose-sendstrip={sentHere.length}>
              <header className="muted" data-compose-sendstrip-head>
                send {sent.form} · {sentHere.length} requests · {ago(sent.at, Date.now())}
              </header>
              <ol>
                {sentHere.map((e, i) => (
                  <li key={e.request.line}>
                    <button
                      type="button"
                      className={e.request.line === shownRequest.line ? 'on' : ''}
                      aria-pressed={e.request.line === shownRequest.line}
                      data-compose-sendstrip-entry={i}
                      data-compose-sendstrip-line={e.request.line}
                      onClick={() => onPickSent(e.request.line)}
                      data-tip={`what came back from ${e.request.method} ${e.request.path}`}
                    >
                      <span className={`method m-${e.request.method.toLowerCase()}`}>{e.request.method}</span> <code>{e.request.path}</code>{' '}
                      <span className={`status-code ${statusTone(e.ran.response!.status)}`}>{e.ran.response!.status}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {/* **The date is the line's first word** (`D956`, `D1406`): *from the last run* and *from
              this send* are different evidence, and a response from last Tuesday is evidence about
              last Tuesday. */}
          <header
            className="response-head-bar"
            data-compose-response={response.status}
            data-compose-response-scope={shown.scope}
            data-compose-response-line={shownRequest.line}
            data-tip={`${response.method} ${response.url} — ${shown.at}`}
          >
            <span className={`status-code ${statusTone(response.status)}`} data-compose-response-status={response.status}>
              {response.status}
            </span>{' '}
            <span className="muted" data-compose-response-when>
              {shown.scope === 'send' ? 'from this send' : 'from the last run'}, {ago(shown.at, Date.now())}
            </span>
            {shown.changed ? (
              <span className="warn" data-evidence-changed data-tip="the step’s words are not what ran — this is what came back before the edit">
                {' '}⚠ this step changed since · {onSend === null ? 'run to refresh' : 'send to refresh'}
              </span>
            ) : null}
          </header>
          <details className="response-headers" data-compose-response-headers={Object.keys(response.headers).length} open={!bodyKept}>
            <summary>headers {Object.keys(response.headers).length}</summary>
            <table>
              <tbody>
                {Object.entries(response.headers).map(([name, value]) => (
                  <tr key={name} data-compose-response-header={name}>
                    <th scope="row"><code>{name}</code></th>
                    <td><code>{value}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {bodyKept ? (
            <ResponsePanel
              ran={shown}
              open
              onVerify={onVerify === null ? null : (spec) => onVerify(shownRequest, spec)}
              onCapture={onCapture === null ? null : (specs) => onCapture(shownRequest, specs)}
            />
          ) : (
            <p className="muted" data-evidence-level={shown.evidence ?? ''}>
              {shown.evidence === 'none' ? 'the last run kept no evidence — only the status is recorded' : 'the last run kept headers only — its body was not recorded'}
            </p>
          )}
          {/* Send, once a response is showing: a line, not the block the empty state is (`D1123`). */}
          {sendPrefix !== null && onSend !== null ? (
            <div className="editor-send" data-compose-send-row>
              <SendButtons prefix={prefix} prefixAll={prefixAll} onSend={onSend} sending={sending} busy={busy} compact />
              <span className="muted">{sendPrefix.requests.map((r) => `${r.method} ${r.path}`).join(' → ')} — nothing is graded</span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="response-none">
          {sendPrefix !== null && onSend !== null ? (
            <div className="prefix" data-prefix={sendPrefix.requests.length}>
              {/* **One sentence that names the next action** (`D1410`) — the paragraph that stood here
                  explained the press to its builder. */}
              <p className="muted" data-evidence-none="not-sent">
                not sent yet — send fires {sendPrefix.requests.length === 1 ? 'this request' : `these ${sendPrefix.requests.length} requests`} and grades nothing
              </p>
              <div className="prefix-buttons">
                <SendButtons prefix={prefix} prefixAll={prefixAll} onSend={onSend} sending={sending} busy={busy} compact={false} />
              </div>
              <ol className="prefix-list">
                {sendPrefix.requests.map((r, i) => (
                  <li key={i} data-prefix-request={i}>
                    <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span> <code>{r.path}</code> <span className="muted" data-user-data>{r.where}</span>
                  </li>
                ))}
              </ol>
              {scratchUnignored === null ? null : (
                <p className="muted" data-api-scratch-unignored={scratchUnignored}>
                  send writes <code>{scratchUnignored}</code>, and this project&rsquo;s <code>.gitignore</code> does not list it — add that line, or expect it in{' '}
                  <code>git status</code>.
                </p>
              )}
            </div>
          ) : (
            <p className="muted" data-evidence-none={picked === null ? 'unpicked' : 'no-send'}>
              {picked === null ? 'pick a request to see what came back' : 'not run yet — ▶ runs this test and records what comes back'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * **The `screenshot` tenant** — `M256` `B`/`C` (`D1406`, `D1408`), and the trace's since `M257` `A`.
 *
 * The page as the last run saw it at the picked step: the first frame its group recorded, which is
 * where the runtime puts an explicit `screenshot` and a failing step's capture (`D12`). A clean
 * step takes none, and the tab says so rather than drawing an empty frame.
 *
 * **While a recording runs the tab FOLLOWS it**: the column says where the live page is — the
 * browser window the recorder opened — and keeps the last static frame under that line. A run's
 * frames arrive with its steps (`D1407`); a recording's gestures carry none, so there is no live
 * frame to show and the line says where to look instead.
 */
function Shot({ shot, recording, trace }: { readonly shot: EvidenceProps['shot']; readonly recording: EvidenceProps['recording']; readonly trace: EvidenceProps['trace'] }) {
  const frame = shot?.ran?.screenshot ?? null;
  return (
    <div className="shot-panel" data-evidence-shot={frame === null ? 'none' : 'frame'}>
      {recording === null ? null : (
        <p className="muted" data-evidence-follow="record">
          recording into “{recording.into}” — the browser window is the live page; {recording.pending === 0 ? 'each gesture lands as a row in the steps' : `${recording.pending} gesture${recording.pending === 1 ? '' : 's'} waiting in the steps`}
        </p>
      )}
      {frame !== null && shot !== null && shot.ran !== null ? (
        <figure className="shot">
          <img src={`data:image/png;base64,${frame}`} alt={`the page at ${shot.what}, from the last run`} />
          <figcaption className="muted" data-evidence-shot-when>
            {shot.what} · from the last run, {ago(shot.ran.at, Date.now())}
            {shot.ran.changed ? <span className="warn" data-evidence-changed> · ⚠ this step changed since · run to refresh</span> : null}
          </figcaption>
        </figure>
      ) : recording !== null ? null : (
        <p className="muted" data-evidence-shot-none>
          {shot === null ? 'pick a browser step to see the page it left' : 'no screenshot from the last run here — a failing step or a `screenshot` takes one'}
        </p>
      )}
      {/* **The trace is the screenshot tab's** (`D1407`) — every action of the last run, its DOM and
          its network, opened in the Run tab's viewer; the file, for a reader who wants it. */}
      {trace === null ? null : (
        <p className="muted" data-evidence-trace={trace.path}>
          <button type="button" className="linkish" onClick={trace.open} data-evidence-open-trace data-tip="the last run's Playwright trace of this test — every action, its DOM and its network">
            open trace
          </button>{' '}
          · <a href={reportFileUrl(trace.reportId, trace.path)} download data-evidence-trace-download>trace.zip</a>
        </p>
      )}
    </div>
  );
}

/**
 * **The send controls** — `M225` `A` (`D1215`), moved here from the pane with the response they
 * fill.
 *
 * Two presses, and the address chooses which are offered: `send this` is the prefix up to the
 * picked request, `send all` every request of the test once, hooks first. **Neither is a run** —
 * both drop the workload and the thresholds (`D1211`) and strip the assertions (`D1119`) — and
 * `send all` is suppressed when it would fire exactly the requests `send this` fires (`D1217`'s
 * rule, one region up).
 */
export function SendButtons(props: {
  readonly prefix: Prefix | null;
  readonly prefixAll: Prefix | null;
  readonly onSend: (form: SendForm) => void;
  readonly sending: boolean;
  readonly busy: boolean;
  readonly compact: boolean;
}) {
  const { prefix, prefixAll, onSend, sending, busy, compact } = props;
  /* The REQUESTS the two presses issue decide it, not where they cut: on a one-request test whose
     last line is an `expect` the cuts differ by one step and issue exactly the same request. */
  const both = prefix !== null && prefixAll !== null && prefixAll.lines.length > prefix.lines.length;
  const offered: { form: SendForm; p: Prefix }[] = [];
  if (prefix !== null) offered.push({ form: 'this', p: prefix });
  if (prefixAll !== null && (both || prefix === null)) offered.push({ form: 'all', p: prefixAll });
  if (offered.length === 0) return null;
  return (
    <>
      {offered.map(({ form, p }) => {
        const n = p.requests.length;
        const name = offered.length === 1 && form === 'this' ? 'send' : `send ${form}`;
        return (
          <button
            key={form}
            className="run"
            onClick={() => onSend(form)}
            disabled={sending || busy}
            data-compose-send={form}
            data-tip={
              form === 'this'
                ? 'sends this request and those that feed it, and shows the response — nothing is graded'
                : 'sends every request once, in order, as one virtual user would — nothing is graded'
            }
          >
            {sending ? 'sending…' : compact ? `${name} · ${n}` : `${name} — ${n} request${n === 1 ? '' : 's'}`}
          </button>
        );
      })}
    </>
  );
}
