// Read-only mirror of packages/runtime/src/interpreter.ts's `buildRegistry` import resolution
// (PLAN_M13_LSP.md Phase 3, design decision 5) — minus execution, plus a path+mtime cache the
// runtime doesn't need (a one-shot CLI run never re-resolves the same import twice) but a
// long-lived server does (every keystroke could otherwise re-read and re-parse every imported
// file). Resolves an `action`-kind ref's cross-file target: a real `ActionDecl` span (+ its
// parameter names, for signature help) in one of `program.imports`' `.tflw` files, or — when no
// import declares it — a line-1 fallback into the first `use`d JS/TS helper module (`@tflw/lang`
// doesn't parse TypeScript, so real symbol resolution there is out of scope, decision 5).

import { readFile, stat as fileStat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { parseSource, collectSymbols, type Program, type Span, type SymbolTable } from '@tflw/lang';

interface CacheEntry {
  readonly mtimeMs: number;
  readonly program: Program;
  readonly symbols: SymbolTable;
}

export interface ImportedActionLocation {
  readonly absPath: string;
  /** The action's name span in the defining file — absent for the `use`d-helper fallback, where
   * only the file itself (line 1) is known. */
  readonly span?: Span;
  /** Real parameter names, when resolved against a `.tflw` import; absent for the helper fallback. */
  readonly params?: readonly string[];
}

/** One instance lives for the server's lifetime (`server.ts` holds it), so its cache persists
 * across requests — the whole point of it existing over a stateless function. */
export class CrossFileResolver {
  private readonly cache = new Map<string, CacheEntry>();

  private async load(absPath: string): Promise<CacheEntry | null> {
    let stats;
    try {
      stats = await fileStat(absPath);
    } catch {
      return null;
    }
    const cached = this.cache.get(absPath);
    if (cached && cached.mtimeMs === stats.mtimeMs) return cached;
    let text: string;
    try {
      text = await readFile(absPath, 'utf8');
    } catch {
      return null;
    }
    const parsed = parseSource(text);
    const entry: CacheEntry = { mtimeMs: stats.mtimeMs, program: parsed.program, symbols: collectSymbols(parsed.program, text) };
    this.cache.set(absPath, entry);
    return entry;
  }

  /** Searches `importPaths` in order (first declaring file wins, matching `buildRegistry`'s
   * duplicate-action-name error being the only other tiebreak rule); falls back to the first
   * `use`d path's line 1 when no import declares `name`. `null` when neither list resolves it
   * (a checker-clean file's unresolved `action` ref should always find something reachable here,
   * since `checkUnknownVariables`... — actually action calls aren't checked against imports at
   * checker time; a genuinely undeclared action is possible and just returns `null`). */
  async resolveImportedAction(baseDir: string, importPaths: readonly string[], usePaths: readonly string[], name: string): Promise<ImportedActionLocation | null> {
    for (const p of importPaths) {
      const abs = resolvePath(baseDir, p);
      const entry = await this.load(abs);
      if (!entry) continue;
      const actionDecl = entry.program.actions.find((a) => a.name === name);
      if (!actionDecl) continue;
      const def = entry.symbols.defs.find((d) => d.kind === 'action' && d.name === name);
      return { absPath: abs, ...(def ? { span: def.span } : {}), params: actionDecl.params };
    }
    if (usePaths.length > 0) return { absPath: resolvePath(baseDir, usePaths[0]!) };
    return null;
  }
}
