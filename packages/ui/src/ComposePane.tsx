// **Compose — the steps, edited in place, and the evidence beside them** — `M256` (`D1405`,
// `D1406`, `D1408`, `D1412`).
//
// `M214` built this pane as three regions — the explorer, the test's steps, and an editor card with
// the response under it — and it said why: `D1086`'s two halves (*every request is drawn* and *the
// pane fits 1.50 screens*) were jointly unsatisfiable, so each region scrolls inside itself. That
// argument stands; what `M256` removes is the card.
//
// ── WHY THE CARD WENT ─────────────────────────────────────────────────────────────────────────────
//
// **The card drew the test a second time.** Picking a request put its assertions in the card's
// Assert tab while the steps column went on drawing the same assertions as rows — two pictures of
// six assertions, and the reader's eye had to find the one it had picked in the other. A picked
// row now **turns into its own editor where it stands** (`D1405`): a request becomes `[method]
// [path]` with `headers · body · more` folded under it, an `expect` becomes subject · matcher ·
// value on its own line, and six assertions stay six lines. The two things that are not lines in
// the file — a test's header clauses (its workload is 18 controls) and a crawl's body — open as a
// card under their row, and do not pretend to be lines.
//
// **The right column is evidence** (`D1406`) — `Evidence.tsx`: the response for a request, the plan
// for a workload, the scan panel, the screenshot for a browser step. It opens on the last run.
//
// **Below 1100 px the column folds under the picked row** (`D1412`) — measured, the right column was
// 259 px at 1100, which no evidence view survives. It is the same component in a different place,
// never a summary of it (`§6` prediction 6).
//
// The address is unchanged (`D1045`, `D1080`): `L<line>` names the row that is open, and a line with
// no `L` is the file.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { workloadSeconds, workloadEditOf } from './workloadEdit';
import { menuTrigger, type MenuItem, type MenuRequest, type MenuTrigger } from './ContextMenu';
import type { CaptureSpec, ExpectSpec, ExpectStmt, Lens, MatcherName, Workload } from '@tflw/lang';
import { MATCHER_LENS, lensesOfTest, matcherSubjectRefusal } from '@tflw/lang';
import { requestRefusal, requestWithout } from './clauses';
import { COMPOSE, Grip } from './Grip';
import {
  AddClause,
  CLAUSE_MATCHER,
  Field,
  FileRow,
  MATCHERS,
  METHODS,
  NoteBlock,
  NoteOpen,
  SCAN_MATCHERS,
  SUBJECT_NODE,
  SEVERITIES,
  ScriptRow,
  SubjectFields,
  TestBand,
  VALUE_MATCHERS,
  bodyText,
  editOf,
  statementEditOf,
  statusTone,
  rowKey,
  stepKey,
  subjectSpelling,
  type ExpectEdit,
  type Ran,
  type RanIndex,
  type RequestEdit,
  type RowEditing,
  type Verdict,
} from './parts';
import { statementLead } from './statements';
import { DOOR_BY_ID } from './doors';
import { holds, moveOf, moveUnits, requestRemoval, statementRemoval } from './depends';
import { isForeign, phaseOf, requestsOf, statementsOf, type Addressed, type FileOutline, type BodiedDecl, type OutlineDecl, type OutlineRequest, type OutlineSession, type OutlineStatement, type OutlineTest } from './outline';
import type { Prefix, SendForm } from './outline';
import { vocabularyOf, type AddGesture, type DoorVocabulary } from './vocabulary';
import { groupFor, type PlayTrace } from './ran';
import { bodyProblem, laidOut } from './jsonview';
import { BodyText, SourceText } from './Source';
import type { Authorization } from './ScanPanel';
import { Evidence, type EvidenceTab, type SentEntry } from './Evidence';
import type { Session, SessionLine } from './session';

/** The declaration an address can land on — a test, a hook, an action or a crawl. */
export type SelectedDecl = OutlineDecl;

export type Selected =
  | { readonly kind: 'file' }
  | { readonly kind: 'test'; readonly decl: SelectedDecl }
  | { readonly kind: 'request'; readonly decl: SelectedDecl; readonly request: OutlineRequest }
  | { readonly kind: 'statement'; readonly decl: SelectedDecl; readonly statement: OutlineStatement };

/**
 * **What the address is pointing at** (`D1113`) — the file when there is no line, then the
 * declaration whose own run of lines it is, then a request, then a statement.
 *
 * The declaration is a RUN of lines, not one line: `@slow` above `test "checkout" retry 2` is two
 * lines of one header, and a `with each` table is as many lines as it has rows. So the test is
 * selected by any line from its first down to its first step.
 */
export function selectedAt(at: Addressed | null, line: number | null): Selected {
  if (at === null || line === null) return { kind: 'file' };
  const decl = at.decl;
  const rows = statementsOf(decl.body);
  const requests = requestsOf(decl.body);
  const firstStep = Math.min(...[...rows, ...requests].map((x) => x.line), Number.POSITIVE_INFINITY);
  if (line >= decl.line && line < firstStep) return { kind: 'test', decl };
  for (const r of requests) if (r.line === line) return { kind: 'request', decl, request: r };
  for (const s of rows) if (s.line === line) return { kind: 'statement', decl, statement: s };
  return at.request === null ? { kind: 'test', decl } : { kind: 'request', decl, request: at.request };
}

/** The word a statement's chip carries — the language's own spelling (`M239-03`). */
const seqLead = statementLead;

/**
 * The text a row shows, given the keyword its chip already carries (`M216`): the chip IS the
 * keyword and the text is what follows it, so a row never reads `expect expect status …`. The strip
 * is conditional on the text starting with the chip's word, so `wait until api …` is left whole.
 */
function afterLead(lead: string, text: string): string {
  return text.startsWith(`${lead} `) ? text.slice(lead.length + 1) : text;
}

/** A right-clicked row of the steps column — `M218` `F`: the declaration's row, a request, or a
 *  statement, and the menu's items differ by which. */
export type SeqTarget =
  | { readonly kind: 'test'; readonly decl: OutlineTest; readonly line: number }
  | { readonly kind: 'request'; readonly decl: OutlineTest; readonly request: OutlineRequest; readonly line: number }
  | { readonly kind: 'step'; readonly statement: OutlineStatement; readonly line: number };

/** A request's three folds (`D1405`) — what the card's Headers, Body and More tabs held. The fourth
 *  tab, Assert, is gone: a request's assertions are the rows under it, drawn once. */
export const REQUEST_FOLDS = ['headers', 'body', 'more'] as const;
export type RequestFold = (typeof REQUEST_FOLDS)[number];

type Held = { readonly name: string; readonly line: number; readonly text: string };

function SeqRow({ line, selected, onLine, kind, lead, text, trailing, plus, indent, statement, kinds, band, refusal, menu, scope, head, editor, verdict }: {
  readonly line: number;
  readonly selected: boolean;
  readonly onLine: (line: number) => void;
  readonly kind: string;
  readonly lead: ReactNode;
  readonly text: string;
  readonly trailing: ReactNode;
  /** `+` — a new request after this one (`D1137`); only a request row has one. */
  readonly plus?: ReactNode;
  readonly indent?: boolean;
  /** The statement this row is, when it is one — the row carries whose it is (`D1078`). */
  readonly statement?: OutlineStatement;
  readonly kinds?: ReadonlySet<Lens>;
  /** The declaration's own line, on the one row that IS a declaration (`D1112`). */
  readonly band?: number;
  readonly menu?: MenuTrigger;
  /** The refusal this row's `✕` produced, drawn UNDER the row (`D1117`). */
  readonly refusal?: Held | null;
  /** The scope this row happens in, when it is a single-statement block (`M219` `D`). */
  readonly scope?: string | null;
  /** The head of a group opens a `.seq-group` `<li>`, so it draws as a `<div>` (`M240` `E`). */
  readonly head?: boolean;
  /**
   * **The row's own editor, when the row is the one picked** — `M256` `A` (`D1405`).
   *
   * It REPLACES the row's text rather than opening beside it: the line number stays (it is the
   * pick control, and still answers `aria-pressed`), and the words become the fields they are made
   * of. One picture of the statement, in the place a reader was already looking.
   */
  readonly editor?: ReactNode;
  /** The row's verdict from the last run (`D1108`), at the end of the line. */
  readonly verdict?: ReactNode;
}) {
  const foreign = statement !== undefined && kinds !== undefined && isForeign(statement.lens, kinds);
  const Row = head === true ? 'div' : 'li';
  const editing = editor !== undefined && editor !== null;
  /* `M257` `A` — the row the run is at is lit, and every row judged so far already has its mark. */
  const lit = useContext(LiveAt) === line;
  return (
    <Row
      className={`seq-row${selected ? ' on' : ''}${indent ? ' under' : ''}${foreign ? ' locked' : ''}${editing ? ' editing' : ''}${lit ? ' live-at' : ''}`}
      data-live-at={lit ? 'yes' : undefined}
      data-seq-row={kind}
      data-seq-line={line}
      data-seq-selected={selected ? 'yes' : 'no'}
      data-seq-editing={editing ? 'yes' : undefined}
      {...(menu ?? {})}
      {...(band === undefined ? {} : { 'data-band-line': band })}
      {...(statement === undefined
        ? {}
        : { 'data-stmt': statement.kind, 'data-stmt-line': statement.line, 'data-stmt-lens': statement.lens ?? 'none', 'data-stmt-locked': foreign ? 'yes' : 'no' })}
    >
      {/* **The hover is DERIVED and never authored** (`D1127`): what is worth a tip is the part the
          ellipsis took, and only when it took one. */}
      <button type="button" className="seq-pick" onClick={() => onLine(line)} aria-pressed={selected} data-seq-pick={line} data-seq-goto={line} data-tip-derived="">
        <span className="ln muted">{line}</span>
        {editing ? null : (
          <>
            {lead}
            {scope === undefined || scope === null ? null : (
              <span className="seq-scope" data-seq-scope-of={scope} data-tip={`this gesture happens inside \`${scope}\``}>
                {scope}
              </span>
            )}
            <span className="seq-text stmt-text" data-tip-text>{text}</span>
          </>
        )}
      </button>
      {editing ? editor : null}
      {/* A step another kind owns is drawn in position and says where it can be worked on (`D1078`). */}
      {foreign && statement?.lens ? (
        <span className="badge also" data-stmt-door={statement.lens} data-tip={`a ${DOOR_BY_ID[statement.lens].label} step, in a file this page reads as none of that kind — edit it in Source`}>
          {DOOR_BY_ID[statement.lens].label}
        </span>
      ) : null}
      {editing ? null : verdict}
      {plus}
      {trailing}
      {refusal === undefined || refusal === null ? null : <Refusal held={refusal} onLine={onLine} />}
    </Row>
  );
}

