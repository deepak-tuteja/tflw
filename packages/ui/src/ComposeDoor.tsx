// The authoring door — `M200` `A1-4` as `ApiForm`, generalised to two doors by `M213` `S4`
// (`D1094`). The second form in tflw that writes a file, and the first that writes *work* rather
// than a policy about work.
//
// **IT WAS CALLED `ApiForm` UNTIL IT SERVED A SECOND DOOR, AND THE RENAME IS THE POINT.** BROWSER
// had `BrowserForm`: a `<select>` asking which already-open test to append steps to, with the file
// as an argument rather than as the subject — the staging-form shape `D1088` retired from the API
// door one day earlier (`M213-08`). Two implementations of one picture is the failure this project
// keeps recording, and the reason there was never a third pane is that the two doors differ in
// **what words they know** and in nothing else: `vocabulary.ts` is that difference, as a table, and
// everything below is one implementation serving both. A component named for one door while
// serving two is the same defect one level up — the class `M213-19` filed about a field name.
//
// IT IS `LoadForm`'s SHAPE AND NOT ITS COPY. Both hold field values and nothing else: the nodes
// come from `@tflw/lang`'s builders, the splice and the format from `insertIntoSource`, the write
// from `putFile` under the etag the source was read at. All of it runs in this browser, because
// the language package has no dependencies and no Node builtins — so there is no second
// implementation here for the CLI's to drift from.
//
// WHAT IT ADDS TO THE LOAD FORM IS THE `steps` INSERTION. A LOAD form can only ever write a
// policy — a workload line, a threshold — because `api` steps are this door's vocabulary, which
// is the gap `A0-5`'s green-condition test had to work around and said so where it did. This is
// `D1044` from the writing side: a door adds the work it knows how to describe, to a test any
// door may have started.
//
// A REQUEST AND ITS ASSERTIONS ARE ONE EDIT. They are built together and spliced together,
// because `D1049` makes each write a real PUT — and a file that, between two of them, asserts
// against a response nothing fetched is a file somebody's CI can catch mid-edit.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildApiStep,
  replaceInSource,
  parseSource,
  print,
  buildClick,
  buildFill,
  buildOpen,
  /* **The rest of the browser vocabulary** — `M219` `C` (`D1162`). `buildSelect`, `buildCheck`,
     `buildPress` and `buildWithin` have existed since `M213` `S5` and were reachable from nothing
     until this import. */
  buildWithin,
  buildSwitchToNewTab,
  buildDownload,
  type DownloadBlock,
  type SwitchToNewTabBlock,
  type WithinBlock,
  buildCapture,
  buildWaitUntilApi,
  buildExpect,
  buildDataTable,
  buildLet,
  buildThreshold,
  type CaptureSpec,
  type LocatorSpec,
  type Lens,
  type ExpectSpec,
  type NoteOwner,
  type HookDecl,
  type Program,
  type Step,
  type TestDecl,
  type WaitUntilApiStmt,
  stringLit,
  SYNTHETIC,
  buildTest,
  insertIntoSource,
} from '@tflw/lang';
import { pickLocators, recordActions, putFile, getFile, dropScratch, startRun, subscribe, getReports, getResults, type FileView } from './api';
import { diagnose } from './diagnose';
import { indexFromReport, indexFromSend, belongsTo, playScratchOf, REPORT_LOOKBACK } from './ran';
import { VOCABULARY } from './vocabulary';
import { TabStrip } from './TabStrip';
import { Stage, traceOf } from './Stage';
import {
  editOf,
  specOf,
  rowKey,
  tableSpecOf,
  thresholdSpecOf,
  type HeaderEdit,
  type RequestEdit,
  type StatementEdit,
  type ThresholdEdit,
  type Ran,
  type RanIndex,
} from './parts';
import { ComposePane, type EditorTab, type SeqTarget } from './ComposePane';
import { buildStatement } from './statements';
import { AddStep, stepCatalogue } from './AddStep';
import type { Session, SessionLine } from './SessionPanel';
import type { MenuItem, MenuRequest } from './ContextMenu';
import type { NewMode } from './NewThing';
import { addressed, anchorAfter, fileOutline, pageOpeners, requestsOf, statementsOf,
  prefixOf, type OutlineHook, type OutlineRequest, type OutlineStatement, type OutlineTest } from './outline';
import { SourcePanel } from './SourcePanel';
import type { TabId } from './doors';
import type { EndEvent, ProjectView, RunReport, RunRequest, StepResult } from './contract';
import type { FileOutline } from './outline';

/**
 * Read one line of `tflw pick`'s output as a locator, or `null` if it is not one — `M200` `A3-6`.
 *
 * **CLASSIFIED BY THE GRAMMAR, NOT BY EXCLUDING THE BANNERS.** `pick` prints `opening <url> …` and
 * `ready — click any element …` before the first locator, so the obvious filter is to skip those
 * two sentences — and it would break the day either is reworded, silently, by turning a banner
 * into a suggestion. Asking the parser whether `click <line>` is a click step is the same question
 * asked of the only thing entitled to answer it, and it is immune to wording.
 *
 * This is also why the route streams lines unclassified: the server has no parser and should not
 * grow one to do this (`D1049`).
 */
export function locatorFromPickLine(line: string): LocatorSpec | null {
  const text = line.trim();
  if (text === '') return null;
  const { program, diagnostics } = parseSource(`test "pick"\n  click ${text}\n`);
  if (diagnostics.some((d) => d.severity === 'error')) return null;
  const step = program.tests[0]?.body[0];
  if (!step || step.type !== 'ClickStmt') return null;
  return { kind: step.locator.kind, value: step.locator.value.value };
}

export interface ComposeDoorProps {
  /**
   * Which door this is — `M213` `S4` (`D1094`).
   *
   * It selects a row of `vocabulary.ts` and nothing else. Everything conditional below reads that
   * row rather than this value, so *"what does BROWSER do differently"* is answered in one file a
   * reader can hold in their head, and adding LOAD or SCAN to this pane is a table entry rather
   * than a search through a component.
   */
  readonly door: Lens;
  readonly project: ProjectView;
  readonly onWritten: (path: string) => void;
  /**
   * The file every tab here is about, **read by the shell** (`M210` `S1`).
   *
   * All four doors used to run this identical read — `getFile(path)` into a `useState`, refreshed
   * on a path change — which is the four-way duplicate `M206` `S1` removed for the *path* and left
   * in place for the *bytes*. `D1081` is what forced it: the explorer draws the open file's
   * outline, so the shell needs the text too, and a fifth copy of the same read was the one
   * outcome worth refusing outright.
   */
  readonly file: FileView | null;
  /**
   * That file, read (`M210` `S1`, `D1072`) — derived by the shell, for the explorer and this pane
   * at once.
   *
   * Parsed **in this browser** with the same `@tflw/lang` `tflw check` runs: the package has no
   * dependencies and no Node builtins, which is why there is no second implementation here to
   * drift from the one CI grades against. `/api/project` carries a per-test index and deliberately
   * not this — an outline is a fact about the bytes the page is holding, and `S6`'s pending buffer
   * will hold bytes the server has not seen.
   */
  readonly outline: FileOutline | null;
  /** The pending buffer, and where a change to it goes (`M210` `S2`, `D1079`). `null` is *nothing
   *  unsaved*. Held by the shell so the explorer's outline and Source read the same bytes. */
  readonly draft: string | null;
  readonly onDraft: (text: string | null) => void;
  /** Why there is no file, when there is no file — a read failure has to be sayable somewhere. */
  readonly fileProblem: string | null;
  /** A write lands here: the shell's copy moves forward so every reader of it agrees at once. */
  readonly onFileWritten: (file: FileView) => void;
  /**
   * **Where a create is asked for** — `M214` `A6` (`D1118`).
   *
   * The dialog itself is the **shell's** now, and the reason is that `+ new file` belongs in the
   * explorer: creation lives where the thing is created, and the explorer is where files are. A
   * dialog owned by this component could not be opened from a sidebar that is this component's
   * sibling, so it moved up one level and both call sites hand it the same callback. The Compose
   * head stops being a toolbar, which is the fifth of this round's five complaints.
   */
  readonly onNew: (mode: NewMode) => void;
  /**
   * **What the explorer's `+` asked for, waiting to be carried out** — `M217` `D` (`D1139`).
   *
   * The sidebar builds nothing; it records *another request in the test at this index of this
   * file* and this pane runs it, through the same `addRequest` the sequence column's own button
   * calls. One construction path (`D1087`) survives a second entry point because the second entry
   * point is not a path, it is a caller.
   */
  /** The shell's single open-menu slot (`M218` `A`, `D1145`) — this door hands menus to it. */
  readonly onMenu: ((r: MenuRequest) => void) | null;
  readonly addIntent: { readonly path: string; readonly declIndex: number; readonly n: number } | null;
  readonly onAddIntentDone: () => void;
  /** Which stage of this file's life is showing (`M205` §2). It lives in the URL and nowhere else
   *  (`D1045`), so the shell owns it and hands it down — this form does not remember a tab. */
  readonly tab: TabId;
  readonly onTab: (tab: TabId, focusLine?: number) => void;
  /** The file every tab here is about (`M206` `Q4`), already resolved against the project by the
   *  shell (`S2a`) — this form used to keep its own, which is why a door change reset it. */
  readonly path: string;
  /** The strip's two project-fact tabs, built by the shell (`M206` `S2a`). A project fact is not
   *  this door's to own: a copy per door would be four editors over one `tflw.config`. */
  readonly authPanel: ReactNode;
  readonly configPanel: ReactNode;
  readonly configMark?: string;
  /** The line an `[edit]` link asked Config to land on — read off the end of the hash (`M205` S5b).
   *  It arrives from the shell rather than from a callback because it lives in the URL: a jump
   *  between tabs is a link, and the back button walks back out of it. */
  readonly focusLine: number | null;
  /** The project's runs, rendered by the shell. Passed in rather than imported so that `Run` can
   *  be a tab of this file's strip without this form learning what a report directory is. */
  readonly runPane: ReactNode;
  /** Why Run has something to say while you are composing — the shell knows about live runs and
   *  this form does not. */
  readonly runMark?: string;
  /**
   * **Start a run the shell's way** — `M220` `A` (`D1168`).
   *
   * ▶ on a declaration is a run like any other, so it goes through the shell's own `onRun`: the
   * record is selected, the stream is watched, and the end lands where every run's end lands.
   * `sendPrefix` below calls `startRun` directly *because a send is not a run* — it grades one
   * request against a scratch and paints the answer on a row — and that difference is exactly
   * `D1168`: a play must not grow a second execution path beside the one the page already has.
   */
  readonly onRun: (request: RunRequest) => void;
  /** Whether a run is in flight, so ▶ can hold rather than queue (`D1177`). */
  readonly running: boolean;
  /**
   * **A stamp that moves whenever the report list does** — `M220` `C` (`D1180`).
   *
   * The report lookback below is an effect over `[path, project]`, and **neither of those changes
   * when a run ends**: `refreshLists` replaces `runs` and `reports` and leaves `project` alone. So
   * before this the pane picked up a new run's verdicts *on the next reload*, which was tolerable
   * while a run was something you started from the strip and read in the Run tab, and is not
   * tolerable now that ▶ is a gesture inside the pane whose whole answer `D1172` puts on these
   * rows. Found by pressing ▶ on the served page and measuring: the run completed, the report was
   * written, and the pane was unchanged.
   *
   * A stamp rather than the list itself, because the effect wants *something moved* and an array
   * identity from `getReports()` is new on every poll whether or not anything happened.
   */
  readonly reportsStamp: string;
}

/**
 * **The retired form's vocabulary tables went with it** (`M212` `S4b`, `D1088`).
 *
 * `METHODS`, `SUBJECTS`, `MATCHERS`, `OPERANDLESS`, `ExpectRow` and `HeaderRow` were this file's
 * own restatement of the language, kept here because the legacy form drew its selects from them.
 * Compose draws its own from `ComposePane.tsx`, which is the one place they belong now — a second
 * copy of a vocabulary is a second thing to notice when the language grows, and this one had
 * already been overtaken once (`M200` `A2-3`'s scan subjects never reached it).
 */
/** The one test name Send writes. Fixed, because `--only` has to name it and an exploration
 *  that renamed itself on every press would leave a file nobody could re-run by hand. */
const SCRATCH_TEST = 'scratch';

/**
 * **A scoping block with one of its statements replaced** — `M219` `D` (`D1163`).
 *
 * Every edit to a statement inside a `within`, a `switch to new tab` or a `download` lands here,
 * because the body step is the block and not the statement. It goes back through the block's own
 * builder rather than being assembled here, which is `D1087` holding one level down: the pane
 * builds nothing, and the refusal a builder returns is the refusal the field shows.
 *
 * **The other statements are carried, never rebuilt.** An edit to the third gesture inside a block
 * is an edit to the third gesture, and the other two go back on as the nodes they were — the same
 * rule the head's own edit follows.
 */
