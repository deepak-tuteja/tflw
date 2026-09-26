// Compose (`M210`, `D1072`). The pane that writes a file, showing the file it writes — and then
// letting you type into what it is showing.
//
// §0 of the plan is the whole reason this module exists, and it is worth restating where the code
// is: **Compose was not a weak representation of the source, it was not a representation at all.**
// `ApiForm`'s fields are its own state; nothing connected them to the open file but the path in the
// write button. Measured on a 45-line file with a hook, a data table and two tests: 444 px, 14
// controls, every field empty. No gate complained, because a form with no opinion about the file
// cannot disagree with it.
//
// THE UNIT IS ONE REQUEST (`D1073`). 1031 of them in the sibling, a median of 2 attached statements
// each, and every one of the 206 multi-request tests interleaves — so *requests · scripts · other*
// as three flat sections is lossy by measurement, and the grouping that is not is one level lower:
// a `capture` is a property of the request above it. `outline.ts` does the grouping; this draws it.
//
// THE REMAINDER IS A BAND ABOVE THE REQUEST (`D1074`), not a second pane and not another tab. Tags,
// sessions, `with each`, workload, thresholds and the `let` preamble are facts about the test the
// request sits in; `import`/`use`/`action` are facts about the file. Both are shown *above* the
// card because that is where they are in the file and because Compose has to stay **one** editor —
// a pane that becomes a different editor depending on what you clicked is two tabs wearing one
// name, which is what `M205` §2's strip rule exists to refuse.
//
// IT DRAWS WHAT IT CANNOT EDIT (`D1076`/`D1078`). A step from another door is a **locked row in
// position**, rendered by the language's own printer and badged with the door that owns it. 386 of
// the sibling's 398 API tests are complete under the api + neutral vocabulary; the 12 that are not
// are the corpus's **largest** tests, and a pane that omitted their browser half would draw them
// with holes through the middle exactly where the order lives. Showing a step you cannot edit here
// is true, so it is allowed; hiding it is not.
//
// IT WAS READ-ONLY FIRST, AND THAT IS WHY IT CAN BE TRUSTED NOW (`D1082`). `S1` shipped every
// control disabled: nothing claimed to edit, so nothing could lie, and the AST→form direction —
// which did not exist in any form before it — was built and gated on its own. `S2`–`S5` then lit
// one family at a time: the request, its assertions, the statements between the requests and the
// notes above them, and the declaration's own band. **What is still read-only is a list that can be
// named**, which is what a half-live pane owes a reader: the three clauses `ApiStepSpec` cannot
// express (carried across an edit, never rebuilt), a subject or a body the builders cannot
// construct (kept as it is, offered nowhere else), an assertion no index pair can address (inside a
// `wait until api` block), a step belonging to another door — and the **workload**, which is the
// LOAD door's to shape (`D1042`) and says so with a link rather than a control.
//
// AND SEND RUNS THE PREFIX (`S6`, `D1075`). Four requests in five cannot run alone, so pressing it
// runs the file's hooks and this declaration up to the selected request — which is the honest thing
// to run and the expensive thing to press, and why the pane lists what it will send first.

import { useEffect, useMemo, useState } from 'react';
import { bandRefusal, bandWithout } from './clauses';
import { DEFAULT_WORKLOAD, THRESHOLD_WHY, WORKLOAD_CELL_WHY, WORKLOAD_FIELD_WHY, WORKLOAD_ITERATION_SHAPES, WORKLOAD_PROFILES, WORKLOAD_UNITS,
  workloadCitation, workloadEditOf, workloadSentenceOf, workloadWords } from './workloadEdit';
import type { WorkloadEdit, WorkloadStageEdit } from './workloadEdit';
import type { ReactNode } from 'react';
import type { ApiBodySpec, ApiStepSpec, CaptureSpec, ExpectSpec, SubjectSpec } from '@tflw/lang';
import { matcherSubjectRefusal } from '@tflw/lang';
import {
  LOCATOR_KINDS,
  buildExpect,
  print,
  quantifiable,
  type ApiBody,
  type ClickKind,
  type ExpectStmt,
  type FindingSeverity,
  type Lens,
  type LocatorKind,
  type LocatorSpec,
  type WaitUntilUiStmt,
  type LogDestination,
  type LogLevel,
  type DataTableSpec,
  type HookDecl,
  type MatcherName,
  type NoteOwner,
  type PathSegment,
  type StepPath,
  type Step,
  type Subject,
  type ThresholdDecl,
  type ThresholdMetric,
  type ThresholdOp,
  type ThresholdSpec,
  SYNTHETIC,
} from '@tflw/lang';
import { LEAF_CAP, captureName, captureSpecs, leaves, verifySpec } from './response';
import { laidOut } from './jsonview';
import type { FileOutline, Note, OutlineCrawl, OutlineHook, OutlineRequest, OutlineStatement, OutlineTest } from './outline';
import { BodyText } from './Source';

/**
 * A comment, shown where its owner is (`D1077`).
 *
 * Collapsed to its first line with a count, because the longest block in the sibling is **63
 * lines** and a note that opened whole would push the request it explains off the screen. It is a
 * `<details>` rather than a button for `D144`'s reason — disclosure is what the element is for,
 * and the open state is then the browser's rather than a piece of state nobody reads. **It is
 * uncontrolled on purpose, with the cost stated:** the strip unmounts this panel on a tab trip, so
 * an opened note closes itself, exactly as the legacy disclosure did before its state was lifted
 * into `ApiForm`. A note is a read rather than a half-finished gesture, so re-opening it costs one
 * click and nothing is lost; lifting the open state of every note in a file would be a map keyed by
 * line living above the pane to spare that click.
 */
/** A note's text without its `#`s — the hash is how a comment is spelled, not something an author
 *  should have to retype on every line. `null` is a note that does not exist yet. */
