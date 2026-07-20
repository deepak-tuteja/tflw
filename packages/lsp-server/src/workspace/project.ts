// Per-document project root discovery (PLAN_M13_LSP.md Phase 3). A deliberate duplicate of
// packages/vscode/src/lib.ts's `findProjectRoot` — this package runs in its own OS process (spawned
// by `tflw lsp`, spoken to over stdio), so it can't import the extension's code, and the function
// is ~10 lines: not worth a shared package for (architecture note in PLAN_M13_LSP.md).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walks up from `startDir` looking for `tflw.config` — the project root every other workspace/
 * module resolves paths (imports, config, cross-file rename) relative to. Returns undefined if
 * none is found (e.g. a `.tflw` file opened outside any tflw project) — callers degrade to
 * "no config-derived diagnostics/completions" rather than erroring. */
export function findProjectRoot(startDir: string, exists: (p: string) => boolean = existsSync): string | undefined {
  let dir = startDir;
  for (;;) {
    if (exists(join(dir, 'tflw.config'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
