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
// From `M203` until the copy was removed (`M233` §7) the door's landing surface named another tool
// to say what this pane would feel like. The pane never was that: it was one scrolling document with a file strip, a test band,
// a body sequence, a card, a prefix list and a write bar stacked down it, and a reader looking for
// one request read all six. The copy is gone — a door says what work it is for, and a comparison to
// a tool the reader may not have used is not that — but the gap it described is what this pane was
// built to close, so the paragraph stays.
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
import { PlanPanel } from './PlanPanel';
import { workloadEditOf, workloadSeconds } from './workloadEdit';
import { menuTrigger, type MenuItem, type MenuRequest, type MenuTrigger } from './ContextMenu';
import type { CaptureSpec, ExpectSpec, Lens, MatcherName, Workload } from '@tflw/lang';
import { requestRefusal, requestWithout } from './clauses';
import { COMPOSE, Grip, storedSize } from './Grip';
import type { ExpectStmt } from '@tflw/lang';
import { MATCHER_LENS, lensesOfTest, matcherSubjectRefusal } from '@tflw/lang';
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
  SUBJECT_NODE,
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
  rowKey,
  stepKey,
  subjectSpelling,
  type ExpectEdit,
  type Ran,
  type RanIndex,
  type RequestEdit,
  type RowEditing,
} from './parts';
import { DOOR_BY_ID } from './doors';
import { SessionPanel, type Session, type SessionLine } from './SessionPanel';
import { holds, requestRemoval, statementRemoval } from './depends';
import { isForeign, phaseOf, requestsOf, statementsOf, type Addressed, type FileOutline, type OutlineCrawl, type OutlineHook, type OutlineRequest, type OutlineSession, type OutlineStatement, type OutlineTest } from './outline';
import type { Prefix, SendForm } from './outline';
import { VOCABULARY, type AddGesture } from './vocabulary';
import { groupFor } from './ran';
import { bodyProblem, laidOut } from './jsonview';
import { BodyText } from './Source';
import { ScanPanel, type Authorization } from './ScanPanel';

/**
 * **What the address is pointing at** (`D1113`).
 *
 * Four answers from one line, resolved in the order a line can mean them: the file when there is
 * no line at all, then the declaration whose own line it is, then a request, then a statement. A
 * line that names none of those — the middle of a multi-line body, say — falls back to whatever
 * `addressed()` resolved, which is the behaviour every link written before this round relied on.
 */
/** The declaration an address can land on — `M228` `C` (`D1238`) added the third. `'test'` is
 *  still the name of the *position* (the declaration's own run of lines, header and all) rather
 *  than of the kind under it, which is what it has always meant here. */
export type SelectedDecl = OutlineHook | OutlineTest | OutlineCrawl;

export type Selected =
  | { readonly kind: 'file' }
  | { readonly kind: 'test'; readonly decl: SelectedDecl }
  | { readonly kind: 'request'; readonly decl: SelectedDecl; readonly request: OutlineRequest }
  | { readonly kind: 'statement'; readonly decl: SelectedDecl; readonly statement: OutlineStatement };

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
  /* **Every row the column draws, not just the setup phase's** (`M219` `B`). A statement inside a
     session is addressed exactly as one outside it — the fold changed where it is drawn and not
     what it is — so this asks the outline for the flat lists rather than walking the shape again. */
  const rows = statementsOf(decl.body);
  const requests = requestsOf(decl.body);
  const firstStep = Math.min(...[...rows, ...requests].map((x) => x.line), Number.POSITIVE_INFINITY);
  if (line >= decl.line && line < firstStep) return { kind: 'test', decl };
  for (const r of requests) if (r.line === line) return { kind: 'request', decl, request: r };
  for (const s of rows) if (s.line === line) return { kind: 'statement', decl, statement: s };
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
/** The word a statement's chip carries. One spelling, because `afterLead` strips exactly what the
 *  chip shows — two copies of this expression is how a chip and its strip drift apart. */
function seqLead(kind: string): string {
  return kind === 'LetStmt' ? 'let' : kind.replace(/Stmt$/, '').toLowerCase();
}

/**
 * The text a row shows, given the keyword its own chip already carries (`M216`).
 *
 * **The chip IS the keyword and the text is what follows it.** Every statement row drew a `seq-kind`
 * chip derived from the node (`ExpectStmt` -> `expect`) beside the statement's own source line,
 * which *begins* with that same word — so the pane read `expect expect status equals 201`, and on
 * the example's first test **6 of 7 rows repeated themselves**. It reads correctly on a `test` row
 * only because a test's text is its name and a name carries no keyword, which is why the shape
 * looked right where it was designed and stuttered everywhere it was reused.
 *
 * The strip is conditional on the text actually starting with the chip's word, so a kind whose chip
 * is not the first word of its line (`WaitUntilApiStmt` against `wait until api …`) is left exactly
 * as it was rather than mangled. `title` keeps the whole line either way.
 */
function afterLead(lead: string, text: string): string {
  return text.startsWith(`${lead} `) ? text.slice(lead.length + 1) : text;
}

/**
 * A right-clicked row of the sequence — `M218` `F`.
 *
 * Three kinds because the column draws three: the declaration band, a request, and a statement
 * attached to one. The menu's items differ by kind for the language's own reason — *duplicate this
 * request* names a unit `D1138` recognises and *duplicate this `expect`* does not.
 */
export type SeqTarget =
  | { readonly kind: 'test'; readonly decl: OutlineTest; readonly line: number }
  | { readonly kind: 'request'; readonly decl: OutlineTest; readonly request: OutlineRequest; readonly line: number }
  | { readonly kind: 'step'; readonly statement: OutlineStatement; readonly line: number };

function SeqRow({ line, selected, onLine, kind, lead, text, trailing, plus, indent, statement, door, band, refusal, menu, scope }: {
  readonly line: number;
  readonly selected: boolean;
  readonly onLine: (line: number) => void;
  readonly kind: string;
  readonly lead: ReactNode;
  readonly text: string;
  readonly trailing: ReactNode;
  /** **`+` — a new request after this one** (`D1137`). Its own slot rather than part of `trailing`
   *  because only one kind of row has it: `D1138`'s unit is a request and its attachments, and
   *  *a new request after this `expect`* names nothing the language can honour. */
  readonly plus?: ReactNode;
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
  /** The right-click trigger for this row, spread onto the `li` (`M218` `F`). A row without one
   *  behaves exactly as it did before this round. */
  readonly menu?: MenuTrigger;
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
  /** **The scope this row happens in**, when the row is a single-statement block (`M219` `D`).
   *  Drawn as a chip before the gesture, because *where* a gesture happens is as much a part of
   *  what the row says as the gesture is — `review-submission.tflw:29` is the file that proves it
   *  by carrying a comment about the assertion that read the field it had just typed into. */
  readonly scope?: string | null;
}) {
  const foreign = statement !== undefined && door !== undefined && isForeign(statement.lens, door);
  return (
    <li
      className={`seq-row${selected ? ' on' : ''}${indent ? ' under' : ''}${foreign ? ' locked' : ''}`}
      data-seq-row={kind}
      data-seq-line={line}
      data-seq-selected={selected ? 'yes' : 'no'}
      {...(menu ?? {})}
      {...(band === undefined ? {} : { 'data-band-line': band })}
      {...(statement === undefined
        ? {}
        : { 'data-stmt': statement.kind, 'data-stmt-line': statement.line, 'data-stmt-lens': statement.lens ?? 'none', 'data-stmt-locked': foreign ? 'yes' : 'no' })}
    >
      {/* **The hover here is DERIVED and never authored** (`D1127`). Every one of these rows used
          to carry a `title` that was its own visible text said again — the declaration's name, the
          request's `METHOD path`, the statement's own line — which is a tooltip that tells a reader
          what they are already looking at. What is worth showing is the part the ellipsis took, and
          only when it took one, which is a question the row can answer about itself at any width.
          `A2` has just made the width a variable, so an authored answer would have been wrong at
          every width but one. */}
      <button type="button" className="seq-pick" onClick={() => onLine(line)} aria-pressed={selected} data-seq-pick={line} data-seq-goto={line} data-tip-derived="">
        <span className="ln muted">{line}</span>
        {lead}
        {scope === undefined || scope === null ? null : (
          <span className="seq-scope" data-seq-scope-of={scope} data-tip={`this gesture happens inside \`${scope}\``}>
            {scope}
          </span>
        )}
        <span className="seq-text stmt-text" data-tip-text>{text}</span>
      </button>
      {/* **A step another door owns is drawn in position and links to that door** (`D1078`). The
          door decides what may be EDITED and never what may be seen, so the row says what the step
          is and where it can be worked on — which is the one thing a reader needs from it here. */}
      {foreign && statement?.lens ? (
        <a className="badge also" href={`#/${statement.lens}`} data-stmt-door={statement.lens} data-tip={`this is ${DOOR_BY_ID[statement.lens].label}'s to edit — open that door`}>
          {DOOR_BY_ID[statement.lens].label}
        </a>
      ) : null}
      {plus}
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
    <button type="button" className={`seq-x${refusal ? ' refused' : ''}`} onClick={refusal ? onClear : onGo} data-tip={refusal ? 'dismiss' : `remove this ${what}`} data-seq-remove={what} aria-label={`remove this ${what}`}>
      ✕
    </button>
  );
}

/**
 * **▶ — run this declaration** (`M220` `A`, `D1168`, `D1176`).
 *
 * It sits beside the `✕` for the reason the `+` two functions down sits there: a gesture that
 * belongs to one row and acts on the thing the row **is**. The plan's `A` said *"the foot and the
 * sequence head"*, and two places for one gesture is the two-implementations shape this pane keeps
 * removing — so it is here and not there. The foot is where **creation** lives (`D1118`), and a
 * play creates nothing; the head is the declaration itself.
 *
 * **It is refused while the buffer is unsaved, and it says why** (`D1177`). A play is
 * `tflw run --only "<name>" <file>` — it reads the *file*, so with a pending edit the thing that
 * runs is not the thing on screen. `send` has no such problem because it writes its own scratch
 * first; `--only` names a test inside its own file and there is nowhere for a scratch to stand. So
 * the refusal is stated on the control rather than discovered in a report, and — `Remove`'s own
 * rule, one function up — a disabled control that does not say why is the pattern this pane
 * exists to remove, which is why the reason is the tip rather than nothing.
 */
/**
 * **▶ — run this declaration and nothing else.**
 *
 * **`dirty` is gone from the held set** — `M221` `B` (`D1183`, overturning `D1177`). It used to
 * refuse an unsaved buffer and say *write this file first — a play runs what is on disk*, which
 * was true of the mechanism and wrong as a rule: a pane is dirty from the first step you add,
 * which is most of the time anyone wants to press this. ▶ now runs the buffer through a scratch
 * beside the file, so there is nothing left for the refusal to protect.
 *
 * `running` stays, and it is also `D1188`: one play at a time is what keeps two presses from
 * racing for one directory's scratch.
 */
