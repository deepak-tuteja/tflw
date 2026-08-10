// Protocol wiring (PLAN_M13_LSP.md Phase 3): `startServer()` speaks the Language Server Protocol
// over a pair of Node streams — real stdio by default (how `tflw lsp`, spawned as a child process,
// is actually reached per decision 17.2/17.4), or an in-memory pair for `test/protocol.test.ts`
// (decision 17.8). Every handler here is a thin adapter: convert an LSP position to an offset,
// call one of Phase 2's pure `resolution/*.ts` functions (or Phase 3's I/O-backed `workspace/*.ts`
// ones for cross-file cases), convert the result back to LSP shapes. No language logic lives here.
//
// AST `Span`s already carry 1-based `line`/`column` (the lexer computes them once, at parse time) —
// converting one to an LSP 0-based `Range` is pure number math (`toLspRange` below), the same
// approach `packages/vscode/src/lib.ts`'s `spanToZeroBasedRange` already uses for the old
// spawn-based diagnostics path. The one direction that genuinely needs `TextDocument`'s own
// `offsetAt` (not simple math) is incoming LSP `Position` → our offset, since UTF-16 code-unit
// handling around multi-byte characters isn't just line/column arithmetic — `TextDocuments`'
// tracked buffer for the *currently open* document supplies that; other project files touched only
// during cross-file resolution never need this direction (we only ever read *their* AST spans,
// already line/column-tagged, never receive an LSP position for them).

import { createConnection, TextDocuments, TextDocumentSyncKind, DiagnosticSeverity, SemanticTokensBuilder, ResponseError, LSPErrorCodes } from 'vscode-languageserver/node';
import type {
  Diagnostic as LspDiagnostic,
  Location,
  Range,
  Hover,
  CompletionItem,
  SignatureHelp,
  WorkspaceEdit,
  TextEdit,
  SemanticTokens,
  SemanticTokensLegend,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Diagnostic as TflwDiagnostic, Span } from '@tflw/lang';
import { spanContains } from './resolution/findNodeAtOffset.js';
import { findDefinition } from './resolution/definition.js';
import { getHover } from './resolution/hover.js';
import { getCompletions, variablesInScopeAt } from './resolution/completion.js';
import { findRenameTargets } from './resolution/rename.js';
import { getSignatureHelp } from './resolution/signatureHelp.js';
import { getCompletionContext, collectSemanticTokens, lex } from '@tflw/lang';

// Mirrors `syntaxes/tflw.tmLanguage.json`'s intent but sourced from `@tflw/lang`'s
// `collectSemanticTokens` (PLAN.md decision 105) — lets VS Code color these using its own
// built-in default semantic palette, independent of whatever the active theme does or doesn't
// define for the TextMate scopes the static grammar alone can offer.
const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
  tokenTypes: ['keyword', 'operator', 'type', 'function', 'number', 'variable', 'parameter', 'property'],
  tokenModifiers: [],
};
const SEMANTIC_TOKEN_TYPE_INDEX = new Map(SEMANTIC_TOKENS_LEGEND.tokenTypes.map((t, i) => [t, i]));
import { DocumentStore } from './workspace/documentStore.js';
import { loadProjectConfig } from './workspace/configResolution.js';
import { CrossFileResolver } from './workspace/crossFile.js';
import { findCrossFileRenameEdits } from './workspace/workspaceIndex.js';

function toLspRange(span: Span): Range {
  return {
    start: { line: span.start.line - 1, character: span.start.column - 1 },
    end: { line: span.end.line - 1, character: span.end.column - 1 },
  };
}

function toLspLocation(uri: string, span: Span): Location {
  return { uri, range: toLspRange(span) };
}

const LINE_ONE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

function pathToUri(absPath: string): string {
  return pathToFileURL(absPath).href;
}

/** M122 (`B5-06`, D213/D214). Not every document the client opens is a file on disk: VS Code routes
 * unsaved buffers here as `untitled:Untitled-1`, and `fileURLToPath` throws `ERR_INVALID_URL_SCHEME`
 * on those. That throw used to happen inside `onDidOpen`, a *notification* handler, so
 * `vscode-jsonrpc` swallowed it — the document never reached the store, no error reached the client,
 * and because `store.update`/`scheduleDiagnostics` both no-op on an unknown uri, the buffer stayed
 * dead for the rest of the session. A pathless document is now a first-class case rather than a
 * crash: it gets everything that reads only its own text, and loses only what genuinely needs a
 * location on disk (D215). */
