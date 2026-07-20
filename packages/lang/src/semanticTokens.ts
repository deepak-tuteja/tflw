// LSP semantic tokens (post-M13 follow-up, PLAN.md decision 105): closes a coloring gap the static
// `syntaxes/tflw.tmLanguage.json` grammar structurally can't — matcher/operator words and numeric
// literals ARE tagged correctly by that grammar, but VS Code's own default theme defines no color
// rule for their scopes (`keyword.operator`/`constant.numeric`), so they render unstyled; and
// object-literal field keys / variable / parameter names can never be grammar-colored at all since
// they're arbitrary user-chosen text, not fixed vocabulary. Semantic tokens sidestep both: VS Code
// colors them from its own rich built-in default palette, independent of the active theme.
//
// Two independent passes, merged and sorted by start offset at the end (`SemanticTokensBuilder`
// requires strictly ascending push order):
//
//   1. AST-derived, from the already-computed `SymbolTable` — zero new AST walking. Covers
//      variable/parameter/action names in both bare and string/path-interpolation position for
//      free, since `collectSymbols`'s spans are already precise there.
//   2. Lexer-driven — a single flat lex of the whole document, classifying `ident`/`number` tokens
//      by wordlist membership (mirroring tflw.tmLanguage.json's own keyword lists — same
//      independent-copy tradeoff already accepted for that file, since `parser.ts` doesn't
//      centralize most of these into exported arrays) plus an exact (not heuristic) colon-lookahead
//      for object-literal field keys, reusing the same lookahead `parser.ts`'s own object-field
//      parsing uses (`colon` has no other role in this grammar).

import { lex } from './lexer.js';
import type { Span } from './token.js';
import type { SymbolKind, SymbolTable } from './symbols.js';

export type SemanticTokenType = 'keyword' | 'operator' | 'type' | 'function' | 'number' | 'variable' | 'parameter' | 'property';

export interface SemanticToken {
  readonly span: Span;
  readonly type: SemanticTokenType;
}

/** Statement keywords + HTTP methods (tflw.tmLanguage.json's `keywords-statement` + `http-request`). */
const KEYWORDS = new Set([
  'test', 'action', 'before', 'after', 'session', 'import', 'use', 'api', 'expect', 'check', 'let', 'capture',
  'wait', 'until', 'give', 'require', 'env', 'default', 'defaults', 'workers', 'report', 'timeout', 'retry',
  'with', 'each', 'from', 'as', 'without', 'redirects', 'upload', 'form', 'header', 'body',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH',
]);

/** Matcher/comparison words (tflw.tmLanguage.json's `keywords-matcher`). */
const OPERATORS = new Set([
  'equals', 'contains', 'matches', 'subset', 'has', 'is', 'not', 'count', 'value', 'greater', 'less', 'than',
  'visible', 'hidden', 'enabled', 'disabled', 'checked', 'any', 'all', 'connects', 'fails', 'matching',
]);

/** Subject words (tflw.tmLanguage.json's `keywords-subject`). */
const TYPES = new Set(['status', 'duration', 'text', 'request']);

/** Generator words (tflw.tmLanguage.json's `keywords-generator`). */
const FUNCTIONS = new Set([
  'unique', 'random', 'like', 'of', 'number', 'decimal', 'date', 'in', 'past', 'future', 'between', 'and',
  'string', 'email', 'today', 'now', 'format', 'uuid', 'password', 'base64', 'hex', 'url', 'encode', 'decode',
]);

/** Duration unit suffixes (`parser.ts`'s `DURATION_UNITS` + the bare `ms`/`h` forms the lexer splits off). */
const DURATION_UNITS = new Set(['ms', 's', 'm', 'h']);

function spanLength(span: Span): number {
  return span.end.offset - span.start.offset;
}

/** Resolve a ref's *actual* def kind — `symbols.ts` tags every ref `kind: 'variable'` regardless of
 * whether it points at a variable or a param def (only defs distinguish the two), so a ref's true
 * kind has to come from looking its `defSpan` up against the def list. */
function refSemanticType(refKind: SymbolKind, defSpan: Span | undefined, defKindByOffset: ReadonlyMap<number, SymbolKind>): SemanticTokenType | null {
  const kind = defSpan ? (defKindByOffset.get(defSpan.start.offset) ?? refKind) : refKind;
  return symbolKindToTokenType(kind);
}

function symbolKindToTokenType(kind: SymbolKind): SemanticTokenType | null {
  switch (kind) {
    case 'variable':
      return 'variable';
    case 'param':
      return 'parameter';
    case 'action':
    case 'importedAction':
      return 'function';
    case 'session':
      return null; // sessions already get grammar coloring parity via `as`/keyword handling; not part of this pass
  }
}

export function collectSemanticTokens(source: string, symbols: SymbolTable): readonly SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const claimed = new Set<number>();
  const defKindByOffset = new Map<number, SymbolKind>();
  for (const def of symbols.defs) defKindByOffset.set(def.span.start.offset, def.kind);

  for (const def of symbols.defs) {
    const type = symbolKindToTokenType(def.kind);
    if (!type) continue;
    tokens.push({ span: def.span, type });
    claimed.add(def.span.start.offset);
  }
  for (const ref of symbols.refs) {
    const type = refSemanticType(ref.kind, ref.defSpan, defKindByOffset);
    if (!type) continue;
    tokens.push({ span: ref.span, type });
    claimed.add(ref.span.start.offset);
  }

  const { tokens: lexTokens } = lex(source);
  for (let i = 0; i < lexTokens.length; i++) {
    const tok = lexTokens[i]!;
    if (tok.type === 'number') {
      const next = lexTokens[i + 1];
      if (next && next.type === 'ident' && DURATION_UNITS.has(next.value) && next.span.start.offset === tok.span.end.offset) {
        tokens.push({ span: { start: tok.span.start, end: next.span.end }, type: 'number' });
        i++;
      } else {
        tokens.push({ span: tok.span, type: 'number' });
      }
      continue;
    }
    if (tok.type !== 'ident') continue;
    if (claimed.has(tok.span.start.offset)) continue;

    const next = lexTokens[i + 1];
    if (next && next.type === 'colon') {
      tokens.push({ span: tok.span, type: 'property' });
      continue;
    }
    if (KEYWORDS.has(tok.value)) tokens.push({ span: tok.span, type: 'keyword' });
    else if (OPERATORS.has(tok.value)) tokens.push({ span: tok.span, type: 'operator' });
    else if (TYPES.has(tok.value)) tokens.push({ span: tok.span, type: 'type' });
    else if (FUNCTIONS.has(tok.value)) tokens.push({ span: tok.span, type: 'function' });
  }

  tokens.sort((a, b) => a.span.start.offset - b.span.start.offset);
  return tokens.filter((t) => spanLength(t.span) > 0);
}
