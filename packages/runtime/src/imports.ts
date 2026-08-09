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
//
// M97c (D144, `A4-07`) put `resolveMissingFiles` here for exactly that reason, and the row is worth
// correcting where it lands: `A4-07` concluded the checker "cannot" verify a referenced file exists
// because it does no I/O. But the no-I/O invariant belongs to the **`@tflw/lang` package**, not to
// the `tflw check` **command** — and the command has called `resolveImportedActions`, twenty lines
// below, from inside `tflw check` since M87. It has been reading files at check time all along. So
// SPEC §4.3/§5.2's claim was implementable from the start; what it needed was placement, not a
// principle. Same file, same reason, same two callers.

import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collectConfigFileReferences, collectFileReferences, parseSource, type ConfigFile, type Diagnostic, type FileReference, type KnownAction, type Program, Codes } from '@tflw/lang';

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
      // `body` (M109, `M97d-01`): the parse above already produced it and this loop used to drop it,
      // which is the whole reason `TF044` could not decide a cycle that left the file. It is a
      // reference into `parsed`, so carrying it costs nothing a re-parse would not have cost more.
      out.push({ name: action.name, arity: action.params.length, from: imp.path.value, body: action.body });
    }
  }
  return out;
}

/** Does this path exist? Injectable for the same reason `ReadText` is: the language server has to
 * be able to answer from an open, never-yet-saved buffer, or it squiggles a file the author created
 * in another tab thirty seconds ago and has not hit save on. */
export type PathExists = (absPath: string) => Promise<boolean>;

const existsOnDisk: PathExists = async (absPath) => {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * The I/O half of `TF043` (D144, `A4-07`): which of this file's statically-known path literals name
 * something that is not there. Returns the literals' own text, which is the key
 * `ProgramCheckOptions.missingFiles` is read by.
 *
 * `resolve(dirname(filePath), literal)` is not a choice — it is what `buildRegistry`,
 * `loadTableRows`, `evalBody` and `evaluateFileMatch` all do with the `baseDir` the CLI hands them
 * (`dirname(file)`, `cli.ts`). Resolving differently here would report files as missing that the
 * run then finds, which under D137 clause 1 is not a stricter checker but a broken one.
 *
 * Deduplicated by literal text, so a path named five times is stat'd once and the caller still gets
 * a diagnostic per occurrence (`checkReferencedFiles` walks the AST, not this set).
 */
export async function resolveMissingFiles(filePath: string, program: Program, exists: PathExists = existsOnDisk): Promise<Set<string>> {
  const baseDir = dirname(filePath);
  const candidates = new Set(collectFileReferences(program).map((ref) => ref.path.value));
  const missing = new Set<string>();
  await Promise.all(
    [...candidates].map(async (literal) => {
      if (!(await exists(resolve(baseDir, literal)))) missing.add(literal);
    }),
  );
  return missing;
}

/**
 * The `tflw.config` twin of `resolveMissingFiles` (M116, D151, closing `M97c-01`) — `cert`/`key`
 * and every path a `session` body names, stat'd and turned straight into diagnostics.
 *
 * **It returns diagnostics, where the program-side function returns a set of literals, and the
 * asymmetry is the point.** `checkProgram` is a pure pass in `@tflw/lang` that must be handed
 * *answers*; there is no equivalent pure pass over a `ConfigFile`, and inventing one to preserve
 * the symmetry would mean a second `checkSessionBody`-shaped entry point whose only job is to
 * re-walk a tree this function has already walked.
 *
 * **`dirname(configPath)`, always.** Every path in `tflw.config` resolves against the config's own
 * directory: `loadMtlsCreds` is called with `configDir` (`interpreter.ts:3125`), and a session
 * body's paths were moved onto the same basis by `M97c-03`. Resolving against the cwd — which is
 * usually the same directory, and so would pass every test written from the repo root — would be
 * the `D137` clause 1 failure this whole cluster exists to avoid, visible only to a user who runs
 * `tflw` from somewhere else.
 *
 * Every reference is the **run** tier, so every diagnostic is a warning; see
 * `collectConfigFileReferences` for why `cert`/`key` are a prediction and not an observation.
 */
export async function checkConfigFiles(config: ConfigFile, configDir: string, exists: PathExists = existsOnDisk): Promise<Diagnostic[]> {
  const refs = collectConfigFileReferences(config);
  const missing = new Set<string>();
  await Promise.all(
    [...new Set(refs.map((r: FileReference) => r.path.value))].map(async (literal) => {
      if (!(await exists(resolve(configDir, literal)))) missing.add(literal);
    }),
  );
  return refs.filter((ref: FileReference) => missing.has(ref.path.value)).map((ref: FileReference) => ({
    code: Codes.MISSING_FILE,
    severity: 'warning' as const,
    message: `\`${ref.syntax}\` names a file that does not exist: "${ref.path.value}"`,
    span: ref.path.span,
    hint: 'paths in `tflw.config` resolve against the directory of `tflw.config` itself — a warning, not an error, because this file is opened during the run, so a hook or an earlier step may still create it',
  }));
}