/**
 * **A run, as the pane draws it** — `M257` `A` (`D1407`). The door builds it from the stream the
 * shell is following; the pane lights the row it is at, puts the status line under the bar, and
 * lets the evidence column follow it.
 */
export interface PlayState {
  /** The run's id — a new run follows again even after the reader stopped following the last. */
  readonly id: string;
  /** The test followed: the last of this file's the run has reached. */
  readonly test: string;
  readonly status: 'running' | 'passed' | 'failed' | 'cancelled';
  /** Steps of that test judged so far, the imported action's own excluded. */
  readonly judged: number;
  /** The line of the step the column follows — the newest judged, or the one that failed. */
  readonly at: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** `D1394`'s one graceful stop; `null` once it has ended, or for a shell's run the page cannot stop. */
  readonly onCancel: (() => void) | null;
  readonly onOpenRun: () => void;
  /** The play scratch's name when a ▶ here wrote it and `.gitignore` does not list it. */
  readonly unignored: string | null;
}

/** The line the run is at — read by every `SeqRow` rather than threaded through each call site. */
const LiveAt = createContext<number | null>(null);

/**
 * **A row's verdict, as the row's last word** — `M256` `A` (`D1405`, `D1108`).
 *
 * The card drew `✓ status = 200 · 4 ms` in its Assert tab; a row is one line and has room for the
 * mark. The sentence the run wrote is the mark's tip, and `data-verdict` is the same attribute the
 * report's headline carries — a step mark and a verdict, not an explorer dot (`M255`'s
 * `data-row-verdict`).
 */
function RowVerdict({ verdict }: { readonly verdict: Verdict | null }) {
  if (verdict === null) return null;
  return (
    <span className={`step-verdict ${verdict.ok ? 'pass' : 'fail'}`} data-verdict={verdict.ok ? 'pass' : 'fail'} data-verdict-ms={verdict.durationMs} data-tip={`${verdict.detail} · ${verdict.durationMs} ms`}>
      {verdict.ok ? '✓' : '✗'}
    </span>
  );
}

/** **↑ and ↓ — move this row one place** (`M250` `G13`, `D1391`). Only the directions that exist
 *  are drawn. Alt+↑/↓ on a focused row is the same move. */
function Move({ what, up, down }: { readonly what: string; readonly up: (() => void) | null; readonly down: (() => void) | null }) {
  return (
    <>
      {up === null ? null : (
        <button type="button" className="seq-x" onClick={up} data-seq-move="up" data-tip={`move this ${what} up one place (Alt+↑)`} aria-label={`move this ${what} up`}>
          ↑
        </button>
      )}
      {down === null ? null : (
        <button type="button" className="seq-x" onClick={down} data-seq-move="down" data-tip={`move this ${what} down one place (Alt+↓)`} aria-label={`move this ${what} down`}>
          ↓
        </button>
      )}
    </>
  );
}

/** The `✕` (`D1117`) — never disabled: it is pressed, it answers, and the answer is a sentence on
 *  the row naming the line that is holding the thing. */
function Remove({ what, onGo, refusal, onClear }: {
  readonly what: string;
  readonly onGo: () => void;
  readonly refusal: Held | null;
  readonly onClear: () => void;
}) {
  return (
    <button type="button" className={`seq-x${refusal ? ' refused' : ''}`} onClick={refusal ? onClear : onGo} data-tip={refusal ? 'dismiss' : `remove this ${what}`} data-seq-remove={what} aria-label={`remove this ${what}`}>
      ✕
    </button>
  );
}

/**
 * **▶ — run this test and nothing else** (`M220` `A`, `D1168`). It runs the buffer through a scratch
 * beside the file (`D1183`), so an unsaved edit is what runs; `running` holds it, one play at a
 * time (`D1188`). A workload states its price (`D1212`).
 */
