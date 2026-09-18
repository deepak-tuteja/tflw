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

import { lex, parseSource, print, STEP_LENS, type Lens, type Step, type StepLens } from '@tflw/lang';
import type {
  ActionDecl,
  ApiBody,
  ApiRequestSpec,
  ApiStep,
  DataTable,
  Diagnostic,
  HookDecl,
  ImportDecl,
  TestDecl,
  ThresholdDecl,
  UseDecl,
  WaitUntilApiStmt,
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
  readonly node: Step;
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
}

export interface OutlineHook {
  readonly kind: 'hook';
  readonly when: HookDecl['when'];
  readonly scope: HookDecl['scope'];
  readonly line: number;
  readonly label: string;
  readonly note: Note | null;
  readonly body: OutlineBody;
}

export interface OutlineTest {
  readonly kind: 'test';
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
  /** Hooks and tests in line order — a file does not sort its declarations by kind, and neither
   *  does the outline. `crawl` declarations are the SCANS door's own root and are not here. */
  readonly declarations: readonly (OutlineHook | OutlineTest)[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Every statement in a body, in the order they were placed — what the completeness floor counts. */
export function statementsOf(body: OutlineBody): OutlineStatement[] {
  return [...body.preamble, ...body.requests.flatMap((r) => r.attached)];
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

function statement(step: Step, notes: FileNotes, nested = false): OutlineStatement {
  return {
    nested,
    kind: step.type,
    line: step.span.start.line,
    lens: STEP_LENS[step.type],
    text: render(step),
    note: notes.byOwner.get(step.span.start.line) ?? null,
    node: step,
  };
}

function request(step: ApiStep | WaitUntilApiStmt, notes: FileNotes): {
  request: Omit<OutlineRequest, 'attached'>;
  /** `wait until api`'s expects belong to it and to nothing else — they are inside its block. */
  own: OutlineStatement[];
} {
  const spec: ApiRequestSpec = step.type === 'ApiStep' ? step : step.request;
  return {
    request: {
      line: step.span.start.line,
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
    own: step.type === 'WaitUntilApiStmt' ? step.expects.map((e) => statement(e, notes, true)) : [],
  };
}

/**
 * A body, grouped by request.
 *
 * The rule is one sentence: a statement belongs to the last request above it, or to the preamble
 * if there is none. That is what the corpus's own shape says — `test → [let preamble] → request →
 * [its expects, captures, logs] → request → …` — and it is why this is a fold rather than three
 * filters.
 */
export function groupBody(steps: readonly Step[], notes: FileNotes): OutlineBody {
  const preamble: OutlineStatement[] = [];
  const requests: { head: Omit<OutlineRequest, 'attached'>; attached: OutlineStatement[] }[] = [];
  for (const step of steps) {
    if (isRequest(step)) {
      const { request: head, own } = request(step, notes);
      requests.push({ head, attached: own });
      continue;
    }
    const row = statement(step, notes);
    if (requests.length === 0) preamble.push(row);
    else requests[requests.length - 1]!.attached.push(row);
  }
  return { preamble, requests: requests.map((r) => ({ ...r.head, attached: r.attached })) };
}

/**
 * The whole file, read.
 *
 * Parsed in the browser with the same `@tflw/lang` the CLI uses — the package has no dependencies
 * and no Node builtins, which is why there is no second implementation here to drift from the one
 * `tflw check` runs. A file with diagnostics still produces an outline: the parser recovers, and a
 * pane that showed nothing for a file with one typo in it would be a pane nobody could use to fix
 * the typo.
 */
export function fileOutline(path: string, source: string): FileOutline {
  const { program, diagnostics } = parseSource(source);
  const notes = readNotes(source);
  const hooks: OutlineHook[] = program.hooks.map((h) => ({
    kind: 'hook',
    when: h.when,
    scope: h.scope,
    line: h.span.start.line,
    label: `${h.when} ${h.scope}`,
    note: notes.byOwner.get(h.span.start.line) ?? null,
    body: groupBody(h.body, notes),
  }));
  const tests: OutlineTest[] = program.tests.map((t: TestDecl) => ({
    kind: 'test',
    name: t.name.value,
    line: t.span.start.line,
    tags: t.tags,
    sessions: t.sessions,
    retry: t.retry,
    table: t.table,
    workload: t.workload,
    thresholds: t.thresholds,
    note: notes.byOwner.get(t.span.start.line) ?? null,
    body: groupBody(t.body, notes),
  }));
  return {
    path,
    file: { imports: program.imports, uses: program.uses, actions: program.actions, header: notes.header, tail: notes.tail },
    declarations: [...hooks, ...tests].sort((a, b) => a.line - b.line),
    diagnostics,
  };
}

/** What an address resolves to (`D1080`) — the declaration it names, and the request inside it. */
export interface Addressed {
  readonly decl: OutlineHook | OutlineTest;
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
  let decl = outline.declarations[0]!;
  if (line !== null) {
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