function noteText(note: Note | null): string {
  return note === null ? '' : note.lines.map((line) => line.replace(/^#\s?/, '')).join('\n');
}

/**
 * A note being written, open (`M210` `S4`).
 *
 * **Not a `<details>`, and that is the whole reason this exists separately.** A new note has to
 * have somewhere to be typed *before* it exists, and driving a disclosure's `open` from the note's
 * own emptiness slams it shut on the first keystroke, while forcing `open` from React re-opens it
 * every time the author closes it. So the gesture owns the state (`RowEditing.noting`) and the
 * editor is a plain block for as long as it lasts.
 */
export function NoteOpen({ note, what, onChange }: {
  readonly note: Note | null;
  readonly what: string;
  readonly onChange: (lines: readonly string[]) => void;
}) {
  return (
    <div className="note note-open" data-note={what} data-note-lines={note?.lines.length ?? 0}>
      <textarea
        className="note-edit"
        autoFocus
        value={noteText(note)}
        rows={2}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        data-note-edit={what}
        aria-label="note"
        data-tip="a `#` comment above this line in the file — written without the hashes, because the hash is how a comment is spelled and not something to retype"
      />
    </div>
  );
}

export function NoteBlock({ note, what, onNote }: {
  readonly note: Note;
  readonly what: string;
  /**
   * Where an edit to this note goes (`M210` `S4`). Absent leaves it read-only, which is every
   * note this pane cannot address — a declaration's, and the file's own header, both `S5`'s.
   *
   * **A note that can be typed into is always a `<details>`, even a one-line one.** The collapsed
   * form of an editable note has to open onto something, and a one-line note that turned into a
   * paragraph would be the one note on the pane with no way in.
   */
  readonly onNote?: (lines: readonly string[]) => void;
}) {
  const text = noteText(note);
  if (note.lines.length === 1 && onNote === undefined) {
    return (
      <p className="muted note" data-note={what} data-note-lines={1}>
        {note.first}
      </p>
    );
  }
  return (
    <details className="note" data-note={what} data-note-lines={note.lines.length}>
      <summary className="muted">
        {note.first} {note.lines.length > 1 ? <span className="count">+{note.lines.length - 1}</span> : null}
      </summary>
      {onNote === undefined ? (
        /* Lines **two onward**. The summary is already the first line, and a `<details>` shows its
           summary while it is open — so joining the whole block here printed line 1 twice, which is
           what the rendered page said and the model did not. Found by reading the paint. */
        <pre className="muted note-body">{note.lines.slice(1).join('\n')}</pre>
      ) : (
        /* …and the editable form holds the WHOLE block, first line included, because that is the
           thing being edited. Without its `#`s: the hash is how a comment is spelled, not something
           an author should have to retype on every line. */
        <textarea
          className="note-edit"
          value={text}
          rows={Math.min(Math.max(note.lines.length, 2), 12)}
          onChange={(e) => onNote(e.target.value.split('\n'))}
          data-note-edit={what}
          aria-label="note"
          data-tip="a `#` comment above this line in the file — written without the hashes, because the hash is how a comment is spelled and not something to retype"
        />
      )}
    </details>
  );
}

/**
 * One statement of a request's attachments, or of a test's preamble.
 *
 * **One construct, two renderings** (`D1078`). This door's own vocabulary and the neutral
 * vocabulary every door carries get the row with the fields in it; a step belonging to another
 * door gets a locked one-line row naming that door — the same row, shorter, never absent.
 */
/**
 * **One named `+ add` per scope** (`M212` `S3`, `D1084` — amending `D1076`).
 *
 * `D1076` said Compose models the whole vocabulary, and the pane implemented it by drawing every
 * clause as a control whether the file used it or not. Measured on the scaffold `tflw init` writes
 * — three lines — that is **47 controls, 34 of them fields, 18 of those empty or showing a
 * default**. A pane where half the fields stand for nothing teaches a reader that most of what they
 * are looking at is noise, which is the opposite of what `D1076` wanted.
 *
 * `D1084` answers `D1076` rather than dismissing it, and the answer is this menu: **the vocabulary
 * moves one click away, it does not shrink.** So this list must be COMPLETE — every clause the
 * scope admits is named here, including the ones already in use (shown, disabled, saying so) and
 * the ones this door cannot construct (shown, disabled, saying why). A menu that listed only what
 * you could add would teach a smaller language than the one that exists, which is the failure
 * `D1076` was written against.
 *
 * A `<details>` rather than a popup for `D144`'s reason, and for `S1`'s: closed, it contributes
 * nothing to the tab order.
 */
/**
 * The clause menu — and since `M216` `D`, the only place a clause is removed (`D1131`).
 *
 * **It was already the complete vocabulary and already knew which clauses were present**, and it
 * spent that knowledge on the word *"— already here"* beside a disabled button. So that row is the
 * remove: one list carries what a clause is, whether it is written, and how to unwrite it, and no
 * clause row grows a control on a band that is already dense.
 *
 * `refusalFor` returns the sentence a refused removal says, and it is drawn **under the row,
 * inline** rather than on hover — `D1117` found that a `✕` whose refusal lives in a `title` is
 * indistinguishable from a broken button, and 81% of that case's removals refuse, so the reason is
 * the common outcome rather than the corner.
 */
export function AddClause({ what, options, onAdd, onRemove, refusalFor }: {
  readonly what: string;
  readonly options: readonly { key: string; label: string; title: string; state: 'addable' | 'present' }[];
  readonly onAdd: (key: string) => void;
  readonly onRemove?: (key: string) => void;
  readonly refusalFor?: (key: string) => string | null;
}) {
  const [refused, setRefused] = useState<{ readonly key: string; readonly why: string } | null>(null);
  return (
    <details className="add-clause" data-add-clause={what} data-add-clause-options={options.length}>
      <summary>+ add to this {what}</summary>
      <ul>
        {options.map((o) => (
          <li key={o.key} data-add-option={o.key} data-add-state={o.state}>
            <button type="button" disabled={o.state !== 'addable'} onClick={() => onAdd(o.key)} data-tip={o.title} data-add-go={o.key}>
              {o.label}
            </button>
            {o.state === 'present' ? <span className="muted"> — already here</span> : null}
            {o.state === 'present' && onRemove !== undefined ? (
              <button
                type="button"
                className={`seq-x${refused !== null && refused.key === o.key ? ' refused' : ''}`}
                aria-label={`remove ${o.label} from this ${what}`}
                data-tip={`unwrite ${o.label} — this ${what} stops saying it`}
                data-add-remove={o.key}
                onClick={() => {
                  if (refused !== null && refused.key === o.key) { setRefused(null); return; }
                  const why = refusalFor?.(o.key) ?? null;
                  if (why !== null) { setRefused({ key: o.key, why }); return; }
                  setRefused(null);
                  onRemove(o.key);
                }}
              >
                ✕
              </button>
            ) : null}
            {refused !== null && refused.key === o.key ? (
              <p className="warn clause-refusal" data-add-refusal={o.key}>{refused.why}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * EVERYTHING A ROW NEEDS TO BE EDITABLE, IN ONE OBJECT (`M210` `S4`).
 *
 * It was five props threaded through three components by the end of `S3`, and `S5` adds more. The
 * bundle is passed down whole so a new capability is a field here rather than another parameter on
 * every component between the shell and the row.
 *
 * `null` in `onRow` is what read-only means: `S1`'s state, and every door but API's.
 */
export interface RowEditing {
  /** The row being typed into, by its own index pair, and its live values. */
  readonly row: { readonly key: string; readonly values: StatementEdit } | null;
  readonly onRow: ((statement: OutlineStatement, next: StatementEdit) => void) | null;
  /**
   * Where a change to a note goes (`D1077`) — addressed by **what it is a note on**, which since
   * `S5` is one of three things: a statement, a declaration, or the file. A note whose every line
   * is blank is a note removed, at both ends of the gesture.
   */
  readonly onNote: ((owner: NoteOwner, lines: readonly string[]) => void) | null;
  /** The declaration header being typed into, and where a change goes (`M210` `S5`). */
  readonly header: { readonly key: string; readonly values: HeaderEdit } | null;
  readonly onHeader: ((decl: OutlineHook | OutlineTest, next: HeaderEdit) => void) | null;
  /** One threshold of a test, by its own index. `null` as the value removes it. */
  readonly threshold: { readonly key: string; readonly values: ThresholdEdit } | null;
  readonly onThreshold: ((decl: OutlineTest, index: number, next: ThresholdEdit | null) => void) | null;
  /**
   * **A test's one workload, as a clause rather than a door's property** — `M224` `B` (`D1205`).
   *
   * `null` as the value removes it, which is the gesture that did not exist anywhere in the
   * product until this round: the band linked to the LOAD door, and the LOAD door listed every
   * workload-bearing test as *(already a workload test)* with its arming checkbox disabled.
   *
   * There is no index beside it because a test carries at most one — the parser enforces that, so
   * this is `onThreshold` with the list taken out.
   */
  readonly workload: { readonly key: string; readonly values: WorkloadEdit } | null;
  readonly onWorkload: ((decl: OutlineTest, next: WorkloadEdit | null) => void) | null;
  /** One `import` or `use` line of the file. `null` as the path removes it. */
  readonly onFileDecl: ((what: 'import' | 'use', index: number, path: string | null) => void) | null;
  /**
   * The row whose **new** note is open, by the same key.
   *
   * A note being written needs somewhere to be written *before* it exists, and a `<details>` cannot
   * be that: driving its `open` from the note's own emptiness slams it shut on the first keystroke,
   * and forcing `open` from React re-opens it every time the author closes it. So a new note is an
   * open editor rather than a disclosure, and this is the one thing that says which row has one.
   */
  readonly noting: string | null;
  readonly onNoting: ((key: string | null) => void) | null;
  /**
   * **`tflw pick`, as a locator-fixer on the row that holds the locator** — `M213` `S4`
   * (`D1106`).
   *
   * `pick` opens a real browser against the page this test opens, and every click in it reports
   * the locator of what was clicked without navigating (`installPickClickCapture` does
   * `preventDefault`). `BrowserForm` had it beside a staging form's rows; here it belongs to the
   * **statement**, because a locator is a field of a statement and *fix this locator* is the
   * gesture people actually have.
   *
   * `null` everywhere on a door with no locators in its vocabulary. `row` is the `stepKey` of the
   * row a running session will fill, which is enough to name it: a `click` and a `fill` each carry
   * exactly one locator, on all 2,296 corpus instances.
   */
  readonly pick: {
    readonly row: string | null;
    readonly found: readonly LocatorSpec[];
    readonly onStart: (key: string) => void;
    readonly onStop: () => void;
  } | null;
}

/**
 * What the last run said about one statement (`M210` `S6`).
 *
 * `detail` is the runtime's own one-line summary — `status = 200`, `orderId = 42 (captured)`, or
 * the reason it failed — which is the sentence the report already writes and this pane has no
 * business writing a second version of.
 */
export interface Verdict {
  readonly ok: boolean;
  readonly detail: string;
  /** The statement this is about, as it ran (`D1108`) — the same check the request's own line
   *  gets, one row down. A verdict beside an assertion that has since been typed into is a claim
   *  about bytes nobody has. */
  readonly source: string;
  /** Whole milliseconds, the report's own figure (`D807`). `StepResult` carries it and nothing
   *  showed it; an assertion that passes in 4 ms and one that passes in 4 s read the same. */
  readonly durationMs: number;
}

/**
 * The last response, as the report recorded it (`M210` `S6`, widened by `M213` `S2`).
 *
 * It is the run's own trace rather than a second HTTP client in this page, which is `D1047`
 * unchanged.
 *
 * **IT ARRIVES TWO WAYS AND THE PANE SAYS WHICH** (`D1099`). The default is the last run that
 * touched this file, read off the report already on disk — free, instant, and there for every
 * request in the file rather than for the one you pressed a button on. A `send` fires a scoped run
 * of one request and replaces that request's entry. Both are real reports, so `D956` holds for
 * both; a reader who cannot tell a four-day-old run from a press two seconds ago is reading a
 * claim with no date on it.
 */
export interface Ran {
  /**
   * **The step this ran for** — a request, or since `M232` (`D1270`) any **action**.
   *
   * It said *the request this ran for*, and that sentence is exactly how the API-shaped assumption
   * behind `M220-02` stayed invisible: `indexFromReport` opened a group only on `step.kind ===
   * 'api'` and dropped every verdict while none was open, so a browser test's map was empty **by
   * construction** — its assertions drew no marks while its status chip did. Amended in place
   * rather than left, because a comment that has drifted from its code is invisible to every test.
   */
  readonly line: number;
  /**
   * **That step's line, exactly as it ran** (`D1108`).
   *
   * The join key is `(line, source)` and not `line` alone, which is the whole of why this field
   * exists. A line number is the most fragile join key there is (`D1093`): insert one request and
   * every verdict below it attaches to the wrong row, *plausibly*. Carrying the text that ran lets
   * the pane check rather than assume — a response is shown only where the request still reads the
   * way it read when the run made it.
   */
  readonly source: string;
  /** Where it came from, in the two words the summary line prints. */
  readonly scope: 'run' | 'send';
  /** When the run that produced it started, ISO-8601. Printed, because a report on disk may be
   *  from this minute or from last Tuesday and only one of those is evidence about now. */
  readonly at: string;
  /**
   * The verdicts, **keyed by the open file's own line** (`D1093`).
   *
   * A map and not a list, and the key is the file's line rather than a position in the run — which
   * is the difference between *this ✓ is about the row it is beside* and *this ✓ is about whatever
   * is fourth*. The caller builds it and drops every entry whose recorded `source` no longer
   * matches the buffer, so a verdict that reaches this pane is one that is still about what is
   * written. Both scopes arrive in this shape: a send runs a printed scratch whose line numbers
   * are not this file's, so the caller maps its steps back onto the request it sent.
   */
  readonly steps: ReadonlyMap<number, Verdict>;
  /**
   * The response, for a group a **request** opened. `null` for a group an **action** opened, which
   * is not a degenerate case and is not new: `indexFromSend` already produces groups with an empty
   * verdict map, so both fields have always been allowed to be empty and the shape is unchanged.
   *
   * A browser action has no response by nature — what its assertions read is the page it left.
   */
  readonly response: { readonly status: number; readonly url: string; readonly method: string; readonly bodyText: string } | null;
}

/** What the pane knows about every request in the open file, by the line each one is on. `null`
 *  before anything has been read, which is a different state from *read and there was nothing*. */
export type RanIndex = ReadonlyMap<number, Ran>;

/** The verdict beside the row it belongs to, and nothing at all before anything has run.
 *
 *  The duration sits in the mark rather than in a column of its own: it is the one number a reader
 *  wants *about this row* and it is already in the report. `D807` keeps it whole-millisecond. */
export function VerdictMark({ verdict }: { readonly verdict: Verdict | null }) {
  if (verdict === null) return null;
  return (
    <span className={`step-verdict ${verdict.ok ? 'pass' : 'fail'}`} data-verdict={verdict.ok ? 'pass' : 'fail'} data-tip={verdict.detail}>
      {verdict.ok ? '✓' : '✗'} {verdict.detail} <span className="muted" data-verdict-ms={verdict.durationMs}>{verdict.durationMs} ms</span>
    </span>
  );
}

/** `ago` lives in `format.ts` since `M240` `F` (`M239-05`); re-exported so its callers here keep
 *  one import. */
export { ago } from './format';

/** A statement's address as one string, for keying the row being typed into. `null` for a row no
 *  index pair can name. */
export function stepKey(path: StepPath | null): string | null {
  return path === null ? null : `${path.decl}:${path.step}`;
}

/**
 * **A ROW's address as one string** — `M219` `D` (`D1163`).
 *
 * A statement inside a scoping block shares the block's index pair, because the block is the step
 * of the body and the statement is inside it. So the pair alone stops being an identity the moment
 * a `within` becomes two rows, and two rows keyed the same share one editing buffer: typing into
 * the scope would move what the inner gesture's field shows. `inner` is the second half.
 */
export function rowKey(statement: { readonly stepPath: StepPath | null; readonly inner: number | null }): string | null {
  const base = stepKey(statement.stepPath);
  return base === null ? null : statement.inner === null ? base : `${base}#${statement.inner}`;
}

/**
 * A labelled read-only field. The control is a real disabled `input`/`select` rather than text,
 * because `S2` lights these in place and a slice that swapped text for controls would be rewriting
 * the card rather than enabling it.
 *
 * Its row is `.request-fields` and **not** `.request-line`, which was the first draft's name and is
 * already taken: `.request-line` is the legacy form's method/path/service/label row, and `M205`
 * `S1`'s gate counts exactly four controls under it. Two different rows wearing one class is the
 * drift class this repository files findings against, and here it had teeth — the gate saw nine.
 */
export function Field({ label, value, title, onChange, placeholder }: {
  readonly label: string;
  readonly value: string;
  readonly title?: string;
  /** Absent means this field is one the builders cannot construct, so it stays disabled and is
   *  carried across an edit instead — `D1082` narrowing to a list that can be named rather than a
   *  pane that is half live and says nothing about which half. */
  readonly onChange?: (next: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <label className="field" data-tip={title} data-field={label}>
      {label}
      <input
        value={value}
        placeholder={placeholder}
        readOnly={onChange === undefined}
        disabled={onChange === undefined}
        onChange={onChange === undefined ? undefined : (e) => onChange(e.target.value)}
        data-field-value={label}
      />
    </label>
  );
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/**
 * What the card can change about a request — `S2`'s vocabulary, and **not** the whole of one.
 *
 * `timeout`, `without redirects` and the per-request `retry honoring "Retry-After"` are drawn on
 * the card and are not in here, because `ApiStepSpec` cannot express them. That asymmetry is the
 * hazard this shape exists to make impossible to miss: a node rebuilt from a spec alone would come
 * back **without** the three fields the spec has no room for, and the file would lose them silently
 * — source that still parses, still runs, still passes, and tests something the author did not ask
 * for. `nodeFor` below carries them across explicitly, and a gate asserts they survive an edit.
 */
export interface RequestEdit {
  readonly method: (typeof METHODS)[number];
  readonly path: string;
  readonly service: string;
  readonly label: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  /**
   * **Six named kinds, five of them buildable.** The plan's `S2` says *all six body kinds*;
   * `ApiBodySpec` has five, because `UploadBody` is a body the **printer** can emit and the
   * **builder** cannot construct — widening `ApiBodySpec` is its own slice.
   *
   * `upload` is named here anyway, and that is the whole point of naming it: the first draft folded
   * it into `none`, so editing the *path* of a request with an upload body **deleted the body** —
   * `multipart/form-data` silently gone from a request that still parsed and still ran. Twelve
   * requests in the sibling carry one. Named, it is carried across an edit exactly as `timeout` and
   * `without redirects` are, and the control that would change it is the one control this card
   * refuses to offer.
   */
  readonly bodyKind: 'none' | 'json' | 'text' | 'file' | 'form' | 'upload';
  readonly bodyText: string;
  readonly formFields: readonly { readonly name: string; readonly value: string }[];
  /**
   * **The three `M214` `A2` widened the builder for**, held as text because that is what a field
   * holds and because an unparseable intermediate state has to be typeable: `3` on the way to
   * `30s` is not a duration, and a control that refused the keystroke would be a control nobody
   * can type into.
   *
   * `timeout` is the language's own spelling — `30s`, `500ms`, `2m` — and blank means *the env's*.
   * `retryAfter` is the bare count after `up to`; blank means the clause is not written.
   */
  readonly timeout: string;
  readonly redirects: boolean;
  readonly retryAfter: string;
}

/**
 * A duration as the language spells it, back to milliseconds — the inverse of `print`'s own
 * `duration()`, which emits `m` above a minute, `s` above a second and `ms` otherwise.
 *
 * It is **here and not in `@tflw/lang`** deliberately: the language reads a duration with a
 * dedicated lexer token and has no reason to grow a string parser for one. What this covers is the
 * three spellings that function can emit plus a bare number, which is what an author types before
 * they have typed the unit. Anything else is `null` and the builder says so.
 */
export function durationMs(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m)?\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const scale = m[2] === 'm' ? 60_000 : m[2] === 's' ? 1_000 : 1;
  const ms = n * scale;
  return Number.isInteger(ms) ? ms : null;
}

/** The card's current values, read off a request the file already holds. */
export function editOf(r: OutlineRequest): RequestEdit {
  const body = r.body;
  return {
    method: r.method,
    path: r.path,
    service: r.service ?? '',
    label: r.label ?? '',
    headers: r.spec.headers.map((h) => ({ name: h.name.value, value: h.value.type === 'StringLit' ? h.value.value : printValue(h.value) })),
    bodyKind:
      body === null ? 'none'
      : body.type === 'InlineBody' ? 'json'
      : body.type === 'TextBody' ? 'text'
      : body.type === 'FileBody' ? 'file'
      : body.type === 'FormBody' ? 'form'
      : body.type === 'UploadBody' ? 'upload'
      : 'none',
    bodyText:
      body === null ? '{ }'
      // **The BODY node, with its keyword stripped — not the value inside it.** An `ObjectLit` is
      // `CONTEXT_BOUND`: it has no source of its own to be re-parsed from, so the printer refuses
      // it and refusing is correct. Printing `body.value` put `# unprintable: no printer for
      // ObjectLit` into the field, which then failed to build, so **every edit to a request with a
      // JSON body was silently refused** — including edits to its path, which have nothing to do
      // with its body. Found by typing into the served page, not by any check over the model.
      : body.type === 'InlineBody' ? withoutKeyword(printValue(body))
      : body.type === 'TextBody' ? body.value.value
      : body.type === 'FileBody' ? body.path.value
      : '{ }',
    formFields: body !== null && body.type === 'FormBody' ? body.fields.map((f) => ({ name: f.key, value: f.value.type === 'StringLit' ? f.value.value : printValue(f.value) })) : [],
    /* Read off the node, which has carried all three since the enterprise arc — `M214` `A2`. */
    timeout: r.spec.timeoutMs === null ? '' : durationText(r.spec.timeoutMs),
    redirects: r.spec.followRedirects,
    retryAfter: r.spec.retryAfter === null ? '' : String(r.spec.retryAfter.max),
  };
}

/** The spec half of an edit — what `buildApiStep` takes. */
export function specOf(edit: RequestEdit): ApiStepSpec {
  const body = ((): ApiBodySpec | null => {
    switch (edit.bodyKind) {
      case 'none': return null;
      case 'json': return { kind: 'json', text: edit.bodyText };
      case 'text': return { kind: 'text', text: edit.bodyText };
      case 'file': return { kind: 'file', path: edit.bodyText };
      case 'form': return { kind: 'form', fields: edit.formFields.map((f) => ({ key: f.name, value: f.value })) };
      // The builder has no upload spec; the caller carries the original node across instead.
      case 'upload': return null;
    }
  })();
  return {
    service: edit.service.trim() === '' ? null : edit.service.trim(),
    method: edit.method,
    path: edit.path,
    headers: edit.headers.map((h) => ({ name: h.name, value: h.value })),
    body,
    label: edit.label.trim() === '' ? null : edit.label.trim(),
    /* **Always all three, never omitted** — `ApiStepSpec` says why on the fields themselves: they
       are optional so that a caller building a FRESH request keeps the language's defaults, and a
       caller REBUILDING one that leaves them out drops them from the file. This is that caller. */
    /* `NaN` rather than `null` for a string that is not a duration: `null` means *the env's*, which
       is a real and different answer, so handing it back for `"3x"` would silently discard what was
       typed. `buildApiStep`'s own `duration()` refuses a `NaN` with a sentence the field shows. */
    timeoutMs: edit.timeout.trim() === '' ? null : (durationMs(edit.timeout) ?? Number.NaN),
    followRedirects: edit.redirects,
    retryAfter: edit.retryAfter.trim() === '' ? null : Number(edit.retryAfter.trim()),
  };
}

/**
 * THE EXPECTATION EDITOR (`M210` `S3`) — 16 subjects, 23 matchers, the quantifier, `expect`/`check`,
 * the negation and the subset.
 *
 * `S2` lit the request; this lights what the request is read for. The vocabulary is the
 * **language's**, not the corpus's: `MATCHER_LABEL` below is a `Record<MatcherName, string>`, so a
 * matcher the language gains is a type error here rather than a row that silently stops being
 * offered — `M200` `A4`'s *ask the language, not the corpus* in the one place a form is most
 * tempted to hardcode a top ten. The old `ApiForm` row offers 10 of the 23 and 8 of the 16, which
 * is the right size for *append a new assertion* and not for *show me the one that is there*.
 */
const BAND_CLAUSES: readonly { key: string; label: string; title: string }[] = [
  { key: 'tags', label: 'tags', title: '`@name` — labels this test can be selected by' },
  { key: 'sessions', label: 'as', title: '`as “…”` — the session this test runs under' },
  { key: 'retry', label: 'retry / parallel', title: '`retry N` and `parallel` — how the runner treats this test’s cases' },
  { key: 'table', label: 'with each', title: '`with each` — run this test once per row of a table' },
  { key: 'workload', label: 'workload', title: '`ramp`/`hold`/`step`/`spike`/`run` — a shape of work over time' },
  { key: 'thresholds', label: 'thresholds', title: 'a bound the whole run is graded against, after it finishes' },
];

export const MATCHER_LABEL: Record<MatcherName, string> = {
  equals: 'equals',
  contains: 'contains',
  matches: 'matches (regex)',
  matchesSubset: 'matches subset',
  matchesSchema: 'matches schema',
  matchesFile: 'matches file',
  matchesSnapshot: 'matches snapshot',
  greaterThan: 'is greater than',
  lessThan: 'is less than',
  hasCount: 'has count',
  hasValue: 'has value',
  visible: 'is visible',
  hidden: 'is hidden',
  enabled: 'is enabled',
  disabled: 'is disabled',
  checked: 'is checked',
  connects: 'connects',
  fails: 'fails',
  wasMade: 'was made',
  hasNoA11yViolations: 'has no a11y violations',
  hasNoSecurityViolations: 'has no security violations',
  hasNoAuthzViolations: 'has no authorization violations',
  hasNoInputHandlingViolations: 'has no input-handling violations',
};
export const MATCHERS = Object.entries(MATCHER_LABEL) as readonly (readonly [MatcherName, string])[];

/** The matchers that compare against a value. `fails` is here and its operand is optional — the
 *  one matcher in the language whose value may be present or absent (`SPEC` §6.2.2). */
export const VALUE_MATCHERS: ReadonlySet<MatcherName> = new Set<MatcherName>([
  'equals', 'contains', 'matches', 'matchesSubset', 'greaterThan', 'lessThan', 'hasCount', 'hasValue', 'fails',
]);
/** The four that grade a whole subject against a rule family, and take a severity floor. */
export const SCAN_MATCHERS: ReadonlySet<MatcherName> = new Set<MatcherName>([
  'hasNoA11yViolations', 'hasNoSecurityViolations', 'hasNoAuthzViolations', 'hasNoInputHandlingViolations',
]);
/** The three whose operand is a **trailing clause** rather than a value — `S3a` in `build.ts` is
 *  where the builder learned to construct them; this is the same three, spelled as fields. */
export const CLAUSE_MATCHER: Partial<Record<MatcherName, 'schema' | 'file' | 'snapshot'>> = {
  matchesSchema: 'schema',
  matchesFile: 'file',
  matchesSnapshot: 'snapshot',
};
export const SEVERITIES: readonly FindingSeverity[] = ['minor', 'moderate', 'serious', 'critical'];

/** The subjects a spec can spell, in the words the language uses. Eleven of the language's
 *  sixteen; the other five arrive as `carried` below. */
export const SUBJECTS = [
  ['status', 'status'],
  ['duration', 'duration'],
  ['request', 'request'],
  ['header', 'header "…"'],
  ['body', 'body …'],
  ['bodyText', 'body text'],
  ['bodyBytes', 'body bytes'],
  ['value', '{value}'],
  ['response', 'response'],
  ['locator', 'an element'],
  ['page', 'page'],
  /* **Three subjects no form has ever offered** — `M219` `G` (`D1166`). The language has 16 and
     this list had 11; these are browser-only, appear 26 times across the two corpora, and were
     never dropped by a table — they were never listed. `bodyCsv` and `bodyPdfText` are the other
     two and are API's; `D1167` keeps the API door's offer as it is this round, so they are
     measured and left rather than quietly added. */
  ['networkRequest', 'request to "…"'],
  ['dialogMessage', 'dialog message'],
  ['dialogType', 'dialog type'],
] as const;

/**
 * **Which phase of a body a subject belongs to** — `M219` `G` (`D1166`).
 *
 * `D1114` made the offer a per-door list of what a door **drops**, and mirroring it here looked
 * obvious: BROWSER drops the response subjects the way API drops `an element`. **The corpus
 * refuses it.** Inside browser-bearing tests, **436 of 1125 assertions (38.8%) use an api
 * subject**, 428 of them `status` — the second-commonest assertion in a browser test, behind `an
 * element` at 645. A door that dropped `status` would be wrong 428 times.
 *
 * Split by **phase** instead and it is clean:
 *
 * | | n | api subject | browser subject |
 * |---|---|---|---|
 * | setup (above the first `open`) | 445 | **405 (91.0%)** | 39 (8.8%) |
 * | session (the `open` and below) | 661 | 31 (4.7%) | **629 (95.2%)** |
 *
 * **The phase predicts the subject; the door does not.** Neither figure is zero, which is why this
 * is an *ordering* with the rest behind `more…` rather than a drop — `D1114`'s direction
 * preserved and its mechanism generalised: nothing is dropped at all.
 */
export const SUBJECT_PHASE: Readonly<Record<string, 'api' | 'browser' | 'either'>> = {
  status: 'api', duration: 'api', request: 'api', header: 'api', body: 'api',
  bodyText: 'api', bodyBytes: 'api', response: 'api',
  locator: 'browser', page: 'browser', networkRequest: 'browser',
  dialogMessage: 'browser', dialogType: 'browser',
  value: 'either',
};
/**
 * `carried` is the subject this card shows and does not rebuild — `S2`'s `upload` one construct
 * over.
 *
 * Five of the language's sixteen subjects have no `SubjectSpec` to spell them (`body csv`, `body
 * pdf text`, `request to "…"`, and the two dialog subjects), and a `status of request to "…"`
 * carries a clause the spec has no room for either. 41 assertions across the two corpora. They are
 * **shown as themselves and left alone**: the select offers the option only when it is already what
 * the row says, exactly as the body-kind select offers `upload`, and the original node is put back
 * after the build. Switching away is a real edit and is allowed; switching *to* one is not offered,
 * because the builder could not honour it.
 */
export type ExpectSubjectKind = (typeof SUBJECTS)[number][0] | 'carried';

export interface ExpectEdit {
  /** `check` rather than `expect` — soft, records and carries on. */
  readonly soft: boolean;
  /**
   * `not`. **The field whose absence inverts an assertion**: `buildExpect` hardcoded `negated:
   * false` until `S3a`, and 92 assertions across the two corpora are negated, spread over 15
   * matchers. A card that rebuilt one without this would turn `expect status not equals 500` into
   * `expect status equals 500` — a file that parses, runs, and asserts the opposite.
   */
  readonly negated: boolean;
  readonly quantifier: '' | 'any' | 'all';
  readonly subject: ExpectSubjectKind;
  /** The header name, the body path, the variable or the element's text — one field, because only
   *  one subject at a time has an argument. */
  readonly argument: string;
  readonly locatorKind: LocatorKind;
  readonly matcher: MatcherName;
  readonly operand: string;
  /** `matches subset { … }` as rows (`S3`'s subset editor). The operand for that one matcher is
   *  built from these rather than from the text field, which is the same arrangement the request
   *  card's form body already uses: a value with a shape gets the shape's editor. */
  readonly subset: readonly { readonly name: string; readonly value: string }[];
  readonly severityFloor: '' | FindingSeverity;
  readonly schemaName: string;
  readonly schemaSource: string;
  readonly schemaService: string;
  readonly filePath: string;
  readonly snapshotName: string;
}

/** `items[0].price` — a body path as the language spells it, which since `M230` `B` (`D1262`)
 *  includes a quoted key: `headers."content-type"`, `byId."0"`. The rule is `print.ts`'s
 *  `spellProp` and `D1263`'s: quote when, and only when, the bare spelling would not parse back. */
function pathText(segments: readonly PathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (segment.kind === 'index') out += `[${segment.index}]`;
    else {
      const spelled = /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment.name) ? segment.name : `"${segment.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      out += out === '' ? spelled : `.${spelled}`;
    }
  }
  return out;
}

/**
 * **The AST subject type each of the select's options writes** — `M228` `D` (`D1243`).
 *
 * The inverse of `subjectKindOf` below, and the one table this file adds: the page needs to ask
 * the language *would `TF042` refuse this matcher on this subject* before the spec exists, and
 * that question is keyed on the node type. `'carried'` has no entry and cannot: it is not a
 * subject, it is *the one already written*, so the row asks about whatever the file holds.
 *
 * `subjectSpellings.test.ts` holds this in step with `subjectKindOf` by round-tripping every
 * option — a table written twice in one file is exactly the drift this repository files findings
 * about, so it is written once and checked rather than trusted.
 */
export const SUBJECT_NODE: Readonly<Record<string, Subject['type']>> = {
  status: 'StatusSubject',
  duration: 'DurationSubject',
  request: 'RequestSubject',
  header: 'HeaderSubject',
  body: 'BodySubject',
  bodyText: 'BodyTextSubject',
  bodyBytes: 'BodyBytesSubject',
  value: 'ValueSubject',
  response: 'ResponseSubject',
  locator: 'LocatorSubject',
  page: 'PageSubject',
  networkRequest: 'NetworkRequestSubject',
  dialogMessage: 'DialogMessageSubject',
  dialogType: 'DialogTypeSubject',
};

function subjectKindOf(subject: Subject): ExpectSubjectKind {
  switch (subject.type) {
    // The `of request to "…"` clause is a fact about the subject the spec cannot hold, so a subject
    // carrying one is carried whole rather than rebuilt without it.
    case 'StatusSubject': return subject.of === null ? 'status' : 'carried';
    case 'HeaderSubject': return subject.of === null ? 'header' : 'carried';
    case 'BodySubject': return subject.of === null ? 'body' : 'carried';
    case 'BodyTextSubject': return subject.of === null ? 'bodyText' : 'carried';
    case 'BodyBytesSubject': return 'bodyBytes';
    case 'DurationSubject': return 'duration';
    case 'RequestSubject': return 'request';
    case 'ValueSubject': return 'value';
    case 'ResponseSubject': return 'response';
    case 'PageSubject': return 'page';
    case 'LocatorSubject': return 'locator';
    /* `M219` `G`. A `with method "…"` is a clause the spec has no room for, so a subject carrying
       one is carried whole — the same rule `of request to "…"` follows three cases above. */
    case 'NetworkRequestSubject': return subject.ref.method === null ? 'networkRequest' : 'carried';
    case 'DialogMessageSubject': return 'dialogMessage';
    case 'DialogTypeSubject': return 'dialogType';
    default: return 'carried';
  }
}

function argumentOf(subject: Subject): string {
  switch (subject.type) {
    case 'HeaderSubject': return subject.name.value;
    case 'BodySubject': return pathText(subject.path);
    case 'ValueSubject': return pathText(subject.ref);
    case 'LocatorSubject': return subject.locator.value.value;
    case 'NetworkRequestSubject': return subject.ref.urlPattern.value;
    default: return '';
  }
}

/** The card's current values, read off an assertion the file already holds. */
export function expectOf(node: ExpectStmt): ExpectEdit {
  const m = node.matcher;
  const subset = m.name === 'matchesSubset' && m.value !== null && m.value.type === 'ObjectLit'
    ? m.value.fields.map((f) => ({ name: f.key, value: printValue(f.value) }))
    : [];
  return {
    soft: node.soft,
    negated: m.negated,
    quantifier: node.quantifier ?? '',
    subject: subjectKindOf(node.subject),
    argument: argumentOf(node.subject),
    locatorKind: node.subject.type === 'LocatorSubject' ? node.subject.locator.kind : 'button',
    matcher: m.name,
    // **`print` had to learn the value grammar for this line** (`S3a`): `PRINTABLE` declared
    // thirty-one value kinds and the switch reached five, so 77 operands across the two corpora —
    // every `{interpolation}`, every `env()`, every `matches subset` object — came back as
    // `# unprintable` and could not be read into a field at all, let alone typed into.
    operand: m.value === null ? '' : printValue(m.value),
    subset,
    severityFloor: m.severityFloor ?? '',
    schemaName: m.schemaName?.value ?? '',
    schemaSource: m.schemaSource?.value ?? '',
    schemaService: m.schemaService ?? '',
    filePath: m.filePath?.value ?? '',
    snapshotName: m.snapshotName?.value ?? '',
  };
}

/** A JSON object as the language writes it — the subset editor's rows, joined. A bare key when the
 *  language can read it back bare, quoted otherwise, which is `printObject`'s own rule. */
function objectText(rows: readonly { readonly name: string; readonly value: string }[]): string {
  if (rows.length === 0) return '{}';
  const parts = rows.map((r) => `${/^[A-Za-z_]\w*$/.test(r.name) ? r.name : JSON.stringify(r.name)}: ${r.value}`);
  return `{ ${parts.join(', ')} }`;
}

/**
 * The subject half of a spec, shared by the two statements that take one (`M210` `S4`).
 *
 * `original` is read for one thing only: a carried subject's **shape**. The builder validates the
 * quantifier against the subject it is given, so a stand-in for a quantified `body csv` path has to
 * be quantifiable too or the build refuses about a file that parses. `quantifiable()` is the
 * language's own predicate, asked rather than re-derived here.
 */
export function subjectSpecOf(kind: ExpectSubjectKind, argument: string, locatorKind: LocatorKind, original: Subject | null): SubjectSpec {
  switch (kind) {
    case 'header': return { kind: 'header', name: argument };
    case 'body': return { kind: 'body', path: argument };
    case 'value': return { kind: 'value', ref: argument };
    case 'locator': return { kind: 'locator', locator: { kind: locatorKind, value: argument } };
    /* `M219` `G` — the network-request subject's argument is its URL pattern, in the same one
       field every other argument-bearing subject uses. `with method "…"` is a second clause the
       spec carries and the field does not ask for: 24 of the corpus's 26 omit it, and the two
       that do not reach it through `carried` like every other clause the spec cannot spell. */
    case 'networkRequest': return { kind: 'networkRequest', urlPattern: argument, method: '' };
    case 'dialogMessage': return { kind: 'dialogMessage' };
    case 'dialogType': return { kind: 'dialogType' };
    case 'carried': return original !== null && quantifiable(original) ? { kind: 'body', path: '' } : { kind: 'status' };
    default: return { kind };
  }
}

/**
 * The spec half of an assertion — what `buildExpect` takes.
 *
 * `original` is read for one thing only: a carried subject's **shape**. The builder validates the
 * quantifier against the subject it is given, so a stand-in for a quantified `body csv` path has to
 * be quantifiable too or the build refuses about a file that parses. `quantifiable()` is the
 * language's own predicate, asked rather than re-derived here.
 */
export function expectSpecOf(edit: ExpectEdit, original: ExpectStmt | null): ExpectSpec {
  const subject = subjectSpecOf(edit.subject, edit.argument, edit.locatorKind, original?.subject ?? null);
  const clause = CLAUSE_MATCHER[edit.matcher];
  const operand = clause !== undefined || !VALUE_MATCHERS.has(edit.matcher)
    ? null
    : edit.matcher === 'matchesSubset' ? objectText(edit.subset) : edit.operand;
  return {
    soft: edit.soft,
    negated: edit.negated,
    quantifier: edit.quantifier === '' ? null : edit.quantifier,
    subject,
    matcher: edit.matcher,
    operand,
    ...(edit.severityFloor === '' || !SCAN_MATCHERS.has(edit.matcher) ? {} : { severityFloor: edit.severityFloor }),
    ...(clause === 'schema'
      ? { schema: { name: edit.schemaName, source: edit.schemaSource, ...(edit.schemaService.trim() === '' ? {} : { service: edit.schemaService.trim() }) } }
      : {}),
    ...(clause === 'file' ? { filePath: edit.filePath } : {}),
    ...(clause === 'snapshot' ? { snapshotName: edit.snapshotName } : {}),
  };
}

/**
 * WHAT THE BAND HOLDS (`M210` `S5`, `D1074`) — a declaration's own facts, as a form holds them.
 *
 * Measured over the two corpora, which is what decides which of these is a control and which is a
 * sentence: **683 of 858 tests carry tags** (at most 5), 67 name sessions, **9 carry a retry**, 2
 * are parallel, 12 carry a `with each` table (9 inline, the largest 3 rows by 3 columns) and 39
 * carry thresholds (at most 3). 50 carry a workload — and that one is a **link**, not a control:
 * see `TestBand`.
 *
 * The strings are what the file writes, not what the AST holds: tags are space-separated because
 * `printTest` writes them on one line (450 of 682 tag lines carry more than one), and sessions are
 * comma-separated because `as admin, shopper` is how the grammar spells a list.
 */
export interface HeaderEdit {
  readonly name: string;
  readonly tags: string;
  readonly sessions: string;
  readonly retry: string;
  readonly parallel: boolean;
  /** A hook's whole header is these two words — `each` has no keyword, so `before` alone is the
   *  per-test one and `before file` the once-per-file one. */
  readonly when: HookDecl['when'];
  readonly scope: HookDecl['scope'];
  readonly tableKind: 'none' | 'inline' | 'file';
  readonly tablePath: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function headerEditOf(decl: OutlineHook | OutlineTest): HeaderEdit {
  const test = decl.kind === 'test' ? decl : null;
  const table = test?.table ?? null;
  return {
    name: test?.name ?? '',
    tags: (test?.tags ?? []).join(' '),
    sessions: (test?.sessions ?? []).join(', '),
    retry: String(test?.retry ?? 0),
    parallel: test?.node.concurrency === 'parallel',
    when: decl.kind === 'hook' ? decl.when : 'before',
    scope: decl.kind === 'hook' ? decl.scope : 'each',
    tableKind: table === null ? 'none' : table.type === 'InlineDataTable' ? 'inline' : 'file',
    tablePath: table !== null && table.type === 'FileDataTable' ? table.path.value : '',
    columns: table !== null && table.type === 'InlineDataTable' ? table.columns : ['name'],
    rows: table !== null && table.type === 'InlineDataTable' ? table.rows.map((row) => row.map((cell) => printValue(cell))) : [['""']],
  };
}

/** The table half of a header edit, or `null` for a test that runs once. */
export function tableSpecOf(edit: HeaderEdit): DataTableSpec | null {
  if (edit.tableKind === 'none') return null;
  if (edit.tableKind === 'file') return { kind: 'file', path: edit.tablePath };
  return { kind: 'inline', columns: edit.columns, rows: edit.rows };
}

/** What a threshold row holds. A `duration` metric carries a percentile; an `errorRate` does not,
 *  and its bound is the percentage the author types beside the `%` rather than the fraction the
 *  AST stores — `buildThreshold` owns that conversion so no form has to know it. */
export interface ThresholdEdit {
  readonly metric: ThresholdMetric['kind'];
  readonly percentile: string;
  readonly op: ThresholdOp;
  readonly bound: string;
  readonly scope: string;
}

export function thresholdEditOf(node: ThresholdDecl): ThresholdEdit {
  return {
    metric: node.metric.kind,
    percentile: node.metric.kind === 'duration' ? String(node.metric.percentile) : '95',
    op: node.op,
    bound: node.metric.kind === 'duration' ? String(node.value) : String(Math.round(node.value * 1000) / 10),
    scope: node.scope?.value ?? '',
  };
}

export function thresholdSpecOf(edit: ThresholdEdit): ThresholdSpec {
  return {
    metric: edit.metric === 'duration' ? { kind: 'duration', percentile: Number(edit.percentile) } : { kind: 'errorRate' },
    op: edit.op,
    bound: Number(edit.bound),
    scope: edit.scope.trim() === '' ? null : edit.scope.trim(),
  };
}

/** The subject controls, shared by the two statements that take one — an assertion and a `capture`
 *  (`M210` `S4`). One control set, because the grammar has one subject position. */
export function SubjectFields({ subject, argument, locatorKind, carried, onChange, drops, phase }: {
  readonly subject: ExpectSubjectKind;
  readonly argument: string;
  readonly locatorKind: LocatorKind;
  /** The spelling of a subject the spec cannot rebuild, or `null` when this row's subject is one it
   *  can — which is what decides whether the option is offered at all. */
  readonly carried: string | null;
  readonly onChange: (patch: { subject?: ExpectSubjectKind; argument?: string; locatorKind?: LocatorKind }) => void;
  /**
   * **Subjects this door does not offer** — `M214` `A3`, from `vocabulary.ts`.
   *
   * The API door's select carried `an element` and `page` on all 1736 assertion rows in the corpus,
   * which is a door offering a word that cannot be true about anything it can fetch. Absent means
   * *drop nothing*, which is what every door but API passes and what a caller with no opinion gets.
   *
   * **A dropped subject that is already written is still drawn**, which is the same rule `carried`
   * follows one option over: a filter that hid what the file says would make a real assertion
   * invisible, and `D1076` refuses that in a way it does not refuse an extra option.
   */
  readonly drops?: ReadonlySet<string>;
  /**
   * **Which phase of the body this row sits in** — `M219` `G` (`D1166`), `undefined` for a caller
   * that has no phase to give (the API door, which `D1167` leaves on one flat set this round).
   *
   * It **orders**, it does not filter: the phase's own subjects come first and the rest sit under
   * a `more…` group in the same select, so nothing is unreachable and nothing has to be un-dropped
   * the day a file does the unusual thing. `SUBJECT_PHASE` carries the measurement.
   */
  readonly phase?: 'api' | 'browser';
}) {
  /** The offer, ordered by phase — one array, built once, so the option list and the group it is
   *  split at cannot disagree about where the line is. */
  const offered = SUBJECTS.filter(([id]) => drops === undefined || !drops.has(id) || id === subject);
  const leads = phase === undefined ? offered : offered.filter(([id]) => SUBJECT_PHASE[id] === phase || SUBJECT_PHASE[id] === 'either' || id === subject);
  const rest = phase === undefined ? [] : offered.filter((o) => !leads.includes(o));
  return (
    <>
      <select
        value={subject}
        onChange={(e) => onChange({ subject: e.target.value as ExpectSubjectKind })}
        data-expect-subject={subject}
        data-expect-phase={phase ?? 'flat'}
        data-expect-leads={leads.map(([id]) => id).join(',')}
        aria-label="subject"
      >
        {leads.map(([id, text]) => (
          <option key={id} value={id}>{text}</option>
        ))}
        {rest.length === 0 ? null : (
          <optgroup label="more…" data-expect-more-subjects={rest.length}>
            {rest.map(([id, text]) => (
              <option key={id} value={id}>{text}</option>
            ))}
          </optgroup>
        )}
        {/* Offered only while it is what this row already says — the builder cannot construct one,
            so switching *to* it would be a control that writes nothing. */}
        {subject === 'carried' ? <option value="carried">{carried ?? 'as it is'} — kept as it is</option> : null}
      </select>
      {subject === 'locator' ? (
        <select value={locatorKind} onChange={(e) => onChange({ locatorKind: e.target.value as LocatorKind })} data-expect-locator-kind aria-label="element kind">
          {LOCATOR_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      ) : null}
      {subject === 'header' || subject === 'body' || subject === 'value' || subject === 'locator' || subject === 'networkRequest' ? (
        <input
          value={argument}
          onChange={(e) => onChange({ argument: e.target.value })}
          data-expect-argument
          aria-label="subject argument"
          placeholder={subject === 'header' ? 'content-type' : subject === 'value' ? 'orderId' : subject === 'locator' ? 'Buy' : subject === 'networkRequest' ? '/v1/products' : 'items[0].price'}
        />
      ) : null}
    </>
  );
}

/**
 * WHAT A ROW HOLDS (`M210` `S4`) — one member per statement kind this pane can edit.
 *
 * The corpus is mostly made of these: **793 `capture`, 321 `let`, 184 `call`, 71 `log`, 8 `give`,
 * 4 `pause`** across the two corpora, against 1855 requests and 3192 assertions. A pane that edits
 * a request and an assertion and draws the rest as text is a pane that cannot change most of a
 * test.
 *
 * A kind not listed here is drawn as its printed line and says nothing about being editable — the
 * browser vocabulary is `D1078`'s locked row, and `wait until api`'s nested expects are `S3`'s
 * unaddressable ones.
 */
export type StatementEdit =
  | { readonly kind: 'expect'; readonly expect: ExpectEdit }
  | { readonly kind: 'capture'; readonly subject: ExpectSubjectKind; readonly argument: string; readonly locatorKind: LocatorKind; readonly name: string }
  | { readonly kind: 'let'; readonly name: string; readonly value: string }
  | { readonly kind: 'log'; readonly level: LogLevel; readonly message: string; readonly destination: '' | LogDestination }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly string[] }
  | { readonly kind: 'give'; readonly value: string }
  | { readonly kind: 'pause'; readonly min: string; readonly max: string }
  /* **The BROWSER door's whole vocabulary** — three until `M219` `C` (`D1162`), twenty-two now.
     They are here rather than in a second union because a row is a row: `ScriptRow` draws
     whichever of these a statement is, and the only per-door fact is whether this door can
     construct the kind — which `vocabulary.ts` says and this type does not.

     **The shapes are the AST's, grouped by what they hold rather than by what they mean**, which
     is what makes nineteen new kinds four new row forms. `locatorOnly` is four kinds with one
     locator and nothing else; `bare` is two with no fields at all. The rest are their own. */
  | { readonly kind: 'open'; readonly path: string }
  | { readonly kind: 'click'; readonly locatorKind: LocatorKind; readonly locator: string; readonly clickKind: ClickKind }
  | { readonly kind: 'fill'; readonly locatorKind: LocatorKind; readonly locator: string; readonly value: string }
  | { readonly kind: 'locatorOnly'; readonly of: 'HoverStmt' | 'ScrollStmt' | 'TickStmt' | 'UntickStmt'; readonly locatorKind: LocatorKind; readonly locator: string }
  | { readonly kind: 'bare'; readonly of: 'DismissDialogStmt' | 'CloseTabStmt' }
  | { readonly kind: 'acceptDialog'; readonly text: string }
  | { readonly kind: 'switchToTab'; readonly index: string }
  | { readonly kind: 'screenshot'; readonly name: string }
  | { readonly kind: 'select'; readonly locatorKind: LocatorKind; readonly locator: string; readonly value: string }
  | { readonly kind: 'press'; readonly keys: string; readonly locatorKind: LocatorKind; readonly locator: string }
  | { readonly kind: 'dropFile'; readonly filePath: string; readonly locatorKind: LocatorKind; readonly locator: string }
  | { readonly kind: 'drag'; readonly fromKind: LocatorKind; readonly from: string; readonly toKind: LocatorKind; readonly to: string }
  /* The three blocks. Their bodies are NOT here: an edit to a block's head is an edit to its
     locator or its name, and the body goes back on untouched (`build.ts`'s family note). A body
     rebuilt from a form would be a second authoring surface for every statement inside it. */
  | { readonly kind: 'within'; readonly locatorKind: LocatorKind; readonly locator: string; readonly frame: boolean }
  | { readonly kind: 'switchToNewTab' }
  | { readonly kind: 'download'; readonly name: string }
  | { readonly kind: 'fillForm'; readonly rows: readonly { readonly field: string; readonly value: string }[] }
  | { readonly kind: 'stub'; readonly method: string; readonly urlPattern: string; readonly status: string; readonly body: string }
  | { readonly kind: 'waitUntilUi'; readonly expect: ExpectEdit; readonly hold: string; readonly wait: string };

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const CLICK_KINDS: readonly ClickKind[] = ['single', 'double', 'right'];
const LOG_DESTINATIONS: readonly LogDestination[] = ['console', 'html', 'both'];

/**
 * A duration as the language writes one — **printed through the one node that spells it**.
 *
 * `PauseStmt` stores milliseconds and **not** the words the author typed, unlike `DurationLit`,
 * which keeps its `raw`. So the spelling is the printer's to choose (`1000` is `1s`, `90_000` is
 * `1m 30s`'s refusal, and so on), and the only honest way to ask is to print a pause and take off
 * its keyword — the same move `withoutKeyword` makes for a request body. The first draft built a
 * `DurationLit` with a made-up `raw` instead, and the served page answered `1000ms` where the file
 * says `1s`: a value invented here, rendered back as if it came from the file.
 */
export function durationText(ms: number): string {
  const printed = print({ type: 'PauseStmt', minMs: ms, maxMs: null, span: SYNTHETIC } as Parameters<typeof print>[0]);
  return printed.ok ? printed.text.replace(/^pause /, '') : `${ms}ms`;
}

/** What a statement's controls hold, read off the node. `null` for a kind this pane does not edit. */
export function statementEditOf(node: Step): StatementEdit | null {
  switch (node.type) {
    case 'ExpectStmt':
      return { kind: 'expect', expect: expectOf(node) };
    case 'CaptureStmt':
      return {
        kind: 'capture',
        subject: subjectKindOf(node.subject),
        argument: argumentOf(node.subject),
        locatorKind: node.subject.type === 'LocatorSubject' ? node.subject.locator.kind : 'button',
        name: node.name,
      };
    case 'LetStmt':
      return { kind: 'let', name: node.name, value: printValue(node.value) };
    case 'LogStmt':
      return { kind: 'log', level: node.level, message: node.message.value, destination: node.destination ?? '' };
    case 'CallStmt':
      return { kind: 'call', name: node.call.name, args: node.call.args.map((a) => printValue(a)) };
    case 'GiveStmt':
      return { kind: 'give', value: printValue(node.value) };
    case 'PauseStmt':
      return { kind: 'pause', min: durationText(node.minMs), max: node.maxMs === null ? '' : durationText(node.maxMs) };
    case 'OpenStmt':
      return { kind: 'open', path: node.path.value };
    case 'ClickStmt':
      return { kind: 'click', locatorKind: node.locator.kind, locator: node.locator.value.value, clickKind: node.kind };
    case 'FillStmt':
      return { kind: 'fill', locatorKind: node.locator.kind, locator: node.locator.value.value, value: printValue(node.value) };
    /* **The rest of the browser vocabulary** — `M219` `C` (`D1162`). Read off the node exactly as
       the seven above are; the only thing worth noting is that four kinds share one branch,
       because four kinds share one shape. */
    case 'HoverStmt':
    case 'ScrollStmt':
    case 'TickStmt':
    case 'UntickStmt':
      return { kind: 'locatorOnly', of: node.type, locatorKind: node.locator.kind, locator: node.locator.value.value };
    case 'DismissDialogStmt':
    case 'CloseTabStmt':
      return { kind: 'bare', of: node.type };
    case 'AcceptDialogStmt':
      /* Blank is the bare `accept dialog`, which is a spelling rather than a missing value — the
         field's placeholder says so, which is what keeps an empty box from reading as unfinished. */
      return { kind: 'acceptDialog', text: node.text === undefined ? '' : printValue(node.text) };
    case 'SwitchToTabStmt':
      return { kind: 'switchToTab', index: String(node.index) };
    case 'ScreenshotStmt':
      return { kind: 'screenshot', name: node.name.value };
    case 'SelectStmt':
      return { kind: 'select', locatorKind: node.locator.kind, locator: node.locator.value.value, value: printValue(node.value) };
    case 'PressStmt':
      return {
        kind: 'press',
        keys: node.keys.value,
        locatorKind: node.locator?.kind ?? 'field',
        locator: node.locator?.value.value ?? '',
      };
    case 'DropFileStmt':
      return { kind: 'dropFile', filePath: node.filePath.value, locatorKind: node.locator.kind, locator: node.locator.value.value };
    case 'DragStmt':
      return { kind: 'drag', fromKind: node.from.kind, from: node.from.value.value, toKind: node.to.kind, to: node.to.value.value };
    case 'WithinBlock':
      return { kind: 'within', locatorKind: node.locator.kind, locator: node.locator.value.value, frame: node.frame };
    case 'SwitchToNewTabBlock':
      return { kind: 'switchToNewTab' };
    case 'DownloadBlock':
      return { kind: 'download', name: node.name };
    case 'FillFormStmt':
      return { kind: 'fillForm', rows: node.rows.map((r) => ({ field: r.field.value, value: printValue(r.value) })) };
    case 'StubStmt':
      return {
        kind: 'stub',
        method: node.method,
        urlPattern: node.urlPattern.value,
        status: String(node.status.value),
        body: node.body === null ? '' : printValue(node.body),
      };
    case 'WaitUntilUiStmt':
      /* **It reads through `expectOf`**, the same function the assertion row reads an `expect`
         with — a `wait until` is an assertion plus two clauses, and two readers of one subject
         grammar is how the two would start spelling a locator differently. The stand-in carries
         this node's own subject and matcher, which is all `expectOf` looks at. */
      return {
        kind: 'waitUntilUi',
        expect: expectOf({ type: 'ExpectStmt', soft: false, quantifier: null, subject: node.subject, matcher: node.matcher, masks: [], span: node.span } as ExpectStmt),
        hold: node.holdMs === null ? '' : durationText(node.holdMs),
        wait: node.waitMs === null ? '' : durationText(node.waitMs),
      };
    default:
      return null;
  }
}

/** One statement, as controls — the row for everything that is not an assertion. */
/**
 * The `pick` affordance on one locator field — `M213` `S4` (`D1106`).
 *
 * **A session is one at a time, and the button says which state it is in** rather than being a
 * toggle whose meaning depends on somewhere else on the page: `pick` when nothing is running,
 * `stop` on the row that owns a running session, and disabled on every other row while one is —
 * because `pick` drives a real browser and two sessions would be two browsers reporting into one
 * list.
 *
 * What comes back is a list rather than a single answer, newest first, because one click on a
 * page can be described several ways and the author is the one who knows which. Clicking a
 * suggestion writes both halves of the locator — its kind and its value — which is the whole
 * reason this is not a text field with a hint beside it.
 */
function PickField({ statement, pick, onPicked }: {
  readonly statement: OutlineStatement;
  readonly pick: NonNullable<RowEditing['pick']>;
  readonly onPicked: (locator: LocatorSpec) => void;
}) {
  const key = rowKey(statement);
  const mine = key !== null && pick.row === key;
  const busy = pick.row !== null && !mine;
  return (
    <span className="pick-field" data-pick-row={key ?? ''}>
      <button
        type="button"
        onClick={() => (mine ? pick.onStop() : key !== null && pick.onStart(key))}
        disabled={busy || key === null}
        data-pick={key ?? ''}
        data-pick-state={mine ? 'running' : busy ? 'busy' : 'idle'}
        data-tip={
          key === null
            ? 'this row is inside a block, so it has no address a session could report back to'
            : mine
              ? 'close the browser this session opened'
              : busy
                ? 'a pick session is already running on another row — `pick` drives one real browser'
                : 'open the page and click the element this step means'
        }
      >
        {mine ? 'stop' : 'pick'}
      </button>
      {!mine ? null : pick.found.length === 0 ? (
        <span className="muted" data-picked={0}>
          click something in the browser that opened
        </span>
      ) : (
        <span className="picked" data-picked={pick.found.length}>
          {pick.found.map((l, i) => (
            <button key={`${l.kind}:${l.value}:${i}`} type="button" onClick={() => { onPicked(l); pick.onStop(); }} data-picked-option={i}>
              {l.kind} “{l.value}”
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function ScriptRow({ statement, edit, onEdit, trailing, pick, phase }: {
  readonly statement: OutlineStatement;
  /** The picker, or `null` on a door whose vocabulary has no locators in it (`D1106`). */
  readonly pick: RowEditing['pick'];
  /** Everything but an assertion, which has its own row — so the last branch here is `pause` by
   *  exhaustion rather than by a `default` that would swallow a kind added later. */
  readonly edit: Exclude<StatementEdit, { readonly kind: 'expect' }>;
  readonly onEdit: (next: StatementEdit) => void;
  /** Whatever the row carries at its right-hand end besides the line number — today the `+ note`
   *  affordance, which lives **in** the row because a control on a line of its own costs 27 px on
   *  every statement of every request, and a request can carry 20. */
  readonly trailing: ReactNode;
  /** The body phase this row sits in — `M219` `G` (`D1166`). Read by the two branches that offer a
   *  subject: `capture` and `wait until`. */
  readonly phase?: 'api' | 'browser';
}) {
  const line = (
    <>
      <span className="ln muted">line {statement.line}</span>
      {trailing}
    </>
  );
  if (edit.kind === 'capture') {
    const node = statement.node as { subject: Subject };
    return (
      <div className="row expect-fields" data-script="capture" data-expect-line={statement.line}>
        <span className="kw">capture</span>
        <SubjectFields
          subject={edit.subject}
          argument={edit.argument}
          locatorKind={edit.locatorKind}
          carried={subjectSpelling(node.subject)}
          onChange={(patch) => onEdit({ ...edit, ...patch })}
          phase={phase}
        />
        <span className="kw">as</span>
        <input value={edit.name} onChange={(e) => onEdit({ ...edit, name: e.target.value })} data-capture-name aria-label="variable" placeholder="orderId" />
        {line}
      </div>
    );
  }
  if (edit.kind === 'let') {
    return (
      <div className="row expect-fields" data-script="let" data-expect-line={statement.line}>
        <span className="kw">let</span>
        <input value={edit.name} onChange={(e) => onEdit({ ...edit, name: e.target.value })} data-let-name aria-label="variable" placeholder="email" />
        <span className="kw">=</span>
        {/* One field for the whole value grammar, which is **23 kinds** across the corpus's 321
            `let`s — more generators and transforms than literals. A structured editor for that is a
            second parser; a text field read by the language's own is not. */}
        <input value={edit.value} onChange={(e) => onEdit({ ...edit, value: e.target.value })} data-let-value aria-label="value" placeholder="unique email" />
        {line}
      </div>
    );
  }
  if (edit.kind === 'log') {
    return (
      <div className="row expect-fields" data-script="log" data-expect-line={statement.line}>
        <span className="kw">log</span>
        <select value={edit.level} onChange={(e) => onEdit({ ...edit, level: e.target.value as LogLevel })} data-log-level aria-label="level">
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <input value={edit.message} onChange={(e) => onEdit({ ...edit, message: e.target.value })} data-log-message aria-label="message" placeholder="created {orderId}" />
        <select value={edit.destination} onChange={(e) => onEdit({ ...edit, destination: e.target.value as '' | LogDestination })} data-log-destination aria-label="destination">
          <option value="">wherever the run writes</option>
          {LOG_DESTINATIONS.map((d) => (
            <option key={d} value={d}>to {d}</option>
          ))}
        </select>
        {line}
      </div>
    );
  }
  if (edit.kind === 'call') {
    return (
      <div className="row expect-fields" data-script="call" data-expect-line={statement.line}>
        <input value={edit.name} onChange={(e) => onEdit({ ...edit, name: e.target.value })} data-call-name aria-label="action" placeholder="create order" />
        <span className="kw">(</span>
        {edit.args.map((arg, i) => (
          <input
            key={i}
            value={arg}
            onChange={(e) => onEdit({ ...edit, args: edit.args.map((x, j) => (j === i ? e.target.value : x)) })}
            data-call-arg={i}
            aria-label={`argument ${i + 1}`}
          />
        ))}
        <span className="kw">)</span>
        <button onClick={() => onEdit({ ...edit, args: [...edit.args, '""'] })} data-call-arg-add data-tip="one more argument for this action">
          + argument
        </button>
        {edit.args.length > 0 ? (
          <button onClick={() => onEdit({ ...edit, args: edit.args.slice(0, -1) })} data-call-arg-remove>
            − argument
          </button>
        ) : null}
        {line}
      </div>
    );
  }
  if (edit.kind === 'give') {
    return (
      <div className="row expect-fields" data-script="give" data-expect-line={statement.line}>
        <span className="kw">give</span>
        <input value={edit.value} onChange={(e) => onEdit({ ...edit, value: e.target.value })} data-give-value aria-label="value" placeholder="{orderId}" />
        {line}
      </div>
    );
  }
  if (edit.kind === 'open') {
    return (
      <div className="row expect-fields" data-script="open" data-expect-line={statement.line}>
        <span className="kw">open</span>
        <input value={edit.path} onChange={(e) => onEdit({ ...edit, path: e.target.value })} data-open-path aria-label="path" placeholder="/checkout" />
        {line}
      </div>
    );
  }
  if (edit.kind === 'click' || edit.kind === 'fill') {
    return (
      <div className="row expect-fields" data-script={edit.kind} data-expect-line={statement.line}>
        {edit.kind === 'click' ? (
          <select value={edit.clickKind} onChange={(e) => onEdit({ ...edit, clickKind: e.target.value as ClickKind })} data-click-kind aria-label="click kind">
            {/* `single` is 770 of the corpus's 774 clicks; the other two are two each — so the
                default is the one everybody writes and the other two are reachable rather than
                promoted. */}
            {CLICK_KINDS.map((k) => (
              <option key={k} value={k}>{k === 'single' ? 'click' : `${k} click`}</option>
            ))}
          </select>
        ) : (
          <span className="kw">fill</span>
        )}
        <select value={edit.locatorKind} onChange={(e) => onEdit({ ...edit, locatorKind: e.target.value as LocatorKind })} data-locator-kind aria-label="element kind">
          {LOCATOR_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <input value={edit.locator} onChange={(e) => onEdit({ ...edit, locator: e.target.value })} data-locator-value aria-label="element" placeholder="Buy" />
        {pick === null ? null : <PickField statement={statement} pick={pick} onPicked={(l) => onEdit({ ...edit, locatorKind: l.kind, locator: l.value })} />}
        {edit.kind === 'fill' ? (
          <>
            <span className="kw">with</span>
            {/* Parsed as a **value**, not as a string: the corpus fills with a `StringLit` 422
                times, an `EnvRef` 12 and an `Interp` 3, so a field that only took a string would
                be right 96% of the time and unable to express the rest. */}
            <input value={edit.value} onChange={(e) => onEdit({ ...edit, value: e.target.value })} data-fill-value aria-label="value" placeholder='"alice@example.com"' />
          </>
        ) : null}
        {line}
      </div>
    );
  }
  if (edit.kind === 'pause') {
    return (
      <div className="row expect-fields" data-script="pause" data-expect-line={statement.line}>
        <span className="kw">pause</span>
        <input value={edit.min} onChange={(e) => onEdit({ ...edit, min: e.target.value })} data-pause-min aria-label="pause" placeholder="500ms" />
        <span className="kw">to</span>
        {/* Blank is a fixed pause, which all four in the corpus are — and saying so in the placeholder
            is what keeps an empty field from reading as an unfinished one. */}
        <input value={edit.max} onChange={(e) => onEdit({ ...edit, max: e.target.value })} data-pause-max aria-label="upper bound" placeholder="(a fixed pause)" />
        {line}
      </div>
    );
  }

  /* ── The rest of the browser vocabulary — `M219` `C` (`D1162`) ──────────────────────────────
   *
   * Nineteen kinds, four row forms, because the AST groups them: four hold a locator and nothing
   * else, two hold nothing at all, three hold one scalar, four hold a locator and one more field.
   * `LocatorPair` is the piece all of them share, and it carries `pick` — so every locator on the
   * door can be fixed by clicking the element, not only a `click`'s and a `fill`'s. */

  if (edit.kind === 'locatorOnly') {
    return (
      <div className="row expect-fields" data-script={LOCATOR_ONLY_WORD[edit.of]} data-expect-line={statement.line}>
        <span className="kw">{LOCATOR_ONLY_WORD[edit.of]}</span>
        <LocatorPair
          kind={edit.locatorKind}
          value={edit.locator}
          onKind={(k) => onEdit({ ...edit, locatorKind: k })}
          onValue={(v) => onEdit({ ...edit, locator: v })}
          statement={statement}
          pick={pick}
          onPicked={(l) => onEdit({ ...edit, locatorKind: l.kind, locator: l.value })}
        />
        {line}
      </div>
    );
  }

  if (edit.kind === 'bare') {
    /* **A statement with no fields still gets a row, and the row says so.** The alternative — draw
       nothing, or draw the code line — is what nineteen kinds did before this round, and `D1082`
       refuses a pane that is silent about which of its rows are live. What is live here is the
       `✕` and the note; what is absent is absent because the language has nothing to ask. */
    return (
      <div className="row expect-fields" data-script={edit.of === 'CloseTabStmt' ? 'close-tab' : 'dismiss-dialog'} data-expect-line={statement.line}>
        <span className="kw">{edit.of === 'CloseTabStmt' ? 'close tab' : 'dismiss dialog'}</span>
        <span className="muted" data-script-nofields>
          {edit.of === 'CloseTabStmt'
            ? 'closes the tab in front and returns to the one before it — it takes no arguments'
            : 'answers the native dialog with cancel — it takes no arguments'}
        </span>
        {line}
      </div>
    );
  }

  if (edit.kind === 'acceptDialog') {
    return (
      <div className="row expect-fields" data-script="accept-dialog" data-expect-line={statement.line}>
        <span className="kw">accept dialog</span>
        <span className="kw">with</span>
        <input value={edit.text} onChange={(e) => onEdit({ ...edit, text: e.target.value })} data-dialog-text aria-label="answer" placeholder="(accept with nothing)" />
        {line}
      </div>
    );
  }

  if (edit.kind === 'switchToTab') {
    return (
      <div className="row expect-fields" data-script="switch-to-tab" data-expect-line={statement.line}>
        <span className="kw">switch to tab</span>
        <input value={edit.index} onChange={(e) => onEdit({ ...edit, index: e.target.value })} data-tab-index aria-label="tab" placeholder="0" inputMode="numeric" />
        <span className="muted">counting from 0</span>
        {line}
      </div>
    );
  }

  if (edit.kind === 'screenshot') {
    return (
      <div className="row expect-fields" data-script="screenshot" data-expect-line={statement.line}>
        <span className="kw">screenshot</span>
        <input value={edit.name} onChange={(e) => onEdit({ ...edit, name: e.target.value })} data-screenshot-name aria-label="name" placeholder="checkout-empty" />
        {/* `FS-01`: screenshots exist only at `evidence full`, so a reader who has never seen one
            is usually looking at a run that did not keep any. Saying so on the row is cheaper than
            a support question. */}
        <span className="muted">kept when the run has `evidence full`</span>
        {line}
      </div>
    );
  }

  if (edit.kind === 'select') {
    return (
      <div className="row expect-fields" data-script="select" data-expect-line={statement.line}>
        <span className="kw">select</span>
        <LocatorPair
          kind={edit.locatorKind}
          value={edit.locator}
          onKind={(k) => onEdit({ ...edit, locatorKind: k })}
          onValue={(v) => onEdit({ ...edit, locator: v })}
          statement={statement}
          pick={pick}
          onPicked={(l) => onEdit({ ...edit, locatorKind: l.kind, locator: l.value })}
        />
        <span className="kw">with</span>
        <input value={edit.value} onChange={(e) => onEdit({ ...edit, value: e.target.value })} data-select-value aria-label="option" placeholder='"Large"' />
        {line}
      </div>
    );
  }

  if (edit.kind === 'press') {
    return (
      <div className="row expect-fields" data-script="press" data-expect-line={statement.line}>
        <span className="kw">press</span>
        <input value={edit.keys} onChange={(e) => onEdit({ ...edit, keys: e.target.value })} data-press-keys aria-label="key" placeholder="Enter" />
        {/* **A blank control means the page**, and it is the weaker of the two spellings: a press
            at page level goes to whatever has focus, which is a fact about the moment rather than
            about the test. The placeholder says which one you are getting. */}
        <span className="kw">in</span>
        <LocatorPair
          kind={edit.locatorKind}
          value={edit.locator}
          onKind={(k) => onEdit({ ...edit, locatorKind: k })}
          onValue={(v) => onEdit({ ...edit, locator: v })}
          statement={statement}
          pick={pick}
          onPicked={(l) => onEdit({ ...edit, locatorKind: l.kind, locator: l.value })}
          placeholder="(whatever has focus)"
        />
        {line}
      </div>
    );
  }

  if (edit.kind === 'dropFile') {
    return (
      <div className="row expect-fields" data-script="drop-file" data-expect-line={statement.line}>
        <span className="kw">drop file</span>
        <input value={edit.filePath} onChange={(e) => onEdit({ ...edit, filePath: e.target.value })} data-drop-path aria-label="file" placeholder="fixtures/avatar.png" />
        <span className="kw">on</span>
        <LocatorPair
          kind={edit.locatorKind}
          value={edit.locator}
          onKind={(k) => onEdit({ ...edit, locatorKind: k })}
          onValue={(v) => onEdit({ ...edit, locator: v })}
          statement={statement}
          pick={pick}
          onPicked={(l) => onEdit({ ...edit, locatorKind: l.kind, locator: l.value })}
        />
        {line}
      </div>
    );
  }

  if (edit.kind === 'drag') {
    return (
      <div className="row expect-fields" data-script="drag" data-expect-line={statement.line}>
        <span className="kw">drag</span>
        <LocatorPair
          kind={edit.fromKind}
          value={edit.from}
          onKind={(k) => onEdit({ ...edit, fromKind: k })}
          onValue={(v) => onEdit({ ...edit, from: v })}
          statement={statement}
          pick={null}
          onPicked={() => undefined}
          slot="from"
        />
        <span className="kw">to</span>
        <LocatorPair
          kind={edit.toKind}
          value={edit.to}
          onKind={(k) => onEdit({ ...edit, toKind: k })}
          onValue={(v) => onEdit({ ...edit, to: v })}
          statement={statement}
          pick={null}
          onPicked={() => undefined}
          slot="to"
        />
        {line}
      </div>
    );
  }

  if (edit.kind === 'within') {
    return (
      <div className="row expect-fields" data-script="within" data-expect-line={statement.line}>
        <span className="kw">within</span>
        {/* `within frame` steps INTO the frame rather than scoping to a subtree of the same
            document — 4 of the corpus's 404 blocks, and a different operation, so it is a checkbox
            rather than a seventh locator kind. */}
        <label className="field inline">
          <input type="checkbox" checked={edit.frame} onChange={(e) => onEdit({ ...edit, frame: e.target.checked })} data-within-frame />
          frame
        </label>
        <LocatorPair
          kind={edit.locatorKind}
          value={edit.locator}
          onKind={(k) => onEdit({ ...edit, locatorKind: k })}
          onValue={(v) => onEdit({ ...edit, locator: v })}
          statement={statement}
          pick={pick}
          onPicked={(l) => onEdit({ ...edit, locatorKind: l.kind, locator: l.value })}
        />
        {line}
      </div>
    );
  }

  if (edit.kind === 'switchToNewTab') {
    return (
      <div className="row expect-fields" data-script="switch-to-new-tab" data-expect-line={statement.line}>
        <span className="kw">switch to new tab</span>
        <span className="muted" data-script-nofields>
          the steps inside it run against the tab the gesture above opened
        </span>
        {line}
      </div>
    );
  }

  if (edit.kind === 'download') {
    return (
      <div className="row expect-fields" data-script="download" data-expect-line={statement.line}>
        <span className="kw">download as</span>
        <input value={edit.name} onChange={(e) => onEdit({ ...edit, name: e.target.value })} data-download-name aria-label="name" placeholder="receipt" />
        <span className="muted">the steps inside it are what starts the download</span>
        {line}
      </div>
    );
  }

  if (edit.kind === 'fillForm') {
    const rows = edit.rows;
    return (
      <div className="row expect-fields column" data-script="fill-form" data-expect-line={statement.line}>
        <div className="row">
          <span className="kw">fill form</span>
          {line}
        </div>
        {rows.map((r, i) => (
          <div className="row" key={i} data-form-row={i}>
            <input
              value={r.field}
              onChange={(e) => onEdit({ ...edit, rows: rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}
              data-form-field={i}
              aria-label={`field ${i + 1}`}
              placeholder="Email"
            />
            <span className="kw">with</span>
            <input
              value={r.value}
              onChange={(e) => onEdit({ ...edit, rows: rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
              data-form-value={i}
              aria-label={`value ${i + 1}`}
              placeholder='"alice@example.com"'
            />
            <button onClick={() => onEdit({ ...edit, rows: rows.filter((_, j) => j !== i) })} data-form-remove={i} data-tip="take this field out of the form">
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <button onClick={() => onEdit({ ...edit, rows: [...rows, { field: '', value: '""' }] })} data-form-add data-tip="one more field to fill">
            + field
          </button>
        </div>
      </div>
    );
  }

  if (edit.kind === 'stub') {
    return (
      <div className="row expect-fields column" data-script="stub" data-expect-line={statement.line}>
        <div className="row">
          <span className="kw">stub</span>
          <select value={edit.method} onChange={(e) => onEdit({ ...edit, method: e.target.value })} data-stub-method aria-label="method">
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input value={edit.urlPattern} onChange={(e) => onEdit({ ...edit, urlPattern: e.target.value })} data-stub-url aria-label="url pattern" placeholder="**/api/orders" />
          <span className="kw">with</span>
          <input value={edit.status} onChange={(e) => onEdit({ ...edit, status: e.target.value })} data-stub-status aria-label="status" placeholder="200" inputMode="numeric" />
          {line}
        </div>
        <div className="row">
          <span className="kw">body</span>
          {/* The same field the request editor's body is, and for the same reason: a JSON document
              is the one value a person pastes, and a pasted document is pretty-printed. Blank is
              `stub` with no body, which is a spelling rather than a missing value. */}
          <textarea
            className="mono"
            rows={3}
            value={edit.body}
            onChange={(e) => onEdit({ ...edit, body: e.target.value })}
            data-stub-body
            aria-label="stubbed body"
            placeholder="(no body)"
          />
        </div>
      </div>
    );
  }

  /* `wait until <pollable subject> …` — the assertion row's own fields, plus the two clauses an
     `expect` has no room for. Drawn here rather than through `ExpectRow` because the two timings
     belong to the statement and not to the assertion inside it. */
  return (
    <div className="row expect-fields column" data-script="wait-until-ui" data-expect-line={statement.line}>
      <div className="row">
        <span className="kw">wait until</span>
        <SubjectFields
          subject={edit.expect.subject}
          argument={edit.expect.argument}
          locatorKind={edit.expect.locatorKind}
          carried={subjectSpelling((statement.node as WaitUntilUiStmt).subject)}
          onChange={(patch) => onEdit({ ...edit, expect: { ...edit.expect, ...patch } })}
          phase={phase}
        />
        {line}
      </div>
      <div className="row">
        {/* The same rule as the assertion row's own select — `M228` `D` (`D1243`). A
            `wait until` reads a subject exactly as an `expect` does, so a matcher `TF042` refuses
            there is refused here, and a select that offered all 23 on one of the two would be the
            two-implementations shape this file already warns about. */}
        <select
          value={edit.expect.matcher}
          onChange={(e) => onEdit({ ...edit, expect: { ...edit.expect, matcher: e.target.value as MatcherName } })}
          data-expect-matcher
          aria-label="matcher"
        >
          {MATCHERS.map(([name, label]) => {
            const node = SUBJECT_NODE[edit.expect.subject];
            const refusal = node === undefined ? null : matcherSubjectRefusal(name, node);
            return (
              <option key={name} value={name} disabled={refusal !== null} title={refusal ?? undefined} data-matcher-refused={refusal === null ? undefined : 'yes'}>
                {label}
              </option>
            );
          })}
        </select>
        {VALUE_MATCHERS.has(edit.expect.matcher) ? (
          <input
            value={edit.expect.operand}
            onChange={(e) => onEdit({ ...edit, expect: { ...edit.expect, operand: e.target.value } })}
            data-expect-operand
            aria-label="operand"
          />
        ) : null}
        <span className="kw">for</span>
        {/* **`for` is what makes a sustained condition writable at all** (`FS-05`). Blank is the
            original semantics — pass on the first poll it is true — which for a toast that has not
            rendered yet is immediately, and keeps passing once it starts appearing. */}
        <input value={edit.hold} onChange={(e) => onEdit({ ...edit, hold: e.target.value })} data-wait-hold aria-label="hold" placeholder="(the first poll it is true)" />
        <span className="kw">timeout wait</span>
        <input value={edit.wait} onChange={(e) => onEdit({ ...edit, wait: e.target.value })} data-wait-timeout aria-label="timeout" placeholder="(the env’s)" />
      </div>
    </div>
  );
}

/** The word each of the four locator-only kinds is written with. One table, because `ScriptRow`
 *  and the builder branch both need it and two spellings of `scroll to` is one too many. */
const LOCATOR_ONLY_WORD: Record<'HoverStmt' | 'ScrollStmt' | 'TickStmt' | 'UntickStmt', string> = {
  HoverStmt: 'hover',
  ScrollStmt: 'scroll to',
  TickStmt: 'tick',
  UntickStmt: 'untick',
};

/**
 * **A locator, as two controls and a `pick`** — `M219` `C`.
 *
 * Every locator-bearing row draws this, which before this round was two rows copying eight lines
 * from each other. The copy mattered: `pick` (`D1106`) reached a `click`'s locator and a `fill`'s
 * and nothing else, so the one affordance that answers *what do I write here* was absent from the
 * fourteen other places a locator is written.
 */
function LocatorPair({ kind, value, onKind, onValue, statement, pick, onPicked, placeholder, slot }: {
  readonly kind: LocatorKind;
  readonly value: string;
  readonly onKind: (kind: LocatorKind) => void;
  readonly onValue: (value: string) => void;
  readonly statement: OutlineStatement;
  readonly pick: RowEditing['pick'];
  readonly onPicked: (locator: LocatorSpec) => void;
  readonly placeholder?: string;
  /** Names which of two locators this is, on the one row that has two (`drag`). */
  readonly slot?: string;
}) {
  return (
    <>
      <select value={kind} onChange={(e) => onKind(e.target.value as LocatorKind)} data-locator-kind={slot ?? ''} aria-label={slot === undefined ? 'element kind' : `${slot} element kind`}>
        {LOCATOR_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <input
        value={value}
        onChange={(e) => onValue(e.target.value)}
        data-locator-value={slot ?? ''}
        aria-label={slot === undefined ? 'element' : `${slot} element`}
        placeholder={placeholder ?? 'Buy'}
      />
      {pick === null ? null : <PickField statement={statement} pick={pick} onPicked={onPicked} />}
    </>
  );
}

/** A subject in its own spelling, for the one option the select cannot rebuild. */
export function subjectSpelling(subject: Subject): string {
  const out = print(subject);
  return out.ok ? out.text : subject.type;
}

/**
 * The request card — what `D1073` puts on screen.
 *
 * The whole api vocabulary is drawn, and the fields that are at their default are drawn too rather
 * than hidden: `followRedirects` is `true` on all 1167 requests in the sibling, so a card that drew
 * only non-defaults would never show it at all, and a deliberate `without redirects` would then be
 * invisible *because* it is rare. §4 item 4 leaves whether that stays to `S2`; drawing them is the
 * answer that cannot hide anything, which is the right side to be on while the pane is read-only.
 */
/**
 * What came back, as one chip in the request's own header — `M213` `S2` (`D1099`, `D1109`).
 *
 * **THIS IS A HEIGHT DECISION TAKEN RATHER THAN DISCOVERED, AND IT WAS TAKEN TWICE.** Until this
 * slice a response was on screen only after a send, for one request. `D1099` makes it the default
 * for *every* request in a file that has run, which is the right behaviour and — drawn as the open
 * block `M210` `S6` used — put the API pane past `S1`'s 1.50-screen bar on the first render,
 * before anyone pressed anything.
 *
 * The first repair was a closed `<details>` under the request's fields. **Measured on the box, it
 * cost 54 px on `Ribbon`** — 42 for a bordered box holding one line of text, plus its margin — and
 * landed at 1368 px against a 1350 bar. That is the whole lesson: *a closed disclosure still
 * occupies a block, and a block for one line of metadata is the defect, not the bar.* So the
 * trigger moved into `.request-head`, which is a row that already exists and has horizontal room,
 * and **the response costs nothing at all until it is opened**.
 *
 * It is a button and a panel rather than `<details>`/`<summary>` for exactly that reason: a
 * `<summary>` has to live inside its own `<details>`, so the disclosure could not be in the header
 * while the body is below the fields. `aria-expanded` and `aria-controls` are what make the pair
 * the same thing to a reader who is not looking at it.
 *
 * **THE CHIP SAYS WHICH SCOPE IT IS.** *from the last run* and *from this send* are different
 * evidence, and `D956` is the rule that they are told apart rather than both rendered as
 * "the response".
 */
/** The id the chip in the header and the panel below the fields are joined by. One function, so
 *  the two cannot drift apart into a control that points at nothing. */
export const responsePanelId = (line: number): string => `response-${line}`;

export function ResponsePanel({ ran, open, onVerify, onCapture }: {
  readonly ran: Ran;
  readonly open: boolean;
  /** `null` where the pane is read-only — the ticks still show what the response holds, and the
   *  button says the file is not editable rather than disappearing. */
  readonly onVerify: ((spec: ExpectSpec) => void) | null;
  /** **The same ticks, a second verb** (`M213` `S3`, `D1102`). *Sign in → capture the token →
   *  authed call → assert* is the sentence `D1102` exists for, and the first arrow is this one:
   *  the token is a value in a response that is already on screen with a checkbox beside it. */
  readonly onCapture: ((specs: readonly CaptureSpec[]) => void) | null;
}) {
  const response = ran.response!;
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const tickable = useMemo(() => leaves(response.bodyText), [response.bodyText]);
  const chosen = useMemo(() => tickable.leaves.filter((l) => ticked.includes(l.path)), [tickable, ticked]);
  const built = useMemo(() => verifySpec(chosen), [chosen]);
  /* Once per body, not twice per render: the layout is a lex and a parse over the whole thing. */
  const laid = useMemo(() => laidOut(response.bodyText), [response.bodyText]);

  /* The ticks are about **this** response. A new one — a send, or a different request — is a
     different set of paths, so carrying a tick across would mean a checkbox ticked against a path
     that may not be in the body under it. */
  useEffect(() => setTicked([]), [response.bodyText]);

  const toggle = (path: string): void =>
    setTicked((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));

  return (
    <div className="response" id={responsePanelId(ran.line)} hidden={!open} data-compose-response-panel={response.status}>
      <p className="muted" data-compose-response-url>{response.method} {response.url}</p>

      {/* **Tick what matters; the ticks become one assertion** (`D1100`). One tick is a path
          assertion, several are one `matches subset` — and a subset ignores what you did not tick,
          which is why a test written this way does not break when the API gains a field. */}
      {tickable.leaves.length === 0 ? (
        <p className="muted" data-compose-tick-none>
          this response is not JSON — there are no paths to tick. Assert on <code>body text</code> or{' '}
          <code>status</code> instead.
        </p>
      ) : (
        <>
          <ul className="ticks" data-compose-ticks={tickable.leaves.length}>
            {tickable.leaves.map((leaf) => (
              <li key={leaf.path} className="tick">
                <label>
                  <input
                    type="checkbox"
                    checked={ticked.includes(leaf.path)}
                    onChange={() => toggle(leaf.path)}
                    data-tick={leaf.path}
                    data-tick-subsetable={leaf.subsetable ? 'yes' : 'no'}
                  />{' '}
                  <code className="tick-path">{leaf.path === '' ? 'body' : leaf.path}</code>{' '}
                  <code className="tick-value">{leaf.valueText}</code>
                </label>
              </li>
            ))}
          </ul>
          {tickable.capped || tickable.skipped > 0 ? (
            <p className="muted" data-compose-ticks-elided>
              {tickable.capped ? `only the first ${LEAF_CAP} values are listed — the body below is whole. ` : ''}
              {/* `M230` `B` closed `M213-18`, so a hyphenated or numeric key is now offered as
                  `body."content-type"` rather than counted here. The line stays because a
                  response body is arbitrary bytes from a service under test and `leaves` still
                  checks every path it is about to offer reads back — a count that is expected to
                  be zero is not the same as a count that cannot happen. */}
              {tickable.skipped > 0
                ? `${tickable.skipped} value${tickable.skipped === 1 ? '' : 's'} sit under a key \`body.<path>\` cannot spell — the body below shows them.`
                : ''}
            </p>
          ) : null}
          <div className="tick-do">
            <button
              onClick={() => { if (built?.ok && onVerify !== null) { onVerify(built.spec); setTicked([]); } }}
              disabled={onVerify === null || built === null || !built.ok}
              data-compose-verify
              data-tip={
                onVerify === null
                  ? 'this pane is read-only here'
                  : built === null
                    ? 'tick a value first'
                    : built.ok
                      ? 'write this assertion under the request'
                      : built.reason
              }
            >
              verify {chosen.length === 0 ? '' : `${chosen.length} value${chosen.length === 1 ? '' : 's'}`}
            </button>
            {/* **The same ticks, bound instead of asserted** (`S3`, `D1102`). One statement per
                tick rather than one combined — a `capture` binds one name to one value and the
                language has no n-ary form — inserted as one edit, because a file between two
                writes whose second capture is missing is a file that does not run. */}
            <button
              onClick={() => { if (onCapture !== null && chosen.length > 0) { onCapture(captureSpecs(chosen)); setTicked([]); } }}
              disabled={onCapture === null || chosen.length === 0}
              data-compose-capture
              data-tip={
                onCapture === null
                  ? 'this pane is read-only here'
                  : chosen.length === 0
                    ? 'tick a value first'
                    : `bind ${chosen.map((l) => captureName(l.path)).join(', ')} for the requests below this one`
              }
            >
              capture {chosen.length === 0 ? '' : chosen.map((l) => captureName(l.path)).join(', ')}
            </button>
            {/* **What it will write, before it writes it.** The gesture composes a statement in a
                language the author is reading on the same screen; showing the sentence is cheaper
                than a preview mode and is the only thing that makes the one-versus-several rule
                visible at all. */}
            {built === null ? null : built.ok ? (
              <code className="tick-preview" data-compose-verify-preview>{previewOf(built.spec)}</code>
            ) : (
              <span className="warn" data-compose-verify-refused>{built.reason}</span>
            )}
          </div>
        </>
      )}

      {/* **Laid out for reading, and painted by the same rules as the request body above it**
          (`M215` `B2`, `D1121`). A real service answers on one line; this pane's whole argument is
          that the response belongs beside the assertions that read it, and a 4 KB minified line is
          not beside anything. The layout is a whitespace pass over the language's own tokens rather
          than a `JSON.parse` round trip, so **no literal is re-read** — an id above 2^53 is shown as
          the service sent it, which the obvious implementation would have silently changed. A body
          that is not an object or a list is shown exactly as it arrived. */}
      <pre className="preview" data-compose-response-body data-compose-response-laid={laid === null ? 'no' : 'yes'}>
        <BodyText text={laid ?? response.bodyText} problem={null} />
      </pre>
    </div>
  );
}

/**
 * How a status code is painted — `M213` `S2`.
 *
 * `pass` for 2xx and 3xx, `warn` for everything else, and **never `fail`**. A 404 is not a failed
 * test: `expect status equals 404` is a perfectly ordinary assertion and 118 of the sibling's
 * expects are exactly that shape. What says whether the test held is the verdict beside the
 * assertion; what this says is *what came back*, and painting it red would be this pane inventing
 * a judgement the run did not make. `§1.5` of the plan measured these three tokens declared and
 * spent nowhere; this is one of the two places `S2` spends them.
 */
export function statusTone(status: number): 'pass' | 'warn' {
  return status >= 200 && status < 400 ? 'pass' : 'warn';
}

/** The sentence `verify` will write, printed by the language's own printer (`D1087`) — not a
 *  second spelling of `expect` living in this file. A spec the builder refuses has no sentence,
 *  which is a state the button is already disabled in. */
function previewOf(spec: ExpectSpec): string {
  const out = buildExpect(spec);
  if (!out.ok) return out.reason;
  const printed = print(out.node, { indent: 0 });
  return printed.ok ? printed.text.trim() : '';
}

/** `print` emits an `InlineBody` as `body <json>`; the field holds the json. One `slice`, named,
 *  rather than a second serialiser for the one shape the printer will not emit on its own. */
export function withoutKeyword(printed: string): string {
  return printed.startsWith('body ') ? printed.slice('body '.length) : printed;
}

/** The body kind the card is showing — the edit's when there is one, the file's otherwise. */
export function bodyKindOf(r: OutlineRequest, edit: RequestEdit | null): string {
  if (edit !== null) return edit.bodyKind;
  return r.body === null ? 'none' : r.body.type;
}

/** Any value, in the language's own spelling. Total since `M201`; a refusal is named rather than
 *  rendered as a blank, because a blank in a projection is the silence `D1076` refuses. */
export function printValue(node: { readonly type: string; readonly span: unknown }): string {
  const out = print(node as Parameters<typeof print>[0]);
  return out.ok ? out.text : `# unprintable: ${out.reason ?? node.type}`;
}

/**
 * The body, as the file writes it.
 *
 * **The body node, not what is inside it.** The first draft printed `InlineBody.value` — an
 * `ObjectLit` — and the served page answered `# unprintable: no printer for ObjectLit` in a `<pre>`
 * where the JSON should have been. The printer is total over the language's *nodes*, and an
 * `ObjectLit` is `CONTEXT_BOUND`: it has no source of its own to be re-parsed from, so refusing it
 * is the printer being right. Nothing in the model could have said so — only the paint could.
 */
export function bodyText(body: ApiBody): string {
  const out = print(body);
  return out.ok ? out.text : `# unprintable: ${out.reason ?? body.type}`;
}

/**
 * The band above the request (`D1074`) — the test's own facts, and the file's.
 *
 * `retry 0` and a null workload are **defaults and are said as defaults**: `M210`'s own scoping
 * measured 420 tests reporting `retry` and `concurrency` "in use" and then retracted it, because
 * what was being counted was the default value. A band that renders a default as a fact makes the
 * same mistake on screen, every time.
 */
/**
 * **A `crawl`, drawn and not built** — `M228` `C` (`D1238`).
 *
 * Read-only **and saying why**, which is `DoorVocabulary.constructs`' own written rule rather than
 * a compromise: *a kind this door owns and cannot construct is drawn, disabled, saying why; a pane
 * that is half live and silent about which half is what `D1082` refuses.* The cost of the
 * alternative is written down in `outline.ts` beside `OutlineCrawl` — a builder, an `Insertion`
 * member, `Edit` members for the header and each seed, and every consumer of `declarations` — for
 * **14 real crawls in the whole corpus**.
 *
 * What it draws is what the declaration says and nothing derived: the name, the principals, the
 * seeds in the words the language spells them with, and the excludes. A crawl's seeds are the
 * whole of *where its requests come from*, and they were invisible in the product until this
 * round.
 */
function CrawlBand({ decl }: { readonly decl: OutlineCrawl }) {
  return (
    <div className="test-band crawl-band" data-band-kind="crawl" data-band-line={decl.line} data-crawl-readonly>
      {decl.note === null ? null : <NoteBlock note={decl.note} what={`crawl ${decl.name}`} />}
      <header className="band-head">
        <span className="t-kw">crawl</span>
        <span className="t-name" data-crawl-name>{decl.name}</span>
        {decl.sessions.length === 0 ? null : (
          <span className="muted" data-crawl-sessions={decl.sessions.length}>
            as <code>{decl.sessions.join(', ')}</code>
          </span>
        )}
      </header>
      <ul className="crawl-clauses">
        {decl.seeds.map((seed, i) => (
          <li key={i} data-crawl-seed={seed.type}>
            <code>{SEED_WORD[seed.type] ?? 'seed'}</code>
          </li>
        ))}
        {decl.excludes.map((x, i) => (
          <li key={`x${i}`} data-crawl-exclude={x.value}>
            <code>exclude &ldquo;{x.value}&rdquo;</code>
          </li>
        ))}
      </ul>
      {/* **The reason, which is the half `D1082` is about.** A disabled row with no explanation is
          the pane it refuses; a reader who cannot edit this needs to know it is a decision and
          where the edit lives instead. */}
      <p className="muted" data-crawl-why>
        A <code>crawl</code> is drawn here and edited in the file. Its requests are ones nobody wrote, so it is built from{' '}
        <code>seed</code> lines rather than from steps, and this pane has no builder for one — <code>tflw fmt</code> and your editor
        are where a crawl is changed.
      </p>
    </div>
  );
}

/** The word each seed kind is written with, so the band spells them the way the file does rather
 *  than printing a node type at the reader. */
const SEED_WORD: Partial<Record<string, string>> = {
  OpenApiSeed: 'seed openapi',
  TrafficSeed: 'seed traffic',
  SpiderSeed: 'seed spider',
};

export function TestBand({ decl, door, editing, lastRun }: {
  readonly decl: OutlineHook | OutlineTest | OutlineCrawl;
  readonly door: Lens;
  readonly editing: RowEditing;
  /** `D1221`'s citation, looked up by the door. `undefined` while nobody has answered yet, `null`
   *  when the answer is *never run here*. */
  readonly lastRun?: { readonly iterations: number; readonly p95Ms: number; readonly inconclusive: boolean } | null;
}) {
  /* **A crawl takes its own band and returns before any of this** — `M228` `C` (`D1238`).
     Everything below writes: `headerEditOf` builds an edit, `editing.onHeader` sends it to
     `replaceInSource` by `decl.index`, and a crawl's index is `-1`. So it is not a matter of
     disabling controls one at a time — the band's whole mechanism is addressed by a number this
     declaration deliberately does not have. */
  if (decl.kind === 'crawl') return <CrawlBand decl={decl} />;
  const test: OutlineTest | null = decl.kind === 'test' ? decl : null;
  const key = `decl:${decl.index}`;
  const live = editing.onHeader !== null;
  const v = editing.header !== null && editing.header.key === key ? editing.header.values : headerEditOf(decl);
  const change = (patch: Partial<HeaderEdit>): void => {
    // **`D1132` has to be enforced here and not in `TableEditor`.** The editor is a child and
    // `added` belongs to the band, so an editor that empties its own last row can unwrite the
    // clause from the FILE and still leave the menu saying *— already here*, because the menu's
    // other half is a local state the child cannot see. Every band edit passes through this
    // function, which makes it the one place the two halves can be kept in step.
    if (patch.tableKind === 'none') setAdded((prev) => prev.filter((x) => x !== 'table'));
    editing.onHeader?.(decl, { ...v, ...patch });
  };
  const writingNote = editing.noting === key;
  const what = decl.kind === 'test' ? `test ${decl.name}` : decl.label;

  /**
   * **What this declaration actually says** (`M212` `S3`, `D1084`).
   *
   * A clause is drawn when the file states it, and otherwise it is in the menu. `retry` and
   * `parallel` share one row because they share one line in the file, and `retry 0` is not a retry
   * in use — `M141` retracted a census that counted 420 tests as using `retry` and `concurrency`
   * because it was counting the default value, and a band that renders a default as a fact makes
   * the same mistake on screen, every time.
   */
  const [added, setAdded] = useState<readonly string[]>([]);
  /** The reason a threshold removal was refused, drawn on the row that refused it (`D1117`'s
   *  shape: pressed, answered, and the answer is a sentence rather than a disabled control). */
  const [thresholdRefusal, setThresholdRefusal] = useState<string | null>(null);
  const states = (clause: string): boolean => {
    if (test === null) return false;
    switch (clause) {
      case 'tags': return test.tags.length > 0;
      case 'sessions': return test.sessions.length > 0;
      case 'retry': return test.retry !== 0 || v.parallel;
      case 'table': return test.table !== null;
      case 'workload': return test.workload !== null;
      case 'thresholds': return test.thresholds.length > 0;
      default: return false;
    }
  };
  const shows = (clause: string): boolean => states(clause) || added.includes(clause);
  /** `D1205`'s one condition, read once: this pane can write, and `TF033` allows a workload here. */
  const workloadLive = live && editing.onWorkload !== null && test !== null && door !== 'browser';
  const workloadValues = editing.workload !== null && editing.workload.key === key
    ? editing.workload.values
    : workloadEditOf(test?.workload ?? null);
  return (
    <div className="test-band" data-band-kind={decl.kind} data-band-line={decl.line} data-band-drawn={BAND_CLAUSES.filter((c) => shows(c.key)).length}>
      {writingNote ? (
        <NoteOpen note={decl.note} what={what} onChange={(lines) => editing.onNote?.({ on: 'declaration', decl: decl.index }, lines)} />
      ) : decl.note ? (
        <NoteBlock note={decl.note} what={what} onNote={editing.onNote === null ? undefined : (lines) => editing.onNote!({ on: 'declaration', decl: decl.index }, lines)} />
      ) : null}
      <header className="band-head">
        {decl.kind === 'hook' ? (
          live ? (
            <>
              <select value={v.when} onChange={(e) => change({ when: e.target.value as HookDecl['when'] })} data-band-when aria-label="before or after">
                <option value="before">before</option>
                <option value="after">after</option>
              </select>
              {/* `each` has no keyword — it is the scope you get by writing nothing — so this is a
                  choice between two words and not between a word and its absence. */}
              <select value={v.scope} onChange={(e) => change({ scope: e.target.value as HookDecl['scope'] })} data-band-scope aria-label="scope">
                <option value="each">every test</option>
                <option value="file">once for the file</option>
              </select>
            </>
          ) : (
            <span className="band-what">{decl.label}</span>
          )
        ) : (
          <>
            <span className="band-what">test</span>
            {/* `M229` `F` (`D1256`), `R1`. The name is what a run reports this test under and what
                `--only` selects it by, and it is one of exactly two controls in region 1 that had no
                tip — both of them the fields you type prose into. **The truncation tooltip `R2`
                asked for is deliberately NOT here** (`D1260`, withdrawn): `D1127` reasoned about
                rows, which a reader can only look at, and an input is text a reader is about to
                edit — a tooltip over it competes with the caret. If the name proves unreadable in
                use the repair is to widen the band. */}
            {live ? (
              <input
                className="band-name"
                value={v.name}
                onChange={(e) => change({ name: e.target.value })}
                data-band-name={v.name}
                aria-label="test name"
                data-tip="what a run reports this test under, and what `--only` selects it by — so it is the one thing in the file another person reads out loud"
              />
            ) : (
              <strong data-band-name={test!.name}>{test!.name}</strong>
            )}
          </>
        )}
        <span className="ln muted">line {decl.line}</span>
        {editing.onNote !== null && decl.note === null && !writingNote ? (
          <button className="add-note" onClick={() => editing.onNoting?.(key)} data-note-add={decl.line} data-tip="a comment above this declaration">
            + note
          </button>
        ) : null}
      </header>
      {test ? (
        <ul className="band-facts" data-band-facts>
          {shows('tags') ? (
          <li data-band-tags={test.tags.length}>
            tags{' '}
            {live ? (
              /* One field for all of them, because the file writes one line for all of them: 450
                 of the corpus's 682 tag lines carry more than one tag and none carries one per
                 line. A chip editor would be a second spelling of a list this language already
                 spells with spaces.

                 **`M229` `F` (`D1257`) — and the field states that convention, because the
                 placeholder cannot.** The file holds `@identity @functional` and this shows
                 `identity functional`: the sigil is stripped on read and written back on save, and
                 the only thing that ever said so was `placeholder="crud slow"`, which renders
                 **only when the field is empty**. Every declaration in every corpus on this machine
                 carries tags, so the one piece of syntax guidance rendered in exactly the state
                 where nobody needs it. */
              <input
                value={v.tags}
                onChange={(e) => change({ tags: e.target.value })}
                data-band-tags-edit
                aria-label="tags"
                placeholder="crud slow"
                data-tip="space-separated, and **no `@`** — the file writes the sigil for you. Tags are what `--tag` selects a run by and what the door badges count."
              />
            ) : test.tags.length === 0 ? (
              <span className="muted">none</span>
            ) : (
              test.tags.map((t) => <span key={t} className="tag">@{t}</span>)
            )}
          </li>
          ) : null}
          {shows('sessions') ? (
          <li data-band-sessions={test.sessions.length}>
            as{' '}
            {live ? (
              <input value={v.sessions} onChange={(e) => change({ sessions: e.target.value })} data-band-sessions-edit aria-label="sessions" placeholder="(anonymous)" />
            ) : test.sessions.length === 0 ? (
              <span className="muted">anonymous</span>
            ) : (
              test.sessions.join(', ')
            )}
          </li>
          ) : null}
          {shows('retry') ? (
          <li data-band-retry={test.retry}>
            retry{' '}
            {live ? (
              <input className="narrow" value={v.retry} onChange={(e) => change({ retry: e.target.value })} data-band-retry-edit aria-label="retry" />
            ) : test.retry === 0 ? (
              <span className="muted">0 — the default, not a retry in use</span>
            ) : (
              test.retry
            )}
            {live ? (
              <label className="not" data-tip="`parallel` — this test's cases may run at the same time">
                <input type="checkbox" checked={v.parallel} onChange={(e) => change({ parallel: e.target.checked })} data-band-parallel={v.parallel ? 'yes' : 'no'} />
                parallel
              </label>
            ) : null}
          </li>
          ) : null}
          {shows('table') ? (
          <li data-band-table={test.table === null ? 'none' : test.table.type}>
            with each{' '}
            {live ? (
              <select value={v.tableKind} onChange={(e) => change({ tableKind: e.target.value as HeaderEdit['tableKind'] })} data-band-table-kind aria-label="data table">
                <option value="none">none — one case</option>
                <option value="inline">rows written here</option>
                <option value="file">rows from a file</option>
              </select>
            ) : test.table === null ? (
              <span className="muted">none — one case</span>
            ) : test.table.type === 'InlineDataTable' ? (
              `${test.table.rows.length} row${test.table.rows.length === 1 ? '' : 's'}, ${test.table.columns.length} column${test.table.columns.length === 1 ? '' : 's'}`
            ) : (
              test.table.path.value
            )}
            {live && v.tableKind === 'file' ? (
              <input value={v.tablePath} onChange={(e) => change({ tablePath: e.target.value })} data-band-table-path aria-label="table path" placeholder="../data/products.json" />
            ) : null}
          </li>
          ) : null}
          {shows('table') && live && v.tableKind === 'inline' ? <TableEditor edit={v} onChange={change} /> : null}
          {shows('workload') ? (
          <li data-band-workload={test.workload === null ? 'none' : test.workload.type}>
            workload{' '}
            {test.workload === null ? (
              <span className="muted">none — a functional test</span>
            ) : (
              /* **The language's own spelling, not the node's type name** — `M225` `D` (`D1220`).
                 This read `test.workload.type.replace(/Workload$/, '')`, which put `SpikeUsers` on
                 screen and the stylesheet lowercased it to `spikeusers`. The file it describes
                 says `spike users`. */
              <span className="seq-kind" data-band-workload-words>
                {(() => { const e = workloadEditOf(test.workload); return workloadWords(e.shape, e.unit); })()}
              </span>
            )}
            {/* **`D1205` — a workload is an ordinary clause, and it is edited where it is stated.**
                Until `M224` this row drew a link to the LOAD door instead of a control, on `D1042`'s
                authority. The grant failed in both directions at once and the measurement is why
                the link is gone: the door it pointed at listed all three of `load.tflw`'s tests as
                *(already a workload test)* with the arming checkbox disabled, and the menu entry
                that would create one drew a label with zero controls.

                **It is not offered on BROWSER**, and that is `TF033` rather than a door rule — a
                workload may not sit beside a browser step, so there is no browser test this could
                be true about. What the file states is still drawn there, locked, which is `D1078`'s
                rule for a construct belonging to another door. */}
            {workloadLive ? (
              <WorkloadEditor
                edit={workloadValues}
                onChange={(next) => editing.onWorkload?.(test!, next)}
                lastRun={lastRun}
              />
            ) : null}
          </li>
          ) : null}
          {shows('thresholds') ? (
          <li data-band-thresholds={test.thresholds.length}>
            thresholds {test.thresholds.length === 0 && !live ? <span className="muted">none</span> : null}
            {live ? (
              <div className="thresholds" data-band-thresholds-edit={test.thresholds.length}>
                {test.thresholds.map((th, i) => (
                  <ThresholdRow
                    key={i}
                    index={i}
                    edit={editing.threshold !== null && editing.threshold.key === `th:${decl.index}:${i}` ? editing.threshold.values : thresholdEditOf(th)}
                    onEdit={(next) => {
                      if (next === null) {
                        // **`TF033` is asked here as well as in the menu.** A workload-bearing test
                        // must carry a threshold, and *removing the last one* is the same forbidden
                        // state as *removing the clause* — `M214`'s own finding, that a rule
                        // enforced where a thing is constructed is not enforced where it is
                        // patched, arriving one level up.
                        if (test!.thresholds.length === 1 && test!.workload !== null) { setThresholdRefusal(bandRefusal('thresholds', v, test!)); return; }
                        setThresholdRefusal(null);
                        if (test!.thresholds.length === 1) setAdded((prev) => prev.filter((x) => x !== 'thresholds'));
                      }
                      editing.onThreshold?.(test!, i, next);
                    }}
                  />
                ))}
                {thresholdRefusal === null ? null : <p className="warn clause-refusal" data-threshold-refusal>{thresholdRefusal}</p>}
                <button
                  onClick={() => editing.onThreshold?.(test, test.thresholds.length, { metric: 'duration', percentile: '95', op: 'lessThan', bound: '500', scope: '' })}
                  data-threshold-add
                  data-tip="a bound the whole run is graded against, after it finishes"
                >
                  + threshold
                </button>
              </div>
            ) : (
              test.thresholds.length
            )}
          </li>
          ) : null}
          {live && test !== null ? (
            <li className="band-add">
              <AddClause
                what="test"
                options={BAND_CLAUSES.filter((c) => c.key !== 'workload' || door !== 'browser').map((c) => ({
                  key: c.key,
                  label: c.label,
                  title: c.title,
                  state: shows(c.key) ? ('present' as const) : ('addable' as const),
                }))}
                onAdd={(k) => {
                  /* **`+ workload` writes a line, the way `+ threshold` does.** Every other clause
                     here is a field of the header that the editor below can be typed into before
                     anything is written; a workload is a statement in the body, so revealing an
                     empty editor would be the `[]`-controls row again under a different cause. The
                     default is `D1213`'s own first line, so the clause and the scaffold agree. */
                  if (k === 'workload') { editing.onWorkload?.(test, DEFAULT_WORKLOAD); return; }
                  setAdded((prev) => (prev.includes(k) ? prev : [...prev, k]));
                }}
                onRemove={(k) => {
                  if (k === 'workload') { editing.onWorkload?.(test, null); return; }
                  setAdded((prev) => prev.filter((x) => x !== k));
                  if (states(k)) change(bandWithout(k));
                }}
                refusalFor={(k) => bandRefusal(k, v, test)}
              />
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* **The preamble left this card in `M212` `S2`** (`D1086`). It was drawn here, under the
          heading *before the first request*, which made it read as a property of the declaration;
          it is the first thing that happens, and it is now the first rows of the body's sequence,
          where file order puts it. */}

    </div>
  );
}

/** The `with each` rows, as a grid. Nine inline tables in the two corpora, the largest 3 by 3 —
 *  which is why this is a grid of plain fields and not a spreadsheet. */
function TableEditor({ edit, onChange }: {
  readonly edit: HeaderEdit;
  readonly onChange: (patch: Partial<HeaderEdit>) => void;
}) {
  const setColumn = (i: number, name: string): void => onChange({ columns: edit.columns.map((c, j) => (j === i ? name : c)) });
  const setCell = (r: number, c: number, value: string): void =>
    onChange({ rows: edit.rows.map((row, j) => (j === r ? row.map((cell, k) => (k === c ? value : cell)) : row)) });
  return (
    <li className="table-editor" data-band-table-rows={edit.rows.length} data-band-table-columns={edit.columns.length}>
      <div className="row">
        {edit.columns.map((c, i) => (
          <input key={i} value={c} onChange={(e) => setColumn(i, e.target.value)} data-table-column={i} aria-label={`column ${i + 1}`} placeholder="name" />
        ))}
        <button onClick={() => onChange({ columns: [...edit.columns, ''], rows: edit.rows.map((row) => [...row, '""']) })} data-table-column-add>
          + column
        </button>
      </div>
      {edit.rows.map((row, r) => (
        <div className="row" key={r}>
          {row.map((cell, c) => (
            <input key={c} value={cell} onChange={(e) => setCell(r, c, e.target.value)} data-table-cell={`${r}:${c}`} aria-label={`row ${r + 1}, column ${c + 1}`} />
          ))}
          {/* **The last row is no longer locked, and that lock is the reason `D1132` exists.**
              `disabled={edit.rows.length === 1}` made `with each` a clause that could never reach
              empty, so under *refuse while it has content* it could never have been removed at
              all — the rule chosen in the grilling deadlocked on this one line. Now the last row
              takes the clause with it, which is one gesture instead of two and needs no
              per-clause definition of "empty" anywhere. */}
          <button
            onClick={() => (edit.rows.length === 1
              ? onChange({ rows: [], columns: [], tableKind: 'none', tablePath: '' })
              : onChange({ rows: edit.rows.filter((_, j) => j !== r) }))}
            data-table-row-remove={r}
            data-tip={edit.rows.length === 1 ? 'the last row — removing it takes `with each` with it' : 'this row of the table'}
          >
            remove
          </button>
        </div>
      ))}
      <button onClick={() => onChange({ rows: [...edit.rows, edit.columns.map(() => '""')] })} data-table-row-add>
        + row
      </button>
    </li>
  );
}

/**
 * A workload, as controls — `M224` `B` (`D1205`, `D1208`).
 *
 * **`D1103`'S GRID, MOVED RATHER THAN REDRAWN.** The language's ten workload shapes are not ten
 * things: they are four profiles × two units, plus two iteration shapes that have no time axis at
 * all. A `<select>` spelled them as a flat list of ten sentences, which is the one arrangement that
 * hides the fact a reader most needs — that `ramp` and `hold` differ in where they start, and that
 * `users` and `rps` are a *closed* and an *open* model of arrival rather than two spellings of
 * "how much".
 *
 * **It is a band clause and not a `.seq-row`, and that is the model rather than the picture.** A
 * row is addressed by a `StepPath` of declaration index plus step index, and `lenses.ts` says in
 * the type that LOAD is carried by no statement at all — `StepLens = Exclude<Lens, 'load'>`, and
 * `stepLensCounts(...).load` was deleted because it was structurally incapable of being non-zero.
 * Drawing the workload as a row means a row that is not a step, and `StepPath`, `isForeign`,
 * `+ after` and the `send` prefix each grow a case for it.
 *
 * **The `hidden` attribute the grid used to carry is gone with the move** (`D1214`'s instance). It
 * was written as `hidden={mode === 'existing' && !alsoWorkload}` and had no effect at all, because
 * `.shape-grid { display: grid }` outranks it and the stylesheet had no `[hidden]` rule — measured
 * live, 29 interactive controls in a block declaring itself absent. The clause is rendered when it
 * is open and not rendered when it is not: a component that is not there cannot be half-alive.
 */
function WorkloadEditor({ edit, onChange, lastRun }: {
  readonly edit: WorkloadEdit;
  readonly onChange: (next: WorkloadEdit) => void;
  /** This declaration's last run, for `D1221`'s citation. `undefined` where nobody has looked it
   *  up — the scaffold's preview, and every unit gate that renders the editor alone. */
  readonly lastRun?: { readonly iterations: number; readonly p95Ms: number; readonly inconclusive: boolean } | null;
}) {
  const timed = edit.shape !== 'iterations' && edit.shape !== 'iterations-per-user';
  const staged = edit.shape === 'step' || edit.shape === 'spike';
  const setStage = (i: number, patch: Partial<WorkloadStageEdit>): void =>
    onChange({ ...edit, stages: edit.stages.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="workload-edit" data-band-workload-edit={edit.shape} data-band-workload-unit={timed ? edit.unit : ''}>
      <div className="shape-grid">
        <div className="shape-cols">
          <span />
          {WORKLOAD_UNITS.map(([u, label, why]) => (
            <button key={u} type="button" className={edit.unit === u ? 'unit on' : 'unit'} onClick={() => onChange({ ...edit, unit: u })} data-shape-unit={u} aria-pressed={edit.unit === u} data-tip={why}>
              {label}
            </button>
          ))}
        </div>
        {WORKLOAD_PROFILES.map(([profile, label, why]) => (
          <div className="shape-row" key={profile}>
            <button type="button" className={edit.shape === profile ? 'profile on' : 'profile'} onClick={() => onChange({ ...edit, shape: profile })} data-shape-profile={profile} aria-pressed={edit.shape === profile} data-tip={why}>
              {label}
            </button>
            {WORKLOAD_UNITS.map(([u]) => (
              <button key={u} type="button" className={edit.shape === profile && edit.unit === u ? 'cell on' : 'cell'} onClick={() => onChange({ ...edit, shape: profile, unit: u })} data-shape-cell={`${profile}:${u}`} aria-pressed={edit.shape === profile && edit.unit === u} aria-label={`${label} ${u}`} data-tip={WORKLOAD_CELL_WHY[`${profile}:${u}`]}>
                {edit.shape === profile && edit.unit === u ? '●' : '·'}
              </button>
            ))}
          </div>
        ))}
        {/* **The two that are not in the grid, and are not an eleventh column either.** An
            iteration shape names an amount of work, not a rate: the run ends when the iterations
            are done, and how long that takes is the thing being measured. It has no unit axis to
            sit on, so it sits beside the grid rather than inside it. */}
        <div className="shape-row shape-aside">
          {WORKLOAD_ITERATION_SHAPES.map(([profile, label, why]) => (
            <button key={profile} type="button" className={edit.shape === profile ? 'profile on' : 'profile'} onClick={() => onChange({ ...edit, shape: profile })} data-shape-profile={profile} aria-pressed={edit.shape === profile} data-tip={why}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {!timed ? (
        <div className="row">
          <label className="not" data-tip={edit.shape === 'iterations-per-user' ? WORKLOAD_FIELD_WHY.countPerUser : WORKLOAD_FIELD_WHY.count}><span className="seq-kind">iterations</span> <input className="narrow" value={edit.count} onChange={(e) => onChange({ ...edit, count: e.target.value })} data-workload-count aria-label="iterations" /></label>
          <label className="not" data-tip={WORKLOAD_FIELD_WHY.vus}><span className="seq-kind">users</span> <input className="narrow" value={edit.vus} onChange={(e) => onChange({ ...edit, vus: e.target.value })} data-workload-vus aria-label="users" /></label>
        </div>
      ) : null}

      {edit.shape === 'ramp' || edit.shape === 'hold' ? (
        <div className="row">
          <label className="not" data-tip={WORKLOAD_FIELD_WHY.target}><span className="seq-kind">target</span> <input className="narrow" value={edit.target} onChange={(e) => onChange({ ...edit, target: e.target.value })} data-workload-target aria-label="target" /></label>
          <label className="not" data-tip={WORKLOAD_FIELD_WHY.seconds}><span className="seq-kind">seconds</span> <input className="narrow" value={edit.seconds} onChange={(e) => onChange({ ...edit, seconds: e.target.value })} data-workload-seconds aria-label="seconds" /></label>
        </div>
      ) : null}

      {/* ── The sentence — `M225` `D` (`D1220`) ──────────────────────────────────────────────
          **Always visible, and derived from the EDIT rather than from the saved node**, so it
          moves as the author types. The same rule `planInputOf` follows and for `D985`'s reason:
          one reading of the values, so the picture and the bytes cannot disagree. The plot, this
          line and the printed clause are one fact stated three ways, and a mutation to any of
          them reddens a gate that reads the other two. */}
      <p className="workload-says muted" data-workload-says>{workloadSentenceOf(edit)}</p>
      {/* **And what it did** — `M225` `E` (`D1221`). A citation, never a prediction, and it says
          *not run here yet* rather than going blank, because an absent line reads as a page that
          forgot rather than as a fact. */}
      {lastRun === undefined ? null : (
        <p className="workload-did muted" data-workload-did={lastRun === null ? 'never' : lastRun.inconclusive ? 'inconclusive' : 'ran'}>
          {workloadCitation(lastRun)}
        </p>
      )}

      {staged ? (
        <div className="stages" data-workload-stages={edit.stages.length}>
          {edit.stages.map((stage, i) => (
            <div className="stage-row" key={i}>
              {edit.shape === 'spike' ? (
                <select value={stage.mode} onChange={(e) => setStage(i, { mode: e.target.value as 'jump' | 'ramp' })} data-stage-mode={i} aria-label="stage mode" data-tip={WORKLOAD_FIELD_WHY.stageMode}>
                  <option value="jump">hold at</option>
                  <option value="ramp">ramp to</option>
                </select>
              ) : (
                // A `step` block has no spelling for a ramp, so the form does not offer one —
                // `buildWorkload` refuses it, and an option that is always refused is a trap.
                <span className="seq-kind">to</span>
              )}
              <input className="narrow" value={stage.target} onChange={(e) => setStage(i, { target: e.target.value })} data-stage-target={i} aria-label="stage target" data-tip={edit.shape === 'step' ? WORKLOAD_FIELD_WHY.stageTargetStep : WORKLOAD_FIELD_WHY.stageTargetSpike} />
              <input className="narrow" value={stage.seconds} onChange={(e) => setStage(i, { seconds: e.target.value })} data-stage-seconds={i} aria-label="stage seconds" data-tip={edit.shape === 'step' ? WORKLOAD_FIELD_WHY.stageSecondsStep : WORKLOAD_FIELD_WHY.stageSecondsSpike} />
              <span className="seq-kind">s</span>
              <button onClick={() => onChange({ ...edit, stages: edit.stages.filter((_, j) => j !== i) })} data-stage-remove={i} disabled={edit.stages.length === 1} aria-label="remove this stage" data-tip={WORKLOAD_FIELD_WHY.stageRemove}>
                −
              </button>
            </div>
          ))}
          <button onClick={() => onChange({ ...edit, stages: [...edit.stages, { mode: 'jump', target: '10', seconds: '5' }] })} data-stage-add data-tip={WORKLOAD_FIELD_WHY.stageAdd}>
            + stage
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One `threshold` line, as controls. */
function ThresholdRow({ index, edit, onEdit }: {
  readonly index: number;
  readonly edit: ThresholdEdit;
  readonly onEdit: (next: ThresholdEdit | null) => void;
}) {
  return (
    <div className="row" data-threshold={index}>
      <select value={edit.metric} onChange={(e) => onEdit({ ...edit, metric: e.target.value as ThresholdEdit['metric'] })} data-threshold-metric={index} aria-label="metric" data-tip={THRESHOLD_WHY.metric}>
        <option value="duration">duration</option>
        <option value="errorRate">error rate</option>
      </select>
      {edit.metric === 'duration' ? (
        <input className="narrow" value={edit.percentile} onChange={(e) => onEdit({ ...edit, percentile: e.target.value })} data-threshold-percentile={index} aria-label="percentile" data-tip={THRESHOLD_WHY.percentile} />
      ) : null}
      {edit.metric === 'duration' ? (
        <input value={edit.scope} onChange={(e) => onEdit({ ...edit, scope: e.target.value })} data-threshold-scope={index} aria-label="scope" placeholder="(the whole test)" data-tip={THRESHOLD_WHY.scope} />
      ) : null}
      <select value={edit.op} onChange={(e) => onEdit({ ...edit, op: e.target.value as ThresholdOp })} data-threshold-op={index} aria-label="comparison" data-tip={THRESHOLD_WHY.op}>
        <option value="lessThan">is less than</option>
        <option value="greaterThan">is greater than</option>
      </select>
      <input className="narrow" value={edit.bound} onChange={(e) => onEdit({ ...edit, bound: e.target.value })} data-threshold-bound={index} aria-label="bound" data-tip={THRESHOLD_WHY.bound} />
      <span className="muted">{edit.metric === 'duration' ? 'ms' : '%'}</span>
      <button onClick={() => onEdit(null)} data-threshold-remove={index} data-tip={THRESHOLD_WHY.remove}>
        remove
      </button>
    </div>
  );
}

/** A list of names, separated. */
function Joined({ items }: { readonly items: readonly string[] }) {
  return (
    <>
      {items.map((v, i) => (
        <span key={v}>
          {i > 0 ? ', ' : ''}
          <code>{v}</code>
        </span>
      ))}
    </>
  );
}

/** The one pinned file row (`D1074`): what this file brings in, and what it declares for itself. */
export function FileRow({ outline, editing }: { readonly outline: FileOutline; readonly editing: RowEditing }) {
  const { imports, uses, actions, header, tail } = outline.file;
  const empty = imports.length === 0 && uses.length === 0 && actions.length === 0 && header === null;
  const live = editing.onFileDecl !== null;
  const writingNote = editing.noting === 'file';
  return (
    <div className="file-facts" data-file-facts={empty ? 'none' : 'some'}>
      {writingNote ? (
        <NoteOpen note={header} what="the file" onChange={(lines) => editing.onNote?.({ on: 'file' }, lines)} />
      ) : header ? (
        <NoteBlock note={header} what="the file" onNote={editing.onNote === null ? undefined : (lines) => editing.onNote!({ on: 'file' }, lines)} />
      ) : null}
      {editing.onNote !== null && header === null && !writingNote ? (
        <button className="add-note" onClick={() => editing.onNoting?.('file')} data-note-add="file" data-tip="a comment at the top of the file, saying what it is for">
          + note
        </button>
      ) : null}
      <ul>
        {/* Comma-separated. The first draft mapped straight to `<code>` and three import paths
            rendered as one unbroken string on the page — a list with no separator is not a list. */}
        <li data-file-imports={imports.length}>
          imports{' '}
          {live ? (
            <PathRows what="import" paths={imports.map((i) => i.path.value)} onChange={editing.onFileDecl!} />
          ) : imports.length === 0 ? (
            <span className="muted">none</span>
          ) : (
            <Joined items={imports.map((i) => i.path.value)} />
          )}
        </li>
        <li data-file-uses={uses.length}>
          uses{' '}
          {live ? (
            <PathRows what="use" paths={uses.map((u) => u.path.value)} onChange={editing.onFileDecl!} />
          ) : uses.length === 0 ? (
            <span className="muted">none</span>
          ) : (
            <Joined items={uses.map((u) => u.path.value)} />
          )}
        </li>
        {/* **The actions are named and not drawn, and that is this round's own §0 defect one
            declaration kind over.** `fileOutline` walks hooks and tests; an `action` has a body —
            requests, captures, and all 8 of the corpus's `give` statements — and none of it is on
            this pane. Named here rather than quietly absent, because a reader who sees the name is
            at least told the thing exists. */}
        <li data-file-actions={actions.length}>
          actions {actions.length === 0 ? <span className="muted">none</span> : <Joined items={actions.map((a) => a.name)} />}
          {actions.length > 0 ? <span className="muted"> — named here; what they do is not drawn yet</span> : null}
        </li>
      </ul>
      {/* One file in the sibling's 139 ends on a note owning nothing — an idea the language cannot
          express yet. It is carried rather than dropped, because that is exactly the kind of thing
          a reader must not lose to a projection. */}
      {tail ? <NoteBlock note={tail} what="the file's last word" /> : null}
    </div>
  );
}

/** The `import`/`use` lines, one field each. A blank field is that line removed, which is the same
 *  rule a note follows: there is no separate gesture for taking something away. */
function PathRows({ what, paths, onChange }: {
  readonly what: 'import' | 'use';
  readonly paths: readonly string[];
  readonly onChange: (what: 'import' | 'use', index: number, path: string | null) => void;
}) {
  return (
    <span className="path-rows" data-path-rows={what}>
      {paths.map((path, i) => (
        <input
          key={i}
          value={path}
          onChange={(e) => onChange(what, i, e.target.value.trim() === '' ? null : e.target.value)}
          data-file-path={`${what}:${i}`}
          aria-label={`${what} ${i + 1}`}
        />
      ))}
      {/* `M229` `F` (`D1256`). Two words that write two different constructs, and the difference
          is not guessable from the words: `import` pulls another `.tflw` file's declarations into
          this one, `use` names a JavaScript module this file's `action`s can call. */}
      <button
        onClick={() => onChange(what, paths.length, what === 'import' ? './shared/helpers.tflw' : './helpers.ts')}
        data-file-path-add={what}
        data-tip={
          what === 'import'
            ? 'another `.tflw` file whose declarations this one may use — actions, sessions and hooks written once and resolved here'
            : 'a JavaScript module this file’s `action`s can call — the escape hatch, named so a reader can see what a test reaches for'
        }
      >
        + {what}
      </button>
    </span>
  );
}