function uriToPath(uri: string): string | undefined {
  return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
}

/** `B5-07`/D216 — a rename's `newName` has to lex as exactly one identifier, checked with the real
 * lexer rather than a regex written here, so this cannot drift from the grammar the parser accepts
 * (the `M60` rule: the server shares the CLI's entry points instead of reimplementing them).
 *
 * Keywords are deliberately *allowed* (D217). tflw's keywords are contextual — the lexer emits
 * `ident` for all of them, and `let status = unique("t")` checks clean — so a keyword blocklist
 * would refuse renames the language itself accepts. The lexer rule is the whole rule.
 *
 * Returns the reason a name is unusable, or `undefined` when it is fine. */
function renameNameProblem(newName: string): string | undefined {
  const rule = 'a name starts with a letter or `_` and continues with letters, digits or `_`';
  const { tokens, diagnostics } = lex(newName);
  const significant = tokens.filter((t) => t.type !== 'newline' && t.type !== 'eof');
  if (significant.length === 0) return `a name cannot be empty — ${rule}.`;
  // The token must also *be* the whole string. "one ident token" alone is not enough: the lexer
  // treats leading whitespace as indentation and ignores trailing whitespace, so `"  ok  "` lexes
  // to a single clean `ident` and would be accepted — then spliced verbatim into every span,
  // including interpolations, turning `{orderId}` into `{  ok  }`. Comparing the token's text to
  // the input closes that without adding a second, drifting notion of what a name is.
  if (diagnostics.length > 0 || significant.length > 1 || significant[0]!.type !== 'ident' || significant[0]!.value !== newName) {
    return `\`${newName}\` is not a usable name — ${rule}.`;
  }
  return undefined;
}

function toLspDiagnostic(d: TflwDiagnostic): LspDiagnostic {
  return {
    range: toLspRange(d.span),
    // A separate line, not a trailing `(hint)` parenthetical — matches the CLI reporter's own
    // `= help:` line convention (diagnostic.ts), and avoids doubling up with VS Code's own
    // hover suffix (`message source(code)`), which would otherwise glue two parentheticals together.
    message: d.hint ? `${d.message}\n${d.hint}` : d.message,
    severity: d.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    code: d.code,
    source: 'tflw',
  };
}

export interface StartServerOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