function Play({ what, running, onGo, price }: {
  readonly what: string;
  readonly running: boolean;
  readonly onGo: () => void;
  /**
   * **What pressing this costs, when it costs something measurable** — `M224` `E` (`D1212`).
   *
   * `D1168` gave ▶ to BROWSER and warned in the same docblock that *"offering both on one door
   * would be two gestures that look alike and mean different things"*. On LOAD `send` and ▶ sit on
   * the same pane and mean things that are very different: one issues the request once, the other
   * commits to a workload. So the one that costs says so, and `send` — which carries no price and
   * needs none — is the one that does not. **One gesture is priced and one is not**, which is a
   * difference a reader can see before pressing rather than after.
   */
  readonly price?: string;
}) {
  const why = running
    ? 'a run is already going'
    : `run this ${what} — and nothing else in the file${price === undefined ? '' : `, which is ${price}`}`;
  return (
    <button
      type="button"
      className={`seq-play${running ? ' held' : ''}`}
      onClick={running ? undefined : onGo}
      disabled={running}
      data-seq-play={what}
      data-seq-play-held={running ? 'running' : undefined}
      data-seq-play-price={price}
      data-tip={why}
      aria-label={why}
    >
      ▶{price === undefined ? null : <span className="seq-kind"> · {price}</span>}
    </button>
  );
}

/**
 * **A workload's own duration, in the control's words** — `M224` `E` (`D1212`).
 *
 * `undefined` on a test with no workload: there is nothing to price, and ▶ there means what it has
 * meant since `M220`. `no clock` on the two iteration shapes — **29 of the corpus's 85 workload
 * lines** — because they say *run N iterations across M users*, so the run ends when the work is
 * done and how long that takes is the property being measured. That is the existing form's own
 * wording, kept.
 *
 * It sums the stages rather than asking the reporter: `describeWorkload` says what a workload
 * **is**, not how long it takes, and a second reader of the same node computing a different
 * quantity would be `D1094`'s two-implementations shape for the sake of one string.
 */
function playPrice(workload: Workload | null): string | undefined {
  if (workload === null) return undefined;
  const total = workloadSeconds(workloadEditOf(workload));
  return total === null ? 'no clock' : `~${Math.round(total * 10) / 10}s`;
}

/**
 * **`+` — a new request after this one** (`M217` `B`, `D1137`, `D1138`).
 *
 * It sits beside the `✕` because it is the same kind of thing: a gesture that belongs to one row
 * and acts on the sequence. `M216` gave that slot its chrome; this adds the other half of it, so a
 * request row can now say *one more like this, here* as well as *not this one*.
 *
 * **It is always drawn, never revealed on hover** (`D1140`). A control only a pointer can reach is
 * a control some readers do not have — `Grip.tsx` says so in its own docstring — and the reason
 * this exists at all is that nobody could find where a request comes from.
 *
 * The label says **after**, because that is the whole decision: a request goes in after this one
 * *and the statements attached to it*, so nothing below changes which response it reads.
 */
function Plus({ onGo, after }: {
  readonly onGo: () => void;
  readonly after: string;
}) {
  return (
    <button
      type="button"
      className="seq-plus"
      onClick={onGo}
      data-seq-plus={after}
      data-tip={`a new request after ${after} — below everything that reads its response, so nothing here changes what it asserts about`}
      aria-label={`add a request after ${after}`}
    >
      +
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
function AssertRow({ statement, edit, onEdit, verdict, trailing, onRemove, refusal, onClearRefusal, onLine, drops, phase }: {
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
  /** See `SubjectFields.phase` — `M219` `G` (`D1166`). */
  readonly phase?: 'api' | 'browser';
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
        <SubjectFields subject={v.subject} argument={v.argument} locatorKind={v.locatorKind} carried={subjectSpelling(node.subject)} onChange={change} drops={drops} phase={phase} />
        {/* **Every matcher is drawn, and the ones `TF042` would refuse are disabled** — `M228`
            `D` (`D1243`).

            **Disabling rather than filtering is `D1076` held rather than traded**: *over-offering
            beats silent omission — a word that should not be here is visible and wrong, and a word
            that is missing is invisible and wrong.* An author hunting for `has no security
            violations` on a `status` row finds it, greyed, carrying `TF042`'s own sentence, and
            learns that it wants a `response`. Filtered away, they learn nothing and conclude the
            language cannot do it.

            The rule is `matcherSubjectRefusal`, which is the two lines `checkOneMatcherSubject`
            builds the diagnostic from — so this is not a second list that can disagree with the
            checker, and `ValueSubject` abstains here because the check does (`TF041` owns that
            pairing and would otherwise report one mistake twice). */}
        <select value={v.matcher} onChange={(e) => change({ matcher: e.target.value as MatcherName })} data-expect-matcher={v.matcher} aria-label="matcher">
          {MATCHERS.map(([id, text]) => {
            const node = SUBJECT_NODE[v.subject];
            const refusal = node === undefined ? null : matcherSubjectRefusal(id, node);
            return (
              <option key={id} value={id} disabled={refusal !== null} title={refusal ?? undefined} data-matcher-refused={refusal === null ? undefined : 'yes'}>
                {text}
              </option>
            );
          })}
        </select>
        {takesValue ? (
          <input className="assert-value" value={v.operand} onChange={(e) => change({ operand: e.target.value })} data-expect-operand aria-label="operand" placeholder={v.matcher === 'fails' ? '(any failure)' : '200'} />
        ) : null}
        <button
          type="button"
          className={`assert-more${rare ? ' on' : ''}`}
          onClick={() => setOpen((x) => !x)}
          aria-expanded={rare}
          aria-label="more forms for this assertion"
          data-tip="`check` instead of `expect`, `any`/`all`, and `not` — the three forms 96% of this corpus's assertions do not use"
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
          <label className="not" data-tip="`not` — the word whose absence would invert this assertion">
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
          <button onClick={() => change({ subset: [...v.subset, { name: '', value: '""' }] })} data-subset-add data-tip="one key the response must carry with this value; the rest of the object is not compared">
            + key
          </button>
        </div>
      ) : null}
      {refusal === null ? null : <Refusal held={refusal} onLine={onLine} />}
    </li>
  );
}

// ── The pane ───────────────────────────────────────────────────────────────────────────────────

export interface ComposePaneProps {
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
  /** `send this` — the prefix up to the selected request. `null` on a declaration address, where
   *  there is no *this* (`D1215`). */
  readonly prefix: Prefix | null;
  /** `send all` — every request in the declaration, one iteration (`D1215`). */
  readonly prefixAll: Prefix | null;
  readonly onSend: ((form: SendForm) => void) | null;
  readonly sending: boolean;
  /**
   * **The last send, and every request it issued** (`M225` `B`, `D1217`).
   *
   * `lines` are this file's own lines, so the pane can ask *which of this declaration's requests
   * did that press touch* without knowing anything about the scratch it ran. `null` before any
   * send, which is also what `path` changing restores.
   */
  readonly sent: { readonly lines: readonly number[]; readonly form: SendForm; readonly at: string } | null;
  /** `D1221` — the selected declaration's last run, for the composer's citation line. */
  readonly lastRun?: { readonly iterations: number; readonly p95Ms: number; readonly inconclusive: boolean } | null;
  readonly ran: RanIndex;
  readonly onVerify: ((request: OutlineRequest, spec: ExpectSpec) => void) | null;
  readonly onCapture: ((request: OutlineRequest, specs: readonly CaptureSpec[]) => void) | null;
  readonly onAdd: ((decl: OutlineTest, key: string) => void) | null;
  readonly adds: readonly AddGesture[];
  /** The declaration a recording is writing into, by its line — `null` when none is running
   *  (`M213` `S5`, `D1095`). The foot reads it; nothing else does. */
  readonly recording: number | null;
  /**
   * **`+` on a request row** — `M217` `B` (`D1137`, `D1138`): a new request *after this one and
   * the statements attached to it*. The foot's `+ request` still means *at the end*, and on the
   * last request of a body the two are the same edit.
   */
  readonly onAddAfter: ((decl: OutlineTest, request: OutlineRequest) => void) | null;
  /** **Duplicate a request with its attachments** — `M218` `F` (`D1156`). */
  readonly onDuplicate: ((decl: OutlineTest, request: OutlineRequest) => void) | null;
  /** What a right-clicked sequence row can do, and where to put the menu (`M218` `F`). Built by
   *  the door for the same reason the explorer's is built by the shell: this pane draws rows. */
  readonly menuFor: ((t: SeqTarget) => readonly MenuItem[]) | null;
  readonly onMenu: ((r: MenuRequest) => void) | null;
  /** Bumped by every create gesture that lands (`D1136`). The pane focuses the first field of
   *  whatever opened; a counter rather than a line, because the same line can be landed on twice. */
  readonly made: number;
  /** `D1117` — take these steps out of this declaration. The pane runs the dependency scan and
   *  never calls this while anything is holding one of them. */
  readonly onRemoveSteps: ((decl: OutlineHook | OutlineTest, steps: readonly number[]) => void) | null;
  readonly onRemoveDecl: ((decl: OutlineHook | OutlineTest) => void) | null;
  /** **▶ on the declaration head** — `M220` `A` (`D1168`). `null` on a door whose `vocabulary.ts`
   *  row says it does not play, and on a hook, which `--only` cannot name. */
  readonly onPlay: ((decl: OutlineTest) => void) | null;
  /** Whether a run is in flight anywhere — ▶ holds while one is (`D1177`). */
  readonly playing: boolean;
  /** **`✕` on a statement inside a scoping block** — `M219` `D` (`D1163`). A second removal rather
   *  than a case of the first: `onRemoveSteps` takes indices into a body, and a statement inside a
   *  `within` is not one of them. */
  readonly onRemoveScoped: ((statement: OutlineStatement) => void) | null;
  /** **Take the scope off and keep the statement.** Offered only on a block holding exactly one —
   *  397 of the corpus's 405 `within`s — for the reason `ComposeDoor` records on it. */
  readonly onUnscope: ((statement: OutlineStatement) => void) | null;
  /** **Put a scope on this statement** — the other half of `D1163`, and what keeps `WithinBlock`
   *  constructible while `D1164` keeps it out of the `+` list. */
  readonly onScope: ((statement: OutlineStatement) => void) | null;
  /** **What the live browser has handed back, and what has been kept of it** — `M219` `F`
   *  (`D1165`). `null` on a door that has no session, which is every door but BROWSER. */
  readonly session: Session | null;
  readonly onKeepLine: (line: SessionLine) => void;
  readonly onKeepAll: () => void;
  /** `M221` `C` (`D1185`) — run the test with the pending lines in it, keeping none of them.
   *  `null` on a door that does not play. */
  readonly onPlaySession: (() => void) | null;
  readonly onDropLine: (id: number) => void;
  readonly onStopSession: () => void;
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
  /**
   * **Is the playback region carrying a trace** — `M227` `D` (`D1235`).
   *
   * Not *which* trace and not the Stage itself: the one bit this pane needs is whether the page
   * already has a full-width band below it with something in it. See `D1235` on the `footer`
   * derivation below.
   */
  readonly stage: boolean;
  /**
   * **The env's authorization facts, straight off `ProjectView`** — `M228` `A` (`D1239`).
   *
   * The same object `ComposeDoor` hands `diagnose` (`D1240`), so the segment below and the
   * diagnostics list above it cannot disagree about what is in force. Not narrowed on the way in:
   * a second shape here is where a second account of `tflw.config` would start, which is the
   * thing `ui-server.ts` says out loud about this block.
   */
  readonly authorization: Authorization;
  /** The two project-fact tabs the `scan` segment links to (`M207` `Q1`). Region 2 does not own
   *  the tab strip, so it asks — the same shape `ComposeDoor` already uses for `onEditorTab`. */
  readonly onProjectTab: (tab: 'auth' | 'config') => void;
}

