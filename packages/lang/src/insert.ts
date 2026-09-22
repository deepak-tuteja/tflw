// Putting a printed node into a file — `M200` `A0-4` (`D1046`, `D1049`).
//
// THIS IS THE WHOLE AUTHORING PIPELINE, AS ONE PURE FUNCTION. A form has values and no text.
// `print` turns values into a fragment; this decides where the fragment goes, splices it into the
// source that already exists, and runs `format` over the result. What comes back is a finished
// file the write route will accept — parse-clean and format-stable are exactly its two `422`s
// (`D1049`) — so the page's job is to call this and PUT what it returns.
//
// IT IS A SPLICE, NOT A REPRINT (`D1046`). The bytes the author already wrote are not re-emitted,
// re-ordered or normalised by anything except `format`, which the file was already subject to.
// A printer that reprinted the file would have to be correct for all 115 node kinds the corpus
// uses; this has to be correct for the one node being inserted.
//
// AND IT LIVES HERE BECAUSE BOTH SIDES NEED IT. `@tflw/lang` has no dependencies and no Node
// builtins, so the page runs this in the browser and a test runs it in Node — the same function,
// which is why `A0-4` can be gated without a browser at all.
import type { HookDecl, ImportDecl, Program, Step, TestDecl, ThresholdDecl, UseDecl, Workload } from './ast.js';
import type { Span } from './token.js';
import { format, INDENT } from './format.js';
import { print } from './print.js';
import { lex } from './lexer.js';
import { parse as parseTokens } from './parser.js';

/** `index.ts`'s `parseSource`, inlined: `index.ts` re-exports this module, so importing it from
 *  there would be a cycle for the sake of four lines. */
function parseSource(source: string): { program: Program; diagnostics: ReturnType<typeof lex>['diagnostics'] } {
  const lexed = lex(source);
  const parsed = parseTokens(lexed.tokens);
  return { program: parsed.program, diagnostics: [...lexed.diagnostics, ...parsed.diagnostics] };
}

/** What to put in, and where. Each case names the node and, where it matters, the test it joins. */
export type Insertion =
  /** A whole new `test`, appended after everything the file already holds. */
  | { readonly kind: 'test'; readonly node: TestDecl }
  /** `ramp`/`hold`/`step`/`spike`/`run` — turning a functional test into a workload-bearing one. */
  | { readonly kind: 'workload'; readonly testName: string; readonly node: Workload }
  /** `threshold …` — `D1044`'s case, legal on a test whose workload line is not written yet. */
  | { readonly kind: 'threshold'; readonly testName: string; readonly node: ThresholdDecl }
  /**
   * Steps appended to a test that already exists (`A1-4`).
   *
   * This is the gap `A0-5`'s green-condition test had to work around and said so where it did it:
   * **a LOAD form cannot write a test that calls anything**, because `api` steps are the API
   * door's vocabulary. A door adds the work it knows how to describe, to a test any door may have
   * started — which is `D1044` from the writing side rather than the reading side.
   *
   * Several at once and not one at a time, because an `api` step and the `expect`s that read its
   * response are one edit: inserting them separately would leave a file, between two writes, whose
   * assertions name a response nothing fetched.
   */
  | { readonly kind: 'steps'; readonly testName: string; readonly nodes: readonly Step[] }
  /**
   * Steps spliced **directly under one step that is already there** (`M213` `S2`, `D1100`).
   *
   * `steps` above appends at the foot of the body, which is correct for a request and its
   * assertions arriving together and **wrong for an assertion about a request already in the
   * file**: tick-to-verify writes an `expect` that reads the response of the request you ticked,
   * and a test with three requests would put it under the third. An assertion written below a
   * later request is not a slightly misplaced line — `body` means *the last response*, so it
   * asserts about a different request and may well pass.
   *
   * The anchor is a `StepPath` and not a line for `replaceInSource`'s own reason, stated on that
   * type: this module formats before it edits, formatting moves lines, and an index pair does not
   * move under it.
   */
  | { readonly kind: 'stepsAfter'; readonly path: StepPath; readonly nodes: readonly Step[] }
  /**
   * Steps spliced directly **above** one that is already there (`M213` `S3`, `D1102`).
   *
   * Its case is `let`: a binding has to exist before the request that interpolates it, and
   * `outline.ts` measured **97 of the corpus' 100 preamble statements are `let`** — so the place
   * a reader looks for one and the place it has to be are the same place, the top of the body.
   * `stepsAfter` cannot express *above the first thing in this body*, because there is nothing
   * above it to anchor to.
   *
   * A separate member rather than a flag on the one above: the two differ in the offset they
   * splice at and in nothing else, and they share the implementation — what they do not share is
   * the sentence at the call site, where `stepsBefore` says which end of the statement's scope it
   * belongs to.
   */
  | { readonly kind: 'stepsBefore'; readonly path: StepPath; readonly nodes: readonly Step[] };

export type InsertResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Splice a printed node into `source` and format the result.
 *
 * Refuses rather than guesses, in four places: source that does not parse (there is no AST to
 * find a position in), a test name that is not in the file, a second workload line on a test that
 * has one (`TF-LOAD`: the parser allows at most one and would diagnose it), and a node the printer
 * cannot print. Each refusal leaves `source` untouched — the caller holds it.
 */
