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
import type { Program, Step, TestDecl, ThresholdDecl, Workload } from './ast.js';
import { format } from './format.js';
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
