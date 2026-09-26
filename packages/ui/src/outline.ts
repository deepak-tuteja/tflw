// The AST → model reader (`M210` `S1`, `D1072`). The direction Compose has never had.
//
// `ApiForm` has written files since `M200` `A1-4` and has never read one: its fields are a form's
// own state, connected to the open file by the path in its write button and by nothing else. So a
// 45-line file with a hook, a data table and two tests drew an empty form beside it, and no gate
// complained — a form with no opinion about the file cannot disagree with it.
//
// THIS MODULE IS THE OPINION. Source text in, a structure out that says what the file holds, in
// the shape Compose draws: the file's own declarations, its hooks, its tests, and inside each of
// those the **requests** with everything that belongs to each one hanging off it.
//
// THE UNIT IS ONE REQUEST (`D1073`). Measured on the sibling: 1031 requests, a median of 2 attached
// statements each, and **206 of the 396 multi-request tests interleave** — a non-api statement sits
// between two requests in every one of them. So the proposed flat *requests · scripts · everything
// else* grouping is lossy by construction, and the grouping that is not is one level lower: a
// `capture` is a property of the request above it, never of the test.
//
// IT GROUPS, IT DOES NOT FILTER (`D1044`/`D1076`). Every step in a body lands in exactly one row —
// `test/outline.test.ts` asserts `placed === total` **per kind**, as an equality rather than a
// floor, over this repository's own corpus (`D1056`, with the sibling as pressure carrying no
// number). So a step kind the language gains and this module has not met is a red test rather than
// a silence, which is the direction that matters: *at least N were placed* stays green forever
// while a whole kind lands nowhere. A
// step from another door is `foreign` and still present, in position (`D1078`); it is the *door*
// that decides what may be edited and never what may be seen.
//
// IT RENDERS THROUGH THE LANGUAGE'S OWN PRINTER. `print()` is total since `M201` (116/116 kinds),
// so a row's one-line text is the language's rendering of that node and not a second one written
// here to drift from it. That matters most for the rows this door cannot edit: a locked row shows
// what the step *is*, in the spelling `tflw fmt` would write.

import { lex, parseSource, print, STEP_LENS, type Lens, type Step, type StepLens, type StepPath } from '@tflw/lang';
import { landingDecl } from './landingRule';
import type {
  ActionDecl,
  ApiBody,
  ApiRequestSpec,
  ApiStep,
  CrawlDecl,
  DataTable,
  Diagnostic,
  HookDecl,
  ImportDecl,
  TestDecl,
  ThresholdDecl,
  UseDecl,
  WaitUntilApiStmt,
  WithinBlock,
  SwitchToNewTabBlock,
  DownloadBlock,
  Workload,
} from '@tflw/lang';

/**
 * A comment block, owned by the line of code below it (`D1077`).
 *
 * **Zero of the corpus's 2889 comment lines are trailing** — every one of the 419 blocks sits on
 * its own lines above something — so ownership needs no heuristic at all: a block belongs to the
 * next line that carries code, and a block with no code after it is the file's tail.
 *
 * `first` is what a collapsed note shows and `lines` is what it opens to; the longest block in the
 * corpus is 63 lines, which is why the two are separate fields rather than one joined string.
 */
export interface Note {
  /** The line the block starts on. */
  readonly line: number;
  /** Every line of it, `#` and all, as written. */
  readonly lines: readonly string[];
  /** The first line, which is what a collapsed note shows. */
  readonly first: string;
}