export function insertIntoSource(source: string, insertion: Insertion): InsertResult {
  // THE SOURCE IS FORMATTED FIRST, AND EVERY OFFSET BELOW IS INTO THE FORMATTED TEXT.
  //
  // Not a tidy-up. `print` emits two-space indentation because that is what `format` writes
  // (`INDENT`), and splicing a two-space line into a file written with four produces text that
  // does not even lex — `TF003: indentation does not match any enclosing block`. Found by the
  // gate, on the first fixture that was not already formatted.
  //
  // Normalising up front also makes the visible consequence structural rather than incidental:
  // the first edit to a hand-written file reformats all of it. That is forced anyway, since the
  // write route refuses text `format` would still change (`D1049`), so the only choice was
  // whether it happens predictably or as a surprise in someone's diff.
  const normalised = format(source);
  if (!normalised.ok) return { ok: false, reason: `the file does not lex: ${normalised.reason ?? 'unknown'}` };
  const text = normalised.formatted;

  const { program, diagnostics } = parseSource(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) return { ok: false, reason: `the file does not parse: ${error.code} at line ${error.span.start.line}` };

  /**
   * `stepsAfter` returns here rather than joining the printing below, because **it is the one
   * member whose indent is not known up front**. Every other insertion lands directly in a
   * declaration body, which is level 1; this one lands beside a step that may itself be nested,
   * and the level it prints at is read off that step. So the printing happens where the anchor is
   * resolved, and `printedText` below stays the single-level case it was written as.
   */
  if (insertion.kind === 'stepsAfter' || insertion.kind === 'stepsBefore') {
    const spliced = insertBesideStep(text, program, insertion.path, insertion.nodes, insertion.kind === 'stepsBefore' ? 'before' : 'after');
    return typeof spliced === 'string' ? settleSplice(spliced) : spliced;
  }

  // `steps` prints several fragments and joins them; every other kind prints one node.
  let printedText: string;
  if (insertion.kind === 'steps') {
    if (insertion.nodes.length === 0) return { ok: false, reason: 'no steps to insert' };
    const parts: string[] = [];
    for (const node of insertion.nodes) {
      const one = print(node, { indent: 1 });
      if (!one.ok) return { ok: false, reason: one.reason ?? 'the node cannot be printed' };
      parts.push(one.text);
    }
    printedText = parts.join('\n');
  } else {
    const printed = print(insertion.node, { indent: insertion.kind === 'test' ? 0 : 1 });
    if (!printed.ok) return { ok: false, reason: printed.reason ?? 'the node cannot be printed' };
    printedText = printed.text;
  }

  const spliced = insertion.kind === 'test' ? appendTest(text, printedText) : insertInTest(text, program, insertion, printedText);
  if (typeof spliced !== 'string') return spliced;

  // The splice should already be formatted — the source was normalised above and the fragment is
  // printed at `format`'s own indent — so this is an invariant, not a tidy-up, and it is written
  // as one. Re-formatting here instead would *correct* a bad splice silently and hand back bytes
  // nobody reasoned about; a caller would then PUT text that differs from what it computed.
  //
  // Measured, because "defensive code that never fires" is usually a euphemism for untested code.
  // Mutating the splice to leave a double blank line reddens the suite **through this branch**;
  // with the branch replaced by a re-format, the same defect is silently corrected and the suite
  // stays green. Deleting the branch on otherwise-correct code changes nothing observable — an
  // equivalent mutant, recorded here rather than chased, since the pair above is what shows the
  // branch is load-bearing.
  return settleSplice(spliced);
}

/** The invariant above, as one function because two members now reach it. See the comment at its
 *  only previous call site: this is not a tidy-up, it is the check that a splice landed on text
 *  `format` already agrees with — re-formatting here would silently correct a bad splice and hand
 *  back bytes nobody reasoned about. */
function settleSplice(spliced: string): InsertResult {
  const formatted = format(spliced);
  if (!formatted.ok) return { ok: false, reason: `the result does not format: ${formatted.reason ?? 'unknown'}` };
  if (formatted.formatted !== spliced) {
    return { ok: false, reason: 'the insertion did not land on formatted text — this is a defect in the printer or the splice, not in the file' };
  }
  return { ok: true, text: spliced };
}

/**
 * A new test goes at the end, after a blank line.
 *
 * At the end and not at the top because a file is read in the order it was written, and a form
 * that put each new test above the last would reverse a suite over a morning's work. The blank
 * line is what `format` would insist on between two declarations anyway.
 */
function appendTest(source: string, text: string): string {
  const body = source.replace(/\s*$/, '');
  return body.length === 0 ? `${text}\n` : `${body}\n\n${text}\n`;
}

function insertInTest(source: string, program: Program, insertion: Insertion & { testName: string }, text: string): string | InsertResult {
  const matches = program.tests.filter((t) => t.name.value === insertion.testName);
  if (matches.length === 0) return { ok: false, reason: `no test named ${JSON.stringify(insertion.testName)} in this file` };
  // Two tests of one name is legal to parse and ambiguous to edit. Refusing names the problem;
  // editing the first would silently pick one.
  if (matches.length > 1) return { ok: false, reason: `${matches.length} tests are named ${JSON.stringify(insertion.testName)} — rename one before editing either` };
  const test = matches[0]!;

  if (insertion.kind === 'workload') {
    if (test.workload !== null) {
      return { ok: false, reason: `${JSON.stringify(test.name.value)} already has a workload line at line ${test.workload.span.start.line}` };
    }
    // Directly under the header, above the steps: a workload line is a property of the whole
    // body, and a reader looking for "what shape does this run in" looks at the top.
    const at = afterLineContaining(source, test.name.span.end.offset);
    return source.slice(0, at) + text + '\n' + source.slice(at);
  }

  if (insertion.kind === 'steps') {
    const at = afterLineContaining(source, stepAnchor(source, test));
    return source.slice(0, at) + text + '\n' + source.slice(at);
  }

  // A threshold goes at the foot of the test, under everything already there — including any
  // thresholds it joins, so a second lands beside the first rather than above it.
  const at = afterLineContaining(source, endOfTestText(source, test));
  return source.slice(0, at) + text + '\n' + source.slice(at);
}

/** The offset just past the end of the line `offset` sits on, i.e. where a new line may begin. */
function afterLineContaining(source: string, offset: number): number {
  const nl = source.indexOf('\n', offset);
  return nl === -1 ? source.length : nl + 1;
}

