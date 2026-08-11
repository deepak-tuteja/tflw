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
// `resolveOnBlankLine` below closes it at this boundary rather than in the lexer, whose blank-line
// rule is correct for parsing and is what every other consumer depends on.

import { lex } from './lexer.js';
import { parseForCompletion } from './parser.js';
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
  const truncated = source.slice(0, cursorOffset);
  const { tokens } = lex(truncated);
  return parseForCompletion(tokens) ?? resolveOnBlankLine(truncated);
}

/** A single letter is all it takes to make an indentation-only line non-blank. The probe proves
 * the parser can already answer from this exact cursor position — typing one `c` there yields
 * `check, capture, click, close, cleanup` — so the letter is scaffolding for the lexer, never an
 * answer of our own. `_` is a legal identifier start that leads no keyword, so a stray occurrence
 * cannot read as a partially-typed one. */
const BLANK_LINE_PROBE = '_';

/**
 * The context for a cursor on a whitespace-only line, derived by asking the same question with one
 * character typed and then discarding that character's prefix.
 *
 * Deliberately not generalised to column 0 (D278). Indentation means "inside a block"; a blank line
 * at the left margin is at declaration position, which is not one of the six instrumented
 * productions, and answering there would be inventing a result rather than deriving one.
 */
function resolveOnBlankLine(truncated: string): CompletionContext | null {
  const line = truncated.slice(truncated.lastIndexOf('\n') + 1);
  if (line.length === 0 || /\S/.test(line)) return null;
  const { tokens } = lex(truncated + BLANK_LINE_PROBE);
  const ctx = parseForCompletion(tokens);
  // `prefix` must go back to empty: the user typed nothing, so nothing may be filtered out. Leaving
  // the probe character in would return only the candidates starting with it — which, for `_`, is
  // none, turning one empty list into a differently-empty list.
  return ctx ? { ...ctx, prefix: '' } : null;
}
