// The API door's authoring pane (`M200` `A1-4`) — the second form in tflw that writes a file,
// and the first that writes *work* rather than a policy about work.
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

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  buildApiStep,
  replaceInSource,
  parseSource,
  print,
  buildCall,
  buildCapture,
  buildExpect,
  buildDataTable,
  buildGive,
  buildLet,
  buildLog,
  buildPause,
  buildThreshold,
  type CaptureStmt,
  type ExpectStmt,
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
import { putFile, dropScratch, startRun, subscribe, getResults, type FileView } from './api';
import { diagnose } from './diagnose';
import { TabStrip } from './TabStrip';
import {
  ComposePane,
  editOf,
  expectSpecOf,
  headerEditOf,
  specOf,
  stepKey,
  subjectSpecOf,
  tableSpecOf,
  thresholdSpecOf,
  type HeaderEdit,
  type RequestEdit,
  type StatementEdit,
  type ThresholdEdit,
  type Ran,
  type Verdict,
} from './ComposePane';
import { NewThing, type NewMode } from './NewThing';
import { addressed, fileOutline, prefixOf, type OutlineHook, type OutlineRequest, type OutlineStatement, type OutlineTest } from './outline';
import { SourcePanel } from './SourcePanel';
import type { TabId } from './doors';
import type { EndEvent, ProjectView, RunReport, StepResult } from './contract';
import type { FileOutline } from './outline';