/**
 * **The editor track is sized by what it holds, and the reader can still override it** — `M223`
 * `B` (`D1195`, `D1196`).
 *
 * This was `SPLIT_KEY = 'tflw.compose.split'`, a FRACTION of the column (`D1116`), and the
 * fraction is the defect this round was scoped from. Measured on the live page at 1440x900 with an
 * `open` selected on the BROWSER door: the column is 239 px, and `62%` hands the editor **147 px
 * for 99 px of content** while the session panel under it gets 85 px for the **112 px** its own
 * button-and-paragraph needs. 48 px wasted and 27 px clipped **at the same instant**, with 22 px
 * still spare in the column — the two halves of the same defect, which is why the user reported
 * them as two complaints.
 *
 * **The API door has it worse and nobody reported it**: the same ratio wastes **208 px** under an
 * `expect` selection there and clips nothing, because the response pane happens to be tall enough.
 * `.editor-col` is one component shared by both doors since `M214`, so this is not a BROWSER
 * defect and does not get a BROWSER fix (`D1198`).
 *
 * So the default is not a number at all — `grid-template-rows: minmax(0, auto) 6px minmax(112px,
 * 1fr)` in the stylesheet, where `auto` is *what the editor holds*. **The accepted cost is that
 * the boundary moves as the reader clicks different rows** — 99 px under an `open`, 237 under an
 * API request. That was put to the user as the option's own cost and chosen with it.
 *
 * **The override is an absolute height and not a ratio**, because a ratio of a content-sized row
 * is not a thing. `D1116`'s objection to pixels — *a remembered 620 px on a 700 px window is a
 * response with no editor above it* — is answered rather than ignored, twice: `fitEditor` clamps
 * against the column's LIVE height every time the value is written, and the track itself is
 * `minmax(0, Npx)`, so a stored height larger than the window can spare shrinks instead of
 * evicting the pane below it.
 *
 * **`tflw.compose.split` is dropped rather than migrated, and deleted on read.** A remembered
 * `0.62` is a reader's answer to a question this round stops asking, and honouring it would hand
 * exactly the readers who have used this pane the behaviour the round exists to remove.
 */
const EDITOR_KEY = 'tflw.compose.editor';
/**
 * **The footer layout's own key** — `M226` `A` (`D1227`).
 *
 * One divider, two containers, and **not the same number**: in the column layout the stored value
 * is how tall the editor is, in the footer layout it is how tall the whole grid above the divider
 * is — the sequence column included. A single key holding both would mis-restore the instant a
 * reader moved between a workload test and a functional one in the same file, which in the
 * `load-door` corpus is one click.
 */
const FOOTER_KEY = 'tflw.compose.footer';
/** `D1116`'s key, named here only so it can be removed from the readers who have one. */
const RATIO_KEY = 'tflw.compose.split';
/** The editor's own floor: its head and one field. */
const EDITOR_MIN = 88;
/** What the pane under the editor needs to draw its empty state whole — the BROWSER door's session
 *  panel, measured at 112 px. The stylesheet states the same number as the track's own minimum;
 *  this one is what keeps a DRAG from writing a height that violates it. */
/**
 * **Region 2's tenants** — `D1209` named two and `M228` `A` (`D1239`) adds the third.
 *
 * `response` is the one that is always there; the other two are earned by the construct, never
 * granted by the door (`D1044`).
 */
type Region2 = 'plan' | 'response' | 'scan';

/**
 * **What each region-2 segment is** — `M228` `F` (`D1246`).
 *
 * One sentence per tenant, in the reader's terms rather than the implementation's. `scan` names
 * itself a view out loud, because that is the confusion that produced this decision: it is the
 * default segment on a declaration, so it is pressed by someone who is already looking at it.
 * `response` names BOTH of its sources, because `D956` is the distinction it exists to keep —
 * *from the last run* and *from this send* are different evidence.
 */
const REGION2_TIP: Readonly<Record<Region2, string>> = {
  plan: 'the workload this test declares, drawn to scale — what will run, for how long, and at what rate',
  response: 'what came back — from the last run, or from the last `send` on this pane',
  scan: 'where a scan in this env can reach, and what authorizes it — a view, and nothing here runs',
};

/** The selected declaration's workload, or `null` — `D1209`'s own predicate, as a function
 *  because the tenant list is derived above where `decl` is unpacked. One expression, two
 *  readers, so the segment and the footer placement cannot disagree about what a workload test
 *  is (`D1225`). */
const planWorkloadOf = (at: Addressed | null): Workload | null =>
  at?.decl != null && at.decl.kind === 'test' ? at.decl.workload : null;

/**
 * **Why a row cannot be edited, when its address is missing** — `M228` `C` (`D1238`).
 *
 * Two populations have no `stepPath`, and until this round there was one, so the sentence was a
 * constant. `nested` tells them apart and is already on the row rather than derived: an `expect`
 * inside a `wait until api` block is not a step of the body's own list, and a crawl's statements
 * are a whole declaration outside `replaceInSource`'s numbering. Saying the block's sentence about
 * a crawl would be a true-shaped sentence about the wrong thing, which is worse than none.
 */
const unaddressableWhy = (nested: boolean): string =>
  nested
    ? 'inside the block above — an index pair names a step of a body, and this is not one'
    : 'part of a `crawl` — drawn here, edited in the file (`D1238`)';

const LOWER_MIN = 112;
/**
 * **And what it needs once there is a response in it** — `M225` `G` (`D1223`).
 *
 * Measured at 1440x900 with the strip on screen: the seg nav, the strip and the response's own
 * header consume **all 112 px**, leaving **0 px** of the body visible. This is that chrome plus
 * `D1223`'s stated 120 px of body, rounded up — the stylesheet carries the same number for the
 * default track and this one stops a drag writing under it.
 */
const RESPONSE_MIN = 240;

function readEditorPx(key: string): number | null {
  try {
    window.localStorage.removeItem(RATIO_KEY);
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= EDITOR_MIN ? n : null;
  } catch {
    // A private window, or site data blocked. The accessor itself throws in some browsers, which
    // is why this is a try and not a null check.
    return null;
  }
}

/** The override, clamped to a column this tall: never under the editor's floor, never over what
 *  leaves the pane below it `LOWER_MIN`. A column too short for both gives the editor its floor
 *  and lets the grid shrink it from there. */
const fitEditor = (px: number, column: number, lower: number = LOWER_MIN): number =>
  Math.max(EDITOR_MIN, Math.min(Math.round(px), Math.max(EDITOR_MIN, column - 6 - lower)));

