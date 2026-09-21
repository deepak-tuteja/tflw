// **The stage — where a play is watched, under the thing that was played** (`M221` `A`, `D1181`).
//
// WHY THERE IS A REGION HERE AT ALL. `M220` put the trace viewer in the **Run** tab (`D1179`) and
// argued the placement from one measurement: the viewer compresses to a floor of 606 px and the
// editor column is 460–860 px depending on where `COMPOSE`'s grip has been dragged, so the viewer
// does not fit beside the sequence. That is true of the *column* and false of the region under it.
// Measured on the live page at 1440x900: `main` is **1114 px** wide, `elementFromPoint` below the
// columns returns `main` itself, and there are **349 px** of unused height there. So the viewer
// fits under the columns with nearly double its floor, and the grip cannot reach it — which is the
// argument `D1179` was made from, pointing the other way.
//
// WHAT IS SHORT IS HEIGHT, AND THAT IS THE TRADE. 349 px against a viewer that wants ~700. The
// stage takes a height of its own and the page scrolls to it; it does not try to fit in what was
// left over, because a viewer squeezed into 349 px shows a timeline and no snapshot.
//
// **THIS IS NOT A SIXTH TAB, AND THAT RULE IS UPHELD RATHER THAN WORKED AROUND** — `doors.ts`:
// *a tab is a stage of one file's life — read it, write it, run it — or a project fact that file
// resolves against*. The stage is a region of the Compose tab, the way the session panel beside
// the editor already is, and Run keeps its own viewer for the reports that are not this file's
// (`D1182`).
import type { ReportEntry, RunReport } from './contract';
import { reportFileUrl } from './api';

/** Where a played declaration's trace is, once there is one. */
export interface StageTrace {
  readonly reportId: string;
  readonly path: string;
}

/**
 * The trace of `played` in `report`, or `null`.
 *
 * **`trace.path` only, and `base64` is deliberately not read here.** `TraceLink` accepts both
 * because it renders reports of any age and a report written before `M220` `B` carries the bytes
 * and no path (`D1171`). The stage has a narrower subject: it shows a play *this pane just
 * pressed*, and every such run writes a path. Hashing 800 KB of base64 in the browser to recover a
 * filename would be `D1171`'s own defect reintroduced for a case that cannot occur.
 */
export function traceOf(report: RunReport, played: string, reportId: string): StageTrace | null {
  const test = report.tests.find((t: ReportEntry) => t.kind === 'functional' && t.name === played);
  const path = test !== undefined && test.kind === 'functional' ? test.trace?.path : undefined;
  return path === undefined ? null : { reportId, path };
}

/**
 * **Always drawn, never absent** (`D1187`, and `D1082` one layer up).
 *
 * A region that appears and disappears under the reader is the pattern `D1082` refuses — the
 * author presses ▶, the page grows by 700 px, and what they were reading moves. So the stage is
 * here from the first render and says which of four things is true: nothing has been played, a
 * play is going, a recording is open (`D1174`'s *empty-with-a-hint while you record in the real
 * window, and fills with the trace when you stop* — this is the surface that sentence promised),
 * or here is the trace.
 */
export function Stage({ trace, played, running, recording, viewer, unignored }: {
  readonly trace: StageTrace | null;
  readonly played: string | null;
  readonly running: boolean;
  readonly recording: boolean;
  /** The play scratch's name when this project's `.gitignore` does not list it, `null` otherwise.
   *  A ▶ writes a file beside the test; a project that would commit it deserves the sentence, and
   *  this is the region where a play's consequences are visible. `D1076` — over-offering beats
   *  silent omission. */
  readonly unignored: string | null;
  /** Whether `playwright-core` resolves from the project — `readProject`'s `traceViewer`. With no
   *  viewer to serve there is nothing to put in the frame, and the hint says what to run instead
   *  rather than drawing an empty box (`D1082`). */
  readonly viewer: boolean;
}) {
  const src = trace === null ? null : `/trace/index.html?trace=${encodeURIComponent(new URL(reportFileUrl(trace.reportId, trace.path), window.location.origin).toString())}`;
  /**
   * **Before a run the stage is one line, and the line says what ▶ does** — `M223` `A` (`D1194`).
   *
   * This was a `<p class="stage-hint">` in a dashed box of its own: **105 px of paragraph inside a
   * 183 px region** on a page whose authoring columns had 239 px to share (measured, 1440x900,
   * `PLAN_M223` §1.1). `D1076` — over-offering beats silent omission — is satisfied by the
   * sentence; what `D1082` retires is the frame drawn around it, which is chrome for a region
   * holding nothing yet.
   *
   * The `played === null` sentence loses its second clause — *every click, every navigation, every
   * assertion, with the page as it was at each step* — **deliberately, and it is not relocated**: a
   * sentence that sells a feature is worth one line, not four, and the feature sells itself the
   * first time it runs. The other four say what they said, in a line each.
   */
  const hint: string | null =
    src !== null && viewer ? null
    : running ? 'a run is going — the trace lands here when it finishes'
    : recording ? 'a recording is open — every gesture arrives in the panel above; press ▶ when you have lines worth running'
    : !viewer ? 'no playwright-core in this project — npx playwright show-trace opens the trace written beside the report'
    : played === null ? 'press ▶ on a test to run it and watch it here'
    : 'that run kept no trace — a trace is written for a browser test at evidence full, which is what ▶ asks for';
  return (
    <section className="stage" data-stage={trace === null ? 'empty' : 'trace'} data-stage-played={played ?? undefined}>
      <header className="stage-bar">
        <span className="stage-title">playback</span>
        {trace === null ? null : (
          <>
            <span className="muted" data-stage-of>
              {played}
            </span>
            <a href={reportFileUrl(trace.reportId, trace.path)} download data-stage-download>
              trace.zip
            </a>
          </>
        )}
        {/* `D1187` still holds and is now cheaper to hold: the region says which of its four states
            it is in, in the bar it already had, rather than in a box below it. */}
        {hint === null ? null : (
          <span className="muted stage-line" data-stage-hint>
            {hint}
          </span>
        )}
      </header>
      {unignored === null ? null : (
        <p className="muted" data-stage-unignored={unignored}>
          ▶ writes <code>{unignored}</code> beside the test it runs, and this project&rsquo;s <code>.gitignore</code> does not list it — add that line.
        </p>
      )}
      {/* `src === null` is redundant with `hint !== null` and is written anyway: it is what tells
          the checker the frame's `src` is a string, and an assertion in its place would be a claim
          about the ternary above rather than a fact the compiler can hold. */}
      {hint !== null || src === null ? null : (
        /* Same-origin, so the frame is admissible for the reason `D1179` gave: the viewer is served
           by THIS server under `/trace/`. `M220` §2.1's refused iframe was of the application
           *under test*, on another port, which is a different claim entirely. */
        <iframe className="stage-frame" data-stage-frame title={`trace of ${played ?? 'the last play'}`} src={src} />
      )}
    </section>
  );
}