export interface ApiFormProps {
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
  /** Point the page at a different file — the explorer's own gesture, which `M212` `S4` needs
   *  because creating a file that the address does not then name is a write with no consequence. */
  readonly onOpenFile: (path: string) => void;
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

export function ApiForm({ project, onWritten, tab, onTab, path, file, outline, draft, onDraft, fileProblem, onFileWritten, onOpenFile, focusLine, runPane, runMark, authPanel, configPanel, configMark }: ApiFormProps) {
  const [busy, setBusy] = useState(false);
  /** What `L<line>` names — one resolution, so the band and the card cannot disagree about which
   *  test they are showing (`D1080`). */
  const at = useMemo(() => (outline === null ? null : addressed(outline, focusLine)), [outline, focusLine]);

  /** What the last run said about the selected request and the statements attached to it — held
   *  here because `settle` below drops it the moment the bytes move (`M210` `S6`). */
  const [ran, setRan] = useState<Ran | null>(null);

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
       * **And the last run's verdicts go, because they are about bytes that no longer exist.**
       * A ✓ beside an assertion says *this passed*; once the assertion has been typed into, it says
       * that about a file nobody has. The pane would rather show nothing than show a verdict for a
       * question that has changed (`D985`'s honesty rule, one construct over).
       */
      setRan(null);
      return true;
    },
    [draft, file, onDraft],
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
   * **The three fields `ApiStepSpec` cannot express are carried across, not rebuilt.** `timeoutMs`,
   * `followRedirects` and `retryAfter` live on the node and not in the spec, so a node built from
   * the spec alone comes back without them — source that still parses, still runs, still passes,
   * and tests something the author did not ask for. They are copied here, from the request the
   * outline is showing, and `ui-page.test.ts` asserts they survive an edit.
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
        timeoutMs: original.spec.timeoutMs,
        followRedirects: original.spec.followRedirects,
        retryAfter: original.spec.retryAfter,
        // An `upload` body is carried whole for the same reason: `ApiBodySpec` cannot express
        // one, so the builder returns `body: null` for it, and taking that answer would delete
        // a `multipart/form-data` payload from a request whose path somebody edited.
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
      const after = fileOutline(path, out.text);
      const moved = after.declarations[original.stepPath.decl]?.body.requests.find((x) => x.stepPath.step === original.stepPath.step);
      if (moved && moved.line !== original.line) onTab('compose', moved.line);
    },
    [at, file, draft, settle, path, onTab],
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
    },
    [file, draft, settle],
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
      setEditProblem(null);
      settle(out.text);
    },
    [file, draft, settle],
  );

  /** The row whose new note is open — see `RowEditing.noting`. It lives here rather than in the
   *  pane for `M205` `S5a`'s reason, which this round has now met four times: the strip unmounts
   *  panels, so a gesture held below one does not survive a glance at Source. */
  const [noting, setNoting] = useState<string | null>(null);
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
      const key = stepKey(statement.stepPath);
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
      const built: { ok: true; node: Step } | { ok: false; reason: string } = ((): { ok: true; node: Step } | { ok: false; reason: string } => {
        switch (next.kind) {
          case 'expect': {
            const original = statement.node as ExpectStmt;
            const out = buildExpect(expectSpecOf(next.expect, original));
            if (!out.ok) return out;
            return {
              ok: true,
              node: {
                ...out.node,
                subject: next.expect.subject === 'carried' ? original.subject : out.node.subject,
                masks: next.expect.matcher === 'matchesSnapshot' && original.matcher.name === 'matchesSnapshot' ? original.masks : out.node.masks,
              },
            };
          }
          case 'capture': {
            const original = statement.node as CaptureStmt;
            const out = buildCapture({ subject: subjectSpecOf(next.subject, next.argument, next.locatorKind, original.subject), name: next.name });
            if (!out.ok) return out;
            return { ok: true, node: { ...out.node, subject: next.subject === 'carried' ? original.subject : out.node.subject } };
          }
          case 'let':
            return buildLet({ name: next.name, value: next.value });
          case 'log':
            return buildLog({ level: next.level, message: next.message, destination: next.destination === '' ? null : next.destination });
          case 'call':
            return buildCall({ name: next.name, args: next.args });
          case 'give':
            return buildGive(next.value);
          case 'pause':
            return buildPause({ min: next.min, max: next.max });
        }
      })();
      if (!built.ok) {
        setEditProblem(built.reason);
        return;
      }
      const out = replaceInSource(draft ?? file.text, { kind: 'step', path: statement.stepPath, node: built.node });
      if (!out.ok) {
        setEditProblem(out.reason);
        return;
      }
      setEditProblem(null);
      settle(out.text);
      // The address names the REQUEST, and an assertion above it can move it — `format` normalises
      // the whole file before the splice, so a file that was not already formatted shifts. Read the
      // request's new line back out by the index pair that still identifies it (`D1080`).
      if (at?.request) {
        const after = fileOutline(path, out.text);
        const moved = after.declarations[at.request.stepPath.decl]?.body.requests.find((x) => x.stepPath.step === at.request!.stepPath.step);
        if (moved && moved.line !== at.request.line) onTab('compose', moved.line);
      }
    },
    [at, file, draft, onDraft, path, onTab],
  );

  const [ownProblem, setProblem] = useState<string | null>(null);
  /** A read failure is the shell's to discover and this pane's to say — there is no third place a
   *  reader looks, and a form that stayed silent about it would show an empty file as an empty
   *  form, which is the `M210` §0 defect wearing a different hat. */
  const problem = ownProblem ?? editProblem ?? fileProblem;
  /** `M212` `S4` (`D1087`) — which create dialog is open, if either. */
  const [creating, setCreating] = useState<NewMode | null>(null);

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
    const body = decl.body.slice(0, prefix.upTo + 1);
    const kept: TestDecl = decl.type === 'TestDecl'
      ? { ...decl, name: stringLit(SCRATCH_TEST), workload: null, thresholds: [], body }
      : { type: 'TestDecl', name: stringLit(SCRATCH_TEST), tags: [], sessions: [], retry: 0, table: null, workload: null, thresholds: [], concurrency: 'sequential', body, span: SYNTHETIC };
    const scratch: Program = { ...program, tests: [kept], crawls: [] };
    const printed = print(scratch);
    if (!printed.ok) return { ok: false, reason: printed.reason ?? 'this file cannot be written back' };
    return { ok: true, text: printed.text.endsWith('\n') ? printed.text : printed.text + '\n' };
  }, [file, draft, prefix]);

  const sendPrefix = useCallback(async () => {
    if (!prefixText.ok || !at?.request) return;
    setSending(true);
    setProblem(null);
    setRan(null);
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
      let from = -1;
      for (const [i, step] of steps.entries()) if (step.kind === 'api') from = i;
      if (from < 0) {
        setProblem('the run reported no api step — check the request above');
        setSending(false);
        return;
      }
      // The report's own sentence per step, not a second one written here — `detail` is what the
      // run wrote (`status = 200`, `orderId = 42 (captured)`, or why it failed).
      const step = steps[from]!;
      setRan({
        line: at.request.line,
        steps: steps.slice(from).map((x) => ({ ok: x.ok, detail: x.detail ?? x.source })),
        response: step.response === undefined
          ? null
          : { status: step.response.status, url: step.request?.url ?? '', method: step.request?.method ?? '', bodyText: step.response.bodyText },
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

  return (
    <section className="doorpane" data-api-form>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={sourcePending} diagnostics={diagnostics} project={project} door="api" /> : null}
      {tab === 'run' ? (
        <div className="runpane" data-api-run-tab>
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
        <ComposePane
          path={path}
          outline={outline}
          at={at}
          onLine={(line) => onTab('compose', line)}
          onNew={setCreating}
          dialog={
            creating === null ? null : (
              <NewThing
                mode={creating}
                openPath={path}
                openText={file?.text ?? ''}
                openEtag={file?.etag ?? null}
                existing={project.files.map((f) => f.path)}
                onCancel={() => setCreating(null)}
                onDone={(written) => {
                  const made = creating;
                  setCreating(null);
                  // The same two notifications a save makes — the shell re-reads the project,
                  // because the page is a projection of the file and not a cache of it (`D985`).
                  if (made === 'test') onFileWritten(written);
                  onWritten(written.path);
                  // **A new FILE moves the address to it.** A create that left you looking at the
                  // file you were already on is a write with no visible consequence, which is the
                  // shape `M209` found four times over.
                  if (made === 'file') onOpenFile(written.path);
                }}
              />
            )
          }
          scratchUnignored={project.scratchIgnored ? null : project.scratchPath}
          edit={values}
          onEdit={applyEdit}
          prefix={prefix}
          onSend={() => void sendPrefix()}
          sending={sending}
          ran={ran}
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
            onAddRequest: addRequest,
          }}
          dirty={draft !== null}
          busy={busy}
          problem={editProblem}
          onWrite={() => void writeDraft()}
          onDiscard={() => { onDraft(null); setEdit(null); setExpectEdit(null); setHeader(null); setThreshold(null); setNoting(null); setEditProblem(null); }}
          door="api"
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
