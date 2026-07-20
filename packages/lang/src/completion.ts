// Grammar-shape autocomplete context (PLAN_M13_LSP.md decision 17.6): given the full source and a
// cursor offset, determine which of the six instrumented grammar productions (parser.ts) the
// cursor sits in. `packages/lsp-server` combines this with symbol-name candidates (`symbols.ts`)
// and `spec-data.ts` entries to build the actual completion list — this module only answers "what
// production", not "what to suggest".
//
// Known limitation: when the cursor sits on an otherwise-blank line (pure indentation, zero
// characters typed yet — e.g. right after pressing Enter for a brand-new first step in a block),
// the lexer treats that line as blank (lexer.ts's `processLine`) and emits no `indent`/`newline`
// for it, so no guarded production is ever reached and this returns `null`. Once at least one
// character is typed (the dominant real-world trigger — most editors invoke completion per
// keystroke), the truncated line is no longer blank and resolution works normally.

import { lex } from './lexer.js';
import { parseForCompletion } from './parser.js';
import type { CompletionContext } from './parser.js';

export type { CompletionContext, CompletionKind } from './parser.js';

/**
 * Truncate `source` at `cursorOffset`, re-lex, and parse in completion mode. The lexer always
 * emits a trailing `eof` token (lexer.ts) — a cursor sitting where the next token is expected
 * naturally produces one, with zero special-casing. Returns `null` when the cursor isn't in one
 * of the six instrumented production entry points (e.g. mid-token inside an already-complete
 * construct, or the blank-line case above).
 */
export function getCompletionContext(source: string, cursorOffset: number): CompletionContext | null {
  const truncated = source.slice(0, cursorOffset);
  const { tokens } = lex(truncated);
  return parseForCompletion(tokens);
}
