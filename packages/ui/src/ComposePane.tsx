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
import { bandParts, bandRefusal, bandWithout, requestParts, requestRefusal, requestWithout } from './clauses';
import type { ReactNode } from 'react';
import type { ApiBodySpec, ApiStepSpec, CaptureSpec, ExpectSpec, SubjectSpec } from '@tflw/lang';
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
  type TestDecl,
  type ThresholdDecl,
  type ThresholdMetric,
  type ThresholdOp,
  type ThresholdSpec,
  SYNTHETIC,
} from '@tflw/lang';
import { DOOR_BY_ID } from './doors';
import { LEAF_CAP, captureName, captureSpecs, leaves, verifySpec } from './response';
import { laidOut } from './jsonview';
import { VOCABULARY, type AddGesture } from './vocabulary';
import { isForeign, type Addressed, type Prefix, type FileOutline, type Note, type OutlineHook, type OutlineRequest, type OutlineStatement, type OutlineTest } from './outline';
import { StatementText, BodyText } from './Source';

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
        />
      )}
    </details>
  );
}

/** A body, said in one line — which of the five forms it is and what it carries. The JSON itself
 *  is shown whole below, because a request body is the thing an author most needs to read. */
function bodyLabel(body: ApiBody | null): string {
  if (body === null) return 'none';
  switch (body.type) {
    case 'InlineBody': return 'JSON';
    case 'FileBody': return `from ${body.path.value}`;
    case 'FormBody': return `form · ${body.fields.length} field${body.fields.length === 1 ? '' : 's'}`;
    case 'TextBody': return 'raw text';
    case 'UploadBody': return `upload ${body.filePath.value} as ${body.fieldName.value}`;
  }
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

function StatementRow({ statement, door, editing, verdict }: {
  readonly statement: OutlineStatement;
  readonly door: Lens;
  readonly editing: RowEditing;
  /** What the last run said about this statement, or `null` if nothing has run (`M210` `S6`). */
  readonly verdict: Verdict | null;
}) {
  const { row, onRow: onEdit, onNote, noting, onNoting } = editing;
  const foreign = isForeign(statement.lens, door);
  const key = stepKey(statement.stepPath);
  /**
   * **An assertion is editable when the language can address it and this door owns it.**
   *
   * `stepPath` is `null` for exactly one population today — the expects nested inside a `wait until
   * api` block, which are not in the body's own step list and so cannot be named by an index pair.
   * They stay read-only and say why rather than disappearing, which is `D1078`'s rule one level
   * down: a reader may always see what a reader may not edit here.
   */
  const own = statement.stepPath === null || onEdit === null || foreign ? null : statementEditOf(statement.node);
  const editable = own !== null;
  const values = row !== null && row.key === key ? row.values : own;
  /* **A note this statement does not have yet** (`D1077`, `M210` `S4`) — in the row rather than
     under it. 1247 of the corpus's statements carry a note and several thousand do not, so an
     always-drawn empty note block would be noise on every row that is fine as it is; and a control
     on its own line costs 27 px on every row, which the served page priced at +27 px × the 20
     statements a request can carry before this moved into the row. */
  const writingNote = noting !== null && noting === key;
  const addNote = editable && onNote !== null && statement.note === null && !writingNote
    ? (
        <button className="add-note" onClick={() => onNoting?.(key)} data-note-add={statement.line} data-tip="a comment above this line, explaining why it is here">
          + note
        </button>
      )
    : null;
  return (
    <li
      className={`stmt${foreign ? ' locked' : ''}`}
      data-stmt={statement.kind}
      data-stmt-line={statement.line}
      data-stmt-lens={statement.lens ?? 'none'}
      data-stmt-locked={foreign ? 'yes' : 'no'}
      data-stmt-editable={editable ? 'yes' : 'no'}
    >
      {writingNote ? (
        <NoteOpen note={statement.note} what={`line ${statement.line}`} onChange={(lines) => onNote?.({ on: 'step', path: statement.stepPath! }, lines)} />
      ) : statement.note ? (
        <NoteBlock note={statement.note} what={`line ${statement.line}`} onNote={editable && onNote !== null ? (lines) => onNote({ on: 'step', path: statement.stepPath! }, lines) : undefined} />
      ) : null}
      {editable && values !== null ? (
        values.kind === 'expect' ? (
          <ExpectRow statement={statement} edit={values.expect} onEdit={(next) => onEdit!(statement, { kind: 'expect', expect: next })} trailing={<>{addNote}<VerdictMark verdict={verdict} /></>} />
        ) : (
          <ScriptRow statement={statement} edit={values} onEdit={(next) => onEdit!(statement, next)} trailing={<>{addNote}<VerdictMark verdict={verdict} /></>} pick={editing.pick} />
        )
      ) : (
        <div className="stmt-line">
          <span className="ln muted">{statement.line}</span>
          <code className="stmt-text"><StatementText text={statement.text} /></code>
          {foreign ? (
            <a className="badge also" href={`#/${statement.lens}`} data-stmt-door={statement.lens} data-tip={`this is ${DOOR_BY_ID[statement.lens!].label}'s to edit — open that door`}>
              {DOOR_BY_ID[statement.lens!].label}
            </a>
          ) : null}
          <VerdictMark verdict={verdict} />
          {onEdit !== null && !foreign && statement.stepPath === null ? (
            <span className="muted" data-stmt-unaddressable>
              inside the block above — an index pair names a step of a body, and this is not one
            </span>
          ) : null}
        </div>
      )}
    </li>
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
  /** The request this ran for. */
  readonly line: number;
  /**
   * **That request's line, exactly as it ran** (`D1108`).
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

/**
 * How long ago a report was produced, in the shortest true form — `M213` `S2`.
 *
 * **`now` is a parameter and the caller passes `Date.now()` at render**, so the string ages only
 * when something else re-renders the card. That is deliberate rather than overlooked: a ticking
 * clock in a pane would repaint every request once a second for a figure whose whole job is to be
 * read at a glance, and the absolute time is in the `title` for anyone who needs it exactly.
 *
 * A date is what `D956` is about: *a claim carries the evidence it rests on*, and the evidence
 * here is a run that happened at a particular moment. An absolute clock time would make a reader
 * do the subtraction, and the subtraction is the whole question — *is this about the code in front
 * of me?* So the relative form leads, and the absolute one stays in the `title`.
 */
export function ago(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'at an unrecorded time';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** A statement's address as one string, for keying the row being typed into. `null` for a row no
 *  index pair can name. */
export function stepKey(path: StepPath | null): string | null {
  return path === null ? null : `${path.decl}:${path.step}`;
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
 * **Every clause a `test` header admits** (`M212` `S3`, `D1084`).
 *
 * This list is the pane's answer to `D1076` — *Compose models the whole vocabulary* — now that the
 * clauses are no longer all drawn at once. It has to stay complete, and a clause the language gains
 * that is missing from here is a clause the pane has quietly stopped teaching. That is not a
 * theoretical risk: it is the same shape as `outline.ts`'s placement gate, which is an **equality**
 * per step kind rather than a floor, for exactly this reason.
 */
/**
 * **Every clause an `api` request admits** (`M212` `S3`, `D1084`), and which of them this pane can
 * construct.
 *
 * `editable: false` is not a gap being hidden — it is `S2`'s stated scope, said in the one place a
 * reader looks for *what else can this have*: `ApiStepSpec` has no room for a timeout, a redirect
 * policy or a `Retry-After` bound, so those are carried across an edit by `nodeFor` rather than
 * rebuilt. A menu that omitted them would teach a language without them.
 */
interface ClauseOption {
  readonly key: string;
  readonly label: string;
  readonly title: string;
}

/**
 * **Every clause is addable, and `M214` `A2` is what made that true.**
 *
 * Three of these seven carried `editable: false` and an 80-character apology — *"the request spec
 * has no room for it yet; it is carried across an edit, not rebuilt"* — drawn as three permanently
 * disabled rows on every one of the corpus's 1058 requests. The sentence was about `ApiStepSpec`
 * and read as a sentence about the language; `ApiRequestSpec` has carried all three fields since
 * the enterprise arc and the printer has written them for just as long. `A2` widened the builder's
 * input, so there is no clause left to apologise for and the `locked` state went with the apology.
 */
const REQUEST_CLAUSES: readonly ClauseOption[] = [
  { key: 'service', label: 'service', title: 'the name in tflw.config of a second api service' },
  { key: 'label', label: 'label', title: '`as “…”` — the identity this request reports under' },
  { key: 'headers', label: 'headers', title: 'a header on this request alone' },
  { key: 'body', label: 'body', title: 'what this request sends — JSON, raw text, a file, or form fields' },
  { key: 'timeout', label: 'timeout', title: "this request's own timeout, or the env's" },
  { key: 'redirects', label: 'redirects', title: '`without redirects` makes the 3xx itself observable' },
  { key: 'retryAfter', label: 'retry after', title: '`retry honoring “Retry-After” up to N` — this one request, not the test' },
];

/** The five that are fields rather than groups — the `.request-fields` row. */
const REQUEST_FIELDS: readonly string[] = ['service', 'label', 'timeout', 'redirects', 'retryAfter'];

const BAND_CLAUSES: readonly { key: string; label: string; title: string }[] = [
  { key: 'tags', label: 'tags', title: '`@name` — labels this test can be selected by' },
  { key: 'sessions', label: 'as', title: '`as “…”` — the session this test runs under' },
  { key: 'retry', label: 'retry / parallel', title: '`retry N` and `parallel` — how the runner treats this test’s cases' },
  { key: 'table', label: 'with each', title: '`with each` — run this test once per row of a table' },
  { key: 'workload', label: 'workload', title: 'a shape of work over time — the LOAD door shapes one' },
  { key: 'thresholds', label: 'thresholds', title: 'a bound the whole run is graded against, after it finishes' },
];

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
const MATCHER_LABEL: Record<MatcherName, string> = {
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
] as const;
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

/** `items[0].price` — a body path as the language spells it. */
function pathText(segments: readonly PathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (segment.kind === 'index') out += `[${segment.index}]`;
    else out += out === '' ? segment.name : `.${segment.name}`;
  }
  return out;
}

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
    default: return 'carried';
  }
}

function argumentOf(subject: Subject): string {
  switch (subject.type) {
    case 'HeaderSubject': return subject.name.value;
    case 'BodySubject': return pathText(subject.path);
    case 'ValueSubject': return pathText(subject.ref);
    case 'LocatorSubject': return subject.locator.value.value;
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
export function SubjectFields({ subject, argument, locatorKind, carried, onChange, drops }: {
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
}) {
  return (
    <>
      <select value={subject} onChange={(e) => onChange({ subject: e.target.value as ExpectSubjectKind })} data-expect-subject={subject} aria-label="subject">
        {SUBJECTS.filter(([id]) => drops === undefined || !drops.has(id) || id === subject).map(([id, text]) => (
          <option key={id} value={id}>{text}</option>
        ))}
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
      {subject === 'header' || subject === 'body' || subject === 'value' || subject === 'locator' ? (
        <input
          value={argument}
          onChange={(e) => onChange({ argument: e.target.value })}
          data-expect-argument
          aria-label="subject argument"
          placeholder={subject === 'header' ? 'content-type' : subject === 'value' ? 'orderId' : subject === 'locator' ? 'Buy' : 'items[0].price'}
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
  /* **The BROWSER door's three** (`M213` `S4`, `D1094`). They are here rather than in a second
     union because a row is a row: `ScriptRow` draws whichever of these a statement is, and the
     only per-door fact is whether this door can construct the kind — which `vocabulary.ts` says
     and this type does not. */
  | { readonly kind: 'open'; readonly path: string }
  | { readonly kind: 'click'; readonly locatorKind: LocatorKind; readonly locator: string; readonly clickKind: ClickKind }
  | { readonly kind: 'fill'; readonly locatorKind: LocatorKind; readonly locator: string; readonly value: string };

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
  const key = stepKey(statement.stepPath);
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

export function ScriptRow({ statement, edit, onEdit, trailing, pick }: {
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

/** One assertion, as controls. The row the legacy form has always had, with the whole vocabulary
 *  in it and reading an assertion that already exists rather than inventing a new one. */
function ExpectRow({ statement, edit, onEdit, trailing }: {
  readonly statement: OutlineStatement;
  readonly edit: ExpectEdit;
  readonly onEdit: (next: ExpectEdit) => void;
  /** See `ScriptRow` — the row's right-hand end. */
  readonly trailing: ReactNode;
}) {
  const node = statement.node as ExpectStmt;
  const v = edit;
  const change = (patch: Partial<ExpectEdit>): void => onEdit({ ...v, ...patch });
  const clause = CLAUSE_MATCHER[v.matcher];
  const takesValue = VALUE_MATCHERS.has(v.matcher) && v.matcher !== 'matchesSubset';
  return (
    <>
      <div className="row expect-fields" data-expect-line={statement.line}>
        <select value={v.soft ? 'check' : 'expect'} onChange={(e) => change({ soft: e.target.value === 'check' })} data-expect-kind aria-label="expect or check">
          <option value="expect">expect</option>
          <option value="check">check</option>
        </select>
        <select value={v.quantifier} onChange={(e) => change({ quantifier: e.target.value as ExpectEdit['quantifier'] })} data-expect-quantifier aria-label="quantifier">
          <option value="">—</option>
          <option value="any">any</option>
          <option value="all">all</option>
        </select>
        <SubjectFields subject={v.subject} argument={v.argument} locatorKind={v.locatorKind} carried={subjectSpelling(node.subject)} onChange={change} />
        <label className="not" data-tip="`not` — the word whose absence would invert this assertion">
          <input type="checkbox" checked={v.negated} onChange={(e) => change({ negated: e.target.checked })} data-expect-negated={v.negated ? 'yes' : 'no'} />
          not
        </label>
        <select value={v.matcher} onChange={(e) => change({ matcher: e.target.value as MatcherName })} data-expect-matcher={v.matcher} aria-label="matcher">
          {MATCHERS.map(([id, text]) => (
            <option key={id} value={id}>{text}</option>
          ))}
        </select>
        {takesValue ? (
          <input value={v.operand} onChange={(e) => change({ operand: e.target.value })} data-expect-operand aria-label="operand" placeholder={v.matcher === 'fails' ? '(any failure)' : '200'} />
        ) : null}
        <span className="ln muted">line {statement.line}</span>
        {trailing}
      </div>
      {SCAN_MATCHERS.has(v.matcher) ? (
        <div className="row expect-extra" data-expect-extra="severity">
          <label className="muted">at or above</label>
          <select value={v.severityFloor} onChange={(e) => change({ severityFloor: e.target.value as ExpectEdit['severityFloor'] })} data-expect-severity aria-label="severity floor">
            <option value="">every severity</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      ) : null}
      {clause === 'schema' ? (
        <div className="row expect-extra" data-expect-extra="schema">
          <input value={v.schemaName} onChange={(e) => change({ schemaName: e.target.value })} data-expect-schema-name aria-label="schema name" placeholder="Order" />
          <label className="muted">from</label>
          <input value={v.schemaService} onChange={(e) => change({ schemaService: e.target.value })} data-expect-schema-service aria-label="schema service" placeholder="(default service)" />
          <input value={v.schemaSource} onChange={(e) => change({ schemaSource: e.target.value })} data-expect-schema-source aria-label="schema source" placeholder="openapi.json" />
        </div>
      ) : null}
      {clause === 'file' ? (
        <div className="row expect-extra" data-expect-extra="file">
          <input value={v.filePath} onChange={(e) => change({ filePath: e.target.value })} data-expect-file aria-label="file path" placeholder="fixtures/report.pdf" />
        </div>
      ) : null}
      {clause === 'snapshot' ? (
        <div className="row expect-extra" data-expect-extra="snapshot">
          <input value={v.snapshotName} onChange={(e) => change({ snapshotName: e.target.value })} data-expect-snapshot aria-label="snapshot name" placeholder="checkout" />
          {/* `mask <locator>` clauses are carried across an edit, not drawn as controls — the same
              answer `timeout` and `without redirects` get on the request card, and for the same
              reason: the card would rather say what it keeps than offer a control it cannot honour. */}
          {node.masks.length > 0 ? (
            <span className="muted" data-expect-masks={node.masks.length}>
              {node.masks.length} masked region{node.masks.length === 1 ? '' : 's'}, kept as written
            </span>
          ) : null}
        </div>
      ) : null}
      {v.matcher === 'matchesSubset' ? (
        <div className="fields subset-editor" data-expect-subset={v.subset.length}>
          {v.subset.map((f, i) => (
            <div className="row" key={i}>
              <input value={f.name} onChange={(e) => change({ subset: v.subset.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-subset-key={i} aria-label="key" />
              <input value={f.value} onChange={(e) => change({ subset: v.subset.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} data-subset-value={i} aria-label="value" />
              <button onClick={() => change({ subset: v.subset.filter((_, j) => j !== i) })} data-subset-remove={i}>
                remove
              </button>
            </div>
          ))}
          <button onClick={() => change({ subset: [...v.subset, { name: '', value: '""' }] })} data-subset-add data-tip="one key the response must carry with this value; the rest of the object is not compared">
            + key
          </button>
        </div>
      ) : null}
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

/** The chip — the whole of what a response costs at rest. It lives in `.request-head`, a row that
 *  already exists, so the answer to *what came back* is on screen for nothing. */
function ResponseChip({ ran, open, onToggle }: {
  readonly ran: Ran;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const response = ran.response!;
  return (
    <button
      type="button"
      className="response-chip"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={responsePanelId(ran.line)}
      data-compose-response={response.status}
      data-compose-response-scope={ran.scope}
      data-compose-response-open={open ? 'yes' : 'no'}
      data-tip={`${response.method} ${response.url} — ${ran.at}`}
    >
      <span className={`status-code ${statusTone(response.status)}`} data-compose-response-status={response.status}>{response.status}</span>{' '}
      <span className="muted" data-compose-response-when>
        {ran.scope === 'send' ? 'from this send' : 'from the last run'}, {ago(ran.at, Date.now())}
      </span>
    </button>
  );
}

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
              {tickable.skipped > 0
                ? `${tickable.skipped} value${tickable.skipped === 1 ? '' : 's'} sit under a key \`body.<path>\` cannot spell (M213-18) — the body below shows them.`
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

function RequestCard({ request: r, door, edit, onEdit, editing, ran, onVerify, onCapture }: {
  readonly request: OutlineRequest;
  readonly door: Lens;
  /** The card's live values. `null` means this pane is still read-only here — `S1`'s state, and
   *  what every door but API still gets. */
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  /** Everything the rows under this card need to be editable (`S3`, `S4`). */
  readonly editing: RowEditing;
  /** What the last run said about **this** request (`S6`, widened by `M213` `S2`). `null` when
   *  nothing has run it, or when what ran is no longer what is written here (`D1108`). The caller
   *  resolves that: by the time it reaches this card the join has already been checked. */
  readonly ran: Ran | null;
  /** Where a ticked assertion goes (`D1100`). `null` where the pane is read-only. */
  readonly onVerify: ((spec: ExpectSpec) => void) | null;
  /** Where ticked captures go (`D1102`). `null` where the pane is read-only. */
  readonly onCapture: ((specs: readonly CaptureSpec[]) => void) | null;
}) {
  const spec = r.spec;
  const writingNote = editing.noting !== null && editing.noting === stepKey(r.stepPath);
  const v = edit ?? editOf(r);
  const change = onEdit === null ? null : (patch: Partial<RequestEdit>) => onEdit({ ...v, ...patch });

  /** `M212` `S3` (`D1084`) — which of this request's clauses the file actually writes. */
  const [added, setAdded] = useState<readonly string[]>([]);
  /** Whether the response is open (`M213` `S2`). It is held here rather than in either half
   *  because the trigger is in the header and the panel is below the fields — see `ResponseChip`
   *  for why those are two elements and not a `<details>`. */
  const [responseOpen, setResponseOpen] = useState(false);
  const states = (clause: string): boolean => {
    switch (clause) {
      case 'service': return v.service !== '';
      case 'label': return v.label !== '';
      case 'headers': return v.headers.length > 0;
      case 'body': return v.bodyKind !== 'none';
      case 'timeout': return spec.timeoutMs !== null;
      case 'redirects': return !spec.followRedirects;
      case 'retryAfter': return spec.retryAfter !== null;
      default: return false;
    }
  };
  const shows = (clause: string): boolean => states(clause) || added.includes(clause);
  const add = (k: string): void => setAdded((prev) => (prev.includes(k) ? prev : [...prev, k]));
  const drawn = REQUEST_CLAUSES.filter((c) => shows(c.key)).length;
  return (
    <section className="request-card" data-request-line={r.line} data-request-kind={r.kind} data-request-editable={onEdit === null ? 'no' : 'yes'} data-request-drawn={drawn}>
      {writingNote ? (
        <NoteOpen note={r.note} what={`request ${r.line}`} onChange={(lines) => editing.onNote?.({ on: 'step', path: r.stepPath }, lines)} />
      ) : r.note ? (
        <NoteBlock note={r.note} what={`request ${r.line}`} onNote={editing.onNote === null ? undefined : (lines) => editing.onNote!({ on: 'step', path: r.stepPath }, lines)} />
      ) : null}
      <header className="request-head">
        {change === null ? (
          <span className={`method m-${v.method.toLowerCase()}`} data-request-method={v.method}>{v.method}</span>
        ) : (
          <select
            className={`method m-${v.method.toLowerCase()}`}
            value={v.method}
            onChange={(e) => change({ method: e.target.value as RequestEdit['method'] })}
            data-request-method={v.method}
            aria-label="method"
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        {change === null ? (
          <code className="request-path" data-request-path={v.path}>{v.path}</code>
        ) : (
          <input
            className="request-path"
            value={v.path}
            onChange={(e) => change({ path: e.target.value })}
            data-request-path={v.path}
            aria-label="path"
            placeholder="/orders/{orderId}"
          />
        )}
        <span className="ln muted">line {r.line}</span>
        {editing.onNote !== null && r.note === null && !writingNote ? (
          <button className="add-note" onClick={() => editing.onNoting?.(stepKey(r.stepPath))} data-note-add={r.line} data-tip="a comment above this request, explaining why it is here">
            + note
          </button>
        ) : null}
        {r.kind === 'WaitUntilApiStmt' ? (
          <span className="badge" data-request-polling="yes" data-tip="this request is re-issued until the assertions below it pass">
            polls
          </span>
        ) : null}
        {/* **What came back, in the row that already exists** (`M213` `S2`, `D1109`). The panel it
            opens is below the fields, beside the assertions that read it (`D1075`); what is here
            is the answer to *what came back*, which costs no height at all. */}
        {ran !== null && ran.response !== null ? (
          <ResponseChip ran={ran} open={responseOpen} onToggle={() => setResponseOpen((v) => !v)} />
        ) : null}
      </header>

      {/* `D1084` — a clause this request does not write is not a field here; it is in the menu at
          the bottom of the card. Five fields stood here unconditionally, and on the scaffold's
          `api GET /health` **all five were blank or showing a default**.

          **`redirects` is the one that argued against this, in writing, and the argument is
          answered rather than deleted.** It used to carry: *"Drawn even at its default, because a
          field only drawn when it is unusual is invisible exactly when it matters."* That is right
          about invisibility and wrong about the remedy — the menu below names `redirects` whether
          or not this request sets it, so the clause is one click away rather than absent. What it
          is no longer is a field reading `followed` on all 1167 requests in the sibling.

          **The last three are drawn and not editable, and that is `S2`'s scope rather than an
          oversight.** `ApiStepSpec` has no room for them, so they are carried across an edit by
          `nodeFor` rather than rebuilt — see `RequestEdit`. The menu says so in place of a field
          that looks live and is not. */}
      {REQUEST_FIELDS.some((f) => shows(f)) ? (
        <div className="request-fields" data-request-fields={REQUEST_FIELDS.filter((f) => shows(f)).join(',')}>
          {shows('service') ? (
            <Field label="service" value={v.service} onChange={change === null ? undefined : (service) => change({ service })} placeholder="(default)" title="the name in tflw.config of a second api service — blank is the default one" />
          ) : null}
          {shows('label') ? (
            <Field label="label" value={v.label} onChange={change === null ? undefined : (label) => change({ label })} placeholder="(automatic)" title="`as “…”` — the identity this request reports under; blank is the automatic one" />
          ) : null}
          {shows('timeout') ? (
            <Field label="timeout" value={spec.timeoutMs === null ? '' : `${spec.timeoutMs}ms`} title="this request's own timeout, or blank for the env's — drawn and carried across an edit, because the request spec has no room for it" />
          ) : null}
          {shows('redirects') ? (
            <Field label="redirects" value={spec.followRedirects ? 'followed' : 'not followed'} title="`without redirects` makes the 3xx itself observable — carried across an edit, because the request spec has no room for it" />
          ) : null}
          {shows('retryAfter') ? (
            <Field label="retry after" value={spec.retryAfter === null ? '' : `up to ${spec.retryAfter.max}`} title="`retry honoring “Retry-After” up to N` — this one request, not the test" />
          ) : null}
        </div>
      ) : null}

      {shows('headers') ? (
      <div className="headers-form" data-request-headers={v.headers.length}>
        <h4 className="muted">headers</h4>
        {v.headers.length === 0 ? (
          <p className="muted" data-request-headers-empty>
            none on this request yet — the env's <code>api</code> defaults and a session's token are still added at run time
          </p>
        ) : (
          <ul>
            {v.headers.map((h, i) => (
              <li key={i} className="row" data-request-header={h.name}>
                {change === null ? (
                  <>
                    <code>{h.name}</code>
                    <code className="muted" data-request-header-value={h.name}>{quoted(r, i, h.value)}</code>
                  </>
                ) : (
                  <>
                    <input value={h.name} onChange={(e) => change({ headers: v.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-header-edit-name={i} aria-label="header name" />
                    <input value={h.value} onChange={(e) => change({ headers: v.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} data-header-edit-value={i} aria-label="header value" />
                    <button
                      onClick={() => {
                        change({ headers: v.headers.filter((_, j) => j !== i) });
                        // `D1132` — the clause is the list, so an empty list is no clause.
                        if (v.headers.length === 1) setAdded((prev) => prev.filter((x) => x !== 'headers'));
                      }}
                      data-tip={v.headers.length === 1 ? 'the last header — removing it takes the `headers` clause with it' : 'this header'}
                      data-header-edit-remove={i}
                    >
                      remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {change === null ? null : (
          <button onClick={() => change({ headers: [...v.headers, { name: '', value: '' }] })} data-header-edit-add data-tip="a header on this request alone">
            + header
          </button>
        )}
      </div>
      ) : null}

      {shows('body') ? (
      <div className="body-form" data-request-body={bodyKindOf(r, edit)}>
        <h4 className="muted">body</h4>
        {change === null ? (
          <>
            <p className="muted">{bodyLabel(r.body)}</p>
            {r.body === null ? null : <pre className="preview body-preview" data-request-body-text>{bodyText(r.body)}</pre>}
          </>
        ) : (
          <>
            <select value={v.bodyKind} onChange={(e) => change({ bodyKind: e.target.value as RequestEdit['bodyKind'] })} data-body-edit-kind aria-label="body kind">
              <option value="none">none</option>
              <option value="json">JSON</option>
              <option value="text">raw text</option>
              <option value="file">from a file</option>
              <option value="form">form fields</option>
              {/* Offered only when it is already what this request sends, so the reader can see it
                  and leave it — and never as something to switch *to*, because the builder cannot
                  construct one. Switching away is a real edit and is allowed. */}
              {v.bodyKind === 'upload' ? <option value="upload">upload (multipart) — not editable here</option> : null}
            </select>
            {v.bodyKind === 'upload' && r.body !== null ? <pre className="preview body-preview" data-request-body-text>{bodyText(r.body)}</pre> : null}
            {v.bodyKind === 'json' || v.bodyKind === 'text' || v.bodyKind === 'file' ? (
              <textarea value={v.bodyText} onChange={(e) => change({ bodyText: e.target.value })} data-body-edit-text rows={3} aria-label="body" />
            ) : null}
            {v.bodyKind === 'form' ? (
              <div className="fields" data-body-edit-fields={v.formFields.length}>
                {v.formFields.map((f, i) => (
                  <div className="row" key={i}>
                    <input value={f.name} onChange={(e) => change({ formFields: v.formFields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-body-edit-key={i} aria-label="field name" />
                    <input value={f.value} onChange={(e) => change({ formFields: v.formFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} data-body-edit-value={i} aria-label="field value" />
                    <button
                      onClick={() => {
                        const last = v.formFields.length === 1;
                        change(last ? { formFields: [], bodyKind: 'none', bodyText: '' } : { formFields: v.formFields.filter((_, j) => j !== i) });
                        if (last) setAdded((prev) => prev.filter((x) => x !== 'body'));
                      }}
                      data-tip={v.formFields.length === 1 ? 'the last field — removing it takes the `body` clause with it' : 'this field'}
                      data-body-edit-remove={i}
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button onClick={() => change({ formFields: [...v.formFields, { name: '', value: '' }] })} data-body-edit-add>
                  + field
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      ) : null}

      {/* **The response, beside the assertions that read it** (`D1075`). It is the report's own
          trace — the run wrote it, this pane did not fetch it — which is `D1047` unchanged and the
          reason a send is a run rather than a second HTTP client living in a browser tab. */}
      {ran !== null && ran.response !== null ? <ResponsePanel ran={ran} open={responseOpen} onVerify={onVerify} onCapture={onCapture} /> : null}

      <div className="expects-form" data-request-attached={r.attached.length}>
        <h4 className="muted">
          what this request is read for — {r.attached.length} statement{r.attached.length === 1 ? '' : 's'}
        </h4>
        {r.attached.length === 0 ? (
          <p className="warn" data-request-attached-empty>
            nothing reads this response. An <code>api</code> step with no assertion can never fail (`B3-17`).
          </p>
        ) : (
          <ul className="stmts">
            {r.attached.map((s, i) => (
              <StatementRow
                key={`${s.line}-${s.kind}`}
                statement={s}
                door={door}
                editing={editing}
                /* **By line, and by the text on it** (`D1093`/`D1108`). The caller keys every
                   verdict to a line of *this* file and drops the ones whose statement has been
                   typed into since it ran — so a row with no mark is a row nothing has said
                   anything about, which is exactly what it should look like. */
                verdict={ran?.steps.get(s.line) ?? null}
              />
            ))}
          </ul>
        )}
      </div>

      {change === null ? null : (
        <AddClause
          what="request"
          options={REQUEST_CLAUSES.map((c) => ({
            key: c.key,
            label: c.label,
            title: c.title,
            state: shows(c.key) ? ('present' as const) : ('addable' as const),
          }))}
          onAdd={add}
          /* **Both halves, because a clause can be present in two different senses.** One the file
             writes, and one the menu is only SHOWING — added a moment ago and not yet filled in.
             Removing the first is an edit to the bytes; removing the second is forgetting a row
             was ever drawn, and the reader cannot tell the two apart and should not have to. */
          onRemove={(k) => {
            setAdded((prev) => prev.filter((x) => x !== k));
            if (states(k)) change(requestWithout(k));
          }}
          refusalFor={(k) => requestRefusal(k, v)}
        />
      )}
    </section>
  );
}

/** `print` emits an `InlineBody` as `body <json>`; the field holds the json. One `slice`, named,
 *  rather than a second serialiser for the one shape the printer will not emit on its own. */
export function withoutKeyword(printed: string): string {
  return printed.startsWith('body ') ? printed.slice('body '.length) : printed;
}

/** A header value as the file spells it, for the read-only rendering. */
function quoted(r: OutlineRequest, i: number, fallback: string): string {
  const h = r.spec.headers[i];
  return h ? printValue(h.value) : fallback;
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
export function TestBand({ decl, door, editing }: {
  readonly decl: OutlineHook | OutlineTest;
  readonly door: Lens;
  readonly editing: RowEditing;
}) {
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
            {live ? (
              <input className="band-name" value={v.name} onChange={(e) => change({ name: e.target.value })} data-band-name={v.name} aria-label="test name" />
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
                 spells with spaces. */
              <input value={v.tags} onChange={(e) => change({ tags: e.target.value })} data-band-tags-edit aria-label="tags" placeholder="crud slow" />
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
              <>
                {test.workload.type.replace(/Workload$/, '')}{' '}
                {/* **The one band fact this door does not edit, and it is a decision rather than a
                    gap** (`D1042`). A workload is a shape of work with stages in it, and the door
                    whose form is built around that shape is LOAD — the same argument `D1078` makes
                    one level down for a step belonging to another door, made here for a
                    declaration's. The cost is stated where it lands: changing one is two clicks
                    away, through a link that says so. */}
                <a className="badge also" href="#/load" data-band-workload-door data-tip="a workload is the LOAD door's to shape — open it there">
                  LOAD
                </a>
              </>
            )}
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
                options={BAND_CLAUSES.map((c) => ({
                  key: c.key,
                  label: c.label,
                  title: c.title,
                  state: shows(c.key) ? ('present' as const) : ('addable' as const),
                }))}
                onAdd={(k) => setAdded((prev) => (prev.includes(k) ? prev : [...prev, k]))}
                onRemove={(k) => {
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

/** One `threshold` line, as controls. */
function ThresholdRow({ index, edit, onEdit }: {
  readonly index: number;
  readonly edit: ThresholdEdit;
  readonly onEdit: (next: ThresholdEdit | null) => void;
}) {
  return (
    <div className="row" data-threshold={index}>
      <select value={edit.metric} onChange={(e) => onEdit({ ...edit, metric: e.target.value as ThresholdEdit['metric'] })} data-threshold-metric={index} aria-label="metric">
        <option value="duration">duration</option>
        <option value="errorRate">error rate</option>
      </select>
      {edit.metric === 'duration' ? (
        <input className="narrow" value={edit.percentile} onChange={(e) => onEdit({ ...edit, percentile: e.target.value })} data-threshold-percentile={index} aria-label="percentile" />
      ) : null}
      {edit.metric === 'duration' ? (
        <input value={edit.scope} onChange={(e) => onEdit({ ...edit, scope: e.target.value })} data-threshold-scope={index} aria-label="scope" placeholder="(the whole test)" />
      ) : null}
      <select value={edit.op} onChange={(e) => onEdit({ ...edit, op: e.target.value as ThresholdOp })} data-threshold-op={index} aria-label="comparison">
        <option value="lessThan">is less than</option>
        <option value="greaterThan">is greater than</option>
      </select>
      <input className="narrow" value={edit.bound} onChange={(e) => onEdit({ ...edit, bound: e.target.value })} data-threshold-bound={index} aria-label="bound" />
      <span className="muted">{edit.metric === 'duration' ? 'ms' : '%'}</span>
      <button onClick={() => onEdit(null)} data-threshold-remove={index}>
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

/**
 * **The `FILE` strip** (`M212` `S1`, `D1085`).
 *
 * `FileRow` used to be rendered as the last block *inside* `.test-band`, so a card headed
 * `TEST health check` ended with the file's comment, its `imports`, its `uses` and its `actions` —
 * four file-scoped facts drawn inside a test's own boundary. That is `D956`'s family exactly: a
 * claim about one artifact printed beside a different one. The card's edges matched no edge in the
 * language, which is why the pane could not be read scope by scope however it was styled.
 *
 * So the file's facts get their own strip, above the declaration, and the strip **says which scope
 * it is** in its own summary. Three properties, each deliberate:
 *
 * - **It is always there**, selection or not. The old arrangement showed the file's facts only when
 *   *nothing* was selected (`at ? <TestBand/> : <FileRow/>`), so picking a test made the file's
 *   imports disappear — the pane's answer to *what does this file bring in?* depended on where the
 *   cursor was.
 * - **It is collapsed and still editable.** `D1085` asked for a strip, not a read-only caption:
 *   opening it gives back every control `FileRow` has always had, in place.
 * - **Closed, it holds nothing in the tab order.** This is the one thing `.legacy` gets wrong
 *   (§1: thirteen fields at 30px, reachable by Tab, carrying another example's placeholders), and
 *   a new disclosure that repeated it would be this round's own defect. A `<details>` hides its
 *   contents from focus by default; the gate for this asserts the *rendered* fact rather than the
 *   element, because a stylesheet is one rule away from undoing it (`M209-02`).
 */
function FileStrip({ outline, editing }: { readonly outline: FileOutline; readonly editing: RowEditing }) {
  const { imports, uses, actions, header } = outline.file;
  const parts = [
    imports.length > 0 ? `${imports.length} import${imports.length === 1 ? '' : 's'}` : null,
    uses.length > 0 ? `${uses.length} use${uses.length === 1 ? '' : 's'}` : null,
    actions.length > 0 ? `${actions.length} action${actions.length === 1 ? '' : 's'}` : null,
    header !== null ? 'a note' : null,
  ].filter((p): p is string => p !== null);
  return (
    <details className="file-strip" data-file-strip={parts.length === 0 ? 'empty' : String(parts.length)}>
      {/* The summary states the scope and then what is in it. A strip that said only `FILE` would
          make the reader open it to find out whether opening it was worth doing. */}
      <summary>
        <span className="scope-tag">FILE</span>{' '}
        <span className="muted">{parts.length === 0 ? 'imports nothing, uses nothing, declares no action' : parts.join(' · ')}</span>
      </summary>
      <FileRow outline={outline} editing={editing} />
    </details>
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
      <button onClick={() => onChange(what, paths.length, what === 'import' ? './shared/helpers.tflw' : './helpers.ts')} data-file-path-add={what}>
        + {what}
      </button>
    </span>
  );
}

/**
 * **The declaration's body, as a sequence** (`M212` `S2`, `D1086` — amending `D1073`).
 *
 * `D1073` put *one request on screen* and the pane took it literally: the selected request got a
 * 410 px card and **every other request in the test was not drawn at all**. That is defensible for
 * the scaffold, which has one; it is not defensible for the corpus, where **42.5% of 694 tests
 * carry more than one request and the largest carries 13**. A reader of `cart-checkout.tflw` could
 * see one thirteenth of the test and had to consult the tree on the left to learn that the other
 * twelve existed.
 *
 * `D1073`'s argument was never *show one request*; it was *do not stack thirteen 410 px cards*,
 * which at today's height is 5,330 px — 5.9 screens. Both are satisfied by the same shape, and it
 * is the shape a test already has: **a sequence**. Every request and every statement between them
 * is one line, in file order, and the selected request is the one that expands.
 *
 * Three things follow from *in file order*, and each was a way the old pane lost information:
 *
 * - **The preamble is in the list, not above it.** It used to be a separate `.band-preamble` block
 *   inside the test's card, which drew it as a property of the declaration rather than as the first
 *   thing that happens.
 * - **A non-selected request's attachments are still drawn.** They are what the request is read
 *   for, and a row with no consequence is a row that looks decorative.
 * - **`206 of 396` multi-request tests interleave** (`outline.ts`), so any grouping other than file
 *   order is lossy by construction. This one does no grouping at all.
 */
function BodySequence({ decl, selected, door, onLine, edit, onEdit, editing, ran, onVerify, onCapture, adds, onAdd, recording }: {
  readonly decl: OutlineHook | OutlineTest;
  readonly selected: OutlineRequest | null;
  readonly door: Lens;
  readonly onLine: (line: number) => void;
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  readonly editing: RowEditing;
  /**
   * **Every request's last verdict, not just the selected one** (`M213` `S2`, `D1099`).
   *
   * This was one `Ran` for one request until this slice, because the only way to get one was to
   * press `send` on the request you were looking at. Reading the last run off the report on disk
   * costs one fetch for the whole file, so withholding it from the twelve collapsed rows would be
   * a decision to hide evidence that is already in hand — and those rows are where it is worth the
   * most: opening a file and seeing which of its assertions last held is the question a reader has
   * before they have chosen anything to look at.
   */
  readonly ran: RanIndex;
  readonly onVerify: ((request: OutlineRequest, spec: ExpectSpec) => void) | null;
  readonly onCapture: ((request: OutlineRequest, specs: readonly CaptureSpec[]) => void) | null;
  /**
   * The `+` gestures this door offers, and where one goes — `M213` `S4` (`D1094`).
   *
   * A **list from `vocabulary.ts` and one callback**, rather than a prop per gesture. Until this
   * slice the pane knew the API door's three by name (`onAddRequest`, `onAddLet`, `onAddWait`),
   * which is exactly the shape that makes a second door a second pane: BROWSER's four are
   * `open`, `click`, `fill` and `let`, and none of the first three is any of API's.
   */
  readonly adds: readonly AddGesture[];
  readonly onAdd: ((decl: OutlineTest, key: string) => void) | null;
  /** The declaration a recording is writing into, by its line (`M213` `S5`). `null` when none is
   *  running. It is a **line and not a boolean** because a recorder writes into one declaration
   *  and the page draws several `+` rows: a boolean would light every one of them. */
  readonly recording: number | null;
}) {
  const rows: ReactNode[] = [];
  for (const s of decl.body.preamble) {
    // A preamble statement runs before the first request. It has no request to key off, and the
    // report's own steps for it are the hook's — so it carries no mark rather than a borrowed one.
    rows.push(<StatementRow key={`pre-${s.line}-${s.kind}`} statement={s} door={door} editing={editing} verdict={null} />);
  }
  for (const r of decl.body.requests) {
    const rows_ran = ran.get(r.line) ?? null;
    if (selected !== null && r.line === selected.line) {
      rows.push(
        <li className="seq-open" key={`req-${r.line}`} data-seq-open={r.line}>
          <RequestCard
            request={r}
            door={door}
            edit={edit}
            onEdit={onEdit}
            editing={editing}
            ran={rows_ran}
            onVerify={onVerify === null ? null : (spec) => onVerify(r, spec)}
            onCapture={onCapture === null ? null : (specs) => onCapture(r, specs)}
          />
        </li>,
      );
      continue;
    }
    rows.push(<RequestLine key={`req-${r.line}`} request={r} onLine={onLine} ran={rows_ran} />);
    for (const s of r.attached) {
      rows.push(
        <StatementRow
          key={`att-${r.line}-${s.line}-${s.kind}`}
          statement={s}
          door={door}
          editing={editing}
          verdict={rows_ran?.steps.get(s.line) ?? null}
        />,
      );
    }
  }
  return (
    <>
      <ol className="body-sequence" data-body-sequence={decl.body.requests.length} data-body-rows={rows.length}>
        {rows}
      </ol>
      {rows.length > 0 ? null : (
        <p className="muted" data-compose-empty-body>
          this declaration has an empty body — nothing runs in it yet
        </p>
      )}
      {onAdd === null || adds.length === 0 ? null : decl.kind === 'test' ? (
        <div className="seq-adds" data-seq-adds={adds.map((a) => a.key).join(',')}>
          {/* **`capture` is not in this row, on either door**, and that is a rule rather than an
              omission: it reads a response, so it lives on the response (`ResponsePanel`), beside
              the value being bound. What is here is every gesture that stands on the test rather
              than on something the run produced. */}
          {adds.map((a) => {
            const live = a.key === 'record' && recording === decl.line;
            return (
              <button
                key={a.key}
                type="button"
                className={live ? 'seq-add recording' : 'seq-add'}
                onClick={() => onAdd(decl, a.key)}
                disabled={recording !== null && !live}
                data-seq-add={a.key}
                data-seq-add-line={decl.line}
                data-seq-add-live={live ? 'yes' : undefined}
                data-tip={
                  recording !== null && !live
                    ? 'a recording is running — every action in that browser is a step in this file'
                    : live
                      ? 'close the browser and stop writing steps'
                      : a.title
                }
              >
                {live ? 'stop recording' : a.label}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted" data-seq-add-hook>
          a request cannot be added to a hook from here — the splice names a test by name, and a hook has none
        </p>
      )}
    </>
  );
}

/**
 * One request, collapsed to its line.
 *
 * A button rather than a link, and the same gesture the tree's request rows use (`onLine`), because
 * there is exactly one way to change what Compose is pointed at and it is the address (`D1045`). A
 * second mechanism here would be a second answer to *where am I*.
 */
function RequestLine({ request, onLine, ran }: {
  readonly request: OutlineRequest;
  readonly onLine: (line: number) => void;
  /** What the last run said about this request (`M213` `S2`). A collapsed row carries the status
   *  and nothing else — the body and the ticks are what opening it is for. */
  readonly ran: Ran | null;
}) {
  return (
    <li className="seq-request" data-seq-request={request.line} data-seq-method={request.method}>
      <button type="button" className="seq-goto" onClick={() => onLine(request.line)} data-seq-goto={request.line} data-tip="open this request">
        <span className="ln muted">{request.line}</span>
        <span className={`method m-${request.method.toLowerCase()}`}>{request.method}</span>
        <code>{request.path}</code>
        {request.label === null ? null : <span className="muted"> as {request.label}</span>}
        {/* The count, not the statements. A collapsed request that said nothing about what reads it
            would look like a request nothing reads — which is a real and different state, and the
            card says so in red when it happens. */}
        <span className="muted">
          {' · '}
          {request.attached.length} statement{request.attached.length === 1 ? '' : 's'}
        </span>
        {ran === null || ran.response === null ? null : (
          <span
            className={`status-code ${statusTone(ran.response.status)}`}
            data-seq-status={ran.response.status}
            data-tip={`${ran.scope === 'send' ? 'from a send' : 'from the last run'} — ${ran.at}`}
          >
            {ran.response.status}
          </span>
        )}
      </button>
    </li>
  );
}

export interface ComposePaneProps {
  readonly path: string;
  readonly outline: FileOutline | null;
  /** What `L<line>` names — the declaration, and the request inside it (`D1080`). One resolution,
   *  so the band and the card are always showing the same test. */
  readonly at: Addressed | null;
  readonly door: Lens;
  /** Point Compose at a line — the same gesture the tree's rows use, because the address is the one
   *  place the selection lives (`D1045`). `M212` `S2` needs it: a collapsed request in the body's
   *  sequence is the thing you click to open. */
  readonly onLine: (line: number) => void;
  /** **The two create gestures** (`M212` `S4`, `D1087`) — a new test in this file, and a new file.
   *  Rendered by the shell so that the dialog can reach `putFile` and the project's file list
   *  without this pane learning what either is. */
  readonly onNew: ((mode: 'test' | 'file') => void) | null;
  /** The dialog itself, when one is open. */
  readonly dialog: ReactNode;
  /** The project's scratch path when its `.gitignore` does not list it, or `null`. It lives beside
   *  `send`, because `send` is what writes it (`M212` `S4b` moved it here from the retired form —
   *  a warning about a file is worth saying next to the button that writes that file). */
  readonly scratchUnignored: string | null;
  /**
   * Whether that disclosure is open — **held by `ApiForm`, which the strip never unmounts.**
   *
   * This is `M205` `S5a`'s finding for the third time, and it cost two page-gate runs to re-learn:
   * the strip swaps panels by *unmounting* them, so anything remembered below one is gone on a tab
   * trip. The form's field values survive precisely because they are `useState` in `ApiForm`; an
   * author who opened this, typed, glanced at Source and came back found the form shut again, and
   * six gates met it as timeouts on controls that were present, resolved and invisible. A `<details>`
   * owning its own state is right until the element itself stops surviving the gesture.
   */
  /**
   * The selected request's live values, and where a change goes (`M210` `S2`, `D1079`).
   *
   * `null` for both means read-only, which is `S1`'s state and still every door but API's. The
   * values live above this component for `M205` `S5a`'s reason — the strip unmounts panels — and
   * the *text* they produce is the shell's, so the explorer's outline and Source see the same
   * buffer this card is editing.
   */
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  /**
   * The assertion row being typed into, and where a change goes (`M210` `S3`).
   *
   * Keyed by the statement's own index pair rather than held per row, for `S2`'s reason one
   * construct over: the values are re-derived from the file the moment the buffer moves, so the
   * only row that may hold something the file does not is the one under the cursor.
   */
  readonly editing: RowEditing;
  /**
   * What `send` will run, listed **before the press** (`M210` `S6`, `D1075`).
   *
   * Pressing it fires every one of these for real, against whatever the env points at — which is
   * the accepted cost of running the prefix rather than the request alone, and the reason the cost
   * is on screen rather than in a docstring. `null` when no request is selected.
   */
  readonly prefix: Prefix | null;
  readonly onSend: (() => void) | null;
  readonly sending: boolean;
  /**
   * The last run's verdicts and responses, for **every** request in the open file (`D1099`).
   *
   * An empty map is a real and common state — a file nothing has run, or a file whose last run is
   * no longer about what is written. It is not an error and the pane says nothing about it: a
   * request with no verdict looks like a request with no verdict.
   */
  readonly ran: RanIndex;
  /** Where a ticked assertion goes (`D1100`) — the request it is about, and the statement to write
   *  under it. `null` while the pane is read-only. */
  readonly onVerify: ((request: OutlineRequest, spec: ExpectSpec) => void) | null;
  /** Where ticked captures go (`D1102`). */
  readonly onCapture: ((request: OutlineRequest, specs: readonly CaptureSpec[]) => void) | null;
  /** Every other `+` gesture, from `vocabulary.ts` — see `BodySequence` (`D1094`). */
  readonly onAdd: ((decl: OutlineTest, key: string) => void) | null;
  /** The declaration a recording is writing into, by line (`M213` `S5`). */
  readonly recording: number | null;
  /** Whether the buffer holds anything the file does not (`D1079`). */
  readonly dirty: boolean;
  readonly busy: boolean;
  /** Why the last change did not become bytes — a half-typed path is not yet a request, and
   *  saying so is better than a field that refuses the keystroke. */
  readonly problem: string | null;
  readonly onWrite: () => void;
  readonly onDiscard: () => void;
}

export function ComposePane({ path, outline, at, door, onLine, onNew, dialog, scratchUnignored, edit, onEdit, editing, prefix, onSend, sending, ran, onVerify, onCapture, onAdd, recording, dirty, busy, problem, onWrite, onDiscard }: ComposePaneProps) {
  const requests = outline === null ? [] : outline.declarations.flatMap((d) => d.body.requests);
  return (
    <div className="authoring compose-pane" data-compose={outline === null ? 'reading' : at?.request ? 'request' : 'no-request'}>
      <header className="authoring-head">
        <h2>
          <code data-compose-file={path}>{path}</code>
        </h2>
        {/* **The two ways to make something that is not here yet** (`D1087`). `PUT /api/file` with
            no `If-Match` has created files since the route was written, and the page offered no
            control for it anywhere — the third time this repository has found a built capability
            with no door on it (`M205`, `M209`). They sit in the head because that is the one part
            of the pane that is about the file rather than about a declaration in it. */}
        {onNew === null ? null : (
          <div className="authoring-new" data-compose-new>
            <button type="button" onClick={() => onNew('test')} disabled={outline === null} data-compose-new-test>
              + new test
            </button>
            <button type="button" onClick={() => onNew('file')} data-compose-new-file>
              + new file
            </button>
          </div>
        )}
        {outline === null ? (
          <p className="muted" data-compose-state>
            reading {path || 'the project'}…
          </p>
        ) : (
          <p className="muted" data-compose-summary data-compose-subject={at ? 'declaration' : 'file'}>
            {/* Written for a reader, not for the plan. A pane that explains itself by slice number is
                talking to the person who built it.

                **`M212` `S1`, `D1085` — the head names what the body is showing.** It used to count
                the whole file (`8 declarations · 6 requests`) above a body drawing exactly ONE of
                them, and the only clue as to which was the string `line 30` further down. Two
                artifacts, one sentence: `D956`'s rule, in the place a reader looks first. The file's
                count does not disappear — it moves to the end of the sentence, where it reads as
                context for the subject rather than as a description of it. */}
            {at ? (
              <>
                <code data-compose-subject-what>{at.decl.kind === 'test' ? `test ${at.decl.name}` : at.decl.label}</code> · line{' '}
                {at.decl.line} · {at.decl.body.requests.length} request{at.decl.body.requests.length === 1 ? '' : 's'} —{' '}
                {outline.declarations.length === 1
                  ? 'the only declaration in this file'
                  : `one of ${outline.declarations.length} declarations in this file`}
                . Everything here can be typed into, except a workload, which the LOAD door shapes, and a step belonging to
                another door, which says whose it is.
              </>
            ) : (
              <>
                {outline.declarations.length} declaration{outline.declarations.length === 1 ? '' : 's'} · {requests.length} request
                {requests.length === 1 ? '' : 's'} — this file, as it is on disk. Pick one from the tree on the left to work on it.
              </>
            )}
          </p>
        )}
      </header>

      {dialog}

      {/* **The reading state replaces the READER, not the pane**, and that distinction was found on
          the served page rather than reasoned out. Returning early from this component while the
          shell re-read a file unmounted the disclosure below with everything else — so clicking a
          second file closed the form an author had half filled in, and the page gate met it as six
          timeouts on controls that were present, resolved and invisible. A pane whose furniture
          comes and goes with a fetch is a pane you cannot hold a gesture across. */}
      {outline === null ? null : (
        <>
          {/* `D1085` — the file first and always, then the declaration. The old line read
              `at ? <TestBand/> : <FileRow/>`, which made the two scopes alternatives: picking a test
              took the file's imports off the screen, so the pane's answer to *what does this file
              bring in?* depended on where the cursor was. They are not alternatives; they are
              nested, and now they are drawn that way. */}
          <FileStrip outline={outline} editing={editing} />
          {at ? <TestBand decl={at.decl} door={door} editing={editing} /> : null}

          {/* `D1086` — the body, in its own order, with one request open. The old line drew the
              selected request's card and NOTHING ELSE: on a thirteen-request test twelve requests
              were absent from the pane entirely, and the only place they existed was the tree. */}
          {/* `at` is `null` only for a file that declares nothing at all: `addressed` answers the
              file's first declaration when the address names no line, so an address without an
              `L` still has a subject and the head above still names it. */}
          {at === null ? (
            <p className="muted" data-compose-no-request>
              this file declares nothing yet — no test, no hook, nothing for this pane to be about
            </p>
          ) : (
            /* **An empty body still gets a sequence**, and that is not a cosmetic choice: a test the
               LOAD door started has a workload and no steps at all, and it is the single most
               likely thing anyone wants to add a request to (`D1044`). The first draft short-cut an
               empty body to a sentence, which put `+ request` out of reach for exactly that case. */
            <BodySequence
              decl={at.decl}
              selected={at.request}
              door={door}
              onLine={onLine}
              edit={edit}
              onEdit={onEdit}
              editing={editing}
              ran={ran}
              onVerify={onVerify}
              onCapture={onCapture}
              adds={VOCABULARY[door].adds}
              onAdd={onAdd}
              recording={recording}
            />
          )}
        </>
      )}

      {/* **THE PREFIX, LISTED BEFORE THE PRESS** (`D1075`, `D1078`'s sibling argument one construct
          over). Four requests in five cannot run alone — 734 of the sibling's 1031 read a variable
          bound earlier, 379 read a capture from the file's `before` hook — so `send` runs what comes
          before the selected request, for real. That is the honest thing to run and the expensive
          thing to press: it can create rows in whatever the env points at. So what it will send is
          on screen, in order, before anything is pressed, rather than in a docstring. */}
      {outline !== null && prefix !== null && onSend !== null ? (
        <div className="prefix" data-prefix={prefix.requests.length}>
          <button className="run" onClick={onSend} disabled={sending || busy} data-compose-send>
            {sending ? 'sending…' : `send — ${prefix.requests.length} request${prefix.requests.length === 1 ? '' : 's'}`}
          </button>
          <ol className="prefix-list">
            {prefix.requests.map((r, i) => (
              <li key={i} data-prefix-request={i}>
                <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span> <code>{r.path}</code>{' '}
                <span className="muted">{r.where}</span>
              </li>
            ))}
          </ol>
          <p className="muted">
            these are sent for real, in this order, against the env the strip names — the last one is the request above
          </p>
          {/* An exploration is not a suite, so the file it uses is one path, overwritten, and not
              something to commit. A project `tflw init` made ignores it; an older one is told
              rather than edited behind the author's back (`A1-5`). It sits here since `M212` `S4b`,
              because the form it used to sit in is gone and the button it is about is this one. */}
          {scratchUnignored === null ? null : (
            <p className="muted" data-api-scratch-unignored={scratchUnignored}>
              send writes <code>{scratchUnignored}</code>, and this project&rsquo;s <code>.gitignore</code> does not list it — add
              that line, or expect it in <code>git status</code>.
            </p>
          )}
        </div>
      ) : null}

      {/* The buffer's own line. It appears only when there is something in it, because a write
          button on a pane with nothing to write is a button that teaches you to ignore it. */}
      {problem !== null ? (
        <p className="warn" data-compose-problem>
          {problem}
        </p>
      ) : null}
      {dirty ? (
        <div className="authoring-actions" data-compose-dirty="yes">
          <button className="run" onClick={onWrite} disabled={busy} data-compose-write>
            {busy ? 'writing…' : `write ${path}`}
          </button>
          <button onClick={onDiscard} disabled={busy} data-compose-discard>
            discard
          </button>
          <span className="muted">
            these edits are not on disk — <em>Source</em> shows what <code>{path}</code> becomes
          </span>
        </div>
      ) : null}

      {/* **There is no request rail here, and that is a measurement rather than an omission.**
          §1 of the plan priced a horizontal rail of requests and rejected it — the largest file in
          the sibling holds 100 index rows — and the first draft of this pane added one anyway, as a
          convenience. The served page settled it: `tests/mixed/storefront.tflw` has 36 requests, and
          36 buttons wrapped into five rows that took the bottom third of the pane and pushed the
          card they were meant to help reach off the screen. The tree is the navigator (`D1081`). */}

      {/* **`.legacy` is gone** (`M212` `S4b`, `D1088`), on the expiry condition `D1082` wrote for
          it: it was kept because it was the only way to write a new test, and it has not been that
          since `M210` `S2`–`S6` made every clause editable and `S4a` gave the page a create.
          Measured before it went: **13 non-button fields against the request card's 14**, carrying
          placeholders from a different fictional example (`/orders/{orderId}`, *"the orders
          endpoint answers"*) — the larger of the pane's two authoring surfaces, describing a file
          that was not open. Deleted rather than hidden, because the reason to keep a thing hidden
          is that somebody still needs it, and `+ request` was the last thing anybody did. */}
    </div>
  );
}
