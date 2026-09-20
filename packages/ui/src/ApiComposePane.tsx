// **The API door's Compose pane, rebuilt** — `M214` `A1`–`A6`.
//
// `M213` closed with all four doors moving at once and the verdict on the result was *"still a lot
// of mess on compose page — I can't figure out a single thing"*. This is the round that goes one
// door at a time, and this file is the API door's.
//
// ── WHY THE OLD PANE COULD NOT BE FIXED IN PLACE ───────────────────────────────────────────────
//
// `D1086` had two halves and they are jointly unsatisfiable. *Every request in the test is drawn*
// was defended by the mutation `the-other-requests-are-not-drawn`; *API Compose fits 1.50 screens*
// was defended by `ui-appearance`'s `BAR` table. On the thirteen-request file `D1086` itself
// measures, the two together demand **thirteen requests in 1350 px — 104 px each, assertions
// included.** No design satisfies that, so the only move left was compression, and four rounds of
// compression is the pane that was rejected. **A ceiling and a completeness rule written about the
// same artefact are one decision taken twice**, and this one was taken twice in opposite
// directions. Both mutations are gone and the height bar is replaced by a property this pane can
// actually hold: *no region overflows the window* — which is true by construction below, because
// each of the three scrolls inside itself.
//
// Nothing else was restricting anything. There is no `max-width` on the app shell and **no gate
// mentions width at all**; the sidebar's 320 px is a CSS literal.
//
// ── THE THREE REGIONS (`D1110`) ────────────────────────────────────────────────────────────────
//
// **Explorer · this test's sequence · the editor with its response under it.** The explorer is the
// shell's own `Sidebar`, which has drawn the open file's declarations and their requests since
// `M210` `S1` (`D1081`) — so `D1111` is a row it already had, and what this round adds there is a
// create (`A6`). The other two are this file.
//
// The door's landing copy has promised *"like Bruno — files on disk, git-friendly, no cloud"*
// since `M203`. The pane never was that: it was one scrolling document with a file strip, a test
// band, a body sequence, a card, a prefix list and a write bar stacked down it, and a reader
// looking for one request read all six.
//
// ── WHAT IS SELECTED IS WHAT THE EDITOR DRAWS (`D1113`) ────────────────────────────────────────
//
// One rule and one region, for four kinds of thing: a request, a statement, the test, or the file.
// **This is what retires the 176 px name box without a special case.** `.band-name` had no CSS
// rule at all — it was a bare `<input>` at the user agent's default width holding a 40-character
// sentence, so `the catalogue lists what is in stock` read `the catalogue lists wh`. Given the
// editor's whole width it is a field the length of the sentence it holds.
//
// The address stays exactly what it was (`D1045`, `D1080`): `L<line>`, and nothing else. A line
// with no `L` is the **file** — which is what clicking a file in the explorer already produces,
// because `setFile` drops the focus line by design. No new grammar, no second answer to *where am
// I*.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CaptureSpec, ExpectSpec, Lens, MatcherName } from '@tflw/lang';
import type { ExpectStmt } from '@tflw/lang';
import {
  AddClause,
  CLAUSE_MATCHER,
  Field,
  FileRow,
  MATCHERS,
  METHODS,
  NoteBlock,
  NoteOpen,
  ResponsePanel,
  SCAN_MATCHERS,
  SEVERITIES,
  ScriptRow,
  SubjectFields,
  TestBand,
  VALUE_MATCHERS,
  VerdictMark,
  bodyText,
  editOf,
  statementEditOf,
  ago,
  statusTone,
  stepKey,
  subjectSpelling,
  type ExpectEdit,
  type Ran,
  type RanIndex,
  type RequestEdit,
  type RowEditing,
} from './ComposePane';
import { DOOR_BY_ID } from './doors';
import { holds, requestRemoval, statementRemoval } from './depends';
import { isForeign, type Addressed, type FileOutline, type OutlineHook, type OutlineRequest, type OutlineStatement, type OutlineTest } from './outline';
import type { Prefix } from './outline';
import { VOCABULARY, type AddGesture } from './vocabulary';
import { bodyProblem, laidOut } from './jsonview';
import { BodyText } from './Source';

/**
 * **What the address is pointing at** (`D1113`).
 *
 * Four answers from one line, resolved in the order a line can mean them: the file when there is
 * no line at all, then the declaration whose own line it is, then a request, then a statement. A
 * line that names none of those — the middle of a multi-line body, say — falls back to whatever
 * `addressed()` resolved, which is the behaviour every link written before this round relied on.
 */
export type Selected =
  | { readonly kind: 'file' }
  | { readonly kind: 'test'; readonly decl: OutlineHook | OutlineTest }
  | { readonly kind: 'request'; readonly decl: OutlineHook | OutlineTest; readonly request: OutlineRequest }
  | { readonly kind: 'statement'; readonly decl: OutlineHook | OutlineTest; readonly statement: OutlineStatement };

export function selectedAt(at: Addressed | null, line: number | null): Selected {
  if (at === null || line === null) return { kind: 'file' };
  const decl = at.decl;
  /**
   * **The declaration is a RUN of lines, not one line**, and that is what `replaceHeader` has
   * always known: `@slow` above `test "checkout" retry 2` is two lines of one header, and a `with
   * each` table is as many lines as it has rows. So the test is selected by any line from the
   * declaration's first down to its first statement — which is also what makes an `[edit]` link
   * written against a tag line land on the test rather than on the request below it.
   */
  const firstStep = Math.min(
    ...[...decl.body.preamble, ...decl.body.requests].map((x) => x.line),
    Number.POSITIVE_INFINITY,
  );
  if (line >= decl.line && line < firstStep) return { kind: 'test', decl };
  for (const r of decl.body.requests) {
    if (r.line === line) return { kind: 'request', decl, request: r };
    for (const s of r.attached) if (s.line === line) return { kind: 'statement', decl, statement: s };
  }
  for (const s of decl.body.preamble) if (s.line === line) return { kind: 'statement', decl, statement: s };
  return at.request === null ? { kind: 'test', decl } : { kind: 'request', decl, request: at.request };
}

// ── The sequence column (`D1112`) ──────────────────────────────────────────────────────────────

/**
 * **The test's whole sequence, in file order** — requests *and* `let` *and* `wait until`, numbered,
 * each of them one row and each of them selectable.
 *
 * **The interleaving is the measurement that forced this.** 101 `let`/`wait until` statements sit
 * *between* two requests across the corpus, and 617 of 760 bindings — 81% — are read later in the
 * same test. That chaining is what tflw has and Bruno and Postman do not, so a pane that drew a
 * flat list of independent requests would be throwing away the one thing worth drawing. A
 * `capture` is indented under the request it reads, because that is what it is a property of
 * (`D1073`).
 *
 * Every row is **one line high** and the column scrolls inside itself, which is how thirteen
 * requests and their thirty assertions stop being a height problem: the column is a list, and the
 * thing being worked on is in the region next door at whatever size it needs.
 */
