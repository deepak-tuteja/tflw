// `M251` `A` (`D1366`) — the file's outline and its folds, as pure functions over what the server
// already has: the parsed AST and symbol table for the outline, the lexer's own offside tokens for
// the folds. The protocol wiring (`server.ts`) only converts spans to LSP ranges.

import { lex, type Program, type ConfigFile, type SymbolTable, type Span } from '@tflw/lang';

export type OutlineKind = 'test' | 'crawl' | 'action' | 'element' | 'hook' | 'session' | 'signer' | 'env';

export interface OutlineItem {
  readonly name: string;
  readonly kind: OutlineKind;
  readonly detail?: string;
  /** The whole declaration. */
  readonly span: Span;
  /** What the editor selects and reveals — the declaration's name where it has one. */
  readonly selectionSpan: Span;
}

const byStart = (a: OutlineItem, b: OutlineItem): number => a.span.start.offset - b.span.start.offset;

/** The name's own span from the symbol table's defs, when the table records one inside `span`;
 * else the declaration's first position (a hook has no name, and a selection must lie inside the
 * declaration's range for the protocol to accept it). */
function nameSpanIn(symbols: SymbolTable, kind: string, name: string, span: Span): Span {
  const def = symbols.defs.find((d) => d.kind === kind && d.name === name && d.span.start.offset >= span.start.offset && d.span.end.offset <= span.end.offset);
  return def?.span ?? { start: span.start, end: span.start };
}

/** A `.tflw` file's top level: tests, crawls, actions, elements and hooks, in file order. */
export function programOutline(program: Program, symbols: SymbolTable): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const t of program.tests) {
    const detail = [t.workload ? 'load' : '', ...t.tags.map((g) => `@${g}`)].filter(Boolean).join(' ');
    out.push({ name: t.name.value, kind: 'test', ...(detail ? { detail } : {}), span: t.span, selectionSpan: t.name.span });
  }
  for (const c of program.crawls ?? []) out.push({ name: c.name.value, kind: 'crawl', detail: 'crawl', span: c.span, selectionSpan: c.name.span });
  for (const a of program.actions) {
    out.push({ name: a.name, kind: 'action', detail: `(${a.params.join(', ')})`, span: a.span, selectionSpan: nameSpanIn(symbols, 'action', a.name, a.span) });
  }
  for (const e of program.elements ?? []) out.push({ name: e.name, kind: 'element', span: e.span, selectionSpan: e.nameSpan });
  for (const h of program.hooks) {
    const name = h.scope === 'file' ? `${h.when} file` : h.when;
    out.push({ name, kind: 'hook', span: h.span, selectionSpan: { start: h.span.start, end: h.span.start } });
  }
  return out.sort(byStart);
}

/** `tflw.config`'s declarations: envs, sessions and signers, in file order. */
export function configOutline(config: ConfigFile, symbols: SymbolTable): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const e of config.envs) {
    out.push({ name: e.name, kind: 'env', ...(e.isDefault ? { detail: 'default' } : {}), span: e.span, selectionSpan: { start: e.span.start, end: e.span.start } });
  }
  for (const s of config.sessions) out.push({ name: s.name, kind: 'session', span: s.span, selectionSpan: nameSpanIn(symbols, 'session', s.name, s.span) });
  for (const s of config.signers ?? []) out.push({ name: s.name, kind: 'signer', span: s.span, selectionSpan: s.nameSpan });
  return out.sort(byStart);
}

export interface Fold {
  /** 0-based, inclusive, as LSP counts them. */
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: 'region' | 'comment';
}

/**
 * Every block the offside rule opens — a test, an action, a hook, a `when`, a session, an env —
 * folds from its header line to its last line. Read off the lexer's `indent`/`dedent` tokens, so a
 * fold is exactly a block the parser sees; no second notion of where a block ends. A run of two or
 * more `#` lines folds as a comment, which is what a tflw file's long header notes want.
 */
export function foldingRanges(source: string): Fold[] {
  const folds: Fold[] = [];
  const { tokens } = lex(source);
  const open: number[] = [];
  let lastCodeLine = -1;
  for (const t of tokens) {
    if (t.type === 'indent') {
      open.push(lastCodeLine);
    } else if (t.type === 'dedent') {
      const start = open.pop();
      if (start !== undefined && start >= 0 && lastCodeLine > start) folds.push({ startLine: start, endLine: lastCodeLine, kind: 'region' });
    } else if (t.type !== 'newline' && t.type !== 'eof') {
      lastCodeLine = t.span.end.line - 1;
    }
  }
  const lines = source.split('\n');
  let run = -1;
  for (let i = 0; i <= lines.length; i++) {
    const isComment = i < lines.length && /^\s*#/.test(lines[i]!);
    if (isComment && run < 0) run = i;
    if (!isComment && run >= 0) {
      if (i - 1 > run) folds.push({ startLine: run, endLine: i - 1, kind: 'comment' });
      run = -1;
    }
  }
  return folds.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}