/**
 * Where a new step goes: after everything in the test that is already a step, and before
 * everything that is not.
 *
 * A test's source is **three regions and not two** — the header, then the workload line, then the
 * body, then the thresholds — and only the middle one is `body`. So neither end of the test is the
 * right anchor and the first draft of this used both wrongly:
 *
 * - *The foot of the test* is where a `threshold` goes, and a step printed below one is a request
 *   written underneath an assertion about the whole run.
 * - *The header* is where the first draft fell back when `body` was empty — and a test with a
 *   workload line and no steps is exactly the shape the LOAD form produces, so the API door's
 *   first edit to a LOAD-authored test put its `api` step **above** the `run … iterations` line
 *   that the workload case of this same function is careful to keep directly under the header.
 *   Caught by the test for that case; it is why the empty-body branch names the workload rather
 *   than treating "no steps" as "nothing before me".
 */
function stepAnchor(source: string, test: TestDecl): number {
  if (test.body.length > 0) return backOverWhitespace(source, Math.max(...test.body.map((b) => b.span.end.offset)));
  if (test.workload) return backOverWhitespace(source, test.workload.span.end.offset);
  return test.name.span.end.offset;
}

/**
 * Splice printed steps directly beside the step at `path` — `M213` `S2`, widened by `S3`.
 *
 * Three things are read off the anchor rather than assumed, and each was a defect in an earlier
 * draft of a sibling function in this file:
 *
 * - **The level.** `print` is told the anchor's own indent depth, so an assertion ticked inside a
 *   `wait until api` block lands inside it rather than dedenting out of it and re-binding to the
 *   request above the block.
 * - **The end of the anchor.** A step's span runs to the start of whatever follows, so a request
 *   with a `header` sub-block ends on the *next* line's indentation. Walking back over whitespace
 *   is what puts the new line under the last line the anchor actually wrote — including the
 *   sub-block, which belongs to it.
 * - **The whole thing re-parses.** The result is formatted and parsed before it is returned, so a
 *   splice that lands somewhere the grammar does not admit is a refusal and not a broken file.
 */
function insertBesideStep(source: string, program: Program, path: StepPath, nodes: readonly Step[], side: 'before' | 'after'): string | InsertResult {
  if (nodes.length === 0) return { ok: false, reason: 'no steps to insert' };
  const declarations = [...program.hooks, ...program.tests].sort((a, b) => a.span.start.line - b.span.start.line);
  const decl = declarations[path.decl];
  if (!decl) return { ok: false, reason: `this file has no declaration ${path.decl}` };
  const target = decl.body[path.step];
  if (!target) return { ok: false, reason: `that declaration has no step ${path.step}` };

  const level = Math.round((target.span.start.column - 1) / INDENT.length);
  const parts: string[] = [];
  for (const node of nodes) {
    const one = print(node, { indent: level });
    if (!one.ok) return { ok: false, reason: one.reason ?? 'the node cannot be printed' };
    parts.push(one.text);
  }
  const at = side === 'before'
    ? aboveStep(source, lineStartOf(source, target.span.start.offset, target.span.start.column))
    : afterLineContaining(source, backOverWhitespace(source, target.span.end.offset));
  return source.slice(0, at) + parts.join('\n') + '\n' + source.slice(at);
}

/** The offset of the first character of the line an offset sits on. A step's span starts at its
 *  first *token*, which is past the indentation, and splicing there would put the new statement's
 *  own indented text after the anchor's leading spaces — a line that does not lex. */
function lineStartOf(_source: string, offset: number, column: number): number {
  return offset - (column - 1);
}

/**
 * Where a statement goes when it goes **above** another one — `M213` `S3`.
 *
 * **NOT THE ANCHOR'S OWN LINE, BECAUSE A COMMENT ABOVE IT BELONGS TO IT.** `readNotes` gives a
 * block of comment lines to the next line of code, blanks crossed (`D1077`); splicing between the
 * two hands the note to the new statement and leaves the one it was written about with none. On
 * this corpus that is 1247 notes' worth of hazard for one insertion point.
 *
 * So the walk goes up over comment and blank lines and stops at the first line that is neither —
 * which needs no floor of its own, because every thing that could be above is one: a previous
 * step, a `run … iterations` workload line, or the declaration's own `test "…"`. The file's header
 * block cannot be reached from inside a body for the same reason.
 */
function aboveStep(source: string, lineStart: number): number {
  let at = lineStart;
  while (at > 0) {
    const previousEnd = at - 1; // the `\n` that ends the line above
    const previousStart = source.lastIndexOf('\n', previousEnd - 1) + 1;
    const text = source.slice(previousStart, previousEnd).trim();
    if (text !== '' && !text.startsWith('#')) return at;
    at = previousStart;
  }
  return at;
}

function backOverWhitespace(source: string, offset: number): number {
  let i = Math.min(offset, source.length);
  while (i > 0 && /\s/.test(source[i - 1]!)) i -= 1;
  return i;
}