function SeqRow({ line, selected, onLine, kind, lead, text, title, trailing, indent, statement, door, band, refusal }: {
  readonly line: number;
  readonly selected: boolean;
  readonly onLine: (line: number) => void;
  readonly kind: string;
  readonly lead: ReactNode;
  readonly text: string;
  readonly title: string;
  readonly trailing: ReactNode;
  readonly indent?: boolean;
  /** The statement this row is, when it is one — the row carries **whose** it is (`D1078`). A step
   *  from another door is drawn in position and locked, never dropped and never bucketed at the
   *  end, which is what `outline.ts` computes from the language's own `lenses.ts`. */
  readonly statement?: OutlineStatement;
  readonly door?: Lens;
  /** The declaration's own line, on the one row that IS a declaration. `.test-band` used to be a
   *  block above the card; `D1112` makes it the first row of the sequence, which is the same claim
   *  — *this is the declaration that holds everything below it* — costing one line instead of a
   *  panel. */
  readonly band?: number;
  /**
   * **The refusal this row's `✕` produced, drawn UNDER the row** (`D1117`).
   *
   * It lives here rather than beside each call site because *every* row has a `✕` and therefore
   * every row can be refused — the first draft drew the reason only under a request, so pressing
   * `✕` on a `capture` that something downstream reads did nothing visible at all: the refusal was
   * correct, silent, and indistinguishable from a broken button. Found by `A4`'s own gate, which
   * is the one thing the round had no gate for when the mutation sweep ran.
   */
  readonly refusal?: { readonly name: string; readonly line: number; readonly text: string } | null;
}) {
  const foreign = statement !== undefined && door !== undefined && isForeign(statement.lens, door);
  return (
    <li
      className={`seq-row${selected ? ' on' : ''}${indent ? ' under' : ''}${foreign ? ' locked' : ''}`}
      data-seq-row={kind}
      data-seq-line={line}
      data-seq-selected={selected ? 'yes' : 'no'}
      {...(band === undefined ? {} : { 'data-band-line': band })}
      {...(statement === undefined
        ? {}
        : { 'data-stmt': statement.kind, 'data-stmt-line': statement.line, 'data-stmt-lens': statement.lens ?? 'none', 'data-stmt-locked': foreign ? 'yes' : 'no' })}
    >
      <button type="button" className="seq-pick" onClick={() => onLine(line)} title={title} aria-pressed={selected} data-seq-pick={line} data-seq-goto={line}>
        <span className="ln muted">{line}</span>
        {lead}
        <span className="seq-text stmt-text">{text}</span>
      </button>
      {/* **A step another door owns is drawn in position and links to that door** (`D1078`). The
          door decides what may be EDITED and never what may be seen, so the row says what the step
          is and where it can be worked on — which is the one thing a reader needs from it here. */}
      {foreign && statement?.lens ? (
        <a className="badge also" href={`#/${statement.lens}`} data-stmt-door={statement.lens} title={`this is ${DOOR_BY_ID[statement.lens].label}'s to edit — open that door`}>
          {DOOR_BY_ID[statement.lens].label}
        </a>
      ) : null}
      {trailing}
      {refusal === undefined || refusal === null ? null : <Refusal held={refusal} onLine={onLine} />}
    </li>
  );
}

/** The `✕` (`D1117`) — and its refusal, **inline and not on hover**.
 *
 *  A disabled control that does not say why is the pattern this round exists to remove, so this one
 *  is never disabled: it is pressed, it answers, and the answer is a sentence on the row naming the
 *  line that is holding the thing. 81% of bindings are read downstream, so the refusal is the
 *  common case rather than the corner, and hiding the reason in a `title` would make the commonest
 *  outcome the invisible one. */
function Remove({ what, onGo, refusal, onClear }: {
  readonly what: string;
  readonly onGo: () => void;
  readonly refusal: { readonly name: string; readonly line: number; readonly text: string } | null;
  readonly onClear: () => void;
}) {
  return (
    <button type="button" className={`seq-x${refusal ? ' refused' : ''}`} onClick={refusal ? onClear : onGo} title={refusal ? 'dismiss' : `remove this ${what}`} data-seq-remove={what} aria-label={`remove this ${what}`}>
      ✕
    </button>
  );
}

function Refusal({ held, onLine }: {
  readonly held: { readonly name: string; readonly line: number; readonly text: string };
  readonly onLine: (line: number) => void;
}) {
  return (
    <p className="warn seq-refusal" data-seq-refusal={held.name}>
      <code>{held.name}</code> is still read on{' '}
      <button type="button" className="linkish" onClick={() => onLine(held.line)} data-seq-refusal-goto={held.line}>
        line {held.line}
      </button>{' '}
      — <code>{held.text}</code>. Remove that first, or change what it reads.
    </p>
  );
}

// ── The editor's four tabs (`D1115`) ───────────────────────────────────────────────────────────

const TABS = ['headers', 'body', 'assert', 'more'] as const;
export type EditorTab = (typeof TABS)[number];

const TAB_LABEL: Record<EditorTab, string> = {
  headers: 'Headers',
  body: 'Body',
  assert: 'Assert',
  more: 'More',
};

/**
 * **One assertion is subject · matcher · value · ✕** (`D1114`).
 *
 * It was seven controls: `expect`/`check`, a quantifier whose default renders as a bare em-dash, an
 * eleven-option subject, an unlabelled `not` checkbox, a twelve-option matcher, a value, and
 * `+ note`. Measured over all 1736 assertions in the corpus, the three that own the leading
 * positions are used **7 times (0.4%)**, **78 times (4.5%)** and **34 times (2.0%)** respectively —
 * and every sampled `not` is a BROWSER subject. Three controls cover 88% of rows.
 *
 * **THE VOCABULARY MOVES, IT NEVER SHRINKS**, which is `D1076` kept rather than dropped: the rare
 * three are behind a per-row `⋯`, and **a row that already uses one shows it inline**, open, with
 * no gesture required. So `check all body.items not contains "x"` draws every one of its words and
 * `expect status equals 200` draws three controls. What is never true is that a form the language
 * admits has no control anywhere on the page.
 */
