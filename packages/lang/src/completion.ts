// Grammar-shape autocomplete context (PLAN_M13_LSP.md decision 17.6): given the full source and a
// cursor offset, determine which of the six instrumented grammar productions (parser.ts) the
// cursor sits in. `packages/lsp-server` combines this with symbol-name candidates (`symbols.ts`)
// and `spec-data.ts` entries to build the actual completion list — this module only answers "what
// production", not "what to suggest".
//
// The blank-line case (`M125e`, `FU-24`, D278). A cursor on a line of pure indentation — right
// after pressing Enter for a new step, which is exactly when someone reaches for the list — used to
// return `null`, because `lexer.ts`'s `processLine` treats a whitespace-only line as *blank* and
// emits no `indent`/`newline` for it, so no guarded production is ever reached. That was never a
// filtering problem: an empty prefix admits everything, but there was no context to filter.
// `resolveAtUntypedCursor` below closes it at this boundary rather than in the lexer, whose
// blank-line rule is correct for parsing and is what every other consumer depends on. `M137a`/D444
// widened that function to every cursor with nothing typed at it, not just a wholly blank line —
// see its own comment for why the two were always one case.

import { lex } from './lexer.js';
import { parseConfigForCompletion, parseForCompletion } from './parser.js';
import type { CompletionContext } from './parser.js';

export type { CompletionContext, CompletionKind } from './parser.js';

/**
 * Truncate `source` at `cursorOffset`, re-lex, and parse in completion mode. The lexer always
 * emits a trailing `eof` token (lexer.ts) — a cursor sitting where the next token is expected
 * naturally produces one, with zero special-casing. Returns `null` when the cursor isn't in one
 * of the six instrumented production entry points (e.g. mid-token inside an already-complete
 * construct).
 */
export function getCompletionContext(source: string, cursorOffset: number): CompletionContext | null {
  return resolve(source.slice(0, cursorOffset), parseForCompletion);
}

/**
 * The same question asked of a `tflw.config` buffer (`M137a`, D444). A separate entry point rather
 * than a dialect parameter, matching `parseSource`/`parseConfigSource` and `parse`/`parseConfig`:
 * the caller already knows which dialect it holds — `server.ts` reads it off the document store —
 * and a parameter with a default is how the wrong dialect's vocabulary reaches a buffer silently,
 * which is the reasoning `M136b` recorded when it made `collectSemanticTokens`' dialect required.
 *
 * Returns `null` outside the instrumented positions, exactly as its sibling does. There are five:
 * the file's top level, a config key inside `defaults` and inside `env`, and the two positions a
 * `probe …` sub-clause is typed from.
 */
export function getConfigCompletionContext(source: string, cursorOffset: number): CompletionContext | null {
  return resolve(source.slice(0, cursorOffset), parseConfigForCompletion);
}

type ParseFor = (tokens: ReturnType<typeof lex>['tokens']) => CompletionContext | null;

/**
 * **The untyped-cursor case is tried first, and that ordering is load-bearing since `M137a`.** It used
 * to be the fallback, which was correct only because nothing was instrumented at a position that
 * could answer wrongly. Instrumenting the config dialect's top level broke exactly that: with the
 * cursor on the indented line under `defaults`, the last *token* is still `defaults` — the lexer
 * emits nothing at all for a whitespace-only line — so `atCompletionPoint()` sees the parser
 * sitting on the final identifier and the top-level guard answers about a line the user left two
 * keystrokes ago. Completion for every key in every `defaults` block was the cost.
 *
 * Trying the probe first is not merely a workaround for that guard. When the last line is pure
 * indentation the cursor is *on* that line, so any context derived from the tokens before it is
 * stale by construction, whichever dialect is being read. `resolveAtUntypedCursor` returns `null` for
 * every other cursor position, so this reordering changes nothing outside the case it is about.
 */
function resolve(truncated: string, parseFor: ParseFor): CompletionContext | null {
  return resolveAtUntypedCursor(truncated, parseFor) ?? parseFor(lex(truncated).tokens);
}

/** A single letter is all it takes to make an indentation-only line non-blank. The probe proves
 * the parser can already answer from this exact cursor position — typing one `c` there yields
 * `check, capture, click, close, cleanup` — so the letter is scaffolding for the lexer, never an
 * answer of our own. `_` is a legal identifier start that leads no keyword, so a stray occurrence
 * cannot read as a partially-typed one. */
const BLANK_LINE_PROBE = '_';

/**
 * The context for a cursor that has **nothing typed at it**, derived by asking the same question
 * with one character typed and then discarding that character's prefix.
 *
 * **`M137a` widens this from "a whitespace-only line" to "a line ending in whitespace"**, which is
 * the condition it was always about: in both, the user has typed nothing at the cursor. The narrow
 * form was correct only by accident. `atCompletionPoint()` cannot see a trailing space — the lexer
 * closes the last physical line with a synthetic `newline`, so a cursor after `probe ` and a cursor
 * mid-word in `probe` present identically, as "sitting on the last identifier". D444's own worked
 * example is exactly that: `probe ` answered `kind: 'probe'` with `prefix: 'probe'`, so the three
 * candidates offered were `probe mutating`/`probe oversized`/`probe traversal` and accepting one
 * wrote `probe probe mutating`. The probe character resolves it structurally — with `probe _`
 * present, the parser walks past `probe` and reaches the sub-clause guard, which is where the
 * cursor genuinely is.
 *
 * That widening also closes the same hole in the test dialect, where it had simply never produced a
 * wrong answer: a cursor after `expect status ` used to return `null` because the matcher guard
 * requires an `ident` and found the synthetic `newline`. It now offers the matcher list. Strictly
 * more answers, and each one derived by the same rule rather than invented.
 *
 * Deliberately not generalised to column 0 (D278). Indentation means "inside a block"; a blank line
 * at the left margin is at declaration position, which is not one of the instrumented productions,
 * and answering there would be inventing a result rather than deriving one. That rule survives
 * `M137a` unchanged even though the config dialect *does* instrument its top level: a line with no
 * indentation at all fails the `line.length === 0` test below and never reaches the probe. So a
 * config file offers its five directives to someone who has typed a letter, and offers nothing on a
 * wholly empty line — the same behaviour, from the same rule, in the dialect whose left margin
 * happens to be a production.
 *
 * Takes its parser as a parameter (`M137a`, D444) rather than closing over `parseForCompletion`,
 * because the probe has to be re-parsed in the dialect the caller asked about; the old form would
 * have answered every blank line in a `tflw.config` with the test grammar's opinion of it.
 */
function resolveAtUntypedCursor(truncated: string, parseFor: ParseFor): CompletionContext | null {
  const line = truncated.slice(truncated.lastIndexOf('\n') + 1);
  if (line.length === 0 || !/\s$/.test(line)) return null;
  const { tokens } = lex(truncated + BLANK_LINE_PROBE);
  const ctx = parseFor(tokens);
  // `prefix` must go back to empty: the user typed nothing, so nothing may be filtered out. Leaving
  // the probe character in would return only the candidates starting with it — which, for `_`, is
  // none, turning one empty list into a differently-empty list.
  return ctx ? { ...ctx, prefix: '' } : null;
}