export function startServer(options: StartServerOptions = {}): void {
  const connection = createConnection(options.input ?? process.stdin, options.output ?? process.stdout);
  const documents = new TextDocuments(TextDocument);
  const store = new DocumentStore();
  const crossFile = new CrossFileResolver();
  let envSetting: string | undefined;

  connection.onInitialize((params) => {
    const initOptions = params.initializationOptions as { env?: string } | undefined;
    envSetting = initOptions?.env;
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        hoverProvider: true,
        definitionProvider: true,
        completionProvider: { triggerCharacters: [' '] },
        // `{ prepareProvider: true }` rather than a bare `true` (M122, `B5-07`, D219): without the
        // prepare step the client picks the rename range with its own generic word pattern, which
        // does not know tflw's identifier rule, and there is nowhere to reject an invalid *position*
        // before the rename box opens.
        renameProvider: { prepareProvider: true },
        signatureHelpProvider: { triggerCharacters: ['(', ','] },
        semanticTokensProvider: { legend: SEMANTIC_TOKENS_LEGEND, full: true },
      },
    };
  });

  connection.onDidChangeConfiguration((change) => {
    const settings = change.settings as { tflw?: { env?: string } } | undefined;
    if (settings?.tflw?.env !== undefined) envSetting = settings.tflw.env;
  });

  documents.onDidOpen((e) => {
    store.open(e.document.uri, uriToPath(e.document.uri), e.document.getText());
    void publishDiagnostics(e.document.uri);
  });

  documents.onDidChangeContent((e) => {
    store.update(e.document.uri, e.document.getText());
    store.scheduleDiagnostics(e.document.uri, envSetting, (diagnostics) => {
      connection.sendDiagnostics({ uri: e.document.uri, diagnostics: diagnostics.map(toLspDiagnostic) });
    });
  });

  documents.onDidClose((e) => {
    store.close(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  async function publishDiagnostics(uri: string): Promise<void> {
    const analysis = await store.analyze(uri, envSetting);
    if (analysis) connection.sendDiagnostics({ uri, diagnostics: analysis.diagnostics.map(toLspDiagnostic) });
  }

  connection.onHover(async (params): Promise<Hover | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const analysis = await store.analyze(params.textDocument.uri, envSetting);
    if (!analysis) return null;
    const offset = doc.offsetAt(params.position);
    const root = analysis.program ?? analysis.config;
    if (!root) return null;
    const result = getHover(root, analysis.symbols, offset, analysis.diagnostics);
    if (!result) return null;
    return { contents: { kind: 'markdown', value: result.contents }, range: toLspRange(result.span) };
  });

  connection.onDefinition(async (params): Promise<Location | null> => {
    const doc = documents.get(params.textDocument.uri);
    const info = store.get(params.textDocument.uri);
    if (!doc || !info) return null;
    const analysis = await store.analyze(params.textDocument.uri, envSetting);
    if (!analysis) return null;
    const offset = doc.offsetAt(params.position);

    if (info.kind === 'config') {
      // Config-dialect go-to-def is same-file only (a session body's variable refs resolving to
      // their own `bound` def) — sessions themselves have nothing further to jump to.
      const ref = analysis.symbols.refs.find((r) => spanContains(r.span, offset));
      return ref?.defSpan ? toLspLocation(params.textDocument.uri, ref.defSpan) : null;
    }
    if (!analysis.program) return null;

    const result = findDefinition(analysis.program, analysis.symbols, offset);
    if (!result) return null;
    if (result.kind === 'local') return toLspLocation(params.textDocument.uri, result.span);

    if (result.kind === 'config-session') {
      if (!info.root) return null;
      const project = await loadProjectConfig(info.root, envSetting).catch(() => undefined);
      const def = project?.symbols.defs.find((d) => d.kind === 'session' && d.name === result.name);
      return def ? toLspLocation(pathToUri(project!.configPath), def.span) : null;
    }

    // result.kind === 'imported-call'
    // No `baseDir` means a pathless buffer (D214/D215) — a relative `import` has nothing to resolve
    // against, so there is no imported definition to jump to.
    if (!analysis.baseDir) return null;
    const located = await crossFile.resolveImportedAction(analysis.baseDir, result.importPaths, result.usePaths, result.name);
    if (!located) return null;
    const uri = pathToUri(located.absPath);
    return located.span ? toLspLocation(uri, located.span) : { uri, range: LINE_ONE };
  });

  connection.onCompletion(async (params): Promise<CompletionItem[]> => {
    const doc = documents.get(params.textDocument.uri);
    const info = store.get(params.textDocument.uri);
    if (!doc || !info || info.kind !== 'test') return [];
    const offset = doc.offsetAt(params.position);
    const ctx = getCompletionContext(doc.getText(), offset);
    if (!ctx) return [];

    let knownSessions: readonly string[] | undefined;
    if (ctx.kind === 'session' && info.root) {
      const project = await loadProjectConfig(info.root, envSetting).catch(() => undefined);
      knownSessions = project?.resolved ? Array.from(project.resolved.sessions.keys()) : undefined;
    }
    let knownVariables: readonly string[] | undefined;
    if (ctx.kind === 'subject') {
      // Needs the symbol table, so it goes through `analyze` (as `onHover`/`onDefinition` do)
      // rather than `store.get`, which only carries the document's identity.
      const analysis = await store.analyze(params.textDocument.uri, envSetting);
      if (analysis?.program) knownVariables = variablesInScopeAt(analysis.program, analysis.symbols, offset);
    }
    return getCompletions(ctx, { knownSessions, knownVariables }).map((c) => ({
      label: c.label,
      ...(c.detail ? { detail: c.detail } : {}),
      ...(c.filterText ? { filterText: c.filterText } : {}),
    }));
  });

  connection.onSignatureHelp(async (params): Promise<SignatureHelp | null> => {
    const doc = documents.get(params.textDocument.uri);
    const info = store.get(params.textDocument.uri);
    if (!doc || !info || info.kind !== 'test') return null;
    const analysis = await store.analyze(params.textDocument.uri, envSetting);
    if (!analysis?.program) return null;
    const offset = doc.offsetAt(params.position);
    const result = getSignatureHelp(analysis.program, offset);
    if (!result) return null;

    let label = result.label;
    let parameters = result.parameters;
    // Same as go-to-definition: without a `baseDir` the imported signature cannot be looked up, and
    // the positional-label fallback below is the answer (D215).
    if (result.unresolvedCallName && analysis.baseDir) {
      const located = await crossFile.resolveImportedAction(analysis.baseDir, analysis.program.imports.map((i) => i.path.value), analysis.program.uses.map((u) => u.path.value), result.unresolvedCallName);
      if (located?.params) {
        parameters = located.params;
        label = `${result.unresolvedCallName}(${parameters.join(', ')})`;
      }
    }
    return {
      signatures: [{ label, parameters: parameters.map((p) => ({ label: p })) }],
      activeSignature: 0,
      activeParameter: result.activeParameter,
    };
  });

  /** Shared by `onPrepareRename` and `onRenameRequest` so the two can never disagree about what is
   * renameable — a prepare that says yes followed by a rename that returns `null` is worse than
   * either answer alone. */
  async function renameTargetAt(uri: string, position: { line: number; character: number }) {
    const doc = documents.get(uri);
    const info = store.get(uri);
    if (!doc || !info) return undefined;
    const analysis = await store.analyze(uri, envSetting);
    if (!analysis) return undefined;
    const offset = doc.offsetAt(position);
    const result = findRenameTargets(analysis.symbols, offset);
    return result ? { info, offset, result } : undefined;
  }

  // `textDocument/prepareRename` (M122, D219) — previously `Unhandled method`. Answers two things
  // the rename request cannot: which span the editor should pre-select (its own word pattern would
  // guess), and whether this position is renameable *at all*, before the user types a replacement.
  connection.onPrepareRename(async (params): Promise<{ range: Range; placeholder: string } | null> => {
    const found = await renameTargetAt(params.textDocument.uri, params.position);
    if (!found) return null;
    // The occurrence under the cursor, not the symbol's first — the editor pre-selects this exact
    // range, and every span in `result.spans` carries the same text but a different location.
    const span = found.result.spans.find((s) => spanContains(s, found.offset));
    if (!span) return null;
    return { range: toLspRange(span), placeholder: found.result.name };
  });

  connection.onRenameRequest(async (params): Promise<WorkspaceEdit | ResponseError<void> | null> => {
    // `B5-07`/D216 — validated before any edit is built, and before the cross-file index is walked.
    // An unusable name used to be spliced verbatim into every span in every file that references
    // the symbol, so a single empty rename box could leave a whole project unparseable.
    const problem = renameNameProblem(params.newName);
    // A `ResponseError`, not `null` (D218): `null` already means "nothing renameable sits here", and
    // the client answers that with a generic message of its own. LSP prescribes an error whose
    // `message` the editor shows verbatim, which is the only way the author learns *why*.
    if (problem) return new ResponseError(LSPErrorCodes.RequestFailed, problem);

    const found = await renameTargetAt(params.textDocument.uri, params.position);
    if (!found) return null;
    const { info, result } = found;

    const changes: Record<string, TextEdit[]> = {
      [params.textDocument.uri]: result.spans.map((span) => ({ range: toLspRange(span), newText: params.newName })),
    };

    // `info.absPath` is `undefined` for a pathless buffer, and so is `info.root` — an unsaved file
    // is in no project, so there is no cross-file half to walk (D215).
    if (result.crossFile && info.root && info.absPath) {
      const crossEdits = await findCrossFileRenameEdits(info.root, result.kind, result.name, info.absPath);
      for (const edit of crossEdits) {
        changes[pathToUri(edit.absPath)] = edit.spans.map((span) => ({ range: toLspRange(span), newText: params.newName }));
      }
    }

    return { changes };
  });

  // Registered via `connection.languages.semanticTokens`, not a flat `connection.onXxx` like every
  // other handler above — that's how this one LSP feature is namespaced in vscode-languageserver.
  connection.languages.semanticTokens.on(async (params): Promise<SemanticTokens | null> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const analysis = await store.analyze(params.textDocument.uri, envSetting);
    if (!analysis) return null;

    const builder = new SemanticTokensBuilder();
    for (const t of collectSemanticTokens(doc.getText(), analysis.symbols)) {
      builder.push(t.span.start.line - 1, t.span.start.column - 1, t.span.end.offset - t.span.start.offset, SEMANTIC_TOKEN_TYPE_INDEX.get(t.type)!, 0);
    }
    return builder.build();
  });

  documents.listen(connection);
  connection.listen();
}