/** One statement of a body that is not itself a request. */
export interface OutlineStatement {
  readonly kind: Step['type'];
  readonly line: number;
  /** What door this statement is evidence of — `null` for the neutral vocabulary every door
   *  carries (`let`, `capture`, `log`, `give`, `call`, `pause`, `expect`). */
  readonly lens: StepLens | null;
  /** The language's own rendering of this node, from `print()`. Multi-line for a block. */
  readonly text: string;
  readonly note: Note | null;
  /** True for a row that came from inside a block-shaped step rather than from the body's own
   *  list — today only a `wait until api`'s nested expects. It is on the row rather than inferred
   *  by the reader because the completeness gate compares against the *body's* steps, and a
   *  nested one counted there would make the two sides disagree by construction. */
  readonly nested: boolean;
  /** Where this statement is, as `replaceInSource` names it (`M210` `S2`) — an index pair, stable
   *  under formatting where a line is not. `null` for a nested row that has no owning block: a
   *  `wait until api`'s expects are inside its block, not in the body's own list, so the pair
   *  cannot address them. For a row inside a **scoping block** this is the BLOCK's address, and
   *  `inner` says which of its statements this is (`M219` `D`). */
  readonly stepPath: StepPath | null;
  /**
   * **This row's index inside the block that holds it** — `M219` `D` (`D1163`), `null` for a step
   * of the body's own list.
   *
   * An edit to a scoped statement is an edit to **the block**: build the new inner node, put it
   * back in the block's body at this index, rebuild the block through `buildWithin` (or its two
   * siblings) and replace the body step. That needs no new address grammar and no change to
   * `insert.ts` — the address is still one index pair, and `inner` is the second half of *which
   * statement*, held on the row rather than derived by the reader.
   */
  readonly inner: number | null;
  /**
   * **The statements this row scopes** — `M219` `D`, `null` for a row that is not a block.
   *
   * Measured: `within` is the **third-commonest browser construct** (433 across the two corpora)
   * and **397 of its 405 blocks wrap exactly one statement**; `switch to new tab` and `download`
   * are single-statement in every one of their 3 occurrences. So the language calls it a block and
   * the corpus writes it as *a scope on one gesture, spread over two lines* — and before this
   * round `outline.ts` never walked a body at all, so **430 statements corpus-wide were not rows**:
   * one unaddressable row whose text happened to contain the inner gesture.
   *
   * It is not cosmetic. `review-submission.tflw:29` carries a comment explaining that unscoped,
   * the assertion read a string the test had just typed into the very field it was checking had
   * cleared. **A scope that is invisible in the sequence is a correctness hazard.**
   *
   * Each row here is `nested` and carries `inner`; the block itself stays one step of the body,
   * placed once, which is what keeps `outline.test.ts`'s per-kind equality green.
   */
  readonly body: readonly OutlineStatement[] | null;
  /** The block this row is inside, when `inner` is set — the node an edit rebuilds. `null` for a
   *  step of the body's own list (`M219` `D`). */
  readonly owner: WithinBlock | SwitchToNewTabBlock | DownloadBlock | null;
  readonly node: Step;
}

/** The three block-shaped steps whose bodies this module walks (`M219` `D`). `wait until api` is
 *  deliberately not among them: its nested rows are `expect`s inside a polling request and are
 *  the request's attachments, which `request()` already produces. */
export function isScopingBlock(step: Step): step is WithinBlock | SwitchToNewTabBlock | DownloadBlock {
  return step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock';
}

/** A request and everything that belongs to it — the unit `D1073` puts on screen. */
export interface OutlineRequest {
  readonly line: number;
  /** `wait until api` issues a request too, and its nested expects are its own attachments. */
  readonly kind: 'ApiStep' | 'WaitUntilApiStmt';
  readonly spec: ApiRequestSpec;
  readonly method: ApiRequestSpec['method'];
  /** The path as written, `{interpolation}` included. */
  readonly path: string;
  readonly service: string | null;
  /** `as "checkout"` — the explicit label, or null for the automatic identity. */
  readonly label: string | null;
  readonly body: ApiBody | null;
  readonly note: Note | null;
  /** Where this request is, as `replaceInSource` names it (`M210` `S2`). An edit says *this one*
   *  with a pair of indices, because a line moves under `format` and this does not. */
  readonly stepPath: StepPath;
  /** The statements between this request and the next one — its expects, captures and logs. */
  readonly attached: readonly OutlineStatement[];
  readonly node: ApiStep | WaitUntilApiStmt;
}

/** A body, grouped. `preamble` is what comes before the first request — 61 tests in the corpus
 *  open with one, and **97 of those 100 statements are `let`**. A body with no request at all is
 *  one preamble and no requests, which is honest rather than empty: a browser test seen from the
 *  API door is exactly that. */
export interface OutlineBody {
  readonly preamble: readonly OutlineStatement[];
  readonly requests: readonly OutlineRequest[];
  /**
   * **The sessions this body opens** — `M219` `B` (`D1160`), and the part of the fold that is not
   * about requests at all.
   *
   * `preamble` and `requests` are the **setup** phase: everything above the first session start,
   * grouped exactly as they always were. From the session start down, a session owns what follows
   * it, and the next session start ends it.
   *
   * **This is not a per-door projection and deliberately so.** A session is a fact about the file —
   * a page is on screen from the `open` until another one replaces it — so it is folded once, here,
   * and both doors draw the same picture. `D1160` asked for a browser arm; two folds of one body,
   * chosen by which door is looking, is the two-implementations failure this module's own header
   * refuses, and the measurement that forced the fold (**1455 of 1927 browser steps drawn as
   * readers of an `api` response, 75.5%**) was taken on the API door's grouping. Recorded as an
   * amendment in `PLAN_M219_BROWSER_DOOR.md` §3 rather than done quietly.
   */
  readonly sessions: readonly OutlineSession[];
}

/**
 * A page, and every statement made against it — `M219` `B` (`D1160`, `D1161`).
 *
 * **The group's head is a statement and not a new kind of thing.** An `open` is an ordinary step
 * with an ordinary address, so it stays one: it is selectable, editable and removable exactly as
 * it was, and what changed is only that the rows under it are drawn beneath it. A `session` kind
 * in `selectedAt` would have been a second answer to *what is this row*.
 *
 * `body` is a whole `OutlineBody` because **an `api` request can stand inside a session** — 18 of
 * them across 14 declarations in the two corpora — and the request fold is what makes an `expect
 * status equals 200` under one read as that request's rather than as the page's. A session never
 * contains a session: a second page start ends the first one, which is what `groupBody` does and
 * why the recursion is exactly one level deep.
 */
