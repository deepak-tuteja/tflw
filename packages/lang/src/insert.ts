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
  | { readonly kind: 'steps'; readonly testName: string; readonly nodes: readonly Step[] };

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
 * Just past the last character this test actually wrote — which is neither of the two offsets
 * that look like it, both measured:
 *
 * - **The furthest span of any child node** stops short of a *comment*, because a comment is not
 *   an AST node. A trailing `# TODO: assert the body too` would end up below the inserted line
 *   and read as a note about it, when it was written about the step above.
 * - **`test.span.end`** overshoots. A declaration's span runs to the dedent that closes it, so on
 *   a test followed by a blank line and another test it points at **the next declaration's first
 *   character** (measured: offset 23, the `t` of `test "u"`).
 *
 * So: start at the declaration's end and walk back over whitespace. That lands just past the last
 * non-blank character inside the test, comment or not, and never inside what follows.
 */
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

function backOverWhitespace(source: string, offset: number): number {
  let i = Math.min(offset, source.length);
  while (i > 0 && /\s/.test(source[i - 1]!)) i -= 1;
  return i;
}

function endOfTestText(source: string, test: TestDecl): number {
  let i = Math.min(test.span.end.offset, source.length);
  while (i > 0 && /\s/.test(source[i - 1]!)) i -= 1;
  return i;
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
  | { readonly kind: 'note'; readonly path: StepPath; readonly lines: readonly string[] }
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
  /** One `import` or `use` line of the file. `index` at the end of the list appends; `null`
   *  removes. A file with none gets its first one above the first line of code, which is where the
   *  grammar wants it and below the file's own header comment, which is where a reader wants it. */
  | { readonly kind: 'file'; readonly what: 'import' | 'use'; readonly index: number; readonly node: ImportDecl | UseDecl | null };

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
  if (replacement.kind === 'file') return replaceFileDecl(text, program, replacement);

  const decl = declarations[replacement.path.decl];
  if (!decl) return { ok: false, reason: `this file has no declaration ${replacement.path.decl}` };
  const target = decl.body[replacement.path.step];
  if (!target) return { ok: false, reason: `that declaration has no step ${replacement.path.step}` };

  if (replacement.kind === 'note') return replaceNote(text, decl, target, replacement.lines);

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
 * Replace the comment block above a statement — `M210` `S4a`, and the one edit in this module that
 * is made of lines rather than of a node.
 *
 * THE OWNERSHIP RULE IS `readNotes`' AND IT IS READ BACKWARDS HERE. A note owns the next line of
 * code, blanks crossed — measured: 291 of the corpus's 419 blocks sit directly on their code and
 * **127 have a blank line under them**, the file headers among them. So finding the note of a
 * statement means walking up from it over blank lines and then taking the contiguous run of
 * comment lines above those. Walking up only over comments would miss 127 blocks; not stopping at
 * the declaration's own line would let a statement claim the note on the `test` above it.
 *
 * It does not reformat: comment text is the author's, and `format` does not touch it either. What
 * this controls is the `#` and the indent, which are the two things that make a line a comment of
 * this block rather than of the file.
 */
function replaceNote(text: string, decl: { readonly span: Span }, target: Step, lines: readonly string[]): InsertResult {
  const { lines: records } = lex(text);
  const column = target.span.start.column;
  const indent = ' '.repeat(column - 1);
  const targetLine = target.span.start.line;
  const declLine = records.find((r) => r.offset >= decl.span.start.offset)?.line ?? 1;

  // Walk up: blank lines first, then the block itself. `record.line` is 1-based, so index by it.
  const byLine = new Map(records.map((r) => [r.line, r]));
  let first = targetLine;
  let above = targetLine - 1;
  while (above > declLine && byLine.get(above)?.kind === 'blank') above -= 1;
  while (above > declLine && byLine.get(above)?.kind === 'comment') {
    first = above;
    above -= 1;
  }
  // …and if the walk crossed blank lines to reach a block, the block still owns this statement, so
  // the replacement covers from the block down to the statement's own line, blanks included. A note
  // and its statement with air between them is one thing to a reader and has to be one thing here.
  const source = text.split('\n');
  const before = source.slice(0, first - 1);
  const after = source.slice(targetLine - 1);
  // `#`, one space, the text — and `trimEnd` so a blank line of a note is `#` and not `# `. It is
  // `trimEnd` rather than a branch because `format` strips trailing whitespace anyway: the two
  // spellings are one file, and writing it as a condition only looks like it decides something.
  const written = lines.map((line) => `${indent}# ${line}`.trimEnd());
  const spliced = [...before, ...written, ...after].join('\n');

  const out = format(spliced);
  if (!out.ok) return { ok: false, reason: `the edit does not lex: ${out.reason ?? 'unknown'}` };
  const check = parseSource(out.formatted);
  const broke = check.diagnostics.find((d) => d.severity === 'error');
  if (broke) return { ok: false, reason: `the edit does not parse: ${broke.code} at line ${broke.span.start.line}` };
  return { ok: true, text: out.formatted };
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
  const after = last ? last.span.end.line : endLineOf(text, decl);
  return spliceLines(text, after + 1, after + 1, printed.lines);
}

/** The last line a declaration's text occupies — its own span's end, trimmed back over the blank
 *  lines a span runs through on its way to whatever follows it. */
function endLineOf(text: string, decl: TestDecl | HookDecl): number {
  const lines = text.split('\n');
  let line = Math.min(decl.span.end.line, lines.length);
  while (line > decl.span.start.line && (lines[line - 1] ?? '').trim() === '') line -= 1;
  return line;
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