export function ComposePane(props: ComposePaneProps) {
  const { path, outline, at, focusLine, onLine, onNew, scratchUnignored, edit, onEdit, editing, prefix, prefixAll, onSend, sending, sent, lastRun, ran, onVerify, onCapture, onAdd, adds, recording, onAddAfter, onDuplicate, menuFor, onMenu, made, onRemoveSteps, onRemoveDecl, onPlay, playing, onRemoveScoped, onUnscope, onScope, session, onKeepLine, onKeepAll, onPlaySession, onDropLine, onStopSession, dirty, busy, problem, onWrite, onDiscard, door, stage, authorization, onProjectTab, tab, onEditorTab: setTab } = props;

  /** One call per sequence row kind — `M218` `F`. `{}` when the door wired no menu, so the rows
   *  behave exactly as they did before this round. */
  const seqMenu = (t: SeqTarget, subject: string): MenuTrigger | undefined =>
    menuFor === null || onMenu === null
      ? undefined
      : menuTrigger(onMenu, () => ({ kind: t.kind, subject, items: menuFor(t) }));

  const selected = useMemo(() => selectedAt(at, focusLine), [at, focusLine]);
  /** Which request's verdicts and response are in hand. A statement's are its request's. */
  const forRequest: OutlineRequest | null =
    selected.kind === 'request' ? selected.request
    : selected.kind === 'statement' ? (at === null ? null : requestsOf(at.decl.body).find((r) => r.attached.some((s) => s.line === selected.statement.line)) ?? null)
    : null;
  /**
   * A statement's verdicts are its request's — **or, where there is no request, its action's**
   * (`M220-02`, `D1270`). `groupFor` is the same rule `indexFromReport` groups by, read from the
   * other end, and it is bounded to this declaration so a mark never attaches across one.
   */
  const rowRan: Ran | null =
    forRequest !== null
      ? (ran.get(forRequest.line) ?? null)
      : selected.kind === 'statement' && at !== null
        ? groupFor(ran, at.decl.line, selected.statement.line)
        : null;

  /** The prefix whose request list is drawn — what the press the reader is most likely to take
   *  will fire. On a declaration address that is `send all`, because there is no *this*. */
  const sendPrefix: Prefix | null = prefix ?? prefixAll;

  /**
   * **What the last send left in this declaration** — `M225` `B` (`D1217`).
   *
   * One entry per request the press issued *in the declaration on screen*, in file order. A hook's
   * request is not here for the same reason it is not a row: nothing in this file is drawn on it.
   * The `scope` check is what keeps a run's verdict out — `ran` holds both, and a send wins over a
   * report only for the lines it is about (`D1099`).
   */
  const sentHere = useMemo(() => {
    if (sent === null || at === null) return [];
    return requestsOf(at.decl.body)
      .filter((r) => sent.lines.includes(r.line))
      .map((r) => ({ request: r, ran: ran.get(r.line) ?? null }))
      .filter((e): e is { request: OutlineRequest; ran: Ran } => e.ran !== null && e.ran.scope === 'send' && e.ran.response !== null);
  }, [sent, at, ran]);

  /**
   * **Which entry's body is in the box.** `null` means *the default*, which is the first entry —
   * §2.3, decided against the last: a rung's final POST is the request the test exists to measure
   * and is also the one whose meaning depends on everything above it, so an iteration is read in
   * the order it ran.
   *
   * Cleared by a new send and by moving the selection, because both of those change what the box
   * is about. Not cleared by a keystroke: `ran` is re-derived from the buffer on every one of
   * them (`D1093`), and a pick that survives is the same request it was.
   */
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [path, sent?.at, forRequest?.line]);

  /**
   * **The response the box is showing, and the request it came from — ONE reading, not two.**
   *
   * `M225` §1.2 is this value's whole reason: a send from a declaration address recorded its
   * verdict against a request line while the selected row was the `test` line, so `rowRan` stayed
   * `null` and region 2 went on saying *nothing has run this request* — the exact sentence the
   * press had just falsified. The row still wins when it has a response, so every gesture that
   * worked before this round works unchanged; what is new is the fallback to the send's own first
   * entry when the row has nothing.
   *
   * **The pair is derived together because the build caught them disagreeing** (`D1094`, the
   * failure this project keeps recording). The first draft computed the `Ran` and the
   * `OutlineRequest` in two expressions with the same three branches written twice, and a write
   * that moved the file's lines left a `pick` whose line still resolved in `ran` and no longer
   * resolved in `sentHere` — so the box had a response and no request, which renders the empty
   * state *and* the send row at the same instant. Two `send all` buttons on one screen, found by
   * Playwright's strict-mode resolving two elements for one selector.
   */
  const shownEntry = useMemo(() => {
    const picked = pick === null ? null : sentHere.find((e) => e.request.line === pick) ?? null;
    if (picked !== null) return { ran: picked.ran, request: picked.request };
    if (rowRan !== null && rowRan.response !== null && forRequest !== null) return { ran: rowRan, request: forRequest };
    const first = sentHere[0];
    return first === undefined ? null : { ran: first.ran, request: first.request };
  }, [pick, sentHere, rowRan, forRequest]);
  const shown: Ran | null = shownEntry?.ran ?? null;
  /** The request whose response is in the box — what `D1218`'s solid badge marks, and what a tick
   *  writes an assertion against. */
  const shownRequest: OutlineRequest | null = shownEntry?.request ?? null;

  /** The refusal a `✕` produced, keyed by the line it was pressed on (`D1117`). */
  const [refused, setRefused] = useState<{ line: number; held: { name: string; line: number; text: string } } | null>(null);
  useEffect(() => setRefused(null), [path]);

  const remove = useCallback(
    (decl: SelectedDecl, at_line: number, target: { lines: number[]; steps: number[] } | null): void => {
      /* **A crawl's steps cannot be removed, because they cannot be addressed** — `M228` `C`
         (`D1238`). `onRemoveSteps` names a declaration by `replaceInSource`'s index and a crawl
         carries `-1`, so this is the same refusal the null `stepPath`s make on the row: stated
         once here rather than left to every call site to remember. */
      if (decl.kind === 'crawl' || target === null || onRemoveSteps === null) return;
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
  /** **Whether this declaration's steps can be removed at all** — `M228` `C` (`D1238`). A crawl's
   *  cannot: `onRemoveSteps` names a declaration by `replaceInSource`'s index and a crawl carries
   *  `-1`. Named once rather than repeated at each `✕`, because a control that is drawn and does
   *  nothing is the shape `D1082` refuses and the miss would be silent. */
  const removable = onRemoveSteps === null || at?.decl.kind === 'crawl' ? null : onRemoveSteps;
  const refusalFor = (line: number): { name: string; line: number; text: string } | null => (refused !== null && refused.line === line ? refused.held : null);
  const clearRefusal = useCallback(() => setRefused(null), []);

  /**
   * **Region 2 goes to the foot when the declaration carries a workload** — `M226` `A` (`D1225`).
   *
   * Measured at 1440x900 on the `load-door` corpus: the response body's longest line wants **871
   * px** and has **699** under the editor column, so it scrolls sideways; and `.editor` on a
   * workload declaration wants **537–568 px** and gets **471–493**, so the composer is squeezed on
   * every LOAD file while **no other door is squeezed at all**.
   *
   * **The move answers the first and not the second, and the second is what chose the axis.** A
   * footer is still a row, so the editor's track is `613 − 6 − 112 = 495` either way — measured at
   * 495 after against 493 before. What the squeeze establishes is that the composer is the tallest
   * editor on the page and only this construct has one; what the footer pays out is width.
   *
   * **The construct, not the door** (`D1044`, and `D1209`'s axis one round earlier), because the
   * construct is what predicts the need: a workload-bearing declaration has the tallest editor on
   * the page and, being a rung, the shortest sequence beside it. It reads the same expression
   * `D1209` branches on, so the segment and the placement cannot disagree about what a workload
   * test is — and the gate is taken on **API**, where the door and the construct do not agree.
   *
   * It is computed here rather than beside `planWorkload` below only because the state under it
   * has to read the right key on its FIRST render; a footer that adopts the column's stored height
   * for one frame and then corrects itself is a visible jump.
   */
  /**
   * ── `M227` `D` (`D1235`) — **and it yields to a live playback region** ──────────────────────
   *
   * `D1181` puts the Stage below both columns on every door, three rounds before `M226`, and
   * `M226` did not reorder anything. What it did was make region 2 **the same width as the
   * Stage** — measured on the BROWSER door, `.responsebox` 753 -> 1072 with `.stage` already at
   * 1072 — so two identical full-width bands stack and the upper one reads as the page's floor
   * while the lower one is. The user found it by eye on a populated playback and was right about
   * the picture while the ordering was untouched.
   *
   * The floor is not a matter of taste here. With a trace up the Stage is **620 px**
   * (`STAGE.fallback`), and on BROWSER the plan took **371** rather than its 240 floor because
   * that door's editor wants only 237 and `1fr` hands the slack downward — so a third of the pane
   * was a chart sitting between the author and the thing that door exists for.
   *
   * **`M226`'s own measurement is the argument.** The footer was earned by a squeeze: the
   * workload editor wants 537-568 px and gets 471-493, and *API and BROWSER are not squeezed at
   * all — gets == wants*. Where nothing is squeezed the footer buys nothing, and beside a live
   * Stage it costs the page its only floor.
   *
   * **Keyed on the state, not the door** (`D1044`, and `D1225`'s whole point): *this pane has
   * playback up* is true on LOAD the moment you press ▶ on a browser test, and false on BROWSER
   * until you do. A door-keyed version of this rule would be green under every mutation that made
   * it state-keyed and vice versa, which is why the gate plays a real test rather than asserting
   * a door.
   */
  const footer = at?.decl != null && at.decl.kind === 'test' && at.decl.workload !== null && !stage;

  /** `null` — the editor is as tall as what it holds (`D1195`). A number is the reader's own
   *  override in pixels (`D1196`); `Home` on the divider returns it to `null`. */
  const [editorPx, setEditorPx] = useState<number | null>(() => readEditorPx(footer ? FOOTER_KEY : EDITOR_KEY));
  /** The divider's own key follows the layout (`D1227`), and so does what it measures. */
  const splitKey = footer ? FOOTER_KEY : EDITOR_KEY;
  /** **The layout changing re-reads the height**, because the two keys hold different quantities.
   *  Guarded on the value rather than run on every `footer` render, so a reader dragging inside one
   *  layout is not overwritten by the value they started from. */
  const wasFooter = useRef(footer);
  useEffect(() => {
    if (wasFooter.current === footer) return;
    wasFooter.current = footer;
    setEditorPx(readEditorPx(footer ? FOOTER_KEY : EDITOR_KEY));
  }, [footer]);
  /** The sequence column's width (`D1135`) — a fixed number of pixels the reader chose, where the
   *  grid used to hold a builder's `minmax(220px, 300px)`. Separate from `split` above, which is
   *  the horizontal divider inside the editor column and a FRACTION rather than a width, for the
   *  reason recorded there: a remembered 620 px on a 700 px window is a response with no editor. */
  const [seqWidth, setSeqWidth] = useState<number>(() => storedSize(COMPOSE));
  const column = useRef<HTMLDivElement | null>(null);
  /** The footer layout's container: the pane grid, which owns the rows when `.editor-col` has been
   *  flattened into it. `fitEditor` clamps against whichever of the two is live (`D1227`). */
  const stack = useRef<HTMLDivElement | null>(null);

  /**
   * **The cursor lands in the first field of whatever a create gesture opened** — `M217` `A`
   * (`D1136`).
   *
   * `ComposeDoor` has already moved the address, so by the time this runs the editor beside the
   * sequence is showing the new statement. What is left is the half a reader notices: a request
   * whose `path` is `/` and a `let` whose value is the literal string `"change me"` are both
   * placeholders, and a placeholder you have to go and click is a placeholder that gets left.
   *
   * **The first field, not a named one.** A rule that named `.request-path` would be right for one
   * of the three gestures and silently wrong for the others, and would have to be revisited every
   * time the editor's first control changes — which `M214` and `M215` both did. The editor's own
   * DOM order is the answer to *what does a reader type into first*.
   *
   * `made` is a counter, so adding the same statement twice in a row fires this twice; a key of
   * the line would not. `select()` rather than a bare focus, because every one of these values is
   * a placeholder meant to be replaced rather than appended to.
   */
  /**
   * **`focusLine` is read here and is deliberately NOT a dependency**, and the first draft got this
   * wrong in a way worth recording: with `[made, focusLine]` the effect re-ran on every selection
   * change once anything had ever been created, so from then on **clicking any row in the sequence
   * yanked focus into the editor and selected its text**. The trigger is *a create landed*, which
   * `made` alone says; the line is only how the effect finds what landed.
   */
  const landedAt = useRef<number | null>(focusLine);
  landedAt.current = focusLine;

  useEffect(() => {
    if (made === 0) return;
    /* The row first, because the column scrolls inside itself (`D1110`) and a test of thirteen
       requests puts a new one below the fold — the selection highlight is on a row nobody can
       see. `block: 'nearest'` so a row already in view does not jump. */
    if (landedAt.current !== null) {
      column.current?.ownerDocument
        .querySelector(`.seq-col [data-seq-line="${landedAt.current}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
    const field = column.current?.querySelector<HTMLElement>(
      '.editor input:not([type="checkbox"]):not([disabled]), .editor textarea:not([disabled])',
    );
    if (field === null || field === undefined) return;
    field.focus();
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
  }, [made]);

  /**
   * **Which of region 2's two tenants is showing** (`D1209`) — and it is declared **here**,
   * above the early return below, because that is the hook rule rather than a preference: a
   * `useState` written under a conditional `return` changes the hook count between two renders.
   * The first draft of this had it beside `decl`, thirty lines down, and the whole page went
   * white with React #310 the moment the outline arrived — the same trap `App.tsx` records on
   * `configPanel`'s `useMemo`, which timed out every door test at once.
   *
   * **`null` is *the reader has not chosen*, and the default follows the selection.** A plain
   * `'plan'` default was written first and it took the region away from the gesture it was built
   * for: `D1116` put the response under the editor so ticking a value writes into the Assert tab
   * directly above it, and on a workload-bearing test every request row lost its `send` prefix to
   * a chart. A plain `'response'` default is the same mistake mirrored — a declaration selected on
   * the LOAD door would open on *pick a request to see what came back*, which is the one thing
   * that door is not about.
   *
   * So: a **request** selected opens the response, and a declaration opens the plan. Once the
   * reader picks, the pick stands — a segment that re-decided on every navigation would be
   * undoing them.
   *
   * **`at.request` is the wrong instrument for that and the run said so.** `addressed()` falls
   * back to a declaration's *first* request whenever the line is above all of them (`D1080`), so
   * `at.request` is non-null for an address that names the `test` line — it answers *which request
   * is in scope*, never *what did the reader point at*. `selectedAt` answers the second question
   * and is already computed above; `'test'` is the declaration's own run of lines, header and all.
   */
  const [region2Pick, setRegion2Pick] = useState<Region2 | null>(null);

  /**
   * ── `M228` `A` (`D1239`) — **the third tenant, and what earns it** ──────────────────────────
   *
   * Every scan matcher this declaration carries, in source order. `statementsOf` is the outline's
   * own flattener, so a `has no security violations` inside a `within` is counted here and
   * **nothing walks the body a second time** — a second traversal beside the one the outline
   * already does is the drift class `lenses.ts` states its own rule against.
   *
   * **The predicate is the language's, read off `MATCHER_LENS`.** `parts.tsx`'s `SCAN_MATCHERS`
   * is the wrong table for it and would have been the easy mistake: it holds four, because it
   * answers *does this matcher take a severity floor*, and `has no a11y violations` takes one
   * while being a **browser** assertion — it stands against `page`, a crawl body cannot hold it,
   * and a11y is not a fifth door. `MATCHER_LENS` is the table `lensesOfTest` decides the door
   * with, so a family that earns this segment without putting the test behind SCANS is impossible
   * by construction rather than by a test.
   *
   * A hook is excluded because `lensesOfTest` takes a `TestDecl`; a hook that grades a response
   * is a shape the corpus does not hold and the language's own door rule has no opinion about.
   */
  const scanMatchers = useMemo<readonly MatcherName[]>(() => {
    const decl = at?.decl ?? null;
    if (decl === null || decl.kind !== 'test') return [];
    return statementsOf(decl.body)
      .filter((st) => st.node.type === 'ExpectStmt')
      .map((st) => (st.node as ExpectStmt).matcher.name)
      .filter((name) => MATCHER_LENS[name] === 'scan');
  }, [at]);
  /** The same fact the door rule states, asserted the same way — a cross-check that costs one
   *  call and would catch the day `MATCHER_LENS` and `lensesOfTest` stop agreeing. */
  const scanning = scanMatchers.length > 0 && at?.decl != null && at.decl.kind === 'test' && lensesOfTest(at.decl.node).includes('scan');

  /**
   * **Which tenants region 2 has, and which one is showing.**
   *
   * `D1209` wrote this as two, and two was the whole vocabulary then. The list is derived rather
   * than spelled because that is what keeps the nav and the body from disagreeing: the segment
   * draws `region2Tenants` and each panel below renders on `region2 === <its own name>`, so a
   * tenant that is offered and draws nothing is not expressible.
   *
   * **The default follows the selection and then the construct**, which is `D1209`'s rule with
   * one more case rather than a new one: a **request** or a statement opens the response, because
   * `D1116` put it under the editor for the tick-to-assert gesture; a declaration opens the
   * richest thing it has earned. A workload outranks a scan when a declaration has both — the
   * plan is a picture of the whole rung and the scan panel is about assertions the sequence is
   * already showing.
   *
   * The nav appears only when there is a choice to make. On a plain API test that is one tenant
   * and no strip, which is what every door but LOAD looked like before this round.
   */
  const region2Tenants = useMemo<readonly Region2[]>(
    () => [...(planWorkloadOf(at) !== null ? (['plan'] as const) : []), ...(scanning ? (['scan'] as const) : []), 'response'],
    [at, scanning],
  );
  const region2Default: Region2 =
    selected.kind === 'request' || selected.kind === 'statement' ? 'response' : (region2Tenants[0] ?? 'response');
  /** A pick that the current declaration does not offer is **not** a pick — the reader chose
   *  `plan` on a workload test and then opened a functional one, and an unfiltered `region2Pick`
   *  would leave the region showing nothing at all with the strip gone. */
  const region2: Region2 = region2Pick !== null && region2Tenants.includes(region2Pick) ? region2Pick : region2Default;

  /**
   * **The floor under region 2 follows the TENANT** — `M227` `A` (`D1229`).
   *
   * `D1228` said `D1223`'s floor follows the region rather than the column, which was right and
   * one step short: the region holds three different things and the floor was keyed on only one
   * of them (`shown?.response`). Measured on the served page, `rate-shapes.tflw` `L13`: the plan
   * panel is **312 px of content in a 62 px window**, with the whole x-axis, the legend and both
   * sentences below the footer's own bottom edge — because a plan is not a response and so fell
   * through to the empty floor.
   *
   * A plan gets the response's **240** rather than a third number, because 240 is exactly what it
   * needs once the plot fills the region (`D1230`) and the prose moves beside it (`D1231`). One
   * number doing two jobs, not a coincidence written up as a rule.
   *
   * `footer` and `planWorkload !== null` are the same predicate (`:888` against the derivation
   * below), so `footer && region2 === 'plan'` is exactly *the plan panel is what is in there* —
   * and in the column layout it is constantly false, which is why the column sites can read this
   * same value without a branch of their own.
   */
  const region2Min = (footer && region2 === 'plan') || region2 === 'scan' || shown?.response ? RESPONSE_MIN : LOWER_MIN;

  const dragging = useRef(false);
  /** The floor under the divider, as a ref so the window `pointermove` above reads the CURRENT
   *  one rather than the one that was true when the listener was installed (`D1223`). */
  const lowerMin = useRef(LOWER_MIN);
  lowerMin.current = region2Min;
  /** The same fact as `dragging`, in the DOM, because the stylesheet needs it: while this divider
   *  is being dragged the trace frame must stop taking pointer events, or the drag dies at its top
   *  edge (`styles.css`, `M223` `E`). A ref cannot be seen by `:has()`. */
  const [splitting, setSplitting] = useState(false);

  /** The divider. `pointermove` on the window rather than on the handle, because a pointer that
   *  leaves a 6 px strip mid-drag has not stopped dragging — the same finding `jamForge` filed
   *  about a marquee and the reason the handle captures nothing. */
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      /* `D1227` — the container is the one that owns the tracks, which in the footer layout is the
         pane grid and not `.editor-col` (flattened by `display: contents`, so its own rect is
         zero-sized and would make every drag a no-op). */
      const host = footer ? stack.current : column.current;
      if (!dragging.current || host === null) return;
      const box = host.getBoundingClientRect();
      if (box.height <= 0) return;
      // Where the pointer is, not how far it has moved: the divider goes under the pointer, and
      // the clamp is against the column as it is right now rather than as it was on the press.
      setEditorPx(fitEditor(e.clientY - box.top, box.height, lowerMin.current));
    };
    const up = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      setSplitting(false);
      try {
        if (editorPx === null) window.localStorage.removeItem(splitKey);
        else window.localStorage.setItem(splitKey, String(editorPx));
      } catch {
        // Nothing to do and nothing to say: a remembered height is a convenience, and a browser
        // that refuses to store one still draws the page.
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [editorPx, footer, splitKey]);

  if (outline === null) {
    // `M236` `C` (`M235-09`, `D-M236-3`): **the placeholder does not answer to `[data-compose-pane]`.**
    // It used to, as `data-compose-pane="reading"`, which made `locator('[data-compose-pane]').waitFor()`
    // satisfiable by a pane that had drawn nothing — six gates waited that way and a `count()` under
    // one of them answered `0` about a file that was still being read. The rule is fixed here, at
    // the marker, rather than at the six call sites: a rule enforced at every consumer is a rule the
    // next consumer will not know about. `[data-compose-pane]` now means *a pane with a file in it*,
    // and the placeholder says so in its own name.
    return (
      <div className="compose-pane reading" data-compose-placeholder="reading">
        <p className="muted" data-compose-state>
          reading {path || 'the project'}…
        </p>
      </div>
    );
  }

  const decl = at?.decl ?? null;
  /** The selected declaration's workload, or `null` — the one fact `D1209`'s segment turns on. */
  const planWorkload = planWorkloadOf(at);
  const statements = decl === null ? [] : decl.body.preamble;

  /**
   * **One statement's row, wherever the fold put it** — `M219` `B`.
   *
   * The sequence draws statements in four places now (a body's preamble, a request's attachments,
   * a session's preamble, and a request's attachments *inside* a session), and before this round
   * two of those were two copies of the same eleven lines. A third and fourth copy is how a row in
   * one place quietly stops carrying the menu, or the refusal, or the `✕` that the others have.
   */
  const statementRow = (s: OutlineStatement, keyPrefix: string): ReactNode => {
    if (decl === null) return null;
    /**
     * **A scope is a qualifier on the row it scopes** — `M219` `D` (`D1163`).
     *
     * `within` is the third-commonest browser construct (433) and **397 of its 405 blocks wrap
     * exactly one statement**; `switch to new tab` and `download` wrap one in every occurrence. So
     * the common form is one row carrying both — the gesture, and the scope it happens in — and
     * the block form is kept for the eight that earn it.
     *
     * The picture therefore depends on what the block holds, which is the cost of this decision
     * and is the thing the gate covers in both arms.
     */
    const one = s.body !== null && s.body.length === 1 ? s.body[0]! : null;
    if (s.body !== null && one === null) {
      return (
        <li key={`${keyPrefix}-blk-${s.line}`} className="seq-group scoped" data-seq-scope={s.line} data-seq-scope-kind={s.kind} data-seq-scope-holds={s.body.length}>
          <SeqRow
            line={s.line}
            kind={s.kind}
            selected={selected.kind === 'statement' && selected.statement.line === s.line}
            onLine={onLine}
            indent
            lead={<span className="seq-kind">{seqLead(s.kind)}</span>}
            text={afterLead(seqLead(s.kind), s.text)}
            statement={s}
            menu={seqMenu({ kind: 'step', statement: s, line: s.line }, s.text)}
            door={door}
            refusal={refusalFor(s.line)}
            trailing={
              onRemoveSteps === null || s.stepPath === null ? null : (
                <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
              )
            }
          />
          <ol className="seq attached">{s.body.map((x) => statementRow(x, `${keyPrefix}-in-${s.line}`))}</ol>
        </li>
      );
    }
    /* The qualifier arm: the row IS the block — so it keeps the block's address, its kind and its
       `✕` — and what it SHOWS is the gesture inside it, with the scope beside it. */
    const shown = one ?? s;
    return (
      <SeqRow
        key={`${keyPrefix}-${s.line}`}
        line={s.line}
        kind={s.kind}
        selected={selected.kind === 'statement' && selected.statement.line === s.line}
        onLine={onLine}
        indent
        lead={<span className="seq-kind">{seqLead(shown.kind)}</span>}
        text={afterLead(seqLead(shown.kind), shown.text.split('\n')[0] ?? '')}
        scope={one === null ? null : s.text}
        statement={s}
        menu={seqMenu({ kind: 'step', statement: s, line: s.line }, shown.text.split('\n')[0] ?? s.kind)}
        door={door}
        refusal={refusalFor(s.line)}
        trailing={
          s.inner !== null ? (
            onRemoveScoped === null ? null : (
              <Remove what="statement" onGo={() => onRemoveScoped(s)} refusal={refusalFor(s.line)} onClear={clearRefusal} />
            )
          ) : onRemoveSteps === null || s.stepPath === null ? null : (
            <>
              {one !== null && onUnscope !== null ? (
                <button type="button" className="seq-x" onClick={() => onUnscope(s)} data-seq-unscope={s.line} data-tip={`take \`${s.text}\` off and keep the gesture inside it`}>
                  ⤺
                </button>
              ) : s.body === null && onScope !== null && VOCABULARY[door].constructs.has('WithinBlock') ? (
                <button type="button" className="seq-x" onClick={() => onScope(s)} data-seq-scope-add={s.line} data-tip="scope this gesture to one part of the page — a `within`">
                  ⤹
                </button>
              ) : null}
              <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
            </>
          )
        }
      />
    );
  };

  /** One request and everything attached to it — `D1073`'s unit, drawn the same inside a session
   *  as outside one, because 18 of the corpora's `api` requests stand inside a session and the
   *  `expect status` under them reads that response either way. */
  const requestGroup = (r: OutlineRequest): ReactNode => {
    if (decl === null) return null;
    const rr = ran.get(r.line) ?? null;
    return (
      <li key={`req-${r.line}`} className="seq-group" data-seq-request={r.line} data-seq-method={r.method}>
        <SeqRow
          line={r.line}
          kind={r.kind === 'WaitUntilApiStmt' ? 'wait' : 'request'}
          {...(decl.kind === 'test' ? { menu: seqMenu({ kind: 'request', decl, request: r, line: r.line }, `${r.method} ${r.path}`) } : {})}
          selected={selected.kind === 'request' && selected.request.line === r.line}
          onLine={onLine}
          lead={
            <>
              <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
              {rr === null || rr.response === null ? null : (
                /* **The row whose response is in region 2 wears a SOLID badge** — `M225` `B`
                   (`D1218`). A third state, and it must not look like the second: on a
                   declaration address the selection is deliberately still the `test` row so the
                   composer stays in region 1, and a shared tone would make clicking a strip entry
                   look like a move that did not happen. It is not in the gutter either — `D1200`
                   closed a measured collision of two accent marks 4.9 px apart in an 18 px gutter
                   with *in this gutter the accent is the selection's alone*. */
                <span
                  className={`status-code ${statusTone(rr.response.status)}`}
                  data-seq-status={rr.response.status}
                  data-seq-showing={shownRequest !== null && shownRequest.line === r.line ? 'yes' : 'no'}
                  data-tip={`${rr.scope === 'send' ? 'from a send' : 'from the last run'} — ${rr.at}${shownRequest !== null && shownRequest.line === r.line ? ' — this is the response below' : ''}`}
                >
                  {rr.response.status}
                </span>
              )}
            </>
          }
          text={r.path}
          refusal={refusalFor(r.line)}
          plus={
            onAddAfter === null || decl.kind !== 'test' ? null : (
              <Plus onGo={() => onAddAfter(decl, r)} after={`${r.method} ${r.path}`} />
            )
          }
          trailing={
            removable === null ? null : (
              <Remove what="request" onGo={() => remove(decl, r.line, requestRemoval(r))} refusal={refusalFor(r.line)} onClear={clearRefusal} />
            )
          }
        />
        {r.attached.length === 0 ? null : (
          <ol className="seq attached">{r.attached.map((s) => statementRow(s, 'att'))}</ol>
        )}
      </li>
    );
  };

  /**
   * **A session: the page, and everything done to it** — `M219` `B` (`D1160`).
   *
   * Drawn as a group for the same reason a request is: the statements under it are *about* it. Its
   * head is an ordinary statement row — an `open`, or a `call` the project index says opens a page
   * (`D1161`) — so it stays selectable and editable exactly as it was, and what the group adds is
   * only that the reader can see which page the gestures under it are against.
   *
   * `review-submission.tflw:29` is the file that makes this load-bearing rather than cosmetic: it
   * carries a comment explaining that unscoped, an assertion read a string the test had just typed
   * into the very field it was checking had cleared. **A phase that is invisible in the sequence is
   * a correctness hazard.**
   */
  const sessionGroup = (session: OutlineSession): ReactNode => {
    if (decl === null) return null;
    const s = session.head;
    return (
      <li key={`ses-${s.line}`} className="seq-group session" data-seq-session={s.line} data-seq-session-kind={s.kind}>
        <SeqRow
          line={s.line}
          kind="session"
          selected={selected.kind === 'statement' && selected.statement.line === s.line}
          onLine={onLine}
          /* **The keyword says what the group is** — `M223` `F` (`D1201`). The rail beside it and
             the accent on this word make the head legible as *different* and not as *what*, which
             is the question a reader asks the first time they meet one. It rides `.seq-kind` and
             not `.seq-pick` on purpose: `D1127` makes a row's hover DERIVED — the part the
             ellipsis took, at whatever width the grip is at — so an authored tip there would
             reopen that decision, while every chip and control beside it already carries one. */
          lead={<span className="seq-kind" data-tip="everything below happens on this page — a new `open` starts the next one">{seqLead(s.kind)}</span>}
          text={afterLead(seqLead(s.kind), s.text.split('\n')[0] ?? '')}
          statement={s}
          menu={seqMenu({ kind: 'step', statement: s, line: s.line }, s.text.split('\n')[0] ?? s.kind)}
          door={door}
          refusal={refusalFor(s.line)}
          trailing={
            onRemoveSteps === null || s.stepPath === null ? null : (
              <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
            )
          }
        />
        {session.body.preamble.length === 0 && session.body.requests.length === 0 ? null : (
          <ol className="seq attached">
            {session.body.preamble.map((x) => statementRow(x, `ses-${s.line}-pre`))}
            {session.body.requests.map((r) => requestGroup(r))}
          </ol>
        )}
      </li>
    );
  };

  /**
   * **The phase a line sits in, as the subject offer's word for it** — `M219` `G` (`D1166`).
   *
   * `undefined` on every door but BROWSER, which is `D1167` and not an oversight: the equivalent
   * measurement for API-only tests is one phase at 96.3% api subjects, so a split there would be a
   * change with no measurement behind it in the door the user has just declared finished.
   */
  const phaseFor = (line: number): 'api' | 'browser' | undefined =>
    door !== 'browser' || decl === null ? undefined : phaseOf(decl.body, line) === 'session' ? 'browser' : 'api';

  /** Every row the column draws, for the count the gates read off it. */
  const rowCount = decl === null ? 0 : statementsOf(decl.body).length + requestsOf(decl.body).length;

  return (
    <div className="compose-pane" data-compose-pane={selected.kind} data-compose={at?.request ? 'request' : 'no-request'}>
      {/* The pane's own one line: which file, and what is unsaved about it. It is a ROW and not a
          header block, because the two regions below it are what the reader came for and a header
          that explains the pane is height spent on the builder's vocabulary. */}
      <div className="compose-pane-bar" data-compose-bar>
        <code className="compose-pane-path" data-compose-file={path}>{path}</code>
        {/* **The head names what the body is showing** — `D1085`, kept, shrunk from a paragraph to
            a clause. It used to be four lines explaining the pane to its own builder; what a reader
            needs from it is which declaration this column is the sequence of, and how many
            declarations the file holds around it. */}
        <span className="muted" data-compose-summary data-compose-subject={at ? 'declaration' : 'file'} data-compose-decl-kind={at?.decl.kind} data-compose-decl-line={at?.decl.line}>
          {at ? (
            <>
              {/* **The band says the same words, painted** (`M216`). It was one flat grey sentence, so
                  the one fact a reader wants off it — *which declaration am I composing* — had the
                  same weight as the counts around it. The roles are the language's own: the keyword
                  is a keyword and the name is the string it is written as in the file, which is why
                  the quotes are here and not in the sidebar's row — this line is prose ABOUT a
                  declaration, so it quotes it the way the file does. Nothing is rearranged: the
                  sentence, its order and its counts are untouched. */}
              <code data-compose-subject-what>
                {at.decl.kind === 'test' ? (
                  <>
                    <span className="t-kw">test</span> <span className="t-str">&quot;{at.decl.name}&quot;</span>
                  </>
                ) : (
                  <span className="t-kw">{at.decl.kind === 'crawl' ? 'crawl' : at.decl.label}</span>
                )}
              </code> · line {at.decl.line} ·{' '}
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
          <span className="compose-pane-dirty" data-compose-dirty="yes">
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

      {/* **The split is the reader's** (`M216` `E`, `D1135`). The first column was
          `minmax(220px, 300px)` — one number chosen by the builder for every file — and a file of
          long assertions and a file of `GET /a` want different ones. The mechanism is `A2`'s grip
          used a second time and not a second implementation of it, which is why the clamp, the
          keyboard handling and the per-project persistence come for free. */}
      {/* **`D1225` — the same grid, with `.editor-col` flattened into it when the declaration
          carries a workload.** The DOM does not change shape: `display: contents` promotes the
          editor column's children to items of THIS grid, so the divider, region 2 and the send row
          become full-pane rows under a top row that still holds the sequence, its grip and the
          editor. Nothing is re-parented, so every gate and every selector that reads
          `[data-seq-open] …` keeps reading what it read — `display: contents` removes a box, not
          a node. */}
      <div
        className="compose-pane-grid"
        ref={stack}
        data-compose-footer={footer ? 'yes' : 'no'}
        /* `D1228` — `D1223`'s 240 px floor is about what region 2 holds, so it travels with the
           region; this is the same fact `.editor-col[data-editor-response]` carries in the column
           layout, read by the grid that owns the tracks here. **`D1229` renamed it**: it said
           `-response` while the plan needs the same floor and was getting 112, so the attribute
           now says what it controls rather than which tenant used to earn it. */
        data-compose-footer-tall={region2Min === RESPONSE_MIN ? 'yes' : 'no'}
        style={{
          ['--seq-w' as string]: `${seqWidth}px`,
          ...(footer && editorPx !== null
            ? { gridTemplateRows: `minmax(0, ${editorPx}px) 6px minmax(${region2Min}px, 1fr) auto` }
            : {}),
        }}
      >
        {/* ── region 2: the sequence (`D1112`) ─────────────────────────────────────────── */}
        <div className="seq-col" data-seq-col={decl === null ? 0 : requestsOf(decl.body).length}>
          <ol className="seq" data-body-sequence={decl === null ? 0 : requestsOf(decl.body).length} data-seq-rows={rowCount} data-seq-sessions={decl === null ? 0 : decl.body.sessions.length}>
            {decl === null ? null : (
              <SeqRow
                line={decl.line}
                kind="test"
                band={decl.line}
                {...(decl.kind === 'test' ? { menu: seqMenu({ kind: 'test', decl, line: decl.line }, decl.name) } : {})}
                selected={selected.kind === 'test'}
                onLine={onLine}
                lead={<span className="seq-kind">{decl.kind === 'test' ? 'test' : decl.kind === 'crawl' ? 'crawl' : decl.label}</span>}
                text={decl.kind === 'hook' ? '' : decl.name}
                refusal={refusalFor(decl.line)}
                trailing={
                  <>
                    {/* **▶ before ✕** (`M220` `A`) — the two gestures the declaration row owns, in
                        the order a reader reaches for them: run it, then, much less often, remove
                        it. A hook is skipped rather than drawn held, because `--only` names a test
                        by name and a hook has none — the same fact the foot says in words. */}
                    {onPlay === null || decl.kind !== 'test' ? null : (
                      <Play what="test" running={playing} onGo={() => onPlay(decl)} price={playPrice(decl.workload)} />
                    )}
                    {/* **A crawl is skipped for the same reason a hook skips ▶** — `M228` `C`
                        (`D1238`). `onRemoveDecl` addresses a declaration by `replaceInSource`'s
                        index and a crawl carries `-1`, so a `✕` here could only ever be a control
                        that does nothing — which is worse than its absence, and is the shape
                        `D1082` refuses. The band below says why in words. */}
                    {onRemoveDecl === null || decl.kind === 'crawl' ? null : (
                      <Remove
                        what="test"
                        onGo={() => {
                          setRefused(null);
                          onRemoveDecl(decl);
                        }}
                        refusal={refusalFor(decl.line)}
                        onClear={clearRefusal}
                      />
                    )}
                  </>
                }
              />
            )}
            {/* **The setup phase**, folded by request exactly as it always was (`M219` `B`). */}
            {decl === null ? null : statements.map((s) => statementRow(s, 'pre'))}
            {decl === null ? null : decl.body.requests.map((r) => requestGroup(r))}
            {/* **The session phase.** */}
            {decl === null ? null : decl.body.sessions.map((s) => sessionGroup(s))}
            {rowCount === 0 ? (
              <li className="muted seq-empty" data-seq-empty>
                {decl === null ? 'this file declares nothing yet' : 'nothing runs in this test yet — add a request below'}
              </li>
            ) : null}
          </ol>

          {/* `D1118` — creation where the thing is created. `+ request` / `+ let` / `+ wait until`
              belong to the sequence, so they are at the foot of it; `+ new test` makes another of
              the thing the column's first row is, so it is here too. `+ new file` is in the
              explorer, where files are. The Compose head stops being a toolbar. */}
          {/* `data-seq-adds` lists the keys in the order they are drawn — restored from the pane
              `M219` `A` replaced, because a gate that reads the `+` vocabulary needs **one**
              attribute it can wait on. Reading the buttons themselves is a snapshot of a list that
              is redrawn whenever the address moves, which is a race a gate loses about one run in
              three. */}
          <div className="seq-foot" data-seq-foot data-seq-adds={decl !== null && decl.kind === 'test' ? adds.map((a) => a.key).join(',') : ''}>
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
              : adds.map((a) => {
                  /* **`+ record` is the one gesture that is also a state** (`D1095`): it opens a
                     real browser that writes into this declaration until it is stopped, so the
                     button that started it says `stop recording` and every other `+` on the foot
                     is disabled while it runs. Carried over from the pane this one replaced, which
                     is where the BROWSER door's recorder lived. */
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
            {onNew === null ? null : (
              <button type="button" className="seq-add new" onClick={() => onNew('test')} data-compose-new-test data-tip="another test in this file">
                + new test
              </button>
            )}
          </div>
        </div>

        {/* ── region 3: the editor, and the response under it (`D1113`, `D1116`) ───────── */}
        <Grip spec={COMPOSE} size={seqWidth} onSize={setSeqWidth} />

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
          /* No inline rows at rest — the stylesheet's `minmax(0, auto) 6px minmax(112px, 1fr)` is
             the default, and an inline copy of it would be the same rule written twice. An
             override is `minmax(0, Npx)` rather than `Npx` so that a height stored on a taller
             window shrinks here instead of evicting the pane below it (`D1196`). */
          /* `D1223` — the floor under the divider is what region 2 holds, so the attribute the
             stylesheet reads and the number a drag is clamped against are the same fact. */
          data-editor-response={shown?.response ? 'yes' : 'no'}
          /* `D1225` — in the footer layout this element generates no box at all, so an override
             written here would style nothing; the grid above carries it instead. */
          style={footer || editorPx === null ? undefined : { gridTemplateRows: `minmax(0, ${editorPx}px) 6px minmax(${region2Min}px, 1fr)` }}
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
              <TestBand decl={selected.decl} door={door} editing={editing} lastRun={lastRun} />
            ) : selected.kind === 'statement' ? (
              <StatementEditor statement={selected.statement} door={door} editing={editing} ran={rowRan} onLine={onLine} onRemove={removable === null ? null : () => remove(selected.decl, selected.statement.line, statementRemoval(selected.statement))} refusal={refusalFor(selected.statement.line)} onClearRefusal={clearRefusal} phase={phaseFor(selected.statement.line)} />
            ) : (
              <RequestEditor
                phase={phaseFor(selected.request.line)}
                request={selected.request}
                door={door}
                tab={tab}
                onTab={setTab}
                edit={edit}
                onEdit={onEdit}
                editing={editing}
                ran={rowRan}
                onLine={onLine}
                onRemoveStatement={removable === null ? null : (s) => remove(selected.decl, s.line, statementRemoval(s))}
                refusalFor={refusalFor}
                onClearRefusal={clearRefusal}
              />
            )}
          </div>

          {/* The divider (`D1116`). A `separator` with an `aria-orientation`, because it is a real
              control: the keyboard moves it too, which a `<div>` with a pointer handler cannot. */}
          <div
            className={`split${splitting ? ' dragging' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="how tall the editor above this line is"
            tabIndex={0}
            /* `auto` is not a missing value — it is the state `D1195` makes the default, and a
               reader (or a gate) asking this attribute is asking *who decided this height*. */
            data-compose-split={editorPx === null ? 'auto' : String(editorPx)}
            data-tip="drag to resize · arrow keys to nudge · Home to fit the editor to what it holds"
            onPointerDown={() => {
              dragging.current = true;
              setSplitting(true);
            }}
            onKeyDown={(e) => {
              /* `Home` is the same gesture the column grip already has (`D1135`), and here it
                 returns the track to `D1195`'s content sizing rather than to a builder's number —
                 there is no longer a number to return to. */
              if (e.key === 'Home') {
                e.preventDefault();
                setEditorPx(null);
                try {
                  window.localStorage.removeItem(splitKey);
                } catch {
                  /* see the drag handler */
                }
                return;
              }
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              const col = footer ? stack.current : column.current;
              const editor = col === null ? null : col.querySelector('.editor');
              if (col === null || editor === null) return;
              // The nudge starts from where the divider IS, which while the track is content-sized
              // is a fact about the editor's box and not about any state this component holds.
              const from = editorPx ?? editor.getBoundingClientRect().height;
              const next = fitEditor(from + (e.key === 'ArrowDown' ? 16 : -16), col.getBoundingClientRect().height, region2Min);
              setEditorPx(next);
              try {
                window.localStorage.setItem(splitKey, String(next));
              } catch {
                /* see the drag handler */
              }
            }}
          />

          <div className="responsebox" data-compose-responsebox={shown?.response ? 'yes' : 'no'}>
            {/* ── `D1209` — region 2's two tenants, on a workload-bearing declaration ────────
                A workload-bearing test earns a **plan** panel here: the planned curve with the
                achieved run overlaid when one is comparable, which is `D1103`'s *planned with
                achieved overlaid in one frame is the picture a load tool exists to show*.

                **The segment follows the construct, not the door** (`D1044`). It is here on the
                API door when a workload test is open, and it is never here on a functional test —
                which is also how its gate is taken, on API, so that it cannot pass for a door's
                reason. A segment asserted only on LOAD would be green under every mutation that
                made it door-granted (`M223` `F`'s vacuity lesson).

                `send` is unaffected and stays on for LOAD: it strips the workload and the
                thresholds by design, which on that door is the point rather than a caveat —
                *issue this request once, without load, before committing to run it at a rate.* */}
            {/* **Every tenant says what it is** — `M228` `F` (`D1246`).
                The nav shipped untipped while 61 other controls on the page carry one, and the
                cost is not evenly spread: `scan` and `plan` are the DEFAULT segment on a
                declaration address, so a reader arrives with one already selected, presses it, and
                nothing happens — inches from `run selection`, which produces a whole run panel.
                Nothing distinguished *a view you are already looking at* from *a dead button*.
                Reported in exactly those words by the user driving `M228`'s own corpus.

                They say what the segment IS, not what pressing it does, because two of the three
                are views and the sentence has to be true of the one already open. */}
            {region2Tenants.length > 1 ? (
              <nav className="seg" data-compose-region2={region2}>
                {region2Tenants.map((which) => (
                  <button
                    key={which}
                    type="button"
                    className={region2 === which ? 'seg-on' : ''}
                    aria-pressed={region2 === which}
                    onClick={() => setRegion2Pick(which)}
                    data-compose-region2-tab={which}
                    data-tip={REGION2_TIP[which]}
                  >
                    {which}
                  </button>
                ))}
              </nav>
            ) : null}
            {planWorkload !== null && region2 === 'plan' ? <PlanPanel path={path} name={decl !== null && decl.kind === 'test' ? decl.name : null} workload={planWorkload} /> : null}
            {/* **What this declaration's scan assertions are gated by** — `M228` `A` (`D1239`).
                Earned by the construct, so it is here on the API door the moment a test carries a
                severity matcher, which is where its gate is taken. See `ScanPanel.tsx`. */}
            {region2 === 'scan' ? (
              <ScanPanel
                authorization={authorization}
                matchers={scanMatchers}
                onAuth={() => onProjectTab('auth')}
                onConfig={() => onProjectTab('config')}
              />
            ) : null}
            {/* **Ticking a value writes into the Assert tab directly above it** (`D1116`), which is
                the whole reason the response is in this column rather than beside it: `M213` `S2`'s
                tick-to-assert put the value and the assertion it produces on two different screens. */}
            {region2 !== 'response' ? null : shown !== null && shown.response !== null && shownRequest !== null ? (
              <>
                {/* ── The strip — `M225` `B` (`D1217`) ────────────────────────────────────────
                    **Only when a press issued more than one request.** With one it is one entry
                    and the panel is exactly what it was, which is the whole LOAD corpus but one
                    test and every functional test in the sibling: the ordinary path must not grow
                    a control.

                    The header names the press and its age, so the box states its own provenance
                    instead of leaving a reader to work it out from a status code. */}
                {sentHere.length > 1 ? (
                  <div className="sendstrip" data-compose-sendstrip={sentHere.length}>
                    <header className="muted" data-compose-sendstrip-head>
                      send {sent!.form} · {sentHere.length} requests · {ago(sent!.at, Date.now())}
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
                            onClick={() => setPick(e.request.line)}
                            data-tip={`what came back from ${e.request.method} ${e.request.path}`}
                          >
                            <span className={`method m-${e.request.method.toLowerCase()}`}>{e.request.method}</span>{' '}
                            <code>{e.request.path}</code>{' '}
                            <span className={`status-code ${statusTone(e.ran.response!.status)}`}>{e.ran.response!.status}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {/* **`D1109`'s chip is retired and its sentence is not.** The chip existed because a
                    response drawn open on every request put the old pane over its height bar — a
                    problem the three regions do not have, since the response has a region of its
                    own that scrolls inside itself. What the chip carried and this keeps is `D956`:
                    *from the last run* and *from this send* are different evidence and are told
                    apart, rather than both being rendered as "the response". */}
                <header
                  className="response-head-bar"
                  data-compose-response={shown.response.status}
                  data-compose-response-scope={shown.scope}
                  data-compose-response-line={shownRequest.line}
                  data-tip={`${shown.response.method} ${shown.response.url} — ${shown.at}`}
                >
                  <span className={`status-code ${statusTone(shown.response.status)}`} data-compose-response-status={shown.response.status}>
                    {shown.response.status}
                  </span>{' '}
                  <span className="muted" data-compose-response-when>
                    {shown.scope === 'send' ? 'from this send' : 'from the last run'}, {ago(shown.at, Date.now())}
                  </span>
                </header>
              <ResponsePanel
                ran={shown}
                open
                onVerify={
                  onVerify === null
                    ? null
                    : (spec) => {
                        setTab('assert');
                        onVerify(shownRequest, spec);
                      }
                }
                onCapture={onCapture === null ? null : (specs) => onCapture(shownRequest, specs)}
              />
              </>
            ) : VOCABULARY[door].records ? (
              /* **The session panel** — `M219` `F` (`D1165`), re-keyed by `M228` `F` (`D1245`).
                 A door that RECORDS puts a live session here: the page is its evidence, and
                 `D1102`'s rule is the same one.

                 **It read `!VOCABULARY[door].sends` until `M228` `F`, and that was a stand-in for
                 `door === 'browser'`** — true while BROWSER was the only door with no `send`.
                 `D1241` made SCANS the second one, and SCANS inherited the recorder: measured on
                 the served corpus, every scan test offered `record a session` under copy promising
                 to splice the gestures into the declaration, while `VOCABULARY.scan.constructs`
                 holds none of the steps a recording produces. A rule keyed on a proxy for one
                 tenant breaks the day the proxy gains a second, which is the third recurrence of
                 that shape in this arc (`M227` `A`). */
              <SessionPanel
                session={session}
                onKeep={onKeepLine}
                onKeepAll={onKeepAll}
                onPlay={onPlaySession}
                playing={playing}
                onDrop={onDropLine}
                onStop={onStopSession}
                onStart={decl !== null && decl.kind === 'test' && onAdd !== null ? () => onAdd(decl, 'record') : null}
                canStart={decl !== null && decl.kind === 'test'}
                why={
                  decl === null
                    ? 'point at a test first — a recording writes into a declaration, and the splice names it by name'
                    : 'a recording writes into a test by name, and a hook has none'
                }
              />
            ) : (
              <div className="response-none">
                {sendPrefix !== null && onSend !== null ? (
                  <div className="prefix" data-prefix={sendPrefix.requests.length}>
                    <div className="prefix-buttons">
                      <SendButtons prefix={prefix} prefixAll={prefixAll} onSend={onSend} sending={sending} busy={busy} compact={false} />
                    </div>
                    <p className="muted">
                      nothing has run this request. Send fires these for real, in this order, against the env the strip names — the last one
                      is the request above. <strong>It does not check the assertions</strong>: it shows you what came back. Run the test from
                      the Run tab to grade it.
                    </p>
                    <ol className="prefix-list">
                      {sendPrefix.requests.map((r, i) => (
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
          {shown?.response && sendPrefix !== null && onSend !== null ? (
            <div className="editor-send" data-compose-send-row>
              <SendButtons prefix={prefix} prefixAll={prefixAll} onSend={onSend} sending={sending} busy={busy} compact />
              <span className="muted">{sendPrefix.requests.map((r) => `${r.method} ${r.path}`).join(' → ')} — no assertions checked</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * **The send controls** — `M225` `A` (`D1215`).
 *
 * Two presses, and the address chooses which are offered. `send this` is `D1075`'s send verbatim:
 * the prefix up to the request the reader is pointing at, because four requests in five read a
 * binding made earlier and cannot run alone. `send all` issues the declaration's every request,
 * in order, hooks first — one iteration, the unit a workload multiplies.
 *
 * **Neither is a run**, and the tips say so rather than leaving it to be inferred: both drop the
 * workload and the thresholds (`D1211`) and strip the assertions (`D1119`). ▶ is the run and it
 * states its price (`D1212`).
 *
 * **`send all` is suppressed when it would fire exactly what `send this` fires**, which is every
 * one-request test and the last request of every other — the ordinary path must not grow a
 * control for a press that is already on screen. (`D1217` says the same thing about the strip;
 * this is that rule applied one region up. Recorded as an amendment to `D1215`, whose text offers
 * both forms at a request address unconditionally.)
 */
function SendButtons(props: {
  readonly prefix: Prefix | null;
  readonly prefixAll: Prefix | null;
  readonly onSend: (form: SendForm) => void;
  readonly sending: boolean;
  readonly busy: boolean;
  readonly compact: boolean;
}) {
  const { prefix, prefixAll, onSend, sending, busy, compact } = props;
  /**
   * **The comparison is the REQUESTS the two presses issue, not where they cut.**
   *
   * `upTo` was the first draft's test and the run caught it: `send all` runs to the end of the
   * body while `send this` stops at the request, so on a one-request test whose last line is an
   * `expect` the two cuts differ by one step and issue exactly the same request. Two buttons, one
   * press. The ordinary path must not grow a control (`D1217`'s rule, one region up).
   */
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
                ? 'issues this request and the ones above it that feed it, and shows what came back — nothing is graded and nothing is kept. The assertions under it are read by run, next door.'
                : 'issues every request in this test once, in order — one iteration, which is what a single virtual user does. Nothing is graded and nothing is kept, and the workload and the thresholds are dropped: ▶ next door is the run.'
            }
          >
            {sending ? 'sending…' : compact ? `${name} · ${n}` : `${name} — ${n} request${n === 1 ? '' : 's'}`}
          </button>
        );
      })}
    </>
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
          data-tip={
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
/**
 * **The gesture inside a single-statement block, as controls** — `M219` `D` (`D1163`).
 *
 * It is the same two rows `StatementEditor` draws for any statement, on a row whose address is the
 * block's: `rowKey` tells the two apart by `inner`, and `rescope` puts the built node back into
 * the block's body before the splice. So this needs no new machinery at all — what it needs is to
 * exist, because before this round the 430 statements inside a block were not rows anywhere.
 */
function InnerRow({ statement, door, editing, onLine, onClearRefusal, phase }: {
  readonly statement: OutlineStatement;
  readonly door: Lens;
  readonly editing: RowEditing;
  readonly onLine: (line: number) => void;
  readonly onClearRefusal: () => void;
  readonly phase?: 'api' | 'browser';
}) {
  const { row, onRow: onEdit } = editing;
  const key = rowKey(statement);
  const own = onEdit === null || isForeign(statement.lens, door) ? null : statementEditOf(statement.node);
  const values = row !== null && row.key === key ? row.values : own;
  if (values === null || onEdit === null) {
    return (
      <div className="stmt-line" data-inner-line={statement.line}>
        <code className="stmt-text">{statement.text}</code>
        <p className="muted">this statement belongs to another door — open that door to edit it</p>
      </div>
    );
  }
  return (
    <div className="inner-row" data-inner-line={statement.line} data-inner-kind={statement.kind}>
      <span className="seq-kind">inside it</span>
      {values.kind === 'expect' ? (
        <ul className="asserts stmts">
          <AssertRow
            statement={statement}
            edit={values.expect}
            onEdit={(next) => onEdit(statement, { kind: 'expect', expect: next })}
            verdict={null}
            trailing={null}
            onRemove={null}
            refusal={null}
            onClearRefusal={onClearRefusal}
            onLine={onLine}
            drops={VOCABULARY[door].dropsSubjects}
            phase={phase}
          />
        </ul>
      ) : (
        <ScriptRow statement={statement} edit={values} onEdit={(next) => onEdit(statement, next)} trailing={null} pick={editing.pick} phase={phase} />
      )}
    </div>
  );
}

function StatementEditor({ statement, door, editing, ran, onLine, onRemove, refusal, onClearRefusal, phase }: {
  readonly statement: OutlineStatement;
  readonly door: Lens;
  readonly editing: RowEditing;
  readonly ran: Ran | null;
  readonly onLine: (line: number) => void;
  readonly onRemove: (() => void) | null;
  readonly refusal: { readonly name: string; readonly line: number; readonly text: string } | null;
  readonly onClearRefusal: () => void;
  /** See `SubjectFields.phase` — `M219` `G` (`D1166`). */
  readonly phase?: 'api' | 'browser';
}) {
  const { row, onRow: onEdit, onNote, noting, onNoting } = editing;
  const foreign = isForeign(statement.lens, door);
  const key = rowKey(statement);
  const own = statement.stepPath === null || onEdit === null || foreign ? null : statementEditOf(statement.node);
  const values = row !== null && row.key === key ? row.values : own;
  const writingNote = noting !== null && noting === key;
  const verdict = ran?.steps.get(statement.line) ?? null;

  return (
    <div
      className="editor-body"
      data-editor-statement={statement.kind}
      data-editor-line={statement.line}
      /* **The editor says whether this row is live**, the same word the attached list says it with
         (`M219` `C`). It was absent here, which is how *nineteen of twenty-two browser kinds draw
         dead* survived a gate named *"the BROWSER door composes"*: nothing on the selected
         statement asserted anything about whether it could be edited. */
      data-stmt-editable={values !== null && onEdit !== null && statement.stepPath !== null ? 'yes' : 'no'}
      data-stmt-lens={statement.lens ?? 'none'}
    >
      <header className="editor-head">
        <span className="seq-kind">{seqLead(statement.kind)}</span>
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
        <button className="add-note" onClick={() => onNoting?.(key)} data-note-add={statement.line} data-tip="a comment above this line, explaining why it is here">
          + note
        </button>
      ) : null}
      {/* **A single-statement block draws BOTH halves here** — `M219` `D` (`D1163`). The sequence
          shows one row because the corpus writes one gesture; the editor shows the scope's own
          fields *and* the gesture's, because they are two statements and both are editable. The
          inner one's edit goes back through the block (`rescope`), which is why it needs no second
          address. */}
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
              phase={phase}
            />
          </ul>
        ) : (
          <>
            <ScriptRow statement={statement} edit={values} onEdit={(next) => onEdit(statement, next)} trailing={null} pick={editing.pick} phase={phase} />
            {statement.body === null || statement.body.length !== 1 ? null : (
              <InnerRow statement={statement.body[0]!} door={door} editing={editing} onLine={onLine} onClearRefusal={onClearRefusal} phase={phase} />
            )}
          </>
        )
      ) : (
        <div className="stmt-line">
          <code className="stmt-text">{statement.text}</code>
          <p className="muted">
            {foreign ? 'this statement belongs to another door — open that door to edit it' : unaddressableWhy(statement.nested)}
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
function RequestEditor({ request: r, door, tab, onTab, edit, onEdit, editing, ran, onLine, onRemoveStatement, refusalFor, onClearRefusal, phase }: {
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
  /** See `SubjectFields.phase` — `M219` `G` (`D1166`). A request's own attachments take the
   *  request's phase, which is the phase of everything between it and the next one. */
  readonly phase?: 'api' | 'browser';
}) {
  const v = edit ?? editOf(r);
  const change = onEdit === null ? null : (patch: Partial<RequestEdit>) => onEdit({ ...v, ...patch });
  const writingNote = editing.noting !== null && editing.noting === stepKey(r.stepPath);
  /** Which clauses the More tab draws. A clause the file states is always there; one it does not is
   *  added from the menu — `D1084` unchanged, and now with nothing locked in it. */
  const [added, setAdded] = useState<readonly string[]>([]);
  /** **What the file writes**, as against what the menu is only showing (`M216` `D`). The two were
   *  one predicate until removal existed, because nothing downstream cared which of them was true;
   *  removing a clause is an edit to the bytes in one case and forgetting a drawn row in the other,
   *  and the reader cannot tell them apart and should not have to. */
  const states = (clause: string): boolean => {
    switch (clause) {
      case 'service': return v.service !== '';
      case 'label': return v.label !== '';
      case 'timeout': return v.timeout !== '';
      case 'redirects': return !v.redirects;
      case 'retryAfter': return v.retryAfter !== '';
      default: return false;
    }
  };
  const shows = (clause: string): boolean => states(clause) || added.includes(clause);
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
          <span className="badge" data-request-polling="yes" data-tip="this request is re-issued until the assertions below it pass">
            polls
          </span>
        ) : null}
        {editing.onNote !== null && r.note === null && !writingNote ? (
          <button className="add-note" onClick={() => editing.onNoting?.(stepKey(r.stepPath))} data-note-add={r.line} data-tip="a comment above this request, explaining why it is here">
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
                      <button className="seq-x" onClick={() => change({ headers: v.headers.filter((_, j) => j !== i) })} data-header-edit-remove={i} aria-label="remove this header" data-tip={v.headers.length === 1 ? 'the last header — this request stops sending one' : 'this header'}>
                        ✕
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
                      <button
                        className="seq-x"
                        onClick={() => change(v.formFields.length === 1
                          ? { formFields: [], bodyKind: 'none', bodyText: '' }
                          : { formFields: v.formFields.filter((_, j) => j !== i) })}
                        data-body-edit-remove={i}
                        aria-label="remove this field"
                        data-tip={v.formFields.length === 1 ? 'the last field — removing it takes the body with it' : 'this field'}
                      >
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
                const key = rowKey(s);
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
                      phase={phase}
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
                        <ScriptRow statement={s} edit={values} onEdit={(next) => editing.onRow!(s, next)} trailing={verdict} pick={editing.pick} phase={phase} />
                      ) : (
                        <>
                          <code className="stmt-text">{s.text.split('\n')[0]}</code>
                          {verdict}
                          {/* **The one population no index pair can name** — the expects nested
                              inside a `wait until api` block, which are not in the body's own step
                              list. They are drawn in position and say why, which is `D1078`'s rule
                              one level down: a reader may always see what a reader may not edit. */}
                          {s.stepPath === null && editing.onRow !== null ? (
                            <span className="muted" data-stmt-unaddressable={s.nested ? 'nested' : 'crawl'}>
                              {unaddressableWhy(s.nested)}
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
              onRemove={(k) => {
                setAdded((prev) => prev.filter((x) => x !== k));
                if (states(k)) change(requestWithout(k));
              }}
              refusalFor={(k) => requestRefusal(k, v)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