function rescope(statement: OutlineStatement, inner: Step): { ok: true; node: Step } | { ok: false; reason: string } {
  const owner = statement.owner;
  if (owner === null || statement.inner === null) return { ok: false, reason: 'this row is not inside a block' };
  return reblock(owner, owner.body.map((s, i) => (i === statement.inner ? inner : s)));
}

/** The same block with a different body — one call per block kind, each through its own builder. */
function reblock(
  owner: WithinBlock | SwitchToNewTabBlock | DownloadBlock,
  body: readonly Step[],
): { ok: true; node: Step } | { ok: false; reason: string } {
  if (owner.type === 'WithinBlock') return buildWithin({ locator: { kind: owner.locator.kind, value: owner.locator.value.value }, frame: owner.frame, body });
  if (owner.type === 'SwitchToNewTabBlock') return buildSwitchToNewTab(body);
  return buildDownload({ name: owner.name, body });
}

export function ComposeDoor({ door, project, onWritten, tab, onTab, path, file, outline, draft, onDraft, fileProblem, onFileWritten, onNew, onMenu, addIntent, onAddIntentDone, focusLine, runPane, runMark, onRun, running, reportsStamp, authPanel, configPanel, configMark }: ComposeDoorProps) {
  /** **Which actions open a page** (`M219` `B`, `D1161`) — the index's own answer, flattened by
   *  the one function `App` flattens it with. Every `fileOutline` in this component re-reads the
   *  file after an edit to find where a statement moved to, and a re-read that folded sessions
   *  differently from the outline on screen would report the wrong line. */
  const opensPage = useMemo(() => pageOpeners(project.files), [project]);

  const [busy, setBusy] = useState(false);
  /** What `L<line>` names — one resolution, so the band and the card cannot disagree about which
   *  test they are showing (`D1080`). */
  const at = useMemo(() => (outline === null ? null : addressed(outline, focusLine)), [outline, focusLine]);

  /**
   * **What has run, for every request in this file** (`M213` `S2`, `D1099`).
   *
   * Two scopes in one map, and the split is between where each came from rather than between what
   * each can say. `report` is the last run that touched this file, read off disk — one fetch, no
   * run, every request. `sent` is one request's scoped send and it wins for that request, because
   * a press two seconds ago is better evidence about it than a run from Tuesday.
   *
   * Neither is a claim on its own. `ranIndex` below re-establishes both against the **buffer** on
   * every keystroke (`D1108`), which is why these hold the raw material and the pane never sees
   * it: what reaches a row is a verdict that is still about the text on that row.
   */
  const [reportRan, setReportRan] = useState<{ report: RunReport; reportId: string } | null>(null);
  /**
   * **The declaration the last ▶ in this pane was pressed on** (`M221` `A`, `D1182`).
   *
   * The stage is scoped to *this* gesture and not to "whatever the newest report holds": a
   * whole-suite run from the Run tab writes traces for every browser test it touched, and drawing
   * one of them under an editor nobody played would be the stage answering a question that was not
   * asked. Run's own viewer (`D1179`) is where that report is read.
   */
  const [played, setPlayed] = useState<string | null>(null);

  /**
   * The play scratch's hash, carried forward from each write's own response.
   *
   * A **ref** and not state: nothing renders from it, and a re-render between the press and the
   * `PUT` would otherwise be able to send a stale one. `null` means *this file should not exist
   * yet*, which is how the first play in a directory creates it; `writeScratch` below is what
   * recovers when that guess is wrong.
   */
  const playEtag = useRef<string | null>(null);

  /** A scratch in one directory says nothing about the next one. */
  useEffect(() => {
    playEtag.current = null;
  }, [path]);
  const [sentRan, setSentRan] = useState<{ line: number; steps: readonly StepResult[]; startedAt: string } | null>(null);
  /** `D1136` — bumped every time a create gesture lands, so the pane can focus what opened. */
  const [made, setMade] = useState(0);

  /**
   * **An edit that produces the bytes already there is not an edit** (`M210` `S4`).
   *
   * Every apply below ends here, and the guard exists because one gesture reaches it with nothing
   * to say: a new note opened and typed with whitespace resolves to *remove the note that is not
   * there*, which is a faithful no-op — and without this the buffer went dirty, the write button
   * appeared, and pressing it would have written the file back to itself.
   */
  const settle = useCallback(
    (text: string): boolean => {
      if (text === (draft ?? file?.text)) return false;
      onDraft(text);
      /**
       * **The verdicts are not dropped here any more, and that is a change `S2` had to argue for.**
       *
       * Until `M213` this line read `setRan(null)`: any edit anywhere blanked every mark in the
       * pane. That was right when a verdict could only arrive by pressing `send` on the row you
       * were looking at — the next thing you did was type into that row. It is wrong now that the
       * default scope is *every request in the file*, because the commonest edit in this pane is
       * **adding an assertion to one request**, and blanking the file would throw away twelve
       * correct verdicts to be honest about one.
       *
       * What replaced it is stricter, not looser: `ranIndex` re-derives the whole map from the
       * buffer on every keystroke and keeps a mark only where the line still reads exactly what
       * ran on it (`D1108`). A row that has been typed into loses its verdict on the first
       * character, the same as before; a row nobody touched keeps one it has earned.
       */
      return true;
    },
    [draft, file, onDraft],
  );

  /**
   * **A create gesture opens what it made** — `M217` `A` (`D1136`).
   *
   * Every `+` on this pane used to insert and then move nothing: the address stayed where it was,
   * `data-seq-open` stayed null, the editor went on showing the declaration, and focus stayed on
   * the button. Measured on `examples/storefront`, `+ request` on the test at `L41` put the new
   * request **fourteen rows down**, below a run of nine `expect`s, with nothing on the page
   * pointing at it. `+ let` is the worse of the three, because it writes the literal placeholder
   * `let value = "change me"` and then leaves you looking somewhere else.
   *
   * **The line is read back out of the text that was produced, never guessed.** `insertIntoSource`
   * formats before it splices, so the line a node lands on is not the line anything held before the
   * edit — this is `removeSteps`' rule (*the address has to move, because what it named is gone*)
   * applied to the other direction, and it is why `pick` is handed a fresh outline rather than a
   * number.
   *
   * `made` is a counter rather than a line because **the same line can be landed on twice** — add a
   * request, discard, add it again — and an effect keyed on the line would not fire the second
   * time. The pane uses it to put the cursor in the first field of whatever opened.
   */
  const landOn = useCallback(
    (text: string, pick: (after: FileOutline) => number | null): void => {
      setEditProblem(null);
      settle(text);
      const line = pick(fileOutline(path, text, opensPage));
      if (line === null) return;
      onTab('compose', line);
      setMade((n) => n + 1);
    },
    [settle, path, onTab, opensPage],
  );

  /** The declaration this gesture was fired on, re-read out of the edited text by the index that
   *  still identifies it — a line moves under `format`, an index does not. */
  const declAfter = useCallback(
    (after: FileOutline, decl: OutlineHook | OutlineTest): OutlineTest | null => {
      const d = after.declarations[decl.index];
      return d !== undefined && d.kind === 'test' ? d : null;
    },
    [],
  );

  /**
   * The selected request's field values — `M210` `S2`.
   *
   * **Here rather than in the pane**, because the strip unmounts panels (`M205` `S5a`, a rule this
   * round has now met three times). Keyed by the request's own index pair so that moving to another
   * request does not carry the last one's half-typed path with it, and re-derived from the file
   * whenever the selection changes.
   */
  const [edit, setEdit] = useState<{ key: string; values: RequestEdit } | null>(null);
  const selectedKey = at?.request ? `${at.request.stepPath.decl}:${at.request.stepPath.step}` : null;
  const values: RequestEdit | null = at?.request ? (edit?.key === selectedKey ? edit.values : editOf(at.request)) : null;

  /**
   * A field change, all the way to bytes (`D1079`).
   *
   * The values are held, the **text** is what they produce, and the text is the shell's — so one
   * keystroke moves the card, the explorer's outline and Source together, and the write carries
   * exactly what all three are showing. A change the builder refuses keeps the buffer where it is
   * and says why: the author can go on typing through an intermediate state that is not yet a
   * request, which every path is for its first character.
   *
   * **`M214` `A2` — the three fields are in the spec now, so they are no longer copied here.**
   * This used to carry `timeoutMs`, `followRedirects` and `retryAfter` across from the node,
   * because `ApiStepSpec` had no room for them; a node built from the spec alone came back without
   * them, which is source that still parses, still runs, still passes, and tests something the
   * author did not ask for. `specOf` fills all three from `RequestEdit` now and the builder writes
   * them — so an author can *change* a timeout, which is what the round was for, and the old
   * survives-an-edit gate is now a survives-an-edit-of-something-else gate.
   */
  const applyEdit = useCallback(
    (next: RequestEdit) => {
      if (!at?.request || !file) return;
      setEdit({ key: `${at.request.stepPath.decl}:${at.request.stepPath.step}`, values: next });
      const built = buildApiStep(specOf(next));
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const original: OutlineRequest = at.request;
      const request = {
        ...built.node,
        // An `upload` body is still carried whole, and it is now the ONLY thing that is:
        // `ApiBodySpec` cannot express one, so the builder returns `body: null` for it, and taking
        // that answer would delete a `multipart/form-data` payload from a request whose path
        // somebody edited. Widening the body spec is its own slice; widening the request spec was
        // `A2`.
        body: next.bodyKind === 'upload' ? original.spec.body : built.node.body,
      };
      /**
       * **A polling request is the same request in a different node** (`M210` `S4`).
       *
       * `wait until api GET /jobs/{id}` holds an `ApiRequestSpec` in a field rather than being one,
       * and its expects live inside its own block — which is why `S3` cannot address them and why
       * this was left read-only until now. Editing the *request* needs none of that: the built step
       * is an `ApiRequestSpec`, so it goes into the field, and the block's own two facts — the
       * nested expects and `waitMs`, which is the poll budget and **not** `timeoutMs` — are carried
       * from the node that was there.
       */
      const polling = original.node as WaitUntilApiStmt;
      const node: Step = original.kind === 'ApiStep'
        ? request
        : { type: 'WaitUntilApiStmt', request, expects: polling.expects, waitMs: polling.waitMs, span: polling.span };
      const out = replaceInSource(draft ?? file.text, { kind: 'step', path: original.stepPath, node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      /**
       * **Keep the address on the request it was on** (`D1080`).
       *
       * The address is a line and an edit can change how many lines a request occupies — adding a
       * header moves everything below it down. The request's *identity* across that edit is its
       * index pair, which is what `replaceInSource` was handed, so the new line is read back out of
       * the edited text by that pair and written to the hash. Without this, adding a header to the
       * first of three requests silently moves the selection to the one below.
       */
      const after = fileOutline(path, out.text, opensPage);
      const moved = after.declarations[original.stepPath.decl]?.body.requests.find((x) => x.stepPath.step === original.stepPath.step);
      if (moved && moved.line !== original.line) onTab('compose', moved.line);
    },
    [at, file, draft, settle, path, onTab, opensPage],
  );

  /**
   * A note, all the way to bytes (`D1077`, `M210` `S4`).
   *
   * The one edit on this pane that is not a node: a comment is not in the tree, so what addresses
   * it is its **owner** — the statement below it — through the same index pair. An empty list
   * removes the note, which is what a cleared textarea sends.
   */
  const applyNote = useCallback(
    (owner: NoteOwner, lines: readonly string[]) => {
      if (!file) return;
      /**
       * **A note with nothing in it is not a note.** Clearing the textarea is the only way to
       * remove one, and the same rule covers the gesture at the other end: `+ note` opens an editor
       * and writes nothing, so an author who opens one and thinks better of it leaves no `#` behind.
       *
       * The first draft carried a `had` flag to tell those two apart, and the mutation that dropped
       * it stayed green — because the only difference was whether an abandoned gesture littered the
       * file with a bare `#`. One rule is both better and smaller.
       */
      const blank = lines.every((line) => line.trim() === '');
      const out = replaceInSource(draft ?? file.text, { kind: 'note', owner, lines: blank ? [] : lines });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      /**
       * **KEEP THE ADDRESS ON WHAT THE NOTE IS ABOUT** — `D1080`, and `M214` is what made this
       * load-bearing rather than cosmetic.
       *
       * A note is the one edit that reliably changes how many lines the thing below it occupies:
       * writing a two-line note moves its owner down by two, and every statement after it with it.
       * The address is a **line**, so after the edit it names something else — and under `M212`'s
       * pane that only meant the highlight drifted, because every statement in the body was on
       * screen at once. `D1113` draws the SELECTED thing and nothing else, so a stranded address
       * takes the editor away from the statement whose note is being typed, mid-keystroke.
       *
       * `applyEdit` has done this since `M210` `S2` and this path did not, which is the same
       * defect one construct over: an edit that moves its subject has to say where the subject
       * went. The index pair is the identity that survives it.
       */
      if (owner.on === 'step') {
        const after = fileOutline(path, out.text, opensPage);
        const decl = after.declarations[owner.path.decl];
        const moved = decl === undefined
          ? undefined
          : [...statementsOf(decl.body), ...requestsOf(decl.body)].find(
              /* `inner !== null` is a row inside a block, which shares the block's index — the
                 note's owner is the step itself (`M219` `D`). */
              (x) => x.stepPath !== null && ('inner' in x ? x.inner === null : true) && x.stepPath.step === owner.path.step,
            );
        if (moved) onTab('compose', moved.line);
      }
    },
    [file, draft, settle, path, onTab, opensPage],
  );

  /**
   * The band's own facts (`M210` `S5`, `D1074`).
   *
   * A declaration's header is not a step, so it is not addressed by the index pair: it is the run
   * of lines from the declaration's first line to its own keyword line, and `replaceInSource`
   * replaces exactly those. **The body is never reprinted** — the printer emits no comments, so a
   * tag edit that went through the whole declaration would delete every note inside it.
   *
   * `buildTest` is handed the node's **own** workload, thresholds and body, and **none of the three
   * can reach the file through this path** — `printTest` emits a workload and the thresholds
   * *inside* the body, and the header replacement takes only the lines above it. They are passed so
   * the node is not a lie about the test it claims to be, which is what keeps this correct if the
   * header ever grows a line that reads one. Two mutations say so by staying green: dropping either
   * changes no byte anywhere, by construction rather than for want of a gate.
   */
  const [header, setHeader] = useState<{ key: string; values: HeaderEdit } | null>(null);
  const applyHeader = useCallback(
    (decl: OutlineHook | OutlineTest, next: HeaderEdit) => {
      if (!file) return;
      setHeader({ key: `decl:${decl.index}`, values: next });
      const built = ((): { ok: true; node: TestDecl | HookDecl } | { ok: false; reason: string } => {
        if (decl.kind === 'hook') return { ok: true, node: { ...decl.node, when: next.when, scope: next.scope } };
        const spec = tableSpecOf(next);
        const table = spec === null ? null : buildDataTable(spec);
        if (table !== null && !table.ok) return table;
        const retry = Number(next.retry.trim() === '' ? '0' : next.retry);
        if (!Number.isInteger(retry)) return { ok: false, reason: 'a retry count is a whole number of extra attempts' };
        return buildTest({
          name: next.name,
          // Space-separated, because that is how the file writes them: 450 of the corpus's 682 tag
          // lines carry more than one tag and none carries one per line.
          tags: next.tags.split(/\s+/).map((t) => t.replace(/^@/, '')).filter((t) => t !== ''),
          sessions: next.sessions.split(',').map((x) => x.trim()).filter((x) => x !== ''),
          retry,
          table: table === null ? null : table.node,
          concurrency: next.parallel ? 'parallel' : 'sequential',
          workload: decl.node.workload,
          thresholds: decl.node.thresholds,
          body: decl.node.body,
        });
      })();
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = replaceInSource(draft ?? file.text, { kind: 'header', decl: decl.index, node: built.node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
    },
    [file, draft, settle],
  );

  /** One threshold of a test, by its own index — `null` removes it, and an index past the end
   *  appends. The bound a form holds is the number beside the `%`, not the fraction the AST
   *  stores; `buildThreshold` owns that conversion so this never has to know it. */
  const [threshold, setThreshold] = useState<{ key: string; values: ThresholdEdit } | null>(null);
  const applyThreshold = useCallback(
    (decl: OutlineTest, index: number, next: ThresholdEdit | null) => {
      if (!file) return;
      setThreshold(next === null ? null : { key: `th:${decl.index}:${index}`, values: next });
      const built = next === null ? null : buildThreshold(thresholdSpecOf(next));
      if (built !== null && !built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = replaceInSource(draft ?? file.text, { kind: 'threshold', decl: decl.index, index, node: built === null ? null : built.node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
    },
    [file, draft, settle],
  );

  /** One `import` or `use` line. A blank field is that line removed — the same rule a note
   *  follows, and the reason there is no second gesture for taking one away. */
  const applyFileDecl = useCallback(
    (what: 'import' | 'use', index: number, path: string | null) => {
      if (!file) return;
      const node = path === null ? null : what === 'import'
        ? { type: 'ImportDecl' as const, path: stringLit(path), span: SYNTHETIC }
        : { type: 'UseDecl' as const, path: stringLit(path), span: SYNTHETIC };
      const out = replaceInSource(draft ?? file.text, { kind: 'file', what, index, node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
    },
    [file, draft, settle],
  );

  /**
   * **`+ request`** (`M212` `S4b`, `D1088`) — the one thing `.legacy` could do that Compose could
   * not, moved to where the rest of the `+` gestures live.
   *
   * Through the same builders and the same pending buffer as everything else on this pane, which is
   * `D1087`'s clause applied to a gesture rather than to a dialog: an `api` step and the `expect`
   * that reads it go in as **one** insertion, because inserting them separately would leave a
   * file, between two writes, whose assertion names a response nothing fetched.
   */
  const addRequest = useCallback(
    (decl: OutlineTest) => {
      if (!file) return;
      const step = buildApiStep({ method: 'GET', path: '/', service: null, label: null, headers: [], body: null });
      if (!step.ok) {
        setEditProblem(step.reason);
        return;
      }
      const expect = buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' });
      if (!expect.ok) {
        setEditProblem(expect.reason);
        return;
      }
      const out = insertIntoSource(draft ?? file.text, { kind: 'steps', testName: decl.name, nodes: [step.node, expect.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      /* `D1136` — the foot's gesture means *at the end*, so what it made is the body's last
         request. Read out of the edited text, because a `with each` table or a `retry` line above
         it moves every line below under `format`. */
      landOn(out.text, (after) => declAfter(after, decl)?.body.requests.at(-1)?.line ?? null);
    },
    [file, draft, landOn, declAfter],
  );

  /**
   * **A new request AFTER one that is already there** — `M217` `B` (`D1137`, `D1138`).
   *
   * Every request row carries a `+` beside its `✕`, and this is what it does. There is no dialog:
   * a request has no name to ask for, and the two fields one would ask for — method and path — are
   * offered by the editor beside this column the instant `landOn` selects the thing. A modal for
   * them would be a second authoring surface for fields that already have a first one, which is
   * what `D1087` exists to refuse.
   *
   * **“After” means after the request AND the statements attached to it, and that is the whole
   * decision** (`D1138`). `body` means *the last response*, so a request spliced on the literal next
   * line re-points every assertion under it until the next request — an `expect status` that still
   * passes, a `capture` that binds nothing, and a failure surfacing two statements away in a
   * request nobody touched. Measured on `examples/storefront`: **19 of 19** requests have
   * statements attached, 47 of the 49 of them read the response, so the literal reading is unsafe
   * in every single case the corpus has. Anchoring on the last attachment makes the hazard stop
   * existing rather than be detected — there is nothing to warn about, because nothing below
   * changes which response it reads.
   *
   * The anchor expression is `verify`'s, character for character, and deliberately so: tick-to-verify
   * had to solve the same problem one construct over, and two derivations of *where does this
   * request's run of statements end* is two places for it to be wrong.
   */
  const addRequestAfter = useCallback(
    (decl: OutlineTest, request: OutlineRequest) => {
      if (!file) return;
      const step = buildApiStep({ method: 'GET', path: '/', service: null, label: null, headers: [], body: null });
      if (!step.ok) {
        setEditProblem(step.reason);
        return;
      }
      const expect = buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' });
      if (!expect.ok) {
        setEditProblem(expect.reason);
        return;
      }
      const out = insertIntoSource(draft ?? file.text, {
        kind: 'stepsAfter',
        path: anchorAfter(request),
        nodes: [step.node, expect.node],
      });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      /* The one after the one it was fired on. Addressed by POSITION IN THE LIST rather than by
         line, for `landOn`'s reason: the splice re-formats, so the pre-edit line of the next
         request is not its post-edit line. */
      const at = decl.body.requests.findIndex((r) => r.line === request.line);
      landOn(out.text, (after) => (at < 0 ? null : declAfter(after, decl)?.body.requests[at + 1]?.line ?? null));
    },
    [file, draft, landOn, declAfter],
  );

  /**
   * **Duplicate this request, with the statements that belong to it** — `M218` `F` (`D1156`).
   *
   * One edit, never two, and the statements are not optional. `body` means *the last response*
   * (`checker.ts:1754`), so a request copied without its assertions lands between the original and
   * its expects and silently re-points every one of them at the copy — the original stops being
   * checked and the copy is checked twice. `M217` measured that hazard at **19 of 19** requests in
   * `examples/storefront`, which is why `OutlineRequest.attached` exists and why this reuses it
   * rather than copying a line range.
   *
   * **Nested rows are dropped on purpose.** A `wait until api`'s expects live inside its block and
   * carry a `null` `stepPath`; the block's own node already contains them, so copying them beside
   * it would write them twice. The filter is the same one `anchorAfter` applies, for the same
   * reason.
   */
  const duplicateRequest = useCallback(
    (decl: OutlineTest, request: OutlineRequest) => {
      if (!file) return;
      const nodes = [request.node, ...request.attached.filter((a) => a.stepPath !== null).map((a) => a.node)];
      const out = insertIntoSource(draft ?? file.text, { kind: 'stepsAfter', path: anchorAfter(request), nodes });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      const at = decl.body.requests.findIndex((r) => r.line === request.line);
      landOn(out.text, (after) => (at < 0 ? null : declAfter(after, decl)?.body.requests[at + 1]?.line ?? null));
    },
    [file, draft, landOn, declAfter],
  );

  /**
   * **Carrying out the explorer's `+`** — `M217` `D` (`D1139`).
   *
   * It waits for `outline` to be **this** file's before it acts, because `setFile` and the read
   * that follows it are not the same tick: for one render the path has moved and the bytes have
   * not, and a splice run then would add a request to a declaration index of the *previous* file.
   * The intent carries the path it was made against, so the comparison is a fact rather than a
   * timing assumption.
   *
   * `onAddIntentDone` fires before the splice, not after — the intent has been *taken*, and leaving
   * it set for the length of a state update is how one press becomes two requests.
   */
  useEffect(() => {
    if (addIntent === null || outline === null || file === null) return;
    if (addIntent.path !== path || file.path !== path) return;
    const decl = outline.declarations[addIntent.declIndex];
    onAddIntentDone();
    if (decl !== undefined && decl.kind === 'test') addRequest(decl);
  }, [addIntent, outline, file, path, addRequest, onAddIntentDone]);

  /**
   * **`✕`** — `M214` `A4` (`D1117`).
   *
   * The gesture the pane had for a header, a subset entry, a threshold and a table row, and had for
   * nothing a person actually writes. It goes through `replaceInSource`'s own `remove` member,
   * which takes a **list** of step indices because removing a request has to remove the statements
   * attached to it in the same edit — `body` means *the last response*, so an `expect` left behind
   * after its request is gone reads a different one and may well pass.
   *
   * **The refusal is not here.** The pane runs the dependency scan (`depends.ts`) and never calls
   * this while a later statement is still reading a binding one of these lines makes; this end only
   * writes bytes. That split is deliberate: the reason lives beside the control that was pressed,
   * where a reader can act on it.
   */
  const removeSteps = useCallback(
    (decl: OutlineHook | OutlineTest, steps: readonly number[]) => {
      if (!file) return;
      const out = replaceInSource(draft ?? file.text, { kind: 'remove', decl: decl.index, steps: [...steps] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      /* **The address has to move, because what it named is gone.** A line is a position and the
         position no longer holds the thing that was there — so the selection lands on the
         declaration the removal happened in, read back out of the edited text by the index that
         still identifies it. Leaving it where it was points the editor at whatever moved up. */
      const after = fileOutline(path, out.text, opensPage);
      const moved = after.declarations[decl.index];
      onTab('compose', moved ? moved.line : 1);
    },
    [file, draft, settle, path, onTab, opensPage],
  );

  /**
   * **`✕` on a statement inside a scoping block** — `M219` `D` (`D1163`).
   *
   * `removeSteps` takes indices into a body and a statement inside a block is not one of them, so
   * this is the second removal and not a special case of the first: the block is rebuilt without
   * it. The last statement out takes the block with it — an empty `within` does not parse, and
   * both `buildWithin` and the printer refuse one for that reason, so removing it as a *block*
   * is the honest edit rather than a refusal the author cannot act on.
   */
  const removeScoped = useCallback(
    (statement: OutlineStatement) => {
      if (!file || statement.owner === null || statement.inner === null || statement.stepPath === null) return;
      const owner = statement.owner;
      const addr = statement.stepPath;
      const body = owner.body.filter((_, i) => i !== statement.inner);
      const out = body.length === 0
        ? replaceInSource(draft ?? file.text, { kind: 'remove', decl: addr.decl, steps: [addr.step] })
        : ((): ReturnType<typeof replaceInSource> => {
            const rebuilt = reblock(owner, body);
            return rebuilt.ok ? replaceInSource(draft ?? file.text, { kind: 'step', path: addr, node: rebuilt.node }) : rebuilt;
          })();
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      const after = fileOutline(path, out.text, opensPage);
      const moved = after.declarations[addr.decl];
      onTab('compose', moved ? moved.line : 1);
    },
    [file, draft, settle, onTab, opensPage, path],
  );

  /**
   * **Take the scope off and keep the statement** — `M219` `D` (`D1163`).
   *
   * Offered on a block that holds exactly one statement, which is **397 of the corpus's 405**
   * `within` blocks and every one of its `switch to new tab` and `download` blocks. It is not
   * offered on the other eight, and the reason is a fact about the splice rather than a policy:
   * `replaceInSource` replaces one step with one node, and a block of six statements unscopes to
   * six. A gesture that silently dropped five would be worse than one that is not there.
   */
  const unscope = useCallback(
    (statement: OutlineStatement) => {
      if (!file || statement.stepPath === null || statement.body === null || statement.body.length !== 1) return;
      const addr = statement.stepPath;
      const inner = (statement.node as WithinBlock | SwitchToNewTabBlock | DownloadBlock).body[0]!;
      const out = replaceInSource(draft ?? file.text, { kind: 'step', path: addr, node: inner });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      /* The statement is where the block was, so the address lands on it rather than on the
         declaration — the one removal in this file that does not lose what it was pointing at. */
      const after = fileOutline(path, out.text, opensPage);
      const moved = statementsOf(after.declarations[addr.decl]?.body ?? { preamble: [], requests: [], sessions: [] })
        .find((x) => x.inner === null && x.stepPath?.step === addr.step);
      onTab('compose', moved?.line ?? after.declarations[addr.decl]?.line ?? 1);
    },
    [file, draft, settle, onTab, opensPage, path],
  );

  /**
   * **Put a scope ON a statement** — `M219` `E`, and the half of `D1163` that keeps `WithinBlock`
   * constructible without putting it in the `+` list.
   *
   * `D1164` takes `within` out of the `+` vocabulary because a scope is not a statement you add,
   * it is a property of the statement it scopes — so the gesture is on the row: `⤹` wraps it, `⤺`
   * unwraps it, and between them `D1162`'s claim that all 22 kinds are constructible stays true.
   *
   * The locator is a placeholder for the reason every placeholder here is one: `buildLocator`
   * refuses an empty value, so the choice was *obviously unfinished* or *plausible and wrong*.
   */
  const scope = useCallback(
    (statement: OutlineStatement) => {
      if (!file || statement.stepPath === null || statement.inner !== null) return;
      const addr = statement.stepPath;
      const built = buildWithin({ locator: { kind: 'css', value: 'change me' }, frame: false, body: [statement.node] });
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = replaceInSource(draft ?? file.text, { kind: 'step', path: addr, node: built.node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      landOn(out.text, (after) =>
        statementsOf(after.declarations[addr.decl]?.body ?? { preamble: [], requests: [], sessions: [] })
          .find((x) => x.inner === null && x.stepPath?.step === addr.step)?.line ?? null,
      );
    },
    [file, draft, landOn],
  );

  /** The same gesture one level up — the sequence column's first row is the test, so the test has a
   *  `✕` like everything under it. What follows is the **file**, which is the one subject that
   *  always exists: an address with no `L` is `selectedAt`'s `file`. */
  const removeDecl = useCallback(
    (decl: OutlineHook | OutlineTest) => {
      if (!file) return;
      const out = replaceInSource(draft ?? file.text, { kind: 'removeDecl', decl: decl.index });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      onTab('compose');
    },
    [file, draft, settle, onTab],
  );

  /**
   * **Tick-to-verify** (`M213` `S2`, `D1100`) — a ticked response becomes one assertion, under the
   * request it is about.
   *
   * `stepsAfter` and not `steps`, which is the whole reason `insert.ts` grew a second member this
   * slice: `steps` appends at the foot of the test body, and an `expect` written under a *later*
   * request does not assert about the response that was ticked — `body` means the last response,
   * so it silently reads a different one and may well pass. The anchor is the request's own last
   * attachment, or the request itself when nothing is attached yet, so the new line joins the run
   * of statements that already read this response rather than opening a second one below them.
   *
   * It goes through `buildExpect` and the printer like every other gesture on this pane (`D1087`).
   * Nothing here concatenates a string, which is what keeps a ticked `"` or a key with a space in
   * it from becoming a file that does not parse.
   */
  const verify = useCallback(
    (request: OutlineRequest, spec: ExpectSpec) => {
      if (!file) return;
      const built = buildExpect(spec);
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = insertIntoSource(draft ?? file.text, { kind: 'stepsAfter', path: anchorAfter(request), nodes: [built.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
    },
    [file, draft, settle],
  );

  /**
   * **`capture` from a ticked response** (`M213` `S3`, `D1102`) — the first arrow of *sign in →
   * capture the token → authed call → assert*.
   *
   * One insertion for however many were ticked, under the request they were read from, for
   * `verify`'s reason one construct over: `body` means the last response, so a capture written
   * below a later request binds out of a different one. Several statements go in as one edit
   * because a file between two writes whose second capture is missing is a file that does not run.
   */
  const captureFrom = useCallback(
    (request: OutlineRequest, specs: readonly CaptureSpec[]) => {
      if (!file || specs.length === 0) return;
      const nodes: Step[] = [];
      for (const spec of specs) {
        const built = buildCapture(spec);
        if (!built.ok) {
          setEditProblem(built.reason);
          return;
        }
        nodes.push(built.node);
      }
      const out = insertIntoSource(draft ?? file.text, { kind: 'stepsAfter', path: anchorAfter(request), nodes });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
    },
    [file, draft, settle],
  );

  /**
   * **`+ let`** (`D1102`) — a binding at the **top** of the body.
   *
   * Not at the foot, where `+ request` puts its work, and the difference is what a `let` is for: a
   * binding has to exist before the request that interpolates it, and `outline.ts` measured **97
   * of the corpus' 100 preamble statements are `let`** — so the place a reader looks for one is
   * the top of the test, and the place it has to be for the next gesture to use it is above every
   * request. Both point the same way.
   *
   * A test with no steps at all gets it through `kind: 'steps'`, which anchors under the header
   * (or under the workload line, which is the shape a LOAD-authored test has) — `insertInTest`'s
   * own careful case, reused rather than re-derived here.
   */
  const addLetTo = useCallback(
    (decl: OutlineTest) => {
      if (!file) return;
      const built = buildLet({ name: 'value', value: '"change me"' });
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      /* The first thing in the body that an index pair can name. **`stepPath` is `null` for a row
         inside a block** — `outline.ts` says so on the field — and a `!` here would have handed
         `insertIntoSource` an undefined address on a test whose body opens with one. An empty body
         falls through to `steps`, which anchors under the header or under the workload line: the
         shape a LOAD-authored test has, and `insertInTest`'s own careful case rather than a second
         derivation of it here. */
      const first = [...statementsOf(decl.body).filter((x) => x.inner === null), ...requestsOf(decl.body)]
        .filter((x) => x.stepPath !== null)
        .sort((a, b) => a.stepPath!.step - b.stepPath!.step)[0];
      const out = first === undefined || first.stepPath === null
        ? insertIntoSource(draft ?? file.text, { kind: 'steps', testName: decl.name, nodes: [built.node] })
        : insertIntoSource(draft ?? file.text, { kind: 'stepsBefore', path: first.stepPath, nodes: [built.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      /* `D1136`. A `let` goes at the TOP of the body, so what it made is the first thing in the
         preamble — and this is the gesture that needed opening most, because what it writes is a
         placeholder (`let value = "change me"`) asking to be typed over. */
      landOn(out.text, (after) => declAfter(after, decl)?.body.preamble[0]?.line ?? null);
    },
    [file, draft, landOn, declAfter],
  );

  /**
   * **`+ wait until`** (`D1102`) — a request re-issued until an assertion under it holds.
   *
   * It goes at the foot beside `+ request`, because it *is* a request: it is the statement a test
   * reaches for when the thing it just asked for happens asynchronously, and that is after
   * whatever asked for it. The default carries **one** assertion rather than none, and that is the
   * builder's rule rather than a nicety — `buildWaitUntilApi` refuses an empty block, because a
   * poll with nothing to wait for is a sleep with a request in it and the parser would accept it.
   */
  const addWaitTo = useCallback(
    (decl: OutlineTest) => {
      if (!file) return;
      const built = buildWaitUntilApi({
        request: { method: 'GET', path: '/', service: null, label: null, headers: [], body: null },
        expects: [{ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' }],
        waitMs: null,
      });
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = insertIntoSource(draft ?? file.text, { kind: 'steps', testName: decl.name, nodes: [built.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      /* `D1136`. `wait until api` IS a request — `outline.ts` puts it in `body.requests` — so what
         this made is the body's last request, exactly as the foot's `+ request` is. */
      landOn(out.text, (after) => declAfter(after, decl)?.body.requests.at(-1)?.line ?? null);
    },
    [file, draft, landOn, declAfter],
  );

  /**
   * **What a right-clicked sequence row can do** — `M218` `F`.
   *
   * Unlike the explorer's, this menu gathers almost nothing: measured before it was built, **every**
   * row of the sequence already shows `.seq-pick` and `.seq-x`, and request rows also show `M217`'s
   * `.seq-plus`. So it earns its place on the two operations that did not exist — *duplicate*, and
   * *go to this line in Source* — and carries the rest for reachability rather than for discovery.
   *
   * `onRemoveSteps` is reused verbatim rather than re-implemented: removing a request has to remove
   * its attachments in the same edit (`D1117`), and a menu with its own idea of that would be a
   * second answer to a question the language already settled.
   */
  const seqMenuFor = useCallback(
    (t: SeqTarget): readonly MenuItem[] => {
      const copyable = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
      const clip = (text: string): MenuItem =>
        copyable
          ? { id: 'copy', label: 'Copy its source', run: () => { void navigator.clipboard?.writeText(text); } }
          : { id: 'copy', label: 'Copy its source', run: null, why: 'the clipboard is only available over https or on localhost' };
      const source: MenuItem = { id: 'source', label: 'Show this line in Source', run: () => onTab('source', t.line) };
      if (t.kind === 'test') {
        return [
          { id: 'new-request', label: 'New request here', run: () => addRequest(t.decl) },
          { id: 'new-let', label: 'New `let` here', run: () => addLetTo(t.decl) },
          source,
        ];
      }
      if (t.kind === 'request') {
        return [
          { id: 'open', label: 'Open it in the editor', run: () => onTab('compose', t.line) },
          { id: 'duplicate', label: 'Duplicate it, with its statements', run: () => duplicateRequest(t.decl, t.request) },
          { id: 'add-after', label: 'New request after it', run: () => addRequestAfter(t.decl, t.request) },
          source,
          clip([t.request, ...t.request.attached].map((x) => ('text' in x ? x.text : `${t.request.method} ${t.request.path}`)).join('\n')),
        ];
      }
      return [
        { id: 'open', label: 'Open it in the editor', run: () => onTab('compose', t.line) },
        source,
        clip(t.statement.text),
      ];
    },
    [onTab, addRequest, addLetTo, addRequestAfter, duplicateRequest],
  );


  /**
   * **`+ open`** (`M213` `S4`, `D1094`) — the page a browser test works against.
   *
   * At the **top** of the body, for `+ let`'s reason and a stronger one: every gesture below it
   * acts on whatever page is open, so an `open` written at the foot is a navigation that undoes
   * the test above it. `BrowserForm` had the same rule and expressed it as a mode — *"a new test
   * that opens a page"* versus *"more steps for a test that already opened one"* — which made the
   * author answer a question the file already answers.
   */
  const addOpen = useCallback(
    (decl: OutlineTest) => {
      if (!file) return;
      const built = buildOpen('/');
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const first = [...statementsOf(decl.body).filter((x) => x.inner === null), ...requestsOf(decl.body)]
        .filter((x) => x.stepPath !== null)
        .sort((a, b) => a.stepPath!.step - b.stepPath!.step)[0];
      const out = first === undefined || first.stepPath === null
        ? insertIntoSource(draft ?? file.text, { kind: 'steps', testName: decl.name, nodes: [built.node] })
        : insertIntoSource(draft ?? file.text, { kind: 'stepsBefore', path: first.stepPath, nodes: [built.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      /* Lands on the `open`, for `addGesture`'s reason — it goes to the TOP of the body, so with
         no selection it is the one create gesture whose result is furthest from where you pressed. */
      landOn(out.text, (after) => {
        const body = after.declarations[decl.index]?.body;
        return body === undefined ? null : body.sessions[0]?.head.line ?? statementsOf(body).find((x) => x.inner === null)?.line ?? null;
      });
    },
    [file, draft, landOn],
  );

  /**
   * **`+ click` and `+ fill`** (`D1094`) — one gesture against the open page, at the foot.
   *
   * At the foot and not above anything, because a browser test is a **sequence against a page
   * whose state the previous step left**: a click inserted in the middle acts on a page that has
   * not had the steps below it applied. That is the same argument `send` loses on this door
   * (`vocabulary.ts`'s `sends`), seen from the authoring side.
   *
   * **THE PLACEHOLDER IS DELIBERATELY NOT PLAUSIBLE, AND THERE IS NO THIRD OPTION.** The first
   * draft used a blank locator on the reasoning that a name reading as real (`"Buy"`) is a test
   * that looks written and asserts about an element nobody chose. `buildLocator` refuses a blank
   * value outright — *"a `button` locator needs something to match"* — so the button wrote nothing
   * and said so in the problem line, which the gate caught on its first run. What is left is the
   * same rule `+ let` already follows: a value that is syntactically fine and obviously unfinished,
   * so the file parses, the row is editable in place, and nobody mistakes it for a decision.
   */
  const addGesture = useCallback(
    (decl: OutlineTest, which: 'click' | 'fill') => {
      if (!file) return;
      const built = which === 'click'
        ? buildClick({ locator: { kind: 'button', value: 'change me' }, kind: 'single' })
        : buildFill({ locator: { kind: 'field', value: 'change me' }, value: '"change me"' });
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = insertIntoSource(draft ?? file.text, { kind: 'steps', testName: decl.name, nodes: [built.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      /**
       * **It lands ON the new statement, which it did not before `M219` `A`** (`D1136`).
       *
       * On the pane this door used to draw, every row was a live form, so a statement spliced at
       * the foot was already editable where it landed and there was nothing to select. This pane
       * draws **one** editor, for whatever the address names — so a `+ click` that settled the
       * text and moved nothing put a row with a `change me` locator fourteen rows down a list
       * nobody was pointing at. That is `M217` `§2.1`'s finding about `+ request`, inherited by
       * the two gestures that had never needed the fix.
       */
      landOn(out.text, (after) => {
        const body = after.declarations[decl.index]?.body;
        return body === undefined ? null : statementsOf(body).filter((x) => x.inner === null).at(-1)?.line ?? null;
      });
    },
    [file, draft, landOn],
  );

  /**
   * **`tflw pick`, as a locator-fixer** — `M213` `S4` (`D1106`).
   *
   * Held here rather than in the pane for the reason this round has now met five times: the strip
   * unmounts panels (`M205` `S5a`), and a running browser session held below one would die on a
   * glance at Source. It is also why `endPick` runs on unmount of *this* component — the door
   * changing is the one event that should close the browser, and `M200` `A3-7`'s own gate asserts
   * that on the process rather than on the DOM.
   */
  const [picking, setPicking] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly LocatorSpec[]>([]);
  /**
   * The live session's unsubscribe, in a **ref** rather than in state — `M213` `S4`.
   *
   * `BrowserForm` held it in state and relied on its own unmount to stop the child, which was
   * sound while one component served one door. It is not sound now: this component serves **two**,
   * so a browser → API door change re-renders it instead of unmounting it, and the first run of
   * `M206` `S3`'s gate after the retirement said so — *"pid 1531376 is still alive 5000 ms after
   * the door changed — the pick session was orphaned"* (`M213-21`). A ref is what lets the cleanup
   * below depend on the **door** rather than on the subscription, which a state value cannot:
   * putting `stopPick` in the dependency list makes the effect re-run on every start and stop the
   * session it just opened.
   */
  const pickStop = useRef<(() => void) | null>(null);

  /**
   * The page a session opens against, read out of the **file** rather than out of a field.
   *
   * `BrowserForm` asked: its mode select decided between the path its own `open` field held and a
   * bare `/`. The test already says where it works, in its own `open` statement, so the form was
   * asking the author to repeat a fact the file states — and could be answered wrong. First
   * `open` in the addressed declaration, `/` when there is none yet.
   */
  const pickPath = useMemo(() => {
    const body = at?.decl?.body;
    if (!body) return '/';
    for (const statement of statementsOf(body)) {
      if (statement.node.type === 'OpenStmt') return statement.node.path.value;
    }
    return '/';
  }, [at]);

  const endPick = useCallback(() => {
    pickStop.current?.();
    pickStop.current = null;
    setPicking(null);
    setSession((current) => (current === null || current.kind !== 'pick' ? current : { ...current, live: false }));
  }, []);

  const startPick = useCallback(
    (key: string) => {
      pickStop.current?.();
      setPicked([]);
      setPicking(key);
      /* **A pick streams into the same panel a recording does** (`D1165`). One live browser, one
         list of what it handed back — the row's own suggestions stay, because the field is where
         a locator is *used* and the panel is where it arrives. */
      setSession({ kind: 'pick', live: true, into: null, lines: [] });
      const unsubscribe = pickLocators(pickPath, {
        line: (text) => {
          const locator = locatorFromPickLine(text);
          if (!locator) return;
          setPicked((current) => [locator, ...current]);
          const id = (lineId.current += 1);
          setSession((current) => (current === null ? current : { ...current, lines: [{ id, kind: 'locator', locator }, ...current.lines] }));
        },
        /* A `pick` that cannot start says so on the row rather than in a console nobody is
           reading — the session is a real browser and the commonest reason it fails is that one
           is not installed. */
        problem: (text) => setEditProblem(text),
        end: () => {
          setPicking(null);
          setSession((current) => (current === null || current.kind !== 'pick' ? current : { ...current, live: false }));
        },
      });
      pickStop.current = unsubscribe;
    },
    [pickPath],
  );

  /**
   * **The door changing is what closes the browser** — `M206` `S3`, asserted on the process and
   * not on the DOM, because an orphaned browser is invisible to every assertion a page can make
   * about itself.
   *
   * The dependency is `door` and `path`: leaving the door is the event the promise is about, and a
   * session opened against one file's page has nothing to say about another's. Unmount is covered
   * by the same cleanup, which is what it used to rely on alone.
   */
  useEffect(
    () => () => {
      pickStop.current?.();
      pickStop.current = null;
    },
    [door, path],
  );

  /**
   * **The session recorder** — `M213` `S5` (`D1095`, `D1106`).
   *
   * One press opens a real browser at the page this test opens and writes every action in it into
   * this test's body, as it happens. It is a `+` gesture and not a mode, which is the whole of the
   * shape: a recorder that opened its own surface, with its own list of pending steps and its own
   * save button, would be `BrowserForm` again wearing a camera — and `M213-08` is the row about
   * exactly that.
   *
   * **EACH LINE IS PARSED BEFORE IT IS BELIEVED.** `record` prints two banner lines before the
   * first statement, and a reader that filtered by matching their wording would be coupled to it —
   * `pick`'s own lesson, one command over. So a line becomes a step only if the grammar says it is
   * one, which is a question only the parser is entitled to answer and is immune to rewording.
   *
   * **AND EACH ONE IS ITS OWN EDIT.** The alternative — buffer the session and splice it at the
   * end — loses the whole recording when the browser is closed the wrong way, and makes the pane
   * show nothing while a person works. `D1079`'s pending buffer already makes an edit cheap and
   * reversible, so the recorder uses it the way every other gesture does: the statements appear in
   * the file as they happen, and Discard is what undoes them.
   */
  const [recording, setRecording] = useState<number | null>(null);
  const recordStop = useRef<(() => void) | null>(null);
  /** The buffer as this component last knew it — see `appendRecorded` for why a ref. */
  const textRef = useRef<string>('');
  useEffect(() => {
    if (recording === null) textRef.current = draft ?? file?.text ?? '';
  }, [draft, file, recording]);
  /** The declaration being recorded into, read fresh on each line — see `appendRecorded`. */
  const recordInto = useRef<string | null>(null);

  /**
   * One recorded statement into the open buffer.
   *
   * **It re-reads the outline from the buffer rather than closing over the declaration**, and that
   * is not caution: every line this appends moves the lines below it, so a `decl` captured when
   * the session started is stale by the second statement. The test is named instead, because a
   * name is the one address that does not move under an insertion — which is `insertIntoSource`'s
   * own argument for `steps` taking a `testName`.
   */
  /**
   * **What the live browser has handed back** — `M219` `F` (`D1165`), and the state that amends
   * `D1095`.
   *
   * A recorded statement lands **here** and not in the buffer. `D1095`'s argument for appending
   * live was that the buffer is reversible — it is, and what it is not is reviewable: a two-minute
   * session writes thirty statements into the file the author is looking at, and picking out the
   * four mis-clicks means finding them among the twenty-six that were not.
   */
  const [session, setSession] = useState<Session | null>(null);
  const lineId = useRef(0);
  useEffect(() => setSession(null), [path]);

  const appendRecorded = useCallback(
    (line: string) => {
      /**
       * **Parsed before it is believed, exactly as it was** (`D1095`). A recorder writes whatever
       * the page gave it and a page's `<option>` text is arbitrary user content, so the line is
       * read by the language before anything is done with it — what changed in `M219` `F` is only
       * that a line that reads becomes a **row here** instead of bytes in the file.
       *
       * **A LINE THAT DOES NOT READ IS STILL DROPPED, AND THE ATTEMPT TO STOP DROPPING IT IS THE
       * FINDING** (`M219-01`). Keeping it looked like closing a `D1076` silence — a gesture the
       * language cannot spell vanishing with nothing to report — and it is not, because
       * `tflw record`'s stream has **no framing**: the two banners it opens with (*"recording
       * … — press Ctrl+C to stop."*, *"ready — use the page as a user would."*) fail to parse for
       * exactly the same reason a refused gesture does, and nothing in the line says which it is.
       * Built and measured: every session opened with two junk rows. So the page cannot attribute
       * an unparseable line and does not pretend to; the fix belongs in the stream, and is filed
       * rather than guessed at here.
       */
      const { program, diagnostics } = parseSource(`test "r"\n  ${line}\n`);
      if (diagnostics.some((d) => d.severity === 'error')) return;
      const node = program.tests[0]?.body[0];
      if (node === undefined) return;
      const id = (lineId.current += 1);
      const row: SessionLine = { id, kind: 'step', text: print(node).ok ? (print(node) as { text: string }).text : line, node };
      setSession((current) => (current === null ? current : { ...current, lines: [...current.lines, row] }));
    },
    [],
  );

  /**
   * **Keep one line** — the tick that makes a statement out of evidence (`D1102`'s rule, one door
   * over).
   *
   * The splice runs against `textRef`, updated synchronously, for the reason the recorder's own
   * splice did: React batches, and *keep all* is a burst of them in one tick. The ref is written
   * the moment a splice succeeds, which is the only ordering that makes a run of keeps a sequence
   * rather than a race.
   */
  const keepLine = useCallback(
    (line: SessionLine) => {
      if (!file) return;
      if (line.kind === 'locator') {
        /* A picked locator is not a statement; it is an answer to *what do I write in this field*,
           and the field is the row the pick was started on. Same write `PickField` made. */
        setPicked([line.locator]);
        return;
      }
      if (line.kind !== 'step') return;
      const name = session?.into ?? null;
      if (name === null) return;
      const out = insertIntoSource(textRef.current, { kind: 'steps', testName: name, nodes: [line.node] });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      textRef.current = out.text;
      settle(out.text);
      setSession((current) => (current === null ? current : { ...current, lines: current.lines.filter((l) => l.id !== line.id) }));
    },
    [file, settle, session],
  );

  const keepAll = useCallback(() => {
    if (!file || session === null || session.into === null) return;
    const nodes = session.lines.flatMap((l) => (l.kind === 'step' ? [l.node] : []));
    if (nodes.length === 0) return;
    const out = insertIntoSource(textRef.current, { kind: 'steps', testName: session.into, nodes });
    if (!out.ok) {
      setEditProblem(out.reason);
      return;
    }
    textRef.current = out.text;
    settle(out.text);
    setSession((current) => (current === null ? current : { ...current, lines: current.lines.filter((l) => l.kind !== 'step') }));
  }, [file, settle, session]);

  /**
   * Write the play scratch, recovering **once** from a hash nobody here could have known.
   *
   * The scratch is written by this pane and read by nothing else, so the ordinary path is one
   * `PUT` under the hash the last one returned. A `409` means the file on disk is not what this
   * page last left there — the first play after a reload (the ref starts `null` and the file is
   * already there from a previous session), or another tab having played the same directory. In
   * both cases the correct answer is the same and it is not to refuse: **this file is a scratch,
   * its whole contract is that it is overwritten**, so the current hash is read and the write is
   * repeated under it.
   *
   * **Once, and not a loop.** A second `409` is a directory under active contention by something
   * that is not this page, and retrying forever would turn that into a spin. It surfaces as a
   * problem with a sentence, which is the same shape every other write failure on this pane has.
   */
  const writeScratch = useCallback(
    async (target: string, text: string, etag: string | null): Promise<{ ok: true; etag: string } | { ok: false; error: string }> => {
      const first = await putFile(target, text, etag);
      if (first.ok) return first;
      if (first.status !== 409) return { ok: false, error: first.code ? `${first.code} at line ${first.line}: ${first.error}` : first.error };
      const current = await getFile(target).catch(() => null);
      if (current === null) return { ok: false, error: `${first.error} — and the scratch could not be re-read` };
      const second = await putFile(target, text, current.etag);
      if (second.ok) return second;
      return { ok: false, error: `${second.error} — ${target} is being written by something else` };
    },
    [],
  );

  /**
   * **▶ on the session panel — run the test WITH the pending lines in it** (`M221` `C`, `D1185`).
   *
   * **Not the lines alone**, and that is the whole design of this gesture. A recording is *into* a
   * declaration — the panel's own header says `recording into <name>` — and the state those lines
   * assume was built by the steps above them. Four lines lifted out and run on their own error on
   * the first locator that needs a page nobody opened. What the author is actually asking is *would
   * this test still work if I kept these?*, and the only run that answers it is the test as it
   * would be.
   *
   * **And it keeps nothing** (`D1186`). The splice lands in the scratch text and nowhere else:
   * `textRef` is not written, `settle` is not called, the session keeps every line, and the file on
   * disk does not move. `D1165` is the rule this protects — *ticking is what writes it* — and a ▶
   * that quietly committed the lines in order to run them would take that away, which is the one
   * thing the session panel exists to prevent.
   *
   * The splice is `keepAll`'s own call with a different destination: `insertIntoSource` and the
   * recorder's already-parsed nodes, which is `D1087`'s one construction path and no template
   * string.
   */
  const playSession = useCallback(async () => {
    if (!file || session === null || session.into === null) return;
    const nodes = session.lines.flatMap((l) => (l.kind === 'step' ? [l.node] : []));
    if (nodes.length === 0) return;
    const out = insertIntoSource(textRef.current, { kind: 'steps', testName: session.into, nodes });
    if (!out.ok) {
      setEditProblem(out.reason);
      return;
    }
    setPlayed(session.into);
    setProblem(null);
    const target = playScratchOf(path, project.playScratch);
    const put = await writeScratch(target, out.text, playEtag.current);
    if (!put.ok) {
      setProblem(put.error);
      return;
    }
    playEtag.current = put.etag;
    onRun({ files: [target], only: session.into, evidence: 'full', trace: true });
  }, [file, session, path, project.playScratch, writeScratch, onRun]);

  const dropLine = useCallback((id: number) => {
    setSession((current) => (current === null ? current : { ...current, lines: current.lines.filter((l) => l.id !== id) }));
  }, []);

  const stopRecording = useCallback(() => {
    recordStop.current?.();
    recordStop.current = null;
    recordInto.current = null;
    setRecording(null);
    setSession((current) => (current === null ? current : { ...current, live: false }));
  }, []);

  const startRecording = useCallback(
    (decl: OutlineTest) => {
      recordStop.current?.();
      recordInto.current = decl.name;
      setRecording(decl.line);
      /* A new recording starts a new list. Lines from the last one that were never kept were
         never in the file, so nothing is lost by clearing them — and carrying them would put two
         sessions' gestures in one list with no way to tell them apart. */
      setSession({ kind: 'record', live: true, into: decl.name, lines: [] });
      recordStop.current = recordActions(pickPath, {
        line: appendRecorded,
        problem: (text) => setEditProblem(text),
        end: () => {
          recordStop.current = null;
          recordInto.current = null;
          setRecording(null);
          /* **The lines stay when the browser closes**, which is the point of the panel: closing
             the browser is how you stop adding to the list, not how you throw it away. */
          setSession((current) => (current === null ? current : { ...current, live: false }));
        },
      });
    },
    [pickPath, appendRecorded],
  );

  /** The door or the file changing closes the browser, for `pick`'s reason and with its gate. */
  useEffect(
    () => () => {
      recordStop.current?.();
      recordStop.current = null;
      recordInto.current = null;
    },
    [door, path],
  );

  /**
   * **Where a `+` gesture goes** — `M213` `S4` (`D1094`).
   *
   * One dispatcher over `vocabulary.ts`'s key, rather than a prop per gesture: the pane no longer
   * knows the API door's three by name, which is what let BROWSER arrive as a table entry instead
   * of as a second pane. An unknown key is a refusal with the key in it, because the alternative
   * is a button that does nothing and says nothing — and the two lists that have to agree (this
   * switch and the table) are in different files by design, so the only way that disagreement
   * surfaces is if it is made to.
   */
  /** The declaration `+ step…` was pressed on, or `null` (`M219` `E`, `D1164`). */
  const [addingStep, setAddingStep] = useState<OutlineTest | null>(null);
  useEffect(() => setAddingStep(null), [path]);

  const add = useCallback(
    (decl: OutlineTest, key: string) => {
      switch (key) {
        case 'request': return addRequest(decl);
        case 'let': return addLetTo(decl);
        case 'wait': return addWaitTo(decl);
        case 'open': return addOpen(decl);
        case 'click': return addGesture(decl, 'click');
        case 'fill': return addGesture(decl, 'fill');
        case 'record': return recording === null ? startRecording(decl) : stopRecording();
        /* **`+ step…` opens a dialog rather than writing a statement** — `M219` `E` (`D1164`).
           The other gestures have one shape each and can write it; this one is eighteen shapes, so
           what it opens is a chooser. It still writes through the same `buildStatement`. */
        case 'step': return setAddingStep(decl);
        default: return setEditProblem(`this door offers no \`${key}\` gesture — \`vocabulary.ts\` and this switch disagree`);
      }
    },
    [addRequest, addLetTo, addWaitTo, addOpen, addGesture, recording, startRecording, stopRecording],
  );

  /** The row whose new note is open — see `RowEditing.noting`. It lives here rather than in the
   *  pane for `M205` `S5a`'s reason, which this round has now met four times: the strip unmounts
   *  panels, so a gesture held below one does not survive a glance at Source. */
  const [noting, setNoting] = useState<string | null>(null);
  /** Which of the request editor's four tabs is open (`M214` `A2`). Held HERE, because the strip
   *  unmounts panels — `M205` `S5a`, the sixth time this pane has met that rule. */
  const [editorTab, setEditorTab] = useState<EditorTab>('assert');
  const [editProblem, setEditProblem] = useState<string | null>(null);

  /**
   * The assertion row's values, and a change all the way to bytes (`M210` `S3`).
   *
   * Held **beside** the request's rather than inside it, and keyed the same way: by the statement's
   * own index pair, so moving to another row re-reads that row from the file instead of carrying
   * the last one's half-typed operand onto it.
   */
  const [expectEdit, setExpectEdit] = useState<{ key: string; values: StatementEdit } | null>(null);
  const applyExpectEdit = useCallback(
    (statement: OutlineStatement, next: StatementEdit) => {
      if (!file || statement.stepPath === null) return;
      const key = rowKey(statement);
      if (key === null) return;
      setExpectEdit({ key, values: next });
      /**
       * One statement kind per branch, each through the language's own builder (`M210` `S3`/`S4`).
       *
       * **What the spec cannot say is carried, not rebuilt** — `S2`'s rule, twice more here. An
       * assertion's subject when the select still says `carried`: five of the language's sixteen
       * subjects have no `SubjectSpec`, and a `status of request to "…"` carries a clause the spec
       * has no room for either, so the build runs against a stand-in of the same shape and the real
       * node goes back on. Its `mask` list likewise, while the matcher is still `matches snapshot`:
       * losing it would not change whether the file parses, only which pixels count. And a
       * `capture`'s subject for exactly the same reason — 774 of the corpus's 793 captures read a
       * `body` path, and the other nineteen include the shapes the spec cannot spell.
       */
      const built = buildStatement(next, statement.node);
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      /**
       * **A scoped statement is edited by rebuilding the block that holds it** — `M219` `D`
       * (`D1163`).
       *
       * `within`, `switch to new tab` and `download` hold statements, and a statement inside one
       * is not a step of the body: the index pair names the **block**, and `inner` names which of
       * its statements this is. So the edit is *this block, with that one element replaced* — one
       * more pass through the same builder, then the same `replaceInSource` at the same address.
       *
       * **No new address grammar, and that is the reason this shape was chosen** over widening
       * `StepPath`. `insert.ts` is what every write in the page goes through; a third field on the
       * pair would reach the splice, the remove, the note owner and the anchor, four of which have
       * nothing to say about a block.
       */
      const target = statement.inner === null ? built : rescope(statement, built.node);
      if (!target.ok) {
        setEditProblem(target.reason);
        return;
      }
      const out = replaceInSource(draft ?? file.text, { kind: 'step', path: statement.stepPath, node: target.node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      /**
       * **Keep the address on whatever it was naming** (`D1080`), which since `M214` `D1113` is
       * either the statement or the request — and it matters more than it did, because the address
       * now decides what the editor DRAWS rather than only which row is highlighted.
       *
       * `format` normalises the whole file before the splice, so a file that was not already
       * formatted shifts even when the edit adds no line. The index pair is what survives that; the
       * line is read back out of the edited text by it.
       */
      const after = fileOutline(path, out.text, opensPage);
      const decl = after.declarations[statement.stepPath.decl];
      if (focusLine !== null && focusLine === statement.line) {
        const movedStatement = decl === undefined
          ? undefined
          : statementsOf(decl.body).find(
              (x) => x.stepPath !== null && x.inner === statement.inner && x.stepPath.step === statement.stepPath!.step,
            );
        if (movedStatement && movedStatement.line !== statement.line) onTab('compose', movedStatement.line);
      } else if (at?.request) {
        const moved = decl?.body.requests.find((x) => x.stepPath.step === at.request!.stepPath.step);
        if (moved && moved.line !== at.request.line) onTab('compose', moved.line);
      }
    },
    [at, file, draft, onDraft, path, onTab, focusLine, opensPage],
  );

  const [ownProblem, setProblem] = useState<string | null>(null);
  /** A read failure is the shell's to discover and this pane's to say — there is no third place a
   *  reader looks, and a form that stayed silent about it would show an empty file as an empty
   *  form, which is the `M210` §0 defect wearing a different hat. */
  const problem = ownProblem ?? editProblem ?? fileProblem;

  /** Every test in the file, not only the ones behind this door — `D1044` again: an API step is
   *  legal in a test a LOAD form started, and that is the case this form exists to reach. */
  const testsInFile = useMemo(() => project.files.find((f) => f.path === path)?.tests ?? [], [project, path]);

  const [sending, setSending] = useState(false);

  /**
   * The scratch file's hash as this page last knew it — `M205` S3, closing `M205-05`.
   *
   * Send and Discard both need it, and both used to fetch it: `getFile(scratchPath).catch(() =>
   * null)` before each one. On a project nobody has explored yet that is a request whose only
   * possible answer is `404`, and the browser logs a failed request as a console error **whether
   * or not the caller catches it** — so the first Send in any project printed one. A page that
   * logs a benign error by routine is a page whose next real error is invisible.
   *
   * Seeded from the project view, which reads the file the server already has in hand, and moved
   * forward by each write's own response. Deliberately **not** re-seeded when `project` refreshes:
   * this page's own last write is the fresher fact, and a scratch changed by another terminal is
   * supposed to surface as the `409` that guard exists for rather than be silently re-read.
   */
  const [scratchEtag, setScratchEtag] = useState<string | null>(project.scratchEtag);

  /**
   * SEND RUNS THE PREFIX (`M210` `S6`, `D1075`).
   *
   * **Four requests in five cannot run alone** — 734 of the sibling's 1031 read a variable defined
   * earlier and 379 read a capture from the file's `before` hook — so a Send that fired the
   * selected request by itself would be honest about 18% of them. What is written is the file's
   * hooks, this declaration up to and including the selected request and what is attached to it,
   * and nothing else: the **pending** bytes (`D1079`), so what runs is what the pane is showing
   * rather than what is on disk.
   *
   * It is a **printed** copy rather than a slice of the text, because the cut is structural — other
   * declarations go, the body stops at a step — and the one thing print drops is comments, which a
   * scratch file has no reader for. That is the opposite of the rule a *header* edit lives by
   * (`S5a`: never reprint a body, because the author's notes are in it); the difference is whose
   * file it is. This one is written to the project's own `.scratch.tflw` and overwritten on the next press.
   *
   * Three things are deliberately dropped from the copy. A **workload** would turn one press into a
   * load run, which is not what `send` means; the **thresholds** that grade one go with it; and any
   * **crawl** the file declares, which is a second kind of work with no authored body and nothing to
   * do with the request on screen. The name is `scratch` for the reason it has been since `A1-5`:
   * `--only` has to name it, and an exploration that renamed itself on every press would leave a
   * file nobody could re-run by hand.
   */
/**
 * A body with its assertions taken out — what `send` actually runs (`M215` `A1`, `D1119`).
 *
 * **Send is not a test run, and it had been one.** The scratch used to carry every `expect` in the
 * prefix, and a hard `expect` fails fast (`interpreter.ts`, P#16) — so a failing assertion on an
 * *earlier* request aborted the run and the request the author pressed send on never left. The
 * response was missing for a reason that had nothing to do with the request, at exactly the moment
 * a person is exploring because something is already wrong. The narrower gesture also matches what
 * the page already offers twice over: the Run tab runs a file, a selection or a `@tag`.
 *
 * `capture` stays, and it is the whole reason this is a filter rather than a slice: 734 of the
 * sibling's 1031 requests read a variable bound earlier, so a send that dropped the bindings would
 * fire `/orders/{orderId}` with the braces still in it.
 *
 * **A `wait until api` keeps its own assertions, and gets them for free.** They live inside the
 * node (`WaitUntilApiStmt.expects`), not in the body's step list, so nothing here touches them —
 * which is correct twice over: they are the *poll condition* rather than a verdict, and a polling
 * request without them is `TF015`, a file that does not parse.
 *
 * The block list below mirrors `lenses.ts`'s `eachStep`, which is the one place it is supposed to
 * live. The duplication is stated rather than hidden: if a block type is added and not added here,
 * an assertion nested inside it still runs during a send — a send that is stricter than it claims,
 * which is a visible wrong answer rather than a silent wrong file.
 */
function withoutAssertions(steps: readonly Step[]): readonly Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    if (step.type === 'ExpectStmt') continue;
    if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
      const body = withoutAssertions(step.body);
      // A block that held nothing but assertions is dropped whole: an empty block is not a
      // cheaper version of itself, it is a construct the printer would have to invent a spelling
      // for, and nothing in it was going to run.
      if (body.length > 0) out.push({ ...step, body } as Step);
      continue;
    }
    out.push(step);
  }
  return out;
}

  const prefix = useMemo(() => (outline === null || at === null ? null : prefixOf(outline, at)), [outline, at]);
  const prefixText = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!file || prefix === null) return { ok: false, reason: 'pick a request first — send runs the file up to one' };
    const source = draft ?? file.text;
    const { program, diagnostics } = parseSource(source);
    const fatal = diagnostics.find((d) => d.severity === 'error');
    if (fatal) return { ok: false, reason: `this file does not parse: ${fatal.code} at line ${fatal.span.start.line}` };
    const declarations = [...program.hooks, ...program.tests].sort((a, b) => a.span.start.line - b.span.start.line);
    const decl = declarations[prefix.decl];
    if (!decl) return { ok: false, reason: 'that declaration is no longer in the file' };
    const body = withoutAssertions(decl.body.slice(0, prefix.upTo + 1));
    const kept: TestDecl = decl.type === 'TestDecl'
      ? { ...decl, name: stringLit(SCRATCH_TEST), workload: null, thresholds: [], body }
      : { type: 'TestDecl', name: stringLit(SCRATCH_TEST), tags: [], sessions: [], retry: 0, table: null, workload: null, thresholds: [], concurrency: 'sequential', body, span: SYNTHETIC };
    /* The hooks and the actions run too, so their assertions are dropped for the same reason —
       `before` is where 379 of the sibling's requests get their captured ids, and a stale
       assertion in a hook would abort the send before the request on screen ever left. */
    const scratch: Program = {
      ...program,
      /* A hook that was nothing but assertions is dropped rather than printed empty: `before` with
         no steps is not a cheaper hook, it is a file that does not parse, and there was nothing in
         it for a send to do. **An action is kept whole in that case instead of dropped**, and the
         asymmetry is the `call`: nothing names a hook, so removing one is invisible, while removing
         an action the body calls turns the send into *no such action*. An action that is only
         assertions is exactly the case where filtering had nothing to gain anyway. */
      hooks: program.hooks.map((h) => ({ ...h, body: withoutAssertions(h.body) })).filter((h) => h.body.length > 0),
      actions: program.actions.map((a) => {
        const body = withoutAssertions(a.body);
        return body.length > 0 ? { ...a, body } : a;
      }),
      tests: [kept],
      crawls: [],
    };
    const printed = print(scratch);
    if (!printed.ok) return { ok: false, reason: printed.reason ?? 'this file cannot be written back' };
    return { ok: true, text: printed.text.endsWith('\n') ? printed.text : printed.text + '\n' };
  }, [file, draft, prefix]);

  /**
   * **The last run that touched this file** (`D1099`).
   *
   * Refetched when the path changes and when the project view refreshes — which is what happens
   * when a run finishes — so a run started from the Run tab lands here without this pane knowing
   * anything about it.
   *
   * **IT HAS TO OPEN THE REPORTS TO FIND OUT, AND THAT IS WHY THERE IS A CAP.** `ReportEntry.files`
   * looks like the answer and is not: it is the list of **artefacts** in the directory —
   * `results.json`, `report.html`, `junit.xml` — not the `.tflw` files the run executed, and the
   * first draft of this filtered on it and silently matched nothing at all (`M213-19`). Which
   * tests a report holds is only in its own `results.json`, and those run to hundreds of kilobytes
   * on a fixture project, so this walks the reports newest-first and stops at the first that
   * carries a test for this file, opening at most `REPORT_LOOKBACK` of them.
   *
   * A file not found within that many runs shows no verdicts. That is a bound stated rather than a
   * search that quietly grows with the report directory, and the failure it produces is the same
   * as the ordinary one — a file nobody has run shows nothing — rather than a slow page.
   *
   * A failure is silence, deliberately. There being no report for a file is the ordinary state of
   * a new file, and a page that said *could not read the last run* over every one of them would be
   * reporting the absence of a thing nobody asked for.
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const reports = (await getReports()).slice().sort((a, b) => b.at.localeCompare(a.at));
        for (const entry of reports.slice(0, REPORT_LOOKBACK)) {
          if (!entry.files.includes('results.json')) continue;
          const report = await getResults(entry.id);
          if (!live) return;
          /* `M221` `B` — a play's report carries the SCRATCH's name, so the lookback that finds
             "the last run that touched this file" has to know the two are the same subject. The
             verdicts still join on `(line, source)` because the scratch is the buffer verbatim. */
          if (report.tests.some((t) => 'file' in t && belongsTo(t.file, path, project.playScratch))) {
            setReportRan({ report, reportId: entry.id });
            return;
          }
        }
        if (live) setReportRan(null);
      } catch {
        if (live) setReportRan(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [path, project, reportsStamp]);

  /** A send is about one request; opening another one does not make it about that one. */
  useEffect(() => setSentRan(null), [path]);

  /** And a play is about one file. `M221` gate 3: opening another file empties the stage rather
   *  than leaving the previous file's trace under a sequence it is not about. */
  useEffect(() => setPlayed(null), [path]);

  /**
   * **The join, re-derived from the buffer on every keystroke** (`D1093`, `D1108`).
   *
   * This is the one place a verdict becomes visible, and it is a `useMemo` over the *text* rather
   * than a state anything writes — so there is no way for the pane to hold a mark the buffer has
   * outgrown. The send wins over the report for its own request and leaves every other request's
   * alone, which is the two scopes meeting: `D1099` says both are real reports, so the newer one
   * about a given request is the one to show.
   */
  const ranIndex = useMemo((): RanIndex => {
    const text = draft ?? file?.text ?? '';
    if (text === '') return new Map();
    const base = reportRan === null ? new Map<number, Ran>() : new Map(indexFromReport(reportRan.report, path, text, project.playScratch));
    if (sentRan !== null) {
      const one = indexFromSend({ steps: sentRan.steps, requestLine: sentRan.line, bufferText: text, startedAt: sentRan.startedAt });
      if (one !== null) base.set(sentRan.line, one);
    }
    return base;
  }, [reportRan, sentRan, draft, file, path, project.playScratch]);

  /**
   * **What the stage is showing** (`M221` `A`).
   *
   * Derived, never stored — the same shape as `ranIndex` above and for the same reason. The
   * report is refetched when the report list moves (`D1180`), so a play's trace arrives here on
   * its own, and the stage cannot hold a frame for a report that has been superseded.
   */
  const stageTrace = useMemo(
    () => (played === null || reportRan === null ? null : traceOf(reportRan.report, played, reportRan.reportId)),
    [played, reportRan],
  );

  const sendPrefix = useCallback(async () => {
    if (!prefixText.ok || !at?.request) return;
    setSending(true);
    setProblem(null);
    setSentRan(null);
    try {
      const put = await putFile(project.scratchPath, prefixText.text, scratchEtag);
      if (!put.ok) {
        setProblem(put.code ? `${put.code} at line ${put.line}: ${put.error}` : put.error);
        setSending(false);
        return;
      }
      setScratchEtag(put.etag);
      const record = await startRun({ files: [project.scratchPath], only: SCRATCH_TEST, evidence: 'full' });
      const end = await new Promise<EndEvent>((resolve) => {
        const stop = subscribe(record.id, { event: () => undefined, noise: () => undefined, end: (e) => { stop(); resolve(e); } });
      });
      if (!end.kept) {
        setProblem('the run wrote no report — nothing to read a response from');
        setSending(false);
        return;
      }
      const report: RunReport = await getResults(end.kept.split('/').pop() ?? end.kept);
      const functional = report.tests.filter((t): t is Extract<typeof t, { kind: 'functional' }> => t.kind === 'functional');
      /**
       * **The FIRST case, and the steps from the last request onward.**
       *
       * A `with each` table runs the prefix once per row, and the pane is showing one request — so
       * the verdicts beside it are the first case's, which is the one an author reads first. The
       * steps are matched **by position from the last `api` step**, not by line: the scratch is a
       * printed program with the other tests removed, so its line numbers are not this file's.
       */
      const steps = functional[0]?.steps ?? [];
      if (!steps.some((x) => x.kind === 'api')) {
        setProblem('the run reported no api step — check the request above');
        setSending(false);
        return;
      }
      /**
       * **The raw steps are kept, and the join is left to `ranIndex`** (`M213` `S2`).
       *
       * This used to build the finished `Ran` right here, which meant the send's verdicts were
       * joined **once**, at the moment they arrived, and were true only until the next keystroke —
       * which is why the old `settle` had to blank them. Keeping the report's own steps and the
       * lines they are about lets the same `(line, source)` check that guards the disk scope guard
       * this one, on every render, from the buffer as it then is.
       */
      setSentRan({
        line: at.request.line,
        steps,
        startedAt: report.startedAt,
      });
      /**
       * **And the pane stays where it is.** The legacy Send goes to Run because that is where its
       * response lives; this one puts the response and every verdict **beside the assertions that
       * read them** (`D1075`), so leaving for another tab would take the author away from the thing
       * they pressed the button to see. Found by a gate that waited 30 seconds for a verdict on a
       * pane the press had just unmounted.
       */
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
    setSending(false);
  }, [prefixText, at, project.scratchPath, scratchEtag, onTab]);

  /**
   * **▶ — run this declaration and nothing else** (`M220` `A`, `D1168`).
   *
   * Four lines, and that is the claim rather than an apology for it: `--only "<name>"` has named a
   * single test since decision 94, `--evidence full` is the level at which a step record carries
   * what it did, and `trace: true` is `D1170`'s third reason to keep one. **Nothing about execution
   * is new** — a play is the argv a terminal would type, sent through the shell's own `onRun` so
   * the record is selected and watched exactly as every other run's is.
   *
   * **`--only` matches by NAME, not by line**, which is worth stating because it is the one way
   * this gesture can surprise: two tests in one file sharing a name are both played. That is the
   * language's own rule (`cli.ts`'s `keep` compares `d.name.value`) and not something a page should
   * quietly correct — a file with two tests of one name has a problem `tflw check` should be
   * saying, and inventing a line-scoped narrowing here would be a second selector beside `--only`.
   */
  /**
   * **▶ runs the BUFFER** — `M221` `B` (`D1183`), which overturns `D1177`.
   *
   * `D1177` refused ▶ while the pane was dirty, and its premise was right: `tflw run --only …
   * <file>` reads the *file*, so with a pending edit the thing that runs is not the thing on
   * screen. The wrong half was kept. The repair is to make the thing that runs BE the thing on
   * screen, and `D1177` named the mechanism in its own next sentence — *"`send` has no such
   * problem because it writes its own scratch first"* — before concluding a scratch had nowhere to
   * stand. It has: beside the file (`D1184`).
   *
   * **The scratch is the buffer VERBATIM**, not a printed program and not a cut prefix. That is
   * what lets `indexFromReport` join the verdicts with nothing special: `ran.ts`'s key is
   * `(line, source)` where `source` is the line's **own text**, so an identical copy has identical
   * line numbers and identical text and every row matches. `sendPrefix` below had to invent a
   * positional match precisely because its scratch is reprinted.
   */
  const play = useCallback(
    async (decl: { readonly kind: 'test'; readonly name: string }) => {
      if (!file) return;
      /* `M221` `A` — the press names the stage's subject before the run is started, so the region
         says *a run is going* about the right declaration rather than staying blank. */
      setPlayed(decl.name);
      setProblem(null);
      const target = playScratchOf(path, project.playScratch);
      const text = draft ?? file.text;
      const put = await writeScratch(target, text, playEtag.current);
      if (!put.ok) {
        setProblem(put.error);
        return;
      }
      playEtag.current = put.etag;
      onRun({ files: [target], only: decl.name, evidence: 'full', trace: true });
    },
    [onRun, path, file, draft, project.playScratch, writeScratch],
  );

  /**
   * `[Discard]` — the scratch file is removed and *then* the pane goes.
   *
   * THE ORDER IS THE POINT, and the first draft had it backwards: clearing the pane first made it
   * vanish while the write was still in flight, so the disappearance said nothing about the file
   * and a refused discard was invisible. Written this way, the pane going is the removal having
   * landed, and a failure keeps the pane and says why — which is also what lets the gate assert
   * the file is gone the moment the pane detaches.
   *
   * **`A1-5` emptied it; `A2-6` removes it (`D1054`).** An emptied scratch is still a file, so the
   * landing went on counting it forever — measured `2 files` on a one-test project after a single
   * explore-and-change-your-mind. The etag is still read first for the same reason it always was:
   * a scratch that moved under this page belongs to another terminal.
   */
  const discard = useCallback(async () => {
    if (scratchEtag !== null) {
      const res = await dropScratch(scratchEtag);
      if (!res.ok) {
        setProblem(res.status === 409 ? `${res.error} — the scratch file changed under this page` : res.error);
        return;
      }
      setScratchEtag(null);
    }
  }, [scratchEtag]);

  /** `D1052` — recomputed with the preview, from the same bytes, so what is shown and what is
   *  judged cannot be two different files. */
  // `pending` left with the retired form (`M212` `S4b`): the draft is now the only pending
  // bytes this pane has, which is `D1079`'s one buffer with nothing beside it.
  const diagnostics = useMemo(() => (draft !== null ? diagnose(draft) : []), [draft]);

  /**
   * Write the buffer — `D1049` unchanged: one real `PUT` of the whole file under the etag it was
   * read at. The bytes are exactly what Source is showing and what the card is drawing, because
   * there is one buffer and all three read it.
   */
  const writeDraft = useCallback(async () => {
    if (!file || draft === null) return;
    setBusy(true);
    setProblem(null);
    const res = await putFile(path, draft, file.etag);
    setBusy(false);
    if (!res.ok) {
      setProblem(res.status === 409 ? `${res.error} — the file changed under this page; reopen it and apply this again` : res.code ? `${res.code} at line ${res.line}: ${res.error}` : res.error);
      return;
    }
    onFileWritten({ path, text: draft, etag: res.etag });
    onDraft(null);
    setEdit(null);
    // …and the assertion row's, for the same reason: the buffer is the file now, so every row's
    // values come from the file again. A held edit would keep re-deriving nothing and would mask
    // the next external change to that statement.
    setExpectEdit(null);
    setHeader(null);
    setThreshold(null);
    setNoting(null);
    onWritten(path);
  }, [file, draft, path, onFileWritten, onDraft, onWritten]);

  /**
   * What a tab you are not looking at has to say (`M205` S5).
   *
   * Three cases, each a fact about **what that tab's own subject is holding** — not about any
   * other file, which is the one thing a mark may never mean. Source is marked while Compose
   * holds bytes the file does not have yet, Run while a run is going, and Config while it holds
   * an edit nobody has saved.
   *
   * *`S5b` widened the wording and not the rule.* `S5a` wrote *a fact about THIS file*, which was
   * true of the three tabs that existed and wrong the moment the two project-fact tabs landed —
   * a tab whose subject is `tflw.config` cannot carry a mark about the `.tflw` file. The refusal
   * that matters is unchanged: a mark reading *3 other files failed* would be the explorer's job
   * wearing the strip's clothes, and is still refused, because the explorer's files are nobody
   * here's subject.
   */
  /**
   * What Source shows — the **buffer**, and nothing else since `M212` `S4b`.
   *
   * It used to be *the buffer when Compose is holding one (`D1079`), and the legacy form's
   * projection otherwise* — two answers to one question, with a rule for picking between them.
   * The legacy form is gone, so there is one pending-bytes answer on this pane and the rule it
   * needed went with it. Source's own header still says which of the two STATES it is in — *what
   * this file becomes when you press write* against *as it is on disk*.
   */
  const sourcePending: { ok: true; text: string } | { ok: false; reason: string } =
    draft !== null ? { ok: true, text: draft } : { ok: false, reason: 'nothing pending — this is the file as it is on disk' };

  const marks: Partial<Record<TabId, string>> = {};
  if (sourcePending.ok && file && sourcePending.text !== file.text) marks.source = 'Compose is holding bytes this file does not have yet';
  if (runMark) marks.run = runMark;
  if (configMark) marks.config = configMark;
  /* **A running `pick` session is a real browser, and the strip is the only thing that says so
     once Compose is not the tab you are on** (`M213` `S4`, `D1106`). `M206` `S3`'s gate rests on
     exactly this: the mark is what is still true after the panel unmounts. */
  if (picking !== null) marks.compose = 'a pick session is open — a real browser is waiting for a click';
  /* A recording writes into the file while you are looking at another tab, which is a stronger
     reason to mark the strip than `pick`'s: `pick` waits, this one acts (`M213` `S5`). */
  if (recording !== null) marks.compose = 'a recording is running — every action in that browser is a step in this file';

  return (
    /* `data-door-form` rather than `data-api-form` since `M213` `S4`: one pane serves two doors,
       and an attribute named for one of them is the defect `M213-19` filed about a field name. The
       door is the attribute's value, so a gate can still say which one it is looking at. */
    <section className="doorpane" data-door-form={door}>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={sourcePending} diagnostics={diagnostics} project={project} door={door} /> : null}
      {tab === 'run' ? (
        <div className="runpane" data-door-run-tab={door}>
          {runPane}
        </div>
      ) : null}
      {/* The rule's second clause (`M205` §2): a project fact the file resolves against. Auth
          reads it scoped to this file and sends every edit to Config, which is the file's one
          editor — `onTab('config', line)` writes the hash, so the jump is a link. */}
      {tab === 'auth' ? authPanel : null}
      {tab === 'config' ? configPanel : null}

      {/* **What you typed survives a trip to another tab**, and it is not this line that provides
          it: every field is `useState` in THIS component, and the strip swaps a panel rather than
          unmounting the form, so the values come back whether the panel is unmounted or merely
          hidden. The first draft used `hidden` and said in a comment that it was load-bearing —
          the mutation to an unmounted panel left the gate green, which is how that got caught.
          Unmounted is the better of two equal choices: no hidden `[data-api-send]` sitting in the
          DOM for a selector on another tab to find. */}
      {tab !== 'compose' ? null : (
        /* **ONE PANE, BOTH DOORS** — `M219` `A` (`D1160`), which reinstates `D1094` rather than
           amending it a second time.

           `M214` forked here on `door === 'api'` and said so in writing: *"BROWSER keeps
           `ComposePane` below, unaffected; when its turn comes it either adopts this shape or is
           answered in its own terms."* Measured before this round was scoped: **30 data-attributes
           existed on the API door and not on BROWSER, and 32 the other way** — everything `M214`
           through `M218` built was API-only, and the BROWSER door could edit three of the
           language's twenty-two browser kinds while drawing the other nineteen as dead text with
           no disabled control and no reason, which is the pane `D1082` refuses.

           The fork is **deleted rather than narrowed**. A narrowed fork is still two
           implementations of one picture, which is the failure `vocabulary.ts` exists to record.
           What is per-door is the table it reads, and nothing else. */
        <>
        <ComposePane
          path={path}
          outline={outline}
          at={at}
          focusLine={focusLine}
          onLine={(line) => onTab('compose', line)}
          onNew={onNew}
          scratchUnignored={project.scratchIgnored ? null : project.scratchPath}
          edit={values}
          onEdit={applyEdit}
          editing={{
            row: expectEdit,
            onRow: applyExpectEdit,
            onNote: applyNote,
            noting,
            onNoting: setNoting,
            header,
            onHeader: applyHeader,
            threshold,
            onThreshold: applyThreshold,
            onFileDecl: applyFileDecl,
            /* **`pick` reaches the door whose rows carry locators** (`D1106`), which since `M219`
               `A` is decided by the vocabulary rather than by which branch of a fork we are in.
               `null` on a door with no locator in its constructs — a locator-fixer on a row with
               no locator has nothing to fix. */
            pick: VOCABULARY[door].constructs.has('ClickStmt')
              ? { row: picking, found: picked, onStart: startPick, onStop: endPick }
              : null,
          }}
          prefix={VOCABULARY[door].sends ? prefix : null}
          onSend={VOCABULARY[door].sends ? () => void sendPrefix() : null}
          sending={sending}
          ran={ranIndex}
          onVerify={verify}
          onCapture={captureFrom}
          onAdd={add}
          adds={VOCABULARY[door].adds}
          recording={recording}
          onAddAfter={addRequestAfter} onDuplicate={duplicateRequest} menuFor={seqMenuFor} onMenu={onMenu}
          made={made}
          onRemoveSteps={removeSteps}
          onRemoveDecl={removeDecl}
          /* `D1176` — ▶ is a vocabulary row, so the door asks the table rather than its own name. */
          onPlay={VOCABULARY[door].plays ? (d) => void play(d) : null}
          playing={running}
          onRemoveScoped={removeScoped}
          onUnscope={unscope}
          onScope={scope}
          session={VOCABULARY[door].sends ? null : session}
          onKeepLine={keepLine}
          onKeepAll={keepAll}
          /* `D1185` — offered on the door that plays, and the panel itself refuses a `pick`. */
          onPlaySession={VOCABULARY[door].plays ? () => void playSession() : null}
          onDropLine={dropLine}
          onStopSession={() => (recording !== null ? stopRecording() : endPick())}
          tab={editorTab}
          onEditorTab={setEditorTab}
          dirty={draft !== null}
          busy={busy}
          problem={problem}
          onWrite={() => void writeDraft()}
          onDiscard={() => { onDraft(null); setEdit(null); setExpectEdit(null); setHeader(null); setThreshold(null); setNoting(null); setEditProblem(null); }}
          door={door}
        />
        {/* **The third region** (`D1181`) — below both columns, full width of `main`, which is
            1114 px at 1440 against the viewer's 606 px floor. `Stage` is always rendered and says
            which of its four states it is in; it is never conditionally absent (`D1187`). */}
        <Stage
          trace={stageTrace}
          played={played}
          running={running}
          recording={recording !== null}
          viewer={project.traceViewer}
          unignored={project.playIgnored ? null : project.playScratch}
        />
        </>
      )}
      {/* **`+ step…`'s dialog** — `M219` `E` (`D1164`). It sits beside the pane rather than inside
          it for the reason `NewThing` does: a modal is the shell's, and a pane that owned one
          would be a pane that can be unmounted with a half-filled form inside it. */}
      {addingStep === null || file === null ? null : (
        <AddStep
          decl={addingStep}
          /* **The buffer, never the disk** (`D1141`, and `M217`'s own defect report). */
          into={draft ?? file.text}
          anchor={null}
          offers={stepCatalogue(VOCABULARY[door].constructs, ['open', 'click', 'fill'])}
          pick={VOCABULARY[door].constructs.has('ClickStmt') ? { row: picking, found: picked, onStart: startPick, onStop: endPick } : null}
          onStage={(text) => {
            setAddingStep(null);
            landOn(text, (after) => {
              /* The cursor lands on what was just written, which for a foot insert is the last
                 addressable row of the declaration (`D1136`). */
              const body = after.declarations[addingStep.index]?.body;
              if (body === undefined) return null;
              return statementsOf(body).filter((x) => x.inner === null).at(-1)?.line ?? null;
            });
          }}
          onCancel={() => setAddingStep(null)}
        />
      )}
    </section>
  );
}

/**
 * **Source** — the file, and while you are composing, the bytes the write will produce.
 *
 * `D985` says the `.tflw` file is the only truth and that a form shows the source it is about to
 * write. Before the strip those were two panes: an always-on preview of the pending bytes inside
 * the form, and no view of the file at all. One subject, so one tab — and the panel says which of
 * the two it is showing, because "this is the file" and "this is what the file is about to be"
 * are claims a reader must be able to tell apart.
 */