export interface OutlineSession {
  /** The `open` — or the `call` the project index says opens a page (`D1161`). */
  readonly head: OutlineStatement;
  readonly body: OutlineBody;
}

export interface OutlineHook {
  readonly kind: 'hook';
  /** Where this declaration is, as `replaceInSource` names one (`M210` `S5`) — the same index the
   *  statements under it are addressed by, and the address of its header and its note. */
  readonly index: number;
  readonly node: HookDecl;
  readonly when: HookDecl['when'];
  readonly scope: HookDecl['scope'];
  readonly line: number;
  readonly label: string;
  readonly note: Note | null;
  readonly body: OutlineBody;
}

export interface OutlineTest {
  readonly kind: 'test';
  /** See `OutlineHook.index`. */
  readonly index: number;
  readonly node: TestDecl;
  readonly name: string;
  readonly line: number;
  readonly tags: readonly string[];
  readonly sessions: readonly string[];
  /** `0` is the default and means *no retry* — not *retry is in use*. */
  readonly retry: number;
  readonly table: DataTable | null;
  readonly workload: Workload | null;
  readonly thresholds: readonly ThresholdDecl[];
  readonly note: Note | null;
  readonly body: OutlineBody;
}

/**
 * **A `crawl`, drawn and not built** — `M228` `C` (`D1238`).
 *
 * `outline.ts` said in as many words until this round that *`crawl` declarations are the SCANS
 * door's own root and are not here*, and what that cost was measured rather than argued: on
 * `examples/storefront/tests/scan.tflw` the sidebar badge read **1** and the tree drew **2** rows,
 * because `Sidebar.tsx:424` counts `f.crawls` while `:363` maps `o.declarations`. So one row
 * disagreed with itself, and only on this door — a crawl is the only construct that reaches SCANS
 * without also reaching API, which makes the door's exclusive content exactly the thing it could
 * not show.
 *
 * **`index` is `-1` and every statement's `stepPath` is `null`, both on purpose.** `index` is
 * `replaceInSource`'s own index over hooks-and-tests sorted by line, and a crawl folded into that
 * numbering would shift every declaration below it — silently rewriting the wrong test. `-1` is a
 * value that function cannot resolve, and the null step paths are what make that unreachable
 * rather than merely unlikely: the pane's editable test is `stepPath !== null`, so a crawl's rows
 * take the read-only branch by the same rule a nested row does.
 *
 * **Drawn read-only, saying why**, which is this table's own written rule rather than a
 * compromise — `DoorVocabulary.constructs`: *"A kind this door owns and cannot construct is drawn,
 * disabled, saying why; a pane that is half live and silent about which half is what `D1082`
 * refuses."* Making a crawl first-class needs `buildCrawl` (three seed kinds, sessions, body), an
 * `Insertion` member, `Edit` members for the header and each seed, and it touches every consumer
 * of `declarations` — a language round and a UI round in one, for **14 real crawls in the whole
 * corpus**. `D1190`'s deferral stands, now with a reason rather than an absence.
 */
export interface OutlineCrawl {
  readonly kind: 'crawl';
  /** Always `-1` — see the docblock. A crawl is outside `replaceInSource`'s numbering. */
  readonly index: -1;
  readonly node: CrawlDecl;
  readonly name: string;
  readonly line: number;
  readonly tags: readonly string[];
  readonly sessions: readonly string[];
  readonly seeds: CrawlDecl['seeds'];
  readonly excludes: CrawlDecl['excludes'];
  readonly note: Note | null;
  readonly body: OutlineBody;
}

/** The declarations above the tests — one pinned row (`D1074`). */
export interface OutlineFileRow {
  readonly imports: readonly ImportDecl[];
  readonly uses: readonly UseDecl[];
  readonly actions: readonly ActionDecl[];
  /** The file header comment — 1616 lines of it across 118 of the sibling's 139 files. */
  readonly header: Note | null;
  /** A note the file ends on, owning nothing. One file in 139. */
  readonly tail: Note | null;
}

