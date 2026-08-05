// Import resolution for the *checker* (M87, review cluster C6). The runtime's own `buildRegistry`
// (interpreter.ts) does this for a real run; this is the same walk done ahead of time, so
// `checkCalls` can resolve a call target instead of lint-passing a typo'd or wrong-arity call.
//
// It lives in `@tflw/runtime` rather than in either caller because there are two of them — the CLI
// and the language server — and a pass that exists twice is a pass that drifts. That is not a
// hypothetical here: M60 exists because the CLI ran six checker passes and the language server ran
// four, while the docs site told readers they were the same code. One definition, two callers.
//
// It is *not* in `@tflw/lang` for the opposite reason: the checker never touches the filesystem, on
// purpose — the docs-site editor demo runs it in a browser, where there is no disk to touch.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseSource, type KnownAction, type Program } from '@tflw/lang';

/** Reads a file's text, given an absolute path. Injectable so the language server can answer from
 * an open editor buffer — an imported file being edited in another tab is more current on screen
 * than on disk, the same in-memory-is-truth rule its config branch already follows. */
export type ReadText = (absPath: string) => Promise<string>;

const readFromDisk: ReadText = (absPath) => readFile(absPath, 'utf8');

/**
 * The actions a file's `import` lines bring into scope, or `undefined` if that cannot be determined.
 *
 * Shaped by `buildRegistry`, and inheriting its two properties on purpose:
 *
 *  - **One level, no recursion.** An imported file's own `import` lines are not followed at run
 *    time, so following them here would let the checker resolve names the runtime then fails on.
 *    A checker that is more permissive than the runtime is worse than one that is less. It also
 *    means there is no import cycle to guard against.
 *  - **First declaration wins**, left to the caller (`checkCalls`) — a duplicate across files is
 *    a run-time refusal and `TF035`'s business, not this function's.
 *
 * `undefined` — returned when any import is unreadable or does not parse — means "world unknown",
 * and `checkCalls` answers no *negative* question under it (it will not call a name unknown when it
 * did not manage to look). Neither condition is reported from here: the runtime has its own error
 * for both, and having the checker report a missing imported file is `A4-07`, a separate row.
 * The case that must not happen is the middle one — resolving half the imports and then declaring
 * a name unknown on the strength of it.
 */
export async function resolveImportedActions(
  filePath: string,
  program: Program,
  readText: ReadText = readFromDisk,
): Promise<KnownAction[] | undefined> {
  if (program.imports.length === 0) return [];
  const baseDir = dirname(filePath);
  const out: KnownAction[] = [];
  for (const imp of program.imports) {
    let text: string;
    try {
      text = await readText(resolve(baseDir, imp.path.value));
    } catch {
      return undefined;
    }
    const parsed = parseSource(text);
    if (parsed.diagnostics.some((d) => d.severity === 'error')) return undefined;
    for (const action of parsed.program.actions) {
      out.push({ name: action.name, arity: action.params.length, from: imp.path.value });
    }
  }
  return out;
}
