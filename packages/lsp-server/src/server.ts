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

import { createConnection, TextDocuments, TextDocumentSyncKind, DiagnosticSeverity, SemanticTokensBuilder } from 'vscode-languageserver/node';
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
import { getCompletions } from './resolution/completion.js';
import { findRenameTargets } from './resolution/rename.js';
import { getSignatureHelp } from './resolution/signatureHelp.js';
import { getCompletionContext, collectSemanticTokens } from '@tflw/lang';

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
        renameProvider: true,
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
    store.open(e.document.uri, fileURLToPath(e.document.uri), e.document.getText());
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
    return getCompletions(ctx, { knownSessions }).map((c) => ({ label: c.label, ...(c.detail ? { detail: c.detail } : {}) }));
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
    if (result.unresolvedCallName) {
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

  connection.onRenameRequest(async (params): Promise<WorkspaceEdit | null> => {
    const doc = documents.get(params.textDocument.uri);
    const info = store.get(params.textDocument.uri);
    if (!doc || !info) return null;
    const analysis = await store.analyze(params.textDocument.uri, envSetting);
    if (!analysis) return null;
    const offset = doc.offsetAt(params.position);
    const result = findRenameTargets(analysis.symbols, offset);
    if (!result) return null;

    const changes: Record<string, TextEdit[]> = {
      [params.textDocument.uri]: result.spans.map((span) => ({ range: toLspRange(span), newText: params.newName })),
    };

    if (result.crossFile && info.root) {
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
