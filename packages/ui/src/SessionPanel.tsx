// **The session panel — what a live browser hands back, before it is a test** (`M219` `F`, `D1165`).
//
// WHAT THIS REGION IS ON THE OTHER DOOR. The API door puts the **response** under the editor
// (`D1110`, `D1116`) and `D1102` is what makes it worth the space: evidence becomes a statement by
// ticking it, with the value and the assertion it produces on one screen. `send` is API's alone
// (`D1075`) — a browser test's unit is a *session*, so there is no prefix that can be cut at a
// statement and still mean anything — so the region needed a different tenant, not an empty one.
//
// **THE SAME IDEA WITH A LIVE PAGE AS THE EVIDENCE.** `/api/pick` and `/api/record` already open a
// real Chromium and stream lines back. What changed is where the lines land.
//
// **THIS AMENDS `D1095`, AND SAYS SO RATHER THAN QUIETLY WIDENING IT.** The recorder appended
// straight into the buffer, and its argument was that the buffer is reversible. It is — and what
// it is not is *reviewable*: a two-minute session writes thirty statements into a file the author
// is looking at, and the only way to drop the four that were mis-clicks is to find them among the
// twenty-six that were not. The tick is not a second authoring surface: the statements are the
// recorder's own, **already parsed before they are believed**, and this panel chooses which of
// them to keep. Nothing here builds anything.
import type { Step } from '@tflw/lang';
import type { LocatorSpec } from '@tflw/lang';
import { SourceText } from './Source';

/** One line a session produced. A recorded **statement**, or a locator a `pick` suggested. */
export type SessionLine =
  | { readonly id: number; readonly kind: 'step'; readonly text: string; readonly node: Step }
  /** A line the recorder sent that this page could not parse. Kept and shown rather than dropped:
   *  a recorder that silently loses a gesture is one nobody can trust, and the raw line is what a
   *  defect report needs (`D1076`). */
  | { readonly id: number; readonly kind: 'unreadable'; readonly text: string }
  | { readonly id: number; readonly kind: 'locator'; readonly locator: LocatorSpec };

export interface Session {
  /** Which gesture opened the browser — the two read the same and are labelled apart. */
  readonly kind: 'record' | 'pick';
  /** Whether the browser is still open. A closed session keeps its lines: the author is meant to
   *  review them, and closing the browser is how you stop adding to the list. */
  readonly live: boolean;
  readonly lines: readonly SessionLine[];
  /** The declaration a recording writes into, by name — `null` for a `pick`. */
  readonly into: string | null;
}

export function SessionPanel({ session, onKeep, onKeepAll, onDrop, onStop, onStart, canStart, why }: {
  readonly session: Session | null;
  readonly onKeep: (line: SessionLine) => void;
  readonly onKeepAll: () => void;
  readonly onDrop: (id: number) => void;
  readonly onStop: () => void;
  readonly onStart: (() => void) | null;
  readonly canStart: boolean;
  /** Why `onStart` is not offered, when it is not. A disabled control that does not say why is the
   *  pattern `D1082` refuses, so this region never draws one without a sentence. */
  readonly why: string;
}) {
  if (session === null) {
    return (
      <div className="response-none session-none" data-session="none">
        <button className="run" onClick={() => onStart?.()} disabled={!canStart || onStart === null} data-session-start data-tip="open the page and use it — every action becomes a line here, and the ones you keep become steps">
          record a session
        </button>
        <p className="muted" data-session-why>
          {canStart
            ? 'A real browser opens on this test’s page. Every gesture arrives here as a line; the ones you keep are spliced into the test, and the ones you do not are dropped when you close it. Nothing is written until you keep it.'
            : why}
        </p>
      </div>
    );
  }

  const steps = session.lines.filter((l) => l.kind !== 'locator');
  return (
    <div className="session-panel" data-session={session.kind} data-session-live={session.live ? 'yes' : 'no'} data-session-lines={session.lines.length}>
      <header className="response-head-bar">
        <span className={session.live ? 'status-code pass' : 'status-code warn'} data-session-state={session.live ? 'live' : 'closed'}>
          {session.live ? 'live' : 'closed'}
        </span>{' '}
        <span className="muted" data-session-head>
          {session.kind === 'record'
            ? session.into === null
              ? 'recording'
              : `recording into ${session.into}`
            : 'picking an element'}
          {' — '}
          {session.lines.length} line{session.lines.length === 1 ? '' : 's'}
        </span>
        {session.kind === 'record' && steps.length > 0 ? (
          <button onClick={onKeepAll} data-session-keep-all data-tip="splice every line below into the test, in order">
            keep all {steps.length}
          </button>
        ) : null}
        {session.live ? (
          <button onClick={onStop} data-session-stop data-tip="close the browser this session opened">
            stop
          </button>
        ) : null}
      </header>
      {session.lines.length === 0 ? (
        <p className="muted" data-session-empty>
          {session.live
            ? session.kind === 'record'
              ? 'use the page — every click, keystroke and navigation arrives here'
              : 'click something in the browser that opened'
            : 'the browser closed without sending anything'}
        </p>
      ) : (
        <ol className="session-lines">
          {session.lines.map((l) => (
            <li key={l.id} className="session-line" data-session-line={l.id} data-session-line-kind={l.kind}>
              {l.kind === 'locator' ? (
                <>
                  <button className="tick" onClick={() => onKeep(l)} data-session-keep={l.id} data-tip="write this locator onto the row that started the pick">
                    ＋
                  </button>
                  <code className="stmt-text">
                    {l.locator.kind} “{l.locator.value}”
                  </code>
                </>
              ) : l.kind === 'unreadable' ? (
                <>
                  <span className="tick-none" data-session-unreadable={l.id}>
                    ⚠
                  </span>
                  <code className="stmt-text">{l.text}</code>
                  <span className="muted">the recorder sent this and the language could not read it — it is kept here rather than dropped</span>
                </>
              ) : (
                <>
                  {/* **Ticking is what writes it** (`D1165`). Until then the statement is evidence
                      and the file has not changed — which is the whole of what this panel adds to
                      `D1095`'s reversible buffer. */}
                  <button className="tick" onClick={() => onKeep(l)} data-session-keep={l.id} data-tip="splice this statement into the test">
                    ＋
                  </button>
                  <code className="stmt-text">
                    <SourceText text={l.text} />
                  </code>
                </>
              )}
              <button className="seq-x" onClick={() => onDrop(l.id)} data-session-drop={l.id} data-tip="take this line off the list — it was never in the file">
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