/**
 * **The last line a declaration's own text occupies** — `M224` `A` (`D1207`), and the anchor both
 * of this module's append paths hang off.
 *
 * Three offsets look like it and none of them is it:
 *
 * - **The furthest span of any child node** stops short of a *comment*, because a comment is not
 *   an AST node. A trailing `# TODO: assert the body too` would end up below the inserted line and
 *   read as a note about it, when it was written about the step above.
 * - **`decl.span.end`** overshoots. A declaration's span runs to the dedent that closes it, so on
 *   a test followed by another test it points at **the next declaration's first character**
 *   (measured: offset 23, the `t` of `test "u"`).
 * - **`decl.span.end` walked back over whitespace** — what both callers did until `M224` — lands
 *   on the last non-blank character *in the span*, which on the commonest file shape there is
 *   belongs to the **next** declaration. A comment block introducing the next test sits inside
 *   this test's span, so the anchor landed below it and the new line was written outside the test.
 *   Measured over `examples/storefront`: **`+ threshold` failed on 8 of 13 tests** with `TF010`,
 *   and `insertIntoSource({kind:'threshold'})` refused 2 of 3 through `settleSplice`. Two messages,
 *   one cause.
 *
 * So the walk goes back over blank lines **and over a run of comment lines that belongs to what
 * follows rather than to this declaration**. The two cases are told apart by the two facts that
 * distinguish them in the file, and it takes both:
 *
 * - **Something follows the run.** A run with nothing under it introduces nothing, so it is this
 *   declaration's own trailing note and the walk stops below it — the case the old docblock was
 *   careful about, preserved.
 * - **A blank line sits above the run.** A comment written directly under a statement of this test
 *   is a note about that statement. `D1077` gives a note to the next line of code with blanks
 *   crossed, so a *detached* run above the next declaration is that declaration's note and never
 *   this one's text.
 *
 * The lexer classifies the lines rather than a `#` test on the trimmed text, because a line inside
 * a multi-line value can start with one and is not a comment.
 */
function lastLineOfDecl(text: string, decl: TestDecl | HookDecl): { line: number; offset: number } {
  const records = lex(text).lines;
  const byLine = new Map(records.map((r) => [r.line, r]));
  const total = records.length === 0 ? 1 : records[records.length - 1]!.line;
  const kind = (n: number): 'blank' | 'comment' | 'code' => byLine.get(n)?.kind ?? 'blank';
  const indentOf = (n: number): number => byLine.get(n)?.indent ?? 0;
  const floor = decl.span.start.line;

  let line = Math.min(lineAt(text, Math.max(backOverWhitespace(text, decl.span.end.offset) - 1, 0)), total);
  for (;;) {
    while (line > floor && kind(line) === 'blank') line -= 1;
    if (line <= floor || kind(line) !== 'comment') break;
    let top = line;
    while (top > floor && kind(top - 1) === 'comment') top -= 1;
    let below = line + 1;
    while (below <= total && kind(below) === 'blank') below += 1;
    if (below > total) {
      /* **Nothing follows the run, and that is not enough to make it this test's text**
         (`M234` `C`). The rule above tells a note apart from an introduction by what is *around*
         the run, and a run at the end of the file has nothing around it — so a **dedented**
         paragraph closing the file was read as the last test's trailing note and the new line was
         written below it, outside the test. `settleSplice` then refused the whole edit, because a
         `  threshold …` under a column-0 comment is not text `format` agrees with.
         Found by `examples/storefront/tests/fulfilment.tflw`, whose closing paragraph is exactly
         that shape, and reproduced in five lines — see the gate below this one. Indentation is
         what separates the two: a note about a statement of this test is written at the body's
         depth, and a note about the file is written at the file's. */
      if (indentOf(top) > indentOf(floor)) break;               // indented: this test's own note
      line = top - 1;                                           // dedented: a note about the file
      continue;
    }
    if (top - 1 <= floor || kind(top - 1) !== 'blank') break;    // attached to a statement of this test
    line = top - 1;
  }
  return { line, offset: byLine.get(line)?.offset ?? 0 };
}

/** Just past the last character this test actually wrote. See `lastLineOfDecl`: an offset on that
 *  line is all `afterLineContaining` needs, and the line's own start is the one offset on it that
 *  cannot be inside anything else. */
function endOfTestText(source: string, test: TestDecl): number {
  return lastLineOfDecl(source, test).offset;
}

/**
 * Which step to replace — `M210` `S2` (`D1079`).
 *
 * **An index pair, not a line and not a name**, and both halves of that matter. A line is what the
 * *address* names (`D1080`) and is right for that job, but `replaceInSource` formats before it
 * edits — `insertIntoSource`'s own first act, for `TF003`'s reason — and formatting moves lines, so
 * a line handed in against unformatted text names a different statement by the time the edit lands.
 * A name is worse: a hook has none and duplicate test names are legal.
 *
 * `decl` indexes `[...hooks, ...tests]` **sorted by the line they start on**, which is the order a
 * file declares them and the order the UI's outline already builds. `step` indexes that
 * declaration's `body`. Neither moves under `format`, because formatting reshapes whitespace and
 * never reorders declarations.
 */
export interface StepPath {
  readonly decl: number;
  readonly step: number;
}

/**
 * What to put where — the replacing half of this module (`M210` `S2`, widened by `S4a`).
 *
 * `note` is the one member that is **not** a node, and it could not be: a comment is not in the
 * tree at all. `D1077` makes a note *a note on what it explains*, which gives it an owner — the
 * statement below it — and therefore an address, which is the same index pair the step uses. The
 * lines are written without their `#`; an empty list removes the note.
 */
