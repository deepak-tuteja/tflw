// @tflw/lang — public API. Pure language front-end (no I/O): source text → tokens → AST +
// diagnostics. A later real LSP wraps exactly this surface (SPEC §14). See GRAMMAR.md for the
// M0 grammar this implements.

import { lex } from './lexer.js';
import { parse as parseTokens, parseConfig as parseConfigTokens } from './parser.js';
import { validateConfig } from './checker.js';
import type { ConfigFile, Program } from './ast.js';
import type { Diagnostic } from './diagnostic.js';

export * from './token.js';
export * from './ast.js';
export * from './diagnostic.js';
export * from './spec-data.js';
export { lex, type LexResult } from './lexer.js';
export {
  parse as parseTokens,
  parseConfig as parseConfigTokens,
  parseForCompletion,
  parseStringParts,
  type ParseResult,
  type ConfigResult,
  type CompletionKind,
  type CompletionContext,
} from './parser.js';
export { validateConfig, checkServices, checkSessionServices, checkDataTables, checkSessions, checkUnknownVariables } from './checker.js';
export { collectSymbols, collectConfigSymbols, findIdentifierSpans, type SymbolKind, type SymbolDef, type SymbolRef, type SymbolTable } from './symbols.js';
export { getCompletionContext } from './completion.js';
export { collectSemanticTokens, type SemanticToken, type SemanticTokenType } from './semanticTokens.js';

export interface ParsedSource {
  readonly program: Program;
  /** Lexer diagnostics followed by parser diagnostics, in source order overall. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface ParsedConfig {
  readonly config: ConfigFile;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Lex and parse `.tflw` source in one step — the primary entry point for the CLI, checker,
 * and future LSP. Never throws for a syntax error: problems come back as `diagnostics` and the
 * (possibly partial) `program` is still returned, thanks to panic-mode recovery.
 */
export function parseSource(source: string): ParsedSource {
  const lexed = lex(source);
  const parsed = parseTokens(lexed.tokens);
  const diagnostics = [...lexed.diagnostics, ...parsed.diagnostics].sort((a, b) => a.span.start.offset - b.span.start.offset);
  return { program: parsed.program, diagnostics };
}

/**
 * Lex, parse, and semantically check `tflw.config` source (the declaration-only dialect, P#27).
 * Never throws — diagnostics come back alongside the (possibly partial) config.
 */
export function parseConfigSource(source: string): ParsedConfig {
  const lexed = lex(source);
  const parsed = parseConfigTokens(lexed.tokens);
  const semantic = validateConfig(parsed.config);
  const diagnostics = [...lexed.diagnostics, ...parsed.diagnostics, ...semantic].sort((a, b) => a.span.start.offset - b.span.start.offset);
  return { config: parsed.config, diagnostics };
}
