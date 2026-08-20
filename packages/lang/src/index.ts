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
export { RUNTIME_RULES, type RuntimeRule, type Decidability } from './conformance.js';
export { lex, type LexResult } from './lexer.js';
export {
  parse as parseTokens,
  parseConfig as parseConfigTokens,
  parseForCompletion,
  parseConfigForCompletion,
  parseStringParts,
  // `M125e`/D277 — exported so `spec-data.ts`'s `STEP_KEYWORDS` can be asserted against the list
  // the parser actually dispatches on, rather than against prose.
  STATEMENT_KEYWORDS,
  RETIRED_STATEMENT_KEYWORDS,
  // `M147b`/`M142-01` — the one table every refusal site reads. Exported so the guards can hold the
  // colouring pass, the GRAMMAR coverage floor and `migrate`'s termination argument against it
  // rather than against three restatements of it.
  REFUSED_SPELLINGS,
  REFUSED_WORDS,
  type RefusedWord,
  type RefusedSpelling,
  // `M137a`/D444 — the same arrangement for the config dialect: `CONFIG_KEYWORDS` is asserted
  // against these, and completion filters through `configKeyAllowedIn` rather than restating which
  // keys belong in which block.
  CONFIG_KEYS,
  PROBE_SUB_CLAUSES,
  configKeyAllowedIn,
  type ConfigBlockKind,
  type ParseResult,
  type ConfigResult,
  type CompletionKind,
  type CompletionContext,
} from './parser.js';
export {
  checkProgram,
  type ProgramCheckOptions,
  type KnownAction,
  validateConfig,
  checkServices,
  checkSessionBody,
  checkSessionServices,
  checkAllowHostsCoversBaseUrls,
  checkDataTables,
  checkSessions,
  checkActionDecls,
  checkUnknownVariables,
  checkRequestAssertions,
  checkWorkloadTests,
  checkCalls,
  checkResponseScopes,
  checkValueSubjects,
  checkMatcherSubjects,
  checkReferencedFiles,
  checkImportsParse,
  checkActionCycles,
  checkBaseUrls,
  checkSnapshotMasks,
  checkCapturableSubjects,
  checkLiteralOperands,
  checkHoldWindows,
  checkAbsoluteUrls,
  checkAuthorizedTargets,
  checkPublicTargets,
  checkAuthzAssertions,
  identityCensus,
  type IdentityCensus,
  RESERVED_PRINCIPAL,
  DEMO_BASE_URL,
  DEMO_SCHEME,
  type EnvBaseUrls,
  type EnvTimeouts,
  type EnvAllowHosts,
  type EnvAuthorizedTargets,
  collectFileReferences,
  collectConfigFileReferences,
  fileReferenceDrift,
  type FileReference,
} from './checker.js';
export { hostMatchesAllowPattern } from './allowHostsPattern.js';
// M131a/D338 — exported for `@tflw/runtime`, which asks the same question of a URL the checker
// could not predict. The two halves of `TF065` must classify identically or the gate means one
// thing at `tflw check` and another at the socket; one function, two callers, no second table.
export { classifyAddress, type AddressClass } from './addressClass.js';
// M125b1 (`FU-18`, D265) — exported for `@tflw/runtime`, which must agree with the lexer about what
// "absolute" means or it will concatenate a base URL onto something the lexer already accepted as a
// whole address. Same reason `hostMatchesAllowPattern` is exported one line above.
export { ABSOLUTE_URL_START, isAbsoluteUrl, absoluteUrlHost } from './absoluteUrl.js';
// M124/D233 — the operand tests `TF054` and the runtime's own `throw`s share. Exported because
// `@tflw/runtime` is the other caller: `eval.ts`'s `applyTransform` imports these rather than
// keeping a second copy of what counts as decodable.
export { isDecodable, isDecodableHex, isDecodableBase64, isDecodablePercentEncoding, regexCompiles, regexCompileError } from './literalValidity.js';
export { collectSymbols, collectConfigSymbols, findIdentifierSpans, type SymbolKind, type SymbolDef, type SymbolRef, type SymbolTable } from './symbols.js';
export { getCompletionContext, getConfigCompletionContext } from './completion.js';
export { collectSemanticTokens, type SemanticToken, type SemanticTokenType, type Dialect } from './semanticTokens.js';
export { detectReuse, renderCallSiteReplacement, importInsertionOffset, type SuiteEntry, type ReuseHint, type ReuseOccurrence } from './reuse.js';
export { collectMigrations, applyMigrations, type MigrationEdit } from './migrate.js';

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
