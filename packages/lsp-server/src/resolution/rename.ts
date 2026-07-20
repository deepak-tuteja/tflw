// Rename (PLAN_M13_LSP.md Phase 2, design decision 6; PLAN_ENTERPRISE.md decision 17.5 — scoped to
// checker-resolved symbols only: captured variables, session names, imported action names). A pure
// function over one file's `SymbolTable`; cross-file propagation (a session's other test files, an
// imported action's other importers) is `packages/lsp-server`'s Phase 3 project-wide index, not
// this module's job — `crossFile` on the result just flags that more edits may exist elsewhere.

import type { SymbolKind, SymbolTable } from '@tflw/lang';
import type { Span } from '@tflw/lang';
import { spanContains } from './findNodeAtOffset.js';

export interface RenameResult {
  readonly kind: SymbolKind;
  readonly name: string;
  /** Every span to edit within this one file/table. */
  readonly spans: readonly Span[];
  /** True when other files may also reference this symbol (`session`/`action`/`importedAction` —
   * none of these are block-scoped) and need their own edits, found separately (Phase 3). */
  readonly crossFile: boolean;
}

function spansEqual(a: Span, b: Span): boolean {
  return a.start.offset === b.start.offset && a.end.offset === b.end.offset;
}

/**
 * Find every occurrence of the symbol at `offset` that a rename must update. `variable`/`param`
 * are block-scoped (checker.ts's scope model, mirrored by `symbols.ts`) — grouping by the
 * resolved def's *span* (not just its name) keeps two different scopes' same-named bindings from
 * being conflated. `session`/`action`/`importedAction` aren't block-scoped (one project-wide /
 * one file-wide namespace respectively), so those group by `(kind, name)` across the whole table.
 */
export function findRenameTargets(table: SymbolTable, offset: number): RenameResult | null {
  const ref = table.refs.find((r) => spanContains(r.span, offset));
  const def = ref ? undefined : table.defs.find((d) => spanContains(d.span, offset));
  const target = ref ?? def;
  if (!target) return null;

  const { kind, name } = target;
  const spans: Span[] = [];

  if (kind === 'variable' || kind === 'param') {
    const defSpan = ref ? ref.defSpan : def!.span;
    if (!defSpan) return null; // an unresolved ref — shouldn't occur in a checker-clean file
    for (const d of table.defs) if (spansEqual(d.span, defSpan)) spans.push(d.span);
    for (const r of table.refs) if (r.defSpan && spansEqual(r.defSpan, defSpan)) spans.push(r.span);
  } else {
    for (const d of table.defs) if (d.kind === kind && d.name === name) spans.push(d.span);
    for (const r of table.refs) if (r.kind === kind && r.name === name) spans.push(r.span);
  }

  return { kind, name, spans, crossFile: kind === 'session' || kind === 'action' || kind === 'importedAction' };
}
