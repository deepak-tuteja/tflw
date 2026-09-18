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
  type MatcherName,
  type PathSegment,
  type StepPath,
  type Subject,
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
function NoteBlock({ note, what }: { readonly note: Note; readonly what: string }) {
  if (note.lines.length === 1) {
    return (
      <p className="muted note" data-note={what} data-note-lines={1}>
        {note.first}
      </p>
    );
  }
  return (
    <details className="note" data-note={what} data-note-lines={note.lines.length}>
      <summary className="muted">
        {note.first} <span className="count">+{note.lines.length - 1}</span>
      </summary>
      {/* Lines **two onward**. The summary is already the first line, and a `<details>` shows its
          summary while it is open — so joining the whole block here printed line 1 twice, which is
          what the rendered page said and the model did not. Found by reading the paint. */}
      <pre className="muted note-body">{note.lines.slice(1).join('\n')}</pre>
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
function StatementRow({ statement, door, editing, onEdit }: {
  readonly statement: OutlineStatement;
  readonly door: Lens;
  /** The row being typed into, by its own index pair. `null` while nothing is. */
  readonly editing: { readonly key: string; readonly values: ExpectEdit } | null;
  /** Where a change goes (`M210` `S3`). `null` means this pane is still read-only here, which is
   *  `S1`'s state, every door but API's, and every statement kind `S4` has not reached. */
  readonly onEdit: ((statement: OutlineStatement, next: ExpectEdit) => void) | null;
}) {
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
  const editable = !foreign && onEdit !== null && statement.kind === 'ExpectStmt' && statement.stepPath !== null;
  return (
    <li
      className={`stmt${foreign ? ' locked' : ''}`}
      data-stmt={statement.kind}
      data-stmt-line={statement.line}
      data-stmt-lens={statement.lens ?? 'none'}
      data-stmt-locked={foreign ? 'yes' : 'no'}
      data-stmt-editable={editable ? 'yes' : 'no'}
    >
      {statement.note ? <NoteBlock note={statement.note} what={`line ${statement.line}`} /> : null}
      {editable ? (
        <ExpectRow
          statement={statement}
          edit={editing !== null && editing.key === key ? editing.values : expectOf(statement.node as ExpectStmt)}
          onEdit={(next) => onEdit!(statement, next)}
        />
      ) : (
        <div className="stmt-line">
          <span className="ln muted">{statement.line}</span>
          <code className="stmt-text">{statement.text}</code>
          {foreign ? (
            <a className="badge also" href={`#/${statement.lens}`} data-stmt-door={statement.lens} title={`this is ${DOOR_BY_ID[statement.lens!].label}'s to edit — open that door`}>
              {DOOR_BY_ID[statement.lens!].label}
            </a>
          ) : null}
          {onEdit !== null && statement.kind === 'ExpectStmt' && statement.stepPath === null ? (
            <span className="muted" data-stmt-unaddressable>
              inside the block above — an index pair names a step of a body, and this is not one
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
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
 * The spec half of an assertion — what `buildExpect` takes.
 *
 * `original` is read for one thing only: a carried subject's **shape**. The builder validates the
 * quantifier against the subject it is given, so a stand-in for a quantified `body csv` path has to
 * be quantifiable too or the build refuses about a file that parses. `quantifiable()` is the
 * language's own predicate, asked rather than re-derived here.
 */
export function expectSpecOf(edit: ExpectEdit, original: ExpectStmt | null): ExpectSpec {
  const subject = ((): SubjectSpec => {
    switch (edit.subject) {
      case 'header': return { kind: 'header', name: edit.argument };
      case 'body': return { kind: 'body', path: edit.argument };
      case 'value': return { kind: 'value', ref: edit.argument };
      case 'locator': return { kind: 'locator', locator: { kind: edit.locatorKind, value: edit.argument } };
      case 'carried': return original !== null && quantifiable(original.subject) ? { kind: 'body', path: '' } : { kind: 'status' };
      default: return { kind: edit.subject };
    }
  })();
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

/** One assertion, as controls. The row the legacy form has always had, with the whole vocabulary
 *  in it and reading an assertion that already exists rather than inventing a new one. */
function ExpectRow({ statement, edit, onEdit }: {
  readonly statement: OutlineStatement;
  readonly edit: ExpectEdit;
  readonly onEdit: (next: ExpectEdit) => void;
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
        <select value={v.subject} onChange={(e) => change({ subject: e.target.value as ExpectSubjectKind })} data-expect-subject={v.subject} aria-label="subject">
          {SUBJECTS.map(([id, text]) => (
            <option key={id} value={id}>{text}</option>
          ))}
          {/* Offered only while it is what this row already says — the builder cannot construct one,
              so switching *to* it would be a control that writes nothing. */}
          {v.subject === 'carried' ? <option value="carried">{subjectSpelling(node.subject)} — kept as it is</option> : null}
        </select>
        {v.subject === 'locator' ? (
          <select value={v.locatorKind} onChange={(e) => change({ locatorKind: e.target.value as LocatorKind })} data-expect-locator-kind aria-label="element kind">
            {LOCATOR_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        ) : null}
        {v.subject === 'header' || v.subject === 'body' || v.subject === 'value' || v.subject === 'locator' ? (
          <input
            value={v.argument}
            onChange={(e) => change({ argument: e.target.value })}
            data-expect-argument
            aria-label="subject argument"
            placeholder={v.subject === 'header' ? 'content-type' : v.subject === 'value' ? 'orderId' : v.subject === 'locator' ? 'Buy' : 'items[0].price'}
          />
        ) : null}
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
function RequestCard({ request: r, door, edit, onEdit, expectEdit, onExpectEdit }: {
  readonly request: OutlineRequest;
  readonly door: Lens;
  /** The card's live values. `null` means this pane is still read-only here — `S1`'s state, and
   *  what every door but API still gets. */
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  /** The assertion row being typed into, and where a change goes (`S3`). */
  readonly expectEdit: { readonly key: string; readonly values: ExpectEdit } | null;
  readonly onExpectEdit: ((statement: OutlineStatement, next: ExpectEdit) => void) | null;
}) {
  const spec = r.spec;
  const v = edit ?? editOf(r);
  const change = onEdit === null ? null : (patch: Partial<RequestEdit>) => onEdit({ ...v, ...patch });
  return (
    <section className="request-card" data-request-line={r.line} data-request-kind={r.kind} data-request-editable={onEdit === null ? 'no' : 'yes'}>
      {r.note ? <NoteBlock note={r.note} what={`request ${r.line}`} /> : null}
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
              <StatementRow key={`${s.line}-${s.kind}`} statement={s} door={door} editing={expectEdit} onEdit={onExpectEdit} />
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
function TestBand({ decl, outline, door, expectEdit, onExpectEdit }: {
  readonly decl: OutlineHook | OutlineTest;
  readonly outline: FileOutline;
  readonly door: Lens;
  readonly expectEdit: { readonly key: string; readonly values: ExpectEdit } | null;
  readonly onExpectEdit: ((statement: OutlineStatement, next: ExpectEdit) => void) | null;
}) {
  const test: OutlineTest | null = decl.kind === 'test' ? decl : null;
  return (
    <div className="test-band" data-band-kind={decl.kind} data-band-line={decl.line}>
      {decl.note ? <NoteBlock note={decl.note} what={decl.kind === 'test' ? `test ${decl.name}` : decl.label} /> : null}
      <header className="band-head">
        <span className="band-what">{decl.kind === 'test' ? 'test' : decl.label}</span>
        {test ? <strong data-band-name={test.name}>{test.name}</strong> : <span className="muted">runs around every test in this file</span>}
        <span className="ln muted">line {decl.line}</span>
      </header>
      {test ? (
        <ul className="band-facts" data-band-facts>
          <li data-band-tags={test.tags.length}>
            tags{' '}
            {test.tags.length === 0 ? <span className="muted">none</span> : test.tags.map((t) => <span key={t} className="tag">@{t}</span>)}
          </li>
          <li data-band-sessions={test.sessions.length}>
            as {test.sessions.length === 0 ? <span className="muted">anonymous</span> : test.sessions.join(', ')}
          </li>
          <li data-band-retry={test.retry}>
            retry {test.retry === 0 ? <span className="muted">0 — the default, not a retry in use</span> : test.retry}
          </li>
          <li data-band-table={test.table === null ? 'none' : test.table.type}>
            with each{' '}
            {test.table === null ? (
              <span className="muted">none — one case</span>
            ) : test.table.type === 'InlineDataTable' ? (
              `${test.table.rows.length} row${test.table.rows.length === 1 ? '' : 's'}, ${test.table.columns.length} column${test.table.columns.length === 1 ? '' : 's'}`
            ) : (
              test.table.path.value
            )}
          </li>
          <li data-band-workload={test.workload === null ? 'none' : test.workload.type}>
            workload {test.workload === null ? <span className="muted">none — a functional test</span> : test.workload.type.replace(/Workload$/, '')}
          </li>
          <li data-band-thresholds={test.thresholds.length}>
            thresholds {test.thresholds.length === 0 ? <span className="muted">none</span> : test.thresholds.length}
          </li>
        </ul>
      ) : null}

      {decl.body.preamble.length > 0 ? (
        <div className="band-preamble" data-band-preamble={decl.body.preamble.length}>
          <h4 className="muted">before the first request</h4>
          <ul className="stmts">
            {decl.body.preamble.map((s) => (
              <StatementRow key={`${s.line}-${s.kind}`} statement={s} door={door} editing={expectEdit} onEdit={onExpectEdit} />
            ))}
          </ul>
        </div>
      ) : null}

      <FileRow outline={outline} />
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
function FileRow({ outline }: { readonly outline: FileOutline }) {
  const { imports, uses, actions, header, tail } = outline.file;
  const empty = imports.length === 0 && uses.length === 0 && actions.length === 0 && header === null;
  return (
    <div className="file-facts" data-file-facts={empty ? 'none' : 'some'}>
      {header ? <NoteBlock note={header} what="the file" /> : null}
      <ul>
        {/* Comma-separated. The first draft mapped straight to `<code>` and three import paths
            rendered as one unbroken string on the page — a list with no separator is not a list. */}
        <li data-file-imports={imports.length}>
          imports {imports.length === 0 ? <span className="muted">none</span> : <Joined items={imports.map((i) => i.path.value)} />}
        </li>
        <li data-file-uses={uses.length}>
          uses {uses.length === 0 ? <span className="muted">none</span> : <Joined items={uses.map((u) => u.path.value)} />}
        </li>
        <li data-file-actions={actions.length}>
          actions {actions.length === 0 ? <span className="muted">none</span> : <Joined items={actions.map((a) => a.name)} />}
        </li>
      </ul>
      {/* One file in the sibling's 139 ends on a note owning nothing — an idea the language cannot
          express yet. It is carried rather than dropped, because that is exactly the kind of thing
          a reader must not lose to a projection. */}
      {tail ? <NoteBlock note={tail} what="the file's last word" /> : null}
    </div>
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
  readonly expectEdit: { readonly key: string; readonly values: ExpectEdit } | null;
  readonly onExpectEdit: ((statement: OutlineStatement, next: ExpectEdit) => void) | null;
  /** Whether the buffer holds anything the file does not (`D1079`). */
  readonly dirty: boolean;
  readonly busy: boolean;
  /** Why the last change did not become bytes — a half-typed path is not yet a request, and
   *  saying so is better than a field that refuses the keystroke. */
  readonly problem: string | null;
  readonly onWrite: () => void;
  readonly onDiscard: () => void;
}

export function ComposePane({ path, outline, at, door, legacy, legacyOpen, onLegacyOpen, edit, onEdit, expectEdit, onExpectEdit, dirty, busy, problem, onWrite, onDiscard }: ComposePaneProps) {
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
          {at ? <TestBand decl={at.decl} outline={outline} door={door} expectEdit={expectEdit} onExpectEdit={onExpectEdit} /> : <FileRow outline={outline} />}

          {at?.request ? (
            <RequestCard request={at.request} door={door} edit={edit} onEdit={onEdit} expectEdit={expectEdit} onExpectEdit={onExpectEdit} />
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