export type Replacement =
  | { readonly kind: 'step'; readonly path: StepPath; readonly node: Step }
  | { readonly kind: 'note'; readonly owner: NoteOwner; readonly lines: readonly string[] }
  /**
   * A declaration's **header** — its tags, its `with each` table and its own line (`M210` `S5a`).
   *
   * **Never its body**, and that is the whole shape of this member. Printing a `TestDecl` prints
   * the test *and everything in it*, and the printer emits no comments — so replacing a whole
   * declaration to change a tag would silently delete every comment inside it, which for this
   * corpus is 1247 notes. What is replaced is the run of lines from the declaration's first line
   * down to its own keyword line, and the body below is not touched at all.
   */
  | { readonly kind: 'header'; readonly decl: number; readonly node: TestDecl | HookDecl }
  /** One `threshold` line of a test. `index` at the end of the list appends; `null` removes. */
  | { readonly kind: 'threshold'; readonly decl: number; readonly index: number; readonly node: ThresholdDecl | null }
  /**
   * A test's **`workload` line** — `M224` `A` (`D1206`).
   *
   * `replaceThreshold` with the index dropped: a test carries **at most one** workload, which the
   * parser enforces, so the member takes no index. A node where there is none writes one under the
   * header; `null` removes the one that is there.
   *
   * **It is a replacement and not a second `Insertion` member**, and both halves of that were
   * forced. `Insertion` addresses a test **by name** and the page addresses a declaration by index
   * once a file is open — two tests of one name are legal to parse and `insertInTest` refuses
   * them, which is a refusal the band has no way to act on. And `null` — *remove this workload* —
   * has nowhere to live in a type whose whole job is putting something in.
   *
   * Removing a workload **leaves the thresholds behind**, which is legal and already documented at
   * this file's `threshold` insertion: `D1044`'s case, a threshold on a test whose workload line is
   * not written. The test keeps the `load` lens through `thresholds.length > 0`, so it does not
   * vanish from the door it was removed on.
   */
  | { readonly kind: 'workload'; readonly decl: number; readonly node: Workload | null }
  /** One `import` or `use` line of the file. `index` at the end of the list appends; `null`
   *  removes. A file with none gets its first one above the first line of code, which is where the
   *  grammar wants it and below the file's own header comment, which is where a reader wants it. */
  | { readonly kind: 'file'; readonly what: 'import' | 'use'; readonly index: number; readonly node: ImportDecl | UseDecl | null }
  /**
   * **Take these steps out of this declaration** — `M214` `A4` (`D1117`).
   *
   * The gesture Compose had for a header, a subset entry, a threshold and a table row and had for
   * **nothing a person actually writes**: not a request, not an assertion, not a `let`. Four
   * rounds of authoring shipped with no way to unwrite a line.
   *
   * It takes a **list** rather than one index, and that is the shape the language forces rather
   * than a convenience. Removing a request has to remove the statements attached to it in the same
   * edit: `body` means *the last response*, so an `expect` left behind after its request is gone
   * silently reads a different one and may well pass. One edit, or a file that is wrong between two
   * of them.
   *
   * A step's **note goes with it**. `D1077` makes a comment a note *on* the line below it, so a
   * note whose owner has been deleted explains nothing and belongs to whatever moves up into its
   * place — which is the one outcome worse than losing it.
   */
  | { readonly kind: 'remove'; readonly decl: number; readonly steps: readonly number[] }
  /** A whole declaration, its header, its tags, its body and its note. `D1117`'s other half: the
   *  sequence column's first row is the test, so the test has a `✕` like everything under it. */
  | { readonly kind: 'removeDecl'; readonly decl: number };

/**
 * What a note is a note **on** (`D1077`, widened by `M210` `S5`).
 *
 * A comment is not in the tree, so every note is addressed by its owner — and there are three
 * kinds of owner because there are three places a block can sit: above a statement (1247 in the
 * two corpora), above a declaration (17), and at the top of the file, owning the file itself
 * (1625 lines across 119 of 139 files). The first two are positions in the tree; the third is the
 * one block `readNotes` gives to nobody else, because it starts on line 1.
 *
 * **`on` IS AN EXPLICIT DISCRIMINANT AND IT HAD TO BE.** The first draft distinguished the three
 * by field name alone — `{ step }`, `{ decl }`, `{ file }` — and a `StepPath` is `{ decl, step }`,
 * so passing one **satisfies the declaration member structurally** and TypeScript accepted it at
 * every call site. Four of them did exactly that, and every note an author wrote on a statement
 * landed on the declaration above it instead, with the whole thing typechecking. A union whose
 * members are told apart by which fields they have is not a discriminated union when one member's
 * fields are a subset of another's.
 */
export type NoteOwner =
  | { readonly on: 'step'; readonly path: StepPath }
  | { readonly on: 'declaration'; readonly decl: number }
  | { readonly on: 'file' };

/**
 * Replace one step in place and format the result.
 *
 * This is `insertIntoSource`'s sibling and deliberately shares its discipline rather than its
 * body: **format first so every offset is into formatted text**, splice one printed node, format
 * again, and refuse rather than guess. What comes back is a finished file the write route will
 * accept, which is the whole contract (`D1049`).
 *
 * It is a replacement and not a reprint for `D1046`'s reason a second time: every byte the author
 * wrote outside this one statement is untouched, so the printer has to be right about the node
 * being edited and about nothing else.
 */
export function replaceInSource(source: string, replacement: Replacement): InsertResult {
  const normalised = format(source);
  if (!normalised.ok) return { ok: false, reason: `the file does not lex: ${normalised.reason ?? 'unknown'}` };
  const text = normalised.formatted;
  const { program, diagnostics } = parseSource(text);
  const fatal = diagnostics.find((d) => d.severity === 'error');
  if (fatal) return { ok: false, reason: `the file does not parse: ${fatal.code} at line ${fatal.span.start.line}` };

  const declarations = [...program.hooks, ...program.tests].sort((a, b) => a.span.start.line - b.span.start.line);

  // The three members that do not name a step at all (`M210` `S5a`). Each one splices a run of
  // whole lines and then goes through the same format-and-parse gate as the rest of this module.
  if (replacement.kind === 'header') return replaceHeader(text, declarations, replacement.decl, replacement.node);
  if (replacement.kind === 'threshold') return replaceThreshold(text, declarations, replacement);
  if (replacement.kind === 'workload') return replaceWorkload(text, declarations, replacement);
  if (replacement.kind === 'file') return replaceFileDecl(text, program, replacement);
  if (replacement.kind === 'note') return replaceNote(text, declarations, replacement.owner, replacement.lines);
  if (replacement.kind === 'remove') return removeSteps(text, declarations, replacement.decl, replacement.steps);
  if (replacement.kind === 'removeDecl') return removeDeclaration(text, declarations, replacement.decl);

  const decl = declarations[replacement.path.decl];
  if (!decl) return { ok: false, reason: `this file has no declaration ${replacement.path.decl}` };
  const target = decl.body[replacement.path.step];
  if (!target) return { ok: false, reason: `that declaration has no step ${replacement.path.step}` };

  // The block level of the line being replaced — one per enclosing indent. A step directly in a
  // test body is level 1; `print` is told that and needs to know nothing else about the file.
  const lineStart = target.span.start.offset - (target.span.start.column - 1);
  const level = Math.round((target.span.start.column - 1) / INDENT.length);
  const printed = print(replacement.node, { indent: level });
  if (!printed.ok) return { ok: false, reason: printed.reason ?? 'the printer refused this node' };

  /**
   * **Trim the span's trailing whitespace before cutting.**
   *
   * A step's span runs to the start of whatever follows it, so a request with an indented
   * sub-block ends `…\n  ` — the newline and the *next* line's indentation. Replacing through that
   * glues the following statement onto the end of the printed one, which does not lex. Measured on
   * `api POST /orders body { … }` with a `header` block under it.
   */
  let end = target.span.end.offset;
  while (end > lineStart && /\s/.test(text[end - 1] ?? '')) end -= 1;

  const spliced = text.slice(0, lineStart) + printed.text + text.slice(end);
  const out = format(spliced);
  if (!out.ok) return { ok: false, reason: `the edit does not lex: ${out.reason ?? 'unknown'}` };
  const check = parseSource(out.formatted);
  const broke = check.diagnostics.find((d) => d.severity === 'error');
  if (broke) return { ok: false, reason: `the edit does not parse: ${broke.code} at line ${broke.span.start.line}` };
  return { ok: true, text: out.formatted };
}

