// Compose, reading (`M210` `S1`, `D1072`). The pane that writes a file, showing the file it writes.
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
// EVERY CONTROL IS DISABLED, AND THAT IS THE SLICE (`D1082`). Nothing here claims to edit, so
// nothing here can lie. `S2`–`S5` light the controls one family at a time; until then the AST→form
// direction — which did not exist in any form before this — is built and gated on its own.

import type { ReactNode } from 'react';
import type { ApiBodySpec, ApiStepSpec, ExpectSpec, SubjectSpec } from '@tflw/lang';
import {
  LOCATOR_KINDS,
  print,
  quantifiable,
  type ApiBody,
  type ExpectStmt,
  type FindingSeverity,
  type Lens,
  type LocatorKind,
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
import { isForeign, type Addressed, type FileOutline, type Note, type OutlineHook, type OutlineRequest, type OutlineStatement, type OutlineTest } from './outline';

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
function NoteOpen({ note, what, onChange }: {
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

function NoteBlock({ note, what, onNote }: {
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
function StatementRow({ statement, door, editing }: {
  readonly statement: OutlineStatement;
  readonly door: Lens;
  readonly editing: RowEditing;
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
        <button className="add-note" onClick={() => onNoting?.(key)} data-note-add={statement.line} title="a comment above this line, explaining why it is here">
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
          <ExpectRow statement={statement} edit={values.expect} onEdit={(next) => onEdit!(statement, { kind: 'expect', expect: next })} trailing={addNote} />
        ) : (
          <ScriptRow statement={statement} edit={values} onEdit={(next) => onEdit!(statement, next)} trailing={addNote} />
        )
      ) : (
        <div className="stmt-line">
          <span className="ln muted">{statement.line}</span>
          <code className="stmt-text">{statement.text}</code>
          {foreign ? (
            <a className="badge also" href={`#/${statement.lens}`} data-stmt-door={statement.lens} title={`this is ${DOOR_BY_ID[statement.lens!].label}'s to edit — open that door`}>
              {DOOR_BY_ID[statement.lens!].label}
            </a>
          ) : null}
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
function Field({ label, value, title, onChange, placeholder }: {
  readonly label: string;
  readonly value: string;
  readonly title?: string;
  /** Absent means this field is not `S2`'s to light yet — it stays disabled, which is `D1082`
   *  narrowing one family at a time rather than a pane that is half live and says nothing. */
  readonly onChange?: (next: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <label className="field" title={title} data-field={label}>
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

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

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
const MATCHERS = Object.entries(MATCHER_LABEL) as readonly (readonly [MatcherName, string])[];

/** The matchers that compare against a value. `fails` is here and its operand is optional — the
 *  one matcher in the language whose value may be present or absent (`SPEC` §6.2.2). */
const VALUE_MATCHERS: ReadonlySet<MatcherName> = new Set<MatcherName>([
  'equals', 'contains', 'matches', 'matchesSubset', 'greaterThan', 'lessThan', 'hasCount', 'hasValue', 'fails',
]);
/** The four that grade a whole subject against a rule family, and take a severity floor. */
const SCAN_MATCHERS: ReadonlySet<MatcherName> = new Set<MatcherName>([
  'hasNoA11yViolations', 'hasNoSecurityViolations', 'hasNoAuthzViolations', 'hasNoInputHandlingViolations',
]);
/** The three whose operand is a **trailing clause** rather than a value — `S3a` in `build.ts` is
 *  where the builder learned to construct them; this is the same three, spelled as fields. */
const CLAUSE_MATCHER: Partial<Record<MatcherName, 'schema' | 'file' | 'snapshot'>> = {
  matchesSchema: 'schema',
  matchesFile: 'file',
  matchesSnapshot: 'snapshot',
};
const SEVERITIES: readonly FindingSeverity[] = ['minor', 'moderate', 'serious', 'critical'];

/** The subjects a spec can spell, in the words the language uses. Eleven of the language's
 *  sixteen; the other five arrive as `carried` below. */
const SUBJECTS = [
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
function SubjectFields({ subject, argument, locatorKind, carried, onChange }: {
  readonly subject: ExpectSubjectKind;
  readonly argument: string;
  readonly locatorKind: LocatorKind;
  /** The spelling of a subject the spec cannot rebuild, or `null` when this row's subject is one it
   *  can — which is what decides whether the option is offered at all. */
  readonly carried: string | null;
  readonly onChange: (patch: { subject?: ExpectSubjectKind; argument?: string; locatorKind?: LocatorKind }) => void;
}) {
  return (
    <>
      <select value={subject} onChange={(e) => onChange({ subject: e.target.value as ExpectSubjectKind })} data-expect-subject={subject} aria-label="subject">
        {SUBJECTS.map(([id, text]) => (
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
  | { readonly kind: 'pause'; readonly min: string; readonly max: string };

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
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
function durationText(ms: number): string {
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
    default:
      return null;
  }
}

/** One statement, as controls — the row for everything that is not an assertion. */
function ScriptRow({ statement, edit, onEdit, trailing }: {
  readonly statement: OutlineStatement;
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
        <button onClick={() => onEdit({ ...edit, args: [...edit.args, '""'] })} data-call-arg-add title="one more argument for this action">
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
        <label className="not" title="`not` — the word whose absence would invert this assertion">
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
          <button onClick={() => change({ subset: [...v.subset, { name: '', value: '""' }] })} data-subset-add title="one key the response must carry with this value; the rest of the object is not compared">
            + key
          </button>
        </div>
      ) : null}
    </>
  );
}

/** A subject in its own spelling, for the one option the select cannot rebuild. */
function subjectSpelling(subject: Subject): string {
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
function RequestCard({ request: r, door, edit, onEdit, editing }: {
  readonly request: OutlineRequest;
  readonly door: Lens;
  /** The card's live values. `null` means this pane is still read-only here — `S1`'s state, and
   *  what every door but API still gets. */
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  /** Everything the rows under this card need to be editable (`S3`, `S4`). */
  readonly editing: RowEditing;
}) {
  const spec = r.spec;
  const writingNote = editing.noting !== null && editing.noting === stepKey(r.stepPath);
  const v = edit ?? editOf(r);
  const change = onEdit === null ? null : (patch: Partial<RequestEdit>) => onEdit({ ...v, ...patch });
  return (
    <section className="request-card" data-request-line={r.line} data-request-kind={r.kind} data-request-editable={onEdit === null ? 'no' : 'yes'}>
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
          <button className="add-note" onClick={() => editing.onNoting?.(stepKey(r.stepPath))} data-note-add={r.line} title="a comment above this request, explaining why it is here">
            + note
          </button>
        ) : null}
        {r.kind === 'WaitUntilApiStmt' ? (
          <span className="badge" data-request-polling="yes" title="this request is re-issued until the assertions below it pass">
            polls
          </span>
        ) : null}
      </header>

      <div className="request-fields">
        <Field label="service" value={v.service} onChange={change === null ? undefined : (service) => change({ service })} placeholder="(default)" title="the name in tflw.config of a second api service — blank is the default one" />
        <Field label="label" value={v.label} onChange={change === null ? undefined : (label) => change({ label })} placeholder="(automatic)" title="`as “…”` — the identity this request reports under; blank is the automatic one" />
        {/* **These three are drawn and not editable, and that is `S2`'s scope rather than an
            oversight.** `ApiStepSpec` has no room for them, so they are carried across an edit by
            `nodeFor` rather than rebuilt — see `RequestEdit`. A field drawn live beside two that
            are not would be worse than either, so they say so by staying disabled. */}
        <Field label="timeout" value={spec.timeoutMs === null ? '' : `${spec.timeoutMs}ms`} title="this request's own timeout, or blank for the env's — read-only until a later slice" />
        <Field
          label="redirects"
          value={spec.followRedirects ? 'followed' : 'not followed'}
          title="`without redirects` makes the 3xx itself observable. Drawn even at its default, because a field only drawn when it is unusual is invisible exactly when it matters"
        />
        <Field label="retry after" value={spec.retryAfter === null ? '' : `up to ${spec.retryAfter.max}`} title="`retry honoring “Retry-After” up to N` — this one request, not the test" />
      </div>

      <div className="headers-form" data-request-headers={v.headers.length}>
        <h4 className="muted">headers</h4>
        {v.headers.length === 0 ? (
          <p className="muted" data-request-headers-empty>
            none on this request — the env's <code>api</code> defaults and a session's token are still added at run time
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
                    <button onClick={() => change({ headers: v.headers.filter((_, j) => j !== i) })} data-header-edit-remove={i}>
                      remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {change === null ? null : (
          <button onClick={() => change({ headers: [...v.headers, { name: '', value: '' }] })} data-header-edit-add title="a header on this request alone">
            + header
          </button>
        )}
      </div>

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
                    <button onClick={() => change({ formFields: v.formFields.filter((_, j) => j !== i) })} data-body-edit-remove={i}>
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
            {r.attached.map((s) => (
              <StatementRow key={`${s.line}-${s.kind}`} statement={s} door={door} editing={editing} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** `print` emits an `InlineBody` as `body <json>`; the field holds the json. One `slice`, named,
 *  rather than a second serialiser for the one shape the printer will not emit on its own. */
function withoutKeyword(printed: string): string {
  return printed.startsWith('body ') ? printed.slice('body '.length) : printed;
}

/** A header value as the file spells it, for the read-only rendering. */
function quoted(r: OutlineRequest, i: number, fallback: string): string {
  const h = r.spec.headers[i];
  return h ? printValue(h.value) : fallback;
}

/** The body kind the card is showing — the edit's when there is one, the file's otherwise. */
function bodyKindOf(r: OutlineRequest, edit: RequestEdit | null): string {
  if (edit !== null) return edit.bodyKind;
  return r.body === null ? 'none' : r.body.type;
}

/** Any value, in the language's own spelling. Total since `M201`; a refusal is named rather than
 *  rendered as a blank, because a blank in a projection is the silence `D1076` refuses. */
function printValue(node: { readonly type: string; readonly span: unknown }): string {
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
function bodyText(body: ApiBody): string {
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
function TestBand({ decl, outline, door, editing }: {
  readonly decl: OutlineHook | OutlineTest;
  readonly outline: FileOutline;
  readonly door: Lens;
  readonly editing: RowEditing;
}) {
  const test: OutlineTest | null = decl.kind === 'test' ? decl : null;
  const key = `decl:${decl.index}`;
  const live = editing.onHeader !== null;
  const v = editing.header !== null && editing.header.key === key ? editing.header.values : headerEditOf(decl);
  const change = (patch: Partial<HeaderEdit>): void => editing.onHeader?.(decl, { ...v, ...patch });
  const writingNote = editing.noting === key;
  const what = decl.kind === 'test' ? `test ${decl.name}` : decl.label;
  return (
    <div className="test-band" data-band-kind={decl.kind} data-band-line={decl.line}>
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
          <button className="add-note" onClick={() => editing.onNoting?.(key)} data-note-add={decl.line} title="a comment above this declaration">
            + note
          </button>
        ) : null}
      </header>
      {test ? (
        <ul className="band-facts" data-band-facts>
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
              <label className="not" title="`parallel` — this test's cases may run at the same time">
                <input type="checkbox" checked={v.parallel} onChange={(e) => change({ parallel: e.target.checked })} data-band-parallel={v.parallel ? 'yes' : 'no'} />
                parallel
              </label>
            ) : null}
          </li>
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
          {live && v.tableKind === 'inline' ? <TableEditor edit={v} onChange={change} /> : null}
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
                <a className="badge also" href="#/load" data-band-workload-door title="a workload is the LOAD door's to shape — open it there">
                  LOAD
                </a>
              </>
            )}
          </li>
          <li data-band-thresholds={test.thresholds.length}>
            thresholds {test.thresholds.length === 0 && !live ? <span className="muted">none</span> : null}
            {live ? (
              <div className="thresholds" data-band-thresholds-edit={test.thresholds.length}>
                {test.thresholds.map((th, i) => (
                  <ThresholdRow
                    key={i}
                    index={i}
                    edit={editing.threshold !== null && editing.threshold.key === `th:${decl.index}:${i}` ? editing.threshold.values : thresholdEditOf(th)}
                    onEdit={(next) => editing.onThreshold?.(test, i, next)}
                  />
                ))}
                <button
                  onClick={() => editing.onThreshold?.(test, test.thresholds.length, { metric: 'duration', percentile: '95', op: 'lessThan', bound: '500', scope: '' })}
                  data-threshold-add
                  title="a bound the whole run is graded against, after it finishes"
                >
                  + threshold
                </button>
              </div>
            ) : (
              test.thresholds.length
            )}
          </li>
        </ul>
      ) : null}

      {decl.body.preamble.length > 0 ? (
        <div className="band-preamble" data-band-preamble={decl.body.preamble.length}>
          <h4 className="muted">before the first request</h4>
          <ul className="stmts">
            {decl.body.preamble.map((s) => (
              <StatementRow key={`${s.line}-${s.kind}`} statement={s} door={door} editing={editing} />
            ))}
          </ul>
        </div>
      ) : null}

      <FileRow outline={outline} editing={editing} />
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
          <button onClick={() => onChange({ rows: edit.rows.filter((_, j) => j !== r) })} data-table-row-remove={r} disabled={edit.rows.length === 1}>
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
function FileRow({ outline, editing }: { readonly outline: FileOutline; readonly editing: RowEditing }) {
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
        <button className="add-note" onClick={() => editing.onNoting?.('file')} data-note-add="file" title="a comment at the top of the file, saying what it is for">
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
      <button onClick={() => onChange(what, paths.length, what === 'import' ? './shared/helpers.tflw' : './helpers.ts')} data-file-path-add={what}>
        + {what}
      </button>
    </span>
  );
}

export interface ComposePaneProps {
  readonly path: string;
  readonly outline: FileOutline | null;
  /** What `L<line>` names — the declaration, and the request inside it (`D1080`). One resolution,
   *  so the band and the card are always showing the same test. */
  readonly at: Addressed | null;
  readonly door: Lens;
  /** The old *write a new test* form. `D1082` makes this slice read-only, and deleting the only
   *  write path the API door has for four slices is not what "read-only first" asked for — so it
   *  is kept, said to be the old surface, and dissolved by `S2`–`S5` rather than by this one. */
  readonly legacy: ReactNode;
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
  readonly legacyOpen: boolean;
  readonly onLegacyOpen: (open: boolean) => void;
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
  /** Whether the buffer holds anything the file does not (`D1079`). */
  readonly dirty: boolean;
  readonly busy: boolean;
  /** Why the last change did not become bytes — a half-typed path is not yet a request, and
   *  saying so is better than a field that refuses the keystroke. */
  readonly problem: string | null;
  readonly onWrite: () => void;
  readonly onDiscard: () => void;
}

export function ComposePane({ path, outline, at, door, legacy, legacyOpen, onLegacyOpen, edit, onEdit, editing, dirty, busy, problem, onWrite, onDiscard }: ComposePaneProps) {
  const requests = outline === null ? [] : outline.declarations.flatMap((d) => d.body.requests);
  return (
    <div className="authoring compose-pane" data-compose={outline === null ? 'reading' : at?.request ? 'request' : 'no-request'}>
      <header className="authoring-head">
        <h2>
          <code>{path}</code>
        </h2>
        {outline === null ? (
          <p className="muted" data-compose-state>
            reading {path || 'the project'}…
          </p>
        ) : (
          <p className="muted" data-compose-summary>
            {/* Written for a reader, not for the plan. A pane that explains itself by slice number is
                talking to the person who built it. */}
            {outline.declarations.length} declaration{outline.declarations.length === 1 ? '' : 's'} · {requests.length} request
            {requests.length === 1 ? '' : 's'} — this file, as it is on disk. The request and its assertions take a keystroke; the
            band above it and the other statement kinds are still read-only.
          </p>
        )}
      </header>

      {/* **The reading state replaces the READER, not the pane**, and that distinction was found on
          the served page rather than reasoned out. Returning early from this component while the
          shell re-read a file unmounted the disclosure below with everything else — so clicking a
          second file closed the form an author had half filled in, and the page gate met it as six
          timeouts on controls that were present, resolved and invisible. A pane whose furniture
          comes and goes with a fetch is a pane you cannot hold a gesture across. */}
      {outline === null ? null : (
        <>
          {at ? <TestBand decl={at.decl} outline={outline} door={door} editing={editing} /> : <FileRow outline={outline} editing={editing} />}

          {at?.request ? (
            <RequestCard request={at.request} door={door} edit={edit} onEdit={onEdit} editing={editing} />
          ) : (
            <p className="muted" data-compose-no-request>
              {requests.length === 0
                ? 'this file issues no request — every step in it belongs to another door, and the band above shows them in position'
                : at === null
                  ? 'pick a request from the tree on the left'
                  : 'this declaration issues no request of its own — its steps are in the band above, in position'}
            </p>
          )}
        </>
      )}

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

      <details
        className="legacy"
        data-compose-legacy
        open={legacyOpen}
        onToggle={(e) => onLegacyOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="muted">
          write a new test — the form that was here before this tab could read
        </summary>
        {legacy}
      </details>
    </div>
  );
}
