// `tflw migrate` (P#38, decision 45's 1.0-gate deliverable): mechanically rewrites a suite past
// checker-flagged deprecations, reusing the same "generate a prepared edit alongside the
// diagnostic, splice widest-first" shape the reuse pass (M6, reuse.ts) already established for
// its own hints. Pure and file-agnostic here — the CLI (`migrateCommand`) owns discovering files,
// running the checker, and writing results; this module only knows how to turn a diagnostic with
// a `deprecation` payload into a source-span edit and apply a batch of them safely.
//
// No checker rule produces a `deprecation`-tagged diagnostic yet (the grammar has been
// additive-only since the first release, decision 45) — this exists ahead of the first real
// deprecation on purpose. See `Diagnostic.deprecation`'s own doc comment for why.

import type { Diagnostic } from './diagnostic.js';

export interface MigrationEdit {
  readonly start: number;
  readonly end: number;
  readonly oldText: string;
  readonly newText: string;
}

/** Every deprecation-tagged diagnostic's mechanical rewrite as a source-span edit, widest-first
 * (descending start offset) — applying one never invalidates another's offset, the same
 * ordering `tflw refactor apply` relies on for its own call-site edits. Diagnostics without a
 * `deprecation` payload (an ordinary error/warning) are silently skipped, not an error — a
 * caller collecting a whole file's diagnostics can pass every one of them straight through. */
export function collectMigrations(diagnostics: readonly Diagnostic[], source: string): MigrationEdit[] {
  const edits: MigrationEdit[] = [];
  for (const d of diagnostics) {
    if (!d.deprecation) continue;
    const start = d.span.start.offset;
    const end = d.span.end.offset;
    edits.push({ start, end, oldText: source.slice(start, end), newText: d.deprecation.replacement });
  }
  edits.sort((a, b) => b.start - a.start);
  return edits;
}

/** Splices every edit into `source` in the order `collectMigrations` already sorted them
 * (widest-first) — a plain sequential splice is only offset-safe in that order. */
export function applyMigrations(source: string, edits: readonly MigrationEdit[]): string {
  let out = source;
  for (const e of edits) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  return out;
}