/**
 * Replace the comment block above whatever it is a note on — `M210` `S4a`, widened by `S5`.
 *
 * THE OWNERSHIP RULE IS `readNotes`' AND IT IS READ BACKWARDS HERE. A note owns the next line of
 * code, blanks crossed — measured: 291 of the corpus's 419 blocks sit directly on their code and
 * **127 have a blank line under them**, the file headers among them. So finding the note of
 * something means walking up from it over blank lines and then taking the contiguous run of
 * comment lines above those. Walking up only over comments would miss 127 blocks; not stopping
 * where the owner's own scope ends would let a statement claim the note on the `test` above it.
 *
 * **THE FLOOR IS WHAT TELLS THE THREE OWNERS APART.** A statement may not walk past its
 * declaration's first line; a declaration may not walk onto **line 1**, because a block starting
 * there is the file's own header and `readNotes` gives it to nobody else; and the file's note *is*
 * that block. Without the line-1 floor, editing the note on the first declaration of a file that
 * opens with a header comment would rewrite the header — 119 of 139 files in the corpus.
 *
 * It does not reformat the text of a note: comment text is the author's, and `format` does not
 * touch it either. What this controls is the `#` and the indent, which are the two things that
 * make a line a comment of this block rather than of the file.
 */
function replaceNote(text: string, declarations: readonly (TestDecl | HookDecl)[], owner: NoteOwner, lines: readonly string[]): InsertResult {
  const located = ((): { at: number; floor: number; column: number; top?: boolean } | string => {
    if (owner.on === 'file') {
      // **The file's note is the block that STARTS ON LINE 1** — `readNotes`' rule, not a walk up
      // from anything. The first draft walked back from the first line of code and landed on the
      // note belonging to the first declaration, which is the very confusion the line-1 rule
      // exists to settle: with a header, a blank and a note on the test, walking up from the test
      // finds the test's note and walking down from the top finds the file's.
      return { at: 1, floor: 0, column: 1, top: true };
    }
    if (owner.on === 'declaration') {
      const decl = declarations[owner.decl];
      if (!decl) return `this file has no declaration ${owner.decl}`;
      return { at: decl.span.start.line, floor: 1, column: decl.span.start.column };
    }
    const decl = declarations[owner.path.decl];
    if (!decl) return `this file has no declaration ${owner.path.decl}`;
    const target = decl.body[owner.path.step];
    if (!target) return `that declaration has no step ${owner.path.step}`;
    const { lines: records } = lex(text);
    const declLine = records.find((r) => r.offset >= decl.span.start.offset)?.line ?? 1;
    return { at: target.span.start.line, floor: declLine, column: target.span.start.column };
  })();
  if (typeof located === 'string') return { ok: false, reason: located };

  const { lines: records } = lex(text);
  const byLine = new Map(records.map((r) => [r.line, r]));
  const indent = ' '.repeat(located.column - 1);
  let first = located.at;
  let end = located.at;
  if (located.top === true) {
    // Downwards, not up: the block is however many comment lines the file opens with, and a file
    // that opens with code has none, so the new one is written above everything.
    while (byLine.get(end)?.kind === 'comment') end += 1;
  } else {
    let above = located.at - 1;
    while (above > located.floor && byLine.get(above)?.kind === 'blank') above -= 1;
    while (above > located.floor && byLine.get(above)?.kind === 'comment') {
      first = above;
      above -= 1;
    }
  }
  // …and if the walk crossed blank lines to reach a block, the block still owns this line, so the
  // replacement covers from the block down to the owner, blanks included. A note and the thing it
  // explains with air between them is one thing to a reader and has to be one thing here.
  const written = lines.map((line) => `${indent}# ${line}`.trimEnd());
  // The file's own note keeps the blank line under it that 118 of the corpus's 118 headers have —
  // and that `readNotes` needs to tell a header from a note on the first declaration.
  const trailing = located.top === true && written.length > 0 && end === located.at ? [''] : [];
  return spliceLines(text, first, end, [...written, ...trailing]);
}

/** Splice whole lines and put the result through the same gate every edit here goes through: it
 *  must lex, and it must parse with no error. `from`/`to` are 1-based and inclusive-exclusive. */
