// `M251` `B` (`D1367`) — `tflw refactor apply`'s planner, lifted out of the CLI so the editor's
// code action and the command write the same bytes: one planner, two writers. It is pure — the
// suite goes in as parsed entries and the result is every file's new text, keyed by the entries'
// own relative paths. What each writer does with it stays its own: the CLI re-checks the rewrite
// and refuses one that would not check before it writes (`B5-02` half 3); the editor hands it to
// the client as one undoable `WorkspaceEdit`, and its diagnostics re-check what lands.

import { detectReuse, renderCallSiteReplacement, importInsertionOffset, dirnamePosix, relativePosix, type SuiteEntry, type ReuseHint, type ReuseOccurrence } from './reuse.js';
import { detectElementReuse, type ElementReuseHint } from './elementReuse.js';

export interface ReuseApplyPlan {
  readonly hint: ReuseHint | ElementReuseHint;
  /** What the editor calls the action: *Extract into action `x`* / *Extract into element `y`*. */
  readonly title: string;
  /** The file the plan writes that did not exist before, relative like the entries' paths. */
  readonly created?: string;
  /** Every file the plan writes, relative path → its whole new text. */
  readonly files: ReadonlyMap<string, string>;
  /** The paths of the suite's own files it rewrites, sorted. */
  readonly changed: readonly string[];
}

export type ReuseApplyResult =
  | { readonly ok: true; readonly plan: ReuseApplyPlan }
  | { readonly ok: false; readonly reason: 'unknown-id'; readonly available: readonly string[] }
  | { readonly ok: false; readonly reason: 'exists'; readonly file: string };

/** Every hint the reuse pass offers over `entries`, action hints first and the locator hints
 * numbered on from them — the one `RF` sequence `tflw check` prints. */
export function allReuseHints(entries: readonly SuiteEntry[]): readonly (ReuseHint | ElementReuseHint)[] {
  const actions = detectReuse(entries);
  return [...actions, ...detectElementReuse(entries, actions.length + 1)];
}

const posix = (p: string): string => p.split('\\').join('/');

/** The import line a file at `fromPath` needs to reach `target`, both relative to the project. */
function importPathFrom(fromPath: string, target: string): string {
  return relativePosix(dirnamePosix(posix(fromPath)), posix(target));
}

function applyEdits(source: string, edits: { start: number; end: number; text: string }[]): string {
  // Widest-first (descending start), so an earlier edit's shift never invalidates a later one still
  // expressed in the original source's offsets.
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) source = source.slice(0, e.start) + e.text + source.slice(e.end);
  return source;
}

/**
 * Plan hint `id` over `entries`. `readExisting(path)` answers whether a file the plan would write
 * already exists outside the suite, and with what text (`null` when it does not): an action file
 * that exists refuses the plan, an element file that exists is appended to.
 */
export function planReuseApply(entries: readonly SuiteEntry[], id: string, readExisting: (path: string) => string | null): ReuseApplyResult {
  const hints = allReuseHints(entries);
  const hint = hints.find((h) => h.id === id);
  if (!hint) return { ok: false, reason: 'unknown-id', available: hints.map((h) => h.id) };
  const source = (path: string): { source: string; program: SuiteEntry['program'] } => {
    const e = entries.find((x) => posix(x.path) === posix(path))!;
    return { source: e.source, program: e.program };
  };

  if ('actionFile' in hint) {
    if (readExisting(hint.actionFile) !== null) return { ok: false, reason: 'exists', file: hint.actionFile };
    const files = new Map<string, string>([[hint.actionFile, hint.actionSource]]);
    const byPath = new Map<string, ReuseOccurrence[]>();
    for (const occ of hint.occurrences) byPath.set(occ.path, [...(byPath.get(occ.path) ?? []), occ]);
    for (const [path, occs] of byPath) {
      const f = source(path);
      const edits = occs.map((occ) => ({ ...renderCallSiteReplacement(hint.actionName, occ, f.source) }));
      const importPath = importPathFrom(path, hint.actionFile);
      if (!f.program.imports.some((imp) => imp.path.value === importPath)) {
        const at = importInsertionOffset(f.program, f.source);
        edits.push({ start: at, end: at, text: `import "${importPath}"\n` });
      }
      files.set(path, applyEdits(f.source, edits));
    }
    return { ok: true, plan: { hint, title: `Extract into action \`${hint.actionName}\``, created: hint.actionFile, files, changed: [...byPath.keys()].sort() } };
  }

  // A locator hint: the declaration is appended to `shared/elements.tflw` when it exists — a file of
  // element names is a list that grows — and each site's `css "…"` becomes the bare name.
  const declPath = hint.declarationFile;
  const existing = readExisting(declPath) ?? entries.find((e) => posix(e.path) === declPath)?.source ?? null;
  const files = new Map<string, string>([[declPath, existing === null ? `${hint.declaration}\n` : `${existing.replace(/\n*$/, '\n')}${hint.declaration}\n`]]);
  const byPath = new Map<string, typeof hint.occurrences[number][]>();
  for (const occ of hint.occurrences) byPath.set(occ.path, [...(byPath.get(occ.path) ?? []), occ]);
  for (const [path, occs] of byPath) {
    const isDecl = posix(path) === declPath;
    const f = source(path);
    const text = isDecl ? files.get(declPath)! : f.source;
    const edits = occs.map((o) => ({ start: o.span.start.offset, end: o.span.end.offset, text: hint.elementName }));
    if (!isDecl) {
      const importPath = importPathFrom(path, declPath);
      if (!f.program.imports.some((imp) => imp.path.value === importPath)) {
        const at = importInsertionOffset(f.program, f.source);
        edits.push({ start: at, end: at, text: `import "${importPath}"\n` });
      }
    }
    files.set(isDecl ? declPath : path, applyEdits(text, edits));
  }
  return {
    ok: true,
    plan: { hint, title: `Extract into element \`${hint.elementName}\``, ...(existing === null ? { created: declPath } : {}), files, changed: [...byPath.keys()].sort() },
  };
}
