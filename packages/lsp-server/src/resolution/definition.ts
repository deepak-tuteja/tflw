// Go-to-definition (PLAN_M13_LSP.md Phase 2, design decision 5): a pure function over an
// already-parsed `Program` + its `SymbolTable` (packages/lang's `collectSymbols`). Cross-file
// resolution — jumping into `tflw.config` for a session, or into an imported `.tflw` file / a
// `use`d JS/TS helper for a call — needs file I/O this package doesn't do in Phase 2, so those
// cases come back as a marker for `packages/lsp-server`'s Phase 3 I/O layer to resolve.

import type { Program, SymbolTable } from '@tflw/lang';
import type { Span } from '@tflw/lang';
import { spanContains } from './findNodeAtOffset.js';

export type DefinitionResult =
  | { readonly kind: 'local'; readonly span: Span }
  | { readonly kind: 'config-session'; readonly name: string }
  | { readonly kind: 'imported-call'; readonly name: string; readonly importPaths: readonly string[]; readonly usePaths: readonly string[] };

/**
 * Find where the identifier at `offset` is defined. A ref that already resolved locally
 * (`symbols.ts`'s `defSpan`, set for `let`/`capture`/param bindings and in-file action calls)
 * jumps straight there. An unresolved `session` ref means "look in this project's `tflw.config`"
 * (decision A); an unresolved `action`-kind ref means "look in one of this file's `import`s, or
 * fall back to line 1 of a `use`d helper module" (decision 5) — both left for the caller to
 * actually read files for. Clicking directly on a definition (not a ref) jumps to itself, matching
 * common LSP behavior.
 */
export function findDefinition(program: Program, table: SymbolTable, offset: number): DefinitionResult | null {
  const ref = table.refs.find((r) => spanContains(r.span, offset));
  if (ref) {
    if (ref.defSpan) return { kind: 'local', span: ref.defSpan };
    if (ref.kind === 'session') return { kind: 'config-session', name: ref.name };
    if (ref.kind === 'action') {
      return {
        kind: 'imported-call',
        name: ref.name,
        importPaths: program.imports.map((i) => i.path.value),
        usePaths: program.uses.map((u) => u.path.value),
      };
    }
    return null; // an unresolved `variable`/`param` ref — shouldn't occur in a checker-clean file
  }
  const def = table.defs.find((d) => spanContains(d.span, offset));
  if (def) return { kind: 'local', span: def.span };
  return null;
}