function Play({ what, running, onGo, price }: {
  readonly what: string;
  readonly running: boolean;
  readonly onGo: () => void;
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

/** A workload's own duration, in the control's words (`D1212`) — `no clock` on the iteration
 *  shapes, whose run ends when the work is done. */
function playPrice(workload: Workload | null): string | undefined {
  if (workload === null) return undefined;
  const total = workloadSeconds(workloadEditOf(workload));
  return total === null ? 'no clock' : `~${Math.round(total * 10) / 10}s`;
}

/** **`+` — a new request after this one** (`M217` `B`, `D1137`, `D1138`): after the request AND the
 *  statements attached to it, so nothing below changes which response it reads. */
function Plus({ onGo, after }: { readonly onGo: () => void; readonly after: string }) {
  return (
    <button
      type="button"
      className="seq-plus"
      onClick={onGo}
      data-seq-plus={after}
      data-tip={`a new request after ${after}, below everything that reads its response`}
      aria-label={`add a request after ${after}`}
    >
      +
    </button>
  );
}

function Refusal({ held, onLine }: { readonly held: Held; readonly onLine: (line: number) => void }) {
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

/**
 * **One assertion is subject · matcher · value** (`D1114`), and since `M256` it is drawn ON its row
 * (`D1405`) — the row's line number and `✕` are the row's, so this draws the words between them.
 *
 * The rare three forms (`check`, `any`/`all`, `not` — 7, 78 and 34 of 1736) are behind `⋯`, and a
 * row that already uses one shows it inline, open (`D1076`: the vocabulary moves, it never shrinks).
 */
function AssertRow({ statement, edit, onEdit, verdict, trailing, drops, phase }: {
  readonly statement: OutlineStatement;
  readonly edit: ExpectEdit;
  readonly onEdit: (next: ExpectEdit) => void;
  readonly verdict: ReactNode;
  readonly trailing: ReactNode;
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
  const spent = v.soft || v.quantifier !== '' || v.negated;
  const [open, setOpen] = useState(false);
  const rare = spent || open;
  return (
    <div className="assert" data-assert-line={statement.line} data-assert-rare={rare ? 'yes' : 'no'}>
      <div className="row assert-fields" data-expect-line={statement.line}>
        <span className="assert-keyword" data-expect-kind-shown={v.soft ? 'check' : 'expect'}>
          {v.soft ? 'check' : 'expect'}
        </span>
        <SubjectFields subject={v.subject} argument={v.argument} locatorKind={v.locatorKind} carried={subjectSpelling(node.subject)} onChange={change} drops={drops} phase={phase} />
        {/* **Every matcher is drawn, and the ones `TF042` would refuse are disabled** (`D1243`) —
            over-offering beats silent omission (`D1076`). The rule is the checker's own. */}
        <select value={v.matcher} onChange={(e) => change({ matcher: e.target.value as MatcherName })} data-expect-matcher={v.matcher} aria-label="matcher">
          {MATCHERS.map(([id, text]) => {
            const subjectNode = SUBJECT_NODE[v.subject];
            const refused = subjectNode === undefined ? null : matcherSubjectRefusal(id, subjectNode);
            return (
              <option key={id} value={id} disabled={refused !== null} title={refused ?? undefined} data-matcher-refused={refused === null ? undefined : 'yes'}>
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
    </div>
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
  /** The file itself — the address with no line (`D1113`). */
  readonly onFile: () => void;
  /** `+ new test` at the foot of the steps (`D1118`). `+ new file` is the explorer's. */
  readonly onNew: ((mode: 'test' | 'file') => void) | null;
  /** `+ new action` everywhere, `+ new crawl` where the file or the chip is SCANS — `M241`. */
  readonly onNewDecl: ((kind: 'action' | 'crawl') => void) | null;
  readonly crawls: boolean;
  readonly scratchUnignored: string | null;
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  readonly editing: RowEditing;
  /** `send this` — the prefix up to the picked request; `null` on a declaration address (`D1215`). */
  readonly prefix: Prefix | null;
  /** `send all` — every request in the declaration, one iteration (`D1215`). */
  readonly prefixAll: Prefix | null;
  readonly onSend: ((form: SendForm) => void) | null;
  readonly sending: boolean;
  /** The last send, and every request it issued (`M225` `B`, `D1217`). */
  readonly sent: { readonly lines: readonly number[]; readonly form: SendForm; readonly at: string } | null;
  /** `D1221` — the picked declaration's last run, for the composer's citation line. */
  readonly lastRun?: { readonly iterations: number; readonly p95Ms: number; readonly inconclusive: boolean } | null;
  readonly ran: RanIndex;
  /**
   * **What the last run recorded for a step, even when its words changed since** — `M256` `B`
   * (`D1406`, `ran.ts`'s `evidenceFor`). Read for the picked row only; every verdict still comes
   * from `ran`, whose join is strict.
   */
  readonly evidenceOf: (line: number) => Ran | null;
  readonly onVerify: ((request: OutlineRequest, spec: ExpectSpec) => void) | null;
  readonly onCapture: ((request: OutlineRequest, specs: readonly CaptureSpec[]) => void) | null;
  readonly onAdd: ((decl: BodiedDecl, key: string) => void) | null;
  readonly adds: readonly AddGesture[];
  /** The declaration a recording is writing into, by its line — `null` when none is running. */
  readonly recording: number | null;
  readonly onAddAfter: ((decl: BodiedDecl, request: OutlineRequest) => void) | null;
  readonly onDuplicate: ((decl: OutlineTest, request: OutlineRequest) => void) | null;
  readonly menuFor: ((t: SeqTarget) => readonly MenuItem[]) | null;
  readonly onMenu: ((r: MenuRequest) => void) | null;
  /** Bumped by every create gesture that lands (`D1136`); the pane focuses what opened. */
  readonly made: number;
  readonly onRemoveSteps: ((decl: OutlineDecl, steps: readonly number[]) => void) | null;
  readonly onRemoveDecl: ((decl: OutlineDecl) => void) | null;
  readonly onMoveSteps: ((decl: OutlineDecl, steps: readonly number[], over: readonly number[], by: -1 | 1) => void) | null;
  /** ▶ on the declaration row — `null` where the file does not play, and on a hook. */
  readonly onPlay: ((decl: OutlineTest) => void) | null;
  readonly playing: boolean;
  /** The run the shell is following, where it reaches this file (`D1407`). */
  readonly play: PlayState | null;
  /** A test's trace in the last run of this file — `null` where the project has no viewer. */
  readonly traceFor: ((name: string) => PlayTrace | null) | null;
  readonly onOpenTrace: (reportId: string, path: string) => void;
  readonly onRemoveScoped: ((statement: OutlineStatement) => void) | null;
  readonly onUnscope: ((statement: OutlineStatement) => void) | null;
  readonly onScope: ((statement: OutlineStatement) => void) | null;
  /**
   * **What a recording has handed back and nobody has kept yet** — `M256` `C` (`D1408`).
   *
   * `after` is the line of the row the pending rows are drawn under — the picked step when the
   * recording started, moved down by each keep — or `null` for the foot of the test.
   */
  readonly provisional: (Session & { readonly after: number | null; readonly intoLine: number | null }) | null;
  readonly onKeepLine: (line: SessionLine) => void;
  readonly onKeepAll: () => void;
  /** Run the test with the pending rows in it, keeping none of them (`D1185`); `null` where the
   *  file does not play. */
  readonly onPlaySession: (() => void) | null;
  readonly onDropLine: (id: number) => void;
  readonly onStopSession: () => void;
  /** Which of a request's folds are open — held ABOVE this component, because the strip unmounts
   *  panels (`M205` `S5a`) and an open fold is a reader's choice. */
  readonly folds: ReadonlySet<RequestFold>;
  readonly onFold: (fold: RequestFold) => void;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly problem: string | null;
  /** After a `409`: drop the draft and show the file as it is on disk (`M250` `G14`, `D1393`). */
  readonly onReread: (() => void) | null;
  readonly onWrite: () => void;
  readonly onDiscard: () => void;
  /** The open file's kinds and the vocabulary row they make (`M254`, `D1399`). */
  readonly kinds: ReadonlySet<Lens>;
  readonly vocab: DoorVocabulary;
  /** The env's authorization facts, straight off `ProjectView` (`D1239`). */
  readonly authorization: Authorization;
  readonly onProjectTab: (tab: 'auth' | 'config') => void;
}

/** A crawl's one gesture — `M241` `C` (`D1323`): the scan assertion a crawl exists for. */
const CRAWL_ADDS: readonly AddGesture[] = [
  { key: 'assert', label: '+ assertion', title: '`expect response has no … violations` — graded on every response the crawl reaches' },
];

/** Why a row cannot be edited, when its address is missing — `M228` `C` (`D1238`). */
const unaddressableWhy = (nested: boolean): string =>
  nested
    ? 'inside the block above — an index pair names a step of a body, and this is not one'
    : 'this statement has no address this pane can edit — change it in Source';

/**
 * **Below 1100 px the evidence folds under the picked row** — `M256` `D` (`D1412`).
 *
 * A hook rather than a media query because the fold is a different PLACE in the tree, not a
 * different style of the same place: CSS could hide one of two copies, and two copies is the
 * second picture `§6` prediction 6 warned about.
 */
const NARROW = '(max-width: 1099px)';
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * **The steps column's share of the pane, while the reader has chosen none** — `M256` `B`
 * (`D1406`).
 *
 * `M240` `F` fitted this column to its rows' text, which was right while a row was only text. A
 * picked row is now its own editor — subject, matcher and value on one line — so the column is
 * sized as a share: 56% of the pane, which leaves the evidence 40%+ at 1440 (the green condition),
 * clamped to the grip's range. A width the reader dragged is theirs and is never re-fitted.
 */
const STEPS_SHARE = 0.56;

export function ComposePane(props: ComposePaneProps) {
  const { path, outline, at, focusLine, onLine, onFile, onNew, onNewDecl, crawls, scratchUnignored, edit, onEdit, editing, prefix, prefixAll, onSend, sending, sent, lastRun, ran, evidenceOf, onVerify, onCapture, onAdd, adds, recording, onAddAfter, onDuplicate, menuFor, onMenu, made, onRemoveSteps, onRemoveDecl, onMoveSteps, onReread, onPlay, playing, play, traceFor, onOpenTrace, onRemoveScoped, onUnscope, onScope, provisional, onKeepLine, onKeepAll, onPlaySession, onDropLine, onStopSession, folds, onFold, dirty, busy, problem, onWrite, onDiscard, kinds, vocab, authorization, onProjectTab } = props;
  const footAdds: readonly AddGesture[] =
    at === null || at.decl.kind === 'hook' ? [] : at.decl.kind === 'test' ? adds : at.decl.kind === 'action' ? adds.filter((a) => a.key !== 'record') : CRAWL_ADDS;

  const seqMenu = (t: SeqTarget, subject: string): MenuTrigger | undefined =>
    menuFor === null || onMenu === null
      ? undefined
      : menuTrigger(onMenu, () => ({ kind: t.kind, subject, items: menuFor(t) }));

  const narrow = useNarrow();
  const selected = useMemo(() => selectedAt(at, focusLine), [at, focusLine]);
  /** The request whose response is in hand — a statement's is its request's. */
  const forRequest: OutlineRequest | null =
    selected.kind === 'request' ? selected.request
    : selected.kind === 'statement' ? (at === null ? null : requestsOf(at.decl.body).find((r) => r.attached.some((s) => s.line === selected.statement.line)) ?? null)
    : null;

  /**
   * **The response for the picked request: the strict join first, then the last run's evidence**
   * (`D1406`). `ran` carries a response only where the request's line still reads what ran; a
   * request whose words changed since, or that moved, still has *the last thing that came back*,
   * and `evidenceOf` finds it and says which.
   */
  const rowRan: Ran | null = useMemo(() => {
    if (forRequest === null) return null;
    const strict = ran.get(forRequest.line) ?? null;
    if (strict !== null && strict.response !== null) return strict;
    return evidenceOf(forRequest.line) ?? strict;
  }, [forRequest, ran, evidenceOf]);

  const sendPrefix: Prefix | null = prefix ?? prefixAll;

  /** What the last send left in this declaration (`M225` `B`, `D1217`), in file order. */
  const sentHere = useMemo((): readonly SentEntry[] => {
    if (sent === null || at === null) return [];
    return requestsOf(at.decl.body)
      .filter((r) => sent.lines.includes(r.line))
      .map((r) => ({ request: r, ran: ran.get(r.line) ?? null }))
      .filter((e): e is SentEntry => e.ran !== null && e.ran.scope === 'send' && e.ran.response !== null);
  }, [sent, at, ran]);

  /** Which send entry's body is in the box — `null` is the first (`§2.3`). */
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [path, sent?.at, forRequest?.line]);

  /** The response in the box and the request it came from — ONE reading, not two (`M225` §1.2). */
  const shownEntry = useMemo(() => {
    const picked = pick === null ? null : sentHere.find((e) => e.request.line === pick) ?? null;
    if (picked !== null) return { ran: picked.ran, request: picked.request };
    if (rowRan !== null && rowRan.response !== null && forRequest !== null) return { ran: rowRan, request: forRequest };
    const first = sentHere[0];
    return first === undefined ? null : { ran: first.ran, request: first.request };
  }, [pick, sentHere, rowRan, forRequest]);
  const shown: Ran | null = shownEntry?.ran ?? null;
  const shownRequest: OutlineRequest | null = shownEntry?.request ?? null;

  /** The refusal a `✕` produced, keyed by the line it was pressed on (`D1117`). */
  const [refused, setRefused] = useState<{ line: number; held: Held } | null>(null);
  useEffect(() => setRefused(null), [path]);

  const remove = useCallback(
    (decl: SelectedDecl, atLine: number, target: { lines: number[]; steps: number[] } | null): void => {
      if (target === null || onRemoveSteps === null) return;
      const held = holds(decl.body, target.lines);
      if (held !== null) {
        setRefused({ line: atLine, held });
        return;
      }
      setRefused(null);
      onRemoveSteps(decl, target.steps);
    },
    [onRemoveSteps],
  );
  const refusalFor = (line: number): Held | null => (refused !== null && refused.line === line ? refused.held : null);
  const clearRefusal = useCallback(() => setRefused(null), []);

  /** The steps column's width — the reader's, through the grip (`D1135`); `STEPS_SHARE` of the pane
   *  until they drag it. */
  const [seqWidth, setSeqWidth] = useState<number>(COMPOSE.fallback);
  const stack = useRef<HTMLDivElement | null>(null);
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current) return;
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(COMPOSE.key); } catch { /* a browser that will not remember still gets a share */ }
    if (stored !== null) {
      const n = Number(stored);
      if (Number.isFinite(n)) setSeqWidth(Math.min(COMPOSE.max, Math.max(COMPOSE.min, n)));
      fitted.current = true;
      return;
    }
    const pane = stack.current?.clientWidth ?? 0;
    if (pane === 0) return;
    fitted.current = true;
    setSeqWidth(Math.min(COMPOSE.max, Math.max(COMPOSE.min, Math.round(pane * STEPS_SHARE))));
  });

  /**
   * **The cursor lands in the first field of whatever a create gesture opened** — `M217` `A`
   * (`D1136`). The first field in DOM order of the open editor, so it follows the editor's shape
   * rather than naming a control. `focusLine` is read and deliberately NOT a dependency: the
   * trigger is *a create landed*, which `made` alone says.
   */
  const landedAt = useRef<number | null>(focusLine);
  landedAt.current = focusLine;
  useEffect(() => {
    if (made === 0) return;
    const root = stack.current;
    if (root === null) return;
    if (landedAt.current !== null) root.querySelector(`.seq-col [data-seq-line="${landedAt.current}"]`)?.scrollIntoView({ block: 'nearest' });
    const field = root.querySelector<HTMLElement>(
      '.seq-col [data-editor] input:not([type="checkbox"]):not([disabled]), .seq-col [data-editor] textarea:not([disabled])',
    );
    if (field === null) return;
    field.focus();
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
  }, [made]);

  /** Which evidence tab the reader chose; `null` follows the pick (`D1209`'s rule). */
  const [evidencePick, setEvidencePick] = useState<EvidenceTab | null>(null);

  /** Every scan matcher the picked test carries — `MATCHER_LENS` is the language's own table, so a
   *  family that earns the tab without putting the test behind SCANS is impossible (`D1239`). */
  const scanMatchers = useMemo<readonly MatcherName[]>(() => {
    const decl = at?.decl ?? null;
    if (decl === null || decl.kind !== 'test') return [];
    return statementsOf(decl.body)
      .filter((st) => st.node.type === 'ExpectStmt')
      .map((st) => (st.node as ExpectStmt).matcher.name)
      .filter((name) => MATCHER_LENS[name] === 'scan');
  }, [at]);
  const scanning = scanMatchers.length > 0 && at?.decl != null && at.decl.kind === 'test' && lensesOfTest(at.decl.node).includes('scan');

  const planWorkload: Workload | null = at?.decl != null && at.decl.kind === 'test' ? at.decl.workload : null;
  const recordingHere = provisional !== null && provisional.live && at !== null && at.decl.kind === 'test' && at.decl.name === provisional.into;
  /** A browser step picked — the screenshot tenant's subject. */
  const browserStep = selected.kind === 'statement' && selected.statement.lens === 'browser' ? selected.statement : null;
  const browserDecl = at !== null && statementsOf(at.decl.body).some((s) => s.lens === 'browser');

  /**
   * **Which tenants the column has, and which is showing** (`D1406`, `D1209`).
   *
   * Earned, never granted by a kind: `response` by a request in the test,
   * `plan` by a workload, `scan` by a scan matcher, `screenshot` by a browser step. The default
   * follows the pick — a request or an API statement opens the response, a browser step its
   * screenshot, a declaration the richest thing it earned — and a live recording follows the page.
   */
  const tenants = useMemo<readonly EvidenceTab[]>(() => {
    const has = new Set<EvidenceTab>();
    if (at !== null && requestsOf(at.decl.body).length > 0) has.add('response');
    if (planWorkload !== null) has.add('plan');
    if (scanning) has.add('scan');
    if (browserDecl || recordingHere) has.add('screenshot');
    if (has.size === 0) has.add('response');
    return (['response', 'plan', 'scan', 'screenshot'] as const).filter((t) => has.has(t));
  }, [at, planWorkload, scanning, browserDecl, recordingHere]);
  const evidenceDefault: EvidenceTab =
    recordingHere && tenants.includes('screenshot') ? 'screenshot'
    : browserStep !== null && tenants.includes('screenshot') ? 'screenshot'
    : selected.kind === 'request' || selected.kind === 'statement' ? (tenants.includes('response') ? 'response' : tenants[0]!)
    : (['plan', 'scan', 'screenshot', 'response'] as const).find((t) => tenants.includes(t)) ?? 'response';
  const evidenceTab: EvidenceTab = evidencePick !== null && tenants.includes(evidencePick) ? evidencePick : evidenceDefault;
  /** A reader's pick is about the row they made it on; a new pick follows the new row. */
  useEffect(() => setEvidencePick(null), [path, focusLine]);

  /** The picked browser step's group from the last run — the screenshot tenant's frame. */
  const shot = useMemo(() => {
    if (at === null) return null;
    const line = browserStep?.line ?? null;
    if (line === null) return null;
    const strict = groupFor(ran, at.decl.line, line);
    const own = strict !== null && strict.screenshot !== null ? strict : evidenceOf(line);
    return { ran: own ?? strict, what: `line ${line}` };
  }, [at, browserStep, ran, evidenceOf]);

  /**
   * **The column follows a run** — `M257` `A` (`D1407`).
   *
   * While the picked test runs, the evidence column shows the step it has reached — the response
   * of a request, the page a browser step left — and when the test fails it **rests on the failing
   * step**, which is the one the reader would pick next. Picking a row is the reader taking the
   * column back: it stops following that run and stays theirs until the next one starts.
   */
  const [unfollowed, setUnfollowed] = useState<string | null>(null);
  const lastFocus = useRef(focusLine);
  useEffect(() => {
    if (lastFocus.current === focusLine) return;
    lastFocus.current = focusLine;
    if (play !== null) setUnfollowed(play.id);
  }, [focusLine, play]);
  const following =
    play !== null && play.at !== null && at !== null && at.decl.kind === 'test' && play.test === at.decl.name && (play.status === 'running' || play.status === 'failed') && unfollowed !== play.id;
  const followGroup: Ran | null = following && at !== null && play !== null && play.at !== null ? groupFor(ran, at.decl.line, play.at) : null;
  const followRequest: OutlineRequest | null = followGroup === null || at === null ? null : requestsOf(at.decl.body).find((r) => r.line === followGroup.line) ?? null;
  const followResponse = followRequest !== null && followGroup !== null && followGroup.response !== null;
  const followShot = followGroup !== null && followRequest === null && tenants.includes('screenshot');
  const shownNow: Ran | null = followResponse ? followGroup : shown;
  const shownRequestNow: OutlineRequest | null = followResponse ? followRequest : shownRequest;
  const tabNow: EvidenceTab = followResponse && tenants.includes('response') ? 'response' : followShot ? 'screenshot' : evidenceTab;
  const shotNow = followShot && followGroup !== null ? { ran: followGroup, what: `line ${followGroup.line}` } : shot;
  /** The row the run is at: while it runs, and on the failure while the column still follows it. */
  const litLine: number | null = play === null ? null : play.status === 'running' || following ? play.at : null;
  const trace = traceFor !== null && at !== null && at.decl.kind === 'test' ? traceFor(at.decl.name) : null;

  const decl = at?.decl ?? null;

  const evidence = outline === null ? null : (
    <Evidence
      path={path}
      tenants={tenants}
      tab={tabNow}
      onTab={(t) => {
        if (play !== null) setUnfollowed(play.id);
        setEvidencePick(t);
      }}
      following={followGroup === null || play === null ? null : { line: followGroup.line, status: play.status }}
      plan={planWorkload === null ? null : { workload: planWorkload, name: decl !== null && decl.kind === 'test' ? decl.name : null }}
      authorization={authorization}
      scanMatchers={scanMatchers}
      onProjectTab={onProjectTab}
      shown={shownNow}
      shownRequest={shownRequestNow}
      picked={forRequest}
      sentHere={sentHere}
      sent={sent === null ? null : { form: sent.form, at: sent.at }}
      onPickSent={setPick}
      prefix={prefix}
      prefixAll={prefixAll}
      onSend={onSend}
      sending={sending}
      busy={busy}
      scratchUnignored={scratchUnignored}
      onVerify={onVerify}
      onCapture={onCapture}
      shot={shotNow}
      trace={trace === null ? null : { path: trace.path, reportId: trace.reportId, open: () => onOpenTrace(trace.reportId, trace.path) }}
      recording={recordingHere && provisional !== null ? { into: provisional.into ?? '', pending: provisional.lines.filter((l) => l.kind === 'step').length } : null}
    />
  );

  if (outline === null) {
    // `M236` `C` (`D-M236-3`): the placeholder does not answer to `[data-compose-pane]`, so a wait
    // on the pane cannot be satisfied by one that has drawn nothing.
    return (
      <div className="compose-pane reading" data-compose-placeholder="reading">
        <p className="muted" data-compose-state>
          reading {path || 'the project'}…
        </p>
      </div>
    );
  }

  const statements = decl === null ? [] : decl.body.preamble;
  const units = decl === null ? [] : moveUnits(decl.body);
  const mover = (first: number | undefined, what: string, among: readonly (readonly number[])[] = units): ReactNode => {
    if (decl === null || onMoveSteps === null || first === undefined) return null;
    const go = (by: -1 | 1): (() => void) | null => {
      const m = moveOf(among, first, by);
      return m === null ? null : () => onMoveSteps(decl, m.steps, m.over, by);
    };
    const up = go(-1);
    const down = go(1);
    return up === null && down === null ? null : <Move what={what} up={up} down={down} />;
  };
  const siblingsOf = (r: OutlineRequest): readonly (readonly number[])[] =>
    r.attached.filter((a) => a.stepPath !== null && a.inner === null).map((a) => [a.stepPath!.step]);

  /** The phase a line sits in, as the subject offer's word for it — `M219` `G` (`D1166`). */
  const phaseFor = (line: number): 'api' | 'browser' | undefined =>
    !kinds.has('browser') || decl === null ? undefined : phaseOf(decl.body, line) === 'session' ? 'browser' : 'api';

  /** A statement's verdict: its request's group, or the nearest action's (`D1270`). */
  const verdictOf = (s: OutlineStatement, r: OutlineRequest | null): Verdict | null => {
    if (decl === null) return null;
    const group = r !== null ? ran.get(r.line) ?? null : groupFor(ran, decl.line, s.line);
    return group?.steps.get(s.line) ?? null;
  };

  /** The evidence, folded under the picked row below 1100 px (`D1412`) — one element, one place. */
  const fold = (as: 'li' | 'div'): ReactNode => {
    if (!narrow) return null;
    const El = as;
    return <El className="evidence-fold" data-evidence-fold="">{evidence}</El>;
  };

  /**
   * **What a recording has handed back, drawn where it will land** — `M256` `C` (`D1408`).
   *
   * Each gesture is a provisional row under the step that was picked when the recording started,
   * with `keep · drop` on it. Keeping splices it into the buffer there (`D1165`: nothing is written
   * until kept, and nothing reaches the disk until `write`); stopping keeps what was kept and drops
   * the rest. The record panel and its 48 words are gone.
   */
  const provisionalBlock = (as: 'li' | 'div'): ReactNode => {
    if (provisional === null || provisional.kind !== 'record' || decl === null || decl.kind !== 'test' || decl.name !== provisional.into) return null;
    const El = as;
    const steps = provisional.lines.filter((l) => l.kind === 'step');
    return (
      <El key="provisional" className="seq-group provisional" data-provisional={provisional.lines.length} data-provisional-live={provisional.live ? 'yes' : 'no'}>
        <div className="seq-row provisional-head">
          <span className={provisional.live ? 'status-code pass' : 'status-code warn'} data-provisional-state={provisional.live ? 'live' : 'closed'}>
            {provisional.live ? 'recording' : 'closed'}
          </span>
          <span className="muted" data-provisional-head>
            {provisional.lines.length === 0 ? 'use the page — each gesture lands here' : `${steps.length} to keep or drop`}
          </span>
          {steps.length > 0 && onPlaySession !== null ? (
            /* ▶ before `keep all`: the safe one first — it changes nothing and says whether keeping
               would be a good idea (`D1185`, `D1186`). */
            <button type="button" onClick={playing ? undefined : onPlaySession} disabled={playing} data-provisional-play data-tip={playing ? 'a run is already going' : `run this test with these ${steps.length} in it — nothing is kept`}>
              ▶ try {steps.length}
            </button>
          ) : null}
          {steps.length > 0 ? (
            <button type="button" onClick={onKeepAll} data-provisional-keep-all data-tip="keep every row below, in order">
              keep all {steps.length}
            </button>
          ) : null}
          {provisional.live ? (
            <button type="button" onClick={onStopSession} data-provisional-stop data-tip="close the browser — the rows you kept stay, the rest are dropped">
              stop
            </button>
          ) : null}
        </div>
        {provisional.lines.length === 0 ? null : (
          <ol className="seq attached">
            {provisional.lines.map((l) => (
              <li key={l.id} className={`seq-row under provisional-row ${l.kind}`} data-provisional-line={l.id} data-provisional-kind={l.kind}>
                {l.kind === 'step' ? (
                  <>
                    <span className="seq-kind">{seqLead(l.node)}</span>
                    <code className="seq-text stmt-text" data-provisional-text>
                      <SourceText text={l.text} />
                    </code>
                    <button type="button" className="seq-x keep" onClick={() => onKeepLine(l)} data-provisional-keep={l.id} data-tip="keep this step — it goes into the test here">
                      keep
                    </button>
                  </>
                ) : l.kind === 'unreadable' ? (
                  <>
                    <span className="warn" data-provisional-unreadable={l.id}>⚠</span>
                    <code className="seq-text stmt-text" data-provisional-text>{l.text}</code>
                    <span className="muted">the recorder sent this and the language could not read it</span>
                  </>
                ) : (
                  <span className="muted seq-text" data-provisional-text data-provisional-notice={l.id}>{l.text}</span>
                )}
                <button type="button" className="seq-x" onClick={() => onDropLine(l.id)} data-provisional-drop={l.id} data-tip="drop this row — it was never in the file">
                  drop
                </button>
              </li>
            ))}
          </ol>
        )}
      </El>
    );
  };
  const provisionalAfter = (line: number, as: 'li' | 'div'): ReactNode => (provisional !== null && provisional.after === line ? provisionalBlock(as) : null);

  /** A statement's inline editor, or the reason it has none — `M256` `A` (`D1405`). */
  const statementEditor = (s: OutlineStatement, r: OutlineRequest | null): ReactNode => {
    if (decl === null) return null;
    const foreign = isForeign(s.lens, kinds);
    const key = rowKey(s);
    const own = s.stepPath === null || editing.onRow === null || foreign ? null : statementEditOf(s.node);
    const values = editing.row !== null && editing.row.key === key ? editing.row.values : own;
    const live = values !== null && editing.onRow !== null && s.stepPath !== null;
    const writingNote = editing.noting !== null && editing.noting === key;
    const verdict = <RowVerdict verdict={verdictOf(s, r)} />;
    const note =
      editing.onNote !== null && s.stepPath !== null && !foreign && !writingNote && s.note === null ? (
        <button type="button" className="add-note" onClick={() => editing.onNoting?.(key)} data-note-add={s.line} data-tip="a comment above this line, explaining why it is here">
          + note
        </button>
      ) : null;
    return (
      <div
        className="seq-edit"
        data-editor="statement"
        data-editor-statement={s.kind}
        data-editor-line={s.line}
        /* The row says whether it is live — the word the attached list says it with (`M219` `C`). */
        data-stmt-editable={live ? 'yes' : 'no'}
        data-stmt-lens={s.lens ?? 'none'}
      >
        {writingNote ? (
          <NoteOpen note={s.note} what={`line ${s.line}`} onChange={(lines) => editing.onNote?.({ on: 'step', path: s.stepPath! }, lines)} />
        ) : s.note ? (
          <NoteBlock note={s.note} what={`line ${s.line}`} onNote={editing.onRow !== null && editing.onNote !== null && s.stepPath !== null ? (lines) => editing.onNote!({ on: 'step', path: s.stepPath! }, lines) : undefined} />
        ) : null}
        {live ? (
          values.kind === 'expect' ? (
            <AssertRow statement={s} edit={values.expect} onEdit={(next) => editing.onRow!(s, { kind: 'expect', expect: next })} verdict={verdict} trailing={note} drops={vocabularyOf(kinds).dropsSubjects} phase={phaseFor(s.line)} />
          ) : (
            <>
              <ScriptRow statement={s} edit={values} onEdit={(next) => editing.onRow!(s, next)} trailing={<>{verdict}{note}</>} pick={editing.pick} phase={phaseFor(s.line)} onOpenAction={editing.onOpenAction} inline />
              {s.body === null || s.body.length !== 1 ? null : <InnerRow statement={s.body[0]!} kinds={kinds} editing={editing} phase={phaseFor(s.line)} />}
            </>
          )
        ) : (
          <div className="stmt-line">
            <code className="stmt-text">{s.text.split('\n')[0]}</code>
            {verdict}
            <span className="muted" data-stmt-unaddressable={foreign ? 'foreign' : s.nested ? 'nested' : 'crawl'}>
              {foreign ? 'a statement of a kind this file does not carry — edit it in Source' : unaddressableWhy(s.nested)}
            </span>
          </div>
        )}
      </div>
    );
  };

  /** One statement's row, wherever the fold put it — `M219` `B`. `among` is the rows it moves
   *  between (`D1391`). `r` is the request it is attached to, when it is. */
  const statementRow = (s: OutlineStatement, keyPrefix: string, r: OutlineRequest | null, among: readonly (readonly number[])[] = units): ReactNode => {
    if (decl === null) return null;
    const on = selected.kind === 'statement' && selected.statement.line === s.line;
    /* **Keyed by the index pair, not the line** (`M256` `A`). A row is now the editor being typed
       into, and a note that grows by a line moves every row under it — keyed by line, the row
       would remount under the cursor and drop the focus mid-word. The index pair is the identity
       an edit does not move (`D1080`). */
    const id = rowKey(s) ?? `L${s.line}`;
    /* **A scope is a qualifier on the row it scopes** (`M219` `D`, `D1163`): 397 of 405 `within`s
       wrap one statement, so the common form is one row carrying the gesture and its scope. */
    const one = s.body !== null && s.body.length === 1 ? s.body[0]! : null;
    if (s.body !== null && one === null) {
      return (
        <li key={`${keyPrefix}-blk-${id}`} className="seq-group scoped" data-seq-scope={s.line} data-seq-scope-kind={s.kind} data-seq-scope-holds={s.body.length}>
          <SeqRow
            head
            line={s.line}
            kind={s.kind}
            selected={on}
            onLine={onLine}
            indent
            lead={<span className="seq-kind">{seqLead(s.node)}</span>}
            text={afterLead(seqLead(s.node), s.text)}
            statement={s}
            menu={seqMenu({ kind: 'step', statement: s, line: s.line }, s.text)}
            kinds={kinds}
            refusal={refusalFor(s.line)}
            editor={on ? statementEditor(s, r) : undefined}
            trailing={
              onRemoveSteps === null || s.stepPath === null ? null : (
                <>
                  {s.inner === null ? mover(s.stepPath.step, 'statement', among) : null}
                  <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
                </>
              )
            }
          />
          {on ? fold('div') : null}
          <ol className="seq attached">{s.body.map((x) => statementRow(x, `${keyPrefix}-in-${id}`, r))}</ol>
          {provisionalAfter(s.line, 'div')}
        </li>
      );
    }
    const shownStatement = one ?? s;
    return [
      <SeqRow
        key={`${keyPrefix}-${id}`}
        line={s.line}
        kind={s.kind}
        selected={on}
        onLine={onLine}
        indent
        lead={<span className="seq-kind">{seqLead(shownStatement.node)}</span>}
        text={afterLead(seqLead(shownStatement.node), shownStatement.text.split('\n')[0] ?? '')}
        scope={one === null ? null : s.text}
        statement={s}
        menu={seqMenu({ kind: 'step', statement: s, line: s.line }, shownStatement.text.split('\n')[0] ?? s.kind)}
        kinds={kinds}
        refusal={refusalFor(s.line)}
        editor={on ? statementEditor(s, r) : undefined}
        verdict={<RowVerdict verdict={verdictOf(s, r)} />}
        trailing={
          s.inner !== null ? (
            onRemoveScoped === null ? null : <Remove what="statement" onGo={() => onRemoveScoped(s)} refusal={refusalFor(s.line)} onClear={clearRefusal} />
          ) : onRemoveSteps === null || s.stepPath === null ? null : (
            <>
              {one !== null && onUnscope !== null ? (
                <button type="button" className="seq-x" onClick={() => onUnscope(s)} data-seq-unscope={s.line} data-tip={`take \`${s.text}\` off and keep the gesture inside it`}>
                  ⤺
                </button>
              ) : s.body === null && onScope !== null && vocab.constructs.has('WithinBlock') ? (
                <button type="button" className="seq-x" onClick={() => onScope(s)} data-seq-scope-add={s.line} data-tip="scope this gesture to one part of the page — a `within`">
                  ⤹
                </button>
              ) : null}
              {mover(s.stepPath.step, 'statement', among)}
              <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
            </>
          )
        }
      />,
      on && narrow ? <li key={`${keyPrefix}-${id}-fold`} className="seq-fold-slot">{fold('div')}</li> : null,
      provisionalAfter(s.line, 'li'),
    ];
  };

  /** One request and everything attached to it — `D1073`'s unit. The head, when picked, is the
   *  request's own editor (`D1405`); the statements under it stay rows. */
  const requestGroup = (r: OutlineRequest): ReactNode => {
    if (decl === null) return null;
    const rr = ran.get(r.line) ?? null;
    const on = selected.kind === 'request' && selected.request.line === r.line;
    const status = rr === null || rr.response === null ? null : (
      /* **The row whose response is in the column wears a SOLID badge** — `M225` `B` (`D1218`). */
      <span
        className={`status-code ${statusTone(rr.response.status)}`}
        data-seq-status={rr.response.status}
        data-seq-showing={shownRequest !== null && shownRequest.line === r.line ? 'yes' : 'no'}
        data-tip={`${rr.scope === 'send' ? 'from a send' : 'from the last run'} — ${rr.at}${shownRequest !== null && shownRequest.line === r.line ? ' — this is the response beside' : ''}`}
      >
        {rr.response.status}
      </span>
    );
    return (
      <li key={`req-${stepKey(r.stepPath) ?? r.line}`} className="seq-group" data-seq-request={r.line} data-seq-method={r.method}>
        <SeqRow
          head
          line={r.line}
          kind={r.kind === 'WaitUntilApiStmt' ? 'wait' : 'request'}
          {...(decl.kind === 'test' ? { menu: seqMenu({ kind: 'request', decl, request: r, line: r.line }, `${r.method} ${r.path}`) } : {})}
          selected={on}
          onLine={onLine}
          lead={
            <>
              <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
              {status}
            </>
          }
          text={r.path}
          refusal={refusalFor(r.line)}
          editor={
            on ? (
              <RequestInline request={r} status={status} folds={folds} onFold={onFold} edit={edit} onEdit={onEdit} editing={editing} />
            ) : undefined
          }
          plus={onAddAfter === null || decl.kind === 'hook' ? null : <Plus onGo={() => onAddAfter(decl, r)} after={`${r.method} ${r.path}`} />}
          trailing={
            onRemoveSteps === null ? null : (
              <>
                {mover(r.stepPath.step, 'request')}
                <Remove what="request" onGo={() => remove(decl, r.line, requestRemoval(r))} refusal={refusalFor(r.line)} onClear={clearRefusal} />
              </>
            )
          }
        />
        {on ? fold('div') : null}
        {on && r.attached.length === 0 ? (
          /* The card's empty Assert tab, as one line under the request it is about. */
          <p className="warn seq-note" data-request-attached-empty>
            nothing reads this response — an <code>api</code> step with no assertion can never fail; tick a value in the response to write one
          </p>
        ) : null}
        {r.attached.length === 0 && provisional?.after !== r.line ? null : (
          <ol className="seq attached">
            {r.attached.map((s) => statementRow(s, 'att', r, siblingsOf(r)))}
            {provisionalAfter(r.line, 'li')}
          </ol>
        )}
      </li>
    );
  };

  /** A session: the page, and everything done to it — `M219` `B` (`D1160`). */
  const sessionGroup = (session: OutlineSession): ReactNode => {
    if (decl === null) return null;
    const s = session.head;
    const on = selected.kind === 'statement' && selected.statement.line === s.line;
    return (
      <li key={`ses-${rowKey(s) ?? s.line}`} className="seq-group session" data-seq-session={s.line} data-seq-session-kind={s.kind}>
        <SeqRow
          head
          line={s.line}
          kind="session"
          selected={on}
          onLine={onLine}
          lead={<span className="seq-kind" data-tip="everything below happens on this page — a new `open` starts the next one">{seqLead(s.node)}</span>}
          text={afterLead(seqLead(s.node), s.text.split('\n')[0] ?? '')}
          statement={s}
          menu={seqMenu({ kind: 'step', statement: s, line: s.line }, s.text.split('\n')[0] ?? s.kind)}
          kinds={kinds}
          refusal={refusalFor(s.line)}
          editor={on ? statementEditor(s, null) : undefined}
          verdict={<RowVerdict verdict={verdictOf(s, null)} />}
          trailing={
            onRemoveSteps === null || s.stepPath === null ? null : (
              <>
                {s.inner === null ? mover(s.stepPath.step, 'statement') : null}
                <Remove what="statement" onGo={() => remove(decl, s.line, statementRemoval(s))} refusal={refusalFor(s.line)} onClear={clearRefusal} />
              </>
            )
          }
        />
        {on ? fold('div') : null}
        {session.body.preamble.length === 0 && session.body.requests.length === 0 && provisional?.after !== s.line ? null : (
          <ol className="seq attached">
            {provisionalAfter(s.line, 'li')}
            {session.body.preamble.map((x) => statementRow(x, `ses-${rowKey(s) ?? s.line}-pre`, null))}
            {session.body.requests.map((r) => requestGroup(r))}
          </ol>
        )}
      </li>
    );
  };

  /** Every row the column draws, for the count the gates read off it. */
  const rowCount = decl === null ? 0 : statementsOf(decl.body).length + requestsOf(decl.body).length;
  const declOn = selected.kind === 'test';

  /**
   * **Esc closes the open row, one level up** — `M256` `A` (`D1405`: *`Enter`/click opens, `Esc`
   * closes*). A statement under a request goes to its request, anything else to its test, a test to
   * the file. Focus follows to the row that is now picked, so a keyboard reader carries on from
   * where they were rather than from the top of the page.
   */
  const up = (): void => {
    if (decl === null) return;
    let target: number | null = null;
    if (selected.kind === 'statement') target = forRequest?.line ?? decl.line;
    else if (selected.kind === 'request') target = decl.line;
    else if (selected.kind === 'test') {
      onFile();
      return;
    }
    if (target === null) return;
    onLine(target);
    const line = target;
    requestAnimationFrame(() => {
      const pickBtn = stack.current?.querySelector<HTMLElement>(`[data-seq-line="${line}"] > [data-seq-pick]`);
      pickBtn?.focus();
    });
  };

  return (
    <LiveAt.Provider value={litLine}>
    <div className="compose-pane" data-compose-pane={selected.kind} data-compose={at?.request ? 'request' : 'no-request'} data-play={play?.status}>
      <div className="compose-pane-bar" data-compose-bar>
        <code className="compose-pane-path" data-compose-file={path}>{path}</code>
        <span className="muted" data-compose-summary data-compose-subject={at ? 'test' : 'file'} data-compose-decl-kind={at?.decl.kind} data-compose-decl-line={at?.decl.line}>
          {at ? (
            <>
              <code data-compose-subject-what>
                {at.decl.kind === 'test' ? (
                  <>
                    <span className="t-kw">test</span> <span className="t-str">&quot;{at.decl.name}&quot;</span>
                  </>
                ) : (
                  <span className="t-kw">{at.decl.kind === 'crawl' || at.decl.kind === 'action' ? `${at.decl.kind} ${at.decl.name}` : at.decl.label}</span>
                )}
              </code> · line {at.decl.line} ·{' '}
              {at.decl.body.requests.length} request{at.decl.body.requests.length === 1 ? '' : 's'} —{' '}
              {outline.declarations.length === 1 ? 'the only one in this file' : `one of ${outline.declarations.length} in this file`}
            </>
          ) : (
            <>this file has no tests yet</>
          )}
        </span>
        {problem !== null ? (
          <span className="warn" data-compose-problem>
            {problem}
            {onReread === null ? null : (
              <>
                {' '}
                <button type="button" onClick={onReread} data-compose-reread data-tip="drop this draft and show the file as it is on disk">
                  re-read from disk
                </button>
              </>
            )}
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
      {play === null ? null : <PlayLine play={play} total={decl !== null && decl.kind === 'test' && decl.name === play.test ? rowCount : null} />}

      {/* **`data-seq-open` is the open request's line** — on the grid now, because the row that is
          its editor and the column that is its evidence are two children of it (`D1405`, `D1406`). */}
      <div className="compose-pane-grid" ref={stack} data-compose-narrow={narrow ? 'yes' : 'no'} data-seq-open={selected.kind === 'request' ? selected.request.line : undefined} style={{ ['--seq-w' as string]: `${seqWidth}px` }}>
        {/* ── the steps (`D1112`, `D1405`) ─────────────────────────────────────────────────── */}
        <div className="seq-col" data-seq-col={decl === null ? 0 : requestsOf(decl.body).length}>
          {selected.kind === 'file' ? (
            /* **The file's own fields, at the top of the steps it holds** (`D1113`): an explorer
               click on a file drops the line, and this is what a line-less address opens. */
            <div className="seq-card file-card" data-editor="file" data-editor-file={path}>
              <FileRow outline={outline} editing={editing} />
              <p className="muted" data-compose-file-next>
                {outline.declarations.length === 0 ? '`+ new test` below starts one' : 'pick a step to edit it — a request, a binding, or the test itself'}
              </p>
              {fold('div')}
            </div>
          ) : null}
          <ol
            className="seq"
            data-body-sequence={decl === null ? 0 : requestsOf(decl.body).length}
            data-seq-rows={rowCount}
            data-seq-sessions={decl === null ? 0 : decl.body.sessions.length}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented) {
                e.preventDefault();
                up();
                return;
              }
              // Alt+↑/↓ on a row is its ↑/↓ button (`D1391`).
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              const row = e.target instanceof Element ? e.target.closest('[data-seq-row]') : null;
              const own = row?.querySelector(`:scope > [data-seq-move="${e.key === 'ArrowUp' ? 'up' : 'down'}"]`);
              if (!(own instanceof HTMLElement)) return;
              e.preventDefault();
              own.click();
            }}
          >
            {decl === null ? null : (
              <SeqRow
                line={decl.line}
                kind="test"
                band={decl.line}
                {...(decl.kind === 'test' ? { menu: seqMenu({ kind: 'test', decl, line: decl.line }, decl.name) } : {})}
                selected={declOn}
                onLine={onLine}
                lead={<span className="seq-kind">{decl.kind === 'hook' ? decl.label : decl.kind}</span>}
                text={decl.kind === 'hook' ? '' : decl.name}
                refusal={refusalFor(decl.line)}
                trailing={
                  <>
                    {onPlay === null || decl.kind !== 'test' ? null : <Play what="test" running={playing} onGo={() => onPlay(decl)} price={playPrice(decl.workload)} />}
                    {onRemoveDecl === null ? null : (
                      <Remove
                        what={decl.kind === 'hook' ? 'hook' : decl.kind}
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
            {/* **A declaration's header is not a line, so it opens as a card under its row**
                (`D1405`): its tags, its `with each` table and its workload — 18 controls — are
                clauses, and drawing them as one line would be pretending. */}
            {decl !== null && declOn ? (
              <li className="seq-card" data-editor="test" data-editor-decl={decl.kind}>
                <TestBand decl={decl} kinds={kinds} editing={editing} lastRun={lastRun} />
              </li>
            ) : null}
            {decl !== null && declOn && narrow ? <li className="seq-fold-slot">{fold('div')}</li> : null}
            {decl === null ? null : statements.map((s) => statementRow(s, 'pre', null))}
            {decl === null ? null : decl.body.requests.map((r) => requestGroup(r))}
            {decl === null ? null : decl.body.sessions.map((s) => sessionGroup(s))}
            {provisional !== null && provisional.after === null ? provisionalBlock('li') : null}
            {rowCount === 0 && (provisional === null || provisional.after !== null) ? (
              <li className="muted seq-empty" data-seq-empty>
                {decl === null ? 'this file has no tests yet' : 'nothing runs in this test yet — add a step below'}
              </li>
            ) : null}
          </ol>

          <div className="seq-foot" data-seq-foot data-seq-adds={footAdds.map((a) => a.key).join(',')}>
            {onAdd !== null && decl !== null && decl.kind === 'hook' ? (
              <span className="muted" data-seq-add-hook>
                a request cannot be added to a hook from here — the splice names a test by name, and a hook has none
              </span>
            ) : null}
            {/* A recording into another test than the one open: the rows are with that test, and
                this says where. */}
            {provisional !== null && provisional.live && (decl === null || decl.kind !== 'test' || decl.name !== provisional.into) && provisional.intoLine !== null ? (
              <button type="button" className="seq-add recording" onClick={() => onLine(provisional.intoLine!)} data-provisional-elsewhere={provisional.into ?? ''}>
                recording into “{provisional.into}” — open it
              </button>
            ) : null}
            {onAdd === null || decl === null || decl.kind === 'hook'
              ? null
              : footAdds.map((a) => {
                  /* **`+ record` is the one gesture that is also a state** (`D1095`): it says `stop
                     recording` while it runs, and every other `+` is held. */
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
                          ? 'a recording is running — its gestures arrive as rows to keep or drop'
                          : live
                            ? 'close the browser — the rows you kept stay, the rest are dropped'
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
            {onNewDecl === null ? null : (
              <button type="button" className="seq-add new" onClick={() => onNewDecl('action')} data-compose-new-action data-tip="steps other tests run by name with `call`">
                + new action
              </button>
            )}
            {onNewDecl === null || !crawls ? null : (
              <button type="button" className="seq-add new" onClick={() => onNewDecl('crawl')} data-compose-new-crawl data-tip="a walk over the whole surface, asserting on every response">
                + new crawl
              </button>
            )}
          </div>
        </div>

        {/* ── the evidence (`D1406`) — beside the steps at 1100 and up, folded under the picked
            row below it (`D1412`) ────────────────────────────────────────────────────────── */}
        {narrow ? null : (
          <>
            <Grip spec={COMPOSE} size={seqWidth} onSize={setSeqWidth} />
            <div className="evidence-col" data-evidence-col>
              {evidence}
            </div>
          </>
        )}
      </div>
    </div>
    </LiveAt.Provider>
  );
}

/**
 * The JSON body, written into a coloured field (`M215` `B2`/`B3`, `D1121`, `D1122`). A `<textarea>`
 * cannot be coloured, so the colour is a `<pre>` in flow under a transparent textarea — one CSS
 * rule sets both boxes, and the check is the language's, on every keystroke. `format` lays the
 * body out for reading; the file still gets one line, because a value is one line to the printer.
 */
function BodyEdit({ text, onText }: { readonly text: string; readonly onText: (text: string) => void }) {
  const problem = useMemo(() => bodyProblem(text), [text]);
  const pretty = useMemo(() => laidOut(text), [text]);
  return (
    <div className="bodyedit" data-body-problem={problem === null ? 'none' : problem.code}>
      <div className="codearea">
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

/**
 * **The gesture inside a single-statement block, as controls** — `M219` `D` (`D1163`). The block's
 * row draws the scope's fields and this draws the gesture's, and the edit goes back through the
 * block (`rescope`), so it needs no second address.
 */
function InnerRow({ statement, kinds, editing, phase }: {
  readonly statement: OutlineStatement;
  readonly kinds: ReadonlySet<Lens>;
  readonly editing: RowEditing;
  readonly phase?: 'api' | 'browser';
}) {
  const { row, onRow: onEdit } = editing;
  const key = rowKey(statement);
  const own = onEdit === null || isForeign(statement.lens, kinds) ? null : statementEditOf(statement.node);
  const values = row !== null && row.key === key ? row.values : own;
  if (values === null || onEdit === null) {
    return (
      <div className="stmt-line" data-inner-line={statement.line}>
        <code className="stmt-text">{statement.text}</code>
        <p className="muted">a statement of a kind this file does not carry — edit it in Source</p>
      </div>
    );
  }
  return (
    <div className="inner-row" data-inner-line={statement.line} data-inner-kind={statement.kind}>
      <span className="seq-kind">inside it</span>
      {values.kind === 'expect' ? (
        <AssertRow statement={statement} edit={values.expect} onEdit={(next) => onEdit(statement, { kind: 'expect', expect: next })} verdict={null} trailing={null} drops={vocabularyOf(kinds).dropsSubjects} phase={phase} />
      ) : (
        <ScriptRow statement={statement} edit={values} onEdit={(next) => onEdit(statement, next)} trailing={null} pick={editing.pick} phase={phase} onOpenAction={editing.onOpenAction} inline />
      )}
    </div>
  );
}

/**
 * **A picked request, in place** — `M256` `A` (`D1405`): `[method ▾] [path]` on the row, and
 * `headers n ▸ · body n ▸ · more ▸` folded under it.
 *
 * The card's four tabs were Headers · Body · Assert · More; the three that hold the request's own
 * clauses are folds now, and Assert is the rows under this one — the assertions drawn once. The
 * folds are closed at rest, so a picked request costs one line until a reader asks for more, which
 * is the measurement `D1115` chose Assert as the default tab on: `timeout`, `without redirects` and
 * `retry after` together are used five times in a thousand requests.
 */
function RequestInline({ request: r, status, folds, onFold, edit, onEdit, editing }: {
  readonly request: OutlineRequest;
  readonly status: ReactNode;
  readonly folds: ReadonlySet<RequestFold>;
  readonly onFold: (fold: RequestFold) => void;
  readonly edit: RequestEdit | null;
  readonly onEdit: ((next: RequestEdit) => void) | null;
  readonly editing: RowEditing;
}) {
  const v = edit ?? editOf(r);
  const change = onEdit === null ? null : (patch: Partial<RequestEdit>) => onEdit({ ...v, ...patch });
  const writingNote = editing.noting !== null && editing.noting === stepKey(r.stepPath);
  /** Which `more` clauses are drawn: one the file states is always there; one it does not is added
   *  from the menu (`D1084`). */
  const [added, setAdded] = useState<readonly string[]>([]);
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
  const counts: Record<RequestFold, number> = {
    headers: v.headers.length,
    body: v.bodyKind === 'none' ? 0 : 1,
    more: ['service', 'label', 'timeout', 'redirects', 'retryAfter'].filter(shows).length,
  };

  return (
    <div
      className="seq-edit request-edit"
      data-editor="request"
      data-request-line={r.line}
      data-request-kind={r.kind}
      data-request-editable={change === null ? 'no' : 'yes'}
      data-request-drawn={(counts.headers > 0 ? 1 : 0) + counts.body + counts.more}
    >
      {writingNote ? (
        <NoteOpen note={r.note} what={`request ${r.line}`} onChange={(lines) => editing.onNote?.({ on: 'step', path: r.stepPath }, lines)} />
      ) : r.note ? (
        <NoteBlock note={r.note} what={`request ${r.line}`} onNote={editing.onNote === null ? undefined : (lines) => editing.onNote!({ on: 'step', path: r.stepPath }, lines)} />
      ) : null}
      <div className="request-head">
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
        {status}
        {r.kind === 'WaitUntilApiStmt' ? (
          <span className="badge" data-request-polling="yes" data-tip="this request is re-issued until the assertions below it pass">
            polls
          </span>
        ) : null}
        {editing.onNote !== null && r.note === null && !writingNote ? (
          <button type="button" className="add-note" onClick={() => editing.onNoting?.(stepKey(r.stepPath))} data-note-add={r.line} data-tip="a comment above this request, explaining why it is here">
            + note
          </button>
        ) : null}
      </div>
      <div className="request-folds" data-request-folds={REQUEST_FOLDS.filter((f) => folds.has(f)).join(',')}>
        {REQUEST_FOLDS.map((f, i) => (
          <span key={f} className="request-fold-slot">
            {i === 0 ? null : <span className="muted" aria-hidden="true"> · </span>}
            <button type="button" className={`request-fold${folds.has(f) ? ' on' : ''}`} aria-expanded={folds.has(f)} onClick={() => onFold(f)} data-request-fold={f} data-request-fold-count={counts[f]}>
              {f}{counts[f] > 0 ? ` ${counts[f]}` : ''} {folds.has(f) ? '▾' : '▸'}
            </button>
          </span>
        ))}
      </div>

      {folds.has('headers') ? (
        <div className="fold headers-form" data-request-headers={v.headers.length}>
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

      {folds.has('body') ? (
        <div className="fold body-form" data-request-body={v.bodyKind}>
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
                {/* Offered only when it is already what this request sends: `ApiBodySpec` cannot
                    construct a multipart upload or a GraphQL body, so the row keeps it and says so. */}
                {v.bodyKind === 'upload' ? <option value="upload">upload (multipart) — kept as written</option> : null}
                {v.bodyKind === 'graphql' ? <option value="graphql">GraphQL — kept as written, edited in Source</option> : null}
              </select>
              {(v.bodyKind === 'upload' || v.bodyKind === 'graphql') && r.body !== null ? <pre className="preview body-preview" data-request-body-text><BodyText text={bodyText(r.body)} problem={null} /></pre> : null}
              {v.bodyKind === 'json' ? <BodyEdit text={v.bodyText} onText={(text) => change({ bodyText: text })} /> : null}
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
                        onClick={() => change(v.formFields.length === 1 ? { formFields: [], bodyKind: 'none', bodyText: '' } : { formFields: v.formFields.filter((_, j) => j !== i) })}
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

      {folds.has('more') ? (
        <div className="fold more-form" data-request-more={counts.more} data-request-fields={['service', 'label', 'timeout', 'redirects', 'retryAfter'].filter(shows).join(',')}>
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

/**
 * **The run, in one line under the bar** — `M257` `A` (`D1407`).
 *
 * `running · step 3 of 7 · 1.2 s · cancel` while it goes; the verdict, the time and a way to the
 * report once it has ended. It replaces the stage's bar and its four hints: what a run is doing is
 * one sentence, and the rows and the evidence column are where it is shown.
 */
function PlayLine({ play, total }: { readonly play: PlayState; readonly total: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (play.status !== 'running') return undefined;
    const tick = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(tick);
  }, [play.status]);
  const end = play.endedAt ?? (play.status === 'running' ? now : null);
  const took = play.startedAt === null || end === null ? null : `${(Math.max(0, end - play.startedAt) / 1000).toFixed(1)} s`;
  const step =
    play.status === 'running'
      ? total !== null && play.judged < total ? `step ${play.judged + 1} of ${total}` : `step ${play.judged + 1}`
      : `${play.judged} step${play.judged === 1 ? '' : 's'}`;
  const lead = play.status === 'failed' && play.at !== null ? `failed at line ${play.at}` : play.status;
  return (
    <div className={`play-line ${play.status}`} data-play-status={play.status} data-play-test={play.test} data-play-judged={play.judged}>
      <span className={`dot ${play.status === 'passed' ? 'ok' : play.status === 'failed' ? 'fail' : play.status === 'running' ? 'running' : 'none'}`} />
      <span data-play-lead>{lead}</span>
      <span className="muted">
        {' '}· {play.test} · {step}
        {took === null ? null : <span data-play-took> · {took}</span>}
      </span>
      {play.onCancel === null ? null : (
        <button type="button" className="linkish" onClick={play.onCancel} data-play-cancel data-tip="stops the run gracefully — what has run is kept, the rest stays not run">
          cancel
        </button>
      )}
      {play.status === 'running' ? null : (
        <button type="button" className="linkish" onClick={play.onOpenRun} data-play-open-run>
          open in Run
        </button>
      )}
      {play.unignored === null ? null : (
        <span className="muted play-unignored" data-play-unignored={play.unignored}>
          ▶ writes <code>{play.unignored}</code> beside the test, and this project&rsquo;s <code>.gitignore</code> does not list it — add that line.
        </span>
      )}
    </div>
  );
}