function AssertRow({ statement, edit, onEdit, verdict, trailing, onRemove, refusal, onClearRefusal, onLine, drops }: {
  readonly statement: OutlineStatement;
  readonly edit: ExpectEdit;
  readonly onEdit: (next: ExpectEdit) => void;
  readonly verdict: ReactNode;
  readonly trailing: ReactNode;
  readonly onRemove: (() => void) | null;
  readonly refusal: { readonly name: string; readonly line: number; readonly text: string } | null;
  readonly onClearRefusal: () => void;
  readonly onLine: (line: number) => void;
  /** `an element` and `page` are BROWSER's — `vocabulary.ts` carries the list. */
  readonly drops: ReadonlySet<string>;
}) {
  const node = statement.node as ExpectStmt;
  const v = edit;
  const change = (patch: Partial<ExpectEdit>): void => onEdit({ ...v, ...patch });
  const clause = CLAUSE_MATCHER[v.matcher];
  const takesValue = VALUE_MATCHERS.has(v.matcher) && v.matcher !== 'matchesSubset';
  /** Already spent — so it is drawn, open, whatever the disclosure says. */
  const spent = v.soft || v.quantifier !== '' || v.negated;
  const [open, setOpen] = useState(false);
  const rare = spent || open;
  return (
    <li className="assert stmt" data-assert-line={statement.line} data-stmt={statement.kind} data-stmt-line={statement.line} data-stmt-editable="yes" data-assert-rare={rare ? 'yes' : 'no'}>
      <div className="row assert-fields" data-expect-line={statement.line}>
        <span className="ln muted">{statement.line}</span>
        <span className="assert-keyword" data-expect-kind-shown={v.soft ? 'check' : 'expect'}>
          {v.soft ? 'check' : 'expect'}
        </span>
        <SubjectFields subject={v.subject} argument={v.argument} locatorKind={v.locatorKind} carried={subjectSpelling(node.subject)} onChange={change} drops={drops} />
        <select value={v.matcher} onChange={(e) => change({ matcher: e.target.value as MatcherName })} data-expect-matcher={v.matcher} aria-label="matcher">
          {MATCHERS.map(([id, text]) => (
            <option key={id} value={id}>{text}</option>
          ))}
        </select>
        {takesValue ? (
          <input className="assert-value" value={v.operand} onChange={(e) => change({ operand: e.target.value })} data-expect-operand aria-label="operand" placeholder={v.matcher === 'fails' ? '(any failure)' : '200'} />
        ) : null}
        <button
          type="button"
          className={`assert-more${rare ? ' on' : ''}`}
          onClick={() => setOpen((x) => !x)}
          aria-expanded={rare}
          title="`check` instead of `expect`, `any`/`all`, and `not` — the three forms 96% of this corpus's assertions do not use"
          data-assert-more={rare ? 'open' : 'shut'}
        >
          ⋯
        </button>
        {verdict}
        {trailing}
        {onRemove === null ? null : <Remove what="assertion" onGo={onRemove} refusal={refusal} onClear={onClearRefusal} />}
      </div>
      {rare ? (
        <div className="row assert-rare" data-assert-rare-row>
          <select value={v.soft ? 'check' : 'expect'} onChange={(e) => change({ soft: e.target.value === 'check' })} data-expect-kind aria-label="expect or check">
            <option value="expect">expect — a failure stops this test</option>
            <option value="check">check — record it and carry on</option>
          </select>
          <select value={v.quantifier} onChange={(e) => change({ quantifier: e.target.value as ExpectEdit['quantifier'] })} data-expect-quantifier aria-label="quantifier">
            <option value="">every one of them (no quantifier)</option>
            <option value="any">any</option>
            <option value="all">all</option>
          </select>
          <label className="not" title="`not` — the word whose absence would invert this assertion">
            <input type="checkbox" checked={v.negated} onChange={(e) => change({ negated: e.target.checked })} data-expect-negated={v.negated ? 'yes' : 'no'} />
            not
          </label>
        </div>
      ) : null}
      {SCAN_MATCHERS.has(v.matcher) ? (
        <div className="row expect-extra" data-expect-extra="severity">
          <label className="muted">at or above</label>
          <select value={v.severityFloor} onChange={(e) => change({ severityFloor: e.target.value as ExpectEdit['severityFloor'] })} data-expect-severity aria-label="severity floor">
            <option value="">every severity</option>
            {SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>{sev}</option>
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
      {refusal === null ? null : <Refusal held={refusal} onLine={onLine} />}
    </li>
  );
}

// ── The pane ───────────────────────────────────────────────────────────────────────────────────

export interface ApiComposePaneProps {
  readonly path: string;
  readonly outline: FileOutline | null;
  readonly at: Addressed | null;
  /** The address's line, straight through — `selectedAt` is the only reader of it. */
  readonly focusLine: number | null;
  readonly onLine: (line: number) => void;
  /** `+ new test` at the foot of the sequence column (`D1118`). `+ new file` is the explorer's. */
  readonly onNew: ((mode: 'test' | 'file') => void) | null;
  readonly scratchUnignored: string | null;
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  readonly editing: RowEditing;
  readonly prefix: Prefix | null;
  readonly onSend: (() => void) | null;
  readonly sending: boolean;
  readonly ran: RanIndex;
  readonly onVerify: ((request: OutlineRequest, spec: ExpectSpec) => void) | null;
  readonly onCapture: ((request: OutlineRequest, specs: readonly CaptureSpec[]) => void) | null;
  readonly onAdd: ((decl: OutlineTest, key: string) => void) | null;
  readonly adds: readonly AddGesture[];
  /** `D1117` — take these steps out of this declaration. The pane runs the dependency scan and
   *  never calls this while anything is holding one of them. */
  readonly onRemoveSteps: ((decl: OutlineHook | OutlineTest, steps: readonly number[]) => void) | null;
  readonly onRemoveDecl: ((decl: OutlineHook | OutlineTest) => void) | null;
  /**
   * **Which of the editor's four tabs is open, held ABOVE this component** — `M205` `S5a`'s rule,
   * met for the sixth time in this pane's life.
   *
   * The strip does not hide a panel, it **unmounts** it, so anything remembered below one is gone
   * on a glance at Source and back. Field values survive because they are `useState` in
   * `ComposeDoor`; a tab selection kept here would not, and the author who opened `Headers`, typed
   * half a header, looked at the bytes and came back would find the pane on `Assert` with their
   * half-typed header nowhere in sight — present in the buffer, absent from the screen. Found by
   * `M210` `S2`'s own gate, which does exactly that.
   */
  readonly tab: EditorTab;
  readonly onEditorTab: (tab: EditorTab) => void;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly problem: string | null;
  readonly onWrite: () => void;
  readonly onDiscard: () => void;
  readonly door: Lens;
}

/** Where the divider sat last (`D1116`). A fraction rather than a pixel count, because the window
 *  is not the same height on the next visit, and a remembered 620 px on a 700 px window is a
 *  response with no editor above it. */
const SPLIT_KEY = 'tflw.compose.split';
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.9;

function readSplit(): number {
  try {
    const raw = window.localStorage.getItem(SPLIT_KEY);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX ? n : 0.62;
  } catch {
    // A private window, or site data blocked. The accessor itself throws in some browsers, which
    // is why this is a try and not a null check.
    return 0.62;
  }
}

export function ApiComposePane(props: ApiComposePaneProps) {
  const { path, outline, at, focusLine, onLine, onNew, scratchUnignored, edit, onEdit, editing, prefix, onSend, sending, ran, onVerify, onCapture, onAdd, adds, onRemoveSteps, onRemoveDecl, dirty, busy, problem, onWrite, onDiscard, door, tab, onEditorTab: setTab } = props;

  const selected = useMemo(() => selectedAt(at, focusLine), [at, focusLine]);
  /** Which request's verdicts and response are in hand. A statement's are its request's. */
  const forRequest: OutlineRequest | null =
    selected.kind === 'request' ? selected.request
    : selected.kind === 'statement' ? (at?.decl.body.requests.find((r) => r.attached.some((s) => s.line === selected.statement.line)) ?? null)
    : null;
  const rowRan: Ran | null = forRequest === null ? null : (ran.get(forRequest.line) ?? null);

  /** The refusal a `✕` produced, keyed by the line it was pressed on (`D1117`). */
  const [refused, setRefused] = useState<{ line: number; held: { name: string; line: number; text: string } } | null>(null);
  useEffect(() => setRefused(null), [path]);

  const remove = useCallback(
    (decl: OutlineHook | OutlineTest, at_line: number, target: { lines: number[]; steps: number[] } | null): void => {
      if (target === null || onRemoveSteps === null) return;
      const held = holds(decl.body, target.lines);
      if (held !== null) {
        setRefused({ line: at_line, held });
        return;
      }
      setRefused(null);
      onRemoveSteps(decl, target.steps);
    },
    [onRemoveSteps],
  );
  const refusalFor = (line: number): { name: string; line: number; text: string } | null => (refused !== null && refused.line === line ? refused.held : null);
  const clearRefusal = useCallback(() => setRefused(null), []);

  const [split, setSplit] = useState<number>(readSplit);
  const column = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  /** The divider. `pointermove` on the window rather than on the handle, because a pointer that
   *  leaves a 6 px strip mid-drag has not stopped dragging — the same finding `jamForge` filed
   *  about a marquee and the reason the handle captures nothing. */
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (!dragging.current || column.current === null) return;
      const box = column.current.getBoundingClientRect();
      if (box.height <= 0) return;
      const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (e.clientY - box.top) / box.height));
      setSplit(next);
    };
    const up = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      try {
        window.localStorage.setItem(SPLIT_KEY, String(split));
      } catch {
        // Nothing to do and nothing to say: a remembered split is a convenience, and a browser that
        // refuses to store one still draws the page.
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [split]);

  if (outline === null) {
    return (
      <div className="api-compose reading" data-api-compose="reading">
        <p className="muted" data-compose-state>
          reading {path || 'the project'}…
        </p>
      </div>
    );
  }

  const decl = at?.decl ?? null;
  const statements = decl === null ? [] : decl.body.preamble;

  return (
    <div className="api-compose" data-api-compose={selected.kind} data-compose={at?.request ? 'request' : 'no-request'}>
      {/* The pane's own one line: which file, and what is unsaved about it. It is a ROW and not a
          header block, because the two regions below it are what the reader came for and a header
          that explains the pane is height spent on the builder's vocabulary. */}
      <div className="api-compose-bar" data-compose-bar>
        <code className="api-compose-path" data-compose-file={path}>{path}</code>
        {/* **The head names what the body is showing** — `D1085`, kept, shrunk from a paragraph to
            a clause. It used to be four lines explaining the pane to its own builder; what a reader
            needs from it is which declaration this column is the sequence of, and how many
            declarations the file holds around it. */}
        <span className="muted" data-compose-summary data-compose-subject={at ? 'declaration' : 'file'}>
          {at ? (
            <>
              <code data-compose-subject-what>{at.decl.kind === 'test' ? `test ${at.decl.name}` : at.decl.label}</code> · line {at.decl.line} ·{' '}
              {at.decl.body.requests.length} request{at.decl.body.requests.length === 1 ? '' : 's'} —{' '}
              {outline.declarations.length === 1 ? 'the only declaration in this file' : `one of ${outline.declarations.length} declarations in this file`}
            </>
          ) : (
            <>{outline.declarations.length} declaration{outline.declarations.length === 1 ? '' : 's'} — this file declares nothing to compose yet</>
          )}
        </span>
        {problem !== null ? (
          <span className="warn" data-compose-problem>
            {problem}
          </span>
        ) : null}
        {dirty ? (
          <span className="api-compose-dirty" data-compose-dirty="yes">
            <button className="run" onClick={onWrite} disabled={busy} data-compose-write>
              {busy ? 'writing…' : 'write'}
            </button>
            <button onClick={onDiscard} disabled={busy} data-compose-discard>
              discard
            </button>
            <span className="muted">not on disk yet</span>
          </span>
        ) : null}
      </div>

      <div className="api-compose-grid">
        {/* ── region 2: the sequence (`D1112`) ─────────────────────────────────────────── */}
        <div className="seq-col" data-seq-col={decl === null ? 0 : decl.body.requests.length}>
          <ol className="seq" data-body-sequence={decl === null ? 0 : decl.body.requests.length} data-seq-rows={decl === null ? 0 : decl.body.requests.length + statements.length}>
            {decl === null ? null : (
              <SeqRow
                line={decl.line}
                kind="test"
                band={decl.line}
                selected={selected.kind === 'test'}
                onLine={onLine}
                lead={<span className="seq-kind">{decl.kind === 'test' ? 'test' : decl.label}</span>}
                text={decl.kind === 'test' ? decl.name : ''}
                title={decl.kind === 'test' ? decl.name : decl.label}
                refusal={refusalFor(decl.line)}
                trailing={
                  onRemoveDecl === null ? null : (
                    <Remove
                      what="test"
                      onGo={() => {
                        setRefused(null);
                        onRemoveDecl(decl);
                      }}
                      refusal={refusalFor(decl.line)}
                      onClear={clearRefusal}
                    />
                  )
                }
              />
            )}
            {decl === null
              ? null
              : statements.map((s) => (
                  <SeqRow
                    key={`pre-${s.line}`}
                    line={s.line}
                    kind={s.kind}
                    selected={selected.kind === 'statement' && selected.statement.line === s.line}
                    onLine={onLine}
                    lead={<span className="seq-kind">{s.kind === 'LetStmt' ? 'let' : s.kind.replace(/Stmt$/, '').toLowerCase()}</span>}
                    text={s.text.split('\n')[0] ?? ''}
                    title={s.text}
                    statement={s}
                    door={door}
                    indent
                    refusal={refusalFor(s.line)}
                    trailing={
                      onRemoveSteps === null ? null : (
                        <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
                      )
                    }
                  />
                ))}
            {decl === null
              ? null
              : decl.body.requests.map((r) => {
                  const rr = ran.get(r.line) ?? null;
                  return (
                    <li key={`req-${r.line}`} className="seq-group" data-seq-request={r.line} data-seq-method={r.method}>
                      <SeqRow
                        line={r.line}
                        kind={r.kind === 'WaitUntilApiStmt' ? 'wait' : 'request'}
                        selected={selected.kind === 'request' && selected.request.line === r.line}
                        onLine={onLine}
                        lead={
                          <>
                            <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
                            {rr === null || rr.response === null ? null : (
                              <span className={`status-code ${statusTone(rr.response.status)}`} data-seq-status={rr.response.status} title={`${rr.scope === 'send' ? 'from a send' : 'from the last run'} — ${rr.at}`}>
                                {rr.response.status}
                              </span>
                            )}
                          </>
                        }
                        text={r.path}
                        title={`${r.method} ${r.path}`}
                        refusal={refusalFor(r.line)}
                        trailing={
                          onRemoveSteps === null ? null : (
                            <Remove what="request" onGo={() => remove(decl, r.line, requestRemoval(r))} refusal={refusalFor(r.line)} onClear={clearRefusal} />
                          )
                        }
                      />
                      {r.attached.length === 0 ? null : (
                        <ol className="seq attached">
                          {r.attached.map((s) => (
                            <SeqRow
                              key={`att-${s.line}`}
                              line={s.line}
                              kind={s.kind}
                              selected={selected.kind === 'statement' && selected.statement.line === s.line}
                              onLine={onLine}
                              indent
                              lead={<span className="seq-kind">{s.kind.replace(/Stmt$/, '').toLowerCase()}</span>}
                              text={s.text.split('\n')[0] ?? ''}
                              title={s.text}
                              statement={s}
                              door={door}
                              refusal={refusalFor(s.line)}
                              trailing={
                                onRemoveSteps === null || s.stepPath === null ? null : (
                                  <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
                                )
                              }
                            />
                          ))}
                        </ol>
                      )}
                    </li>
                  );
                })}
            {statements.length === 0 && (decl === null || decl.body.requests.length === 0) ? (
              <li className="muted seq-empty" data-seq-empty>
                {decl === null ? 'this file declares nothing yet' : 'nothing runs in this test yet — add a request below'}
              </li>
            ) : null}
          </ol>

          {/* `D1118` — creation where the thing is created. `+ request` / `+ let` / `+ wait until`
              belong to the sequence, so they are at the foot of it; `+ new test` makes another of
              the thing the column's first row is, so it is here too. `+ new file` is in the
              explorer, where files are. The Compose head stops being a toolbar. */}
          <div className="seq-foot" data-seq-foot>
            {/* A hook has no name for the splice to address, which is a fact about the language
                rather than a limit of this door — so the column says so where the buttons would be,
                rather than drawing nothing and leaving a reader to guess. */}
            {onAdd !== null && decl !== null && decl.kind !== 'test' ? (
              <span className="muted" data-seq-add-hook>
                a request cannot be added to a hook from here — the splice names a test by name, and a hook has none
              </span>
            ) : null}
            {onAdd === null || decl === null || decl.kind !== 'test'
              ? null
              : adds.map((a) => (
                  <button key={a.key} type="button" className="seq-add" onClick={() => onAdd(decl, a.key)} data-seq-add={a.key} data-seq-add-line={decl.line} title={a.title}>
                    {a.label}
                  </button>
                ))}
            {onNew === null ? null : (
              <button type="button" className="seq-add new" onClick={() => onNew('test')} data-compose-new-test title="another test in this file">
                + new test
              </button>
            )}
          </div>
        </div>

        {/* ── region 3: the editor, and the response under it (`D1113`, `D1116`) ───────── */}
        {/* **`data-seq-open` is still the open request's line**, and that it survived the rebuild is
            the point rather than a convenience: *which request is open* is a real fact about the
            pane, and `M214` moved where the card is drawn without changing what is open. It is on
            the whole column because the response belongs to the same request as the editor above
            it (`D1116`) — which is the arrangement the divider exists for. */}
        <div
          className="editor-col"
          ref={column}
          data-editor-col={selected.kind}
          data-seq-open={selected.kind === 'request' ? selected.request.line : undefined}
          style={{ gridTemplateRows: `${(split * 100).toFixed(2)}% 6px 1fr` }}
        >
          <div className="editor" data-editor={selected.kind}>
            {selected.kind === 'file' ? (
              <div className="editor-body" data-editor-file={path}>
                <header className="editor-head">
                  <code data-compose-file-head={path}>{path}</code>
                </header>
                <FileRow outline={outline} editing={editing} />
                {/* **This is the state an explorer click lands in** (`D1113`): clicking a file
                    drops the focus line, and a line is what names anything smaller than a file. So
                    the editor is the file's own fields, and the way on is the column beside it —
                    said once, here, rather than left as a region a reader has to guess about. */}
                <p className="muted" data-compose-file-next>
                  {outline.declarations.length === 0
                    ? 'this file declares nothing yet — `+ new test` below the sequence starts one'
                    : 'pick a row in the sequence to work on it — a request, a binding, or the test itself'}
                </p>
              </div>
            ) : selected.kind === 'test' ? (
              <TestBand decl={selected.decl} door={door} editing={editing} />
            ) : selected.kind === 'statement' ? (
              <StatementEditor statement={selected.statement} door={door} editing={editing} ran={rowRan} onLine={onLine} onRemove={onRemoveSteps === null ? null : () => remove(selected.decl, selected.statement.line, statementRemoval(selected.statement))} refusal={refusalFor(selected.statement.line)} onClearRefusal={clearRefusal} />
            ) : (
              <RequestEditor
                request={selected.request}
                door={door}
                tab={tab}
                onTab={setTab}
                edit={edit}
                onEdit={onEdit}
                editing={editing}
                ran={rowRan}
                onLine={onLine}
                onRemoveStatement={onRemoveSteps === null ? null : (s) => remove(selected.decl, s.line, statementRemoval(s))}
                refusalFor={refusalFor}
                onClearRefusal={clearRefusal}
              />
            )}
          </div>

          {/* The divider (`D1116`). A `separator` with an `aria-orientation`, because it is a real
              control: the keyboard moves it too, which a `<div>` with a pointer handler cannot. */}
          <div
            className="split"
            role="separator"
            aria-orientation="horizontal"
            aria-label="how much of this column the response gets"
            tabIndex={0}
            data-compose-split={split.toFixed(2)}
            onPointerDown={() => {
              dragging.current = true;
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              const next = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split + (e.key === 'ArrowDown' ? 0.05 : -0.05)));
              setSplit(next);
              try {
                window.localStorage.setItem(SPLIT_KEY, String(next));
              } catch {
                /* see the drag handler */
              }
            }}
          />

          <div className="responsebox" data-compose-responsebox={rowRan?.response ? 'yes' : 'no'}>
            {/* **Ticking a value writes into the Assert tab directly above it** (`D1116`), which is
                the whole reason the response is in this column rather than beside it: `M213` `S2`'s
                tick-to-assert put the value and the assertion it produces on two different screens. */}
            {rowRan !== null && rowRan.response !== null && forRequest !== null ? (
              <>
                {/* **`D1109`'s chip is retired and its sentence is not.** The chip existed because a
                    response drawn open on every request put the old pane over its height bar — a
                    problem the three regions do not have, since the response has a region of its
                    own that scrolls inside itself. What the chip carried and this keeps is `D956`:
                    *from the last run* and *from this send* are different evidence and are told
                    apart, rather than both being rendered as "the response". */}
                <header
                  className="response-head-bar"
                  data-compose-response={rowRan.response.status}
                  data-compose-response-scope={rowRan.scope}
                  title={`${rowRan.response.method} ${rowRan.response.url} — ${rowRan.at}`}
                >
                  <span className={`status-code ${statusTone(rowRan.response.status)}`} data-compose-response-status={rowRan.response.status}>
                    {rowRan.response.status}
                  </span>{' '}
                  <span className="muted" data-compose-response-when>
                    {rowRan.scope === 'send' ? 'from this send' : 'from the last run'}, {ago(rowRan.at, Date.now())}
                  </span>
                </header>
              <ResponsePanel
                ran={rowRan}
                open
                onVerify={
                  onVerify === null
                    ? null
                    : (spec) => {
                        setTab('assert');
                        onVerify(forRequest, spec);
                      }
                }
                onCapture={onCapture === null ? null : (specs) => onCapture(forRequest, specs)}
              />
              </>
            ) : (
              <div className="response-none">
                {prefix !== null && onSend !== null ? (
                  <div className="prefix" data-prefix={prefix.requests.length}>
                    <button className="run" onClick={onSend} disabled={sending || busy} data-compose-send>
                      {sending ? 'sending…' : `send — ${prefix.requests.length} request${prefix.requests.length === 1 ? '' : 's'}`}
                    </button>
                    <p className="muted">
                      nothing has run this request. Send fires these for real, in this order, against the env the strip names — the last one
                      is the request above. <strong>It does not check the assertions</strong>: it shows you what came back. Run the test from
                      the Run tab to grade it.
                    </p>
                    <ol className="prefix-list">
                      {prefix.requests.map((r, i) => (
                        <li key={i} data-prefix-request={i}>
                          <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span> <code>{r.path}</code> <span className="muted">{r.where}</span>
                        </li>
                      ))}
                    </ol>
                    {scratchUnignored === null ? null : (
                      <p className="muted" data-api-scratch-unignored={scratchUnignored}>
                        send writes <code>{scratchUnignored}</code>, and this project&rsquo;s <code>.gitignore</code> does not list it — add that line,
                        or expect it in <code>git status</code>.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="muted">pick a request to see what came back</p>
                )}
              </div>
            )}
          </div>

          {/* Send, once a response is already showing — the button has to stay reachable, and the
              prefix list above is what it costs, so it is a line rather than a block.

              **It is drawn on every tab, which was asked about and refused** (`D1123`). This lives
              in the response region, not in the tab strip: `D1116` put the response under the
              editor so ticking a value writes into the Assert tab directly above it, which makes
              Assert the tab whose workflow needs a send most — and a control that appears and
              vanishes as the tab changes is the flicker the three regions were built to remove. */}
          {rowRan?.response && prefix !== null && onSend !== null ? (
            <div className="editor-send" data-compose-send-row>
              <button className="run" onClick={onSend} disabled={sending || busy} data-compose-send>
                {sending ? 'sending…' : `send — ${prefix.requests.length} request${prefix.requests.length === 1 ? '' : 's'}`}
              </button>
              <span className="muted">{prefix.requests.map((r) => `${r.method} ${r.path}`).join(' → ')} — no assertions checked</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The JSON body, written into a coloured field (`M215` `B2`/`B3`, `D1121`, `D1122`).
 *
 * **A `<textarea>` cannot be coloured, so the colour is a `<pre>` under it and the text on top is
 * transparent.** That arrangement has one classic failure — the two boxes disagreeing about where a
 * character sits — and it is removed here rather than tuned: the `<pre>` is the element **in flow**
 * and the textarea is absolutely positioned over it, so the height is the coloured copy's by
 * construction, neither box ever scrolls, and one CSS rule sets the font, padding, border and
 * wrapping for both. What is left to get wrong is a font difference, which `.codearea > *` makes
 * unstateable.
 *
 * **The check is the language's, on every keystroke, and it is the same one the write does.** Until
 * now a body that could not be read was refused at write time by `buildApiStep`, as a sentence with
 * no position, after the author had typed three more fields. `bodyProblem` asks the same grammar
 * the same question as you type and keeps the span, so the answer arrives where the mistake is.
 *
 * **`format` lays the body out; the file still gets one line, and that is not a bug to hide.** A
 * body is a value, `print` writes a value on one line, and every edit in this pane goes back
 * through `buildApiStep` + `print` — so the layout is a reading aid for as long as the request is
 * open, and the bytes on disk stay canonical. The button says so. What the same round *did* change
 * is the other direction: a pasted, pretty-printed body is now accepted rather than refused
 * (`D1120`), which is the gesture this button exists to make survivable.
 */
function BodyEdit({ text, onText }: { readonly text: string; readonly onText: (text: string) => void }) {
  const problem = useMemo(() => bodyProblem(text), [text]);
  const pretty = useMemo(() => laidOut(text), [text]);
  return (
    <div className="bodyedit" data-body-problem={problem === null ? 'none' : problem.code}>
      <div className="codearea">
        {/* The coloured copy is in flow and sets the box; `aria-hidden` because the textarea over it
            is the thing a screen reader should read, and the two carry identical text. */}
        <pre className="codearea-ink" aria-hidden="true" data-body-ink>
          <BodyText text={text} problem={problem} />
          {'\n'}
        </pre>
        <textarea
          className="codearea-edit"
          value={text}
          onChange={(e) => onText(e.target.value)}
          spellCheck={false}
          data-body-edit-text
          aria-label="body"
          aria-invalid={problem !== null}
        />
      </div>
      <div className="bodyedit-foot">
        <button
          type="button"
          onClick={() => { if (pretty !== null) onText(pretty); }}
          disabled={pretty === null}
          data-body-format
          title={
            pretty === null
              ? 'this body is already laid out, or is not an object or a list'
              : 'lay this body out across lines — the file still writes it on one, because a value is one line to the printer'
          }
        >
          format
        </button>
        {problem === null ? (
          <span className="muted" data-body-ok>reads cleanly</span>
        ) : (
          <span className="warn" data-body-problem-text>
            {problem.code} — {problem.message}
          </span>
        )}
      </div>
    </div>
  );
}

/** One statement, drawn in the editor because the address names it (`D1113`). The row itself is
 *  `ScriptRow`'s — the controls for a `let`, a `capture`, a `log`, a `call`, a `give`, a `pause` —
 *  reused rather than re-derived, because what changed this round is *where* an editor is, never
 *  what a `let` is made of. */
function StatementEditor({ statement, door, editing, ran, onLine, onRemove, refusal, onClearRefusal }: {
  readonly statement: OutlineStatement;
  readonly door: Lens;
  readonly editing: RowEditing;
  readonly ran: Ran | null;
  readonly onLine: (line: number) => void;
  readonly onRemove: (() => void) | null;
  readonly refusal: { readonly name: string; readonly line: number; readonly text: string } | null;
  readonly onClearRefusal: () => void;
}) {
  const { row, onRow: onEdit, onNote, noting, onNoting } = editing;
  const foreign = isForeign(statement.lens, door);
  const key = stepKey(statement.stepPath);
  const own = statement.stepPath === null || onEdit === null || foreign ? null : statementEditOf(statement.node);
  const values = row !== null && row.key === key ? row.values : own;
  const writingNote = noting !== null && noting === key;
  const verdict = ran?.steps.get(statement.line) ?? null;

  return (
    <div className="editor-body" data-editor-statement={statement.kind} data-editor-line={statement.line}>
      <header className="editor-head">
        <span className="seq-kind">{statement.kind.replace(/Stmt$/, '').toLowerCase()}</span>
        <span className="ln muted">line {statement.line}</span>
        <VerdictMark verdict={verdict} />
        {onRemove === null ? null : <Remove what="statement" onGo={onRemove} refusal={refusal} onClear={onClearRefusal} />}
      </header>
      {refusal === null ? null : <Refusal held={refusal} onLine={onLine} />}
      {writingNote ? (
        <NoteOpen note={statement.note} what={`line ${statement.line}`} onChange={(lines) => onNote?.({ on: 'step', path: statement.stepPath! }, lines)} />
      ) : statement.note ? (
        <NoteBlock note={statement.note} what={`line ${statement.line}`} onNote={onEdit !== null && onNote !== null && statement.stepPath !== null ? (lines) => onNote({ on: 'step', path: statement.stepPath! }, lines) : undefined} />
      ) : onNote !== null && statement.stepPath !== null && !foreign ? (
        <button className="add-note" onClick={() => onNoting?.(key)} data-note-add={statement.line} title="a comment above this line, explaining why it is here">
          + note
        </button>
      ) : null}
      {values !== null && onEdit !== null && statement.stepPath !== null ? (
        values.kind === 'expect' ? (
          <ul className="asserts stmts">
            <AssertRow
              statement={statement}
              edit={values.expect}
              onEdit={(next) => onEdit(statement, { kind: 'expect', expect: next })}
              verdict={<VerdictMark verdict={verdict} />}
              trailing={null}
              onRemove={onRemove}
              refusal={refusal}
              onClearRefusal={onClearRefusal}
              onLine={onLine}
              drops={VOCABULARY[door].dropsSubjects}
            />
          </ul>
        ) : (
          <ScriptRow statement={statement} edit={values} onEdit={(next) => onEdit(statement, next)} trailing={null} pick={editing.pick} />
        )
      ) : (
        <div className="stmt-line">
          <code className="stmt-text">{statement.text}</code>
          <p className="muted">
            {foreign
              ? 'this statement belongs to another door — open that door to edit it'
              : 'this one is inside the block above; an index pair names a step of a body, and this is not one'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * **The request, in four tabs** (`D1115`) — Headers · Body · Assert · More.
 *
 * The method and the path are outside the tabs and always drawn, because they are the request: a
 * pane where you have to pick a tab to see what is being fetched is a pane that hides its subject.
 * Everything else is one of four, and **More costs one word at rest** — which is what the old
 * card's *"+ add to this request"* disclosure was trying to buy with three disabled rows and 240
 * characters of apology repeated on 1058 requests.
 *
 * `Assert` is the default tab and that is a measurement, not a preference: every request in the
 * corpus that is worth anything carries assertions and 63% of all 1736 of them are about `status`,
 * while `timeout`, `without redirects` and `retry after` together are used five times in a
 * thousand requests.
 */
function RequestEditor({ request: r, door, tab, onTab, edit, onEdit, editing, ran, onLine, onRemoveStatement, refusalFor, onClearRefusal }: {
  readonly request: OutlineRequest;
  readonly door: Lens;
  readonly tab: EditorTab;
  readonly onTab: (tab: EditorTab) => void;
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  readonly editing: RowEditing;
  readonly ran: Ran | null;
  readonly onLine: (line: number) => void;
  readonly onRemoveStatement: ((statement: OutlineStatement) => void) | null;
  readonly refusalFor: (line: number) => { name: string; line: number; text: string } | null;
  readonly onClearRefusal: () => void;
}) {
  const v = edit ?? editOf(r);
  const change = onEdit === null ? null : (patch: Partial<RequestEdit>) => onEdit({ ...v, ...patch });
  const writingNote = editing.noting !== null && editing.noting === stepKey(r.stepPath);
  /** Which clauses the More tab draws. A clause the file states is always there; one it does not is
   *  added from the menu — `D1084` unchanged, and now with nothing locked in it. */
  const [added, setAdded] = useState<readonly string[]>([]);
  const shows = (clause: string): boolean => {
    switch (clause) {
      case 'service': return v.service !== '' || added.includes(clause);
      case 'label': return v.label !== '' || added.includes(clause);
      case 'timeout': return v.timeout !== '' || added.includes(clause);
      case 'redirects': return !v.redirects || added.includes(clause);
      case 'retryAfter': return v.retryAfter !== '' || added.includes(clause);
      default: return added.includes(clause);
    }
  };
  const counts: Record<EditorTab, number> = {
    headers: v.headers.length,
    body: v.bodyKind === 'none' ? 0 : 1,
    assert: r.attached.length,
    more: ['service', 'label', 'timeout', 'redirects', 'retryAfter'].filter(shows).length,
  };

  return (
    <div className="editor-body request-card" data-request-line={r.line} data-request-kind={r.kind} data-request-editable={onEdit === null ? 'no' : 'yes'} data-request-drawn={(counts.headers > 0 ? 1 : 0) + counts.body + counts.more}>
      {writingNote ? (
        <NoteOpen note={r.note} what={`request ${r.line}`} onChange={(lines) => editing.onNote?.({ on: 'step', path: r.stepPath }, lines)} />
      ) : r.note ? (
        <NoteBlock note={r.note} what={`request ${r.line}`} onNote={editing.onNote === null ? undefined : (lines) => editing.onNote!({ on: 'step', path: r.stepPath }, lines)} />
      ) : null}

      <header className="editor-head request-head">
        {change === null ? (
          <span className={`method m-${v.method.toLowerCase()}`} data-request-method={v.method}>{v.method}</span>
        ) : (
          <select className={`method m-${v.method.toLowerCase()}`} value={v.method} onChange={(e) => change({ method: e.target.value as RequestEdit['method'] })} data-request-method={v.method} aria-label="method">
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        {change === null ? (
          <code className="request-path" data-request-path={v.path}>{v.path}</code>
        ) : (
          <input className="request-path" value={v.path} onChange={(e) => change({ path: e.target.value })} data-request-path={v.path} aria-label="path" placeholder="/orders/{orderId}" />
        )}
        <span className="ln muted">line {r.line}</span>
        {r.kind === 'WaitUntilApiStmt' ? (
          <span className="badge" data-request-polling="yes" title="this request is re-issued until the assertions below it pass">
            polls
          </span>
        ) : null}
        {editing.onNote !== null && r.note === null && !writingNote ? (
          <button className="add-note" onClick={() => editing.onNoting?.(stepKey(r.stepPath))} data-note-add={r.line} title="a comment above this request, explaining why it is here">
            + note
          </button>
        ) : null}
      </header>

      <div className="editor-tabs" role="tablist" data-editor-tabs={tab}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`editor-tab${tab === t ? ' on' : ''}`}
            onClick={() => onTab(t)}
            data-editor-tab={t}
            data-editor-tab-count={counts[t]}
          >
            {TAB_LABEL[t]}
            {counts[t] > 0 ? <span className="tab-count">{counts[t]}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'headers' ? (
        <div className="tabpane headers-form" data-request-headers={v.headers.length}>
          {v.headers.length === 0 ? (
            <p className="muted" data-request-headers-empty>
              none on this request alone — the env&rsquo;s <code>api</code> defaults and a session&rsquo;s token are still added at run time
            </p>
          ) : (
            <ul>
              {v.headers.map((h, i) => (
                <li key={i} className="row" data-request-header={h.name}>
                  {change === null ? (
                    <>
                      <code>{h.name}</code>
                      <code className="muted" data-request-header-value={h.name}>{h.value}</code>
                    </>
                  ) : (
                    <>
                      <input value={h.name} onChange={(e) => change({ headers: v.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-header-edit-name={i} aria-label="header name" />
                      <input value={h.value} onChange={(e) => change({ headers: v.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} data-header-edit-value={i} aria-label="header value" />
                      <button className="seq-x" onClick={() => change({ headers: v.headers.filter((_, j) => j !== i) })} data-header-edit-remove={i} aria-label="remove this header">
                        ✕
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
      ) : null}

      {tab === 'body' ? (
        <div className="tabpane body-form" data-request-body={v.bodyKind}>
          {change === null ? (
            r.body === null ? <p className="muted">no body</p> : <pre className="preview body-preview" data-request-body-text><BodyText text={laidOut(bodyText(r.body)) ?? bodyText(r.body)} problem={null} /></pre>
          ) : (
            <>
              <select value={v.bodyKind} onChange={(e) => change({ bodyKind: e.target.value as RequestEdit['bodyKind'] })} data-body-edit-kind aria-label="body kind">
                <option value="none">none</option>
                <option value="json">JSON</option>
                <option value="text">raw text</option>
                <option value="file">from a file</option>
                <option value="form">form fields</option>
                {/* Offered only when it is already what this request sends, and never as something
                    to switch *to*: `ApiBodySpec` cannot construct a multipart upload, so the card
                    shows it, keeps it, and says so. Twelve requests in the sibling carry one. */}
                {v.bodyKind === 'upload' ? <option value="upload">upload (multipart) — kept as written</option> : null}
              </select>
              {v.bodyKind === 'upload' && r.body !== null ? <pre className="preview body-preview" data-request-body-text><BodyText text={bodyText(r.body)} problem={null} /></pre> : null}
              {v.bodyKind === 'json' ? <BodyEdit text={v.bodyText} onText={(bodyText) => change({ bodyText })} /> : null}
              {v.bodyKind === 'text' || v.bodyKind === 'file' ? (
                <textarea value={v.bodyText} onChange={(e) => change({ bodyText: e.target.value })} data-body-edit-text rows={8} aria-label="body" />
              ) : null}
              {v.bodyKind === 'form' ? (
                <div className="fields" data-body-edit-fields={v.formFields.length}>
                  {v.formFields.map((f, i) => (
                    <div className="row" key={i}>
                      <input value={f.name} onChange={(e) => change({ formFields: v.formFields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} data-body-edit-key={i} aria-label="field name" />
                      <input value={f.value} onChange={(e) => change({ formFields: v.formFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} data-body-edit-value={i} aria-label="field value" />
                      <button className="seq-x" onClick={() => change({ formFields: v.formFields.filter((_, j) => j !== i) })} data-body-edit-remove={i} aria-label="remove this field">
                        ✕
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

      {tab === 'assert' ? (
        <div className="tabpane assert-pane" data-request-attached={r.attached.length}>
          {r.attached.length === 0 ? (
            <p className="warn" data-request-attached-empty>
              nothing reads this response. An <code>api</code> step with no assertion can never fail — tick a value in the response below to
              write one.
            </p>
          ) : (
            <ul className="asserts stmts">
              {r.attached.map((s) => {
                const key = stepKey(s.stepPath);
                const own = s.stepPath === null || editing.onRow === null || isForeign(s.lens, door) ? null : statementEditOf(s.node);
                const values = editing.row !== null && editing.row.key === key ? editing.row.values : own;
                const verdict = <VerdictMark verdict={ran?.steps.get(s.line) ?? null} />;
                const removeThis = onRemoveStatement === null || s.stepPath === null ? null : () => onRemoveStatement(s);
                if (values !== null && values.kind === 'expect' && editing.onRow !== null) {
                  return (
                    <AssertRow
                      key={s.line}
                      statement={s}
                      edit={values.expect}
                      onEdit={(next) => editing.onRow!(s, { kind: 'expect', expect: next })}
                      verdict={verdict}
                      trailing={null}
                      onRemove={removeThis}
                      refusal={refusalFor(s.line)}
                      onClearRefusal={onClearRefusal}
                      onLine={onLine}
                      drops={VOCABULARY[door].dropsSubjects}
                    />
                  );
                }
                const editable = values !== null && editing.onRow !== null && s.stepPath !== null;
                return (
                  <li
                    key={s.line}
                    className={`assert other stmt${isForeign(s.lens, door) ? ' locked' : ''}`}
                    data-assert-line={s.line}
                    data-stmt={s.kind}
                    data-stmt-line={s.line}
                    data-stmt-lens={s.lens ?? 'none'}
                    data-stmt-editable={editable ? 'yes' : 'no'}
                  >
                    <div className="row">
                      <span className="ln muted">{s.line}</span>
                      {editable && values.kind !== 'expect' ? (
                        <ScriptRow statement={s} edit={values} onEdit={(next) => editing.onRow!(s, next)} trailing={verdict} pick={editing.pick} />
                      ) : (
                        <>
                          <code className="stmt-text">{s.text.split('\n')[0]}</code>
                          {verdict}
                          {/* **The one population no index pair can name** — the expects nested
                              inside a `wait until api` block, which are not in the body's own step
                              list. They are drawn in position and say why, which is `D1078`'s rule
                              one level down: a reader may always see what a reader may not edit. */}
                          {s.stepPath === null && editing.onRow !== null ? (
                            <span className="muted" data-stmt-unaddressable>
                              inside the block above — an index pair names a step of a body, and this is not one
                            </span>
                          ) : null}
                        </>
                      )}
                      {removeThis === null ? null : <Remove what="statement" onGo={removeThis} refusal={refusalFor(s.line)} onClear={onClearRefusal} />}
                    </div>
                    {refusalFor(s.line) === null ? null : <Refusal held={refusalFor(s.line)!} onLine={onLine} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'more' ? (
        <div className="tabpane more-form" data-request-more={counts.more} data-request-fields={['service', 'label', 'timeout', 'redirects', 'retryAfter'].filter(shows).join(',')}>
          {/* **Every one of these is a live field now** (`D1115`, `A2`). Three of them used to be
              drawn disabled with *"the request spec has no room for it yet"* under each — a
              sentence about `ApiStepSpec` that read as a sentence about the language, repeated on
              all 1058 requests. `ApiRequestSpec` has carried the fields since the enterprise arc. */}
          {shows('service') ? (
            <Field label="service" value={v.service} onChange={change === null ? undefined : (service) => change({ service })} placeholder="(the default api)" title="the name in tflw.config of a second api service — blank is the default one" />
          ) : null}
          {shows('label') ? (
            <Field label="label" value={v.label} onChange={change === null ? undefined : (label) => change({ label })} placeholder="(automatic)" title="`as “…”` — the identity this request reports under; blank is the automatic one" />
          ) : null}
          {shows('timeout') ? (
            <Field label="timeout" value={v.timeout} onChange={change === null ? undefined : (timeout) => change({ timeout })} placeholder="(the env's)" title="this request's own timeout — `30s`, `500ms`, `2m`; blank is the env's" />
          ) : null}
          {shows('redirects') ? (
            <label className="field tick" data-field="redirects">
              redirects
              <input type="checkbox" checked={v.redirects} disabled={change === null} onChange={(e) => change?.({ redirects: e.target.checked })} data-field-value="redirects" />
              <span className="muted">{v.redirects ? 'followed' : '`without redirects` — the 3xx itself is observable'}</span>
            </label>
          ) : null}
          {shows('retryAfter') ? (
            <Field label="retry after" value={v.retryAfter} onChange={change === null ? undefined : (retryAfter) => change({ retryAfter })} placeholder="(not written)" title="`retry honoring “Retry-After” up to N` — this one request, not the test" />
          ) : null}
          {change === null ? null : (
            <AddClause
              what="request"
              options={[
                { key: 'service', label: 'service', title: 'a second api service from tflw.config' },
                { key: 'label', label: 'label', title: '`as “…”` — the identity this request reports under' },
                { key: 'timeout', label: 'timeout', title: "this request's own timeout, or the env's" },
                { key: 'redirects', label: 'redirects', title: '`without redirects` makes the 3xx itself observable' },
                { key: 'retryAfter', label: 'retry after', title: '`retry honoring “Retry-After” up to N`' },
              ].map((c) => ({ ...c, state: shows(c.key) ? ('present' as const) : ('addable' as const) }))}
              onAdd={(k) => setAdded((prev) => (prev.includes(k) ? prev : [...prev, k]))}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