function spliceLines(text: string, from: number, to: number, written: readonly string[]): InsertResult {
  const lines = text.split('\n');
  const spliced = [...lines.slice(0, from - 1), ...written, ...lines.slice(to - 1)].join('\n');
  const out = format(spliced);
  if (!out.ok) return { ok: false, reason: `the edit does not lex: ${out.reason ?? 'unknown'}` };
  const check = parseSource(out.formatted);
  const broke = check.diagnostics.find((d) => d.severity === 'error');
  if (broke) return { ok: false, reason: `the edit does not parse: ${broke.code} at line ${broke.span.start.line}` };
  return { ok: true, text: out.formatted };
}

/**
 * A declaration's header lines, printed — **the lines above its body and not one more**.
 *
 * `printTest` emits tags, then the `with each` table, then the `test …` line, then the body; a
 * hook emits its own line and then the body. So the header is everything up to and including the
 * declaration's keyword line, and finding that line in the *printed* text is a search for the one
 * that starts with the keyword — which no table row and no tag line can.
 */
function headerLines(node: TestDecl | HookDecl, level: number): { ok: true; lines: string[] } | { ok: false; reason: string } {
  const printed = print(node, { indent: level });
  if (!printed.ok) return { ok: false, reason: printed.reason ?? 'the printer refused this declaration' };
  const lines = printed.text.split('\n');
  if (node.type === 'HookDecl') return { ok: true, lines: lines.slice(0, 1) };
  const index = lines.findIndex((line) => line.trimStart().startsWith('test '));
  if (index < 0) return { ok: false, reason: 'the printed test has no `test` line, which cannot happen and did' };
  return { ok: true, lines: lines.slice(0, index + 1) };
}

function replaceHeader(text: string, declarations: readonly (TestDecl | HookDecl)[], index: number, node: TestDecl | HookDecl): InsertResult {
  const decl = declarations[index];
  if (!decl) return { ok: false, reason: `this file has no declaration ${index}` };
  if (decl.type !== node.type) return { ok: false, reason: `declaration ${index} is a ${decl.type === 'TestDecl' ? 'test' : 'hook'} and this is not` };
  const level = Math.round((decl.span.start.column - 1) / INDENT.length);
  const written = headerLines(node, level);
  if (!written.ok) return written;
  // A test's own line is where its NAME is, which is the one position the header's length cannot
  // move: tags above it are one line, a `with each` table is as many as it has rows.
  const keyword = decl.type === 'TestDecl' ? decl.name.span.start.line : decl.span.start.line;
  return spliceLines(text, decl.span.start.line, keyword + 1, written.lines);
}

function replaceThreshold(text: string, declarations: readonly (TestDecl | HookDecl)[], replacement: { readonly decl: number; readonly index: number; readonly node: ThresholdDecl | null }): InsertResult {
  const decl = declarations[replacement.decl];
  if (!decl) return { ok: false, reason: `this file has no declaration ${replacement.decl}` };
  if (decl.type !== 'TestDecl') return { ok: false, reason: 'a hook carries no thresholds' };
  const held = decl.thresholds;
  const level = Math.round((decl.span.start.column - 1) / INDENT.length) + 1;
  const printed = ((): { ok: true; lines: string[] } | { ok: false; reason: string } => {
    if (replacement.node === null) return { ok: true, lines: [] };
    const out = print(replacement.node, { indent: level });
    return out.ok ? { ok: true, lines: [out.text] } : { ok: false, reason: out.reason ?? 'the printer refused this threshold' };
  })();
  if (!printed.ok) return printed;
  const existing = held[replacement.index];
  if (existing) return spliceLines(text, existing.span.start.line, existing.span.end.line + 1, printed.lines);
  if (replacement.node === null) return { ok: false, reason: `that test has no threshold ${replacement.index}` };
  // Appended after the last one, or — for a test with none — at the end of its body, which is where
  // `printTest` puts thresholds and therefore where `format` would move it anyway.
  const last = held[held.length - 1];
  const after = last ? last.span.end.line : lastLineOfDecl(text, decl).line;
  return spliceLines(text, after + 1, after + 1, printed.lines);
}

/**
 * Rewrite, write or remove a test's one workload line — `M224` `A` (`D1206`).
 *
 * `replaceThreshold`'s shape, with the one difference the language forces: there is no index,
 * because there is no list. The end of an existing workload is read off its **offsets** and not
 * its `span.end.line`, because a `step`/`spike` block's span runs into the indentation of whatever
 * follows it — the same correction `replaceInSource`'s step branch carries, which a one-line
 * workload would never have shown.
 */
function replaceWorkload(text: string, declarations: readonly (TestDecl | HookDecl)[], replacement: { readonly decl: number; readonly node: Workload | null }): InsertResult {
  const decl = declarations[replacement.decl];
  if (!decl) return { ok: false, reason: `this file has no declaration ${replacement.decl}` };
  if (decl.type !== 'TestDecl') return { ok: false, reason: 'a hook carries no workload' };
  const level = Math.round((decl.span.start.column - 1) / INDENT.length) + 1;
  const printed = ((): { ok: true; lines: string[] } | { ok: false; reason: string } => {
    if (replacement.node === null) return { ok: true, lines: [] };
    const out = print(replacement.node, { indent: level });
    return out.ok ? { ok: true, lines: out.text.split('\n') } : { ok: false, reason: out.reason ?? 'the printer refused this workload' };
  })();
  if (!printed.ok) return printed;
  const held = decl.workload;
  if (held) {
    const end = backOverWhitespace(text, held.span.end.offset);
    const last = lineAt(text, Math.max(end - 1, held.span.start.offset));
    return spliceLines(text, held.span.start.line, last + 1, printed.lines);
  }
  if (replacement.node === null) return { ok: false, reason: 'that test has no workload line' };
  // Directly under the header and above the steps — `insertInTest`'s workload branch's own place,
  // and where `printTest` emits it, so this is the one position `format` would not move it from.
  const at = decl.name.span.end.line + 1;
  return spliceLines(text, at, at, printed.lines);
}