export interface FileOutline {
  readonly path: string;
  readonly file: OutlineFileRow;
  /** Hooks, tests and — since `M228` `C` (`D1238`) — crawls, in line order. A file does not sort
   *  its declarations by kind, and neither does the outline. */
  readonly declarations: readonly (OutlineHook | OutlineTest | OutlineCrawl)[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Every statement in a body, in the order they were placed — what the completeness floor counts.
 *  A session's head is one of them (`M219` `B`): it is an ordinary step of the body's own list, so
 *  a fold that dropped it here would make the equality `outline.test.ts` asserts per kind fail on
 *  every `open` in both corpora, which is the direction that gate is pointed. */
export function statementsOf(body: OutlineBody): OutlineStatement[] {
  /* A block's rows come out beside it, `nested`, so the per-kind equality `outline.test.ts`
     asserts still counts the block once and skips what is inside it (`M219` `D`). */
  const withBody = (s: OutlineStatement): OutlineStatement[] => [s, ...(s.body ?? [])];
  return [
    ...body.preamble.flatMap(withBody),
    ...body.requests.flatMap((r) => r.attached.flatMap(withBody)),
    ...body.sessions.flatMap((s) => [...withBody(s.head), ...statementsOf(s.body)]),
  ];
}

/** Every request in a body, the sessions' own included (`M219` `B`). */
export function requestsOf(body: OutlineBody): OutlineRequest[] {
  return [...body.requests, ...body.sessions.flatMap((s) => requestsOf(s.body))];
}

/** Whether a statement is this door's to edit (`D1078`). Neutral vocabulary is everybody's. */
export function isForeign(lens: StepLens | null, door: Lens): boolean {
  return lens !== null && lens !== door;
}

/** Every note in a file, sorted into the three places a comment block can belong. */
export interface FileNotes {
  /** The block starting on line 1 — the file's own header. */
  readonly header: Note | null;
  /** Every other block, by the line of code it owns. */
  readonly byOwner: ReadonlyMap<number, Note>;
  /** A block with no code after it at all. One file in the sibling's 139 ends this way, with a
   *  note about an assertion the language cannot express yet — which is exactly the kind of thing
   *  a reader must not lose, so it is carried rather than dropped. */
  readonly tail: Note | null;
}

/**
 * The comment blocks of a source, sorted (`D1077`).
 *
 * Built from `lex()`'s own line records rather than by scanning the text here: the lexer is what
 * knows a `#` inside a string is not a comment (`D159`), and a second scanner written in this
 * module would find one in `expect body.url equals "https://x/#frag"`.
 *
 * THE RULES ARE MEASURED, NOT CHOSEN, and the corpus contradicts none of them.
 *
 *  - **A block is a run of comment lines; a blank line ends it.** Two blocks with air between them
 *    are two notes about two things, and joining them would staple a file header onto the first
 *    test of every file that has no other comment.
 *  - **A block owns the next line of code, blanks crossed.** 291 of the sibling's 419 blocks sit
 *    directly on their code and **127 have a blank line under them** — a rule that stopped at the
 *    blank would lose those 127, the file headers among them.
 *  - **A block starting on line 1 is the file header.** Measured: 118 of 139 files open with one,
 *    **all 118 followed by a blank line and none pressed against a declaration**, 1616 lines in
 *    total. So the header needs no heuristic to tell it from a note — it is the one at the top.
 *  - **0 of 2889 comment lines are trailing**, so no block has a second candidate owner, which is
 *    what makes ownership a rule rather than a guess in the first place.
 */
export function readNotes(source: string): FileNotes {
  const { lines } = lex(source);
  const byOwner = new Map<number, Note>();
  let header: Note | null = null;
  let tail: Note | null = null;
  /** The blocks seen since the last line of code. Usually one; more than one when the author left
   *  air between two of them, which is how a file header and a note on the first declaration are
   *  told apart without asking what either one says. */
  let pending: Note[] = [];
  let block: { line: number; lines: string[] } | null = null;
  const seal = (): void => {
    if (block === null) return;
    pending.push({ line: block.line, lines: block.lines, first: block.lines[0] ?? '' });
    block = null;
  };
  /** Line 1's block is the file's, wherever it is found. */
  const strand = (note: Note): void => {
    if (note.line === 1) header = note;
  };
  for (const info of lines) {
    if (info.kind === 'comment') {
      if (block === null) block = { line: info.line, lines: [] };
      block.lines.push((info.comment ?? '').trimEnd());
      continue;
    }
    seal();
    if (info.kind === 'blank') continue;
    // The block nearest the code is the one about it; anything above that is about something the
    // author stopped writing, and line 1's is the header.
    const owner = pending.pop();
    if (owner !== undefined) {
      if (owner.line === 1) header = owner;
      else byOwner.set(info.line, owner);
    }
    for (const above of pending) strand(above);
    pending = [];
  }
  seal();
  for (const left of pending) {
    if (left.line === 1) header = left;
    else tail = left;
  }
  return { header, byOwner, tail };
}

/** `print()` never refuses a step kind since `M201` closed the set, but a refusal is reported as
 *  itself rather than as an empty row: a blank line in a read-only projection is the silence
 *  `D1076` refuses, and a named refusal is a defect somebody can chase. */
function render(node: Step): string {
  const printed = print(node);
  return printed.ok ? printed.text : `# unprintable: ${printed.reason ?? node.type}`;
}

function isRequest(step: Step): step is ApiStep | WaitUntilApiStmt {
  return step.type === 'ApiStep' || step.type === 'WaitUntilApiStmt';
}

function statement(
  step: Step,
  notes: FileNotes,
  stepPath: StepPath | null,
  nested = false,
  inner: number | null = null,
  owner: WithinBlock | SwitchToNewTabBlock | DownloadBlock | null = null,
): OutlineStatement {
  return {
    nested,
    stepPath,
    inner,
    kind: step.type,
    line: step.span.start.line,
    lens: STEP_LENS[step.type],
    /* **A block's own text is its head line and nothing else** (`M219` `D`). `print()` renders a
       block with its body, which is what a reader wants of a file and exactly not what a row wants
       of a scope: every caller took `.split('\n')[0]` off it, in four places. The rows the body
       became are next door in `body`. */
    text: isScopingBlock(step) ? (render(step).split('\n')[0] ?? '') : render(step),
    note: notes.byOwner.get(step.span.start.line) ?? null,
    /* The body's rows carry the BLOCK's address and their own index in it — see `inner`. */
    body: isScopingBlock(step) && stepPath !== null
      ? step.body.map((s, i) => statement(s, notes, stepPath, true, i, step))
      : null,
    owner,
    node: step,
  };
}

function request(step: ApiStep | WaitUntilApiStmt, notes: FileNotes, stepPath: StepPath): {
  request: Omit<OutlineRequest, 'attached'>;
  /** `wait until api`'s expects belong to it and to nothing else — they are inside its block. */
  own: OutlineStatement[];
} {
  const spec: ApiRequestSpec = step.type === 'ApiStep' ? step : step.request;
  return {
    request: {
      line: step.span.start.line,
      stepPath,
      kind: step.type,
      spec,
      method: spec.method,
      path: spec.path.raw,
      service: spec.service,
      label: spec.tag?.value ?? null,
      body: spec.body,
      note: notes.byOwner.get(step.span.start.line) ?? null,
      node: step,
    },
    own: step.type === 'WaitUntilApiStmt' ? step.expects.map((e) => statement(e, notes, null, true)) : [],
  };
}

/**
 * **Does this step put a page on screen** — the session boundary (`M219` `B`, `D1161`).
 *
 * An `open` always does. A `call` does when the project index says the action it names does, which
 * is a question this module cannot answer on its own: the action is usually declared in another
 * file. `opensPage` is the index's answer, passed in; an empty set is the honest degradation —
 * every `open` still starts a session and no `call` does, which is what the page showed before the
 * index carried the field and is visibly a smaller claim rather than a wrong one.
 */
function startsSession(step: Step, opensPage: ReadonlySet<string>): boolean {
  if (step.type === 'OpenStmt') return true;
  return step.type === 'CallStmt' && opensPage.has(step.call.name);
}

/** The request fold, as a mutable accumulator — one of these per phase (`M219` `B`). */
interface Fold {
  readonly preamble: OutlineStatement[];
  readonly requests: { head: Omit<OutlineRequest, 'attached'>; attached: OutlineStatement[] }[];
}

const emptyFold = (): Fold => ({ preamble: [], requests: [] });

const sealFold = (f: Fold, sessions: OutlineSession[] = []): OutlineBody => ({
  preamble: f.preamble,
  requests: f.requests.map((r) => ({ ...r.head, attached: r.attached })),
  sessions,
});

/**
 * A body, grouped — by request within a phase, and by **session** across them (`M219` `B`).
 *
 * The request rule is one sentence and is unchanged: a statement belongs to the last request above
 * it, or to the preamble if there is none. That is what the corpus's own shape says — `test → [let
 * preamble] → request → [its expects, captures, logs] → request → …` — and it is why this is a
 * fold rather than three filters.
 *
 * **The session rule is the second sentence, and it exists because the first one is wrong about a
 * browser test.** Measured over both corpora: 338 declarations carry a browser step, **161 have no
 * `api` request at all**, and in the 177 mixed ones **1455 of 1927 browser steps (75.5%) were
 * drawn as attachments to an `api` request** — a `click` rendered as a reader of a login response.
 * So: everything above the first session start folds by request as before, and from a session
 * start down, the session owns what follows until the next one. A session's own contents fold by
 * request too, because 18 `api` requests across 14 declarations stand inside one.
 *
 * Grouping by page visit is **not** a spine on its own and this does not claim it is: 208 of 258
 * browser tests have exactly one `open`, so 81% of them get one session group. What the fold buys
 * is the 75.5% above, and a **phase** for every row — which is what makes the assertion subject
 * offer right (`D1166`).
 */
export function groupBody(
  steps: readonly Step[],
  notes: FileNotes,
  decl = 0,
  opensPage: ReadonlySet<string> = NO_ACTIONS,
): OutlineBody {
  const setup = emptyFold();
  const sessions: { head: OutlineStatement; fold: Fold }[] = [];
  const into = (): Fold => sessions[sessions.length - 1]?.fold ?? setup;
  for (const [index, step] of steps.entries()) {
    const path: StepPath = { decl, step: index };
    if (startsSession(step, opensPage)) {
      sessions.push({ head: statement(step, notes, path), fold: emptyFold() });
      continue;
    }
    const f = into();
    if (isRequest(step)) {
      const { request: head, own } = request(step, notes, path);
      f.requests.push({ head, attached: own });
      continue;
    }
    const row = statement(step, notes, path);
    if (f.requests.length === 0) f.preamble.push(row);
    else f.requests[f.requests.length - 1]!.attached.push(row);
  }
  return sealFold(setup, sessions.map((s) => ({ head: s.head, body: sealFold(s.fold) })));
}

/**
 * The project index's `opensPage` flags, flattened to the set `groupBody` asks for (`M219` `B`).
 *
 * **One derivation, two callers.** `App` builds the outline the page draws and `ComposeDoor`
 * rebuilds it after every edit to find where a statement moved to; a set computed twice is a set
 * that can disagree with itself, which is the shape this module's own header refuses. Names rather
 * than paths, because a `call` names an action and an action reached through a `use` is declared
 * in the file it came from.
 */
export function pageOpeners(
  files: readonly { readonly actions: readonly { readonly name: string; readonly opensPage: boolean }[] }[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of files) for (const a of f.actions) if (a.opensPage) names.add(a.name);
  return names;
}

/**
 * **Which phase of a body a line is in** — `M219` `G` (`D1166`).
 *
 * `setup` is everything above the first session start; `session` is a session's head and
 * everything under it. It is asked by line rather than by identity because the callers have a
 * selection, and a selection is a line (`D1045`).
 *
 * A body with no session is all setup, which is every API test in both corpora and is the answer
 * that keeps `D1167` true without a special case: on a door whose files open no page, the phase is
 * constant and the offer it produces is the flat one.
 */
export function phaseOf(body: OutlineBody, line: number): 'setup' | 'session' {
  for (const session of body.sessions) {
    if (line === session.head.line) return 'session';
    if (statementsOf(session.body).some((s) => s.line === line)) return 'session';
    if (requestsOf(session.body).some((r) => r.line === line)) return 'session';
    for (const row of session.head.body ?? []) if (row.line === line) return 'session';
  }
  return 'setup';
}

/** No project index — every `open` starts a session and no `call` does. See `startsSession`. */
const NO_ACTIONS: ReadonlySet<string> = new Set<string>();

/**
 * The whole file, read.
 *
 * Parsed in the browser with the same `@tflw/lang` the CLI uses — the package has no dependencies
 * and no Node builtins, which is why there is no second implementation here to drift from the one
 * `tflw check` runs. A file with diagnostics still produces an outline: the parser recovers, and a
 * pane that showed nothing for a file with one typo in it would be a pane nobody could use to fix
 * the typo.
 */
/**
 * **Where a request's run of statements ends** — the address a new step goes *after* if it is to
 * join this request rather than steal the next one's readers (`M217` `B`, `D1138`).
 *
 * `attached` is *everything between this request and the next*, so its last addressable member is
 * the last line that reads this response. A step spliced there is below every reader of this
 * request and above the next request, which is the one position from which it can change nothing:
 * `body` means the last response, so a step spliced any higher re-points every reader under it.
 *
 * **Null `stepPath` is the case that makes this a function.** A row inside a `wait until api`
 * block is not a step of the body and cannot be addressed by an index pair — this type says so on
 * the field — so the filter is load-bearing and not defensive. With nothing addressable attached,
 * the request itself is the anchor.
 *
 * Extracted because there were three copies of it by the time `M217` wanted a fourth: `verify`
 * (tick-to-verify), `captureFrom` and now `addRequestAfter` all ask the same question, and the
 * first two already carried a comment saying that two derivations of it would be one too many.
 */
export function anchorAfter(request: OutlineRequest): StepPath {
  return request.attached.filter((a) => a.stepPath !== null).at(-1)?.stepPath ?? request.stepPath;
}

export function fileOutline(path: string, source: string, opensPage: ReadonlySet<string> = NO_ACTIONS): FileOutline {
  const { program, diagnostics } = parseSource(source);
  const notes = readNotes(source);
  /**
   * **Sorted first, then indexed**, and the order is `replaceInSource`'s own: hooks and tests
   * together, in the order the file declares them. It has to be the same ordering in both places,
   * because the index this produces is the index that function will look the statement up by — and
   * two orderings that agree on every file anybody has written so far is exactly the arrangement
   * that breaks on the first file where a hook comes after a test.
   */
  const declared = [...program.hooks, ...program.tests].sort((a, b) => a.span.start.line - b.span.start.line);
  const indexed = declared.map((d, decl): OutlineHook | OutlineTest =>
    d.type === 'HookDecl'
      ? {
          kind: 'hook',
          index: decl,
          node: d,
          when: d.when,
          scope: d.scope,
          line: d.span.start.line,
          label: `${d.when} ${d.scope}`,
          note: notes.byOwner.get(d.span.start.line) ?? null,
          body: groupBody(d.body, notes, decl, opensPage),
        }
      : {
          kind: 'test',
          index: decl,
          node: d as TestDecl,
          name: (d as TestDecl).name.value,
          line: d.span.start.line,
          tags: (d as TestDecl).tags,
          sessions: (d as TestDecl).sessions,
          retry: (d as TestDecl).retry,
          table: (d as TestDecl).table,
          workload: (d as TestDecl).workload,
          thresholds: (d as TestDecl).thresholds,
          note: notes.byOwner.get(d.span.start.line) ?? null,
          body: groupBody((d as TestDecl).body, notes, decl, opensPage),
        },
  );
  /**
   * **The crawls are folded in AFTER the indexing, never into it** — `M228` `C` (`D1238`).
   *
   * `indexed` is `replaceInSource`'s numbering and the sort above is that function's own, so a
   * crawl taking a position in it would renumber every declaration below it and send an edit to
   * the wrong test. They join the list by **line** and carry `index: -1`, which is a value
   * `replaceInSource` cannot resolve; and every statement under one is stripped of its
   * `stepPath`, which is what turns *cannot be addressed* from a convention into a property.
   */
  const crawls: OutlineCrawl[] = (program.crawls ?? []).map((c) => ({
    kind: 'crawl',
    index: -1,
    node: c,
    name: c.name.value,
    line: c.span.start.line,
    tags: c.tags,
    sessions: c.sessions,
    seeds: c.seeds,
    excludes: c.excludes,
    note: notes.byOwner.get(c.span.start.line) ?? null,
    body: unaddressable(groupBody(c.body, notes, -1, opensPage)),
  }));
  const declarations = [...indexed, ...crawls].sort((a, b) => a.line - b.line);
  return {
    path,
    file: { imports: program.imports, uses: program.uses, actions: program.actions, header: notes.header, tail: notes.tail },
    declarations,
    diagnostics,
  };
}

/** Every statement in a body with its address removed — the other half of `D1238`'s *drawn, not
 *  built*. One walk over the same three lists `statementsOf` knows about, so a fourth place a
 *  statement can hide would break this and that function together rather than only this one. */
function unaddressable(body: OutlineBody): OutlineBody {
  const strip = (s: OutlineStatement): OutlineStatement => ({
    ...s,
    stepPath: null,
    body: s.body === null ? null : s.body.map(strip),
  });
  return {
    ...body,
    preamble: body.preamble.map(strip),
    requests: body.requests.map((r) => ({ ...r, stepPath: r.stepPath, attached: r.attached.map(strip) })),
    sessions: body.sessions.map((sn) => ({ head: strip(sn.head), body: unaddressable(sn.body) })),
  };
}

/** What an address resolves to (`D1080`) — the declaration it names, and the request inside it. */
export interface Addressed {
  /** `M228` `C` (`D1238`) — a crawl is a declaration an address can name, like the other two. The
   *  pane draws it read-only; nothing else about resolving an address changes. */
  readonly decl: OutlineHook | OutlineTest | OutlineCrawl;
  /** `null` for a declaration that issues no request — a browser test seen from the API door. */
  readonly request: OutlineRequest | null;
}

/**
 * What a line in the address is pointing at (`D1080`).
 *
 * The line is the **grammar's own `L<n>`** rather than a new segment, so every jump the page
 * already makes — Source's index, `[edit]`, `focusLine` — speaks it without learning anything.
 * Its cost is stated in the decision: a line is a position and not an identity, so a link written
 * before an edit lands **near** its request rather than on it.
 *
 * **THE DECLARATION IS RESOLVED FIRST, AND THAT IS NOT A DETAIL.** The first draft took the last
 * request at or before the line over the whole file, and the served page caught it at once:
 * `#/api/compose/tests/mixed/storefront.tflw/L261` — a link to a test's own first line — opened the
 * card on a request belonging to the test **above** it, because the named test's first request is
 * further down than its `test` line. "Near" is only useful inside the thing the reader named. So:
 * the last declaration at or before the line, then the last request at or before the line *within
 * it*, then that declaration's first. A stale line now lands in the right test in every case where
 * the test still exists, which is the whole of what a line can honestly promise.
 */
export function addressed(outline: FileOutline, line: number | null): Addressed | null {
  if (outline.declarations.length === 0) return null;
  // `M240` `A` (`D1290`, `M239-09`) — with no line named, the landing is the first `test`, not the
  // first declaration. A file opening with a hook landed on the hook, and the pane's first words
  // were *a request cannot be added to a hook from here*. With a line named, the rule below is
  // unchanged: the last declaration at or before it, hooks included, because the line named it.
  let decl = landingDecl(outline)!;
  if (line !== null) {
    decl = outline.declarations[0]!;
    for (const candidate of outline.declarations) {
      if (candidate.line <= line) decl = candidate;
    }
  }
  const requests = decl.body.requests;
  if (requests.length === 0) return { decl, request: null };
  if (line === null) return { decl, request: requests[0]! };
  let request = requests[0]!;
  for (const candidate of requests) {
    if (candidate.line <= line) request = candidate;
  }
  return { decl, request };
}

/**
 * THE PREFIX — what `send` actually runs (`M210` `S6`, `D1075`).
 *
 * **Four requests in five cannot run alone.** Measured over the sibling: of 1031 requests, 185
 * reference nothing, **734 read a variable defined earlier**, 379 read a capture from the file's
 * `before` hook and 113 read an `env()`. So a Send that fired the selected request on its own would
 * be honest about 18% of them and a lie about the rest — and `D1075`'s answer is to run what comes
 * before it, for real.
 *
 * What comes before it is: the file's hooks, then this declaration's steps **up to and including
 * the selected request and everything attached to it**. The attachments are in because they are
 * what reads the response — dropping them would run the request and report no verdict for the one
 * thing the author is looking at.
 */
export interface Prefix {
  /** Which press this is (`D1215`). */
  readonly form: SendForm;
  /** The declaration this runs, and the index of the last step that runs in it. */
  readonly decl: number;
  readonly upTo: number;
  /** Every request that will be sent, in order, hooks first — what the pane lists before the
   *  press, because pressing it writes rows in somebody's database. */
  readonly requests: readonly { readonly where: string; readonly method: string; readonly path: string }[];
  /**
   * **The declaration's OWN requests, as lines in the buffer, in order** (`M225` `A`, `D1216`).
   *
   * The hooks' requests are in `requests` above because the press fires them and the reader is
   * owed that; they are not here because nothing on screen is drawn on a hook's line while this
   * file is open. What this is for is the join: a send used to record one verdict for one line,
   * and `D1216` makes it record one per request it issued.
   */
  readonly lines: readonly number[];
}

/**
 * **The two presses** (`M225`, `D1215`).
 *
 * `this` is `D1075`'s send, unchanged: the prefix up to the selected request, because four
 * requests in five cannot run alone. `all` is every request in the declaration — one iteration,
 * which is precisely what one virtual user does and therefore the unit a workload multiplies.
 *
 * Neither is a run. Both drop the workload and the thresholds (`D1211`) and strip the assertions
 * (`D1119`); ▶ is the run and it states its price (`D1212`).
 */
export type SendForm = 'this' | 'all';

export function prefixOf(outline: FileOutline, at: Addressed, form: SendForm = 'this'): Prefix | null {
  const decl = at.decl;
  /**
   * **`send all` is addressed at the declaration and not at a request**, which is the whole of
   * `M225` §1.1: `addressed()` falls back to `requests[0]` for a line above every request
   * (`D1080`), so the declaration address and the first request's were indistinguishable — and
   * nobody chose that, it was a navigation fallback leaking into a run semantic. A test whose
   * rung is `lookup → capture → POST /orders` sent the lookup when the reader pressed send under
   * the test's own name.
   */
  const own = decl.body.requests;
  if (own.length === 0) return null;
  const last = form === 'all' ? own[own.length - 1]! : at.request;
  if (last === null) return null;
  /**
   * **The cut is the request itself** — `M215` `A1` (`D1119`), narrowed from `M210` `S6`.
   *
   * It used to run to the last statement *attached* to the request, and that had one reason: the
   * assertions under it were what produced the verdicts the pane drew beside them. `D1119` stops a
   * send grading anything, so that reason is gone — and what is left of the old cut is pure cost,
   * because `attached` is *everything between this request and the next* rather than everything
   * about it. Measured on `examples/storefront`: sending `api POST /orders` ran `open "/"` too,
   * booting a browser to answer a question about an HTTP response, on the API door.
   *
   * Nothing after the request contributes to the request. The prefix is what has to happen *first*.
   */
  /**
   * **`all` runs to the end of the body, not to the last request.** One iteration is the whole
   * declaration — a `capture` after the final request is part of what a virtual user does, and a
   * cut that dropped it would make `send all` a prefix of an iteration rather than one.
   * `withoutAssertions` still takes the `expect`s out, so what this widens is the captures, the
   * `let`s and the logs, none of which grade anything.
   */
  const upTo = form === 'all'
    ? Math.max(...[...statementsOf(decl.body), ...requestsOf(decl.body)].map((x) => x.stepPath?.step ?? -1))
    : last.stepPath.step;
  const requests: { where: string; method: string; path: string }[] = [];
  for (const hook of outline.declarations) {
    if (hook.kind !== 'hook') continue;
    /* **A hook is not a prefix of itself** — `M240` `F` (`M239-01`). With a hook as the addressed
       declaration this loop listed its requests as the file's hooks and the loop below listed them
       again as its own, so `send all` on `before each` said *4 requests* against the head's *2*
       and named each one twice (review U4). The header counted `decl.body.requests`; this counted
       the same set twice. One set now: the other hooks first, then the declaration's own. */
    if (hook === decl) continue;
    for (const r of hook.body.requests) requests.push({ where: hook.label, method: r.method, path: r.path });
  }
  const lines: number[] = [];
  for (const r of own) {
    if (r.stepPath.step > last.stepPath.step) break;
    requests.push({ where: decl.kind === 'hook' ? decl.label : decl.name, method: r.method, path: r.path });
    lines.push(r.line);
  }
  return { form, decl: decl.index, upTo, requests, lines };
}