function replaceFileDecl(text: string, program: Program, replacement: { readonly what: 'import' | 'use'; readonly index: number; readonly node: ImportDecl | UseDecl | null }): InsertResult {
  const held: readonly (ImportDecl | UseDecl)[] = replacement.what === 'import' ? program.imports : program.uses;
  const printed = ((): { ok: true; lines: string[] } | { ok: false; reason: string } => {
    if (replacement.node === null) return { ok: true, lines: [] };
    const out = print(replacement.node);
    return out.ok ? { ok: true, lines: [out.text] } : { ok: false, reason: out.reason ?? 'the printer refused this line' };
  })();
  if (!printed.ok) return printed;
  const existing = held[replacement.index];
  if (existing) return spliceLines(text, existing.span.start.line, existing.span.end.line + 1, printed.lines);
  if (replacement.node === null) return { ok: false, reason: `this file has no ${replacement.what} ${replacement.index}` };
  const last = held[held.length - 1];
  if (last) return spliceLines(text, last.span.end.line + 1, last.span.end.line + 1, printed.lines);
  // A file with none: above its first line of code, which is where the grammar wants it and below
  // the file's own header comment, which is where a reader wants it. `lex` is what knows which
  // lines are comments — a `#` inside a string is not one (`D159`).
  const { lines: records } = lex(text);
  const first = records.find((r) => r.kind === 'code');
  const at = first ? first.line : 1;
  return spliceLines(text, at, at, [...printed.lines, '']);
}


// ---- `M214` `A4` — taking something out ---------------------------------------------------

/** Which line an offset is on. One count over the text rather than a second index: the lexer's own
 *  line records are keyed by line and this question goes the other way. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  const stop = Math.min(offset, text.length);
  for (let i = 0; i < stop; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * The run of lines one node occupies, **its note included**.
 *
 * Two corrections are baked in and both were paid for elsewhere in this module. A span runs to the
 * start of whatever follows it, so the trailing whitespace is walked back off the end before the
 * last line is read — `replaceInSource` learned that on `api POST /orders` with an indented
 * `header` block, where cutting through the span glued the next statement onto the printed one.
 * And the note above is found by `replaceNote`'s own walk — up over blank lines, then up over the
 * contiguous comment block — because **127 of the corpus's 419 blocks have a blank line under
 * them** and a walk that stopped at the first non-comment would leave every one of those behind.
 *
 * `floor` is where the walk may not go: a statement may not claim the note on the `test` above it.
 */
function lineRun(text: string, byLine: ReadonlyMap<number, { kind: string }>, span: Span, floor: number): { from: number; to: number } {
  let end = span.end.offset;
  while (end > span.start.offset && /\s/.test(text[end - 1] ?? '')) end -= 1;
  const last = lineAt(text, Math.max(end - 1, span.start.offset));
  let first = span.start.line;
  let above = first - 1;
  while (above > floor && byLine.get(above)?.kind === 'blank') above -= 1;
  while (above > floor && byLine.get(above)?.kind === 'comment') {
    first = above;
    above -= 1;
  }
  return { from: first, to: last + 1 };
}

/** Drop several line runs in ONE pass and put the result through the module's own gate.
 *
 *  One pass rather than a splice each, because every splice reformats and every reformat moves the
 *  lines the next range was measured against — the class of defect `D1080` records one level up,
 *  where an edit moved the request the address was naming. The ranges are measured against one
 *  text and applied to that same text. */
function dropLines(text: string, ranges: readonly { from: number; to: number }[]): InsertResult {
  const cut = new Set<number>();
  for (const r of ranges) for (let line = r.from; line < r.to; line += 1) cut.add(line);
  const kept = text.split('\n').filter((_, i) => !cut.has(i + 1));
  const out = format(kept.join('\n'));
  if (!out.ok) return { ok: false, reason: `the edit does not lex: ${out.reason ?? 'unknown'}` };
  const check = parseSource(out.formatted);
  const broke = check.diagnostics.find((d) => d.severity === 'error');
  if (broke) return { ok: false, reason: `the edit does not parse: ${broke.code} at line ${broke.span.start.line}` };
  return { ok: true, text: out.formatted };
}

function removeSteps(text: string, declarations: readonly (TestDecl | HookDecl)[], index: number, steps: readonly number[]): InsertResult {
  const decl = declarations[index];
  if (!decl) return { ok: false, reason: `this file has no declaration ${index}` };
  if (steps.length === 0) return { ok: false, reason: 'nothing was named for removal' };
  const { lines: records } = lex(text);
  const byLine = new Map(records.map((r) => [r.line, { kind: r.kind as string }]));
  /* The floor is the declaration's own first line: a statement's note may sit above blank lines
     but never above the `test` keyword, where it would be the declaration's note instead. */
  const floor = decl.span.start.line;
  const ranges: { from: number; to: number }[] = [];
  for (const step of steps) {
    const node = decl.body[step];
    if (!node) return { ok: false, reason: `that declaration has no step ${step}` };
    ranges.push(lineRun(text, byLine, node.span, floor));
  }
  return dropLines(text, ranges);
}

function removeDeclaration(text: string, declarations: readonly (TestDecl | HookDecl)[], index: number): InsertResult {
  const decl = declarations[index];
  if (!decl) return { ok: false, reason: `this file has no declaration ${index}` };
  const { lines: records } = lex(text);
  const byLine = new Map(records.map((r) => [r.line, { kind: r.kind as string }]));
  /* **Line 1 is the floor, and it is the file's header rather than this declaration's note.**
     `readNotes` gives a block starting on line 1 to the file and to nobody else — 118 of 139 files
     open with one — so a declaration that walks onto it would take the file's header out with the
     first test. */
  return dropLines(text, [lineRun(text, byLine, decl.span, 1)]);
}
